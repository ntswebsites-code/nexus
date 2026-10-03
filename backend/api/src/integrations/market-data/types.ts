import type { AdapterBase, AdapterMeta } from '../core/types';

export interface PriceQuote {
  ticker: string;
  date: string;
  price: string;
  currency: string;
}
export interface FxQuote {
  from: string;
  to: string;
  date: string;
  rate: string;
}
export interface CorporateActionNotice {
  ticker: string;
  type: 'DIVIDEND' | 'SPLIT' | 'RIGHTS';
  exDate: string;
  amountPerShare: string | null;
}
export interface BenchmarkPoint {
  date: string;
  level: string;
}

export interface MarketDataAdapter extends AdapterBase {
  getPrices(input: { tickers: string[]; date: string }): Promise<PriceQuote[]>;
  getFxRates(input: { date: string; pairs: { from: string; to: string }[] }): Promise<FxQuote[]>;
  getCorporateActions(input: { sinceDate: string }): Promise<CorporateActionNotice[]>;
  getBenchmark(input: { code: string; from: string; to: string }): Promise<BenchmarkPoint[]>;
}

export const meta: AdapterMeta = {
  name: 'market-data',
  label: 'Market data feed',
  gap: 'GAP-A04',
  description: 'End-of-day prices, FX rates, corporate action announcements and benchmark series.',
  requiredEnv: ['MARKET_DATA_API_URL', 'MARKET_DATA_API_KEY'],
  vendorCalls: {
    getPrices: 'GET {MARKET_DATA_API_URL}/eod?symbols=...&date=...',
    getFxRates: 'GET {MARKET_DATA_API_URL}/fx?pairs=...&date=...',
    getCorporateActions: 'GET {MARKET_DATA_API_URL}/corporate-actions?since=...',
    getBenchmark: 'GET {MARKET_DATA_API_URL}/indices/{code}?from=...&to=...',
  },
};
