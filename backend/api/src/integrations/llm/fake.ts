import { answerQuestion } from '../../modules/admin-core/copilot';
import { routeIntent } from '../../modules/admin-core/admin-core.engine';
import type { LlmAdapter, LlmToolResult, TriageInput, TriageResult } from './types';

const MODEL = 'fake-deterministic-v1';
const HIGH_RISK_COUNTRIES = new Set(['iran', 'north korea', 'syria', 'myanmar', 'yemen', 'afghanistan']);

/** Deterministic triage rules so fake mode (and tests) behave predictably; the live adapter replaces this with a model. */
export function ruleTriage(i: TriageInput): TriageResult {
  const flags: string[] = [];
  const next: string[] = [];
  const failed = i.checks.filter((c) => c.outcome === 'FAIL').map((c) => c.kind);
  const referred = i.checks.filter((c) => c.outcome === 'REFER').map((c) => c.kind);
  const notRun = i.checks.filter((c) => !c.outcome).map((c) => c.kind);
  if (failed.length) flags.push(`Failed checks: ${failed.join(', ')}`);
  if (referred.length) flags.push(`Referred checks: ${referred.join(', ')}`);
  if (i.applicant.pep && !/^(no|none|false)$/i.test(i.applicant.pep)) flags.push(`Declared PEP status: ${i.applicant.pep}`);
  if (i.applicant.country && HIGH_RISK_COUNTRIES.has(i.applicant.country.toLowerCase())) flags.push(`High-risk jurisdiction: ${i.applicant.country}`);
  if (!i.applicant.sourceOfFunds) flags.push('No source of funds declared');
  if ((i.applicant.expectedInvestment ?? 0) >= 1_000_000) flags.push('Large expected investment (1,000,000 or more)');
  if (i.applicant.type !== 'Individual' && i.applicant.owners === 0) flags.push('Entity applicant with no beneficial owners captured');
  if (i.missingEvidence.length) flags.push(`Missing evidence: ${i.missingEvidence.join(', ')}`);
  if (failed.length) next.push('Escalate to the compliance officer before any further work; consider declining.');
  if (referred.length) next.push(`Clear the referred checks (${referred.join(', ')}) with documented rationale.`);
  if (notRun.length) next.push(`Run the outstanding checks: ${notRun.join(', ')}.`);
  if (i.missingEvidence.length) next.push('Send an information request for the missing evidence.');
  if (!next.length) next.push(i.riskPreview.rating === 'High' ? 'Propose a High rating and route to enhanced due diligence.' : 'Propose the computed rating for checker approval.');
  // A declared PEP with no source of funds is an enhanced-due-diligence case whatever the weighted score says (the score is
  // configurable and can sit in Medium): triage escalates it to HIGH so it is routed to EDD first. Advisory only.
  const pepNoFunds = !!i.applicant.pep && !/^(no|none|false)$/i.test(i.applicant.pep) && !i.applicant.sourceOfFunds;
  if (pepNoFunds) next.push('Politically exposed person with no declared source of funds: obtain source of funds and wealth evidence and route to enhanced due diligence.');
  const high = failed.length > 0 || i.riskPreview.rating === 'High' || pepNoFunds || flags.some((f) => f.startsWith('High-risk'));
  const med = referred.length > 0 || i.riskPreview.rating === 'Medium' || flags.length > 0;
  const riskBand = high ? 'HIGH' : med ? 'MEDIUM' : 'LOW';
  const checked = i.checks.length - notRun.length;
  const summary = `${i.applicant.name} (${i.caseRef}): ${checked} of ${i.checks.length} checks recorded, computed risk ${i.riskPreview.rating} (score ${i.riskPreview.score}). ${flags.length ? `${flags.length} point(s) need attention.` : 'No adverse indicators found in the recorded facts.'} This is advisory; the analyst and approver decide.`;
  return { riskBand, summary, flags, nextSteps: next, model: MODEL };
}

/** The existing deterministic Copilot router, so fake mode answers exactly as before, plus deterministic tool planning, composition and triage. */
export class FakeLlm implements LlmAdapter {
  async answer({ question, permissions }: { question: string; permissions: string[] }) {
    return answerQuestion(question, new Set(permissions));
  }
  /** Picks every tool whose keywords appear in the question (best first, at most three). */
  async plan({ question, tools }: { question: string; tools: { name: string; description: string }[] }) {
    const { scores } = routeIntent(question);
    const offered = new Set(tools.map((t) => t.name));
    const calls = Object.entries(scores)
      .filter(([name, s]) => s > 0 && offered.has(name))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tool]) => ({ tool }));
    return { calls, model: MODEL };
  }
  async compose({ results }: { question: string; results: LlmToolResult[] }) {
    return { text: results.map((r) => r.answer).join(' '), model: MODEL };
  }
  async triage(input: TriageInput) {
    return ruleTriage(input);
  }
  async complete({ prompt }: { prompt: string; maxTokens?: number }) {
    const first = prompt.trim().split(/\s+/).slice(0, 24).join(' ');
    return { text: `[fake-llm] ${first}`, model: MODEL };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter: deterministic keyword planner and rule triage (no external model)' };
  }
}
