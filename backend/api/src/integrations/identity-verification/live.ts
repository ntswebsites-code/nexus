import { liveStub } from '../core/live';
import { meta, type IdentityVerificationAdapter } from './types';

/** Live identity-verification adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: IdentityVerificationAdapter = liveStub<IdentityVerificationAdapter>(meta);
