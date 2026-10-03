import type { AdapterMeta } from '../core/types';
import { LIVE_REQUIRED_ENV } from './live';

export const meta: AdapterMeta = {
  name: 'market-data',
  label: 'Market data feed',
  gap: 'GAP-A04',
  description: 'End-of-day prices, history and FX. `public` scrapes free public pages with provenance; `live` is a paid-feed stub.',
  requiredEnv: LIVE_REQUIRED_ENV,
  vendorCalls: { fetchQuotes: 'Paid feed: end-of-day quotes', fetchHistory: 'Paid feed: price history', fetchFx: 'Paid feed: FX rates' },
};
