# HANDOFF-35 — M13 slice 12: Operations / IBOR / Recon / Portfolios / Copilot

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-34 (slice 11)

## 1. Goal

Remove remaining hardcoded KPI/demo chrome on live+strict pages and wire recon depth, IBOR events/lots, portfolio evidence upload, and Copilot FAB.

## 2. Rule

When `mx.live && mx.strict(page)`: KPI strips and stat lines clear to `—` / `Loading…` on hydrate before API repopulates. Wire only where routes exist. No commit/push unless owner asks (D-07).

## 3. Changes

| File | Change |
|---|---|
| `admin-72-operations.js` | `clearOpsChrome()` on hydrate/onLoad |
| `admin-81-ibor.js` | `clearIborChrome()`, events/lots modals (`GET /ibor/events`, `/lots`) |
| `admin-80-portfolios.js` | `clearPortfolioChrome()`, multipart evidence on create |
| `admin-95-recon.js` | Rules modal (tolerances, account map, custody upload), evidence attach, reopen |
| `admin-86-copilot.js` | `clearCopilotChrome()`, live FAB + ⌘J, live suggestion chips |
| `07/19/21/30-page-*.html` | Neutral placeholders |
| `w1` / `w2` / `w5` / `w9` tests | New assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 2, 14, 17, 18, 23, 25 gaps updated |

## 4. Remaining M13 work

Orders import / STOP_LIMIT, research filing import, valuation inputs edit + pack download, performance period correction, private-markets cashflow notices, shell record drawer, RBAC ops-native layout, connector-import recon feed (503 until adapter configured).

## 5. Acceptance checklist

- [x] Operations / portfolios / IBOR / copilot markup neutralized
- [x] `clear*Chrome` on hydrate for operations, portfolios, IBOR, copilot
- [x] Recon tolerances + account map + custody CSV upload modal
- [x] Recon break evidence attach + reopen
- [x] Portfolio create accepts optional mandate evidence file
- [x] IBOR events and tax-lots modals
- [x] Copilot FAB uses live page (not demo `appendV15Copilot`)
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 12 (HANDOFF-35). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-35

Next targets: orders/research/valuation/performance gaps, shell record drawer, RBAC polish — wire only where routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w3,w4,w6,w9 legacy tests as touched.
```
