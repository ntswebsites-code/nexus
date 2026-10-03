import { getAdapter } from '../core/registry';
import type { SsoAdapter } from './types';

export * from './types';

/** The configured sso adapter (INTEGRATION_SSO=fake|live). Every call is logged to integration_calls. */
export const getSsoAdapter = (): SsoAdapter => getAdapter('sso');
