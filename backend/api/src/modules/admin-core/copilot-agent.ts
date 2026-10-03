import { getLlmAdapter } from '../../integrations/llm';
import { COPILOT_TOOLS, answerQuestion, type CopilotAnswer, type CopilotSource, type CopilotToolCall } from './copilot';

const MAX_CALLS = 3;

/**
 * R4-8 Copilot orchestration. The LLM adapter plans which tools to call; the SERVER runs each tool under the caller's own
 * permissions (the model never sees data the person may not see and cannot invent a tool), and the answer is composed from
 * the tool results only, with every tool's sources cited. If the adapter is not configured, errors, or picks no tool,
 * the deterministic keyword router answers exactly as before (engine = ROUTER).
 */
export async function askCopilot(question: string, permissions: string[]): Promise<CopilotAnswer> {
  const perms = new Set(permissions);
  const llm = getLlmAdapter();
  try {
    const plan = await llm.plan({ question, tools: COPILOT_TOOLS.map((t) => ({ name: t.name, description: t.description })) });
    const wanted: string[] = [];
    for (const c of plan.calls) if (COPILOT_TOOLS.some((t) => t.name === c.tool) && !wanted.includes(c.tool)) wanted.push(c.tool);
    if (!wanted.length) return fallback(question, perms);
    const toolCalls: CopilotToolCall[] = [];
    const done: { tool: string; ans: CopilotAnswer }[] = [];
    for (const name of wanted.slice(0, MAX_CALLS)) {
      const tool = COPILOT_TOOLS.find((t) => t.name === name)!;
      if (tool.permission && !perms.has(tool.permission)) {
        toolCalls.push({ tool: name, permission: tool.permission, status: 'DENIED', rows: 0 });
        continue;
      }
      const ans = await tool.run(question, perms);
      const rows = ans.sources.reduce((n, s) => n + s.rows, 0);
      toolCalls.push({ tool: name, permission: tool.permission, status: 'OK', rows });
      done.push({ tool: name, ans });
    }
    if (!done.length) {
      const first = COPILOT_TOOLS.find((t) => t.name === wanted[0])!;
      return { intent: first.name, answer: `I cannot answer that for you: it draws on data that needs the ${first.permission} permission, which your roles do not include.`, table: null, sources: [], engine: 'LLM', toolCalls, model: plan.model };
    }
    const composed = await llm.compose({ question, results: done.map((d) => ({ tool: d.tool, answer: d.ans.answer, rows: d.ans.sources.reduce((n, s) => n + s.rows, 0) })) });
    const denied = toolCalls.filter((c) => c.status === 'DENIED');
    const sources: CopilotSource[] = done.flatMap((d) => d.ans.sources);
    const tables = done.filter((d) => d.ans.table);
    return {
      intent: done[0]!.ans.intent,
      answer: composed.text + (denied.length ? ` (Not included, needs permissions you lack: ${denied.map((d) => d.permission).join(', ')}.)` : ''),
      table: tables[0]?.ans.table ?? null,
      extraTables: tables.slice(1).map((d) => ({ title: d.tool, ...d.ans.table! })),
      sources,
      engine: 'LLM',
      toolCalls,
      model: composed.model,
    };
  } catch (e) {
    console.warn(`[copilot] LLM path unavailable, using the keyword router: ${e instanceof Error ? e.message : String(e)}`);
    return fallback(question, perms);
  }
}

async function fallback(question: string, perms: Set<string>): Promise<CopilotAnswer> {
  const a = await answerQuestion(question, perms);
  return { ...a, engine: 'ROUTER', toolCalls: [] };
}
