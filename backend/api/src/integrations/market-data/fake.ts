import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import type { BenchmarkPoint, CorporateActionNotice, FxQuote, MarketDataAdapter, PriceQuote } from './types';

const n32 = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Value of one unit of a currency in USD terms; derived from the code so cross rates stay consistent. */
const unitValue = (ccy: string) => (ccy === 'USD' ? 1 : 1 + (n32(`ccy:${ccy}`) % 5000) / 100);

/** Deterministic daily feed: the same ticker and date always return the same number. */
export class FakeMarketData implements MarketDataAdapter {
  async getPrices({ tickers, date }: { tickers: string[]; date: string }): Promise<PriceQuote[]> {
    return tickers.map((ticker) => {
      const base = 20 + (n32(`px:${ticker}`) % 48000) / 100;
      const wiggle = ((n32(`px:${ticker}:${date}`) % 400) - 200) / 10000;
      return { ticker, date, price: (base * (1 + wiggle)).toFixed(6), currency: 'USD' };
    });
  }
  async getFxRates({ date, pairs }: { date: string; pairs: { from: string; to: string }[] }): Promise<FxQuote[]> {
    return pairs.map(({ from, to }) => {
      const wiggle = ((n32(`fx:${from}${to}:${date}`) % 200) - 100) / 10000;
      const rate = from === to ? 1 : (unitValue(to) / unitValue(from)) * (1 + wiggle);
      return { from, to, date, rate: rate.toFixed(10) };
    });
  }
  async getCorporateActions({ sinceDate }: { sinceDate: string }): Promise<CorporateActionNotice[]> {
    const rows = await prisma.integrationInbox.findMany({ where: { adapter: 'market-data', kind: 'corporate_action', status: 'NEW', createdAt: { gte: day(sinceDate) } }, orderBy: { createdAt: 'asc' }, take: 200 });
    return rows.map((r) => r.payload as unknown as CorporateActionNotice);
  }
  async getBenchmark({ code, from, to }: { code: string; from: string; to: string }): Promise<BenchmarkPoint[]> {
    const out: BenchmarkPoint[] = [];
    let level = 1000 + (n32(`bm:${code}`) % 5000) / 10;
    for (let d = day(from); d <= day(to) && out.length < 400; d = new Date(d.getTime() + 86_400_000)) {
      level *= 1 + ((n32(`bm:${code}:${iso(d)}`) % 200) - 100) / 10000;
      out.push({ date: iso(d), level: level.toFixed(4) });
    }
    return out;
  }
  async health() {
    return { ok: true, detail: 'Fake adapter: deterministic daily prices, FX and benchmark series' };
  }
}
