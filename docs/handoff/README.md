# Handoff docs (original UI wiring)

**Start here:** `LATEST.md` — one line pointing at the current handoff file.

## Required when you finish a phase

Every phase owner **must** deliver all of:

1. Code + tests + `legacy-bridge.mjs --check`
2. A new `HANDOFF-<NN>-W<n>.md` (increment NN; n = phase letter)
3. Update `LATEST.md` to point at that file
4. **Section 11** in the new handoff: the meta-rule below **and** a copy-paste prompt for the **next** agent

The next agent should need only `LATEST.md` + the prompt — not archaeology through chat history.

## Section 11 template (put at end of every new handoff)

```markdown
## 11. Next agent — copy-paste this prompt

> **Handoff rule:** When you complete your phase, write the next `HANDOFF-*.md`, update `LATEST.md`, and replace this block with a fresh copy-paste prompt for the following agent.

\`\`\`
Read docs/handoff/LATEST.md, then docs/handoff/HANDOFF-<this-file>.md (especially §9).
Implement <next phase> per §9 and CLEANUP-AGENT-PROMPT §5.
Deliver: bridges/hooks/tests, legacy-bridge --check, HANDOFF-<next>.md, LATEST.md update, and §11 prompt for the agent after you.
\`\`\`
```
