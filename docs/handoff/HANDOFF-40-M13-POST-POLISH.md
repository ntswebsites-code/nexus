# HANDOFF-40 — M13 post-sweep polish

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-39 (M13 sweep complete)

## 1. Goal

Close remaining `ADMIN-REAL-PAGES.md` gap notes that had backend routes but were not yet wired in legacy bridges.

## 2. Changes

| File | Change |
|---|---|
| `admin-81-ibor.js` | `applyIborColumnVisibility` + `wrapRenderIborColumns` — saved column groups hide ledger columns |
| `admin-72-operations.js` | `exportRunbook('csv'|'xlsx')` — **Export XLSX** button beside CSV (`GET /operations/tasks?format=xlsx`) |
| `admin-93-performance.js` | `computeExcessRisk` — annualised TE / IR from live daily `series` when benchmark present |
| `w1` / `w2` / `w4` tests | New static assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 8, 14, 17 gaps cleared |
| `IMPLEMENTATION_MILESTONES.md` | M13 marked complete |
| `docs/TODO.md` | M11/M13 status updated |

## 3. Honest remaining limitations

| Area | Note |
|---|---|
| Recon connector | 503 when custodian adapter not configured |
| Accounting | Multi-basis book config has no API |
| Model governance | v37 wizard simplified UX |
| Copilot | Multi-table answer rendering unverified in browser |
| RBAC | Per-cell matrix toggles remain for preview |
| Settings | `platformSettingsV8` prototype-only when not live |
| Audit | Facet counts at very large chain sizes unverified |

## 4. Verification

```bash
node tools/legacy-bridge.mjs --only admin
node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=threads --maxWorkers=1 --testTimeout=15000 tests/frontend/legacy/w1-command-ops.test.ts
npx vitest run --pool=threads --maxWorkers=1 --testTimeout=15000 tests/frontend/legacy/w2-portfolios-ibor.test.ts
npx vitest run --pool=threads --maxWorkers=1 --testTimeout=15000 tests/frontend/legacy/w4-research-risk-performance.test.ts
```

## §11 — Copy-paste prompt for next agent

```
M13 admin legacy sweep + post-polish complete (HANDOFF-40). Branch feat/original-ui-wiring. No commit/push unless I ask.

All 28 sidebar pages: gap column — or honest API-only limits in ADMIN-REAL-PAGES.md.

Next: owner sign-off on /ops-native removal, LP/onboarding portal live sweeps, or UAT deploy (D-07).
```
