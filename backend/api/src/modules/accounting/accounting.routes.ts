import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { loadPortfolio } from '../portfolio/portfolio.service';
import { ACCOUNT_TYPES, DEFAULT_COA, invertLines, monthBounds, totals, validateLines } from './accounting.engine';
import {
  assertPeriodOpen,
  closeChecklist,
  isoDay,
  journalDetail,
  journalViews,
  ledger,
  loadJournal,
  loadPeriod,
  periodViews,
  startOfDay,
  trialBalance,
  type JournalRow,
} from './accounting.service';

/**
 * Accounting & Close (SRD 5.A.21 `accounting`, accounting-close second layer; ABOR). Admin-portal staff only.
 * `valuation.view` reads and prepares (draft, edit, submit journals; open periods; start a close);
 * `accounting.post` maintains the chart of accounts, posts (never your own journal, plus step-up MFA), returns and reverses;
 * `accounting.close` + step-up closes a period; `accounting.reopen` + reason + step-up reopens it.
 * Posted journals are immutable; a reversal is a new posted journal with the sides swapped. Mounted at `/api/v1/accounting`.
 */
export const accountingRoutes = Router();

const D = Prisma.Decimal;
const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('valuation.view')];
const canPost = [...staff, requirePermission('valuation.view'), requirePermission('accounting.post')];
const canClose = [...staff, requirePermission('valuation.view'), requirePermission('accounting.close')];
const canReopen = [...staff, requirePermission('valuation.view'), requirePermission('accounting.reopen')];

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

async function resolvePortfolioId(v: string): Promise<string> {
  return (await loadPortfolio(v).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  })).id;
}
async function portfolioFilter(v?: string) {
  if (!v) return undefined;
  return UUID.test(v) ? v : ((await prisma.portfolio.findUnique({ where: { ref: v }, select: { id: true } }))?.id ?? '0');
}

// ================================================================ chart of accounts

const accountCode = z.string().trim().regex(/^[A-Za-z0-9.\-]{1,20}$/, 'Code: letters, digits, dot or dash, up to 20 characters');
const accountSchema = z
  .object({
    portfolioId: z.string().trim().min(1).max(36),
    code: accountCode,
    name: z.string().trim().min(2).max(160),
    type: z.enum(ACCOUNT_TYPES),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const accountPatch = z
  .object({ name: z.string().trim().min(2).max(160), description: z.string().trim().max(500).nullable(), isActive: z.boolean(), type: z.enum(ACCOUNT_TYPES) })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
const accountsQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), type: z.enum(ACCOUNT_TYPES).optional(), active: z.enum(['true', 'false']).optional(), q: z.string().trim().max(40).optional() });

const accountView = (a: Prisma.AccAccountGetPayload<object>) => ({ id: a.id, portfolioId: a.portfolioId, code: a.code, name: a.name, type: a.type, description: a.description, isActive: a.isActive, createdAt: a.createdAt.toISOString() });

accountingRoutes.get('/accounts', ...canView, validateQuery(accountsQuery), async (req, res) => {
  const f = query<z.infer<typeof accountsQuery>>(req);
  const where: Prisma.AccAccountWhereInput = {};
  const pid = await portfolioFilter(f.portfolioId);
  if (pid) where.portfolioId = pid;
  if (f.type) where.type = f.type;
  if (f.active) where.isActive = f.active === 'true';
  if (f.q) where.OR = [{ code: { contains: f.q } }, { name: { contains: f.q } }];
  const rows = await prisma.accAccount.findMany({ where, orderBy: [{ portfolioId: 'asc' }, { code: 'asc' }], take: 500 });
  res.json({ data: rows.map(accountView), total: rows.length });
});

async function createAccount(tx: Prisma.TransactionClient, req: Request, portfolioId: string, a: { code: string; name: string; type: string; description?: string | null }) {
  const row = await tx.accAccount.create({ data: { portfolioId, code: a.code, name: a.name, type: a.type, description: a.description ?? null, createdBy: req.user!.id } });
  await writeAudit(tx, audit(req), { action: 'accounting.account_created', objectType: 'acc_account', objectId: row.id, after: { portfolioId, code: a.code, name: a.name, type: a.type } });
  return row;
}

accountingRoutes.post('/accounts', ...canPost, validateBody(accountSchema), idempotent('accounting.account_create'), async (req, res) => {
  const b = req.body as z.infer<typeof accountSchema>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  if (await prisma.accAccount.findUnique({ where: { portfolioId_code: { portfolioId, code: b.code } }, select: { id: true } })) throw HttpError.conflict(`Account code ${b.code} already exists for this entity`, 'duplicate_code');
  const row = await prisma.$transaction((tx) => createAccount(tx, req, portfolioId, b));
  res.status(201).json({ data: accountView(row) });
});

/** Adds the standard fund chart for an entity; codes that already exist are left alone. */
accountingRoutes.post('/accounts/default-chart', ...canPost, validateBody(z.object({ portfolioId: z.string().trim().min(1).max(36) }).strict()), async (req, res) => {
  const portfolioId = await resolvePortfolioId((req.body as { portfolioId: string }).portfolioId);
  const existing = new Set((await prisma.accAccount.findMany({ where: { portfolioId }, select: { code: true } })).map((a) => a.code));
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const a of DEFAULT_COA.filter((x) => !existing.has(x.code))) out.push(await createAccount(tx, req, portfolioId, a));
    return out;
  });
  res.status(201).json({ data: created.map(accountView), created: created.length, skipped: DEFAULT_COA.length - created.length });
});

accountingRoutes.patch('/accounts/:id', ...canPost, validateBody(accountPatch), idempotent('accounting.patch.accounts_id', { required: false }), async (req, res) => {
  const a = await prisma.accAccount.findUnique({ where: { id: param(req, 'id') } });
  if (!a) throw HttpError.notFound('Account not found');
  const b = req.body as z.infer<typeof accountPatch>;
  if (b.type && b.type !== a.type && (await prisma.accJournalLine.count({ where: { accountId: a.id } })) > 0) {
    throw HttpError.conflict('The type cannot change once the account has been used in a journal', 'account_in_use');
  }
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.accAccount.update({ where: { id: a.id }, data: b });
    await writeAudit(tx, audit(req), {
      action: 'accounting.account_updated',
      objectType: 'acc_account',
      objectId: a.id,
      before: { name: a.name, type: a.type, isActive: a.isActive, description: a.description },
      after: { name: u.name, type: u.type, isActive: u.isActive, description: u.description },
    });
    return u;
  });
  res.json({ data: accountView(row) });
});

// ================================================================ journals

const lineSchema = z
  .object({ accountId: z.string().trim().min(1).max(36), debit: amount.optional(), credit: amount.optional(), memo: z.string().trim().max(255).nullable().optional() })
  .strict();
const journalBody = {
  entryDate: dateStr,
  description: z.string().trim().min(3, 'Describe the journal (3+ characters)').max(500),
  lines: z.array(lineSchema).min(2).max(200),
};
const createJournal = z.object({ portfolioId: z.string().trim().min(1).max(36), ...journalBody }).strict();
const patchJournal = z.object(journalBody).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
const reverseSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500), entryDate: dateStr.optional() }).strict();

const listQuery = z.object({
  portfolioId: z.string().trim().max(36).optional(),
  status: z.string().trim().max(120).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type LineBody = z.infer<typeof lineSchema>;

/** Checks balance, positive amounts and that every account is active and belongs to the entity. */
async function checkLines(portfolioId: string, lines: LineBody[]) {
  const errors = validateLines(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })));
  const accounts = await prisma.accAccount.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  lines.forEach((l, i) => {
    const a = byId.get(l.accountId);
    if (!a || a.portfolioId !== portfolioId) errors.push({ path: `lines[${i}].accountId`, message: 'Unknown account for this entity' });
    else if (!a.isActive) errors.push({ path: `lines[${i}].accountId`, message: `Account ${a.code} is inactive` });
  });
  if (errors.length) throw HttpError.badRequest('Validation failed', errors);
}

const lineRows = (lines: LineBody[]) =>
  lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, debit: l.debit ?? new D(0), credit: l.credit ?? new D(0), memo: l.memo ?? null }));

async function respond(res: Response, req: Request, id: string, status = 200) {
  res.status(status).json({ data: await journalDetail(await loadJournal(id), req.user!) });
}

function assertMaker(r: JournalRow, req: Request) {
  if (r.makerId !== req.user!.id) throw HttpError.forbidden('Only the person who created this journal can change or submit it', 'not_maker');
}

accountingRoutes.get('/journals', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const where: Prisma.AccJournalWhereInput = {};
  const pid = await portfolioFilter(f.portfolioId);
  if (pid) where.portfolioId = pid;
  if (f.status) where.status = { in: f.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) };
  if (f.from || f.to) where.entryDate = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  if (f.q) where.OR = [{ ref: { contains: f.q.toUpperCase() } }, { description: { contains: f.q } }];
  const [total, rows, grouped] = await Promise.all([
    prisma.accJournal.count({ where }),
    prisma.accJournal.findMany({ where, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.accJournal.groupBy({ by: ['status'], where: pid ? { portfolioId: pid } : {}, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  res.json({ data: await journalViews(rows), total, summary: { byStatus, drafts: byStatus.DRAFT ?? 0, pendingApproval: byStatus.PENDING_APPROVAL ?? 0, posted: byStatus.POSTED ?? 0 } });
});

accountingRoutes.get('/journals/:id', ...canView, async (req, res) => {
  await respond(res, req, param(req, 'id'));
});

accountingRoutes.post('/journals', ...canView, validateBody(createJournal), idempotent('accounting.journal_create'), async (req, res) => {
  const b = req.body as z.infer<typeof createJournal>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const entryDate = toDate(b.entryDate);
  await assertPeriodOpen(portfolioId, entryDate);
  await checkLines(portfolioId, b.lines);
  const t = totals(b.lines);
  const base = (await prisma.portfolio.findUnique({ where: { id: portfolioId }, select: { baseCurrency: true } }))?.baseCurrency ?? 'USD';
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'journal');
    const j = await tx.accJournal.create({
      data: { ref, portfolioId, entryDate, description: b.description, currency: base, totalDebit: t.debit, totalCredit: t.credit, makerId: req.user!.id, lines: { create: lineRows(b.lines) } },
    });
    await writeAudit(tx, audit(req), { action: 'accounting.journal_created', objectType: 'acc_journal', objectId: j.id, after: { ref, portfolioId, entryDate: b.entryDate, totalDebit: t.debit.toFixed(2), lines: b.lines.length } });
    return j;
  });
  await respond(res, req, row.id, 201);
});

accountingRoutes.patch('/journals/:id', ...canView, validateBody(patchJournal), idempotent('accounting.patch.journals_id', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  expectVersion(req, r.version);
  if (r.status !== 'DRAFT') throw new HttpError(409, 'journal_immutable', `${r.ref} is ${r.status}; only a DRAFT can be edited. Posted journals are corrected by reversal.`);
  assertMaker(r, req);
  const b = req.body as z.infer<typeof patchJournal>;
  const entryDate = toDate(b.entryDate);
  await assertPeriodOpen(r.portfolioId, entryDate);
  await checkLines(r.portfolioId, b.lines);
  const t = totals(b.lines);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.accJournal.updateMany({ where: { id: r.id, status: 'DRAFT', version: r.version }, data: { entryDate, description: b.description, totalDebit: t.debit, totalCredit: t.credit, version: { increment: 1 } } })).count);
    await tx.accJournalLine.deleteMany({ where: { journalId: r.id } });
    await tx.accJournalLine.createMany({ data: lineRows(b.lines).map((l) => ({ ...l, journalId: r.id })) });
    await writeAudit(tx, audit(req), {
      action: 'accounting.journal_updated',
      objectType: 'acc_journal',
      objectId: r.id,
      before: { entryDate: isoDay(r.entryDate), totalDebit: r.totalDebit.toFixed(2) },
      after: { entryDate: b.entryDate, totalDebit: t.debit.toFixed(2), lines: b.lines.length },
    });
  });
  await respond(res, req, r.id);
});

accountingRoutes.post('/journals/:id/submit', ...canView, idempotent('accounting.journal_submit', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'DRAFT') throw HttpError.conflict(`${r.ref} is ${r.status}; only a DRAFT can be submitted`, 'invalid_state');
  assertMaker(r, req);
  await assertPeriodOpen(r.portfolioId, r.entryDate);
  const lines = await prisma.accJournalLine.findMany({ where: { journalId: r.id } });
  const errors = validateLines(lines);
  if (errors.length) throw HttpError.badRequest('Journal is not balanced', errors);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.accJournal.updateMany({ where: { id: r.id, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'accounting.journal_submitted', objectType: 'acc_journal', objectId: r.id, before: { status: 'DRAFT' }, after: { status: 'PENDING_APPROVAL', totalDebit: r.totalDebit.toFixed(2) } });
    await notifyPermission(tx, 'accounting.post', { type: 'accounting.journal_pending', title: `Journal ${r.ref} awaits posting`, body: `${isoDay(r.entryDate)} ${r.description}`, link: `/ops/accounting?journal=${r.id}` });
  });
  await respond(res, req, r.id);
});

accountingRoutes.post('/journals/:id/return', ...canPost, validateBody(reasonSchema), idempotent('accounting.post.journals_id_return', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`${r.ref} is ${r.status}; only a pending journal can be returned`, 'invalid_state');
  if (r.makerId === req.user!.id) throw HttpError.forbidden('Return a journal you did not create, or discard your own', 'segregation_of_duties');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.accJournal.updateMany({ where: { id: r.id, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT', submittedAt: null } })).count);
    await writeAudit(tx, audit(req), { action: 'accounting.journal_returned', objectType: 'acc_journal', objectId: r.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'DRAFT' }, reason });
  });
  await respond(res, req, r.id);
});

accountingRoutes.post('/journals/:id/discard', ...canView, validateBody(reasonSchema), idempotent('accounting.post.journals_id_discard', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(r.status)) throw new HttpError(409, 'journal_immutable', `${r.ref} is ${r.status} and cannot be discarded. Posted journals are corrected by reversal.`);
  const canDiscard = r.makerId === req.user!.id || (r.status === 'PENDING_APPROVAL' && req.user!.permissions.includes('accounting.post'));
  if (!canDiscard) throw HttpError.forbidden('Only the creator (or a poster, once submitted) can discard this journal', 'forbidden');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.accJournal.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'DISCARDED' } })).count);
    await writeAudit(tx, audit(req), { action: 'accounting.journal_discarded', objectType: 'acc_journal', objectId: r.id, before: { status: r.status }, after: { status: 'DISCARDED' }, reason });
  });
  await respond(res, req, r.id);
});

accountingRoutes.post('/journals/:id/post', ...canPost, requireStepUp, idempotent('accounting.journal_post', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`${r.ref} is ${r.status}; it must be PENDING_APPROVAL to post`, 'invalid_state');
  if (r.makerId === req.user!.id) throw HttpError.forbidden('The journal creator cannot post the same journal (maker-checker)', 'segregation_of_duties');
  const lines = await prisma.accJournalLine.findMany({ where: { journalId: r.id } });
  const errors = validateLines(lines);
  if (errors.length) throw HttpError.badRequest('Journal is not balanced', errors);
  await prisma.$transaction(async (tx) => {
    await assertPeriodOpen(r.portfolioId, r.entryDate, tx);
    assertUpdated((await tx.accJournal.updateMany({ where: { id: r.id, status: 'PENDING_APPROVAL' }, data: { status: 'POSTED', postedBy: req.user!.id, postedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), {
      action: 'accounting.journal_posted',
      objectType: 'acc_journal',
      objectId: r.id,
      before: { status: 'PENDING_APPROVAL' },
      after: { status: 'POSTED', ref: r.ref, entryDate: isoDay(r.entryDate), totalDebit: r.totalDebit.toFixed(2), totalCredit: r.totalCredit.toFixed(2), makerId: r.makerId, postedBy: req.user!.id },
    });
  });
  await respond(res, req, r.id);
});

/** Creates the exact inverse journal, posted at once, and marks the original REVERSED. */
accountingRoutes.post('/journals/:id/reverse', ...canPost, requireStepUp, validateBody(reverseSchema), idempotent('accounting.journal_reverse', { required: false }), async (req, res) => {
  const r = await loadJournal(param(req, 'id'));
  if (r.status === 'REVERSED') throw HttpError.conflict(`${r.ref} is already reversed`, 'already_reversed');
  if (r.status !== 'POSTED') throw HttpError.conflict(`${r.ref} is ${r.status}; only a POSTED journal can be reversed`, 'invalid_state');
  if (r.reversalOfId) throw HttpError.conflict(`${r.ref} is itself a reversal and cannot be reversed again; post a new journal instead`, 'invalid_state');
  const b = req.body as z.infer<typeof reverseSchema>;
  const entryDate = b.entryDate ? toDate(b.entryDate) : today().getTime() < r.entryDate.getTime() ? r.entryDate : today();
  if (entryDate.getTime() < r.entryDate.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'entryDate', message: 'The reversal cannot be dated before the original journal' }]);
  const lines = await prisma.accJournalLine.findMany({ where: { journalId: r.id }, orderBy: { lineNo: 'asc' } });
  const rev = await prisma.$transaction(async (tx) => {
    await assertPeriodOpen(r.portfolioId, entryDate, tx);
    assertUpdated((await tx.accJournal.updateMany({ where: { id: r.id, status: 'POSTED' }, data: { status: 'REVERSED', reversedAt: new Date(), reverseReason: b.reason } })).count);
    const ref = await nextRef(tx, 'journal');
    const now = new Date();
    const j = await tx.accJournal.create({
      data: {
        ref,
        portfolioId: r.portfolioId,
        entryDate,
        description: `Reversal of ${r.ref}: ${b.reason}`.slice(0, 500),
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
    await tx.accJournal.update({ where: { id: r.id }, data: { reversedById: j.id } });
    await writeAudit(tx, audit(req), { action: 'accounting.journal_reversed', objectType: 'acc_journal', objectId: r.id, before: { status: 'POSTED' }, after: { status: 'REVERSED', reversedBy: ref }, reason: b.reason });
    await writeAudit(tx, audit(req), { action: 'accounting.journal_posted', objectType: 'acc_journal', objectId: j.id, after: { status: 'POSTED', ref, reversalOf: r.ref, entryDate: isoDay(entryDate), totalDebit: r.totalCredit.toFixed(2) }, reason: b.reason });
    return j;
  });
  res.status(201).json({ data: await journalDetail(await loadJournal(rev.id), req.user!) });
});

// ================================================================ trial balance and ledger

const tbQuery = z.object({ portfolioId: z.string().trim().min(1).max(36), asOf: dateStr.optional() });
accountingRoutes.get('/trial-balance', ...canView, validateQuery(tbQuery), async (req, res) => {
  const f = query<z.infer<typeof tbQuery>>(req);
  const portfolioId = await resolvePortfolioId(f.portfolioId);
  res.json({ data: { portfolioId, ...(await trialBalance(portfolioId, f.asOf ? toDate(f.asOf) : today())) } });
});

const ledgerQuery = z.object({ accountId: z.string().trim().min(1).max(36), from: dateStr.optional(), to: dateStr.optional() });
accountingRoutes.get('/ledger', ...canView, validateQuery(ledgerQuery), async (req, res) => {
  const f = query<z.infer<typeof ledgerQuery>>(req);
  res.json({ data: await ledger(f.accountId, f.from ? toDate(f.from) : null, f.to ? toDate(f.to) : null) });
});

// ================================================================ periods and close

const periodsQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), status: z.enum(['OPEN', 'CLOSING', 'CLOSED']).optional() });
const createPeriod = z.object({ portfolioId: z.string().trim().min(1).max(36), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') }).strict();

accountingRoutes.get('/periods', ...canView, validateQuery(periodsQuery), async (req, res) => {
  const f = query<z.infer<typeof periodsQuery>>(req);
  const pid = await portfolioFilter(f.portfolioId);
  const rows = await prisma.accPeriod.findMany({ where: { ...(pid ? { portfolioId: pid } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: [{ periodEnd: 'desc' }], take: 120 });
  res.json({ data: await periodViews(rows), total: rows.length });
});

async function periodDetail(id: string) {
  const p = await loadPeriod(id);
  const [[view], checklist] = await Promise.all([periodViews([p]), closeChecklist(p)]);
  return { ...view!, checklist: checklist.items, blockers: checklist.blockers, canClose: checklist.canClose && p.status !== 'CLOSED', trialBalance: checklist.trialBalance };
}

accountingRoutes.get('/periods/:id', ...canView, async (req, res) => {
  res.json({ data: await periodDetail(param(req, 'id')) });
});

accountingRoutes.post('/periods', ...canView, validateBody(createPeriod), idempotent('accounting.period_create'), async (req, res) => {
  const b = req.body as z.infer<typeof createPeriod>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const { start, end } = monthBounds(b.month);
  if (await prisma.accPeriod.findUnique({ where: { portfolioId_periodEnd: { portfolioId, periodEnd: end } }, select: { id: true } })) throw HttpError.conflict(`Period ${b.month} already exists for this entity`, 'duplicate_period');
  const p = await prisma.$transaction(async (tx) => {
    const row = await tx.accPeriod.create({ data: { portfolioId, periodStart: start, periodEnd: end, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'accounting.period_opened', objectType: 'acc_period', objectId: row.id, after: { portfolioId, periodStart: isoDay(start), periodEnd: isoDay(end), status: 'OPEN' } });
    return row;
  });
  res.status(201).json({ data: await periodDetail(p.id) });
});

accountingRoutes.post('/periods/:id/start-close', ...canView, idempotent('accounting.period_start_close', { required: false }), async (req, res) => {
  const p = await loadPeriod(param(req, 'id'));
  if (p.status !== 'OPEN') throw HttpError.conflict(`The period is ${p.status}; only an OPEN period can start closing`, 'invalid_state');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.accPeriod.updateMany({ where: { id: p.id, status: 'OPEN' }, data: { status: 'CLOSING', closingBy: req.user!.id, closingAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'accounting.period_closing_started', objectType: 'acc_period', objectId: p.id, before: { status: 'OPEN' }, after: { status: 'CLOSING' } });
    await notifyPermission(tx, 'accounting.close', { type: 'accounting.close_started', title: `Close started for ${p.periodEnd.toISOString().slice(0, 7)}`, link: `/ops/accounting?period=${p.id}` });
  });
  res.json({ data: await periodDetail(p.id) });
});

/** Refuses with 409 `close_blocked` and every blocker listed until the checklist is clean; then locks posting into the period. */
accountingRoutes.post('/periods/:id/close', ...canClose, requireStepUp, idempotent('accounting.period_close', { required: false }), async (req, res) => {
  const p = await loadPeriod(param(req, 'id'));
  if (p.status === 'CLOSED') throw HttpError.conflict('The period is already closed', 'invalid_state');
  const checklist = await closeChecklist(p);
  if (!checklist.canClose) {
    throw new HttpError(409, 'close_blocked', `The period cannot be closed: ${checklist.blockers.length} blocker${checklist.blockers.length === 1 ? '' : 's'}`, { blockers: checklist.blockers, checklist: checklist.items });
  }
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (
        await tx.accPeriod.updateMany({
          where: { id: p.id, status: { in: ['OPEN', 'CLOSING'] } },
          data: { status: 'CLOSED', closedBy: req.user!.id, closedAt: new Date(), closeSnapshot: { checklist: checklist.items, trialBalance: checklist.trialBalance } as unknown as Prisma.InputJsonValue },
        })
      ).count,
    );
    await writeAudit(tx, audit(req), { action: 'accounting.period_closed', objectType: 'acc_period', objectId: p.id, before: { status: p.status }, after: { status: 'CLOSED', periodEnd: isoDay(p.periodEnd), trialBalance: checklist.trialBalance } });
  });
  res.json({ data: await periodDetail(p.id) });
});

const reopenSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
accountingRoutes.post('/periods/:id/reopen', ...canReopen, requireStepUp, validateBody(reopenSchema), idempotent('accounting.period_reopen', { required: false }), async (req, res) => {
  const p = await loadPeriod(param(req, 'id'));
  if (p.status !== 'CLOSED') throw HttpError.conflict(`The period is ${p.status}; only a CLOSED period can be reopened`, 'invalid_state');
  const later = await prisma.accPeriod.findFirst({ where: { portfolioId: p.portfolioId, periodEnd: { gt: p.periodEnd }, status: 'CLOSED' }, select: { periodEnd: true } });
  if (later) throw HttpError.conflict(`The period ending ${isoDay(later.periodEnd)} is closed; reopen the later period first`, 'later_period_closed');
  const reason = (req.body as z.infer<typeof reopenSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.accPeriod.updateMany({ where: { id: p.id, status: 'CLOSED' }, data: { status: 'OPEN', reopenedBy: req.user!.id, reopenedAt: new Date(), reopenReason: reason, closedBy: null, closedAt: null } })).count);
    await writeAudit(tx, audit(req), { action: 'accounting.period_reopened', objectType: 'acc_period', objectId: p.id, before: { status: 'CLOSED', closedBy: p.closedBy }, after: { status: 'OPEN' }, reason });
    await notifyPermission(tx, 'accounting.close', { type: 'accounting.period_reopened', title: `Period ${p.periodEnd.toISOString().slice(0, 7)} reopened`, body: reason, link: `/ops/accounting?period=${p.id}` });
  });
  res.json({ data: await periodDetail(p.id) });
});

