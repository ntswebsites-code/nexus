# HANDOFF-38 — M13 slice 15: Accounting / Recon / Performance / Financing

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-37 (slice 14)

## 1. Goal

Clear the last slice-15 hardcoded demo chrome: accounting close/journal panels, chart of accounts UI, recon connector import, performance methodology from live API, financing optimiser/curve panels.

## 2. Rule

When `mx.live && mx.strict(page)`: KPI strips and stat lines clear to `—` / `Loading…` on hydrate before API repopulates. Wire only where routes exist. No commit/push unless owner asks (D-07).

## 3. Changes

| File | Change |
|---|---|
| `admin-100-accounting.js` | Extended `clearAccountingChrome`; live journal badge + close checklist from API; `openChartOfAccountsModal` (`GET /accounts`, `POST /accounts/default-chart`) |
| `24-page-accounting.html` | Neutral journal/close panels; Chart of accounts button |
| `admin-95-recon.js` | Connector import in rules modal (`POST /connector-imports`, 503 toast when adapter missing) |
| `admin-93-performance.js` | `openMethodologyModal` from live returns `method` + controls; clear demo SVG paths on hydrate |
| `admin-96-financing.js` | `toggleFinancingDemoPanels` hides optimiser/curve when live |
| `25-page-financing.html` | Demo panels marked `mx-demo-only` with neutral placeholders |
| `w4` / `w5` / `w6` tests | New assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 8, 15, 18, 21 gaps updated |

## 4. Remaining M13 work

RBAC ops-native tab layout polish, investor-services portal-access depth (no API), performance TE/IR when API adds fields, multi-basis accounting configuration (no API).

## 5. Acceptance checklist

- [x] Accounting journal badge + close checklist from live period API (no static blockers)
- [x] Chart of accounts modal lists live accounts; seed default chart wired
- [x] Recon connector pull wired with graceful 503 when adapter unavailable
- [x] Performance methodology modal uses live returns payload
- [x] Financing collateral optimiser / funding curve hidden when live
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 15 (HANDOFF-38). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-38

Next targets: RBAC ops-native layout, investor-services portal-access when API exists, performance TE/IR — wire only where routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w4,w5,w6,w9 legacy tests as touched.
```
