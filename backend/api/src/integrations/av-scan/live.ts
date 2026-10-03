import { liveStub } from '../core/live';
import { meta, type AvScanAdapter } from './types';

/** Live av-scan adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: AvScanAdapter = liveStub<AvScanAdapter>(meta);
