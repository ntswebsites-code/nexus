# Handoff 26: M13 (slice 3) — Portfolios TWR + investor-services money KPIs

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A02, ADMIN-5A10

## 1. Goal (one paragraph)

M13 slice 3 closes two demo-data gaps with existing backend routes: portfolio list rows show each portfolio's latest locked TWR (not a hardcoded em dash), and investor-services v34 money/publication KPI tiles derive from live capital events, documents, and service requests instead of static v34 literals.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w2-portfolios-ibor.test.ts` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w7-clients-services-onboarding-vault.test.ts` | **PASS** | |

## 3. Changes

### Backend

| File | Change |
|---|---|
| `portfolio.routes.ts` | `latestLockedTwrByPortfolio()`; `GET /portfolios?kpis=1` adds `latestTwrPct` + `latestTwrPeriodEnd` per row |

### Frontend bridges

| File | Change |
|---|---|
| `admin-80-portfolios.js` | `toProtoRow()` uses `latestTwrPct` for return column |
| `admin-30-investor-services.js` | `serviceMoneyKpis()` + extended `patchServiceKpis()` for all six tiles; `mx.hydrate('investor-services')` |

### Docs / tests

- `ADMIN-REAL-PAGES.md` — portfolios and investor-services gaps narrowed
- `w2-portfolios-ibor.test.ts`, `w7-clients-services-onboarding-vault.test.ts` — bridge assertions

## 4. Remaining M13 work

Pages 3–9, 11–28 in `ADMIN-REAL-PAGES.md` still list gaps (mostly CRUD flows without API routes). Continue sweep per HANDOFF-25 §11.

## 5. Acceptance checklist

- [x] Portfolio rows show locked TWR when API returns `latestTwrPct`
- [x] Investor-services money due in/out and publication queue tiles use live capital/docs data
- [x] Legacy tests w2 + w7 green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 admin legacy sweep on branch feat/original-ui-wiring. Command (HANDOFF-25), portfolios + investor-services (HANDOFF-26) done. No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-26 §11 context

Prioritise: demo charts/KPIs with backend routes (orders post-trade tiles, accounting NAV grid, operations close-gates if routes exist).

Validation: node tools/legacy-bridge.mjs --only admin --check; w2–w9 legacy tests one file at a time on Windows.
```
