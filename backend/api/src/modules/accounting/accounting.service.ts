import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { SYSTEM_ACTOR_ID, SYSTEM_NAME } from '../../lib/system';
import { isDebitNormal, naturalBalance } from './accounting.engine';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

export type JournalRow = Prisma.AccJournalGetPayload<object>;
export type PeriodRow = Prisma.AccPeriodGetPayload<object>;
/** Journals that have an effect on the books. */
export const EFFECTIVE = ['POSTED', 'REVERSED'];
export const UNPOSTED = ['DRAFT', 'PENDING_APPROVAL'];

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

// ---------------------------------------------------------------- periods

type Db = Prisma.TransactionClient | typeof prisma;

export async function periodFor(portfolioId: string, date: Date, db: Db = prisma) {
  return db.accPeriod.findFirst({ where: { portfolioId, periodStart: { lte: date }, periodEnd: { gte: date } } });
}

/** Posting (and drafting) into a CLOSED period is refused. */
export async function assertPeriodOpen(portfolioId: string, date: Date, db: Db = prisma) {
  const p = await periodFor(portfolioId, date, db);
  if (p?.status === 'CLOSED') {
    throw new HttpError(409, 'period_closed', `The accounting period ${isoDay(p.periodStart)} to ${isoDay(p.periodEnd)} is closed. Use a date in an open period, or reopen the period.`);
  }
  return p;
}

// ---------------------------------------------------------------- balances

export async function trialBalance(portfolioId: string, asOf: Date) {
  const [accounts, grouped] = await Promise.all([
    prisma.accAccount.findMany({ where: { portfolioId }, orderBy: { code: 'asc' } }),
    prisma.accJournalLine.groupBy({
      by: ['accountId'],
      where: { journal: { portfolioId, status: { in: EFFECTIVE }, entryDate: { lte: asOf } } },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const s = new Map(grouped.map((r) => [r.accountId, { debit: r._sum.debit ?? ZERO, credit: r._sum.credit ?? ZERO }]));
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const rows = [];
  for (const a of accounts) {
    const v = s.get(a.id) ?? { debit: ZERO, credit: ZERO };
    const moved = !v.debit.isZero() || !v.credit.isZero();
    if (!moved && !a.isActive) continue;
    const net = v.debit.sub(v.credit);
    const debit = net.gt(0) ? net : ZERO;
    const credit = net.lt(0) ? net.neg() : ZERO;
    totalDebit = totalDebit.add(debit);
    totalCredit = totalCredit.add(credit);
    rows.push({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      isActive: a.isActive,
      periodDebits: v.debit.toFixed(2),
      periodCredits: v.credit.toFixed(2),
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      balance: naturalBalance(a.type, v.debit, v.credit).toFixed(2),
    });
  }
  return { asOf: isoDay(asOf), rows, totalDebit: totalDebit.toFixed(2), totalCredit: totalCredit.toFixed(2), balanced: totalDebit.eq(totalCredit), difference: totalDebit.sub(totalCredit).toFixed(2) };
}

export async function ledger(accountId: string, from: Date | null, to: Date | null) {
  const account = await prisma.accAccount.findUnique({ where: { id: accountId } });
  if (!account) throw HttpError.notFound('Account not found');
  const jWhere = { portfolioId: account.portfolioId, status: { in: EFFECTIVE } };
  let opening = ZERO;
  if (from) {
    const o = await prisma.accJournalLine.aggregate({ where: { accountId, journal: { ...jWhere, entryDate: { lt: from } } }, _sum: { debit: true, credit: true } });
    opening = naturalBalance(account.type, o._sum.debit ?? ZERO, o._sum.credit ?? ZERO);
  }
  const rows = await prisma.accJournalLine.findMany({
    where: { accountId, journal: { ...jWhere, entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } },
    include: { journal: true },
    orderBy: [{ journal: { entryDate: 'asc' } }, { journal: { createdAt: 'asc' } }, { lineNo: 'asc' }],
    take: 2000,
  });
  let running = opening;
  const lines = rows.map((l) => {
    running = running.add(isDebitNormal(account.type) ? l.debit.sub(l.credit) : l.credit.sub(l.debit));
    return { journalId: l.journalId, ref: l.journal.ref, entryDate: isoDay(l.journal.entryDate), description: l.journal.description, memo: l.memo, status: l.journal.status, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), balance: running.toFixed(2) };
  });
  return {
    account: { id: account.id, portfolioId: account.portfolioId, code: account.code, name: account.name, type: account.type },
    from: isoDay(from),
    to: isoDay(to),
    openingBalance: opening.toFixed(2),
    closingBalance: running.toFixed(2),
    lines,
  };
}

// ---------------------------------------------------------------- close checklist

export interface ChecklistItem {
  key: 'UNPOSTED_JOURNALS' | 'RECON_BREAKS' | 'NAV_RELEASED' | 'TRIAL_BALANCE';
  label: string;
  ok: boolean;
  /** Human-readable reasons the item blocks the close; empty when ok. */
  blockers: string[];
  detail: string;
}

export async function closeChecklist(p: PeriodRow) {
  const [unposted, breaks, nav, tb] = await Promise.all([
    prisma.accJournal.findMany({ where: { portfolioId: p.portfolioId, status: { in: UNPOSTED }, entryDate: { gte: p.periodStart, lte: p.periodEnd } }, orderBy: { ref: 'asc' }, select: { ref: true, status: true } }),
    prisma.reconBreak.findMany({ where: { portfolioId: p.portfolioId, status: { notIn: ['MATCHED', 'CLOSED'] }, run: { asOfDate: { lte: p.periodEnd } } }, orderBy: { ref: 'asc' }, select: { ref: true, status: true } }),
    prisma.navRun.findFirst({ where: { portfolioId: p.portfolioId, navDate: p.periodEnd, status: 'RELEASED' }, select: { ref: true, version: true } }),
    trialBalance(p.portfolioId, p.periodEnd),
  ]);
  const items: ChecklistItem[] = [
    {
      key: 'UNPOSTED_JOURNALS',
      label: 'All journals in the period are posted',
      ok: unposted.length === 0,
      blockers: unposted.map((j) => `Journal ${j.ref} is ${j.status === 'DRAFT' ? 'a draft' : 'awaiting approval'}; post or discard it`),
      detail: unposted.length ? `${unposted.length} unposted journal${unposted.length === 1 ? '' : 's'}` : 'No draft or pending journals',
    },
    {
      key: 'RECON_BREAKS',
      label: 'No open reconciliation breaks',
      ok: breaks.length === 0,
      blockers: breaks.map((b) => `Reconciliation break ${b.ref} is still ${b.status.toLowerCase().replace(/_/g, ' ')}`),
      detail: breaks.length ? `${breaks.length} open break${breaks.length === 1 ? '' : 's'}` : 'No open breaks for this entity',
    },
    {
      key: 'NAV_RELEASED',
      label: `NAV released for ${isoDay(p.periodEnd)}`,
      ok: !!nav,
      blockers: nav ? [] : [`No released NAV run for ${isoDay(p.periodEnd)}; release the period-end NAV first`],
      detail: nav ? `${nav.ref} version ${nav.version} released` : 'No released NAV run at the period-end date',
    },
    {
      key: 'TRIAL_BALANCE',
      label: 'Trial balance is in balance',
      ok: tb.balanced,
      blockers: tb.balanced ? [] : [`Trial balance is out by ${new D(tb.difference).abs().toFixed(2)} (debits ${tb.totalDebit}, credits ${tb.totalCredit})`],
      detail: `Debits ${tb.totalDebit}, credits ${tb.totalCredit}`,
    },
  ];
  const blockers = items.flatMap((i) => i.blockers);
  return { items, blockers, canClose: blockers.length === 0, trialBalance: { totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, balanced: tb.balanced } };
}

// ---------------------------------------------------------------- views

async function portfolioMap(ids: string[]) {
  const rows = ids.length ? await prisma.portfolio.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, ref: true, name: true } }) : [];
  return new Map(rows.map((p) => [p.id, p]));
}

export async function journalViews(rows: JournalRow[]) {
  const [users, pf] = await Promise.all([names(rows.flatMap((r) => [r.makerId, r.postedBy])), portfolioMap(rows.map((r) => r.portfolioId))]);
  const linkIds = rows.flatMap((r) => [r.reversalOfId, r.reversedById]).filter((x): x is string => !!x);
  const links = linkIds.length ? await prisma.accJournal.findMany({ where: { id: { in: linkIds } }, select: { id: true, ref: true } }) : [];
  const ref = new Map(links.map((l) => [l.id, l.ref]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    portfolioId: r.portfolioId,
    portfolioRef: pf.get(r.portfolioId)?.ref ?? null,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    entryDate: isoDay(r.entryDate),
    description: r.description,
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
    reversalOfId: r.reversalOfId,
    reversalOfRef: r.reversalOfId ? (ref.get(r.reversalOfId) ?? null) : null,
    reversedById: r.reversedById,
    reversedByRef: r.reversedById ? (ref.get(r.reversedById) ?? null) : null,
    reversedAt: iso(r.reversedAt),
    reverseReason: r.reverseReason,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  }));
}

export async function loadJournal(id: string): Promise<JournalRow> {
  const r = await prisma.accJournal.findFirst({ where: { OR: [{ id }, { ref: id.toUpperCase() }] } });
  if (!r) throw HttpError.notFound('Journal not found');
  return r;
}

export async function journalDetail(r: JournalRow, user: { id: string; permissions: string[] }) {
  const [view] = await journalViews([r]);
  const [lines, events, period] = await Promise.all([
    prisma.accJournalLine.findMany({ where: { journalId: r.id }, include: { account: true }, orderBy: { lineNo: 'asc' } }),
    prisma.auditEvent.findMany({ where: { objectType: 'acc_journal', objectId: r.id }, orderBy: { id: 'asc' }, take: 100 }),
    periodFor(r.portfolioId, r.entryDate),
  ]);
  const users = await names(events.map((e) => e.actorId));
  const can = (p: string) => user.permissions.includes(p);
  const isMaker = r.makerId === user.id;
  const closed = period?.status === 'CLOSED';
  const postBlocker =
    r.status !== 'PENDING_APPROVAL' ? `Journal is ${r.status}` : !can('accounting.post') ? 'Requires accounting.post' : isMaker ? 'The journal creator cannot post it (maker-checker)' : closed ? 'The period is closed' : null;
  return {
    ...view,
    periodId: period?.id ?? null,
    periodStatus: period?.status ?? null,
    lines: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, accountId: l.accountId, accountCode: l.account.code, accountName: l.account.name, accountType: l.account.type, debit: f2(l.debit)!, credit: f2(l.credit)!, memo: l.memo })),
    timeline: events.map((e) => ({ at: e.occurredAt.toISOString(), action: e.action, actor: (e.actorId && users.get(e.actorId)) || 'System', reason: e.reason ?? null })),
    allowed: {
      edit: r.status === 'DRAFT' && isMaker && !closed,
      submit: r.status === 'DRAFT' && isMaker && !closed,
      discard: (r.status === 'DRAFT' && isMaker) || (r.status === 'PENDING_APPROVAL' && (isMaker || can('accounting.post'))),
      returnToMaker: r.status === 'PENDING_APPROVAL' && can('accounting.post') && !isMaker,
      post: postBlocker === null,
      postBlocker,
      reverse: r.status === 'POSTED' && can('accounting.post'),
    },
  };
}

export async function periodViews(rows: PeriodRow[]) {
  const [users, pf] = await Promise.all([names(rows.flatMap((r) => [r.closedBy, r.reopenedBy, r.closingBy])), portfolioMap(rows.map((r) => r.portfolioId))]);
  const unposted = await Promise.all(rows.map((r) => prisma.accJournal.count({ where: { portfolioId: r.portfolioId, status: { in: UNPOSTED }, entryDate: { gte: r.periodStart, lte: r.periodEnd } } })));
  return rows.map((r, i) => ({
    id: r.id,
    portfolioId: r.portfolioId,
    portfolioRef: pf.get(r.portfolioId)?.ref ?? null,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    periodStart: isoDay(r.periodStart),
    periodEnd: isoDay(r.periodEnd),
    month: r.periodEnd.toISOString().slice(0, 7),
    status: r.status,
    unpostedJournals: unposted[i] ?? 0,
    closingByName: r.closingBy ? (users.get(r.closingBy) ?? null) : null,
    closingAt: iso(r.closingAt),
    closedByName: r.closedBy ? (users.get(r.closedBy) ?? null) : null,
    closedAt: iso(r.closedAt),
    reopenedByName: r.reopenedBy ? (users.get(r.reopenedBy) ?? null) : null,
    reopenedAt: iso(r.reopenedAt),
    reopenReason: r.reopenReason,
    closeSnapshot: r.closeSnapshot ?? null,
  }));
}

export async function loadPeriod(id: string): Promise<PeriodRow> {
  const r = await prisma.accPeriod.findUnique({ where: { id } });
  if (!r) throw HttpError.notFound('Accounting period not found');
  return r;
}
