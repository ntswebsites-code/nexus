import type { AdapterBase, AdapterMeta } from '../core/types';
import type { CopilotAnswer } from '../../modules/admin-core/copilot';

export interface LlmToolSpec {
  name: string;
  description: string;
}
export interface LlmToolCall {
  tool: string;
}
/** What a tool returned: the grounded text plus its row count; the model may only rephrase these, never add figures. */
export interface LlmToolResult {
  tool: string;
  answer: string;
  rows: number;
}

/** Facts about an onboarding case handed to the triage model (no document bytes, no identifiers beyond what the analyst sees). */
export interface TriageInput {
  caseRef: string;
  applicant: { name: string; type: string; country: string | null; pep: string | null; sourceOfFunds: string | null; expectedInvestment: number | null; owners: number };
  checks: { kind: string; outcome: string | null }[];
  riskPreview: { score: number; rating: string; factors: string[] };
  openReferrals: string[];
  missingEvidence: string[];
  blockers: string[];
}
export interface TriageResult {
  riskBand: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  flags: string[];
  nextSteps: string[];
  model: string;
}

export interface LlmAdapter extends AdapterBase {
  /** Grounded Copilot answer for a staff question; `permissions` bounds what data may be used. Keyword-router fallback. */
  answer(input: { question: string; permissions: string[] }): Promise<CopilotAnswer>;
  /** R4-8 tool use, step 1: choose which of the offered tools answer the question. */
  plan(input: { question: string; tools: LlmToolSpec[] }): Promise<{ calls: LlmToolCall[]; model: string }>;
  /** R4-8 tool use, step 2: write the answer from the tool results only. */
  compose(input: { question: string; results: LlmToolResult[] }): Promise<{ text: string; model: string }>;
  /** R4-8: advisory onboarding triage from case facts. Never a decision. */
  triage(input: TriageInput): Promise<TriageResult>;
  /** Free-form completion. */
  complete(input: { prompt: string; maxTokens?: number }): Promise<{ text: string; model: string }>;
}

export const meta: AdapterMeta = {
  name: 'llm',
  label: 'LLM',
  gap: 'GAP-A09',
  description: 'Language model behind the Copilot (cited tool calls over live data) and onboarding triage.',
  requiredEnv: ['LLM_API_KEY', 'LLM_MODEL'],
  vendorCalls: {
    answer: 'Anthropic Messages API: system prompt with the permitted data rows as context, return answer plus cited sources',
    plan: 'Anthropic Messages API with tools=[copilot tools]; collect tool_use blocks (the server executes them under the caller permissions)',
    compose: 'Anthropic Messages API with the tool_result blocks; return the final text',
    triage: 'Anthropic Messages API with the case facts and a JSON schema for {riskBand, summary, flags, nextSteps}',
    complete: 'Anthropic Messages API with LLM_MODEL',
  },
  productionSafeFake: () => true,
};
