import { liveStub } from '../core/live';
import { meta, type SmsAdapter } from './types';

/** Live sms adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: SmsAdapter = liveStub<SmsAdapter>(meta);
