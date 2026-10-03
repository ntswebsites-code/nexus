import { IntegrationNotConfiguredError } from '../common';
import type { Batch, FetchContext, FxPair, FxQuote, HealthReport, HistoryPoint, MarketDataAdapter, Quote } from './types';

/**
 * Paid market-data feed placeholder (Bloomberg/Refinitiv/ZSE Data Direct licence or similar). The vendor and
 * credentials are supplied later; until then every call fails with a clear NotConfigured error and the health
 * check reports what is missing. Implement the four methods against the vendor API and map to the shared types.
 */
export const LIVE_REQUIRED_ENV = ['MARKET_DATA_LIVE_BASE_URL', 'MARKET_DATA_LIVE_API_KEY'];

const fail = (): never => {
  throw new IntegrationNotConfiguredError('Market data', LIVE_REQUIRED_ENV, 'Provider contract and entitlements are pending.');
};

export class LiveMarketDataProvider implements MarketDataAdapter {
  readonly name = 'live' as const;
  async fetchQuotes(_tickers: string[], _ctx?: FetchContext): Promise<Batch<Quote>> {
    return fail();
  }
  async fetchHistory(_ticker: string, _from: string, _to: string, _ctx?: FetchContext): Promise<Batch<HistoryPoint>> {
    return fail();
  }
  async fetchFx(_pairs: FxPair[], _ctx?: FetchContext): Promise<Batch<FxQuote>> {
    return fail();
  }
  async healthCheck(): Promise<HealthReport> {
    const missing = LIVE_REQUIRED_ENV.filter((k) => !process.env[k]);
    return {
      ok: false,
      provider: 'live',
      detail: `Not configured: vendor client not implemented${missing.length ? `; missing ${missing.join(', ')}` : ''}`,
      sources: [{ source: 'LIVE', label: 'Paid market-data feed', url: process.env.MARKET_DATA_LIVE_BASE_URL ?? '', ok: false, detail: 'NotConfigured' }],
    };
  }
}
