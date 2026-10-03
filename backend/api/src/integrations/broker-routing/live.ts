import { liveStub } from '../core/live';
import { meta, type BrokerRoutingAdapter } from './types';

/** Live broker-routing adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: BrokerRoutingAdapter = liveStub<BrokerRoutingAdapter>(meta);
