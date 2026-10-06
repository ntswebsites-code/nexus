# Handoff 25: M13 (slice 2) — Command page fully live

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A01

## 1. Goal (one paragraph)

Completes the command centre live wiring: scope chips (`data-gio-scope`) and mini-liquidity horizon no longer revert to v30 demo after chart-engine init. KPI strip, scope filters, liquidity strip, and all gio chart tabs now read from `GET /dashboard/today`, `GET /dashboard/panels`, and `GET /operations/workload` when signed in.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w1-command-ops.test.ts` | **PASS** | 5/5 |

## 3. Changes

| File | Change |
|---|---|
| `admin-71-command.js` | `buildGioScope()`, `buildMiniLiquidity()`, workload fetch, `_gioScope` / `_gioMiniLiquidity`, `__mxApplyGioScope('whole')` after stash |
| `tools/hooks/w1.mjs` | Hooks `updateScope`, `renderMiniLiquidity`, `__mxApplyGioScope` on `09-v30-chart-engine.js` |
| `docs/ADMIN-REAL-PAGES.md` | Command row gap → `—` |
| `tests/frontend/legacy/w1-command-ops.test.ts` | Asserts scope + mini-liquidity hooks |

## 4. Remaining M13 work

Pages 2–28 in `ADMIN-REAL-PAGES.md` still list per-page gaps (mostly flows without API routes — honest empty states). Continue sweep per HANDOFF-23 §11.

## 5. Acceptance checklist (command page)

- [x] Scope chips use allocation/today data when live (no demo overwrite on init)
- [x] Mini-liquidity uses cash cover + workload `cashByDay` when available
- [x] ADMIN-REAL-PAGES command gap closed
- [ ] Full M13 sweep across remaining 27 pages

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 admin legacy sweep on branch feat/original-ui-wiring. Command page is complete (HANDOFF-25). No commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-25-M13-COMMAND-COMPLETE.md
2. docs/ADMIN-REAL-PAGES.md — gap column pages 2–28
3. IMPLEMENTATION_MILESTONES.md — M13

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment

## Scope

Close gaps that have backend routes; mark "no API" for flows that genuinely lack routes. Prioritise pages with demo chart/KPI data over missing CRUD modals.

## Validation

node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=vmThreads tests/frontend/legacy/w1-command-ops.test.ts
# then w2–w9 one file at a time on Windows

## Deliverable

HANDOFF-26 or incremental handoff; update ADMIN-REAL-PAGES as gaps close.
```
