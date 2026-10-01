import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { LpBenchmarkSeries, LpJobStatus, LpPerformanceByFundRow, LpPerformanceData, LpPerformanceHistory, LpPerformanceHistoryPoint } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { LpError } from '../lp.http';
import type { LpContext } from '../lp.context';
import { VISIBLE_CALL_STATUSES, VISIBLE_DISTRIBUTION_STATUSES, asRecord, jsonDec, lpAudit } from './common';
import { renderPdf, type PdfLine } from '../../ops/pdf';
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
  const positions = await loadPositions(ctx, fundId);
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
    reportingCurrency: ctx.client.baseCurrency,
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
  const positions = await loadPositions(ctx);
  const { asOfDate, valuationStatus } = latestAsOf(positions);
  return { asOfDate, valuationStatus, funds: positions.map(byFundRow) };
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
  return { asOfDate, valuationStatus, range: range.toUpperCase() || 'SI', points };
}

export function getBenchmarks(metric: string, benchmarkId: string, asOfDate: string): LpBenchmarkSeries {
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

// ── Report jobs (synchronous; persisted on `settings` keyed by job id) ─────

const JOB_KEY = 'lp.job';

interface StoredJob {
  clientId: string;
  userId: string;
  jobType: string;
  status: string;
  request: Record<string, unknown>;
  result: unknown;
  createdAt: string;
  completedAt: string | null;
}

export async function createPerformanceJob(req: Request, ctx: LpContext, input: { fundId?: string; period: string }) {
  const result = await getPerformance(ctx, input.fundId, input.period);
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: StoredJob = {
    clientId: ctx.client.id,
    userId: ctx.userId,
    jobType: 'PERFORMANCE_REPORT',
    status: 'COMPLETED',
    request: { fundId: input.fundId ?? null, period: input.period },
    result,
    createdAt: now,
    completedAt: now,
  };
  await prisma.$transaction(async (tx) => {
    await tx.setting.create({ data: { ownerId: jobId, key: JOB_KEY, value: job as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, lpAudit(req), { action: 'lp_report.requested', objectType: 'lp_job', objectId: jobId, after: { jobType: job.jobType, ...job.request } });
  });
  return { jobId, status: job.status, createdAt: now, downloadUrl: reportDownloadPath(jobId) };
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

/** One-page PDF of the figures stored on the job, so a later download matches the completed result. */
export function renderPerformanceReport(clientName: string, job: StoredJob): Buffer {
  const result = (job.result ?? {}) as LpPerformanceData;
  const m = result.metrics;
  const lines: PdfLine[] = [
    { text: clientName, bold: true },
    { text: `Period ${result.period ?? ''}    As of ${result.asOfDate ?? ''}    ${result.valuationStatus ?? ''}` },
    { text: `Reporting currency ${result.reportingCurrency ?? ''}` },
    { text: `Commitment ${m?.totalCommitment ?? '-'}    Paid in ${m?.paidIn ?? '-'}` },
    { text: `Distributions ${m?.distributions ?? '-'}    NAV ${m?.currentNav ?? '-'}` },
    { text: `Net IRR ${m?.netIrr ?? '-'}    TVPI ${m?.tvpi ?? '-'}    DPI ${m?.dpi ?? '-'}    RVPI ${m?.rvpi ?? '-'}` },
  ];
  if (result.openEndedMetrics) {
    const o = result.openEndedMetrics;
    lines.push({ text: `Units ${o.unitsHeld}    NAV per unit ${o.navPerUnit}    Account value ${o.accountValue}` });
  }
  for (const fund of (result.byFund ?? []).slice(0, 10)) {
    lines.push({ text: `${fund.fundName} (${fund.structure}): NAV ${fund.nav}    Paid in ${fund.paidIn}    TVPI ${fund.tvpi ?? '-'}` });
  }
  lines.push({ text: 'Published fund position. This file does not create a new valuation.', size: 9 });
  return renderPdf('PERFORMANCE REPORT', lines);
}

export async function getJob(ctx: LpContext, jobId: string): Promise<LpJobStatus> {
  const job = await loadPerformanceJob(ctx, jobId);
  if (!job) throw new LpError(404, 'LP_NOT_FOUND', 'Job not found');
  return {
    jobId,
    jobType: job.jobType,
    status: job.status,
    result: job.result,
    downloadUrl: reportDownloadPath(jobId),
    errorMessage: null,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}
