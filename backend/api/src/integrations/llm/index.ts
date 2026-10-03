import { getAdapter } from '../core/registry';
import type { LlmAdapter } from './types';

export * from './types';

/** The configured llm adapter (INTEGRATION_LLM=fake|live). Every call is logged to integration_calls. */
export const getLlmAdapter = (): LlmAdapter => getAdapter('llm');
