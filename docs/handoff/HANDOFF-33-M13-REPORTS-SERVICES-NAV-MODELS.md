# Handoff 33: M13 (slice 10) — Reports / investor services / NAV / model governance live chrome

Date 2026-10-06 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A12, ADMIN-5A10, ADMIN-5A20, ADMIN-5A24

## 1. Goal (one paragraph)

M13 slice 10 removes hardcoded KPI strips and demo panels on Reports, Investor Services (v14), Valuation/NAV, and Model Governance when signed in (`mx.strict(page)`). Closes wiring gaps: report KPI patch from runs+schedules, v14 live queues/table, external NAV recording, model reviews/bindings/usage modals.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=forks --maxWorkers=1 w6,w7,w8 legacy tests` | **PASS** | |

## 3. Changes

| File | Change |
|---|---|
| `admin-102-reports.js` | `clearReportsKpis`, `patchReportsKpis` from runs + schedules |
| `admin-30-investor-services.js` | `clearServiceChrome`, v14 live table/queues, hide demo cards |
| `admin-98-nav.js` | `clearNavKpis`, `patchNavKpis`/`patchNavLanes`, external NAV modal, hide demo ribbon/stagebar |
| `admin-85-model-governance.js` | `clearModelKpis`, reviews calendar wired, bindings/usage modals |
| `15/17/23/29-page-*.html` | Neutral `—` placeholders; demo-only classes |
| `w6` / `w7` / `w8` tests | clear* / live render assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 10, 12, 20, 24 gaps reduced |

## 4. Remaining M13 work

Cash reservation modal, corporate-actions elections, accounting journal create, settings/RBAC ops-native layout, data schedules upload, copilot FAB — per gap column.

## 5. Acceptance checklist

- [x] Reports/investor-services/valuation/model-governance KPIs show `—` until API loads
- [x] Investor services v14 demo cards hidden when live
- [x] External NAV PUT wired
- [x] Model reviews/bindings/usage modals from API
- [x] w6 + w7 + w8 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 10 (HANDOFF-33). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-33

Next targets: cash reservation create, corporate-actions elections, accounting journals, data schedules — wire only where routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w5–w9 legacy tests as touched.
```
