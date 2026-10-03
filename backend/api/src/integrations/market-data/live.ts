import { liveStub } from '../core/live';
import { meta, type MarketDataAdapter } from './types';

/** Live market-data adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: MarketDataAdapter = liveStub<MarketDataAdapter>(meta);
