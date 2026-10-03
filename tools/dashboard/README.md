# Matanho Nexus progress dashboard

Live, read-only dashboard built from real sources. No framework, no build step.

## Start / reopen

Run from the repo root (`C:\Users\lysp\Downloads\matanho-nexus-v56-deployment`):

```
node tools/dashboard/server.mjs 47931            # static server, 127.0.0.1 only
node tools/dashboard/build-status.mjs --watch 120  # regenerates status.json every 120 s
```

Open http://127.0.0.1:47931/. One-off rebuild: `node tools/dashboard/build-status.mjs` (about 15-30 s, 90 s on a cold git cache).
Check the port is in use: `netstat -ano | findstr 47931`.

Page query options (for testing): `?refresh=10` auto-refresh every 10 s (default 300 s), `?now=15` shifts the page clock 15 minutes ahead (shows the stale banner; `?now=<ISO date>` also works).
Routes: `#/` overview, `#/tasks`, `#/issues`, `#/agents`, `#/stage/<id>`, `#/workstream/<id>`, `#/task/<id>`, `#/agent/<id>`, `#/issue/<id>`, `#/decisions`, `#/sources`. Filters and sort live in the hash query (`state, ws, stage, agent, sev, istate, group, status, q, sort, dir`), so they survive reloads and auto refresh.

## Data sources (all real)

STATUS-BOARD.md and TODO.md (tasks, stages), docs/issues/ISSUES-*.md, FIXES-F*.md / REVIEW-F*.md / RETEST*.md (newest by mtime across the main checkout and every git worktree), WATCHDOG.md, FIX-GROUPS.md (issue to fix-group map), DECISION-LOG.md, `git worktree list` plus per-worktree log/diff/status, workflow `journal.jsonl` files and agent `.meta.json` (transcript files are only stat-ed for mtime/size, never read), and `manual-status.json` merged last. A change to manual-status.json triggers an immediate rebuild.

Derivations: issue with FIXES status `fixed` => fixed_awaiting_retest; `not-a-defect` => not_a_defect; latest RETEST line PASS => passed, FAIL => failed (unless FIXES was updated later). Agent `active` = transcript written in the last 10 min; without a result and quiet longer = `stalled`. Progress: passed=1, awaiting_retest=0.8, in_progress=0.5, others 0, each task equal weight. Fix-group tasks derive state from their issues; R4 packages from the journal result and whether the branch is merged into feat/admin-recon-nav. Worktrees of recently active agents get a full dirty scan; others scan tracked files only (`dirtyScan` field). `activity` is append-only (max 200, newest first) and records changes seen between builds plus watchdog and re-test lines.

## manual-status.json (lead overrides, optional)

```
{ "notes": ["text"], "tasks": { "<taskId>": { "state": "blocked", "notes": "..." } },
  "addTasks": [ { "id": "X-1", "title": "...", "state": "in_progress", "stage": "release", "workstream": "B" } ],
  "issues": { "<ADA-001>": { "state": "passed" } }, "agents": { "<id or label>": { "description": "..." } },
  "stages": { "<stageId>": { "note": "..." } }, "workstreams": {}, "project": {} }
```
Any task field may be overridden; `updatedAt` defaults to the file time.

## status.json schema (schemaVersion 1)

- `generatedAt` ISO; `sources[]` {name, path, found, modifiedAt, bytes|count}; `warnings[]`; `sizes`.
- `project` {name, baseBranch, baseCommit, progressPct, progressPctExcludingBaseline, taskCount, stateCounts{not_started,in_progress,awaiting_retest,passed,failed,blocked}, progressRule, activeAgents, issues{total, byState, bySeverity, openBySeverity}}.
- `workstreams[]` (A fixes and re-test, B next stages, C delivered baseline) and `stages[]`: {id, title, description, total, counts, progressPct, taskIds}.
- `tasks[]` {id, title, description, stage, workstream, agent, state, startedAt, updatedAt, stateChangedAt, files[], verification, issueIds[], notes, source}.
- `agents[]` {id, label, status active|done|failed|queued|stalled, currentTask, completed[], queued[], branch, worktree, lastCommitAt, lastActivityAt, commitsAheadOfBase, resultSummary, workflow, phase}.
- `issues[]` {id, severity critical|major|minor, severityRaw, title, location, steps, expected, actual, evidence, group, fixer, state open|fixed_awaiting_retest|passed|failed|not_a_defect, fix{status, rootCause, changed, files, howToRetest, notes}, reviewVerdict, retestHistory[{result, at, note}], updatedAt}.
- `decisions[]` {id, date, unclear, decision, reason}; `reviews[]`; `watchdog[]`; `workflows[]`; `worktrees[]`; `activity[]` {key, at, kind, ref, text}; `notes[]`.

Missing facts are `null` and shown as "unknown"; nothing is estimated.
