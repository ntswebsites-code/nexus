import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { sha256Hex } from '../../lib/crypto';
import { sendTable } from '../../lib/tabular';
import { nextRef } from '../../lib/refs';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { scope, type PortfolioRow } from '../ibor/ibor.service';
import { compute, evaluateControls, resolveBenchmark, type Computed } from './perf.service';
import { pct6 } from './perf.engine';

/**
 * Performance & Attribution (SRD 5.A.8 `performance`, `reports.view`; BR-030, FR-PERF-001..003). Admin-portal staff
 * only. Mounted at `/api/v1/performance`. `reports.view` reads live returns, attribution and periods;
 * `reports.create` prepares periods (DRAFT), recomputes drafts, starts corrections and maintains benchmark
 * compositions; `performance.lock` (+ step-up MFA, never the preparer) locks a period as Official once all five controls
 * are done and the stored evidence still matches the live data. A locked period is immutable.
 */
export const performanceRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('reports.view')];
const canPrepare = [...staff, requirePermission('reports.view'), requirePermission('reports.create')];
const canLock = [...staff, requirePermission('reports.view'), requirePermission('performance.lock')];

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const todayIso = () => iso(new Date())!;

async function onePortfolio(id: string): Promise<PortfolioRow> {
  const [p] = await scope(id);
  if (!p) throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  return p;
}

/** Default window: from the earliest to the latest price date known for the portfolio's holdings. */
async function defaultWindow(p: PortfolioRow) {
  const pos = await prisma.portfolioPosition.findMany({ where: { portfolioId: p.id }, select: { securityId: true } });
  const ids = [...new Set(pos.map((x) => x.securityId))];
  const g = await prisma.securityPrice.aggregate({ where: { securityId: { in: ids } }, _min: { priceDate: true }, _max: { priceDate: true } });
  const end = g._max.priceDate ? iso(g._max.priceDate)! : todayIso();
  const startRaw = g._min.priceDate ? g._min.priceDate : new Date(Date.now() - 30 * 86_400_000);
  const start = iso(startRaw)!;
  return { start: start < end ? start : iso(new Date(new Date(`${end}T00:00:00Z`).getTime() - 86_400_000))!, end };
}

const headline = (c: Computed) => ({
  startValue: c.startValue.toFixed(2),
  endValue: c.endValue.toFixed(2),
  netFlows: c.netFlows.toFixed(2),
  twrPct: pct6(c.twr),
  benchmarkPct: c.benchTwr === null ? null : pct6(c.benchTwr),
  activePct: c.active === null ? null : pct6(c.active),
  dayCount: c.dates.length - 1,
  baseCurrency: c.baseCurrency,
});

const windowQuery = z.object({ portfolioId: z.string().trim().min(1).max(36), from: dateStr.optional(), to: dateStr.optional(), benchmarkId: z.string().trim().max(36).optional() });

async function live(f: z.infer<typeof windowQuery>) {
  const p = await onePortfolio(f.portfolioId);
  const w = await defaultWindow(p);
  const start = f.from ?? w.start;
  const end = f.to ?? w.end;
  if (end > todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'to', message: 'The period end cannot be in the future' }]);
  const benchmark = await resolveBenchmark(p, f.benchmarkId);
  const c = await compute(p, benchmark, start, end);
  return { p, start, end, benchmark, c };
}

// ================================================================ live reads

performanceRoutes.get('/returns', ...canView, validateQuery(windowQuery), async (req, res) => {
  const { p, start, end, benchmark, c } = await live(query<z.infer<typeof windowQuery>>(req));
  const controls = await evaluateControls(p, benchmark, start, end, c);
  res.json({ data: { portfolioId: p.id, portfolioRef: p.ref, portfolioName: p.name, periodStart: start, periodEnd: end, benchmark: c.attribution.benchmark, ...headline(c), series: c.series, issues: c.issues, controls: controls.items, controlsPending: controls.pending, navCheck: controls.navCheck, method: 'Net time-weighted return: daily geometric chaining, external flows neutralised at the start of the day, benchmark constant-mix on constituent prices.' } });
});

performanceRoutes.get('/attribution', ...canView, validateQuery(windowQuery), async (req, res) => {
  const { p, start, end, c } = await live(query<z.infer<typeof windowQuery>>(req));
  res.json({ data: { portfolioId: p.id, portfolioName: p.name, periodStart: start, periodEnd: end, ...headline(c), ...c.attribution, contributions: c.contributions } });
});

const attributionExportQuery = windowQuery.extend({ format: z.enum(['csv', 'xlsx']).default('csv') });

/**
 * FR-PERF-005: the displayed attribution as CSV or XLSX. One row per sector segment, a TOTAL row, then one row per
 * holding's contribution, all for the selected portfolio and period, with the weights as shown. Audited with the
 * file's content hash so the exact numbers handed out can be shown later.
 */
performanceRoutes.get('/attribution/export', ...canView, validateQuery(attributionExportQuery), async (req, res) => {
  const { format, ...f } = query<z.infer<typeof attributionExportQuery>>(req);
  const { p, start, end, c } = await live(f);
  const head = ['Portfolio', 'Period start', 'Period end', 'Section', 'Name', 'Sector', 'Avg weight %', 'Benchmark weight %', 'Return %', 'Benchmark return %', 'Allocation bps', 'Selection bps', 'Interaction bps', 'Total bps', 'Contribution bps'];
  const base = [p.ref, start, end];
  const rows: string[][] = [];
  for (const sg of c.attribution.segments) rows.push([...base, 'SECTOR', sg.sector, sg.sector, sg.avgWeightPct, sg.benchWeightPct, sg.portfolioReturnPct ?? '', sg.benchmarkReturnPct ?? '', String(sg.allocationBps), String(sg.selectionBps), String(sg.interactionBps), String(sg.totalBps), '']);
  const t = c.attribution.totals;
  rows.push([...base, 'TOTAL', 'Total', '', '', '', pct6(c.twr), c.benchTwr === null ? '' : pct6(c.benchTwr), String(t.allocationBps), String(t.selectionBps), String(t.interactionBps), String(t.explainedBps), '']);
  for (const k of c.contributions) rows.push([...base, 'HOLDING', k.ticker, k.sector, k.avgWeightPct, k.benchWeightPct ?? '', k.returnPct ?? '', '', '', '', '', '', String(k.contributionBps)]);
  await prisma.$transaction((tx) =>
    writeAudit(tx, audit(req), {
      action: 'performance.attribution_exported',
      objectType: 'portfolio',
      objectId: p.id,
      after: { portfolio: p.ref, periodStart: start, periodEnd: end, benchmark: c.attribution.benchmark?.code ?? null, format, rows: rows.length, sha256: sha256Hex(JSON.stringify([head, rows])), calcHash: c.hash },
    }),
  );
  sendTable(res, format, `attribution-${p.ref}-${start}-${end}`, head, rows, 'Attribution');
});

const summaryQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
/** One row per portfolio over the same window (default: the window of each portfolio's price history). */
performanceRoutes.get('/summary', ...canView, validateQuery(summaryQuery), async (req, res) => {
  const f = query<z.infer<typeof summaryQuery>>(req);
  const portfolios = (await scope()).slice(0, 50);
  const rows = [];
  for (const p of portfolios) {
    try {
      const w = await defaultWindow(p);
      const start = f.from ?? w.start;
      const end = f.to ?? w.end;
      if (end <= start) {
        rows.push({ portfolioId: p.id, portfolioRef: p.ref, portfolioName: p.name, error: 'Not enough price history for a return' });
        continue;
      }
      const c = await compute(p, await resolveBenchmark(p), start, end);
      const locked = await prisma.perfPeriod.findFirst({ where: { portfolioId: p.id, status: 'LOCKED' }, orderBy: { periodEnd: 'desc' }, select: { ref: true, periodEnd: true } });
      rows.push({ portfolioId: p.id, portfolioRef: p.ref, portfolioName: p.name, benchmarkName: c.attribution.benchmark?.name ?? p.benchmark, periodStart: start, periodEnd: end, ...headline(c), lastOfficial: locked ? { ref: locked.ref, periodEnd: iso(locked.periodEnd) } : null, issues: c.issues });
    } catch (e) {
      rows.push({ portfolioId: p.id, portfolioRef: p.ref, portfolioName: p.name, error: e instanceof HttpError ? e.message : 'Could not compute' });
    }
  }
  res.json({ data: rows, total: rows.length });
});

// ================================================================ benchmarks

const benchBody = z.object({ code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits . _ - only').transform((v) => v.toUpperCase()), name: z.string().trim().min(2).max(160) }).strict();

performanceRoutes.get('/benchmarks', ...canView, async (_req, res) => {
  const rows = await prisma.perfBenchmark.findMany({ include: { constituents: true }, orderBy: { code: 'asc' } });
  const secs = await prisma.security.findMany({ where: { id: { in: rows.flatMap((b) => b.constituents.map((c) => c.securityId)).filter((x): x is string => !!x) } }, select: { id: true, ticker: true, name: true } });
  const sec = new Map(secs.map((s) => [s.id, s]));
  res.json({
    data: rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      status: b.status,
      totalWeightPct: b.constituents.reduce((a, c) => a.add(c.weightPct), new Prisma.Decimal(0)).toFixed(4),
      constituents: b.constituents.map((c) => ({ id: c.id, securityId: c.securityId, ticker: c.securityId ? (sec.get(c.securityId)?.ticker ?? null) : 'CASH', name: c.securityId ? (sec.get(c.securityId)?.name ?? null) : 'Cash sleeve', sector: c.sector, weightPct: c.weightPct.toFixed(4) })),
    })),
  });
});

performanceRoutes.post('/benchmarks', ...canPrepare, validateBody(benchBody), idempotent('performance.benchmark'), async (req, res) => {
  const b = req.body as z.infer<typeof benchBody>;
  if (await prisma.perfBenchmark.findUnique({ where: { code: b.code } })) throw HttpError.conflict(`Benchmark ${b.code} already exists`, 'duplicate');
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.perfBenchmark.create({ data: { code: b.code, name: b.name, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'performance.benchmark_created', objectType: 'perf_benchmark', objectId: r.id, after: { code: b.code, name: b.name } });
    return r;
  });
  res.status(201).json({ data: { id: row.id, code: row.code, name: row.name, status: row.status } });
});

const consBody = z
  .object({
    constituents: z
      .array(
        z.object({ securityId: z.string().trim().max(36).nullable().optional(), sector: z.string().trim().min(1).max(80).optional(), weightPct: z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Weight is a percent with up to 4 decimals') }).strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

/** Replaces the composition. Weights must total exactly 100; locked periods keep their stored evidence. */
performanceRoutes.put('/benchmarks/:id/constituents', ...canPrepare, validateBody(consBody), idempotent('performance.benchmark_constituents'), async (req, res) => {
  const bm = await prisma.perfBenchmark.findUnique({ where: { id: param(req, 'id') }, include: { constituents: true } });
  if (!bm) throw HttpError.notFound('Benchmark not found');
  const b = req.body as z.infer<typeof consBody>;
  const total = b.constituents.reduce((a, c) => a.add(c.weightPct), new Prisma.Decimal(0));
  if (!total.eq(100)) throw HttpError.badRequest('Validation failed', [{ path: 'constituents', message: `Weights total ${total.toFixed(4)}%; they must total 100%` }]);
  const ids = b.constituents.map((c) => c.securityId).filter((x): x is string => !!x);
  if (new Set(ids).size !== ids.length) throw HttpError.badRequest('Validation failed', [{ path: 'constituents', message: 'A security appears more than once' }]);
  const secs = await prisma.security.findMany({ where: { id: { in: ids } }, select: { id: true, sector: true } });
  if (secs.length !== ids.length) throw HttpError.badRequest('Validation failed', [{ path: 'constituents', message: 'Unknown security in the composition' }]);
  const sector = new Map(secs.map((s) => [s.id, s.sector ?? 'Unclassified']));
  await prisma.$transaction(async (tx) => {
    await tx.perfBenchmarkConstituent.deleteMany({ where: { benchmarkId: bm.id } });
    await tx.perfBenchmarkConstituent.createMany({ data: b.constituents.map((c) => ({ benchmarkId: bm.id, securityId: c.securityId ?? null, sector: c.securityId ? (sector.get(c.securityId) ?? 'Unclassified') : (c.sector ?? 'Cash'), weightPct: new Prisma.Decimal(c.weightPct) })) });
    await writeAudit(tx, audit(req), { action: 'performance.benchmark_composition_set', objectType: 'perf_benchmark', objectId: bm.id, before: { constituents: bm.constituents.map((c) => ({ securityId: c.securityId, weightPct: c.weightPct.toString() })) }, after: { constituents: b.constituents.length, totalWeightPct: total.toFixed(4) } });
  });
  res.json({ data: { id: bm.id, constituents: b.constituents.length, totalWeightPct: total.toFixed(4) } });
});

// ================================================================ periods

type PeriodRow = Prisma.PerfPeriodGetPayload<object>;

async function names(ids: (string | null)[]) {
  const u = await prisma.user.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return new Map(u.map((x) => [x.id, x.name]));
}

async function periodView(rows: PeriodRow[]) {
  const [pfs, who] = await Promise.all([prisma.portfolio.findMany({ where: { id: { in: rows.map((r) => r.portfolioId) } }, select: { id: true, ref: true, name: true } }), names(rows.flatMap((r) => [r.makerId, r.checkerId]))]);
  const pf = new Map(pfs.map((p) => [p.id, p]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    portfolioId: r.portfolioId,
    portfolioRef: pf.get(r.portfolioId)?.ref ?? null,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    benchmarkId: r.benchmarkId,
    periodStart: iso(r.periodStart),
    periodEnd: iso(r.periodEnd),
    version: r.version,
    status: r.status,
    official: r.status === 'LOCKED',
    baseCurrency: r.baseCurrency,
    startValue: r.startValue.toFixed(2),
    endValue: r.endValue.toFixed(2),
    netFlows: r.netFlows.toFixed(2),
    twrPct: r.twrPct.toFixed(6),
    benchmarkPct: r.benchmarkPct?.toFixed(6) ?? null,
    activePct: r.activePct?.toFixed(6) ?? null,
    dayCount: r.dayCount,
    makerId: r.makerId,
    makerName: who.get(r.makerId) ?? null,
    checkerId: r.checkerId,
    checkerName: r.checkerId ? (who.get(r.checkerId) ?? null) : null,
    lockedAt: r.lockedAt?.toISOString() ?? null,
    lockNote: r.lockNote,
    supersedesId: r.supersedesId,
    correctionReason: r.correctionReason,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function loadPeriod(id: string): Promise<PeriodRow> {
  const r = await prisma.perfPeriod.findFirst({ where: /^[0-9a-f-]{36}$/i.test(id) ? { id } : { ref: id } });
  if (!r) throw HttpError.notFound('Performance period not found');
  return r;
}

const periodsQuery = z.object({ portfolioId: z.string().trim().max(36).optional(), status: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
performanceRoutes.get('/periods', ...canView, validateQuery(periodsQuery), async (req, res) => {
  const f = query<z.infer<typeof periodsQuery>>(req);
  const pid = f.portfolioId ? (await onePortfolio(f.portfolioId)).id : undefined;
  const where: Prisma.PerfPeriodWhereInput = { ...(pid ? { portfolioId: pid } : {}), ...(f.status ? { status: { in: f.status.split(',').map((s) => s.trim().toUpperCase()) } } : {}) };
  const [total, rows, grouped] = await Promise.all([prisma.perfPeriod.count({ where }), prisma.perfPeriod.findMany({ where, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }), prisma.perfPeriod.groupBy({ by: ['status'], where: pid ? { portfolioId: pid } : {}, _count: { _all: true } })]);
  res.json({ data: await periodView(rows), total, summary: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) });
});

async function periodDetail(r: PeriodRow, userId: string) {
  const [view] = await periodView([r]);
  let controlsLive: Awaited<ReturnType<typeof evaluateControls>> | null = null;
  let stale = false;
  if (r.status === 'DRAFT') {
    const p = await onePortfolio(r.portfolioId);
    const benchmark = r.benchmarkId ? await prisma.perfBenchmark.findUnique({ where: { id: r.benchmarkId }, include: { constituents: true } }) : null;
    const c = await compute(p, benchmark, iso(r.periodStart)!, iso(r.periodEnd)!);
    controlsLive = await evaluateControls(p, benchmark, iso(r.periodStart)!, iso(r.periodEnd)!, c);
    stale = c.hash !== r.dataHash;
  }
  const controls = (controlsLive?.items ?? (r.controls as unknown)) as unknown;
  return {
    ...view,
    series: r.series,
    attribution: r.attribution,
    contributions: r.contributions,
    controls,
    controlsPending: controlsLive ? controlsLive.pending : Array.isArray(r.controls) ? (r.controls as { state: string }[]).filter((c) => c.state !== 'done').length : 0,
    navCheck: controlsLive?.navCheck ?? r.navCheck,
    stale,
    dataHash: r.dataHash,
    canLock: r.status === 'DRAFT' && r.makerId !== userId && !!controlsLive && controlsLive.pending === 0 && !stale,
  };
}

performanceRoutes.get('/periods/:id', ...canView, async (req, res) => {
  res.json({ data: await periodDetail(await loadPeriod(param(req, 'id')), req.user!.id) });
});

const prepareBody = z.object({ portfolioId: z.string().trim().min(1).max(36), periodStart: dateStr, periodEnd: dateStr, benchmarkId: z.string().trim().max(36).nullish() }).strict();

async function snapshotFields(p: PortfolioRow, benchmarkId: string | null | undefined, start: string, end: string) {
  const benchmark = await resolveBenchmark(p, benchmarkId);
  const c = await compute(p, benchmark, start, end);
  const controls = await evaluateControls(p, benchmark, start, end, c);
  return {
    benchmark,
    c,
    controls,
    data: {
      baseCurrency: p.baseCurrency,
      benchmarkId: benchmark?.id ?? null,
      startValue: new Prisma.Decimal(c.startValue.toFixed(4)),
      endValue: new Prisma.Decimal(c.endValue.toFixed(4)),
      netFlows: new Prisma.Decimal(c.netFlows.toFixed(4)),
      twrPct: new Prisma.Decimal(pct6(c.twr)),
      benchmarkPct: c.benchTwr === null ? null : new Prisma.Decimal(pct6(c.benchTwr)),
      activePct: c.active === null ? null : new Prisma.Decimal(pct6(c.active)),
      dayCount: c.dates.length - 1,
      series: c.series as unknown as Prisma.InputJsonValue,
      attribution: c.attribution as unknown as Prisma.InputJsonValue,
      contributions: c.contributions as unknown as Prisma.InputJsonValue,
      controls: controls.items as unknown as Prisma.InputJsonValue,
      navCheck: (controls.navCheck ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      dataHash: c.hash,
    },
  };
}

performanceRoutes.post('/periods', ...canPrepare, validateBody(prepareBody), idempotent('performance.period'), async (req, res) => {
  const b = req.body as z.infer<typeof prepareBody>;
  if (b.periodEnd <= b.periodStart) throw HttpError.badRequest('Validation failed', [{ path: 'periodEnd', message: 'The period end must be after the start' }]);
  if (b.periodEnd > todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'periodEnd', message: 'The period end cannot be in the future' }]);
  const p = await onePortfolio(b.portfolioId);
  const start = new Date(`${b.periodStart}T00:00:00.000Z`);
  const end = new Date(`${b.periodEnd}T00:00:00.000Z`);
  const existing = await prisma.perfPeriod.findFirst({ where: { portfolioId: p.id, periodStart: start, periodEnd: end, status: { in: ['DRAFT', 'LOCKED'] } } });
  if (existing) throw HttpError.conflict(existing.status === 'LOCKED' ? `${existing.ref} is already Official for this period. Start a correction instead.` : `${existing.ref} is already a draft for this period. Recompute it instead.`, 'period_exists');
  const s = await snapshotFields(p, b.benchmarkId, b.periodStart, b.periodEnd);
  const last = await prisma.perfPeriod.findFirst({ where: { portfolioId: p.id, periodStart: start, periodEnd: end }, orderBy: { version: 'desc' }, select: { version: true } });
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'perfPeriod');
    const r = await tx.perfPeriod.create({ data: { ref, portfolioId: p.id, periodStart: start, periodEnd: end, version: (last?.version ?? 0) + 1, makerId: req.user!.id, ...s.data } });
    await writeAudit(tx, audit(req), { action: 'performance.period_prepared', objectType: 'perf_period', objectId: r.id, after: { ref, portfolio: p.ref, periodStart: b.periodStart, periodEnd: b.periodEnd, twrPct: pct6(s.c.twr), benchmark: s.benchmark?.code ?? null, controlsPending: s.controls.pending } });
    await notifyPermission(tx, 'performance.lock', { type: 'performance.period_prepared', title: `Performance period ${ref} ready to review`, body: `${p.name} ${b.periodStart} to ${b.periodEnd}`, link: `/ops/performance/${r.id}` });
    return r;
  });
  res.status(201).json({ data: await periodDetail(row, req.user!.id) });
});

performanceRoutes.post('/periods/:id/recompute', ...canPrepare, idempotent('performance.recompute'), async (req, res) => {
  const r = await loadPeriod(param(req, 'id'));
  if (r.status !== 'DRAFT') throw HttpError.conflict(`${r.ref} is ${r.status}; only a draft can be recomputed. A locked period changes only by correction.`, 'period_immutable');
  if (r.makerId !== req.user!.id && !req.user!.permissions.includes('performance.lock')) throw HttpError.forbidden('Only the preparer or a locker can recompute a draft', 'permission_denied');
  const p = await onePortfolio(r.portfolioId);
  const s = await snapshotFields(p, r.benchmarkId, iso(r.periodStart)!, iso(r.periodEnd)!);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.perfPeriod.updateMany({ where: { id: r.id, status: 'DRAFT' }, data: s.data })).count);
    await writeAudit(tx, audit(req), { action: 'performance.period_recomputed', objectType: 'perf_period', objectId: r.id, before: { twrPct: r.twrPct.toFixed(6), dataHash: r.dataHash }, after: { twrPct: pct6(s.c.twr), dataHash: s.c.hash, controlsPending: s.controls.pending } });
  });
  res.json({ data: await periodDetail(await loadPeriod(r.id), req.user!.id) });
});

const lockBody = z.object({ note: z.string().trim().max(500).nullish() }).strict();
performanceRoutes.post('/periods/:id/lock', ...canLock, requireStepUp, validateBody(lockBody), idempotent('performance.lock'), async (req, res) => {
  const r = await loadPeriod(param(req, 'id'));
  if (r.status !== 'DRAFT') throw HttpError.conflict(`${r.ref} is ${r.status}; only a draft can be locked`, 'invalid_state');
  assertSegregation(req.user!.id, r.makerId);
  const p = await onePortfolio(r.portfolioId);
  const benchmark = r.benchmarkId ? await prisma.perfBenchmark.findUnique({ where: { id: r.benchmarkId }, include: { constituents: true } }) : null;
  const start = iso(r.periodStart)!;
  const end = iso(r.periodEnd)!;
  const c = await compute(p, benchmark, start, end);
  const controls = await evaluateControls(p, benchmark, start, end, c);
  if (controls.pending > 0) {
    throw new HttpError(409, 'controls_not_clear', `${controls.pending} official-return control(s) are not done`, { controls: controls.items.filter((i) => i.state !== 'done').map((i) => ({ key: i.key, title: i.title, detail: i.detail })) });
  }
  if (c.hash !== r.dataHash) throw HttpError.conflict('The underlying positions, prices or flows changed since this draft was prepared. Recompute it and review again.', 'stale_draft');
  const b = req.body as z.infer<typeof lockBody>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.perfPeriod.updateMany({ where: { id: r.id, status: 'DRAFT' }, data: { status: 'LOCKED', checkerId: req.user!.id, lockedAt: new Date(), lockNote: b.note ?? null, controls: controls.items as unknown as Prisma.InputJsonValue } })).count);
    if (r.supersedesId) await tx.perfPeriod.updateMany({ where: { id: r.supersedesId, status: 'LOCKED' }, data: { status: 'SUPERSEDED' } });
    await writeAudit(tx, audit(req), { action: 'performance.period_locked', objectType: 'perf_period', objectId: r.id, after: { ref: r.ref, version: r.version, twrPct: r.twrPct.toFixed(6), preparedBy: r.makerId, supersedes: r.supersedesId, dataHash: r.dataHash }, reason: b.note ?? undefined });
  });
  res.json({ data: await periodDetail(await loadPeriod(r.id), req.user!.id) });
});

const correctBody = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
performanceRoutes.post('/periods/:id/correct', ...canPrepare, validateBody(correctBody), idempotent('performance.correct'), async (req, res) => {
  const old = await loadPeriod(param(req, 'id'));
  if (old.status !== 'LOCKED') throw HttpError.conflict(`${old.ref} is ${old.status}; only an Official (locked) period needs a correction`, 'invalid_state');
  if (await prisma.perfPeriod.findFirst({ where: { portfolioId: old.portfolioId, periodStart: old.periodStart, periodEnd: old.periodEnd, status: 'DRAFT' } })) throw HttpError.conflict('A correction draft already exists for this period', 'period_exists');
  const p = await onePortfolio(old.portfolioId);
  const s = await snapshotFields(p, old.benchmarkId, iso(old.periodStart)!, iso(old.periodEnd)!);
  const last = await prisma.perfPeriod.findFirst({ where: { portfolioId: old.portfolioId, periodStart: old.periodStart, periodEnd: old.periodEnd }, orderBy: { version: 'desc' }, select: { version: true } });
  const { reason } = req.body as z.infer<typeof correctBody>;
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'perfPeriod');
    const r = await tx.perfPeriod.create({ data: { ref, portfolioId: old.portfolioId, periodStart: old.periodStart, periodEnd: old.periodEnd, version: (last?.version ?? old.version) + 1, makerId: req.user!.id, supersedesId: old.id, correctionReason: reason, ...s.data } });
    await writeAudit(tx, audit(req), { action: 'performance.correction_started', objectType: 'perf_period', objectId: r.id, after: { ref, supersedes: old.ref, version: r.version }, reason });
    await notifyPermission(tx, 'performance.lock', { type: 'performance.correction_started', title: `Performance correction ${ref} ready to review`, body: reason, link: `/ops/performance/${r.id}` });
    return r;
  });
  res.status(201).json({ data: await periodDetail(row, req.user!.id) });
});
