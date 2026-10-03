import { getAdapter } from '../core/registry';
import type { RegulatorFilingAdapter } from './types';

export * from './types';

/** The configured regulator-filing adapter (INTEGRATION_REGULATOR_FILING=fake|live). Every call is logged to integration_calls. */
export const getRegulatorFilingAdapter = (): RegulatorFilingAdapter => getAdapter('regulator-filing');
