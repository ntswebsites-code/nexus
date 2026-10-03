import { getAdapter } from '../core/registry';
import type { CustodianFeedAdapter } from './types';

export * from './types';

/** The configured custodian-feed adapter (INTEGRATION_CUSTODIAN_FEED=fake|live). Every call is logged to integration_calls. */
export const getCustodianFeedAdapter = (): CustodianFeedAdapter => getAdapter('custodian-feed');
