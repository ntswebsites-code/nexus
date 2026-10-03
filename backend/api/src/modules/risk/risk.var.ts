import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { getPortfolioSnapshot } from '../portfolio/portfolio.service';

/**
 * Historical-simulation value at risk on the current book, from stored daily security prices (no external feed).
 * Each held line's daily simple return is weighted by its share of the book; the portfolio return series covers only
 * the dates on which every counted line has a price move. Lines with fewer than MIN_OBS returns are left out and
 * reported through `coveragePct`. Cash earns zero. The horizon scales by the square root of time.
 */
const MIN_OBS = 20;

export interface VarResult {
  portfolioId: string;
  portfolioRef: string;
  asOf: string;
  baseCurrency: string;
  confidence: number;
  horizonDays: number;
  observations: number;
  bookValue: string;
  varAmount: string;
  varPct: string;
  /** Share of the securities value that had enough price history. */
  coveragePct: string;
  excluded: string[];
  method: 'HISTORICAL_SIMULATION';
}

export function varFromReturns(returns: number[], confidence: number, horizonDays: number): number {
  if (!returns.length) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - confidence) * sorted.length)));
  return Math.max(0, -sorted[idx]!) * Math.sqrt(horizonDays);
}

export async function computeVar(portfolioIdOrRef: string, confidence: number, horizonDays: number, lookbackDays: number): Promise<VarResult> {
  const snap = await getPortfolioSnapshot(portfolioIdOrRef);
  const lines = snap.lines.filter((l) => l.marketValueBase !== null && Number(l.marketValueBase) > 0);
  const total = Number(snap.totals.totalValueBase);
  const secTotal = Number(snap.totals.securitiesValueBase);
  if (!lines.length || total <= 0) throw HttpError.conflict('The portfolio has no valued positions to measure', 'empty_book');
  const since = new Date(Date.now() - lookbackDays * 86_400_000 * 1.5);
  const series = new Map<string, Map<string, number>>();
  const excluded: string[] = [];
  let covered = 0;
  for (const l of lines) {
    const rows = await prisma.securityPrice.findMany({ where: { securityId: l.securityId, priceDate: { gte: since } }, orderBy: { priceDate: 'asc' }, select: { priceDate: true, price: true } });
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.priceDate.toISOString().slice(0, 10), Number(r.price)); // last source wins
    const days = [...byDay.keys()].sort();
    const rets = new Map<string, number>();
    for (let i = 1; i < days.length; i++) {
      const p0 = byDay.get(days[i - 1]!)!;
      if (p0 > 0) rets.set(days[i]!, byDay.get(days[i]!)! / p0 - 1);
    }
    if (rets.size < MIN_OBS) excluded.push(l.ticker);
    else {
      series.set(l.securityId, rets);
      covered += Number(l.marketValueBase);
    }
  }
  if (!series.size) throw HttpError.conflict(`No position has at least ${MIN_OBS} daily price returns`, 'insufficient_history');
  const counted = lines.filter((l) => series.has(l.securityId));
  let dates = [...series.get(counted[0]!.securityId)!.keys()];
  for (const l of counted.slice(1)) dates = dates.filter((d) => series.get(l.securityId)!.has(d));
  dates = dates.sort().slice(-lookbackDays);
  if (dates.length < MIN_OBS) throw HttpError.conflict(`Only ${dates.length} common price dates across the positions (need ${MIN_OBS})`, 'insufficient_history');
  const returns = dates.map((d) => counted.reduce((s, l) => s + (Number(l.marketValueBase) / total) * series.get(l.securityId)!.get(d)!, 0));
  const pct = varFromReturns(returns, confidence, horizonDays);
  return {
    portfolioId: snap.portfolio.id,
    portfolioRef: snap.portfolio.ref,
    asOf: snap.asOf,
    baseCurrency: snap.baseCurrency,
    confidence,
    horizonDays,
    observations: dates.length,
    bookValue: total.toFixed(2),
    varAmount: (pct * total).toFixed(2),
    varPct: (pct * 100).toFixed(4),
    coveragePct: (secTotal > 0 ? (covered / secTotal) * 100 : 0).toFixed(2),
    excluded,
    method: 'HISTORICAL_SIMULATION',
  };
}
