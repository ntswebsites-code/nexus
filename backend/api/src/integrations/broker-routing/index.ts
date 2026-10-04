import { getAdapter } from '../core/registry';
import type { BrokerRoutingAdapter } from './types';

export * from './types';
export { brokerRoutingMode } from './factory';
export { FeedParseError, parseContractNoteText, parseFixMessage, buildFixExecutionReport, extractPdfText } from './parse';
export { orderRefForBrokerRef } from './fake';

/** The configured broker-routing adapter (INTEGRATION_BROKER_ROUTING=fake|live). Every call is logged to integration_calls. */
export const getBrokerRoutingAdapter = (): BrokerRoutingAdapter => getAdapter('broker-routing');
