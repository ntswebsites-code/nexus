import { liveStub } from '../core/live';
import { meta, type ScreeningAdapter } from './types';

/** Live screening adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: ScreeningAdapter = liveStub<ScreeningAdapter>(meta);
