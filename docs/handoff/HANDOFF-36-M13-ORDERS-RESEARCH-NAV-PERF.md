# HANDOFF-36 — M13 slice 13: Orders / Research / NAV / Performance

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-35 (slice 12)

## 1. Goal

Remove remaining hardcoded demo KPIs on orders-adjacent pages and wire the last slice-13 gaps: CSV order import, STOP_LIMIT fields, research filing import, NAV inputs/pack, performance correction + neutral attribution markup.

## 2. Rule

When `mx.live && mx.strict(page)`: KPI strips and stat lines clear to `—` / `Loading…` on hydrate before API repopulates. Wire only where routes exist. No commit/push unless owner asks (D-07).

## 3. Changes

| File | Change |
|---|---|
| `admin-90-orders.js` | CSV import modal (`POST /orders` per row), STOP_LIMIT + `priceOverrideReason`, live `submitTicket37` wrap, demo strip hide on hydrate |
| `admin-91-research.js` | `openFilingImportModal` → `POST /research/issuers/:id/filings` (multipart) |
| `admin-98-nav.js` | `openNavInputsModal` (`PATCH /inputs`), `downloadNavPack` (`GET /pack`) |
| `admin-93-performance.js` | `togglePerformanceDemoPanels`, extended `clearPerformanceChrome`, `openCorrectionModal` (`POST /periods/:id/correct`) |
| `13-page-performance.html` | Neutral attribution bars, table, controls; correction button |
| `23-page-valuation.html` | Edit inputs + Download pack buttons |
| `w3` / `w4` / `w6` tests | New assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 5, 6, 8, 20 gaps cleared |

## 4. Remaining M13 work

Shell record drawer links, private-markets cashflow notices, RBAC ops-native layout polish, connector-import recon feed (503 until adapter configured), performance methodology (no API), accounting chart-of-accounts UI.

## 5. Acceptance checklist

- [x] Orders CSV import creates draft orders from live catalogs
- [x] STOP_LIMIT stop/override prompt on v37 ticket and v33 composer submit
- [x] Research filing import uploads to issuer vault
- [x] NAV inputs modal patches run and recalculates
- [x] NAV pack JSON download from live run
- [x] Performance attribution/controls neutral on hydrate; correction workflow wired
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 13 (HANDOFF-36). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-36

Next targets: shell record drawer, private-markets cashflow notices, RBAC polish — wire only where routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w3,w4,w6,w9 legacy tests as touched.
```
