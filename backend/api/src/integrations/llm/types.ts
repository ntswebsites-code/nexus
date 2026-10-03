import type { AdapterBase, AdapterMeta } from '../core/types';
import type { CopilotAnswer } from '../../modules/admin-core/copilot';

export interface LlmAdapter extends AdapterBase {
  /** Grounded Copilot answer for a staff question; `permissions` bounds what data may be used. */
  answer(input: { question: string; permissions: string[] }): Promise<CopilotAnswer>;
  /** Free-form completion (for example onboarding triage summaries). */
  complete(input: { prompt: string; maxTokens?: number }): Promise<{ text: string; model: string }>;
}

export const meta: AdapterMeta = {
  name: 'llm',
  label: 'LLM',
  gap: 'GAP-A09',
  description: 'Language model behind the Copilot and onboarding triage.',
  requiredEnv: ['LLM_API_KEY', 'LLM_MODEL'],
  vendorCalls: {
    answer: 'Anthropic Messages API: system prompt with the permitted data rows as context, return answer plus cited sources',
    complete: 'Anthropic Messages API with LLM_MODEL',
  },
  productionSafeFake: () => true,
};
