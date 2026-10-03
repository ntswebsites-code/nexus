import { liveStub } from '../core/live';
import { meta, type SsoAdapter } from './types';

/** Live sso adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: SsoAdapter = liveStub<SsoAdapter>(meta);
