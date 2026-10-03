import { getAdapter } from '../core/registry';
import type { AvScanAdapter } from './types';

export * from './types';

/** The configured av-scan adapter (INTEGRATION_AV_SCAN=fake|live). Every call is logged to integration_calls. */
export const getAvScanAdapter = (): AvScanAdapter => getAdapter('av-scan');
