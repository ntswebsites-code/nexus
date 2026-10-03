import { getAdapter } from '../core/registry';
import type { BrokerRoutingAdapter } from './types';

export * from './types';

/** The configured broker-routing adapter (INTEGRATION_BROKER_ROUTING=fake|live). Every call is logged to integration_calls. */
export const getBrokerRoutingAdapter = (): BrokerRoutingAdapter => getAdapter('broker-routing');
