import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { SYSTEM_ACTOR_ID, SYSTEM_NAME } from '../../lib/system';
import { cashCloseGates } from '../opsctl/opsctl.gates';
import { AGED_DAYS, availability, tieOut, AVAIL_VERSION, coverageProblems, daysBetween, EFFECTIVE, LIVE_RESERVATION, signed, UNPOSTED } from './cash.engine';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
type Db = Prisma.TransactionClient | typeof prisma;

export type JournalRow = Prisma.CashJournalGetPayload<object>;
export type ReservationRow = Prisma.CashReservationGetPayload<object>;
export type ExpectationRow = Prisma.CashExpectationGetPayload<object>;
export type ImportRow = Prisma.CashStatementImportGetPayload<object>;
export type CloseRow = Prisma.CashPeriodCloseGetPayload<object>;
export type LedgerRow = Prisma.CashLedgerGetPayload<object>;

export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const f2 = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));

export async function names(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const rows = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const m = new Map(rows.map((u) => [u.id, u.name || u.email]));
  if (ids.includes(SYSTEM_ACTOR_ID)) m.set(SYSTEM_ACTOR_ID, SYSTEM_NAME);
  return m;
}

async function portfolioMap(ids: string[]) {
  const rows = ids.length ? await prisma.portfolio.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, ref: true, name: true } }) : [];
  return new Map(rows.map((p) => [p.id, p]));
}
async function ledgerMap(ids: string[]) {
  const rows = ids.length ? await prisma.cashLedger.findMany({ where: { id: { in: [...new Set(ids)] } } }) : [];
  return new Map(rows.map((l) => [l.id, l]));
}

// ---------------------------------------------------------------- closed periods

/** A cash date is locked once any CLOSED close covers it (periodEnd on or after the date). */
export async function closedThrough(portfolioId: string, date: Date, db: Db = prisma) {
  return db.cashPeriodClose.findFirst({ where: { portfolioId, status: 'CLOSED', periodEnd: { gte: date } }, orderBy: { periodEnd: 'desc' } });
}
export async function assertCashPeriodOpen(portfolioId: string, date: Date, db: Db = prisma) {
  const c = await closedThrough(portfolioId, date, db);
  if (c) throw new HttpError(409, 'period_closed', `Cash for ${isoDay(c.periodEnd)} and earlier is closed. Use a later date, or reopen the close.`);
}

// ---------------------------------------------------------------- balances

/** Ledger lines of journals that affect the books, optionally filtered by ledger and date. */
const effectiveLines = (ledgerIds: string[], asOf: Date): Prisma.CashJournalLineWhereInput => ({ ledgerId: { in: ledgerIds }, journal: { status: { in: EFFECTIVE }, entryDate: { lte: asOf } } });

export async function postedByLedger(ledgerIds: string[], asOf: Date) {
  if (!ledgerIds.length) return new Map<string, Dec>();
  const g = await prisma.cashJournalLine.groupBy({ by: ['ledgerId'], where: effectiveLines(ledgerIds, asOf), _sum: { debit: true, credit: true } });
  return new Map(g.map((r) => [r.ledgerId, (r._sum.debit ?? ZERO).sub(r._sum.credit ?? ZERO)]));
}

/** Live reservations: not released, consumed or expired by status, and not past their expiry date. */
export const liveReservationWhere = (today: Date): Prisma.CashReservationWhereInput => ({ status: { in: LIVE_RESERVATION }, OR: [{ expiresOn: null }, { expiresOn: { gte: today } }] });

export async function reservedByLedger(ledgerIds: string[], db: Db = prisma) {
  if (!ledgerIds.length) return new Map<string, Dec>();
  const g = await db.cashReservation.groupBy({ by: ['ledgerId'], where: { ledgerId: { in: ledgerIds }, ...liveReservationWhere(startOfDay(new Date())) }, _sum: { amount: true, consumed: true } });
  return new Map(g.map((r) => [r.ledgerId, (r._sum.amount ?? ZERO).sub(r._sum.consumed ?? ZERO)]));
}

export async function ledgerAvailability(ledger: LedgerRow, db: Db = prisma) {
  const posted = (await postedByLedger([ledger.id], new Date('9999-12-31T00:00:00Z'))).get(ledger.id) ?? ZERO;
  const reserved = (await reservedByLedger([ledger.id], db)).get(ledger.id) ?? ZERO;
  return { posted, reserved, ...availability(posted, reserved, ledger.minBuffer) };
}

export async function balances(f: { portfolioId?: string; portfolioIds?: string[]; cashAccountId?: string; currency?: string; asOf: Date }) {
  const ledgers = await prisma.cashLedger.findMany({
    where: { kind: 'BANK', ...(f.portfolioIds ? { portfolioId: { in: f.portfolioIds } } : f.portfolioId ? { portfolioId: f.portfolioId } : {}), ...(f.cashAccountId ? { cashAccountId: f.cashAccountId } : {}), ...(f.currency ? { currency: f.currency } : {}) },
    orderBy: [{ portfolioId: 'asc' }, { ref: 'asc' }],
  });
  const ids = ledgers.map((l) => l.id);
  const [posted, reserved, expected, pf] = await Promise.all([
    postedByLedger(ids, f.asOf),
    reservedByLedger(ids),
    ids.length ? prisma.cashExpectation.findMany({ where: { ledgerId: { in: ids }, status: 'EXPECTED' }, select: { ledgerId: true, direction: true, amount: true } }) : [],
    portfolioMap(ledgers.map((l) => l.portfolioId)),
  ]);
  const exp = new Map<string, Dec>();
  for (const e of expected) exp.set(e.ledgerId, (exp.get(e.ledgerId) ?? ZERO).add(e.direction === 'IN' ? e.amount : e.amount.neg()));
  const rows = ledgers.map((l) => {
    const p = posted.get(l.id) ?? ZERO;
    const r = reserved.get(l.id) ?? ZERO;
    const a = availability(p, r, l.minBuffer);
    return { l, p, r, a, x: exp.get(l.id) ?? ZERO };
  });
  const view = rows.map(({ l, p, r, a, x }) => ({
    ledgerId: l.id,
    ref: l.ref,
    name: l.name,
    portfolioId: l.portfolioId,
    portfolioRef: pf.get(l.portfolioId)?.ref ?? null,
    portfolioName: pf.get(l.portfolioId)?.name ?? null,
    cashAccountId: l.cashAccountId,
    currency: l.currency,
    status: l.status,
    posted: p.toFixed(2),
    reserved: r.toFixed(2),
    minBuffer: l.minBuffer.toFixed(2),
    expectedNet: x.toFixed(2),
    available: a.available.toFixed(2),
    withdrawable: a.withdrawable.toFixed(2),
  }));
  const totals = new Map<string, { portfolioId: string; portfolioName: string | null; currency: string; posted: Dec; reserved: Dec; available: Dec; expectedNet: Dec }>();
  for (const { l, p, r, a, x } of rows) {
    const k = `${l.portfolioId}|${l.currency}`;
    const t = totals.get(k) ?? { portfolioId: l.portfolioId, portfolioName: pf.get(l.portfolioId)?.name ?? null, currency: l.currency, posted: ZERO, reserved: ZERO, available: ZERO, expectedNet: ZERO };
    t.posted = t.posted.add(p);
    t.reserved = t.reserved.add(r);
    t.available = t.available.add(a.available);
    t.expectedNet = t.expectedNet.add(x);
    totals.set(k, t);
  }
  return {
    asOf: isoDay(f.asOf),
    calculation: AVAIL_VERSION,
    note: 'Posted is derived from posted journal lines up to the as-of date. Reserved and expected are current state. Expected movements are projection only and never change availability.',
    ledgers: view,
    totals: [...totals.values()].map((t) => ({ ...t, posted: t.posted.toFixed(2), reserved: t.reserved.toFixed(2), available: t.available.toFixed(2), expectedNet: t.expectedNet.toFixed(2) })),
  };
}

/**
 * The exact lines behind a ledger's available figure (FR-CASH-010). Every contribution carries its signed effect on
 * available cash: posted journal lines (+), holds (-), pending withdrawals that are reserved (-) and the minimum-buffer
 * policy line (-). They sum to `rawAvailable` to the minor unit, and `available = max(0, rawAvailable)`.
 * Withdrawals still awaiting approval are listed separately: they do not touch availability until they post.
 */
export async function explainLedger(ledger: LedgerRow, asOf: Date) {
  const [lines, reservations, pendingJournalLines] = await Promise.all([
    prisma.cashJournalLine.findMany({ where: effectiveLines([ledger.id], asOf), include: { journal: true }, orderBy: [{ journal: { entryDate: 'asc' } }, { journal: { createdAt: 'asc' } }, { lineNo: 'asc' }], take: 2000 }),
    prisma.cashReservation.findMany({ where: { ledgerId: ledger.id, ...liveReservationWhere(startOfDay(new Date())) }, orderBy: { createdAt: 'asc' } }),
    prisma.cashJournalLine.findMany({ where: { ledgerId: ledger.id, journal: { status: { in: UNPOSTED }, purpose: 'CLIENT_WITHDRAWAL' } }, include: { journal: true }, take: 200 }),
  ]);
  const posted = lines.reduce((s, l) => s.add(signed(l)), ZERO);
  const reserved = reservations.reduce((s, r) => s.add(r.amount.sub(r.consumed)), ZERO);
  const a = availability(posted, reserved, ledger.minBuffer);
  const rawAvailable = posted.sub(reserved).sub(ledger.minBuffer);
  const remaining = (r: (typeof reservations)[number]) => r.amount.sub(r.consumed);
  const holds = reservations.filter((r) => r.purpose !== 'WITHDRAWAL');
  const reservedWithdrawals = reservations.filter((r) => r.purpose === 'WITHDRAWAL');
  const pendingApproval = pendingJournalLines.filter((l) => l.credit.gt(0)).map((l) => ({ journalId: l.journalId, ref: l.journal.ref, status: l.journal.status, entryDate: isoDay(l.journal.entryDate), description: l.journal.description, amount: l.credit.sub(l.debit).toFixed(2), inAvailability: false }));
  const contributions = [
    ...lines.map((l) => ({ kind: 'JOURNAL', ref: l.journal.ref, label: l.journal.description, effect: signed(l).toFixed(2) })),
    ...holds.map((r) => ({ kind: 'HOLD', ref: r.ref, label: `${r.source} (${r.purpose.toLowerCase().replace(/_/g, ' ')})`, effect: remaining(r).neg().toFixed(2) })),
    ...reservedWithdrawals.map((r) => ({ kind: 'PENDING_WITHDRAWAL', ref: r.ref, label: `${r.source} (pending withdrawal)`, effect: remaining(r).neg().toFixed(2) })),
    ...(ledger.minBuffer.gt(0) ? [{ kind: 'POLICY', ref: 'MIN_BUFFER', label: 'Minimum cash buffer kept back by policy', effect: ledger.minBuffer.neg().toFixed(2) }] : []),
  ];
  const sum = contributions.reduce((t, c) => t.add(new D(c.effect)), ZERO);
  return {
    ledgerId: ledger.id,
    ref: ledger.ref,
    name: ledger.name,
    currency: ledger.currency,
    asOf: isoDay(asOf),
    calculation: AVAIL_VERSION,
    formula: 'available = max(0, posted - reserved - minimum buffer)',
    posted: posted.toFixed(2),
    reserved: reserved.toFixed(2),
    minBuffer: ledger.minBuffer.toFixed(2),
    available: a.available.toFixed(2),
    withdrawable: a.withdrawable.toFixed(2),
    journalLines: lines.map((l) => ({ journalId: l.journalId, ref: l.journal.ref, entryDate: isoDay(l.journal.entryDate), status: l.journal.status, description: l.journal.description, signed: signed(l).toFixed(2) })),
    reservations: reservations.map((r) => ({ id: r.id, ref: r.ref, source: r.source, purpose: r.purpose, remaining: remaining(r).toFixed(2) })),
    holds: holds.map((r) => ({ id: r.id, ref: r.ref, source: r.source, purpose: r.purpose, remaining: remaining(r).toFixed(2), requiredDate: isoDay(r.requiredDate), expiresOn: isoDay(r.expiresOn) })),
    pendingWithdrawals: {
      reserved: reservedWithdrawals.map((r) => ({ id: r.id, ref: r.ref, source: r.source, remaining: remaining(r).toFixed(2), requiredDate: isoDay(r.requiredDate), inAvailability: true })),
      awaitingApproval: pendingApproval,
    },
    policyLines: [{ key: 'MIN_BUFFER', label: 'Minimum cash buffer', amount: ledger.minBuffer.toFixed(2) }],
    contributions,
    contributionSum: sum.toFixed(2),
    rawAvailable: rawAvailable.toFixed(2),
    ties: sum.eq(rawAvailable) && (rawAvailable.gt(0) ? rawAvailable : ZERO).eq(a.available),
  };
}

// ---------------------------------------------------------------- views

export async function ledgerViews(rows: LedgerRow[]) {
  const pf = await portfolioMap(rows.map((r) => r.portfolioId));
  return rows.map((l) => ({
    id: l.id,
    ref: l.ref,
    name: l.name,
    portfolioId: l.portfolioId,
    portfolioRef: pf.get(l.portfolioId)?.ref ?? null,
    portfolioName: pf.get(l.portfolioId)?.name ?? null,
    currency: l.currency,
    kind: l.kind,
    cashAccountId: l.cashAccountId,
    minBuffer: l.minBuffer.toFixed(2),
    tolerance: l.tolerance.toFixed(2),
    status: l.status,
  }));
}

export async function journalViews(rows: JournalRow[]) {
  const [users, pf] = await Promise.all([names(rows.flatMap((r) => [r.makerId, r.postedBy])), portfolioMap(rows.map((r) => r.portfolioId))]);
  const linkIds = rows.flatMap((r) => [r.reversalOfId, r.reversedById]).filter((x): x is string => !!x);
  const links = linkIds.length ? await prisma.cashJournal.findMany({ where: { id: { in: linkIds } }, select: { id: true, ref: true } }) : [];
  const ref = new Map(links.map((l) => [l.id, l.ref]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    portfolioId: r.portfolioId,
    portfolioRef: pf.get(r.portfolioId)?.ref ?? null,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    entryDate: isoDay(r.entryDate),
    description: r.description,
    purpose: r.purpose,
    sourceRef: r.sourceRef,
    evidenceRef: r.evidenceRef,
    currency: r.currency,
    status: r.status,
    totalDebit: r.totalDebit.toFixed(2),
    totalCredit: r.totalCredit.toFixed(2),
    makerId: r.makerId,
    makerName: users.get(r.makerId) ?? null,
    submittedAt: iso(r.submittedAt),
    postedBy: r.postedBy,
    postedByName: r.postedBy ? (users.get(r.postedBy) ?? null) : null,
    postedAt: iso(r.postedAt),
    rejectReason: r.rejectReason,
    expectationId: r.expectationId,
    reservationId: r.reservationId,
    reversalOfId: r.reversalOfId,
    reversalOfRef: r.reversalOfId ? (ref.get(r.reversalOfId) ?? null) : null,
    reversedById: r.reversedById,
    reversedByRef: r.reversedById ? (ref.get(r.reversedById) ?? null) : null,
    reversedAt: iso(r.reversedAt),
    reverseReason: r.reverseReason,
    createdAt: iso(r.createdAt),
  }));
}

export async function loadJournal(id: string): Promise<JournalRow> {
  const r = await prisma.cashJournal.findFirst({ where: { OR: [{ id }, { ref: id.toUpperCase() }] } });
  if (!r) throw HttpError.notFound('Journal not found');
  return r;
}

export async function loadLedger(id: string, db: Db = prisma): Promise<LedgerRow> {
  const r = await db.cashLedger.findFirst({ where: { OR: [{ id }, { ref: id.toUpperCase() }] } });
  if (!r) throw HttpError.notFound('Cash ledger not found');
  return r;
}

export async function journalDetail(r: JournalRow, user: { id: string; permissions: string[] }) {
  const [view] = await journalViews([r]);
  const [lines, events, closed] = await Promise.all([
    prisma.cashJournalLine.findMany({ where: { journalId: r.id }, include: { ledger: true }, orderBy: { lineNo: 'asc' } }),
    prisma.auditEvent.findMany({ where: { objectType: 'cash_journal', objectId: r.id }, orderBy: { id: 'asc' }, take: 100 }),
    closedThrough(r.portfolioId, r.entryDate),
  ]);
  const users = await names(events.map((e) => e.actorId));
  const can = (p: string) => user.permissions.includes(p);
  const isMaker = r.makerId === user.id;
  const locked = !!closed;
  const postBlocker =
    r.status !== 'PENDING_APPROVAL' ? `Journal is ${r.status}` : !can('cash.journal.approve') ? 'Requires cash.journal.approve' : isMaker ? 'The journal creator cannot post it (maker-checker)' : locked ? 'The cash period is closed' : null;
  return {
    ...view,
    periodClosed: locked,
    lines: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, ledgerId: l.ledgerId, ledgerRef: l.ledger.ref, ledgerName: l.ledger.name, ledgerKind: l.ledger.kind, debit: f2(l.debit)!, credit: f2(l.credit)!, memo: l.memo })),
    timeline: events.map((e) => ({ at: e.occurredAt.toISOString(), action: e.action, actor: (e.actorId && users.get(e.actorId)) || 'System', reason: e.reason ?? null })),
    allowed: {
      edit: r.status === 'DRAFT' && isMaker && !locked,
      submit: r.status === 'DRAFT' && isMaker && !locked,
      discard: (r.status === 'DRAFT' && isMaker) || (r.status === 'PENDING_APPROVAL' && (isMaker || can('cash.journal.approve'))),
      returnToMaker: r.status === 'PENDING_APPROVAL' && can('cash.journal.approve') && !isMaker,
      reject: r.status === 'PENDING_APPROVAL' && can('cash.journal.approve') && !isMaker,
      post: postBlocker === null,
      postBlocker,
      reverse: r.status === 'POSTED' && !r.reversalOfId && can('cash.journal.approve'),
    },
  };
}

export const effectiveExpectationStatus = (e: { status: string; expectedDate: Date }, today: Date) => (e.status === 'EXPECTED' && e.expectedDate.getTime() <= today.getTime() ? 'DUE' : e.status);

export async function reservationViews(rows: ReservationRow[]) {
  const [users, pf, lg] = await Promise.all([names(rows.flatMap((r) => [r.createdBy, r.releasedBy])), portfolioMap(rows.map((r) => r.portfolioId)), ledgerMap(rows.map((r) => r.ledgerId))]);
  const today = startOfDay(new Date());
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    portfolioId: r.portfolioId,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    ledgerId: r.ledgerId,
    ledgerRef: lg.get(r.ledgerId)?.ref ?? null,
    ledgerName: lg.get(r.ledgerId)?.name ?? null,
    orderId: r.orderId,
    source: r.source,
    purpose: r.purpose,
    currency: r.currency,
    amount: r.amount.toFixed(2),
    consumed: r.consumed.toFixed(2),
    remaining: LIVE_RESERVATION.includes(r.status) ? r.amount.sub(r.consumed).toFixed(2) : '0.00',
    requiredDate: isoDay(r.requiredDate),
    expiresOn: isoDay(r.expiresOn),
    /** True for an ACTIVE hold past its expiry that has not been swept yet; it no longer reduces availability. */
    lapsed: LIVE_RESERVATION.includes(r.status) && !!r.expiresOn && r.expiresOn.getTime() < today.getTime(),
    status: r.status,
    createdBy: r.createdBy,
    createdByName: users.get(r.createdBy) ?? null,
    releasedByName: r.releasedBy ? (users.get(r.releasedBy) ?? null) : null,
    releasedAt: iso(r.releasedAt),
    releaseReason: r.releaseReason,
    createdAt: iso(r.createdAt),
  }));
}

export async function expectationViews(rows: ExpectationRow[]) {
  const [users, pf, lg] = await Promise.all([names(rows.map((r) => r.createdBy)), portfolioMap(rows.map((r) => r.portfolioId)), ledgerMap(rows.map((r) => r.ledgerId))]);
  const today = startOfDay(new Date());
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    portfolioId: r.portfolioId,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    ledgerId: r.ledgerId,
    ledgerRef: lg.get(r.ledgerId)?.ref ?? null,
    ledgerName: lg.get(r.ledgerId)?.name ?? null,
    direction: r.direction,
    kind: r.kind,
    source: r.source,
    currency: r.currency,
    amount: r.amount.toFixed(2),
    signedAmount: (r.direction === 'IN' ? r.amount : r.amount.neg()).toFixed(2),
    expectedDate: isoDay(r.expectedDate),
    status: effectiveExpectationStatus(r, today),
    journalId: r.journalId,
    note: r.note,
    createdByName: users.get(r.createdBy) ?? null,
    createdAt: iso(r.createdAt),
  }));
}

export async function importViews(rows: ImportRow[]) {
  const [users, pf, lg] = await Promise.all([names(rows.flatMap((r) => [r.makerId, r.checkerId])), portfolioMap(rows.map((r) => r.portfolioId)), ledgerMap(rows.map((r) => r.ledgerId))]);
  const unmatched = rows.length ? await prisma.cashStatementLine.groupBy({ by: ['importId'], where: { importId: { in: rows.map((r) => r.id) }, status: 'UNMATCHED' }, _count: { _all: true } }) : [];
  const un = new Map(unmatched.map((u) => [u.importId, u._count._all]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    ledgerId: r.ledgerId,
    ledgerRef: lg.get(r.ledgerId)?.ref ?? null,
    ledgerName: lg.get(r.ledgerId)?.name ?? null,
    currency: lg.get(r.ledgerId)?.currency ?? null,
    portfolioId: r.portfolioId,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    filename: r.filename,
    format: r.format,
    statementFrom: isoDay(r.statementFrom),
    statementTo: isoDay(r.statementTo),
    openingBalance: r.openingBalance.toFixed(2),
    closingBalance: r.closingBalance.toFixed(2),
    lineCount: r.lineCount,
    unmatchedLines: un.get(r.id) ?? 0,
    variance: r.variance.toFixed(2),
    status: r.status,
    makerId: r.makerId,
    makerName: users.get(r.makerId) ?? null,
    checkerName: r.checkerId ? (users.get(r.checkerId) ?? null) : null,
    committedAt: iso(r.committedAt),
    rejectReason: r.rejectReason,
    createdAt: iso(r.createdAt),
  }));
}

export async function loadImport(id: string): Promise<ImportRow> {
  const r = await prisma.cashStatementImport.findFirst({ where: { OR: [{ id }, { ref: id.toUpperCase() }] } });
  if (!r) throw HttpError.notFound('Statement import not found');
  return r;
}

export async function importDetail(r: ImportRow, user: { id: string; permissions: string[] }) {
  const [[view], lines, events] = await Promise.all([
    importViews([r]),
    prisma.cashStatementLine.findMany({ where: { importId: r.id }, orderBy: { lineNo: 'asc' }, take: 2000 }),
    prisma.auditEvent.findMany({ where: { objectType: 'cash_statement_import', objectId: r.id }, orderBy: { id: 'asc' }, take: 50 }),
  ]);
  const users = await names(events.map((e) => e.actorId));
  const can = (p: string) => user.permissions.includes(p);
  const isMaker = r.makerId === user.id;
  const staged = r.status === 'STAGED';
  const commitBlocker = !staged ? `Import is ${r.status}` : !can('cash.journal.approve') ? 'Requires cash.journal.approve' : isMaker ? 'The uploader cannot commit their own import (maker-checker)' : null;
  return {
    ...view!,
    lines: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, valueDate: isoDay(l.valueDate), amount: l.amount.toFixed(2), reference: l.reference, description: l.description, status: l.status, matchedJournalId: l.matchedJournalId, note: l.note })),
    timeline: events.map((e) => ({ at: e.occurredAt.toISOString(), action: e.action, actor: (e.actorId && users.get(e.actorId)) || 'System', reason: e.reason ?? null })),
    allowed: { commit: commitBlocker === null, commitBlocker, reject: staged && (isMaker || can('cash.journal.approve')) },
  };
}

export async function closeViews(rows: CloseRow[]) {
  const [users, pf] = await Promise.all([names(rows.flatMap((r) => [r.preparedBy, r.approvedBy, r.closedBy, r.reopenedBy])), portfolioMap(rows.map((r) => r.portfolioId))]);
  return rows.map((r) => ({
    id: r.id,
    portfolioId: r.portfolioId,
    portfolioRef: pf.get(r.portfolioId)?.ref ?? null,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    periodEnd: isoDay(r.periodEnd),
    status: r.status,
    preparedBy: r.preparedBy,
    preparedByName: users.get(r.preparedBy) ?? null,
    preparedAt: iso(r.preparedAt),
    approvedByName: r.approvedBy ? (users.get(r.approvedBy) ?? null) : null,
    approvedAt: iso(r.approvedAt),
    closedByName: r.closedBy ? (users.get(r.closedBy) ?? null) : null,
    closedAt: iso(r.closedAt),
    reopenedByName: r.reopenedBy ? (users.get(r.reopenedBy) ?? null) : null,
    reopenedAt: iso(r.reopenedAt),
    reopenReason: r.reopenReason,
  }));
}

export async function loadClose(id: string): Promise<CloseRow> {
  const r = await prisma.cashPeriodClose.findUnique({ where: { id } });
  if (!r) throw HttpError.notFound('Cash close not found');
  return r;
}

// ---------------------------------------------------------------- close pre-check

export interface PrecheckItem {
  key: 'STATEMENT_COVERAGE' | 'BALANCE_VARIANCE' | 'SUBLEDGER_GL' | 'SUSPENSE' | 'AGED_ITEMS' | 'UNPOSTED_JOURNALS' | 'CHECKER_APPROVAL' | 'NAV_RELEASED' | 'RECON_SIGNOFF' | 'RECON_MATERIAL';
  label: string;
  ok: boolean;
  blockers: string[];
  detail: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const MAX_LISTED = 15;
const capped = (xs: string[]) => (xs.length > MAX_LISTED ? [...xs.slice(0, MAX_LISTED), `...and ${xs.length - MAX_LISTED} more`] : xs);

/** Every control a cash close depends on, each with its own blockers. Used by GET (informational) and POST close (refuses with all of them). */
export async function closePrecheck(portfolioId: string, periodEnd: Date, close: CloseRow | null) {
  const ledgers = await prisma.cashLedger.findMany({ where: { portfolioId, status: { not: 'CLOSED' }, createdAt: { lte: new Date(periodEnd.getTime() + 86_400_000) } }, orderBy: { ref: 'asc' } });
  const bank = ledgers.filter((l) => l.kind === 'BANK');
  const suspense = ledgers.filter((l) => l.kind === 'SUSPENSE');
  const agedBefore = new Date(periodEnd.getTime() - AGED_DAYS * 86_400_000);
  const [stmts, balance, suspBal, unmatched, staleExp, unposted] = await Promise.all([
    prisma.cashStatementImport.findMany({ where: { ledgerId: { in: bank.map((l) => l.id) }, status: 'COMMITTED' } }),
    postedByLedger(bank.map((l) => l.id), periodEnd),
    postedByLedger(suspense.map((l) => l.id), periodEnd),
    prisma.cashStatementLine.findMany({ where: { ledgerId: { in: bank.map((l) => l.id) }, status: 'UNMATCHED', valueDate: { lt: agedBefore }, import: { status: 'COMMITTED' } }, orderBy: [{ ledgerId: 'asc' }, { valueDate: 'asc' }], take: 500 }),
    prisma.cashExpectation.findMany({ where: { portfolioId, status: 'EXPECTED', expectedDate: { lt: agedBefore } }, orderBy: { expectedDate: 'asc' }, take: 200 }),
    prisma.cashJournal.findMany({ where: { portfolioId, status: { in: UNPOSTED }, entryDate: { lte: periodEnd } }, orderBy: { ref: 'asc' }, select: { ref: true, status: true } }),
  ]);

  // statement coverage and continuity
  const coverage: string[] = [];
  for (const l of bank) {
    const s = stmts.filter((x) => x.ledgerId === l.id);
    coverageProblems(s, periodEnd).forEach((p) => coverage.push(`${l.name} (${l.ref}): ${p}`));
  }
  // balance variance at the period end, from the statement that covers it
  const variance: string[] = [];
  for (const l of bank) {
    const cover = stmts.filter((x) => x.ledgerId === l.id && x.statementFrom <= periodEnd && x.statementTo >= periodEnd).sort((a, b) => a.statementTo.getTime() - b.statementTo.getTime())[0];
    if (!cover) continue;
    const moved = await prisma.cashStatementLine.aggregate({ where: { importId: cover.id, valueDate: { lte: periodEnd } }, _sum: { amount: true } });
    const external = cover.openingBalance.add(moved._sum.amount ?? ZERO);
    const internal = balance.get(l.id) ?? ZERO;
    const diff = external.sub(internal);
    if (diff.abs().gt(l.tolerance)) variance.push(`${l.name} (${l.ref}): statement ${external.toFixed(2)} vs ledger ${internal.toFixed(2)}, variance ${diff.toFixed(2)} (tolerance ${l.tolerance.toFixed(2)} ${l.currency})`);
  }
  const susp = suspense.flatMap((l) => {
    const b = suspBal.get(l.id) ?? ZERO;
    return b.isZero() ? [] : [`${l.name} (${l.ref}) holds ${b.toFixed(2)} ${l.currency} without a beneficial purpose; clear it to its owner`];
  });
  const ledgerName = new Map(bank.map((l) => [l.id, l]));
  const aged = [
    ...unmatched.map((u) => `Statement line ${isoDay(u.valueDate)} ${u.amount.toFixed(2)} ${ledgerName.get(u.ledgerId)?.currency ?? ''} "${u.reference ?? u.description ?? 'no reference'}" unmatched for ${plural(daysBetween(u.valueDate, periodEnd), 'day')}`),
    ...staleExp.map((e) => `Expected ${e.direction === 'IN' ? 'receipt' : 'payment'} ${e.ref} of ${e.amount.toFixed(2)} ${e.currency} was due ${isoDay(e.expectedDate)} and has not posted`),
  ];
  const unp = unposted.map((j) => `Journal ${j.ref} is ${j.status === 'DRAFT' ? 'a draft' : 'awaiting approval'}; post or discard it`);
  const approved = close && ['APPROVED', 'CLOSED'].includes(close.status);

  const items: PrecheckItem[] = [
    { key: 'STATEMENT_COVERAGE', label: 'Statements cover the period for every bank ledger', ok: !coverage.length, blockers: capped(coverage), detail: coverage.length ? plural(coverage.length, 'coverage problem') : `${plural(bank.length, 'bank ledger')} covered to ${isoDay(periodEnd)}` },
    { key: 'BALANCE_VARIANCE', label: 'Statement balance agrees with the ledger', ok: !variance.length, blockers: variance, detail: variance.length ? plural(variance.length, 'ledger') + ' out of tolerance' : 'Within tolerance' },
    await subledgerGlItem(portfolioId, periodEnd, bank, balance),
    { key: 'SUSPENSE', label: 'No suspense balance', ok: !susp.length, blockers: susp, detail: susp.length ? plural(susp.length, 'suspense ledger') + ' not clear' : 'Suspense is clear' },
    { key: 'AGED_ITEMS', label: `No open items older than ${AGED_DAYS} days`, ok: !aged.length, blockers: capped(aged), detail: aged.length ? plural(aged.length, 'aged item') : 'No aged unmatched lines or overdue expectations' },
    { key: 'UNPOSTED_JOURNALS', label: 'All journals to the period end are posted', ok: !unp.length, blockers: capped(unp), detail: unp.length ? plural(unp.length, 'unposted journal') : 'No draft or pending journals' },
    {
      key: 'CHECKER_APPROVAL',
      label: 'Independent checker has approved the close',
      ok: !!approved,
      blockers: approved ? [] : [close ? 'The close is prepared; an independent checker (not the preparer) must approve it' : 'The close has not been prepared; prepare it and have an independent checker approve it'],
      detail: approved ? 'Approved' : close ? 'Awaiting checker' : 'Not prepared',
    },
  ];
  // R4-2: NAV-released gate and reconciliation sign-off gate, each with itemised blockers.
  items.push(...(await cashCloseGates(portfolioId, periodEnd)));
  const blockers = items.flatMap((i) => i.blockers);
  return { items, blockers, canClose: blockers.length === 0 };
}

// ---------------------------------------------------------------- sub-ledger to general ledger tie-out (FR-CASH-018)

/**
 * The bank cash sub-ledgers must agree with the general ledger's "Cash at bank" account (1000) at the period end, per
 * currency, within the sum of the ledgers' tolerances. A portfolio without a general ledger has nothing to tie out. The
 * policy `cash_gl_tieout` = false switches the gate off.
 */
export async function subledgerGlItem(portfolioId: string, periodEnd: Date, bank: LedgerRow[], balance: Map<string, Dec>): Promise<PrecheckItem> {
  const label = 'Cash sub-ledger agrees with the general ledger cash account';
  const key = 'SUBLEDGER_GL' as const;
  const policy = await prisma.policy.findUnique({ where: { key: 'cash_gl_tieout' } });
  if (policy?.value === false) return { key, label, ok: true, blockers: [], detail: 'Switched off by policy' };
  const chart = await prisma.accAccount.count({ where: { portfolioId } });
  if (!chart) return { key, label, ok: true, blockers: [], detail: 'No general ledger for this portfolio yet; nothing to tie out' };
  const account = await prisma.accAccount.findUnique({ where: { portfolioId_code: { portfolioId, code: '1000' } } });
  const sub = new Map<string, { amount: Dec; tolerance: Dec }>();
  for (const l of bank) {
    const e = sub.get(l.currency) ?? { amount: ZERO, tolerance: ZERO };
    sub.set(l.currency, { amount: e.amount.add(balance.get(l.id) ?? ZERO), tolerance: e.tolerance.add(l.tolerance) });
  }
  const gl = new Map<string, Dec>();
  if (account) {
    const currencies = await prisma.accJournal.groupBy({ by: ['currency'], where: { portfolioId, status: { in: ['POSTED', 'REVERSED'] }, entryDate: { lte: periodEnd } } });
    for (const c of currencies) {
      const g = await prisma.accJournalLine.aggregate({ where: { accountId: account.id, journal: { portfolioId, currency: c.currency, status: { in: ['POSTED', 'REVERSED'] }, entryDate: { lte: periodEnd } } }, _sum: { debit: true, credit: true } });
      gl.set(c.currency, (g._sum.debit ?? ZERO).sub(g._sum.credit ?? ZERO));
    }
  }
  const blockers: string[] = [];
  for (const ccy of [...new Set([...sub.keys(), ...gl.keys()])].sort()) {
    const s = sub.get(ccy) ?? { amount: ZERO, tolerance: ZERO };
    const t = tieOut(s.amount, gl.get(ccy) ?? ZERO, s.tolerance);
    if (!t.ok) blockers.push(`${ccy}: cash sub-ledger ${s.amount.toFixed(2)} vs general ledger ${account ? `account 1000 ${(gl.get(ccy) ?? ZERO).toFixed(2)}` : 'with no Cash at bank account (1000)'}, difference ${t.difference.toFixed(2)} (tolerance ${s.tolerance.toFixed(2)}); post or correct the journals on the side that is behind`);
  }
  return { key, label, ok: !blockers.length, blockers, detail: blockers.length ? plural(blockers.length, 'currency') + ' do not tie' : 'Sub-ledger and general ledger agree' };
}
