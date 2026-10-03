import { integrationMode } from '../common';
import { FakeMarketDataProvider } from './fake';
import { LiveMarketDataProvider } from './live';
import { PublicMarketDataProvider } from './public/provider';
import type { MarketDataAdapter, MarketDataMode } from './types';

export type { MarketDataAdapter, MarketDataMode } from './types';
export * from './types';

export const marketDataMode = (env: NodeJS.ProcessEnv = process.env): MarketDataMode => integrationMode<MarketDataMode>('INTEGRATION_MARKET_DATA', ['public', 'fake', 'live'], 'fake', env);

let cached: { mode: MarketDataMode; adapter: MarketDataAdapter } | null = null;

/** `INTEGRATION_MARKET_DATA=public|fake|live` (default fake: nothing touches the internet unless production opts in). */
export function getMarketDataAdapter(env: NodeJS.ProcessEnv = process.env): MarketDataAdapter {
  const mode = marketDataMode(env);
  if (cached?.mode === mode) return cached.adapter;
  const adapter = mode === 'public' ? new PublicMarketDataProvider() : mode === 'live' ? new LiveMarketDataProvider() : new FakeMarketDataProvider();
  cached = { mode, adapter };
  return adapter;
}

/** The scheduler runs by default only for `public`; set MARKET_DATA_SCHEDULER=on|off to override. */
export function schedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.MARKET_DATA_SCHEDULER ?? '').trim().toLowerCase();
  if (v === 'on' || v === 'true' || v === '1') return true;
  if (v === 'off' || v === 'false' || v === '0') return false;
  return marketDataMode(env) === 'public';
}
