import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { LpBenchmarkSeries, LpJobStatus, LpPerformanceByFundRow, LpPerformanceData, LpPerformanceHistory, LpPerformanceHistoryPoint } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { LpError } from '../lp.http';
import type { LpContext } from '../lp.context';
import { VISIBLE_CALL_STATUSES, VISIBLE_DISTRIBUTION_STATUSES, asRecord, jsonDec, lpAudit } from './common';
import { renderStatementPdf } from './statement-pdf';
import { presentPositions } from './fx';
import { consolidate, fixed, latestAsOf, loadPositions, type FundPosition } from './positions';

const ZERO = new Prisma.Decimal(0);

function byFundRow(p: FundPosition): LpPerformanceByFundRow {
  return {
    fundId: p.fund.id,
    fundName: p.fund.name,
    netIrr: p.netIrr,
    tvpi: p.tvpi,
    dpi: p.dpi,
    rvpi: p.rvpi,
    nav: fixed(p.nav),
    paidIn: fixed(p.paidIn),
    distributions: fixed(p.distributions),
    operatingModel: p.isOpenEnded ? 'OPEN_ENDED' : 'PRIVATE_CAPITAL',
    structure: p.isOpenEnded ? 'Open-End' : 'Closed-End',
  };
}

export async function getPerformance(ctx: LpContext, fundId: string | undefined, period: string): Promise<LpPerformanceData> {
  const { positions, fx } = await presentPositions(ctx, await loadPositions(ctx, fundId));
  const c = consolidate(positions);
  const { asOfDate, valuationStatus } = latestAsOf(positions);
  const oe = positions.find((p) => p.isOpenEnded && p.holding);
  const benchmark = positions.length === 1 ? (asRecord(positions[0]!.metrics).benchmark ?? null) : null;
  return {
    asOfDate,
    valuationStatus,
    period,
    calculationDate: new Date().toISOString().slice(0, 10),
    version: '1',
    sourceModule: 'fund_commitments.metrics_json + platform capital records',
    reportingCurrency: fx.reportingCurrency,
    presentationCurrency: fx.presentationCurrency,
    fx,
    approvedBy: null,
    metrics: {
      totalCommitment: fixed(c.committed),
      paidIn: fixed(c.paidIn),
      distributions: fixed(c.distributions),
      currentNav: fixed(c.nav),
      netIrr: c.netIrr as string,
      tvpi: c.tvpi ?? '0.0000',
      dpi: c.dpi ?? '0.0000',
      rvpi: c.rvpi ?? '0.0000',
    },
    byFund: positions.map(byFundRow),
    benchmark,
    ...(oe?.holding
      ? {
          openEndedMetrics: {
            ytdReturn: oe.ytdReturn as string,
            navPerUnit: oe.holding.navPerUnit.toFixed(8),
            unitsHeld: oe.holding.units.toFixed(6),
            accountValue: fixed(oe.holding.accountValue),
          },
        }
      : {}),
  };
}

export async function getByFund(ctx: LpContext) {
  const { positions, fx } = await presentPositions(ctx, await loadPositions(ctx));
  const { asOfDate, valuationStatus } = latestAsOf(positions);
  return { asOfDate, valuationStatus, reportingCurrency: fx.reportingCurrency, fx, funds: positions.map(byFundRow) };
}

const monthLabel = (d: Date) => d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Cumulative paid-in / distributions at ~7 dates from dated platform rows (payments by receipt date,
 * distribution payouts by paid date). NAV appears only where a stored point exists (metrics_json.history)
 * and for "Now"; otherwise it is null rather than interpolated.
 */
export async function getHistory(ctx: LpContext, fundId: string | undefined, range: string): Promise<LpPerformanceHistory> {
  const positions = (await loadPositions(ctx, fundId)).filter((p) => !p.isOpenEnded);
  const { asOfDate, valuationStatus } = latestAsOf(positions);
  const { rates, fx } = await presentPositions(ctx, positions);
  const fundIds = positions.map((p) => p.fund.id);
  const [payments, dists] = fundIds.length
    ? await Promise.all([
        prisma.capitalCallPayment.findMany({
          where: { allocation: { clientId: ctx.client.id, call: { fundId: { in: fundIds }, status: { in: VISIBLE_CALL_STATUSES } } } },
          select: { amount: true, recordedAt: true },
        }),
        prisma.distributionAllocation.findMany({
          where: { clientId: ctx.client.id, paidAt: { not: null }, distribution: { fundId: { in: fundIds }, status: { in: VISIBLE_DISTRIBUTION_STATUSES } } },
          select: { amountPaid: true, paidAt: true },
        }),
      ])
    : [[], []];
  const opening = positions.reduce(
    (acc, p) => ({
      paidIn: acc.paidIn.add(new Prisma.Decimal(jsonDec(p.metrics.openingPaidIn) ?? 0)),
      dist: acc.dist.add(new Prisma.Decimal(jsonDec(p.metrics.openingDistributions) ?? 0)),
    }),
    { paidIn: ZERO, dist: ZERO },
  );
  const stored = positions.flatMap((p) =>
    (Array.isArray(p.metrics.history) ? p.metrics.history : [])
      .map((h) => asRecord(h))
      .map((h) => ({ fundId: p.fund.id, date: typeof h.date === 'string' ? h.date.slice(0, 10) : '', nav: jsonDec(h.nav) }))
      .filter((h) => h.date && h.nav !== null),
  );
  const now = new Date();
  const firstFlow = [...payments.map((p) => p.recordedAt), ...dists.map((d) => d.paidAt!)].sort((a, b) => a.getTime() - b.getTime())[0];
  const months = { '1Y': 12, '3Y': 36, '5Y': 60, '10Y': 120 }[range.toUpperCase()] ??
    (firstFlow ? Math.min(120, Math.max(12, (now.getUTCFullYear() - firstFlow.getUTCFullYear()) * 12 + now.getUTCMonth() - firstFlow.getUTCMonth() + 1)) : 12);
  const step = Math.max(1, Math.round(months / 6));
  const points: LpPerformanceHistoryPoint[] = [];
  for (let back = months; back >= 0; back -= step) {
    const isNow = back === 0 || back - step < 0;
    const at = isNow ? now : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0));
    const iso = at.toISOString().slice(0, 10);
    const paidIn = payments.filter((p) => p.recordedAt <= at).reduce((a, p) => a.add(p.amount), opening.paidIn);
    const dist = dists.filter((d) => d.paidAt! <= at).reduce((a, d) => a.add(d.amountPaid), opening.dist);
    let nav: string | null = null;
    if (isNow) nav = fixed(positions.reduce((a, p) => a.add(p.nav), ZERO));
    else {
      const perFund = positions.map((p) => stored.filter((h) => h.fundId === p.fund.id && h.date <= iso).sort((a, b) => b.date.localeCompare(a.date))[0]);
      if (perFund.length && perFund.every(Boolean)) nav = fixed(perFund.reduce((a, h) => a.add(h!.nav!), ZERO));
    }
    points.push({ date: iso, label: isNow ? 'Now' : monthLabel(at), nav: nav as string, paidIn: fixed(paidIn), distributions: fixed(dist) });
    if (isNow) break;
  }
  // One aggregate series can only be converted with one rate: when the funds convert at different rates the points stay in the original currency.
  const factors = [...new Set([...rates.values()].map((r) => r.toFixed(10)))];
  const uniform = fx.converted && factors.length === 1 && rates.size === positions.length;
  const f = uniform ? new Prisma.Decimal(factors[0]!) : new Prisma.Decimal(1);
  const out = uniform
    ? points.map((pt) => ({ ...pt, nav: pt.nav === null ? pt.nav : fixed(new Prisma.Decimal(pt.nav).mul(f)), paidIn: fixed(new Prisma.Decimal(pt.paidIn).mul(f)), distributions: fixed(new Prisma.Decimal(pt.distributions).mul(f)) }))
    : points;
  const currencies = [...new Set(positions.map((p) => p.fund.currency.toUpperCase()))];
  return { asOfDate, valuationStatus, range: range.toUpperCase() || 'SI', reportingCurrency: uniform ? fx.presentationCurrency : currencies.length === 1 ? currencies[0]! : ctx.client.baseCurrency, points: out };
}

/**
 * BR-091: a benchmark series exists only when approved points are stored for the pair (benchmark id, metric). The
 * platform never generates a series; with no approved points the answer is `configured: false`.
 */
export async function getBenchmarks(metric: string, benchmarkId: string, asOfDate: string): Promise<LpBenchmarkSeries> {
  const points = await prisma.benchmarkPoint.findMany({ where: { benchmarkId, metric, status: 'APPROVED' }, orderBy: { pointDate: 'asc' }, take: 240 });
  if (!points.length) {
    return {
      metric,
      benchmarkId,
      asOfDate,
      valuationStatus: 'UNAVAILABLE',
      configured: false,
      series: [],
      source: null,
      approvedAt: null,
      note: `No approved ${benchmarkId} series is configured for ${metric}.`,
    };
  }
  const approvedAt = points.map((p) => p.approvedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    metric,
    benchmarkId,
    asOfDate,
    valuationStatus: 'FINAL',
    configured: true,
    series: points.map((p) => ({ date: p.pointDate.toISOString().slice(0, 10), label: p.label, value: p.value.toFixed(6) })),
    source: points[points.length - 1]!.source,
    approvedAt: approvedAt ? approvedAt.toISOString() : null,
    note: null,
  };
}

// ── Report jobs (asynchronous; persisted on `settings` keyed by job id) ─────
//
// BR-096: QUEUED -> RUNNING -> COMPLETED | FAILED, and QUEUED/RUNNING -> CANCELLED. Every move is a compare-and-set on the
// stored status, so a late worker can never overwrite a cancellation. The request captures fund, period, benchmark and
// as-of date. A job left QUEUED/RUNNING by a restart is picked up again by the next status read (STALE_JOB_MS).

const JOB_KEY = 'lp.job';
export const JOB_STATES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
const STALE_JOB_MS = 30_000;

interface StoredJob {
  clientId: string;
  userId: string;
  jobType: string;
  status: string;
  request: Record<string, unknown>;
  result: unknown;
  errorMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt: string | null;
}

/** Compare-and-set on `$.status`; true when this caller made the move. */
async function moveJob(jobId: string, from: string[], patch: Partial<StoredJob>): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: jobId, key: JOB_KEY } } });
  if (!row) return false;
  const cur = row.value as unknown as StoredJob;
  if (!from.includes(cur.status)) return false;
  const next = { ...cur, ...patch };
  const res = await prisma.setting.updateMany({
    where: { ownerId: jobId, key: JOB_KEY, value: { path: '$.status', equals: cur.status } },
    data: { value: next as unknown as Prisma.InputJsonValue },
  });
  return res.count === 1;
}

/** Runs one job to a terminal state. Safe to call twice: only the caller that wins QUEUED -> RUNNING computes. */
export async function runPerformanceJob(ctx: LpContext, jobId: string): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: jobId, key: JOB_KEY } } });
  const job = row?.value as unknown as StoredJob | undefined;
  if (!job) return;
  const started = new Date().toISOString();
  const stale = job.status === 'RUNNING' && job.startedAt && Date.now() - new Date(job.startedAt).getTime() > STALE_JOB_MS;
  if (!(await moveJob(jobId, stale ? ['RUNNING'] : ['QUEUED'], { status: 'RUNNING', startedAt: started }))) return;
  try {
    const fundId = typeof job.request.fundId === 'string' ? job.request.fundId : undefined;
    const period = typeof job.request.period === 'string' ? job.request.period : 'SI';
    const result = await getPerformance(ctx, fundId, period);
    const benchmarkId = typeof job.request.benchmarkId === 'string' ? job.request.benchmarkId : null;
    const withBenchmark = benchmarkId ? { ...result, benchmark: await getBenchmarks('NET_IRR', benchmarkId, result.asOfDate) } : result;
    await moveJob(jobId, ['RUNNING'], { status: 'COMPLETED', result: withBenchmark, errorMessage: null, completedAt: new Date().toISOString() });
  } catch (err) {
    await moveJob(jobId, ['RUNNING'], { status: 'FAILED', errorMessage: err instanceof Error ? err.message.slice(0, 300) : 'Report generation failed', completedAt: new Date().toISOString() });
  }
}

export async function createPerformanceJob(req: Request, ctx: LpContext, input: { fundId?: string; period: string; benchmarkId?: string; asOfDate?: string }) {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: StoredJob = {
    clientId: ctx.client.id,
    userId: ctx.userId,
    jobType: 'PERFORMANCE_REPORT',
    status: 'QUEUED',
    request: { fundId: input.fundId ?? null, period: input.period, benchmarkId: input.benchmarkId ?? null, asOfDate: input.asOfDate ?? null },
    result: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.setting.create({ data: { ownerId: jobId, key: JOB_KEY, value: job as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, lpAudit(req), { action: 'lp_report.requested', objectType: 'lp_job', objectId: jobId, after: { jobType: job.jobType, ...job.request } });
  });
  setImmediate(() => {
    void runPerformanceJob(ctx, jobId).catch(() => undefined);
  });
  return { jobId, status: job.status, createdAt: now, downloadUrl: reportDownloadPath(jobId) };
}

/** Cancels a job that has not finished; a finished job answers 409. */
export async function cancelPerformanceJob(req: Request, ctx: LpContext, jobId: string): Promise<LpJobStatus> {
  const job = await loadPerformanceJob(ctx, jobId);
  if (!job) throw new LpError(404, 'LP_NOT_FOUND', 'Job not found');
  if (!(await moveJob(jobId, ['QUEUED', 'RUNNING'], { status: 'CANCELLED', completedAt: new Date().toISOString() }))) {
    throw new LpError(409, 'LP_JOB_FINISHED', 'This report is no longer running');
  }
  await prisma.$transaction((tx) => writeAudit(tx, lpAudit(req), { action: 'lp_report.cancelled', objectType: 'lp_job', objectId: jobId, after: { clientId: ctx.client.id } }));
  return getJob(ctx, jobId);
}

/** A performance job this client owns, or null when the id is not a job (it may still be a published report document). */
export async function loadPerformanceJob(ctx: LpContext, jobId: string): Promise<StoredJob | null> {
  const row = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: jobId, key: JOB_KEY } } });
  if (!row) return null;
  const job = row.value as unknown as StoredJob;
  if (!job || job.jobType !== 'PERFORMANCE_REPORT' || job.clientId !== ctx.client.id) throw new LpError(404, 'LP_NOT_FOUND', 'Job not found');
  return job;
}

export function reportDownloadPath(jobId: string) {
  return `/api/v1/lp-portal/reports/${jobId}/download`;
}

const grouped = (v: string | null | undefined) => {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const [int, frac] = v.replace(/^-/, '').split('.');
  return `${n < 0 ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac.slice(0, 2)}` : ''}`;
};
const multiple = (v: string | null | undefined) => (v == null || v === '' ? '-' : `${Number(v).toFixed(2)}x`);

/** Styled statement PDF of the figures stored on the job, so a later download matches the completed result. */
export function renderPerformanceReport(clientName: string, job: StoredJob): Buffer {
  const result = (job.result ?? {}) as LpPerformanceData;
  const m = result.metrics;
  const ccy = result.reportingCurrency ?? '';
  const summary = [
    { label: 'Total commitment', value: `${ccy} ${grouped(m?.totalCommitment)}` },
    { label: 'Paid in', value: `${ccy} ${grouped(m?.paidIn)}` },
    { label: 'Distributions', value: `${ccy} ${grouped(m?.distributions)}` },
    { label: 'Net asset value', value: `${ccy} ${grouped(m?.currentNav)}` },
  ];
  if (result.openEndedMetrics) {
    const o = result.openEndedMetrics;
    summary.push({ label: 'Units held / NAV per unit', value: `${o.unitsHeld} / ${o.navPerUnit}` }, { label: 'Account value', value: `${ccy} ${grouped(o.accountValue)}` });
  }
  return renderStatementPdf({
    clientName,
    title: 'Performance statement',
    subtitle: `Period ${result.period ?? '-'}  |  As of ${result.asOfDate ?? '-'}  |  ${result.valuationStatus ?? ''}`,
    currency: ccy,
    kpis: [
      { label: 'Net IRR', value: m?.netIrr ? String(m.netIrr) : '-' },
      { label: 'TVPI', value: multiple(m?.tvpi) },
      { label: 'DPI', value: multiple(m?.dpi) },
      { label: 'RVPI', value: multiple(m?.rvpi) },
    ],
    summary,
    table: {
      heading: 'Positions by fund',
      columns: [
        { label: 'Fund', width: 180 },
        { label: 'Structure', width: 80 },
        { label: 'NAV', align: 'right', width: 90 },
        { label: 'Paid in', align: 'right', width: 90 },
        { label: 'TVPI', align: 'right', width: 71 },
      ],
      rows: (result.byFund ?? []).slice(0, 60).map((f) => [f.fundName, String(f.operatingModel ?? '').replace('_', ' ').toLowerCase(), grouped(f.nav), grouped(f.paidIn), multiple(f.tvpi)]),
    },
    footnote: 'Published fund position. This file does not create a new valuation. Amounts are in the reporting currency shown.',
  });
}

export async function getJob(ctx: LpContext, jobId: string): Promise<LpJobStatus> {
  let job = await loadPerformanceJob(ctx, jobId);
  if (!job) throw new LpError(404, 'LP_NOT_FOUND', 'Job not found');
  // Pick up a job a restart left behind.
  const age = Date.now() - new Date(job.startedAt ?? job.createdAt).getTime();
  if ((job.status === 'QUEUED' || job.status === 'RUNNING') && age > STALE_JOB_MS) {
    await runPerformanceJob(ctx, jobId);
    job = (await loadPerformanceJob(ctx, jobId)) ?? job;
  }
  return {
    jobId,
    jobType: job.jobType,
    status: job.status,
    result: job.result,
    downloadUrl: job.status === 'COMPLETED' ? reportDownloadPath(jobId) : null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}
