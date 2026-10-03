import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { sha256Hex } from '../../lib/crypto';
import { storeFile } from '../../lib/storage';
import { enqueue } from '../../lib/outbox';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission, seqRef } from '../ops/ops.common';
import { accountRefs } from '../custodian/custodian.service';
import { OPEN_STATUSES } from '../recon/recon.engine';
import { dayStart, executeRun, isoDay, resolveTolerances, todayIso } from '../recon/recon.service';
import { getCustodianFeedAdapter } from '../../integrations/custodian-feed';
import { IntegrationNotConfiguredError } from '../../integrations/common';
import { accountingCloseGates, cashCloseGates, closeGatesEnabled } from './opsctl.gates';
import { DEFAULT_PAY_PARAMS, MATERIAL_SEV, PAY_OPEN, RESOLUTIONS } from './payrecon.engine';
import { executePayRecon, payScopeKey } from './payrecon.service';

/**
 * Operations and finance controls (R4-2), mounted at `/api/v1/ops-controls`. Admin-portal staff only.
 *  - `/close-gates`: the NAV-released gate and the reconciliation sign-off gate that the cash and accounting period
 *    closes enforce, with itemised blockers,
 *  - `/pay-recon/*`: payments reconciliation (distribution payouts and capital-call receipts against imported bank
 *    statement lines) with break handling (maker resolves, an independent checker approves),
 *  - `/settlement-fails`: the settlement-fails view over the reconciliation break register,
 *  - `/custody-positions/pull`: custody position quantities pulled through the custodian-feed adapter into the
 *    positions-vs-custody reconciliation.
 * `operations.view` reads; `recon.manage` runs and works breaks; `recon.signoff` (with step-up MFA) approves or rejects.
 */
export const opsctlRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('operations.view')];
const canManage = [...staff, requirePermission('operations.view', 'recon.manage')];
const canSignoff = [...staff, requirePermission('operations.view', 'recon.signoff')];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const f2 = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const id36 = z.string().trim().min(1).max(36);
const uuidLike = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const D = Prisma.Decimal;

async function userNames(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map<string, string>();
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}

// ================================================================ close gates

const gateQuery = z.object({ portfolioId: id36, periodEnd: dateStr, type: z.enum(['cash', 'accounting']).default('cash') });

opsctlRoutes.get('/close-gates', ...canView, validateQuery(gateQuery), async (req, res) => {
  const q = query<z.infer<typeof gateQuery>>(req);
  const pf = await prisma.portfolio.findFirst({ where: uuidLike(q.portfolioId) ? { id: q.portfolioId } : { ref: q.portfolioId }, select: { id: true, ref: true, name: true } });
  if (!pf) throw HttpError.notFound('Portfolio not found');
  const enabled = await closeGatesEnabled();
  const periodEnd = dayStart(q.periodEnd);
  const items = q.type === 'cash' ? await cashCloseGates(pf.id, periodEnd) : await accountingCloseGates(pf.id, periodEnd);
  const blockers = items.flatMap((i) => i.blockers);
  res.json({ data: { portfolio: pf, periodEnd: q.periodEnd, type: q.type, enabled, items, blockers, canClose: blockers.length === 0 } });
});

// ================================================================ payments reconciliation

const MAX_WINDOW_DAYS = 366;
const runBody = z
  .object({
    fundId: id36.nullish(),
    from: dateStr,
    to: dateStr,
    tolerance: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) <= 1000, 'Enter a tolerance from 0 to 1000')
      .optional(),
    graceDays: z.coerce.number().int().min(0).max(30).optional(),
    dateWindowDays: z.coerce.number().int().min(0).max(30).optional(),
  })
  .strict();

async function fundOf(v: string | null | undefined) {
  if (!v) return null;
  const f = await prisma.fund.findFirst({ where: uuidLike(v) ? { id: v } : { ref: v }, select: { id: true, ref: true, name: true, currency: true } });
  if (!f) throw HttpError.badRequest('Validation failed', [{ path: 'fundId', message: 'Unknown fund' }]);
  return f;
}

opsctlRoutes.get('/pay-recon/funds', ...canView, async (_req, res) => {
  const rows = await prisma.fund.findMany({ orderBy: { ref: 'asc' }, select: { id: true, ref: true, name: true, currency: true }, take: 200 });
  res.json({ data: rows });
});

type RunRow = Prisma.PayReconRunGetPayload<object>;
const runView = (r: RunRow, fund?: { ref: string; name: string } | null, who?: string) => ({
  id: r.id,
  ref: r.ref,
  fundId: r.fundId,
  fund: fund ? { ref: fund.ref, name: fund.name } : null,
  from: isoDay(r.dateFrom),
  to: isoDay(r.dateTo),
  status: r.status,
  itemCount: r.itemCount,
  matchedCount: r.matchedCount,
  breakCount: r.breakCount,
  notDueCount: r.notDueCount,
  lineCount: r.lineCount,
  params: r.params,
  summary: r.summary,
  runCount: r.runCount,
  runByName: who ?? null,
  updatedAt: iso(r.updatedAt),
});
async function runViews(rows: RunRow[]) {
  const [funds, names] = await Promise.all([
    prisma.fund.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.fundId).filter((x): x is string => !!x))] } }, select: { id: true, ref: true, name: true } }),
    userNames(rows.map((r) => r.runBy)),
  ]);
  const fm = new Map(funds.map((f) => [f.id, f]));
  return rows.map((r) => runView(r, r.fundId ? fm.get(r.fundId) : null, names.get(r.runBy)));
}

opsctlRoutes.post('/pay-recon/runs', ...canManage, validateBody(runBody), idempotent('pay_recon.run'), async (req, res) => {
  const b = req.body as z.infer<typeof runBody>;
  if (b.from > b.to) throw HttpError.badRequest('Validation failed', [{ path: 'to', message: 'The end date is before the start date' }]);
  if ((Date.parse(b.to) - Date.parse(b.from)) / 86_400_000 > MAX_WINDOW_DAYS) throw HttpError.badRequest('Validation failed', [{ path: 'to', message: `At most ${MAX_WINDOW_DAYS} days per run` }]);
  const fund = await fundOf(b.fundId);
  const r = await executePayRecon(req, { fundId: fund?.id ?? null, from: b.from, to: b.to, tolerance: b.tolerance, graceDays: b.graceDays, dateWindowDays: b.dateWindowDays });
  const run = await prisma.payReconRun.findUniqueOrThrow({ where: { id: r.runId } });
  const breaks = await prisma.payReconBreak.findMany({ where: { lastRunId: run.id }, orderBy: [{ createdAt: 'asc' }], take: 500 });
  res.status(r.rerun ? 200 : 201).json({ data: (await runViews([run]))[0], breaks: await breakViews(breaks, req), rerun: r.rerun });
});

const runsQuery = z.object({ fundId: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
opsctlRoutes.get('/pay-recon/runs', ...canView, validateQuery(runsQuery), async (req, res) => {
  const q = query<z.infer<typeof runsQuery>>(req);
  const fund = await fundOf(q.fundId);
  const rows = await prisma.payReconRun.findMany({ where: fund ? { fundId: fund.id } : {}, orderBy: [{ updatedAt: 'desc' }], take: q.limit });
  res.json({ data: await runViews(rows) });
});

opsctlRoutes.get('/pay-recon/runs/:idOrRef', ...canView, async (req, res) => {
  const v = param(req, 'idOrRef');
  const run = await prisma.payReconRun.findFirst({ where: uuidLike(v) ? { id: v } : { ref: v.toUpperCase() } });
  if (!run) throw HttpError.notFound('Run not found');
  const breaks = await prisma.payReconBreak.findMany({ where: { lastRunId: run.id }, orderBy: [{ createdAt: 'asc' }], take: 500 });
  res.json({ data: (await runViews([run]))[0], breaks: await breakViews(breaks, req) });
});

const itemsQuery = z.object({
  status: z.string().optional(),
  kind: z.enum(['DISTRIBUTION_PAYOUT', 'CAPITAL_CALL_RECEIPT']).optional(),
  fundId: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
opsctlRoutes.get('/pay-recon/items', ...canView, validateQuery(itemsQuery), async (req, res) => {
  const q = query<z.infer<typeof itemsQuery>>(req);
  const fund = await fundOf(q.fundId);
  const statuses = q.status ? q.status.split(',').map((s) => s.trim().toUpperCase()) : null;
  const rows = await prisma.payReconItem.findMany({
    where: {
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(fund ? { fundId: fund.id } : {}),
      ...(q.from || q.to ? { dueDate: { ...(q.from ? { gte: dayStart(q.from) } : {}), ...(q.to ? { lte: dayStart(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ documentRef: { contains: q.q } }, { payeeName: { contains: q.q } }] } : {}),
    },
    orderBy: [{ dueDate: 'desc' }, { documentRef: 'asc' }, { payeeName: 'asc' }],
    take: q.limit,
  });
  const lineIds = rows.map((r) => r.matchedLineId).filter((x): x is string => !!x);
  const lines = lineIds.length ? await prisma.cashStatementLine.findMany({ where: { id: { in: lineIds } } }) : [];
  const lm = new Map(lines.map((l) => [l.id, l]));
  const funds = await prisma.fund.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.fundId))] } }, select: { id: true, ref: true, name: true } });
  const fm = new Map(funds.map((f) => [f.id, f]));
  res.json({
    data: rows.map((r) => {
      const l = r.matchedLineId ? lm.get(r.matchedLineId) : null;
      return {
        id: r.id,
        kind: r.kind,
        documentRef: r.documentRef,
        fund: fm.get(r.fundId) ? { ref: fm.get(r.fundId)!.ref, name: fm.get(r.fundId)!.name } : null,
        payeeName: r.payeeName,
        direction: r.direction,
        expectedAmount: f2(r.expectedAmount),
        currency: r.currency,
        dueDate: isoDay(r.dueDate),
        status: r.status,
        matchedAmount: f2(r.matchedAmount),
        matchMethod: r.matchMethod,
        matchedAt: iso(r.matchedAt),
        deferredUntil: r.deferredUntil ? isoDay(r.deferredUntil) : null,
        line: l ? { id: l.id, valueDate: isoDay(l.valueDate), amount: f2(l.amount), reference: l.reference, description: l.description } : null,
      };
    }),
  });
});

opsctlRoutes.get('/pay-recon/summary', ...canView, async (_req, res) => {
  const [items, openBreaks, lastRun] = await Promise.all([
    prisma.payReconItem.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.payReconBreak.findMany({ where: { status: { in: PAY_OPEN } }, select: { severity: true, status: true, kind: true, createdAt: true } }),
    prisma.payReconRun.findFirst({ orderBy: { updatedAt: 'desc' } }),
  ]);
  const bySev: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const b of openBreaks) {
    bySev[b.severity] = (bySev[b.severity] ?? 0) + 1;
    byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
  }
  const oldest = openBreaks.reduce<Date | null>((m, b) => (!m || b.createdAt < m ? b.createdAt : m), null);
  res.json({
    data: {
      items: Object.fromEntries(items.map((i) => [i.status, i._count._all])),
      openBreaks: openBreaks.length,
      materialOpen: openBreaks.filter((b) => (MATERIAL_SEV as string[]).includes(b.severity)).length,
      pendingChecker: openBreaks.filter((b) => b.status === 'PENDING_CHECKER').length,
      bySeverity: bySev,
      byKind,
      oldestAgeDays: oldest ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000) : 0,
      lastRun: lastRun ? (await runViews([lastRun]))[0] : null,
      defaults: DEFAULT_PAY_PARAMS,
    },
  });
});

const linesQuery = z.object({ from: dateStr.optional(), to: dateStr.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });
/** Imported bank statement lines not paired with any expected payment (candidates for a manual match). */
opsctlRoutes.get('/pay-recon/lines', ...canView, validateQuery(linesQuery), async (req, res) => {
  const q = query<z.infer<typeof linesQuery>>(req);
  const paired = await prisma.payReconItem.findMany({ where: { matchedLineId: { not: null } }, select: { matchedLineId: true } });
  const rows = await prisma.cashStatementLine.findMany({
    where: {
      status: { not: 'IGNORED' },
      import: { status: 'COMMITTED' },
      id: { notIn: paired.map((p) => p.matchedLineId!) },
      ...(q.from || q.to ? { valueDate: { ...(q.from ? { gte: dayStart(q.from) } : {}), ...(q.to ? { lte: dayStart(q.to) } : {}) } } : {}),
    },
    orderBy: [{ valueDate: 'desc' }, { id: 'asc' }],
    take: q.limit,
  });
  const ledgers = await prisma.cashLedger.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ledgerId))] } }, select: { id: true, ref: true, name: true, currency: true } });
  const lm = new Map(ledgers.map((l) => [l.id, l]));
  res.json({ data: rows.map((l) => ({ id: l.id, valueDate: isoDay(l.valueDate), amount: f2(l.amount), currency: lm.get(l.ledgerId)?.currency ?? null, ledger: lm.get(l.ledgerId)?.name ?? null, reference: l.reference, description: l.description })) });
});

// ---------------------------------------------------------------- breaks

type BreakRow = Prisma.PayReconBreakGetPayload<object>;
const SLA_DAYS = 3;

async function breakViews(rows: BreakRow[], req: Request) {
  const names = await userNames(rows.flatMap((b) => [b.ownerUserId, b.makerId, b.checkerId]));
  const canSign = !!req.user?.permissions.includes('recon.signoff');
  const canWork = !!req.user?.permissions.includes('recon.manage');
  return rows.map((b) => {
    const age = Math.floor((Date.now() - b.createdAt.getTime()) / 86_400_000);
    const open = b.status === 'OPEN' || b.status === 'INVESTIGATING';
    const isMaker = b.makerId === req.user?.id;
    return {
      id: b.id,
      ref: b.ref,
      kind: b.kind,
      label: b.label,
      expected: b.expected,
      actual: b.actual,
      difference: f2(b.difference),
      currency: b.currency,
      severity: b.severity,
      material: (MATERIAL_SEV as string[]).includes(b.severity),
      status: b.status,
      fundId: b.fundId,
      itemId: b.itemId,
      lineId: b.lineId,
      owner: b.ownerUserId ? { id: b.ownerUserId, name: names.get(b.ownerUserId) ?? null } : null,
      resolution: b.resolution,
      rationale: b.rationale,
      evidenceRef: b.evidenceRef,
      resolutionData: b.resolutionData,
      maker: b.makerId ? { id: b.makerId, name: names.get(b.makerId) ?? null } : null,
      checker: b.checkerId ? { id: b.checkerId, name: names.get(b.checkerId) ?? null } : null,
      resolvedAt: iso(b.resolvedAt),
      createdAt: iso(b.createdAt),
      ageDays: age,
      overdue: PAY_OPEN.includes(b.status) && (b.severity === 'CRITICAL' || age > SLA_DAYS),
      version: b.version,
      allowed: {
        assign: canWork && open,
        investigate: canWork && open,
        resolve: canWork && open,
        approve: canSign && b.status === 'PENDING_CHECKER' && !isMaker,
        reject: canSign && b.status === 'PENDING_CHECKER' && !isMaker,
        approveBlockedReason: b.status !== 'PENDING_CHECKER' ? null : !canSign ? 'Your role does not include recon.signoff' : isMaker ? 'The person who resolved the break cannot approve it' : null,
      },
    };
  });
}

async function loadBreak(idOrRef: string) {
  const b = await prisma.payReconBreak.findFirst({ where: uuidLike(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!b) throw HttpError.notFound('Break not found');
  return b;
}

const breaksQuery = z.object({
  status: z.string().optional(),
  kind: z.string().optional(),
  severity: z.string().optional(),
  fundId: z.string().optional(),
  mine: z.enum(['1']).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
opsctlRoutes.get('/pay-recon/breaks', ...canView, validateQuery(breaksQuery), async (req, res) => {
  const q = query<z.infer<typeof breaksQuery>>(req);
  const fund = await fundOf(q.fundId);
  const list = (s?: string) => (s ? s.split(',').map((x) => x.trim().toUpperCase()) : null);
  const st = list(q.status);
  const status = st ? st.flatMap((s) => (s === 'OPEN_ALL' ? PAY_OPEN : s === 'RESOLVED_ALL' ? ['RESOLVED', 'AUTO_CLEARED'] : [s])) : null;
  const rows = await prisma.payReconBreak.findMany({
    where: {
      ...(status ? { status: { in: status } } : {}),
      ...(list(q.kind) ? { kind: { in: list(q.kind)! } } : {}),
      ...(list(q.severity) ? { severity: { in: list(q.severity)! } } : {}),
      ...(fund ? { fundId: fund.id } : {}),
      ...(q.mine ? { ownerUserId: req.user!.id } : {}),
      ...(q.q ? { OR: [{ ref: { contains: q.q } }, { label: { contains: q.q } }] } : {}),
    },
    orderBy: [{ createdAt: 'asc' }],
    take: q.limit,
  });
  res.json({ data: await breakViews(rows, req), total: rows.length });
});

opsctlRoutes.get('/pay-recon/breaks/:id', ...canView, async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  const events = await prisma.payReconBreakEvent.findMany({ where: { breakId: b.id }, orderBy: { createdAt: 'asc' } });
  const names = await userNames(events.map((e) => e.actorId));
  const item = b.itemId ? await prisma.payReconItem.findUnique({ where: { id: b.itemId } }) : null;
  res.json({
    data: (await breakViews([b], req))[0],
    item: item ? { id: item.id, kind: item.kind, documentRef: item.documentRef, payeeName: item.payeeName, direction: item.direction, expectedAmount: f2(item.expectedAmount), currency: item.currency, dueDate: isoDay(item.dueDate), status: item.status } : null,
    events: events.map((e) => ({ id: e.id, action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, actor: e.actorId ? names.get(e.actorId) ?? null : null, note: e.note, detail: e.detail, at: iso(e.createdAt) })),
  });
});

async function move(
  req: Request,
  b: BreakRow,
  to: string,
  opts: { action: string; note?: string | null; data?: Prisma.PayReconBreakUncheckedUpdateManyInput; extra?: (tx: Prisma.TransactionClient) => Promise<void>; detail?: Prisma.InputJsonValue },
) {
  expectVersion(req, b.version);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.payReconBreak.updateMany({ where: { id: b.id, version: b.version, status: b.status }, data: { ...(opts.data ?? {}), status: to, version: { increment: 1 } } })).count);
    await tx.payReconBreakEvent.create({ data: { breakId: b.id, action: opts.action, fromStatus: b.status, toStatus: to, actorId: req.user!.id, note: opts.note ?? null, detail: opts.detail } });
    await writeAudit(tx, audit(req), {
      action: `pay_recon.break_${opts.action}`,
      objectType: 'pay_recon_break',
      objectId: b.id,
      before: { status: b.status, ref: b.ref },
      after: { status: to, ref: b.ref, kind: b.kind, severity: b.severity },
      reason: opts.note ?? null,
    });
    if (opts.extra) await opts.extra(tx);
  });
}
const respondBreak = async (req: Request, id: string, res: import('express').Response) => res.json({ data: (await breakViews([await loadBreak(id)], req))[0] });
const isWorkable = (b: BreakRow) => b.status === 'OPEN' || b.status === 'INVESTIGATING';
const notWorkable = (b: BreakRow, what: string) => HttpError.conflict(`${b.ref} is ${b.status.toLowerCase().replace(/_/g, ' ')}; ${what}`, 'invalid_transition');

const assignBody = z.object({ ownerUserId: id36, note: z.string().trim().max(500).optional() }).strict();
opsctlRoutes.post('/pay-recon/breaks/:id/assign', ...canManage, validateBody(assignBody), idempotent('pay_recon.assign', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (!isWorkable(b)) throw notWorkable(b, 'only an open break can be assigned');
  const body = req.body as z.infer<typeof assignBody>;
  const u = await prisma.user.findFirst({ where: { id: body.ownerUserId, isActive: true, roles: { some: { role: { portal: 'admin' } } } }, select: { id: true } });
  if (!u) throw HttpError.badRequest('Validation failed', [{ path: 'ownerUserId', message: 'Unknown, inactive or non-staff user' }]);
  await move(req, b, 'INVESTIGATING', {
    action: 'assigned',
    note: body.note ?? null,
    data: { ownerUserId: u.id },
    extra: async (tx) => {
      if (u.id !== req.user!.id) await enqueue(tx, 'notify.users', { userIds: [u.id], type: 'pay_recon.assigned', title: `Payment break ${b.ref} assigned to you`, body: b.label.slice(0, 300), link: '/ops/payments-recon' });
    },
  });
  await respondBreak(req, b.id, res);
});

const noteBody = z.object({ note: z.string().trim().min(3, 'Add a note (3+ characters)').max(1000) }).strict();
opsctlRoutes.post('/pay-recon/breaks/:id/investigate', ...canManage, validateBody(noteBody), idempotent('pay_recon.investigate', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (!isWorkable(b)) throw notWorkable(b, 'only an open break can be investigated');
  await move(req, b, 'INVESTIGATING', { action: 'investigating', note: (req.body as z.infer<typeof noteBody>).note, data: { ownerUserId: b.ownerUserId ?? req.user!.id } });
  await respondBreak(req, b.id, res);
});

const resolveBody = z
  .object({
    resolution: z.enum(RESOLUTIONS),
    rationale: z.string().trim().min(10, 'Explain the resolution (10+ characters)').max(1000),
    evidenceRef: z.string().trim().min(1, 'Reference the evidence').max(200),
    lineId: id36.optional(),
    itemId: id36.optional(),
    deferredUntil: dateStr.optional(),
  })
  .strict();

const sign = (v: Prisma.Decimal) => (v.gt(0) ? 'IN' : v.lt(0) ? 'OUT' : null);

/** The item and line a MANUAL_MATCH would pair, validated; used when resolving and again when approving. */
async function matchTargets(tx: Prisma.TransactionClient | typeof prisma, b: BreakRow, data: { lineId?: string | null; itemId?: string | null }) {
  const itemId = b.itemId ?? data.itemId ?? null;
  const lineId = b.lineId ?? data.lineId ?? null;
  if (!itemId) throw HttpError.badRequest('Validation failed', [{ path: 'itemId', message: 'Choose the expected payment to match' }]);
  if (!lineId) throw HttpError.badRequest('Validation failed', [{ path: 'lineId', message: 'Choose the statement line to match' }]);
  const [item, line] = await Promise.all([tx.payReconItem.findUnique({ where: { id: itemId } }), tx.cashStatementLine.findUnique({ where: { id: lineId }, include: { import: { select: { status: true } } } })]);
  if (!item) throw HttpError.badRequest('Validation failed', [{ path: 'itemId', message: 'Unknown expected payment' }]);
  if (!line || line.import.status !== 'COMMITTED' || line.status === 'IGNORED') throw HttpError.badRequest('Validation failed', [{ path: 'lineId', message: 'Unknown, ignored or uncommitted statement line' }]);
  if (sign(line.amount) !== item.direction) throw HttpError.badRequest('Validation failed', [{ path: 'lineId', message: `The line moves money ${sign(line.amount) === 'IN' ? 'in' : 'out'} but the payment is expected ${item.direction === 'IN' ? 'in' : 'out'}` }]);
  const ledger = await tx.cashLedger.findUnique({ where: { id: line.ledgerId }, select: { currency: true } });
  if (ledger && ledger.currency !== item.currency) throw HttpError.badRequest('Validation failed', [{ path: 'lineId', message: `The line is in ${ledger.currency}, the payment in ${item.currency}` }]);
  const held = await tx.payReconItem.findFirst({ where: { matchedLineId: lineId, id: { not: item.id } }, select: { documentRef: true, payeeName: true } });
  if (held) throw HttpError.conflict(`The line is already paired with ${held.documentRef} ${held.payeeName}`, 'line_already_matched');
  if (item.matchedLineId && item.matchedLineId !== lineId && item.matchMethod === 'MANUAL') throw HttpError.conflict('The payment already has a manual match', 'item_already_matched');
  return { item, line };
}

opsctlRoutes.post('/pay-recon/breaks/:id/resolve', ...canManage, validateBody(resolveBody), idempotent('pay_recon.resolve', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (!isWorkable(b)) throw notWorkable(b, 'only an open break can be resolved');
  const body = req.body as z.infer<typeof resolveBody>;
  let data: Prisma.InputJsonValue = {};
  if (body.resolution === 'MANUAL_MATCH') {
    const t = await matchTargets(prisma, b, body);
    data = { itemId: t.item.id, lineId: t.line.id };
  } else if (body.resolution === 'TIMING') {
    if (!b.itemId) throw HttpError.badRequest('Validation failed', [{ path: 'resolution', message: 'A timing resolution applies to an expected payment, not to a statement line' }]);
    if (!body.deferredUntil || body.deferredUntil < todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'deferredUntil', message: 'Give the date the payment is now expected (today or later)' }]);
    data = { deferredUntil: body.deferredUntil };
  }
  await move(req, b, 'PENDING_CHECKER', {
    action: 'resolved',
    note: body.rationale,
    data: { resolution: body.resolution, rationale: body.rationale, evidenceRef: body.evidenceRef, resolutionData: data, makerId: req.user!.id, checkerId: null },
    detail: { resolution: body.resolution, evidenceRef: body.evidenceRef },
    extra: (tx) => notifyPermission(tx, 'recon.signoff', { type: 'pay_recon.pending_checker', title: `Payment break ${b.ref} awaits a checker`, body: `${body.resolution.toLowerCase().replace(/_/g, ' ')}: ${body.rationale.slice(0, 200)}`, link: '/ops/payments-recon' }),
  });
  await respondBreak(req, b.id, res);
});

opsctlRoutes.post('/pay-recon/breaks/:id/approve', ...canSignoff, requireStepUp, idempotent('pay_recon.approve', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (b.status !== 'PENDING_CHECKER') throw notWorkable(b, 'only a resolution awaiting a checker can be approved');
  if (b.makerId === req.user!.id) throw HttpError.forbidden('The person who resolved the break cannot approve it (maker-checker)', 'segregation_of_duties');
  const rd = (b.resolutionData ?? {}) as { itemId?: string; lineId?: string; deferredUntil?: string };
  const now = new Date();
  await move(req, b, 'RESOLVED', {
    action: 'approved',
    note: b.rationale,
    data: { checkerId: req.user!.id, resolvedAt: now },
    detail: { resolution: b.resolution },
    extra: async (tx) => {
      const tol = new D(DEFAULT_PAY_PARAMS.tolerance);
      if (b.resolution === 'MANUAL_MATCH') {
        const t = await matchTargets(tx, b, rd);
        const actual = t.line.amount.abs();
        const ok = actual.sub(t.item.expectedAmount).abs().lte(tol);
        try {
          await tx.payReconItem.update({ where: { id: t.item.id }, data: { matchedLineId: t.line.id, matchedAmount: actual, matchMethod: 'MANUAL', matchedAt: now, status: ok ? 'MATCHED' : 'ACCEPTED', version: { increment: 1 } } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw HttpError.conflict('The line was paired with another payment meanwhile', 'line_already_matched');
          throw e;
        }
        // The pairing answers every open break on this payment and this line.
        const keys = [`ITEM:${t.item.kind}:${t.item.sourceId}`, `LINE:${t.line.id}`];
        const sib = await tx.payReconBreak.findMany({ where: { itemKey: { in: keys }, id: { not: b.id }, status: { in: ['OPEN', 'INVESTIGATING'] } } });
        for (const s of sib) {
          await tx.payReconBreak.update({ where: { id: s.id }, data: { status: 'AUTO_CLEARED', resolvedAt: now, version: { increment: 1 } } });
          await tx.payReconBreakEvent.create({ data: { breakId: s.id, action: 'auto_cleared', fromStatus: s.status, toStatus: 'AUTO_CLEARED', actorId: req.user!.id, note: `Paired manually through ${b.ref}` } });
        }
      } else if (b.resolution === 'ACCEPT_DIFFERENCE' && b.itemId) {
        await tx.payReconItem.update({ where: { id: b.itemId }, data: { status: 'ACCEPTED', version: { increment: 1 } } });
      } else if (b.resolution === 'TIMING' && b.itemId && rd.deferredUntil) {
        await tx.payReconItem.update({ where: { id: b.itemId }, data: { status: 'DEFERRED', deferredUntil: dayStart(rd.deferredUntil), version: { increment: 1 } } });
      }
      if (b.makerId) await enqueue(tx, 'notify.users', { userIds: [b.makerId], type: 'pay_recon.approved', title: `Payment break ${b.ref} was approved`, link: '/ops/payments-recon' });
    },
  });
  await respondBreak(req, b.id, res);
});

const rejectBody = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
opsctlRoutes.post('/pay-recon/breaks/:id/reject', ...canSignoff, validateBody(rejectBody), idempotent('pay_recon.reject', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (b.status !== 'PENDING_CHECKER') throw notWorkable(b, 'only a resolution awaiting a checker can be rejected');
  if (b.makerId === req.user!.id) throw HttpError.forbidden('The person who resolved the break cannot reject it (maker-checker)', 'segregation_of_duties');
  const reason = (req.body as z.infer<typeof rejectBody>).reason;
  await move(req, b, 'INVESTIGATING', {
    action: 'rejected',
    note: reason,
    data: { resolution: null, resolutionData: Prisma.JsonNull, checkerId: null },
    extra: async (tx) => {
      if (b.makerId) await enqueue(tx, 'notify.users', { userIds: [b.makerId], type: 'pay_recon.rejected', title: `Payment break ${b.ref} was sent back`, body: reason, link: '/ops/payments-recon' });
    },
  });
  await respondBreak(req, b.id, res);
});

// ================================================================ settlement fails

const failsQuery = z.object({ asOf: dateStr.optional(), counterpartyId: z.string().optional(), portfolioId: z.string().optional(), status: z.enum(['open', 'all']).default('open') });

opsctlRoutes.get('/settlement-fails', ...canView, validateQuery(failsQuery), async (req, res) => {
  const q = query<z.infer<typeof failsQuery>>(req);
  const asOf = q.asOf ?? todayIso();
  const cp = q.counterpartyId ? await prisma.counterparty.findFirst({ where: uuidLike(q.counterpartyId) ? { id: q.counterpartyId } : { ref: q.counterpartyId }, select: { id: true } }) : null;
  const pf = q.portfolioId ? await prisma.portfolio.findFirst({ where: uuidLike(q.portfolioId) ? { id: q.portfolioId } : { ref: q.portfolioId }, select: { id: true } }) : null;
  const rows = await prisma.reconBreak.findMany({
    where: { family: 'SETTLEMENT_FAILS', ...(q.status === 'open' ? { status: { in: OPEN_STATUSES } } : {}), ...(cp ? { counterpartyId: cp.id } : {}), ...(pf ? { portfolioId: pf.id } : {}), run: { asOfDate: { lte: dayStart(asOf) } } },
    orderBy: [{ createdAt: 'asc' }],
    take: 500,
    include: { run: { select: { ref: true, asOfDate: true } } },
  });
  const [cps, pfs, names] = await Promise.all([
    prisma.counterparty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.counterpartyId).filter((x): x is string => !!x))] } }, select: { id: true, ref: true, name: true } }),
    prisma.portfolio.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.portfolioId).filter((x): x is string => !!x))] } }, select: { id: true, ref: true, name: true } }),
    userNames(rows.map((r) => r.ownerUserId)),
  ]);
  const cpm = new Map(cps.map((c) => [c.id, c]));
  const pfm = new Map(pfs.map((p) => [p.id, p]));
  const fails = rows.map((r) => {
    const inn = (r.internalValue ?? {}) as Record<string, string>;
    const ext = (r.externalValue ?? {}) as Record<string, string>;
    const open = (OPEN_STATUSES as string[]).includes(r.status);
    const lateAtRun = Number(r.difference ?? 0);
    const sinceRun = Math.max(0, Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${isoDay(r.run.asOfDate)}T00:00:00Z`)) / 86_400_000));
    const daysLate = open ? lateAtRun + sinceRun : lateAtRun;
    return {
      id: r.id,
      ref: r.ref,
      runRef: r.run.ref,
      orderRef: inn.orderRef ?? null,
      ticker: inn.ticker ?? null,
      side: inn.side ?? null,
      quantity: inn.quantity ?? null,
      tradeDate: inn.tradeDate ?? null,
      expectedSettlement: ext.expectedSettlement ?? null,
      expectedFrom: ext.expectedFrom ?? null,
      account: ext.account ?? null,
      currency: r.currency,
      daysLate,
      bucket: daysLate >= 6 ? '6+' : daysLate >= 3 ? '3-5' : '1-2',
      severity: r.severity,
      status: r.status,
      owner: r.ownerUserId ? names.get(r.ownerUserId) ?? null : null,
      counterparty: r.counterpartyId && cpm.get(r.counterpartyId) ? { id: r.counterpartyId, ref: cpm.get(r.counterpartyId)!.ref, name: cpm.get(r.counterpartyId)!.name } : null,
      portfolio: r.portfolioId && pfm.get(r.portfolioId) ? { id: r.portfolioId, ref: pfm.get(r.portfolioId)!.ref, name: pfm.get(r.portfolioId)!.name } : null,
      open,
    };
  });
  const openFails = fails.filter((f) => f.open);
  const group = <K extends string>(keyOf: (f: (typeof fails)[number]) => K) => {
    const m = new Map<K, number>();
    for (const f of openFails) m.set(keyOf(f), (m.get(keyOf(f)) ?? 0) + 1);
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };
  const lastRun = await prisma.reconRun.findFirst({ where: { family: 'SETTLEMENT_FAILS' }, orderBy: [{ asOfDate: 'desc' }, { updatedAt: 'desc' }], select: { ref: true, asOfDate: true, status: true, updatedAt: true } });
  res.json({
    data: fails,
    summary: {
      asOf,
      open: openFails.length,
      oldestDaysLate: openFails.reduce((m, f) => Math.max(m, f.daysLate), 0),
      material: openFails.filter((f) => (MATERIAL_SEV as string[]).includes(f.severity)).length,
      byBucket: ['1-2', '3-5', '6+'].map((k) => ({ key: k, count: openFails.filter((f) => f.bucket === k).length })),
      byCounterparty: group((f) => f.counterparty?.name ?? 'Unassigned'),
      byTicker: group((f) => f.ticker ?? 'Unknown'),
      lastRun: lastRun ? { ref: lastRun.ref, asOfDate: isoDay(lastRun.asOfDate), status: lastRun.status, updatedAt: iso(lastRun.updatedAt) } : null,
      stale: !lastRun || isoDay(lastRun.asOfDate)! < asOf,
    },
  });
});

// ================================================================ custody positions through the custodian-feed adapter

const pullBody = z.object({ asOfDate: dateStr, counterpartyId: id36.optional(), accountRef: z.string().trim().min(1).max(64).optional(), run: z.boolean().optional() }).strict();

interface PullResult {
  counterpartyRef: string;
  accountRef: string;
  status: 'received' | 'unchanged' | 'no_statement' | 'signed_off' | 'error';
  rows?: number;
  statementId?: string;
  message?: string;
}

opsctlRoutes.post('/custody-positions/pull', ...canManage, validateBody(pullBody), idempotent('recon.positions_pull', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof pullBody>;
  if (b.asOfDate > todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'asOfDate', message: 'The date cannot be in the future' }]);
  if (b.accountRef && !b.counterpartyId) throw HttpError.badRequest('Validation failed', [{ path: 'counterpartyId', message: 'Choose the counterparty that holds the account' }]);
  // Targets: the named account, or every mapped custodian account.
  const maps = await prisma.reconAccountMap.findMany({ where: b.counterpartyId ? { counterpartyId: b.counterpartyId } : {}, select: { counterpartyId: true, accountRef: true } });
  const wanted = b.accountRef ? [{ counterpartyId: b.counterpartyId!, accountRef: b.accountRef }] : maps;
  if (!wanted.length) throw HttpError.conflict('No custodian accounts are mapped to portfolios; map them on the reconciliation page first', 'no_account_mapping');
  const cps = await prisma.counterparty.findMany({ where: { id: { in: [...new Set(wanted.map((w) => w.counterpartyId))] } } });
  const cpById = new Map(cps.map((c) => [c.id, c]));
  const adapter = getCustodianFeedAdapter();
  const results: PullResult[] = [];

  for (const w of wanted) {
    const cp = cpById.get(w.counterpartyId);
    if (!cp) throw HttpError.badRequest('Validation failed', [{ path: 'counterpartyId', message: 'Unknown counterparty' }]);
    const base = { counterpartyRef: cp.ref, accountRef: w.accountRef };
    const known = accountRefs(cp.accounts);
    if (known.length && !known.includes(w.accountRef)) throw HttpError.badRequest('Validation failed', [{ path: 'accountRef', message: `Not one of ${cp.name}'s accounts (${known.join(', ')})` }]);
    try {
      const stmts = await adapter.listStatements({ counterpartyId: cp.id, accountRef: w.accountRef, from: b.asOfDate, to: b.asOfDate, limit: 5 });
      const st = stmts.find((s) => s.statementDate === b.asOfDate);
      if (!st) {
        results.push({ ...base, status: 'no_statement', message: `The custodian feed (${adapter.name}) has no statement for ${b.asOfDate}` });
        continue;
      }
      const signed = await prisma.reconSignoff.findFirst({ where: { family: 'POSITIONS_VS_CUSTODY', asOfDate: dayStart(b.asOfDate), OR: [{ counterpartyId: null }, { counterpartyId: cp.id }] }, select: { id: true } });
      if (signed) {
        results.push({ ...base, status: 'signed_off', statementId: st.id, message: 'Positions vs custody is signed off for this date; reopen a break to replace the source' });
        continue;
      }
      const holdings = await adapter.fetchHoldings(st.id);
      const qty = new Map<string, { qty: Prisma.Decimal; isin: string | null }>();
      for (const h of holdings) {
        const t = h.ticker.trim().toUpperCase();
        if (!t || !/^\d+(\.\d{1,8})?$/.test(h.quantity.trim())) continue;
        const cur = qty.get(t);
        qty.set(t, { qty: (cur?.qty ?? new D(0)).add(h.quantity.trim()), isin: cur?.isin ?? (h.isin?.trim() || null) });
      }
      const rows = [...qty.entries()].sort(([a], [c]) => a.localeCompare(c)).map(([ticker, v]) => ({ ticker, isin: v.isin, quantity: v.qty.toString() }));
      const csv = ['ticker,quantity,isin', ...rows.map((r) => `"${r.ticker}",${r.quantity},"${r.isin ?? ''}"`)].join('\n');
      const sha = sha256Hex(csv);
      const where = { counterpartyId_accountRef_asOfDate_feed: { counterpartyId: cp.id, accountRef: w.accountRef, asOfDate: dayStart(b.asOfDate), feed: 'POSITIONS' } };
      const before = await prisma.reconSourceReceipt.findUnique({ where });
      if (before && before.sha256 === sha) {
        results.push({ ...base, status: 'unchanged', rows: rows.length, statementId: st.id, message: 'The feed returned the same positions as the file already received' });
        continue;
      }
      await prisma.$transaction(async (tx) => {
        const batchRef = await seqRef(tx, 'reconFeed', 'FEED-', 5, 1);
        const file = await storeFile({ name: `positions-${cp.ref}-${w.accountRef}-${b.asOfDate}.csv`, mime: 'text/csv', data: Buffer.from(csv, 'utf8'), uploadedById: req.user!.id }, tx);
        await tx.reconCustodyPosition.deleteMany({ where: { counterpartyId: cp.id, accountRef: w.accountRef, asOfDate: dayStart(b.asOfDate) } });
        if (rows.length) await tx.reconCustodyPosition.createMany({ data: rows.map((r) => ({ counterpartyId: cp.id, accountRef: w.accountRef, asOfDate: dayStart(b.asOfDate), ticker: r.ticker, isin: r.isin, quantity: r.quantity, batchRef, createdBy: req.user!.id })) });
        const note = `Pulled through the custodian-feed adapter (${adapter.name}), statement ${st.id}`.slice(0, 500);
        const receipt = await tx.reconSourceReceipt.upsert({
          where,
          update: { rowCount: rows.length, sha256: file.sha256, fileId: file.id, version: { increment: 1 }, note, receivedBy: req.user!.id, receivedAt: new Date() },
          create: { counterpartyId: cp.id, accountRef: w.accountRef, asOfDate: dayStart(b.asOfDate), feed: 'POSITIONS', rowCount: rows.length, sha256: file.sha256, fileId: file.id, note, receivedBy: req.user!.id },
        });
        await writeAudit(tx, audit(req), {
          action: 'recon.custody_positions_pulled',
          objectType: 'recon_source_receipt',
          objectId: receipt.id,
          before: before ? { rowCount: before.rowCount, sha256: before.sha256, version: before.version } : null,
          after: { counterparty: cp.ref, accountRef: w.accountRef, asOfDate: b.asOfDate, rows: rows.length, sha256: file.sha256, version: receipt.version, batchRef, adapter: adapter.name, statementId: st.id },
        });
      });
      results.push({ ...base, status: 'received', rows: rows.length, statementId: st.id });
    } catch (e) {
      if (e instanceof IntegrationNotConfiguredError || e instanceof HttpError) throw e;
      results.push({ ...base, status: 'error', message: e instanceof Error ? e.message.slice(0, 300) : 'Pull failed' });
    }
  }

  let run: { id: string; ref: string; status: string; matchedCount: number; breakCount: number; rerun: boolean } | null = null;
  let runError: string | null = null;
  if (b.run && results.some((r) => r.status === 'received' || r.status === 'unchanged')) {
    try {
      const eff = await resolveTolerances('POSITIONS_VS_CUSTODY', b.counterpartyId ?? null, b.asOfDate);
      const r = await executeRun(req, { family: 'POSITIONS_VS_CUSTODY', asOfDate: b.asOfDate, counterpartyId: b.counterpartyId ?? null, portfolioId: null, tolerances: eff.tolerances, toleranceSources: eff.sources });
      const row = await prisma.reconRun.findUniqueOrThrow({ where: { id: r.runId } });
      run = { id: row.id, ref: row.ref, status: row.status, matchedCount: row.matchedCount, breakCount: row.breakCount, rerun: r.rerun };
    } catch (e) {
      runError = e instanceof Error ? e.message : 'The matching run failed';
    }
  }
  res.json({ data: { adapter: adapter.name, asOfDate: b.asOfDate, results, run, runError } });
});

// A scope-key helper is exported for the flow test.
export { payScopeKey };
