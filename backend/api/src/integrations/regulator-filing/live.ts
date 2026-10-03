import { liveStub } from '../core/live';
import { meta, type RegulatorFilingAdapter } from './types';

/** Live regulator-filing adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: RegulatorFilingAdapter = liveStub<RegulatorFilingAdapter>(meta);
