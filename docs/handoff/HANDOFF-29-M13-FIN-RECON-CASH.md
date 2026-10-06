# Handoff 29: M13 (slice 6) — Financing + recon + cash live KPIs

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A15, ADMIN-5A18

## 1. Goal (one paragraph)

M13 slice 6 removes prototype numbers from Financing, Reconciliations and Cash when signed in, and completes wire-up for facility lifecycle actions that already had API routes. Financing KPIs now read `GET /financing/summary` plus facility/call rollups; recon patches all six KPI tiles from `GET /recon/overview` and the break queue; cash clears demo tiles before hydrate and updates expectation/reservation counts from API.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w5-cash-recon-financing.test.ts` | **PASS** | |

## 3. Changes

| File | Change |
|---|---|
| `admin-96-financing.js` | `clearFinancingKpis`, `/summary`, full KPI strip, facility submit/approve/draw/repay modal, hide demo optimiser |
| `admin-95-recon.js` | `clearReconKpis`, all six KPI tiles + step ribbon from overview/breaks |
| `admin-94-cash.js` | `clearCashTiles`, expectation button count, ledger strip from balances |
| `20/22/25-page-*.html` | Neutral `—` placeholders instead of demo figures |
| `w5-cash-recon-financing.test.ts` | Bridge assertions |
| `docs/ADMIN-REAL-PAGES.md` | Financing, cash, recon gap columns |

## 4. Remaining M13 work

Pages 3–4, 6–9, 11–14, 16 (partial), 19, 23–28 still list gaps. Next: **research IC**, **risk limit lifecycle**, **performance period lock**, **private-markets CRUD** — only where routes exist.

## 5. Acceptance checklist

- [x] Financing KPIs and facility submit/approve wired when live
- [x] Recon KPI strip and assign/investigate reflected in gap table
- [x] Cash page shows API balances, not prototype $10k tiles
- [x] w5 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 6 (HANDOFF-29). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-29

Next targets: research IC flows, risk limit submit/approve, performance period lock/recompute — wire only where GET/POST routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w4, w8 legacy tests.
```
