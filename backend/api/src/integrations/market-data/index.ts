import { getAdapter } from '../core/registry';
import type { MarketDataAdapter } from './types';

export * from './types';

/** The configured market-data adapter (INTEGRATION_MARKET_DATA=fake|live). Every call is logged to integration_calls. */
export const getMarketDataAdapter = (): MarketDataAdapter => getAdapter('market-data');
