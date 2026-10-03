import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAnyPermission, requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { loadPortfolio } from '../portfolio/portfolio.service';
import {
  EXPECTATION_KINDS,
  invertLines,
  JOURNAL_PURPOSES,
  LEDGER_KINDS,
  LIVE_RESERVATION,
  lineFingerprint,
  matchLines,
  MATCH_WINDOW_DAYS,
  parseStatement,
  RESERVATION_PURPOSES,
  sha256,
  signed,
  statementVariance,
  totals,
  validateLines,
  EFFECTIVE,
} from './cash.engine';
import {
  assertCashPeriodOpen,
  balances,
  closePrecheck,
  closeViews,
  expectationViews,
  explainLedger,
  importDetail,
  importViews,
  isoDay,
  journalDetail,
  journalViews,
  ledgerAvailability,
  ledgerViews,
  loadClose,
  loadImport,
  loadJournal,
  loadLedger,
  reservationViews,
  startOfDay,
  type JournalRow,
} from './cash.service';
import { restoreReservationOnReverse } from './cash.orders';
import { requireFeature } from '../../middleware/feature';

/**
 * Cash & Ledgers (SRD 5.A.15 `cash`; FR-CASH-001..008). Admin-portal staff only. Mounted at `/api/v1/cash`.
 * Balances are derived from posted journal lines, never stored. `cash.journal.create` prepares (journals, expectations,
 * consuming a reservation); `cash.reservation` (or create) holds cash; `cash.journal.approve` is the checker (post,
 * return, reject, reverse with step-up MFA; commit a statement import; release others' reservations; approve a close);
 * `cash.import` stages statements; `cash.close` prepares, closes and reopens a period (step-up on close and reopen).
 * Posted journals are immutable; a reversal is a new posted journal with the sides swapped.
 */
export const cashRoutes = Router();

const D = Prisma.Decimal;
const ZERO = new D(0);
const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('cash.view')];
const canCreate = [...staff, requirePermission('cash.view'), requirePermission('cash.journal.create')];
const canHold = [...staff, requirePermission('cash.view'), requireAnyPermission('cash.reservation', 'cash.journal.create')];
const canApprove = [...staff, requirePermission('cash.view'), requirePermission('cash.journal.approve')];
const canImport = [...staff, requirePermission('cash.view'), requirePermission('cash.import')];
const canClose = [...staff, requirePermission('cash.view'), requirePermission('cash.close')];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => startOfDay(new Date());
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const amount = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Enter a non-negative amount (up to 4 decimals)')
  .transform((v) => new D(v));
const signedAmount = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v), 'Enter a number (up to 4 decimals)')
  .transform((v) => new D(v));
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
const ccy = z.string().trim().length(3).transform((v) => v.toUpperCase());

async function resolvePortfolioId(v: string): Promise<string> {
  return (await loadPortfolio(v).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  })).id;
}
async function portfolioFilter(v?: string) {
  if (!v) return undefined;
  return UUID.test(v) ? v : ((await prisma.portfolio.findUnique({ where: { ref: v }, select: { id: true } }))?.id ?? '0');
}
const sod = (msg: string) => HttpError.forbidden(msg, 'sod_violation');
const statusIn = (s?: string) => (s ? { in: s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) } : undefined);

// ================================================================ ledgers

const ledgerBody = z
  .object({
    portfolioId: z.string().trim().min(1).max(36),
    name: z.string().trim().min(2).max(160),
    currency: ccy,
    kind: z.enum(LEDGER_KINDS),
    cashAccountId: z.string().trim().max(36).nullable().optional(),
    minBuffer: amount.optional(),
    tolerance: amount.optional(),
  })
  .strict();
const ledgerPatch = z
  .object({ name: z.string().trim().min(2).max(160), minBuffer: amount, tolerance: amount, status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']) })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
const ledgersQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), kind: z.enum(LEDGER_KINDS).optional(), status: z.string().trim().max(60).optional() });

cashRoutes.get('/ledgers', ...canView, validateQuery(ledgersQuery), async (req, res) => {
  const f = query<z.infer<typeof ledgersQuery>>(req);
  const pid = await portfolioFilter(f.portfolioId);
  const rows = await prisma.cashLedger.findMany({ where: { ...(pid ? { portfolioId: pid } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.status ? { status: statusIn(f.status) } : {}) }, orderBy: [{ portfolioId: 'asc' }, { ref: 'asc' }], take: 500 });
  res.json({ data: await ledgerViews(rows), total: rows.length });
});

async function createLedger(tx: Prisma.TransactionClient, req: Request, b: { portfolioId: string; name: string; currency: string; kind: string; cashAccountId?: string | null; minBuffer?: Prisma.Decimal; tolerance?: Prisma.Decimal }) {
  const ref = await nextRef(tx, 'cashLedger');
  const row = await tx.cashLedger.create({
    data: { ref, portfolioId: b.portfolioId, name: b.name, currency: b.currency, kind: b.kind, cashAccountId: b.cashAccountId ?? null, minBuffer: b.minBuffer ?? ZERO, tolerance: b.tolerance ?? ZERO, createdBy: req.user!.id },
  });
  await writeAudit(tx, audit(req), { action: 'cash.ledger_created', objectType: 'cash_ledger', objectId: row.id, after: { ref, portfolioId: b.portfolioId, name: b.name, currency: b.currency, kind: b.kind } });
  return row;
}

cashRoutes.post('/ledgers', ...canApprove, validateBody(ledgerBody), idempotent('cash.ledger_create'), async (req, res) => {
  const b = req.body as z.infer<typeof ledgerBody>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  if (b.cashAccountId) {
    const acc = await prisma.cashAccount.findUnique({ where: { id: b.cashAccountId }, select: { currency: true } });
    if (!acc) throw HttpError.badRequest('Validation failed', [{ path: 'cashAccountId', message: 'Unknown cash account' }]);
    if (acc.currency !== b.currency) throw HttpError.badRequest('Validation failed', [{ path: 'currency', message: `The cash account is in ${acc.currency}` }]);
  }
  if (await prisma.cashLedger.findFirst({ where: { portfolioId, name: b.name, currency: b.currency }, select: { id: true } })) throw HttpError.conflict(`A ${b.currency} ledger named "${b.name}" already exists for this portfolio`, 'duplicate_ledger');
  const row = await prisma.$transaction((tx) => createLedger(tx, req, { ...b, portfolioId }));
  res.status(201).json({ data: (await ledgerViews([row]))[0] });
});

/** Adds the standard cash ledger set (bank, client control, clearing, suspense, fees) for a portfolio and currency; existing names are left alone. */
const defaultSet = z.object({ portfolioId: z.string().trim().min(1).max(36), currency: ccy.optional() }).strict();
export const DEFAULT_LEDGERS = [
  { name: 'Operating bank account', kind: 'BANK' },
  { name: 'Client cash control', kind: 'CONTROL' },
  { name: 'Settlement clearing', kind: 'CLEARING' },
  { name: 'Cash suspense', kind: 'SUSPENSE' },
  { name: 'Fees and charges', kind: 'EXPENSE' },
] as const;
cashRoutes.post('/ledgers/default-set', ...canApprove, validateBody(defaultSet), async (req, res) => {
  const b = req.body as z.infer<typeof defaultSet>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const currency = b.currency ?? (await prisma.portfolio.findUnique({ where: { id: portfolioId }, select: { baseCurrency: true } }))?.baseCurrency ?? 'USD';
  const have = new Set((await prisma.cashLedger.findMany({ where: { portfolioId, currency }, select: { name: true } })).map((l) => l.name));
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const l of DEFAULT_LEDGERS.filter((x) => !have.has(x.name))) out.push(await createLedger(tx, req, { portfolioId, currency, ...l }));
    return out;
  });
  res.status(201).json({ data: await ledgerViews(created), created: created.length, skipped: DEFAULT_LEDGERS.length - created.length });
});

cashRoutes.patch('/ledgers/:id', ...canApprove, validateBody(ledgerPatch), idempotent('cash.patch.ledgers_id', { required: false }), async (req, res) => {
  const l = await loadLedger(param(req, 'id'));
  const b = req.body as z.infer<typeof ledgerPatch>;
  if (b.status === 'CLOSED') {
    const posted = await ledgerAvailability(l);
    const live = await prisma.cashReservation.count({ where: { ledgerId: l.id, status: { in: LIVE_RESERVATION } } });
    const blockers = [...(posted.posted.isZero() ? [] : [`Posted balance ${posted.posted.toFixed(2)}`]), ...(live ? [`${live} active reservation${live === 1 ? '' : 's'}`] : [])];
    if (blockers.length) throw new HttpError(409, 'close_blocked', `The ledger cannot be closed: ${blockers.join('; ')}`, { blockers });
  }
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.cashLedger.update({ where: { id: l.id }, data: b });
    await writeAudit(tx, audit(req), { action: 'cash.ledger_updated', objectType: 'cash_ledger', objectId: l.id, before: { name: l.name, status: l.status, minBuffer: l.minBuffer.toFixed(2), tolerance: l.tolerance.toFixed(2) }, after: { name: u.name, status: u.status, minBuffer: u.minBuffer.toFixed(2), tolerance: u.tolerance.toFixed(2) } });
    return u;
  });
  res.json({ data: (await ledgerViews([row]))[0] });
});

// ================================================================ balances

const balQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), currency: ccy.optional(), asOf: dateStr.optional() });
cashRoutes.get('/balances', ...canView, validateQuery(balQuery), async (req, res) => {
  const f = query<z.infer<typeof balQuery>>(req);
  res.json({ data: await balances({ portfolioId: await portfolioFilter(f.portfolioId), currency: f.currency, asOf: f.asOf ? toDate(f.asOf) : today() }) });
});

const explainQuery = z.object({ ledgerId: z.string().trim().min(1).max(36), asOf: dateStr.optional() });
cashRoutes.get('/balances/explain', ...canView, validateQuery(explainQuery), async (req, res) => {
  const f = query<z.infer<typeof explainQuery>>(req);
  res.json({ data: await explainLedger(await loadLedger(f.ledgerId), f.asOf ? toDate(f.asOf) : today()) });
});

// ================================================================ journals

const lineSchema = z.object({ ledgerId: z.string().trim().min(1).max(36), debit: amount.optional(), credit: amount.optional(), memo: z.string().trim().max(255).nullable().optional() }).strict();
const journalBody = {
  entryDate: dateStr,
  description: z.string().trim().min(3, 'Describe the journal (3+ characters)').max(500),
  purpose: z.enum(JOURNAL_PURPOSES).default('MANUAL_CORRECTION'),
  sourceRef: z.string().trim().max(80).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  expectationId: z.string().trim().max(36).nullable().optional(),
  reservationId: z.string().trim().max(36).nullable().optional(),
  lines: z.array(lineSchema).min(2).max(100),
};
const createJournal = z.object({ portfolioId: z.string().trim().min(1).max(36), ...journalBody }).strict();
const patchJournal = z.object(journalBody).strict();
const reverseSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500), entryDate: dateStr.optional() }).strict();
const listQuery = z.object({
  portfolioId: z.string().trim().max(36).optional(),
  ledgerId: z.string().trim().max(36).optional(),
  status: z.string().trim().max(120).optional(),
  purpose: z.string().trim().max(120).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type LineBody = z.infer<typeof lineSchema>;
const lineRows = (lines: LineBody[]) => lines.map((l, i) => ({ lineNo: i + 1, ledgerId: l.ledgerId, debit: l.debit ?? ZERO, credit: l.credit ?? ZERO, memo: l.memo ?? null }));

/** Balance, positive amounts, one currency, and every ledger active and in this portfolio. Also checks the optional expectation and reservation links. */
async function checkJournal(portfolioId: string, b: { lines: LineBody[]; expectationId?: string | null; reservationId?: string | null }, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const errors = validateLines(b.lines.map((l) => ({ ledgerId: l.ledgerId, debit: l.debit, credit: l.credit })));
  const ledgers = await db.cashLedger.findMany({ where: { id: { in: [...new Set(b.lines.map((l) => l.ledgerId))] } } });
  const byId = new Map(ledgers.map((a) => [a.id, a]));
  b.lines.forEach((l, i) => {
    const a = byId.get(l.ledgerId);
    if (!a || a.portfolioId !== portfolioId) errors.push({ path: `lines[${i}].ledgerId`, message: 'Unknown ledger for this portfolio' });
    else if (a.status !== 'ACTIVE') errors.push({ path: `lines[${i}].ledgerId`, message: `Ledger ${a.ref} is ${a.status.toLowerCase()}; manual postings are blocked` });
  });
  const currencies = new Set(ledgers.map((l) => l.currency));
  if (currencies.size > 1) errors.push({ path: 'lines', message: `A journal is in one currency; these lines mix ${[...currencies].join(', ')}` });
  if (b.expectationId) {
    const e = await db.cashExpectation.findUnique({ where: { id: b.expectationId } });
    if (!e || e.portfolioId !== portfolioId) errors.push({ path: 'expectationId', message: 'Unknown expectation for this portfolio' });
    else if (!['EXPECTED'].includes(e.status)) errors.push({ path: 'expectationId', message: `Expectation ${e.ref} is ${e.status}` });
  }
  if (b.reservationId) {
    const r = await db.cashReservation.findUnique({ where: { id: b.reservationId } });
    if (!r || r.portfolioId !== portfolioId) errors.push({ path: 'reservationId', message: 'Unknown reservation for this portfolio' });
    else if (!LIVE_RESERVATION.includes(r.status)) errors.push({ path: 'reservationId', message: `Reservation ${r.ref} is ${r.status}` });
  }
  if (errors.length) throw HttpError.badRequest('Validation failed', errors);
  return { currency: [...currencies][0] ?? 'USD' };
}

async function respond(res: Response, req: Request, id: string, status = 200) {
  res.status(status).json({ data: await journalDetail(await loadJournal(id), req.user!) });
}
function assertMaker(r: JournalRow, req: Request) {
  if (r.makerId !== req.user!.id) throw HttpError.forbidden('Only the person who created this journal can change or submit it', 'not_maker');
}

cashRoutes.get('/journals', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const where: Prisma.CashJournalWhereInput = {};
  const pid = await portfolioFilter(f.portfolioId);
  if (pid) where.portfolioId = pid;
  if (f.ledgerId) where.lines = { some: { ledgerId: f.ledgerId } };
  if (f.status) where.status = statusIn(f.status);
  if (f.purpose) where.purpose = statusIn(f.purpose);
  if (f.from || f.to) where.entryDate = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  if (f.q) where.OR = [{ ref: { contains: f.q.toUpperCase() } }, { description: { contains: f.q } }, { sourceRef: { contains: f.q } }];
  const [total, rows, grouped] = await Promise.all([
    prisma.cashJournal.count({ where }),
    prisma.cashJournal.findMany({ where, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.cashJournal.groupBy({ by: ['status'], where: pid ? { portfolioId: pid } : {}, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  res.json({ data: await journalViews(rows), total, summary: { byStatus, drafts: byStatus.DRAFT ?? 0, pendingApproval: byStatus.PENDING_APPROVAL ?? 0, posted: byStatus.POSTED ?? 0 } });
});

cashRoutes.get('/journals/:id', ...canView, async (req, res) => {
  await respond(res, req, param(req, 'id'));
});

cashRoutes.post('/journals', ...canCreate, validateBody(createJournal), idempotent('cash.journal_create'), async (req, res) => {
  const b = req.body as z.infer<typeof createJournal>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const entryDate = toDate(b.entryDate);
  await assertCashPeriodOpen(portfolioId, entryDate);
  const { currency } = await checkJournal(portfolioId, b);
  const t = totals(b.lines);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'cashJournal');
    const j = await tx.cashJournal.create({
      data: {
        ref,
        portfolioId,
        entryDate,
        description: b.description,
        purpose: b.purpose,
        sourceRef: b.sourceRef ?? null,
        evidenceRef: b.evidenceRef ?? null,
        expectationId: b.expectationId ?? null,
        reservationId: b.reservationId ?? null,
        currency,
        totalDebit: t.debit,
        totalCredit: t.credit,
        makerId: req.user!.id,
        lines: { create: lineRows(b.lines) },
      },
    });
    await writeAudit(tx, audit(req), { action: 'cash.journal_created', objectType: 'cash_journal', objectId: j.id, after: { ref, portfolioId, purpose: b.purpose, entryDate: b.entryDate, totalDebit: t.debit.toFixed(2), lines: b.lines.length } });
    return j;
  });
  await respond(res, req, row.id, 201);
});

cashRoutes.patch('/journals/:id', ...canCreate, validateBody(patchJournal), idempotent('cash.patch.journals_id', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'DRAFT') throw new HttpError(409, 'journal_immutable', `${r.ref} is ${r.status}; only a DRAFT can be edited. Posted journals are corrected by reversal.`);
  assertMaker(r, req);
  const b = req.body as z.infer<typeof patchJournal>;
  const entryDate = toDate(b.entryDate);
  await assertCashPeriodOpen(r.portfolioId, entryDate);
  const { currency } = await checkJournal(r.portfolioId, b);
  const t = totals(b.lines);
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (
        await tx.cashJournal.updateMany({
          where: { id: r.id, status: 'DRAFT', version: r.version },
          data: { entryDate, description: b.description, purpose: b.purpose, sourceRef: b.sourceRef ?? null, evidenceRef: b.evidenceRef ?? null, expectationId: b.expectationId ?? null, reservationId: b.reservationId ?? null, currency, totalDebit: t.debit, totalCredit: t.credit, version: { increment: 1 } },
        })
      ).count,
    );
    await tx.cashJournalLine.deleteMany({ where: { journalId: r.id } });
    await tx.cashJournalLine.createMany({ data: lineRows(b.lines).map((l) => ({ ...l, journalId: r.id })) });
    await writeAudit(tx, audit(req), { action: 'cash.journal_updated', objectType: 'cash_journal', objectId: r.id, before: { entryDate: isoDay(r.entryDate), totalDebit: r.totalDebit.toFixed(2) }, after: { entryDate: b.entryDate, totalDebit: t.debit.toFixed(2), lines: b.lines.length } });
  });
  await respond(res, req, r.id);
});

cashRoutes.post('/journals/:id/submit', ...canCreate, idempotent('cash.journal_submit', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'DRAFT') throw HttpError.conflict(`${r.ref} is ${r.status}; only a DRAFT can be submitted`, 'invalid_state');
  assertMaker(r, req);
  await assertCashPeriodOpen(r.portfolioId, r.entryDate);
  const lines = await prisma.cashJournalLine.findMany({ where: { journalId: r.id } });
  const errors = validateLines(lines);
  if (errors.length) throw HttpError.badRequest('Journal is not balanced', errors);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashJournal.updateMany({ where: { id: r.id, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.journal_submitted', objectType: 'cash_journal', objectId: r.id, before: { status: 'DRAFT' }, after: { status: 'PENDING_APPROVAL', totalDebit: r.totalDebit.toFixed(2) } });
    await notifyPermission(tx, 'cash.journal.approve', { type: 'cash.journal_pending', title: `Cash journal ${r.ref} awaits approval`, body: `${isoDay(r.entryDate)} ${r.description}`, link: `/ops/cash?journal=${r.id}` });
  });
  await respond(res, req, r.id);
});

cashRoutes.post('/journals/:id/return', ...canApprove, validateBody(reasonSchema), idempotent('cash.post.journals_id_return', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`${r.ref} is ${r.status}; only a pending journal can be returned`, 'invalid_state');
  if (r.makerId === req.user!.id) throw sod('Return a journal you did not create, or discard your own');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashJournal.updateMany({ where: { id: r.id, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT', submittedAt: null } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.journal_returned', objectType: 'cash_journal', objectId: r.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'DRAFT' }, reason });
  });
  await respond(res, req, r.id);
});

/** FR-CASH-012: rejection needs a reason; the journal becomes read-only and shows it. */
cashRoutes.post('/journals/:id/reject', ...canApprove, validateBody(reasonSchema), idempotent('cash.post.journals_id_reject', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`${r.ref} is ${r.status}; only a pending journal can be rejected`, 'invalid_state');
  if (r.makerId === req.user!.id) throw sod('You cannot reject a journal you created; discard it instead');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashJournal.updateMany({ where: { id: r.id, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED', rejectReason: reason } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.journal_rejected', objectType: 'cash_journal', objectId: r.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'REJECTED' }, reason });
  });
  await respond(res, req, r.id);
});

cashRoutes.post('/journals/:id/discard', ...canView, validateBody(reasonSchema), idempotent('cash.post.journals_id_discard', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(r.status)) throw new HttpError(409, 'journal_immutable', `${r.ref} is ${r.status} and cannot be discarded. Posted journals are corrected by reversal.`);
  const canDiscard = r.makerId === req.user!.id || (r.status === 'PENDING_APPROVAL' && req.user!.permissions.includes('cash.journal.approve'));
  if (!canDiscard) throw HttpError.forbidden('Only the creator (or an approver, once submitted) can discard this journal', 'forbidden');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashJournal.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'DISCARDED' } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.journal_discarded', objectType: 'cash_journal', objectId: r.id, before: { status: r.status }, after: { status: 'DISCARDED' }, reason });
  });
  await respond(res, req, r.id);
});

cashRoutes.post('/journals/:id/post', ...canApprove, requireStepUp, idempotent('cash.journal_post', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`${r.ref} is ${r.status}; it must be PENDING_APPROVAL to post`, 'invalid_state');
  if (r.makerId === req.user!.id) throw sod('The journal creator cannot post the same journal (maker-checker)');
  const lines = await prisma.cashJournalLine.findMany({ where: { journalId: r.id }, include: { ledger: true } });
  const errors = validateLines(lines);
  lines.forEach((l, i) => {
    if (l.ledger.status !== 'ACTIVE') errors.push({ path: `lines[${i}].ledgerId`, message: `Ledger ${l.ledger.ref} is ${l.ledger.status.toLowerCase()}` });
  });
  if (errors.length) throw HttpError.badRequest('Journal cannot be posted', errors);
  await prisma.$transaction(async (tx) => {
    await assertCashPeriodOpen(r.portfolioId, r.entryDate, tx);
    assertUpdated((await tx.cashJournal.updateMany({ where: { id: r.id, status: 'PENDING_APPROVAL' }, data: { status: 'POSTED', postedBy: req.user!.id, postedAt: new Date() } })).count);
    if (r.reservationId) {
      const rsv = await tx.cashReservation.findUnique({ where: { id: r.reservationId } });
      if (rsv && LIVE_RESERVATION.includes(rsv.status)) {
        const paid = lines.filter((l) => l.ledgerId === rsv.ledgerId).reduce((s, l) => s.add(l.credit), ZERO);
        const remaining = rsv.amount.sub(rsv.consumed);
        const use = paid.lt(remaining) ? paid : remaining;
        if (use.gt(0)) {
          const consumed = rsv.consumed.add(use);
          await tx.cashReservation.update({ where: { id: rsv.id }, data: { consumed, status: consumed.gte(rsv.amount) ? 'CONSUMED' : 'PARTIALLY_CONSUMED', version: { increment: 1 } } });
          await writeAudit(tx, audit(req), { action: 'cash.reservation_consumed', objectType: 'cash_reservation', objectId: rsv.id, after: { journal: r.ref, consumed: use.toFixed(2), remaining: rsv.amount.sub(consumed).toFixed(2) } });
        }
      }
    }
    if (r.expectationId) {
      const n = await tx.cashExpectation.updateMany({ where: { id: r.expectationId, status: 'EXPECTED' }, data: { status: 'POSTED', journalId: r.id } });
      if (n.count) await writeAudit(tx, audit(req), { action: 'cash.expectation_posted', objectType: 'cash_expectation', objectId: r.expectationId, after: { status: 'POSTED', journal: r.ref } });
    }
    await writeAudit(tx, audit(req), {
      action: 'cash.journal_posted',
      objectType: 'cash_journal',
      objectId: r.id,
      before: { status: 'PENDING_APPROVAL' },
      after: { status: 'POSTED', ref: r.ref, entryDate: isoDay(r.entryDate), totalDebit: r.totalDebit.toFixed(2), totalCredit: r.totalCredit.toFixed(2), makerId: r.makerId, postedBy: req.user!.id },
    });
  });
  await respond(res, req, r.id);
});

/** Creates the exact inverse journal, posted at once, and marks the original REVERSED. One reversal per journal. */
cashRoutes.post('/journals/:id/reverse', ...canApprove, requireStepUp, validateBody(reverseSchema), idempotent('cash.journal_reverse', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status === 'REVERSED') throw HttpError.conflict(`${r.ref} is already reversed`, 'already_reversed');
  if (r.status !== 'POSTED') throw HttpError.conflict(`${r.ref} is ${r.status}; only a POSTED journal can be reversed`, 'invalid_state');
  if (r.reversalOfId) throw HttpError.conflict(`${r.ref} is itself a reversal and cannot be reversed again; post a new journal instead`, 'invalid_state');
  const b = req.body as z.infer<typeof reverseSchema>;
  const entryDate = b.entryDate ? toDate(b.entryDate) : today().getTime() < r.entryDate.getTime() ? r.entryDate : today();
  if (entryDate.getTime() < r.entryDate.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'entryDate', message: 'The reversal cannot be dated before the original journal' }]);
  const lines = await prisma.cashJournalLine.findMany({ where: { journalId: r.id }, orderBy: { lineNo: 'asc' } });
  const rev = await prisma.$transaction(async (tx) => {
    await assertCashPeriodOpen(r.portfolioId, entryDate, tx);
    assertUpdated((await tx.cashJournal.updateMany({ where: { id: r.id, status: 'POSTED' }, data: { status: 'REVERSED', reversedAt: new Date(), reverseReason: b.reason } })).count);
    const ref = await nextRef(tx, 'cashJournal');
    const now = new Date();
    const j = await tx.cashJournal.create({
      data: {
        ref,
        portfolioId: r.portfolioId,
        entryDate,
        description: `Reversal of ${r.ref}: ${b.reason}`.slice(0, 500),
        purpose: 'REVERSAL',
        sourceRef: r.sourceRef,
        currency: r.currency,
        status: 'POSTED',
        totalDebit: r.totalCredit,
        totalCredit: r.totalDebit,
        makerId: req.user!.id,
        submittedAt: now,
        postedBy: req.user!.id,
        postedAt: now,
        reversalOfId: r.id,
        lines: { create: invertLines(lines).map((l, i) => ({ lineNo: i + 1, ...l })) },
      },
    });
    await tx.cashJournal.update({ where: { id: r.id }, data: { reversedById: j.id } });
    // A settlement journal consumed its order's cash hold when it posted; reversing it puts that amount back on hold.
    await restoreReservationOnReverse(tx, audit(req), r, lines);
    await writeAudit(tx, audit(req), { action: 'cash.journal_reversed', objectType: 'cash_journal', objectId: r.id, before: { status: 'POSTED' }, after: { status: 'REVERSED', reversedBy: ref }, reason: b.reason });
    await writeAudit(tx, audit(req), { action: 'cash.journal_posted', objectType: 'cash_journal', objectId: j.id, after: { status: 'POSTED', ref, reversalOf: r.ref, entryDate: isoDay(entryDate), totalDebit: r.totalCredit.toFixed(2) }, reason: b.reason });
    return j;
  });
  res.status(201).json({ data: await journalDetail(await loadJournal(rev.id), req.user!) });
});

// ================================================================ reservations

const rsvBody = z
  .object({
    ledgerId: z.string().trim().min(1).max(36),
    source: z.string().trim().min(2).max(80),
    purpose: z.enum(RESERVATION_PURPOSES).default('BUY_SETTLEMENT'),
    amount,
    requiredDate: dateStr.optional(),
    expiresOn: dateStr.nullable().optional(),
    orderId: z.string().trim().max(36).nullable().optional(),
  })
  .strict();
const rsvQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), ledgerId: z.string().trim().max(36).optional(), status: z.string().trim().max(120).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

cashRoutes.get('/reservations', ...canView, validateQuery(rsvQuery), async (req, res) => {
  const f = query<z.infer<typeof rsvQuery>>(req);
  const pid = await portfolioFilter(f.portfolioId);
  const rows = await prisma.cashReservation.findMany({ where: { ...(pid ? { portfolioId: pid } : {}), ...(f.ledgerId ? { ledgerId: f.ledgerId } : {}), ...(f.status ? { status: statusIn(f.status) } : {}) }, orderBy: [{ createdAt: 'desc' }], take: f.limit });
  const live = rows.filter((r) => LIVE_RESERVATION.includes(r.status));
  res.json({ data: await reservationViews(rows), total: rows.length, summary: { active: live.length, remaining: live.reduce((s, r) => s.add(r.amount.sub(r.consumed)), ZERO).toFixed(2) } });
});

/** FR-CASH-014: the availability check and the insert run under a row lock on the ledger, so concurrent holds cannot overspend it. */
cashRoutes.post('/reservations', ...canHold, validateBody(rsvBody), idempotent('cash.reservation_create'), async (req, res) => {
  const b = req.body as z.infer<typeof rsvBody>;
  if (b.amount.lte(0)) throw HttpError.badRequest('Validation failed', [{ path: 'amount', message: 'Amount must be above zero' }]);
  const requiredDate = b.requiredDate ? toDate(b.requiredDate) : today();
  const expiresOn = b.expiresOn ? toDate(b.expiresOn) : null;
  if (expiresOn && expiresOn.getTime() < requiredDate.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'expiresOn', message: 'Expiry cannot be before the required date' }]);
  const ledgerId = (await loadLedger(b.ledgerId)).id;
  const row = await prisma.$transaction(async (tx) => {
    // The locking read is the first statement, so every later read in this transaction sees concurrent holds.
    await tx.$queryRaw`SELECT id FROM cash_ledgers WHERE id = ${ledgerId} FOR UPDATE`;
    const ledger = await loadLedger(ledgerId, tx);
    if (ledger.kind !== 'BANK') throw HttpError.badRequest('Validation failed', [{ path: 'ledgerId', message: 'Reservations hold cash on a bank ledger' }]);
    if (ledger.status !== 'ACTIVE') throw HttpError.conflict(`Ledger ${ledger.ref} is ${ledger.status.toLowerCase()}; new reservations are blocked`, 'ledger_not_active');
    if (b.orderId) {
      const o = await tx.order.findUnique({ where: { id: b.orderId }, select: { portfolioId: true } });
      if (!o || o.portfolioId !== ledger.portfolioId) throw HttpError.badRequest('Validation failed', [{ path: 'orderId', message: 'Unknown order for this portfolio' }]);
      if (await tx.cashReservation.count({ where: { orderId: b.orderId, status: { in: LIVE_RESERVATION } } })) throw HttpError.conflict('This order already holds a live reservation', 'duplicate_reservation');
    }
    const av = await ledgerAvailability(ledger, tx);
    if (b.amount.gt(av.available)) {
      throw new HttpError(409, 'insufficient_available_cash', `Requested ${b.amount.toFixed(2)} ${ledger.currency} exceeds available ${av.available.toFixed(2)} ${ledger.currency}`, { requested: b.amount.toFixed(2), available: av.available.toFixed(2), currency: ledger.currency });
    }
    const ref = await nextRef(tx, 'cashReservation');
    const r = await tx.cashReservation.create({ data: { ref, portfolioId: ledger.portfolioId, ledgerId: ledger.id, orderId: b.orderId ?? null, source: b.source, purpose: b.purpose, currency: ledger.currency, amount: b.amount, requiredDate, expiresOn, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'cash.reservation_created', objectType: 'cash_reservation', objectId: r.id, after: { ref, ledger: ledger.ref, source: b.source, purpose: b.purpose, amount: b.amount.toFixed(2), availableBefore: av.available.toFixed(2) } });
    return r;
  });
  res.status(201).json({ data: (await reservationViews([row]))[0] });
});

async function loadReservation(id: string) {
  const r = await prisma.cashReservation.findFirst({ where: { OR: [{ id }, { ref: id.toUpperCase() }] } });
  if (!r) throw HttpError.notFound('Reservation not found');
  return r;
}

/** Release never deletes: it zeroes the remaining hold. Releasing someone else's hold needs cash.journal.approve. */
cashRoutes.post('/reservations/:id/release', ...canHold, validateBody(reasonSchema), idempotent('cash.reservation_release', { required: false }), async (req, res) => {
  const r = await loadReservation(param(req, 'id'));
  if (!LIVE_RESERVATION.includes(r.status)) throw HttpError.conflict(`${r.ref} is ${r.status}; only a live reservation can be released`, 'invalid_state');
  if (r.createdBy !== req.user!.id && !req.user!.permissions.includes('cash.journal.approve')) throw sod('Only the creator, or an approver, can release this reservation');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  const row = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashReservation.updateMany({ where: { id: r.id, status: { in: LIVE_RESERVATION } }, data: { status: 'RELEASED', releasedBy: req.user!.id, releasedAt: new Date(), releaseReason: reason, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.reservation_released', objectType: 'cash_reservation', objectId: r.id, before: { status: r.status, remaining: r.amount.sub(r.consumed).toFixed(2) }, after: { status: 'RELEASED' }, reason });
    return tx.cashReservation.findUniqueOrThrow({ where: { id: r.id } });
  });
  res.json({ data: (await reservationViews([row]))[0] });
});

const consumeSchema = z.object({ amount, reason: z.string().trim().max(500).optional() }).strict();
cashRoutes.post('/reservations/:id/consume', ...canCreate, validateBody(consumeSchema), idempotent('cash.reservation_consume', { required: false }), async (req, res) => {
  const r = await loadReservation(param(req, 'id'));
  const b = req.body as z.infer<typeof consumeSchema>;
  const remaining = r.amount.sub(r.consumed);
  if (!LIVE_RESERVATION.includes(r.status)) throw HttpError.conflict(`${r.ref} is ${r.status}`, 'invalid_state');
  if (b.amount.lte(0) || b.amount.gt(remaining)) throw HttpError.badRequest('Validation failed', [{ path: 'amount', message: `Enter an amount above zero up to the remaining ${remaining.toFixed(2)}` }]);
  const consumed = r.consumed.add(b.amount);
  const row = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashReservation.updateMany({ where: { id: r.id, status: { in: LIVE_RESERVATION }, version: r.version }, data: { consumed, status: consumed.gte(r.amount) ? 'CONSUMED' : 'PARTIALLY_CONSUMED', version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.reservation_consumed', objectType: 'cash_reservation', objectId: r.id, after: { consumed: b.amount.toFixed(2), remaining: r.amount.sub(consumed).toFixed(2) }, reason: b.reason });
    return tx.cashReservation.findUniqueOrThrow({ where: { id: r.id } });
  });
  res.json({ data: (await reservationViews([row]))[0] });
});

/** Marks holds past their expiry date EXPIRED (they already stopped reducing availability the day they lapsed). */
cashRoutes.post('/reservations/expire-sweep', ...canApprove, async (req, res) => {
  const lapsed = await prisma.cashReservation.findMany({ where: { status: { in: LIVE_RESERVATION }, expiresOn: { lt: today() } } });
  let n = 0;
  for (const r of lapsed) {
    await prisma.$transaction(async (tx) => {
      const u = await tx.cashReservation.updateMany({ where: { id: r.id, status: { in: LIVE_RESERVATION } }, data: { status: 'EXPIRED', releasedAt: new Date(), releaseReason: 'Expired', version: { increment: 1 } } });
      if (u.count) {
        n++;
        await writeAudit(tx, audit(req), { action: 'cash.reservation_expired', objectType: 'cash_reservation', objectId: r.id, before: { status: r.status, remaining: r.amount.sub(r.consumed).toFixed(2) }, after: { status: 'EXPIRED' } });
      }
    });
  }
  res.json({ data: { expired: n } });
});

/** For the Orders module: release the live hold on an order when it is cancelled, rejected or filled. */
export async function releaseOrderReservations(tx: Prisma.TransactionClient, orderId: string, actorId: string, reason: string) {
  const rows = await tx.cashReservation.findMany({ where: { orderId, status: { in: LIVE_RESERVATION } } });
  for (const r of rows) {
    await tx.cashReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedBy: actorId, releasedAt: new Date(), releaseReason: reason, version: { increment: 1 } } });
  }
  return rows.length;
}

// ================================================================ expectations

const expBody = z
  .object({
    ledgerId: z.string().trim().min(1).max(36),
    direction: z.enum(['IN', 'OUT']),
    kind: z.enum(EXPECTATION_KINDS).default('OTHER'),
    source: z.string().trim().max(80).nullable().optional(),
    amount,
    expectedDate: dateStr,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const expQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), ledgerId: z.string().trim().max(36).optional(), status: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

cashRoutes.get('/expectations', ...canView, validateQuery(expQuery), async (req, res) => {
  const f = query<z.infer<typeof expQuery>>(req);
  const pid = await portfolioFilter(f.portfolioId);
  const t = today();
  const where: Prisma.CashExpectationWhereInput = { ...(pid ? { portfolioId: pid } : {}), ...(f.ledgerId ? { ledgerId: f.ledgerId } : {}) };
  const want = f.status?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (want?.length) {
    where.OR = want.map((s) => (s === 'DUE' ? { status: 'EXPECTED', expectedDate: { lte: t } } : s === 'EXPECTED' ? { status: 'EXPECTED', expectedDate: { gt: t } } : { status: s }));
  }
  const rows = await prisma.cashExpectation.findMany({ where, orderBy: [{ expectedDate: 'asc' }, { createdAt: 'asc' }], take: f.limit });
  const views = await expectationViews(rows);
  const open = views.filter((v) => v.status === 'EXPECTED' || v.status === 'DUE');
  res.json({ data: views, total: views.length, summary: { open: open.length, expectedNet: open.reduce((s, v) => s.add(new D(v.signedAmount)), ZERO).toFixed(2), due: views.filter((v) => v.status === 'DUE').length } });
});

cashRoutes.post('/expectations', ...canCreate, validateBody(expBody), idempotent('cash.expectation_create'), async (req, res) => {
  const b = req.body as z.infer<typeof expBody>;
  if (b.amount.lte(0)) throw HttpError.badRequest('Validation failed', [{ path: 'amount', message: 'Amount must be above zero' }]);
  const ledger = await loadLedger(b.ledgerId);
  if (ledger.kind !== 'BANK') throw HttpError.badRequest('Validation failed', [{ path: 'ledgerId', message: 'Expectations are forecast on a bank ledger' }]);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'cashExpectation');
    const e = await tx.cashExpectation.create({ data: { ref, portfolioId: ledger.portfolioId, ledgerId: ledger.id, direction: b.direction, kind: b.kind, source: b.source ?? null, currency: ledger.currency, amount: b.amount, expectedDate: toDate(b.expectedDate), note: b.note ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'cash.expectation_created', objectType: 'cash_expectation', objectId: e.id, after: { ref, ledger: ledger.ref, direction: b.direction, amount: b.amount.toFixed(2), expectedDate: b.expectedDate } });
    return e;
  });
  res.status(201).json({ data: (await expectationViews([row]))[0] });
});

cashRoutes.post('/expectations/:id/cancel', ...canCreate, validateBody(reasonSchema), idempotent('cash.post.expectations_id_cancel', { required: false }), async (req, res) => {
  const e = await prisma.cashExpectation.findFirst({ where: { OR: [{ id: param(req, 'id') }, { ref: param(req, 'id').toUpperCase() }] } });
  if (!e) throw HttpError.notFound('Expectation not found');
  if (e.status !== 'EXPECTED') throw HttpError.conflict(`${e.ref} is ${e.status}; only an open expectation can be cancelled`, 'invalid_state');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  const row = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashExpectation.updateMany({ where: { id: e.id, status: 'EXPECTED' }, data: { status: 'CANCELLED' } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.expectation_cancelled', objectType: 'cash_expectation', objectId: e.id, before: { status: 'EXPECTED' }, after: { status: 'CANCELLED' }, reason });
    return tx.cashExpectation.findUniqueOrThrow({ where: { id: e.id } });
  });
  res.json({ data: (await expectationViews([row]))[0] });
});

// ================================================================ statement imports

const importBody = z
  .object({
    ledgerId: z.string().trim().min(1).max(36),
    filename: z.string().trim().min(1).max(200),
    format: z.enum(['CSV', 'JSON']),
    content: z.string().min(2).max(900_000),
    openingBalance: signedAmount.optional(),
    closingBalance: signedAmount.optional(),
    statementFrom: dateStr.optional(),
    statementTo: dateStr.optional(),
  })
  .strict();
const importQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), ledgerId: z.string().trim().max(36).optional(), status: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

cashRoutes.get('/statement-imports', ...canView, validateQuery(importQuery), async (req, res) => {
  const f = query<z.infer<typeof importQuery>>(req);
  const pid = await portfolioFilter(f.portfolioId);
  const rows = await prisma.cashStatementImport.findMany({ where: { ...(pid ? { portfolioId: pid } : {}), ...(f.ledgerId ? { ledgerId: f.ledgerId } : {}), ...(f.status ? { status: statusIn(f.status) } : {}) }, orderBy: [{ createdAt: 'desc' }], take: f.limit });
  res.json({ data: await importViews(rows), total: rows.length });
});

cashRoutes.get('/statement-imports/:id', ...canView, async (req, res) => {
  res.json({ data: await importDetail(await loadImport(param(req, 'id')), req.user!) });
});

/** Parses and stages a CSV or JSON statement. Nothing touches the ledger: it must foot, be new, and then a different person commits it. */
cashRoutes.post('/statement-imports', ...canImport, requireFeature('feature.statement_import'), validateBody(importBody), idempotent('cash.import_stage'), async (req, res) => {
  const b = req.body as z.infer<typeof importBody>;
  const ledger = await loadLedger(b.ledgerId);
  if (ledger.kind !== 'BANK') throw HttpError.badRequest('Validation failed', [{ path: 'ledgerId', message: 'Statements are imported against a bank ledger' }]);
  if (ledger.status !== 'ACTIVE') throw HttpError.conflict(`Ledger ${ledger.ref} is ${ledger.status.toLowerCase()}; imports are blocked`, 'ledger_not_active');
  const parsed = parseStatement(b.format, b.content, { opening: b.openingBalance ?? null, closing: b.closingBalance ?? null });
  if (parsed.errors.length) throw HttpError.badRequest('The statement could not be read', parsed.errors.slice(0, 50));
  const opening = parsed.opening!;
  const closing = parsed.closing!;
  const variance = statementVariance(opening, closing, parsed.lines);
  if (variance.abs().gt(ledger.tolerance)) {
    throw new HttpError(400, 'statement_does_not_foot', `Opening ${opening.toFixed(2)} plus movements does not equal closing ${closing.toFixed(2)}: out by ${variance.toFixed(2)} (tolerance ${ledger.tolerance.toFixed(2)})`, { variance: variance.toFixed(2), tolerance: ledger.tolerance.toFixed(2) });
  }
  const dates = parsed.lines.map((l) => l.valueDate.getTime());
  const from = b.statementFrom ? toDate(b.statementFrom) : new Date(Math.min(...dates));
  const to = b.statementTo ? toDate(b.statementTo) : new Date(Math.max(...dates));
  if (from.getTime() > to.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'statementTo', message: 'The statement end is before its start' }]);
  if (parsed.lines.some((l) => l.valueDate < from || l.valueDate > to)) throw HttpError.badRequest('Validation failed', [{ path: 'statementFrom', message: 'Some lines fall outside the statement dates' }]);
  const fileHash = sha256(`${ledger.id}|${b.format}|${b.content}`);
  if (await prisma.cashStatementImport.findUnique({ where: { ledgerId_fileHash: { ledgerId: ledger.id, fileHash } }, select: { id: true } })) throw HttpError.conflict('This file was already imported for this ledger', 'duplicate_file');
  if (await prisma.cashStatementImport.findFirst({ where: { ledgerId: ledger.id, status: { in: ['STAGED', 'COMMITTED'] }, statementFrom: from, statementTo: to }, select: { id: true } })) {
    throw HttpError.conflict(`A statement for ${isoDay(from)} to ${isoDay(to)} already exists for this ledger`, 'duplicate_statement');
  }
  const prints = parsed.lines.map((l) => lineFingerprint(ledger.id, l));
  const dup = await prisma.cashStatementLine.findMany({ where: { ledgerId: ledger.id, fingerprint: { in: prints }, import: { status: { in: ['STAGED', 'COMMITTED'] } } }, select: { fingerprint: true } });
  if (dup.length) throw new HttpError(409, 'duplicate_lines', `${dup.length} line${dup.length === 1 ? '' : 's'} in this file already exist in an earlier statement for this ledger`, { duplicates: dup.length });
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'cashImport');
    const imp = await tx.cashStatementImport.create({
      data: {
        ref,
        ledgerId: ledger.id,
        portfolioId: ledger.portfolioId,
        filename: b.filename,
        fileHash,
        format: b.format,
        statementFrom: from,
        statementTo: to,
        openingBalance: opening,
        closingBalance: closing,
        lineCount: parsed.lines.length,
        variance,
        makerId: req.user!.id,
        lines: { create: parsed.lines.map((l, i) => ({ lineNo: i + 1, ledgerId: ledger.id, valueDate: l.valueDate, amount: l.amount, reference: l.reference, description: l.description, fingerprint: prints[i]! })) },
      },
    });
    await writeAudit(tx, audit(req), { action: 'cash.import_staged', objectType: 'cash_statement_import', objectId: imp.id, after: { ref, ledger: ledger.ref, filename: b.filename, lines: parsed.lines.length, opening: opening.toFixed(2), closing: closing.toFixed(2), from: isoDay(from), to: isoDay(to) } });
    await notifyPermission(tx, 'cash.journal.approve', { type: 'cash.import_staged', title: `Statement ${ref} awaits commit`, body: `${ledger.name} ${isoDay(from)} to ${isoDay(to)}`, link: `/ops/cash?import=${imp.id}` });
    return imp;
  });
  res.status(201).json({ data: await importDetail(row, req.user!) });
});

/** Checker commits the reviewed staging version (never the uploader); matching starts against posted journals. */
cashRoutes.post('/statement-imports/:id/commit', ...canApprove, requireStepUp, idempotent('cash.import_commit', { required: false }), async (req, res) => {
  const imp = await loadImport(param(req, 'id'));
  if (imp.status !== 'STAGED') throw HttpError.conflict(`${imp.ref} is ${imp.status}; only a staged import can be committed`, 'invalid_state');
  if (imp.makerId === req.user!.id) throw sod('The uploader cannot commit their own statement import (maker-checker)');
  const ledger = await loadLedger(imp.ledgerId);
  if (ledger.status !== 'ACTIVE') throw HttpError.conflict(`Ledger ${ledger.ref} is ${ledger.status.toLowerCase()}; commits are blocked`, 'ledger_not_active');
  const matched = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashStatementImport.updateMany({ where: { id: imp.id, status: 'STAGED' }, data: { status: 'COMMITTED', checkerId: req.user!.id, committedAt: new Date() } })).count);
    const lines = await tx.cashStatementLine.findMany({ where: { importId: imp.id, status: 'UNMATCHED' } });
    const win = MATCH_WINDOW_DAYS * 86_400_000;
    const jl = await tx.cashJournalLine.findMany({ where: { ledgerId: ledger.id, journal: { status: { in: EFFECTIVE }, entryDate: { gte: new Date(imp.statementFrom.getTime() - win), lte: new Date(imp.statementTo.getTime() + win) } } }, include: { journal: { select: { id: true, entryDate: true } } } });
    const taken = new Set((await tx.cashStatementLine.findMany({ where: { ledgerId: ledger.id, matchedJournalId: { not: null } }, select: { matchedJournalId: true } })).map((m) => m.matchedJournalId!));
    const perJournal = new Map<string, { journalId: string; date: Date; amount: Prisma.Decimal }>();
    for (const l of jl) {
      if (taken.has(l.journalId)) continue;
      const cur = perJournal.get(l.journalId) ?? { journalId: l.journalId, date: l.journal.entryDate, amount: ZERO };
      cur.amount = cur.amount.add(signed(l));
      perJournal.set(l.journalId, cur);
    }
    const pairs = matchLines(lines, [...perJournal.values()].filter((c) => !c.amount.isZero()));
    for (const p of pairs) await tx.cashStatementLine.update({ where: { id: p.lineId }, data: { status: 'MATCHED', matchedJournalId: p.journalId, matchedAt: new Date() } });
    await writeAudit(tx, audit(req), { action: 'cash.import_committed', objectType: 'cash_statement_import', objectId: imp.id, before: { status: 'STAGED' }, after: { status: 'COMMITTED', makerId: imp.makerId, checkerId: req.user!.id, lines: lines.length, autoMatched: pairs.length } });
    return pairs.length;
  });
  const out = await importDetail(await loadImport(imp.id), req.user!);
  res.json({ data: out, autoMatched: matched });
});

cashRoutes.post('/statement-imports/:id/reject', ...canImport, validateBody(reasonSchema), idempotent('cash.post.statement_imports_id_reject', { required: false }), async (req, res) => {
  const imp = await loadImport(param(req, 'id'));
  if (imp.status !== 'STAGED') throw HttpError.conflict(`${imp.ref} is ${imp.status}; only a staged import can be rejected`, 'invalid_state');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashStatementImport.updateMany({ where: { id: imp.id, status: 'STAGED' }, data: { status: 'REJECTED', rejectReason: reason, checkerId: req.user!.id } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.import_rejected', objectType: 'cash_statement_import', objectId: imp.id, before: { status: 'STAGED' }, after: { status: 'REJECTED' }, reason });
  });
  res.json({ data: await importDetail(await loadImport(imp.id), req.user!) });
});

const lineQuery = z.object({ ledgerId: z.string().trim().max(36).optional(), portfolioId: z.string().trim().max(36).optional(), status: z.string().trim().max(40).default('UNMATCHED'), limit: z.coerce.number().int().min(1).max(500).default(200) });
cashRoutes.get('/statement-lines', ...canView, validateQuery(lineQuery), async (req, res) => {
  const f = query<z.infer<typeof lineQuery>>(req);
  const pid = await portfolioFilter(f.portfolioId);
  const rows = await prisma.cashStatementLine.findMany({
    where: { ...(f.ledgerId ? { ledgerId: f.ledgerId } : {}), status: statusIn(f.status), import: { status: 'COMMITTED', ...(pid ? { portfolioId: pid } : {}) } },
    include: { import: { select: { ref: true, ledgerId: true } } },
    orderBy: [{ valueDate: 'asc' }],
    take: f.limit,
  });
  const led = new Map((await prisma.cashLedger.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ledgerId))] } }, select: { id: true, ref: true, name: true, currency: true } })).map((l) => [l.id, l]));
  res.json({ data: rows.map((l) => ({ id: l.id, importRef: l.import.ref, ledgerId: l.ledgerId, ledgerRef: led.get(l.ledgerId)?.ref ?? null, ledgerName: led.get(l.ledgerId)?.name ?? null, currency: led.get(l.ledgerId)?.currency ?? null, valueDate: isoDay(l.valueDate), amount: l.amount.toFixed(2), reference: l.reference, description: l.description, status: l.status, matchedJournalId: l.matchedJournalId, note: l.note })), total: rows.length });
});

const matchBody = z.object({ journalId: z.string().trim().min(1).max(36) }).strict();
cashRoutes.post('/statement-lines/:id/match', ...canImport, validateBody(matchBody), idempotent('cash.post.statement_lines_id_match', { required: false }), async (req, res) => {
  const line = await prisma.cashStatementLine.findUnique({ where: { id: param(req, 'id') }, include: { import: true } });
  if (!line || line.import.status !== 'COMMITTED') throw HttpError.notFound('Statement line not found');
  if (line.status !== 'UNMATCHED') throw HttpError.conflict(`The line is ${line.status}`, 'invalid_state');
  const j = await loadJournal((req.body as z.infer<typeof matchBody>).journalId);
  if (!EFFECTIVE.includes(j.status)) throw HttpError.conflict(`${j.ref} is ${j.status}; match a posted journal`, 'invalid_state');
  const jl = await prisma.cashJournalLine.findMany({ where: { journalId: j.id, ledgerId: line.ledgerId } });
  const net = jl.reduce((s, l) => s.add(signed(l)), ZERO);
  if (!jl.length || !net.eq(line.amount)) throw HttpError.badRequest('Validation failed', [{ path: 'journalId', message: `${j.ref} moves ${net.toFixed(2)} on this ledger, not ${line.amount.toFixed(2)}` }]);
  if (await prisma.cashStatementLine.count({ where: { matchedJournalId: j.id, ledgerId: line.ledgerId } })) throw HttpError.conflict(`${j.ref} is already matched to a statement line`, 'already_matched');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashStatementLine.updateMany({ where: { id: line.id, status: 'UNMATCHED' }, data: { status: 'MATCHED', matchedJournalId: j.id, matchedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.statement_line_matched', objectType: 'cash_statement_import', objectId: line.importId, after: { line: line.lineNo, journal: j.ref, amount: line.amount.toFixed(2) } });
  });
  res.json({ data: { id: line.id, status: 'MATCHED', matchedJournalId: j.id } });
});

const ignoreBody = z.object({ note: z.string().trim().min(5, 'Explain why (5+ characters)').max(255) }).strict();
cashRoutes.post('/statement-lines/:id/ignore', ...canApprove, validateBody(ignoreBody), idempotent('cash.post.statement_lines_id_ignore', { required: false }), async (req, res) => {
  const line = await prisma.cashStatementLine.findUnique({ where: { id: param(req, 'id') }, include: { import: true } });
  if (!line || line.import.status !== 'COMMITTED') throw HttpError.notFound('Statement line not found');
  if (line.status !== 'UNMATCHED') throw HttpError.conflict(`The line is ${line.status}`, 'invalid_state');
  if (line.import.makerId === req.user!.id) throw sod('The uploader cannot write off lines of their own statement');
  const note = (req.body as z.infer<typeof ignoreBody>).note;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashStatementLine.updateMany({ where: { id: line.id, status: 'UNMATCHED' }, data: { status: 'IGNORED', note } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.statement_line_ignored', objectType: 'cash_statement_import', objectId: line.importId, after: { line: line.lineNo, amount: line.amount.toFixed(2) }, reason: note });
  });
  res.json({ data: { id: line.id, status: 'IGNORED' } });
});

// ================================================================ period close

const closeBody = z.object({ portfolioId: z.string().trim().min(1).max(36), periodEnd: dateStr }).strict();
const closesQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), status: z.string().trim().max(40).optional() });
const precheckQuery = z.object({ portfolioId: z.string().trim().min(1).max(36), periodEnd: dateStr });

cashRoutes.get('/period-closes', ...canView, validateQuery(closesQuery), async (req, res) => {
  const f = query<z.infer<typeof closesQuery>>(req);
  const pid = await portfolioFilter(f.portfolioId);
  const rows = await prisma.cashPeriodClose.findMany({ where: { ...(pid ? { portfolioId: pid } : {}), ...(f.status ? { status: statusIn(f.status) } : {}) }, orderBy: [{ periodEnd: 'desc' }], take: 120 });
  res.json({ data: await closeViews(rows), total: rows.length });
});

/** Informational pre-check for any date; the same function gates the close itself. */
cashRoutes.get('/period-closes/precheck', ...canView, validateQuery(precheckQuery), async (req, res) => {
  const f = query<z.infer<typeof precheckQuery>>(req);
  const portfolioId = await resolvePortfolioId(f.portfolioId);
  const periodEnd = toDate(f.periodEnd);
  const close = await prisma.cashPeriodClose.findUnique({ where: { portfolioId_periodEnd: { portfolioId, periodEnd } } });
  const pre = await closePrecheck(portfolioId, periodEnd, close);
  res.json({ data: { portfolioId, periodEnd: f.periodEnd, closeId: close?.id ?? null, closeStatus: close?.status ?? null, ...pre } });
});

async function closeDetail(id: string) {
  const c = await loadClose(id);
  const [[view], pre] = await Promise.all([closeViews([c]), closePrecheck(c.portfolioId, c.periodEnd, c)]);
  return { ...view!, checklist: pre.items, blockers: pre.blockers, canClose: pre.canClose && c.status !== 'CLOSED' };
}

cashRoutes.get('/period-closes/:id', ...canView, async (req, res) => {
  res.json({ data: await closeDetail(param(req, 'id')) });
});

cashRoutes.post('/period-closes', ...canClose, validateBody(closeBody), idempotent('cash.close_prepare'), async (req, res) => {
  const b = req.body as z.infer<typeof closeBody>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const periodEnd = toDate(b.periodEnd);
  if (await prisma.cashPeriodClose.findUnique({ where: { portfolioId_periodEnd: { portfolioId, periodEnd } }, select: { id: true } })) throw HttpError.conflict(`A close for ${b.periodEnd} already exists for this portfolio`, 'duplicate_close');
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.cashPeriodClose.create({ data: { portfolioId, periodEnd, preparedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'cash.close_prepared', objectType: 'cash_period_close', objectId: c.id, after: { portfolioId, periodEnd: b.periodEnd, status: 'PREPARED' } });
    await notifyPermission(tx, 'cash.journal.approve', { type: 'cash.close_prepared', title: `Cash close for ${b.periodEnd} awaits a checker`, link: `/ops/cash?close=${c.id}` });
    return c;
  });
  res.status(201).json({ data: await closeDetail(row.id) });
});

cashRoutes.post('/period-closes/:id/approve', ...canApprove, idempotent('cash.close_approve', { required: false }), async (req, res) => {
  const c = await loadClose(param(req, 'id'));
  if (c.status !== 'PREPARED') throw HttpError.conflict(`The close is ${c.status}; only a PREPARED close can be approved`, 'invalid_state');
  if (c.preparedBy === req.user!.id) throw sod('The person who prepared the close cannot approve it');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashPeriodClose.updateMany({ where: { id: c.id, status: 'PREPARED' }, data: { status: 'APPROVED', approvedBy: req.user!.id, approvedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.close_approved', objectType: 'cash_period_close', objectId: c.id, before: { status: 'PREPARED' }, after: { status: 'APPROVED', preparedBy: c.preparedBy, approvedBy: req.user!.id } });
    await notifyPermission(tx, 'cash.close', { type: 'cash.close_approved', title: `Cash close for ${isoDay(c.periodEnd)} is approved`, link: `/ops/cash?close=${c.id}` });
  });
  res.json({ data: await closeDetail(c.id) });
});

/** FR-CASH-018: refuses with 409 `close_blocked` listing every blocker; once closed, journals dated in the period return 409. */
cashRoutes.post('/period-closes/:id/close', ...canClose, requireStepUp, idempotent('cash.close_close', { required: false }), async (req, res) => {
  const c = await loadClose(param(req, 'id'));
  if (c.status === 'CLOSED') throw HttpError.conflict('The period is already closed', 'invalid_state');
  const pre = await closePrecheck(c.portfolioId, c.periodEnd, c);
  if (!pre.canClose) throw new HttpError(409, 'close_blocked', `The cash period cannot be closed: ${pre.blockers.length} blocker${pre.blockers.length === 1 ? '' : 's'}`, { blockers: pre.blockers, checklist: pre.items });
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashPeriodClose.updateMany({ where: { id: c.id, status: 'APPROVED' }, data: { status: 'CLOSED', closedBy: req.user!.id, closedAt: new Date(), closeSnapshot: { checklist: pre.items } as unknown as Prisma.InputJsonValue } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.close_closed', objectType: 'cash_period_close', objectId: c.id, before: { status: c.status }, after: { status: 'CLOSED', periodEnd: isoDay(c.periodEnd), approvedBy: c.approvedBy } });
  });
  res.json({ data: await closeDetail(c.id) });
});

cashRoutes.post('/period-closes/:id/reopen', ...canClose, requireStepUp, validateBody(reasonSchema), idempotent('cash.close_reopen', { required: false }), async (req, res) => {
  const c = await loadClose(param(req, 'id'));
  if (c.status !== 'CLOSED') throw HttpError.conflict(`The close is ${c.status}; only a CLOSED period can be reopened`, 'invalid_state');
  const later = await prisma.cashPeriodClose.findFirst({ where: { portfolioId: c.portfolioId, periodEnd: { gt: c.periodEnd }, status: 'CLOSED' }, select: { periodEnd: true } });
  if (later) throw HttpError.conflict(`The close for ${isoDay(later.periodEnd)} is closed; reopen the later close first`, 'later_period_closed');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.cashPeriodClose.updateMany({ where: { id: c.id, status: 'CLOSED' }, data: { status: 'PREPARED', approvedBy: null, approvedAt: null, closedBy: null, closedAt: null, reopenedBy: req.user!.id, reopenedAt: new Date(), reopenReason: reason } })).count);
    await writeAudit(tx, audit(req), { action: 'cash.close_reopened', objectType: 'cash_period_close', objectId: c.id, before: { status: 'CLOSED' }, after: { status: 'PREPARED' }, reason });
  });
  res.json({ data: await closeDetail(c.id) });
});
