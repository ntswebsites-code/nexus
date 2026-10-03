import { liveStub } from '../core/live';
import { meta, type BankStatementAdapter } from './types';

/** Live bank-statement adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: BankStatementAdapter = liveStub<BankStatementAdapter>(meta);
