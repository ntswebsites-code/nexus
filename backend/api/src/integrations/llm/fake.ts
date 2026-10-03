import { answerQuestion } from '../../modules/admin-core/copilot';
import type { LlmAdapter } from './types';

/** The existing deterministic Copilot router, so fake mode answers exactly as before. */
export class FakeLlm implements LlmAdapter {
  async answer({ question, permissions }: { question: string; permissions: string[] }) {
    return answerQuestion(question, new Set(permissions));
  }
  async complete({ prompt }: { prompt: string; maxTokens?: number }) {
    const first = prompt.trim().split(/\s+/).slice(0, 24).join(' ');
    return { text: `[fake-llm] ${first}`, model: 'fake-deterministic-v1' };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter: deterministic keyword router (no external model)' };
  }
}
