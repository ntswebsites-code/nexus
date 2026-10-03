import { getAdapter } from '../core/registry';
import type { IdentityVerificationAdapter } from './types';

export * from './types';

/** The configured identity-verification adapter (INTEGRATION_IDENTITY_VERIFICATION=fake|live). Every call is logged to integration_calls. */
export const getIdentityVerificationAdapter = (): IdentityVerificationAdapter => getAdapter('identity-verification');
