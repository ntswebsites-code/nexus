# Handoff 28: M13 (slice 5) — Orders post-trade + live KPI strip

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: FR-OMS-011, ADMIN-5A5

## 1. Goal (one paragraph)

M13 slice 5 removes prototype numbers from the Orders page when signed in and wires post-trade: all six KPI tiles read from `GET /orders` summary and row rollups; Order 360 modal and drawer execution tab fetch `GET /orders/:id/post-trade` (fills, slippage, contract-note match, settlement readiness); the post-trade blotter tab lists live filled orders with contract-note and settlement columns.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Sync src → public bridges |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w3-orders.test.ts` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w6-nav-accounting-regulatory-reports.test.ts` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w8-private-markets-data-models.test.ts` | **PASS** | |

## 3. Changes

| File | Change |
|---|---|
| `admin-90-orders.js` | Post-trade fetch/cache; `renderKpis` all six tiles; drawer + `orderModal` live bodies; post-trade tab; `updateOrderKpis` override; hide v35 demo strip when live |
| `10-page-orders.html` | KPI placeholders `—` instead of demo numbers |
| `docs/ADMIN-REAL-PAGES.md` | Orders, regulatory, data gap columns corrected |
| `w3-orders.test.ts` | Post-trade bridge assertions + drawer test |

## 4. Remaining M13 work

Pages 3–4, 6–9, 11–16, 18–21, 23–28 still list gaps (mostly CRUD without routes or ops-native-only flows). Next high-value targets with APIs: **financing** facility lifecycle, **reconciliations** assign/investigate, **cash** journal submit flows.

## 5. Acceptance checklist

- [x] Orders KPI strip shows API data only when live (no flash of 7/2/18/8.4 bps/94%)
- [x] Post-trade panel in drawer and Order 360 modal
- [x] Regulatory evidence + data exception actions reflected in gap table (already wired)
- [x] w3 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed: command (25), portfolios/services (26), ops/accounting (27), orders post-trade (28). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-28

Next targets: financing facility actions (GET/POST /financing/*), recon assign/investigate where routes exist, cash journal submit — only wire controls with real endpoints; no hardcoded KPI/demo numbers when mx.strict(page) is on.

Validation: node tools/legacy-bridge.mjs --only admin --check; w5, w8 legacy tests.
```
