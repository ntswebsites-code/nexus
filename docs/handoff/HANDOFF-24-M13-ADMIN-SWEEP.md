# Handoff 24: M13 (slice 1) — Command centre gio chart tabs live data

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A01 (partial)

## 1. Goal (one paragraph)

First M13 slice: when signed in on the command page (`mx.strict('command')`), attribution, scenario fan, risk heat, and liquidity waterfall tabs read from `GET /dashboard/panels` allocation/scenario data and `GET /dashboard/today` cash — not the v30 chart engine demo literals. Overview performance SVG remains driven by `admin-71-command.js` (v30 `renderPerformance` skipped when live series present).

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Applied w1 hooks to `09-v30-chart-engine.js` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w1-command-ops.test.ts` | **PASS** | 5/5 |

## 3. Changes

| File | Change |
|---|---|
| `portals/admin-web/src/legacy/bridge/admin-71-command.js` | `stashGioCharts()` maps panels/today → `window.__mxData._gio*`; calls `__mxRerenderCommandCharts` |
| `tools/hooks/w1.mjs` | DATA_HOOKS on `09-v30-chart-engine.js` for attribution, scenario base, risk heat, liquidity waterfall; skip v30 performance when `_commandPerfLive`; expose `__mxRerenderCommandCharts` |
| `tests/frontend/legacy/w1-command-ops.test.ts` | Asserts chart hooks + `stashGioCharts` |
| `docs/ADMIN-REAL-PAGES.md` | Command row gap narrowed to scope chips + mini-liquidity demo |

## 4. Remaining M13 work

See `ADMIN-REAL-PAGES.md` gap column for pages 2–28. Command page still demo: `data-gio-scope` chips, `#gioMiniLiquidity`.

## 5. Acceptance checklist (this slice)

- [x] Gio chart tabs use API-backed data when signed in on command page
- [x] Legacy bridge check green; w1 test extended
- [ ] Full M13 sweep (all 28 pages) — continue per HANDOFF-23 §11
