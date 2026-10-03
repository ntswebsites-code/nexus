import { getAdapter } from '../core/registry';
import type { ScreeningAdapter } from './types';

export * from './types';

/** The configured screening adapter (INTEGRATION_SCREENING=fake|live). Every call is logged to integration_calls. */
export const getScreeningAdapter = (): ScreeningAdapter => getAdapter('screening');
