import { getAdapter } from '../core/registry';
import type { SmsAdapter } from './types';

export * from './types';

/** The configured sms adapter (INTEGRATION_SMS=fake|live). Every call is logged to integration_calls. */
export const getSmsAdapter = (): SmsAdapter => getAdapter('sms');
