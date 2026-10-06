# HANDOFF-41 — M13 follow-up: FR-OPS-011 calendar, copilot tables, audit hydrate

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-40

## 1. Goal

Wire remaining admin items that had backend routes per `ORIGINAL-UI-WIRING-PLAN` / `ADMIN-REAL-PAGES.md` honest gaps.

## 2. Changes

| File | Change |
|---|---|
| `admin-72-operations.js` | `exportCalendar(csv\|xlsx)` in calendar modal (FR-OPS-011) |
| `admin-86-copilot.js` | `renderTableHtml` + `extraTables` from LLM copilot path |
| `admin-61-access-depth.js` | `mx.hydrate('audit')` clears demo rows, loads facets + live events |
| `w1` / `w9` tests | New assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 17, 25, 28 updated |

## 3. Honest remaining limitations

| Area | Note |
|---|---|
| Recon connector | 503 when custodian adapter not configured |
| Accounting | Multi-basis book config has no API |
| Model governance | v37 wizard simplified UX |
| RBAC | Per-cell matrix toggles remain for preview |
| Settings | `platformSettingsV8` workspace prefs prototype-only when not live |
| Audit | Large-chain facet parity vs ops-native (browser QA deferred) |

## 4. Verification

```bash
node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w1-command-ops.test.ts
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w9-copilot-rbac-audit-qa.test.ts
```

## §11 — Next

Owner sign-off: `/ops-native` removal, UAT deploy `uat-rc11-original-ui`, LP/onboarding live sweeps (M9/M10). No commit/push unless asked (D-07).
