# HANDOFF-37 — M13 slice 14: Shell / PM cashflows / Services / Lab / RBAC

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-36 (slice 13)

## 1. Goal

Remove remaining hardcoded demo KPIs and prototype-only panels on shell-adjacent pages: shell record links, private-markets cashflow notices, investor-services commitment/unfunded totals, portfolio-lab construction sliders, RBAC KPI strip.

## 2. Rule

When `mx.live && mx.strict(page)`: KPI strips and stat lines clear to `—` / `Loading…` on hydrate before API repopulates. Wire only where routes exist. No commit/push unless owner asks (D-07).

## 3. Changes

| File | Change |
|---|---|
| `admin-70-shell.js` | `bindRecordLinkDelegation()` — intercepts `[data-mx-record-kind][data-mx-record-id]` and `/ops/record/:kind/:id` links → `openRecordDrawer` |
| `admin-83-private-markets.js` | `openCashflowNoticeModal`, `settleCashflow`, `cancelCashflow`, `openCommitmentDrawer` with cashflow table + actions |
| `admin-30-investor-services.js` | `GET /private-markets/clients` → `pmClientsByRef`; live commitment/unfunded in relationships + v14 table |
| `admin-82-portfolio-lab.js` | `patchLabConstructionLive()` — targets tab shows API message instead of hardcoded slider weights until what-if runs |
| `admin-61-access-depth.js` | `clearRbacChrome`, `toggleRbacDemoPanels`, `patchRbacTopCounts`, `mx.hydrate('rbac')` |
| `31-page-rbac.html` | KPI strip neutralized; maker-checker policy card `mx-demo-only` |
| `w1` / `w7` / `w8` / `w9` tests | New assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 3, 4, 10, 26, shell gaps cleared |

## 4. Remaining M13 work

Recon connector-import feed (503 until adapter configured), performance methodology (no API), accounting chart-of-accounts UI, RBAC ops-native tab layout polish.

## 5. Acceptance checklist

- [x] Shell record links open live drawer (palette, notifications, delegated anchors)
- [x] PM commitment drawer: notice call/distribution, settle, cancel cashflows
- [x] Investor-services commitment/unfunded from live PM clients API
- [x] Portfolio-lab construction tab neutral when live (no hardcoded weights)
- [x] RBAC KPI strip clears on hydrate; demo policy card hidden when live
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 14 (HANDOFF-37). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-37

Next targets: recon connector-import (when adapter exists), accounting chart-of-accounts, performance methodology, RBAC ops-native layout — wire only where routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w1,w5,w6,w9 legacy tests as touched.
```
