import { dayFromIso, hashUnit, isoDay, lastWeekdayOnOrBefore, sha256 } from '../common';
import type { Batch, FetchContext, FxPair, FxQuote, HealthReport, HistoryPoint, MarketDataAdapter, Quote } from './types';

const SOURCE = 'FAKE';
const URL_ = 'fake://market-data';

/** Deterministic base level per ticker (0.5 .. 50) and per-day drift of at most +-2%, so tests can assert exact values. */
export function fakeClose(ticker: string, dateIso: string): string {
  const base = 0.5 + hashUnit(`base:${ticker}`) * 49.5;
  // Walk: product of daily factors from a fixed epoch, computed in closed form per day-count to stay O(days).
  const epoch = dayFromIso('2026-01-01').getTime();
  const days = Math.max(0, Math.round((dayFromIso(dateIso).getTime() - epoch) / 86_400_000));
  let level = base;
  for (let d = Math.max(0, days - 60); d <= days; d++) level *= 1 + (hashUnit(`step:${ticker}:${d}`) - 0.5) * 0.04;
  return level.toFixed(6);
}

export function fakeFxRate(from: string, to: string, dateIso: string): string {
  const usd = (c: string) => (c === 'USD' ? 1 : c === 'ZWG' ? 26.5 * (1 + (hashUnit(`fx:${dateIso}`) - 0.5) * 0.01) : 0.5 + hashUnit(`ccy:${c}`) * 30);
  return (usd(to) / usd(from)).toFixed(10);
}

export class FakeMarketDataProvider implements MarketDataAdapter {
  readonly name = 'fake' as const;

  async fetchQuotes(tickers: string[], ctx: FetchContext = {}): Promise<Batch<Quote>> {
    const now = ctx.now ?? new Date();
    const day = lastWeekdayOnOrBefore(isoDay(now));
    const items = tickers.map<Quote>((ticker) => {
      const price = fakeClose(ticker, day);
      return { ticker, price, priceDate: day, volume: String(Math.floor(hashUnit(`vol:${ticker}:${day}`) * 50_000)), rawValue: price, source: SOURCE, url: URL_, fetchedAt: now, rawHash: sha256(`${ticker}|${day}|${price}`) };
    });
    return { items, issues: [], sources: [{ source: SOURCE, label: 'Deterministic fake generator', url: URL_, status: 'OK', count: items.length, fetchedAt: now, note: 'Test data only; never use in production' }] };
  }

  async fetchHistory(ticker: string, from: string, to: string, ctx: FetchContext = {}): Promise<Batch<HistoryPoint>> {
    const now = ctx.now ?? new Date();
    const items: HistoryPoint[] = [];
    for (let d = dayFromIso(to); d >= dayFromIso(from); d = new Date(d.getTime() - 86_400_000)) {
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      const day = isoDay(d);
      const close = fakeClose(ticker, day);
      items.push({ ticker, priceDate: day, close, volume: null, source: SOURCE, url: URL_, fetchedAt: now, rawHash: sha256(`${ticker}|${day}|${close}`) });
    }
    return { items, issues: [], sources: [] };
  }

  async fetchFx(pairs: FxPair[], ctx: FetchContext = {}): Promise<Batch<FxQuote>> {
    const now = ctx.now ?? new Date();
    const day = lastWeekdayOnOrBefore(isoDay(now));
    const items = pairs.map<FxQuote>((p) => {
      const rate = fakeFxRate(p.from, p.to, day);
      return { from: p.from, to: p.to, rate, rateDate: day, rawValue: rate, source: SOURCE, url: URL_, fetchedAt: now, rawHash: sha256(`${p.from}${p.to}|${day}|${rate}`) };
    });
    return { items, issues: [], sources: [] };
  }

  async healthCheck(): Promise<HealthReport> {
    return { ok: true, provider: 'fake', detail: 'Deterministic generator, no network', sources: [{ source: SOURCE, label: 'Fake generator', url: URL_, ok: true, detail: 'always available' }] };
  }
}
