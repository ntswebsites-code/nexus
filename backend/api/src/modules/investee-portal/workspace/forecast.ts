import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import type { InvesteeContext } from '../investee.context';
import { D, ensureWorkspace, requireSigner, sha256 } from './store';
import { FORECAST_METRICS, SIGNED_METRICS, computeForecast, type ForecastCells, type ForecastMetric } from './forecast-math';

const monthStr = z.string().regex(/^\d{4}-\d{2}$/);
const metricEnum = z.enum(FORECAST_METRICS);

// ---------------------------------------------------------------- forecast

export const forecastSchema = z.object({
  scenario: z.enum(['Base case', 'Upside', 'Downside']).optional(),
  /** Legacy total-revenue shorthand; the same as `cells.revenue`. */
  revenue: z.record(monthStr, z.number().finite().min(0, 'Forecast revenue cannot be negative')).optional(),
  /** P&L, cash and balance inputs by metric then month (BR-263). */
  cells: z
    .record(z.string(), z.record(monthStr, z.number().finite()))
    .refine((cells) => Object.keys(cells).every((k) => metricEnum.safeParse(k).success), { message: `Unknown forecast metric; use one of ${FORECAST_METRICS.join(', ')}` })
    .optional(),
  /** The working version the editor loaded; a stale number is refused with 409 version_conflict (CMP-016, BR-208). */
  baseVersion: z.number().int().min(1).optional(),
});
export const forecastLockSchema = z.object({ periods: z.array(monthStr).min(1).max(24) });

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function rollingMonths(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  return Array.from({ length: 12 }, (_, index) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const stage = index < 3 ? 'actual-locked' : index === 3 ? 'actual-open' : 'forecast';
    const label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { key, label, stage };
  });
}

const previousMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function loadCells(companyId: string): Promise<ForecastCells> {
  const rows = await prisma.investeeForecastCell.findMany({ where: { companyId } });
  const cells: ForecastCells = {};
  for (const row of rows) {
    if (!(FORECAST_METRICS as readonly string[]).includes(row.metric)) continue;
    const metric = row.metric as ForecastMetric;
    (cells[metric] ??= {})[row.period] = row.value.toNumber();
  }
  return cells;
}

/** Closing cash the company last reported before the first forecast month; seeds the opening-cash chain. */
async function openingSeed(companyId: string, firstForecast: string) {
  const prior = await prisma.reportingPeriod.findFirst({
    where: { companyId, period: { lte: previousMonth(firstForecast) }, status: { in: ['submitted', 'accepted'] } },
    orderBy: { period: 'desc' },
    select: { kpiValues: true },
  });
  return num(asObject(prior?.kpiValues)?.['BS.cashAndEquivalents']) ?? 0;
}

export async function forecastView(companyId: string) {
  const ws = await ensureWorkspace(companyId);
  const [cells, locks, periods, versions] = await Promise.all([
    loadCells(companyId),
    prisma.investeeForecastLock.findMany({ where: { companyId } }),
    prisma.reportingPeriod.findMany({ where: { companyId }, select: { period: true, status: true, kpiValues: true } }),
    prisma.investeeForecastVersion.findMany({ where: { companyId }, orderBy: { versionNo: 'desc' }, take: 50, select: { versionNo: true, scenario: true, submittedAt: true, sha256: true } }),
  ]);
  const stored = new Map(Object.entries(cells.revenue ?? {}));
  const locked = new Set(locks.map((l) => l.period));
  const actuals: Record<string, number | null> = {};
  for (const period of periods) {
    const revenue = num(asObject(period.kpiValues)?.totalRevenue);
    if (revenue !== null && (period.status === 'submitted' || period.status === 'accepted')) actuals[period.period] = revenue;
  }
  const months = rollingMonths().map((m) => ({ ...m, locked: locked.has(m.key) }));
  const forecastMonths = months.filter((m) => m.stage !== 'actual-locked');
  const forecast: Record<string, number | null> = {};
  for (const m of forecastMonths) forecast[m.key] = stored.get(m.key) ?? null;
  const actualTotal = Object.values(actuals).reduce<number>((s, v) => s + (v ?? 0), 0);
  const forecastTotal = Object.values(forecast).reduce<number>((s, v) => s + (v ?? 0), 0);
  const scale = ws.forecastScenario === 'Upside' ? 1.15 : ws.forecastScenario === 'Downside' ? 0.8 : 1;
  const firstForecast = forecastMonths[0]!.key;
  const pnl = computeForecast(forecastMonths.map((m) => m.key), cells, await openingSeed(companyId, firstForecast));
  return {
    scenario: ws.forecastScenario,
    months,
    actuals,
    forecast,
    lockedPeriods: [...locked].sort(),
    scenarios: {
      'Base case': { revenue: actualTotal + forecastTotal, note: 'Board working plan' },
      Upside: { revenue: (actualTotal + forecastTotal) * 1.15, note: 'Accelerated growth' },
      Downside: { revenue: (actualTotal + forecastTotal) * 0.8, note: 'Liquidity stress' },
    },
    activeRevenue: (actualTotal + forecastTotal) * scale,
    /** BR-208: the open working version, and the immutable submitted ones. */
    workingVersion: ws.forecastWorkingVersion,
    latestSubmittedVersion: versions[0]?.versionNo ?? null,
    submittedVersions: versions.map((v) => ({ versionNo: v.versionNo, scenario: v.scenario, submittedAt: v.submittedAt.toISOString(), sha256: v.sha256 })),
    /** BR-263 and BR-209: the P&L and cash roll-forward computed on the server. */
    cells,
    pnl: { firstForecastMonth: firstForecast, months: pnl.rows, annual: pnl.annual },
  };
}

export async function saveForecast(c: InvesteeContext, body: z.infer<typeof forecastSchema>, audit: AuditContext) {
  const companyId = c.company.id;
  const ws = await ensureWorkspace(companyId);
  if (body.baseVersion !== undefined && body.baseVersion !== ws.forecastWorkingVersion) {
    throw HttpError.conflict(`Forecast version ${body.baseVersion} was already submitted; reload to edit working version ${ws.forecastWorkingVersion}`, 'version_conflict');
  }
  const incoming: ForecastCells = {};
  for (const [period, value] of Object.entries(body.revenue ?? {})) (incoming.revenue ??= {})[period] = value;
  for (const [metric, byMonth] of Object.entries(body.cells ?? {}) as [ForecastMetric, Record<string, number>][]) {
    for (const [period, value] of Object.entries(byMonth)) (incoming[metric] ??= {})[period] = value;
  }
  const firstForecast = rollingMonths().find((m) => m.stage !== 'actual-locked')!.key;
  const entries: [ForecastMetric, string, number][] = [];
  for (const [metric, byMonth] of Object.entries(incoming) as [ForecastMetric, Record<string, number>][]) {
    for (const [period, value] of Object.entries(byMonth)) {
      if (!SIGNED_METRICS.has(metric) && value < 0) throw HttpError.badRequest(`Forecast ${metric} cannot be negative`, [{ path: `cells.${metric}.${period}`, message: 'Must be zero or more' }]);
      if (metric === 'openingCash' && period !== firstForecast) {
        throw HttpError.badRequest("Opening cash is carried from the previous month's closing cash; enter it for the first forecast month only", [{ path: `cells.openingCash.${period}`, message: `Only ${firstForecast} takes an opening balance` }]);
      }
      entries.push([metric, period, value]);
    }
  }
  const touched = [...new Set(entries.map(([, p]) => p))];
  await prisma.$transaction(async (tx) => {
    if (touched.length) {
      const locked = await tx.investeeForecastLock.findMany({ where: { companyId, period: { in: touched } } });
      if (locked.length) throw HttpError.conflict(`${locked.map((l) => l.period).join(', ')} is locked and cannot be edited`, 'period_locked');
    }
    if (body.scenario) await tx.investeeWorkspace.update({ where: { companyId }, data: { forecastScenario: body.scenario } });
    for (const [metric, period, value] of entries) {
      await tx.investeeForecastCell.upsert({
        where: { companyId_period_metric: { companyId, period, metric } },
        create: { companyId, period, metric, value: new D(value), updatedBy: c.userId },
        update: { value: new D(value), updatedBy: c.userId },
      });
    }
    // The stored `revenue` total follows the revenue components so older readers stay correct.
    for (const period of touched) {
      const parts = await tx.investeeForecastCell.findMany({ where: { companyId, period, metric: { in: ['merchantRevenue', 'enterpriseRevenue', 'otherRevenue'] } } });
      if (!parts.length) continue;
      const total = parts.reduce((s, p) => s + p.value.toNumber(), 0);
      await tx.investeeForecastCell.upsert({
        where: { companyId_period_metric: { companyId, period, metric: 'revenue' } },
        create: { companyId, period, metric: 'revenue', value: new D(total), updatedBy: c.userId },
        update: { value: new D(total), updatedBy: c.userId },
      });
    }
    await writeAudit(tx, audit, { action: 'company.forecast.saved', objectType: 'investee_forecast', objectId: companyId, after: { scenario: body.scenario ?? null, cells: entries.length, workingVersion: ws.forecastWorkingVersion } });
  });
  return forecastView(companyId);
}

export async function lockForecast(c: InvesteeContext, body: z.infer<typeof forecastLockSchema>, lock: boolean, audit: AuditContext) {
  requireSigner(c, lock ? 'lock forecast months' : 'unlock forecast months');
  if (!lock && c.profile !== 'workspace_administrator') throw HttpError.forbidden('Only a workspace administrator can unlock a month', 'permission_denied');
  const companyId = c.company.id;
  await ensureWorkspace(companyId);
  await prisma.$transaction(async (tx) => {
    for (const period of body.periods) {
      if (lock) {
        await tx.investeeForecastLock.upsert({ where: { companyId_period: { companyId, period } }, create: { companyId, period, lockedBy: c.userId }, update: {} });
      } else {
        await tx.investeeForecastLock.deleteMany({ where: { companyId, period } });
      }
    }
    await writeAudit(tx, audit, { action: lock ? 'company.forecast.locked' : 'company.forecast.unlocked', objectType: 'investee_forecast', objectId: companyId, after: { periods: body.periods } });
  });
  return forecastView(companyId);
}

// ---------------------------------------------------------------- versions (BR-208)

/**
 * Freezes the working forecast as the next immutable version. The working cells stay in place, so the new working
 * version starts as a copy of the version just submitted. Submitting an unchanged forecast is refused.
 */
export async function submitForecast(c: InvesteeContext, audit: AuditContext) {
  requireSigner(c, 'submit the forecast');
  const companyId = c.company.id;
  const view = await forecastView(companyId);
  const hasData = Object.values(view.cells).some((byMonth) => Object.keys(byMonth ?? {}).length > 0);
  if (!hasData) throw HttpError.badRequest('Enter forecast figures before submitting');
  const latest = await prisma.investeeForecastVersion.findFirst({ where: { companyId }, orderBy: { versionNo: 'desc' } });
  const data = { scenario: view.scenario, cells: view.cells, pnl: view.pnl };
  const stable = (v: unknown) => JSON.stringify(v, (_k, val: unknown) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));
  const latestData = (latest?.data ?? null) as { scenario?: string; cells?: unknown } | null;
  if (latestData && stable(latestData.cells) === stable(view.cells) && latestData.scenario === view.scenario) {
    throw HttpError.conflict(`No changes since version ${latest!.versionNo}; edit the working version before submitting again`, 'unchanged_forecast');
  }
  const versionNo = view.workingVersion;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.investeeWorkspace.updateMany({ where: { companyId, forecastWorkingVersion: versionNo }, data: { forecastWorkingVersion: versionNo + 1 } });
    if (claim.count !== 1) throw HttpError.conflict('This forecast was just submitted', 'version_conflict');
    await tx.investeeForecastVersion.create({
      data: { companyId, versionNo, scenario: view.scenario, data: data as unknown as Prisma.InputJsonValue, sha256: sha256(stable(data)), submittedBy: c.userId },
    });
    await writeAudit(tx, audit, { action: 'company.forecast.submitted', objectType: 'investee_forecast', objectId: companyId, after: { versionNo, scenario: view.scenario } });
  });
  return forecastView(companyId);
}

const versionRow = (v: { versionNo: number; scenario: string; submittedAt: Date; sha256: string; data: unknown; submittedBy: string }) => ({
  versionNo: v.versionNo,
  scenario: v.scenario,
  submittedAt: v.submittedAt.toISOString(),
  sha256: v.sha256,
  submittedBy: v.submittedBy,
  data: v.data,
});

/** Only submitted versions exist as rows, so this is exactly what the fund is allowed to see. */
export async function submittedForecastVersions(companyId: string, versionNo?: number) {
  if (versionNo !== undefined) {
    const row = await prisma.investeeForecastVersion.findUnique({ where: { companyId_versionNo: { companyId, versionNo } } });
    if (!row) throw HttpError.notFound('Forecast version not found');
    return versionRow(row);
  }
  const rows = await prisma.investeeForecastVersion.findMany({ where: { companyId }, orderBy: { versionNo: 'desc' }, take: 50 });
  return rows.map(versionRow);
}
