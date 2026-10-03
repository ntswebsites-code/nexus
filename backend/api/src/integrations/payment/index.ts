import { getAdapter } from '../core/registry';
import type { PaymentAdapter } from './types';

export * from './types';

/** The configured payment adapter (INTEGRATION_PAYMENT=fake|live). Every call is logged to integration_calls. */
export const getPaymentAdapter = (): PaymentAdapter => getAdapter('payment');
