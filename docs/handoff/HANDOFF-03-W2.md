# Handoff 03: W2 finished -> next: W3
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit `1ab13f5`

## 1. What this phase was (one paragraph)
W2 connected the Whole Portfolio list, IBOR & Positions, and Portfolio Construction pages to the live API. **What you can do now that you could not before W2:** open Portfolios and see real KPIs and portfolio rows (not demo literals), search and filter with saved views, create a portfolio via `POST /portfolios`, open a live portfolio drawer from a row, work IBOR with overview stats and a server-filtered position ledger, queue **Refresh IBOR** and **Reconcile positions**, persist column groups, load historical snapshots by as-of date, run portfolio-lab what-if from the optimiser button (portfolio + active model picker), save a rebalance proposal, and promote it to draft orders. The V56 look is unchanged; only data and actions are live.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| portfolios `07` | KPI strip, `#portfolioSearch`, filters modal, save view, create portfolio, row → drawer | `GET /portfolios`, `/portfolios/facets`, `GET/PATCH /portfolios/:id`, `POST /portfolios`, `GET/PUT/DELETE /views` | `admin-80-portfolios.js` |
| ibor `19` | Stat line, control bar, health checklist, ladder, `#iborSearch` / filters, refresh, reconcile, columns, snapshot | `GET /ibor/overview`, `/ibor/ledger`, `/settlement-ladder`, `POST /ibor/refresh`, `GET /ibor/refresh-jobs/:id`, `POST /ibor/reconcile`, `PUT /views` (ibor.columns) | `admin-81-ibor.js` |
| portfolio-lab `09` | `#v33Optimise`, `#v33ConstructionSave`, `#v33PromoteOrders` | `GET /portfolio-lab/models`, `POST /whatif`, `POST/GET /rebalances`, `POST /rebalances/:id/orders` | `admin-82-portfolio-lab.js` |
| DATA_HOOKS | `portfolios`, `institutionalPositions` live bypass | n/a | `tools/hooks/w2.mjs` |

Native `/ops-native` screens remain reference-only. `POST /portfolios` already existed (FR-PORT-011); no backend changes in W2.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-80-portfolios.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-81-ibor.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-82-portfolio-lab.js` (new)
- `portals/admin-web/public/legacy/js/bridge/admin-8*.js` (generated copies)
- `tools/hooks/w2.mjs` (new)
- `portals/admin-web/public/legacy/js/01-inline.js` (hook patch)
- `portals/admin-web/src/legacy/manifest.ts` (bridge list)
- `tests/frontend/legacy/w2-portfolios-ibor.test.ts` (new)
- `docs/DECISION-LOG.md` (D-22..D-24)
- `docs/handoff/HANDOFF-03-W2.md`, `LATEST.md`, `PHASE-LOG.md`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — manifest + w2 hooks applied
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `node -e "…"` static W2 assertions — pass (vitest worker timeout on this host; same as W1)
- `npx vitest run --project admin-web tests/frontend/legacy/w2-portfolios-ibor.test.ts` — worker timeout (not run to completion)
- `npx tsc --noEmit` — pass `portals/admin-web`, `packages/legacy-runtime`; `backend/api` fails on untracked `scripts/offline-*.ts` (not W2)
- `npm run build -w @matanho/admin-web` — pass (2026-10-05)

## 5. Not browser-verified
- [ ] Portfolio KPI numbers vs API when signed in
- [ ] Create portfolio wizard with evidence file upload
- [ ] IBOR refresh job polling toast sequence
- [ ] Reconcile positions maker-checker errors
- [ ] Portfolio-lab what-if KPI strip vs preview payload
- [ ] Promote to orders with stale proposal warning

## 6. Decisions made
- D-22: `POST /portfolios` already implemented — bridge only (logged in DECISION-LOG).
- D-23: Portfolio-lab maps optimiser/save/promote to API via portfolio+model modal; v33 slider UI stays demo until what-if runs.
- D-24: Full JSON envelope via `fetch` for list endpoints that return `kpis`/`total` alongside `data`.

## 7. Problems found, workarounds, traps
- `mx.get` unwrap drops sibling fields (`kpis`, `total`) on `{ data, kpis }` responses — use `getEnvelope()` helper in W2 bridges.
- `const portfolios` / `const institutionalPositions` need DATA_HOOKS prefix (not `mx.replace` alone before first render).
- v34 `create-portfolio` button clone may still exist — W2 intercept uses capture-phase on `[data-action="create-portfolio"]` when live.
- Vitest worker startup times out on this Windows host when running legacy tests; static node check or run test files individually.

## 8. Carry-over / deferred
- Portfolios: per-row YTD return and manager name (API summary has no TWR/manager label on each row); evidence upload on create modal.
- IBOR: ledger column groups do not hide table columns in prototype markup (prefs saved to API only); events/lots tabs not in prototype page.
- Portfolio-lab: model CRUD (create/activate/retire/clone) — prototype v33 construction tabs still demo; native lab models tab not mirrored.
- Portfolio drawer second-layer (`openSecondLayer('portfolio')`) still uses prototype layer for demo when not live.

## 9. Next phase: W3 — orders
**Scope:** page `10`. **Owns:** `admin-90-orders.js`, `tools/hooks/w3.mjs`. **Depends:** W0, W2 (portfolios list for selectors).

First 5 steps:
1. Read `ops-native/orders/page.tsx` and `orders/[id]/page.tsx` for API shapes.
2. Inventory `10-page-orders.html` + prototype JS (`orders`, localStorage drafts, broker modal).
3. Add DATA_HOOKS for `orders` array and disable localStorage order lists when live.
4. Wire blotter, approval queue, new order, submit/approve/reject/route/fills.
5. Add `tests/frontend/legacy/w3-orders.test.ts` and run `legacy-bridge.mjs --check`.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` @ `1ab13f5` (W2 code; parent W1 `d638144`)
- Tests: W0 5/5, W1 2/2, W2 static checks pass; vitest worker timeout on combined/slow runs
- Production (207.180.234.151): untouched
- Dev environment: not deployed
- Untracked files from other workstreams remain (investee-native, company-web native, offline scripts) — not part of W2
