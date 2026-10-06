# Handoff 34: M13 (slice 11) — Cash / corporate actions / accounting / data schedules

Date 2026-10-06 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A16, ADMIN-5A19, ADMIN-5A21, ADMIN-5A23

## 1. Goal (one paragraph)

M13 slice 11 clears remaining hardcoded chrome on Cash (already had tiles), Corporate Actions, Accounting, and wires gap features: reservation modal, election modal, ABOR journal create/submit/return, data DQ schedules + FILE_FEED upload.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=forks --maxWorkers=1 w5,w6,w8 legacy tests` | **PASS** | |

## 3. Changes

| File | Change |
|---|---|
| `admin-94-cash.js` | `openNewReservationModal` intercept (live modal, not demo drawer) |
| `admin-97-corporate-actions.js` | `clearCaChrome`, statebar/deadline from API, election modal, hide demo panels |
| `admin-100-accounting.js` | `clearAccountingChrome`, journal create + submit/return workflow, hide demo banner |
| `admin-84-data.js` | `openSchedulesModal`, rule schedule PUT, FILE_FEED upload on click |
| `20/24/26/28-page-*.html` | Neutral placeholders; demo-only classes |
| `w5` / `w6` / `w8` tests | New route/clear assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 16, 19, 21, 23 gaps cleared |

## 4. Remaining M13 work

Operations XLSX export, recon evidence/tolerances, ibor events tab, settings/RBAC ops-native, copilot FAB, portfolio evidence upload — per gap column.

## 5. Acceptance checklist

- [x] Corporate actions / accounting KPI strips show `—` until API loads
- [x] Cash reservation + expectation modals wired (not toast-only)
- [x] Corporate elections + full event lifecycle from drawer
- [x] Accounting journal create + submit/return/post
- [x] Data schedules + staged FILE_FEED upload
- [x] w5 + w6 + w8 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 11 (HANDOFF-34). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-34

Next targets: operations/recon depth, ibor tabs, settings/RBAC polish, copilot — wire only where routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w1,w5,w9 legacy tests as touched.
```
