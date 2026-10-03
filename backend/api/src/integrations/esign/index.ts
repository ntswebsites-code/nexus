import { getAdapter } from '../core/registry';
import type { EsignAdapter } from './types';

export * from './types';

/** The configured esign adapter (INTEGRATION_ESIGN=fake|live). Every call is logged to integration_calls. */
export const getEsignAdapter = (): EsignAdapter => getAdapter('esign');
