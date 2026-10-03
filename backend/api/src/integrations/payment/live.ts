import { liveStub } from '../core/live';
import { meta, type PaymentAdapter } from './types';

/** Live payment adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: PaymentAdapter = liveStub<PaymentAdapter>(meta);
