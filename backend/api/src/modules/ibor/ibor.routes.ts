import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { bookHealth, iso, ledgerPage, LEDGER_SORTS, lotViews, overview, positionRows, queueRefreshJob, reconcilePositions, refreshBook, refreshJobView, RefreshBusy, scope, settlementLadder, sweepStaleRefreshJobs } from './ibor.service';
import { utcDay } from './ibor.engine';

/**
 * IBOR & Positions (SRD 5.A.14 `ibor`, `portfolio.view`). Admin-portal staff only. Mounted at `/api/v1/ibor`, after the
 * portfolio foundation (which owns `GET /ibor/positions`). `portfolio.view` reads; `portfolio.manage` refreshes the
 * book (lots rebuilt from fills, drift booked as a lineage event); `recon.manage` requests the holdings
 * reconciliation through the Reconciliations module.
 */
export const iborRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('portfolio.view')];
const canRefresh = [...staff, requirePermission('portfolio.view'), requirePermission('portfolio.manage')];
const canReconcile = [...staff, requirePermission('portfolio.view'), requirePermission('recon.manage')];

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const asOfOf = (v?: string) => (v ? toDate(v) : utcDay(new Date()));

const scopeQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), asOf: dateStr.optional() });

async function scopeOrFail(id?: string) {
  const list = await scope(id);
  if (id && !list.length) throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  return list;
}

iborRoutes.get('/overview', ...canView, validateQuery(scopeQuery), async (req, res) => {
  const f = query<z.infer<typeof scopeQuery>>(req);
  const portfolios = await scopeOrFail(f.portfolioId);
  res.json({ data: await overview(portfolios, asOfOf(f.asOf)) });
});

const ledgerQuery = scopeQuery.extend({
  assetClass: z.string().trim().max(24).optional(),
  state: z.enum(['Current', 'Review']).optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(LEDGER_SORTS).default('ticker'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * FR-IBOR-002: search (ticker, name, ISIN, portfolio, asset class), asset-class filter, sort and paging run in SQL, and
 * only the returned page is valued. The data-state filter needs valuation, so with `state` the whole book is valued and
 * filtered in memory (`paging: "memory"` in the response says which path answered).
 */
iborRoutes.get('/ledger', ...canView, validateQuery(ledgerQuery), async (req, res) => {
  const f = query<z.infer<typeof ledgerQuery>>(req);
  const portfolios = await scopeOrFail(f.portfolioId);
  if (!f.state) {
    const { rows, total } = await ledgerPage(portfolios, asOfOf(f.asOf), { q: f.q, assetClass: f.assetClass, sort: f.sort, dir: f.dir, limit: f.limit, offset: f.offset });
    return void res.json({ data: rows, total, asOf: iso(asOfOf(f.asOf)), paging: 'sql' });
  }
  const { rows } = await positionRows(portfolios, asOfOf(f.asOf));
  const needle = f.q?.toLowerCase();
  const out = rows.filter(
    (r) =>
      (!f.assetClass || r.assetClass === f.assetClass) &&
      (!f.state || r.state === f.state) &&
      (!needle || `${r.ticker} ${r.name} ${r.portfolioName} ${r.assetClass}`.toLowerCase().includes(needle)),
  );
  res.json({ data: out.slice(f.offset, f.offset + f.limit), total: out.length, asOf: iso(asOfOf(f.asOf)), paging: 'memory' });
});

iborRoutes.get('/settlement-ladder', ...canView, validateQuery(scopeQuery), async (req, res) => {
  const f = query<z.infer<typeof scopeQuery>>(req);
  res.json({ data: await settlementLadder(await scopeOrFail(f.portfolioId), asOfOf(f.asOf)) });
});

iborRoutes.get('/health', ...canView, validateQuery(scopeQuery), async (req, res) => {
  const f = query<z.infer<typeof scopeQuery>>(req);
  res.json({ data: await bookHealth(await scopeOrFail(f.portfolioId)) });
});

const lotsQuery = z.object({ portfolioId: z.string().trim().min(1).max(36), securityId: z.string().trim().max(36).optional(), status: z.enum(['OPEN', 'CLOSED']).optional() });
iborRoutes.get('/lots', ...canView, validateQuery(lotsQuery), async (req, res) => {
  const f = query<z.infer<typeof lotsQuery>>(req);
  const [p] = await scopeOrFail(f.portfolioId);
  res.json(await lotViews(p!.id, f.securityId, f.status));
});

const eventsQuery = z.object({
  portfolioId: z.string().trim().max(36).optional(),
  securityId: z.string().trim().max(36).optional(),
  type: z.enum(['OPENING', 'FILL', 'ADJUSTMENT', 'REFRESH', 'RECON']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

async function eventViews(rows: Prisma.IborEventGetPayload<object>[]) {
  const secs = await prisma.security.findMany({ where: { id: { in: rows.map((r) => r.securityId).filter((x): x is string => !!x) } }, select: { id: true, ticker: true } });
  const pfs = await prisma.portfolio.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.portfolioId))] } }, select: { id: true, ref: true, name: true } });
  const sec = new Map(secs.map((s) => [s.id, s.ticker]));
  const pf = new Map(pfs.map((p) => [p.id, p]));
  return rows.map((e) => ({
    id: e.id,
    ref: e.ref,
    type: e.eventType,
    portfolioId: e.portfolioId,
    portfolioRef: pf.get(e.portfolioId)?.ref ?? null,
    portfolioName: pf.get(e.portfolioId)?.name ?? null,
    securityId: e.securityId,
    ticker: e.securityId ? (sec.get(e.securityId) ?? null) : null,
    quantityDelta: e.quantityDelta?.toString() ?? null,
    price: e.price?.toString() ?? null,
    effectiveDate: iso(e.effectiveDate),
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    summary: e.summary,
    detail: e.detail,
    createdAt: e.createdAt.toISOString(),
  }));
}

iborRoutes.get('/events', ...canView, validateQuery(eventsQuery), async (req, res) => {
  const f = query<z.infer<typeof eventsQuery>>(req);
  const pid = f.portfolioId ? (await scopeOrFail(f.portfolioId))[0]!.id : undefined;
  const where: Prisma.IborEventWhereInput = { ...(pid ? { portfolioId: pid } : {}), ...(f.securityId ? { securityId: f.securityId } : {}), ...(f.type ? { eventType: f.type } : {}) };
  const [total, rows] = await Promise.all([prisma.iborEvent.count({ where }), prisma.iborEvent.findMany({ where, orderBy: { ref: 'desc' }, take: f.limit, skip: f.offset })]);
  res.json({ data: await eventViews(rows), total });
});

iborRoutes.get('/snapshots', ...canView, async (_req, res) => {
  const rows = await prisma.iborSnapshot.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  res.json({
    data: rows.map((s) => ({ id: s.id, ref: s.ref, portfolioId: s.portfolioId, asOf: iso(s.asOf), status: s.status, positionCount: s.positionCount, marketValueBase: s.marketValueBase.toFixed(2), eventsIngested: s.eventsIngested, lotsOpened: s.lotsOpened, adjustments: s.adjustments, exceptionCount: s.exceptionCount, durationMs: s.durationMs, createdAt: s.createdAt.toISOString() })),
  });
});

const posQuery = z.object({ portfolioId: z.string().trim().min(1).max(36), securityId: z.string().trim().min(1).max(36), asOf: dateStr.optional() });
/** Position second layer: the valued line, lots and settlement, reconciliation and history tabs. */
iborRoutes.get('/position', ...canView, validateQuery(posQuery), async (req, res) => {
  const f = query<z.infer<typeof posQuery>>(req);
  const [p] = await scopeOrFail(f.portfolioId);
  const { rows } = await positionRows([p!], asOfOf(f.asOf));
  const line = rows.find((r) => r.securityId === f.securityId);
  if (!line) throw HttpError.notFound('This portfolio does not hold that security at the date');
  const [lots, events, history, fills, orders, runs] = await Promise.all([
    lotViews(p!.id, f.securityId),
    prisma.iborEvent.findMany({ where: { portfolioId: p!.id, securityId: f.securityId }, orderBy: { ref: 'desc' }, take: 50 }),
    prisma.portfolioPosition.findMany({ where: { portfolioId: p!.id, securityId: f.securityId }, orderBy: { asOf: 'desc' }, take: 60 }),
    prisma.orderFill.findMany({ where: { order: { portfolioId: p!.id, securityId: f.securityId, status: { in: ['PartiallyFilled', 'Filled'] } } }, include: { order: { select: { ref: true, side: true, status: true } } }, orderBy: { executedAt: 'desc' }, take: 50 }),
    prisma.order.findMany({ where: { portfolioId: p!.id, securityId: f.securityId }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, ref: true, side: true, status: true, quantity: true, filledQty: true } }),
    prisma.reconBreak.findMany({ where: { portfolioId: p!.id, family: 'HOLDINGS' }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, ref: true, label: true, status: true, severity: true, difference: true } }),
  ]);
  res.json({
    data: {
      position: line,
      lots: lots.data,
      lotSummary: lots.summary,
      unsettledFills: fills.map((x) => ({ id: x.id, orderRef: x.order.ref, side: x.order.side, status: x.order.status, quantity: x.quantity.toString(), price: x.price.toString(), executedAt: x.executedAt.toISOString() })),
      events: await eventViews(events),
      history: history.map((h) => ({ asOf: iso(h.asOf), quantity: h.quantity.toString(), avgCost: h.avgCost.toString() })),
      orders: orders.map((o) => ({ id: o.id, ref: o.ref, side: o.side, status: o.status, quantity: o.quantity.toString(), filledQty: o.filledQty.toString() })),
      reconciliation: runs.map((b) => ({ id: b.id, ref: b.ref, label: b.label, status: b.status, severity: b.severity, difference: b.difference?.toString() ?? null })),
    },
  });
});

const refreshBody = z.object({ portfolioId: z.string().trim().max(36).nullish(), /** true: queue a background job and answer 202 with its id (FR-IBOR-004) */ async: z.boolean().optional() }).strict();
iborRoutes.post('/refresh', ...canRefresh, validateBody(refreshBody), idempotent('ibor.refresh'), async (req, res) => {
  const b = req.body as z.infer<typeof refreshBody>;
  const portfolios = await scopeOrFail(b.portfolioId ?? undefined);
  if (b.async) {
    try {
      const job = await queueRefreshJob(req, portfolios, b.portfolioId ? portfolios[0]!.id : null);
      return void res.status(202).json({ data: refreshJobView(job) });
    } catch (err) {
      if (err instanceof RefreshBusy) throw HttpError.conflict(err.message, 'refresh_in_progress');
      throw err;
    }
  }
  try {
    const out = await refreshBook(req, portfolios, utcDay(new Date()));
    res.status(201).json({
      data: {
        id: out.snapshot.id,
        ref: out.snapshot.ref,
        status: out.snapshot.status,
        asOf: iso(out.snapshot.asOf),
        positionCount: out.snapshot.positionCount,
        marketValueBase: out.snapshot.marketValueBase.toFixed(2),
        eventsIngested: out.result.eventsIngested,
        lotsOpened: out.result.lotsOpened,
        adjustments: out.result.adjustments,
        exceptions: out.result.exceptions,
        durationMs: out.snapshot.durationMs,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw HttpError.conflict('Another IBOR refresh is running for this book. Try again in a moment.', 'refresh_in_progress');
    throw err;
  }
});

const jobsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10), status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']).optional(), mine: z.enum(['1', 'true']).optional() });
/** Recent refresh jobs, newest first; the page polls the one it started. */
iborRoutes.get('/refresh-jobs', ...canView, validateQuery(jobsQuery), async (req, res) => {
  const f = query<z.infer<typeof jobsQuery>>(req);
  await sweepStaleRefreshJobs();
  const rows = await prisma.iborRefreshJob.findMany({ where: { ...(f.status ? { status: f.status } : {}), ...(f.mine ? { requestedBy: req.user!.id } : {}) }, orderBy: { requestedAt: 'desc' }, take: f.limit });
  res.json({ data: rows.map(refreshJobView), total: rows.length });
});

iborRoutes.get('/refresh-jobs/:id', ...canView, async (req, res) => {
  await sweepStaleRefreshJobs();
  const j = await prisma.iborRefreshJob.findUnique({ where: { id: String(req.params.id) } });
  if (!j) throw HttpError.notFound('Refresh job not found');
  res.json({ data: refreshJobView(j) });
});

const reconcileBody = z.object({ portfolioId: z.string().trim().min(1).max(36), asOfDate: dateStr.optional() }).strict();
iborRoutes.post('/reconcile', ...canReconcile, validateBody(reconcileBody), idempotent('ibor.reconcile'), async (req, res) => {
  const b = req.body as z.infer<typeof reconcileBody>;
  const [p] = await scopeOrFail(b.portfolioId);
  const asOfDate = b.asOfDate ?? iso(utcDay(new Date()))!;
  if (asOfDate > iso(utcDay(new Date()))!) throw HttpError.badRequest('Validation failed', [{ path: 'asOfDate', message: 'The date cannot be in the future' }]);
  res.status(201).json({ data: await reconcilePositions(req, p!, asOfDate) });
});
