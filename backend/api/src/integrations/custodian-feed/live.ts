import { liveStub } from '../core/live';
import { meta, type CustodianFeedAdapter } from './types';

/** Live custodian-feed adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: CustodianFeedAdapter = liveStub<CustodianFeedAdapter>(meta);
