# Handoff 27: M13 (slice 4) — Operations settlement fails + accounting live stat/NAV grid

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A17, ADMIN-5A21

## 1. Goal (one paragraph)

M13 slice 4 wires two admin pages that still showed prototype KPIs despite existing APIs: Operations settlement exposure now links to `GET /ops-controls/settlement-fails`, and Accounting stat line + NAV oversight table read from portfolios, trial balance, NAV history, and operations close blockers.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w1-command-ops.test.ts` | **PASS** | 5/5 |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w6-nav-accounting-regulatory-reports.test.ts` | **PASS** | 5/5 |

## 3. Changes

| File | Change |
|---|---|
| `admin-72-operations.js` | Fetch settlement-fails; `renderSettlementFails` + modal; settlement KPI subtitle |
| `admin-100-accounting.js` | `updateStatLine` from portfolios KPIs + TB + ops status; `updateNavOversight` from `/nav/history` |
| `docs/ADMIN-REAL-PAGES.md` | Operations + accounting gaps narrowed |
| `w1-command-ops.test.ts`, `w6-nav-accounting-regulatory-reports.test.ts` | Bridge assertions |

## 4. Remaining M13 work

Pages 3–9, 11–16, 18–28 still list gaps (mostly CRUD flows without routes). Continue per HANDOFF-26 §11.

## 5. Acceptance checklist

- [x] Operations settlement KPI references live fails register
- [x] Accounting stat line and NAV oversight table use API data when signed in
- [x] w1 + w6 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed: command (25), portfolios/services (26), ops/accounting (27). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-27

Next targets: orders post-trade panel (GET /orders/:id/post-trade), regulatory evidence upload gaps, data page exception actions — only where routes exist.

Validation: node tools/legacy-bridge.mjs --only admin --check; w3, w5, w8 legacy tests.
```
