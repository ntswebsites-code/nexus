import { getAdapter } from '../core/registry';
import type { EmailAdapter } from './types';

export * from './types';

/** The configured email adapter (INTEGRATION_EMAIL=fake|live). Every call is logged to integration_calls. */
export const getEmailAdapter = (): EmailAdapter => getAdapter('email');
