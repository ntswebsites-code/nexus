import { liveStub } from '../core/live';
import { meta, type LlmAdapter } from './types';

/** Live llm adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: LlmAdapter = liveStub<LlmAdapter>(meta);
