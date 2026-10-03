import { liveStub } from '../core/live';
import { meta, type EsignAdapter } from './types';

/** Live esign adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: EsignAdapter = liveStub<EsignAdapter>(meta);
