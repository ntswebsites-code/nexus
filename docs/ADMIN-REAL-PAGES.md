# Admin real pages (Orders, Risk and the portfolio foundation)

Branch `feat/admin-orders-risk`. This file is the shared hand-off between the engineers building the staff-side
modules. Add your own section ("Orders", "Risk") below the foundation; do not edit the Foundation section except to
correct it.

## Foundation

Portfolio reference data, securities, prices and positions. Migration `20261002100000_portfolio_foundation`
(additive, one folder). Code: `backend/api/src/modules/portfolio/`.

### Tables

| Table | Prisma model | Key columns |
|---|---|---|
| `portfolios` | `Portfolio` | `ref` (`PF-1001`, via `nextRef(tx, 'portfolio')`), name, type, `base_currency`, `client_id?`, `manager_user_id?` (logical refs, no FK), benchmark, status (`Setup/Active/Suspended/Closed`), `mandate_json`, `version` |
| `securities` | `Security` | `ticker` (unique, e.g. `DLTA.ZW`, `ZIM.VX`), `isin?`, name, `market` (`ZSE/VFEX/OTC`), `asset_class`, `currency`, `board_lot`, `sector`, status |
| `security_prices` | `SecurityPrice` | `security_id`, `price_date`, `price` (Decimal 20,6), `source`; unique (security, date, source) |
| `positions` | `PortfolioPosition` | `portfolio_id`, `security_id`, `quantity` (24,6), `avg_cost` (20,6), `as_of`; unique (portfolio, security, as_of) |
| `portfolio_cash` | `PortfolioCash` | `portfolio_id`, `currency`, `available` (20,4), `as_of`; unique (portfolio, currency, as_of) |
| `brokers` | `Broker` | `name` (unique), `email`, status (`Active/Inactive`) |
| `fx_rates` | `FxRate` | `from_currency`, `to_currency`, `rate_date`, `rate` (20,10); unique (from, to, date). Needed because ZSE names are priced in ZWG and portfolios report in USD or ZWG |

The Prisma model for `positions` is `PortfolioPosition` (the name `Position` is avoided on purpose).
Positions and cash are append-by-date: the latest row at or before the valuation date is current, and a latest row
with quantity 0 closes the position. Orders/fills should write a new `as_of` row, never edit history.

`mandate_json` limits (all optional, percentages are plain numbers, 10 = 10%): `maxSingleNamePct`, `maxSectorPct`,
`cashFloorPct`, `maxCashPct`, `maxPositions`, `restrictedTickers[]`, `notes`.

### Endpoints (`/api/v1`, admin portal staff only)

| Method and path | Permission | Notes |
|---|---|---|
| `GET /portfolios?q=&type=&currency=&status=&clientId=&managerId=&mine=1&asOf=` | `portfolio.view` | Summary rows: market value (base), cash %, position count, largest position |
| `GET /portfolios/:idOrRef?asOf=` | `portfolio.view` | Full `PortfolioSnapshot` (see service) |
| `POST /portfolios` | `portfolio.manage` | `Idempotency-Key` required, audit `portfolio.created`, 201 with snapshot |
| `PATCH /portfolios/:idOrRef` | `portfolio.manage` | `version` in body or `If-Match`; mandate is merged (`null` removes a limit); audit `portfolio.updated` / `portfolio.mandate_updated` |
| `GET /securities?q=&market=&assetClass=&status=&limit=&offset=&asOf=` | `portfolio.view` or `research.view` or `orders.view` | Each row has `latestPrice`, `previousPrice`, `change`, `changePct` |
| `GET /securities/:idOrTicker` | same | Plus the last 30 prices as `history` |
| `GET /securities/:idOrTicker/prices?from=&to=&limit=` | same | |
| `POST /securities/:idOrTicker/prices` | `portfolio.manage` | Upsert on (security, date, source); same value is a no-op (200, `changed:false`); audit `security_price.created/updated`; no future dates; `Idempotency-Key` optional |
| `GET /ibor/positions?portfolioId=&q=&assetClass=&asOf=&limit=&offset=` | `portfolio.view` | Flat valued lines across portfolios or for one |
| `GET /brokers?status=all` | `portfolio.view` or `research.view` or `orders.view` | Active only; `status=all` honoured only with `portfolio.manage` |

Auth is applied per route (`requireAuth` + `requirePortalAccess('admin')`), the router is mounted at the root of `/api/v1`.
Investor, custodian and investee sessions get 403 everywhere here.

### Service helpers (`modules/portfolio/portfolio.service.ts`)

Import these from Orders and Risk instead of re-querying. Money and weights are decimal strings (money 2 dp,
price 6 dp, weight 4 dp percent), dates `YYYY-MM-DD`.

```ts
getPortfolioSnapshot(portfolioIdOrRef: string, opts?: { asOf?: Date }): Promise<PortfolioSnapshot>
getPortfolioSummaries(filters?: PortfolioFilters, opts?: { asOf?: Date }): Promise<PortfolioSummary[]>
getSecurityWithPrice(securityIdOrTicker: string, opts?: { asOf?: Date }): Promise<SecurityWithPrice>
getBrokerList(opts?: { activeOnly?: boolean }): Promise<BrokerView[]>   // active only by default
getMandate(p: { mandateJson }): PortfolioMandate
resolveFxRate(from: string, to: string, asOf: Date): Promise<Prisma.Decimal | null>
latestPrices(securityIds: string[], asOf: Date): Promise<Map<id, { latest, previous, latestDec }>>
loadPortfolio(idOrRef: string): Promise<Portfolio row>                   // 404 HttpError when unknown
```

`PortfolioSnapshot`: `portfolio` (header incl. `mandate`, `version`), `asOf`, `baseCurrency`, `lines[]`
(ticker, quantity, price, `marketValue` local, `marketValueBase`, `weightPct`, `unrealisedPnlBase`, ...), `cash[]`
(currency, available, `availableBase`), `totals` (`securitiesValueBase`, `cashBase`, `totalValueBase`, `cashPct`,
`positionCount`), `concentration` (`largestPositionTicker/Pct`, `top5Pct`, `bySector`, `byMarket`, `byAssetClass`),
`warnings[]`.

Rules to keep in mind when building on it:

- Weight is a percent of total value (securities + cash). A line without a price or FX rate has
  `marketValueBase: null`, is left out of the totals and is named in `warnings`. Orders pre-trade checks should treat
  a non-empty `warnings` as "cannot value", not as zero.
- Pre-trade cash check: use `snapshot.cash` (currency `available`) against order notional in the security currency.
  Cash is not reserved by anything yet; reservation is an Orders concern.
- Post-trade limit check: recompute with the proposed quantity and compare to `portfolio.mandate`.
- Use `writeAudit` inside a transaction for any write, `idempotent()` on creates, `nextRef` for refs (`lib/refs.ts`).

### Permission codes

`portfolio.view` (existing, all admin roles), `orders.*`, `risk.*`, `research.view` (existing). **New:** `portfolio.manage`,
granted in `prisma/seed/role-catalog.json` to `investment_director`, `portfolio_manager` and `operations`
(`system_admin` is locked to its bundle and does not get it). Existing databases pick the grant up when
`prisma/seed.ts` runs again.

### Seed data

`prisma/seed-portfolio.ts` (idempotent; also called by `seed-demo.ts` with `SEED_DEMO=1` and by `seed-uat.ts`):

- 6 portfolios from the prototype: Balanced Growth Fund (USD, about US$21.6M, cash 8.5%, DLTA at 12.97% against a
  13% single-name limit), USD Equity Fund, Platinum Preservation Fund, Pension Mandate 04 (ZWG), Liquidity Plus,
  Zimbabwe Opportunities (ZWG). Existing portfolios are matched by name and not reset on re-run.
- 13 securities: ZSE DLTA, CBZ, ECO, INN, FBC, MEIK, SIM, OKZ, NMB (`.ZW`), VFEX ZIM, CMCL, SEED (`.VX`), OTC `T-BILL-91D`.
  Prices for 2026-08-25 and 2026-08-26 (DLTA 31.94/31.95, ECO 15.41, INN 18.42, ZIM 2.29 are prototype figures; the
  others are illustrative), source `SEED`.
- Positions and cash as of 2026-08-26; FX ZWG to USD at 1/13 (and USD to ZWG at 13) for the same two dates.
- 3 brokers: Imara Edwards Securities, IH Securities, FBC Securities.
- Valuations default to "today"; the seeded prices are older, which is fine because the latest price on or before
  the date is used.

Run standalone: `cd backend/api && npx tsx --env-file-if-exists=../../.env prisma/seed-portfolio.ts`.

### Staff screens (portals/admin-web, `(ops)` console)

`/ops/portfolios` (list with filters, new portfolio for `portfolio.manage`), `/ops/portfolios/[id]` (overview, mandate
limits vs current, positions with cash, edit limits), `/ops/securities` (search, price history, set price). Helper
`v1(path)` in `src/ops/api.ts` for endpoints mounted at the root of `/api/v1`; types in `src/ops/types.ts`; nav in
`src/ops/Shell.tsx` (section "Portfolio").

### Running the test

```
# disposable DB only; run migrate deploy + prisma/seed.ts first, then start the API against the same DATABASE_URL
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4160 npx tsx --env-file-if-exists=../../.env src/server.ts      # in another terminal
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4160 npx tsx --env-file-if-exists=../../.env scripts/test-portfolio.ts
```

Covers: seed idempotency, 401/403 per portal and permission, create with `Idempotency-Key` (replay, reuse, missing),
audit events, mandate validation and merge, version conflict, computed values (market value, FX conversion, cash,
weights summing to 100%, as-of valuation, unpriced and no-FX lines), filters, IBOR positions, price upsert and
validation, brokers. Verified locally: 80 checks, all passing, on a disposable MySQL 8.4 schema.

Note: the local private MySQL from `HANDOVER-STATUS.md` section 5 (127.0.0.1:43306) must be running; start it with
your own credentials. Never point the test at a database that holds real data.

## Orders

Order management (SRD 6.6 FR-OMS-001..012, 7.2, 11.3; BR-001, BR-003, BR-017). Migration
`20261002110000_orders` (additive). Code: `backend/api/src/modules/orders/` (`orders.routes.ts`, `orders.service.ts`,
`orders.checks.ts`, `index.ts`), screens under `portals/admin-web/src/app/(ops)/ops/orders/**`, shared UI in
`src/ops/orders.tsx`.

### Tables

| Table | Prisma model | Key columns |
|---|---|---|
| `orders` | `Order` | `ref` (`ORD-001001`, `seqRef(tx,'order','ORD-',6,1001)`), `portfolio_id`, `security_id`, `broker_id?` (logical refs, no FK), `side` BUY/SELL, `quantity`, `order_type` MARKET/LIMIT, `limit_price?`, `tif` DAY/GTC/IOC, `urgency`, `rationale`, `currency` (security currency), `decision_price`, `status`, `precheck_result` JSON + `precheck_at`, `maker_id`, `approver_id`+`approved_at`, `router_id`+`routed_at`, `filled_qty`, `avg_price`, `reserve_unit` + `reserved_amount` (buys), `estimated_fee`, `cancel_reason`, `reject_reason`, `submitted_at`, `version` |
| `order_fills` | `OrderFill` | `order_id`, `quantity`, `price`, `fees`, `executed_at`, `source` MANUAL/FIX/CONTRACT_NOTE, `source_ref`, `recorded_by` |
| `broker_instructions` | `BrokerInstruction` | `order_id`, `broker_id`, `channel` (EMAIL), `payload` JSON (to, subject, text, fields), `sent_at`, `delivery_status` QUEUED/SENT/FAILED, `created_by` |
| `securities.average_daily_volume` | (column added to `Security`) | nullable; used by the liquidity check |

Models sit between `// ---- Orders ----` and `// ---- end Orders ----` at the end of `schema.prisma`; the only edit
outside the block is the `average_daily_volume` field on `Security`. Mandate JSON gained two optional keys,
`allowedMarkets[]` and `allowedAssetClasses[]` (interface and zod schema in the portfolio module).

### State machine (SRD 7.2)

```
Draft -> Validated -> AwaitingApproval -> Approved -> Routing -> PartiallyFilled -> Filled (-> Settled, reserved)
            |  ^            |  \-> Rejected
            v  |            \-> Cancelled (from any open state: Draft, Validated, AwaitingApproval, Approved, Routing, PartiallyFilled)
          Draft (check Blocked, or a material edit)
```

Any other move is `409 invalid_transition`. Every transition is a state- and version-guarded `UPDATE ... WHERE status=? AND
version=?` plus an audit event in the same transaction; `If-Match` (or `version` in the body) is compared first and a
mismatch is `409 version_conflict`. Drafts and Validated orders belong to their maker: other users get 404.

### Endpoints (`/api/v1/orders`, admin portal staff only)

| Method and path | Permission | Notes |
|---|---|---|
| `GET /orders?status=&portfolioId=&securityId=&side=&q=&from=&to=&mine=1&limit=&offset=` | `orders.view` | `status` takes a comma list and the group `Working` (Approved, Routing, PartiallyFilled); `portfolioId`/`securityId` accept id, ref or ticker. Returns `data`, `total`, and `summary` (`working`, `awaitingApproval`, `filled`, fill-weighted `slippageBp`, `byStatus`) for the same filter |
| `POST /orders/precheck` | `orders.create` | What-if check for a ticket; writes nothing |
| `POST /orders` | `orders.create` | Creates a Draft. `Idempotency-Key` required. Security may be an id or ticker; a Suspended/Delisted security is `409 security_not_tradable`; decision price = latest price |
| `GET /orders/:idOrRef` | `orders.view` | Order, fills, stored instruction, audit timeline, and `allowed` (actions this user may attempt) |
| `PATCH /orders/:id` | `orders.create`, maker only | Draft or Validated; a material edit (portfolio, security, side, qty, type, limit, tif) returns a Validated order to Draft and clears the check |
| `POST /orders/:id/validate` | `orders.create`, maker only | Runs the checks. Blocked -> stays/returns to Draft; Within/Review -> Validated |
| `POST /orders/:id/submit` | `orders.create`, maker only | `rationale` required (10+ chars when a check is on Review). `Idempotency-Key` required. From Draft: `409 precheck_required`. Re-checks under a portfolio row lock; now Blocked -> back to Draft and `409 precheck_blocked`. Buys reserve notional + estimated fee |
| `POST /orders/:id/approve` | `orders.approve`, step-up | Approver must not be the maker (`403 segregation_of_duties`). `Idempotency-Key` required |
| `POST /orders/:id/reject` | `orders.approve`, step-up | `reason` required; approver != maker; releases the reservation; notifies the maker |
| `GET /orders/:id/broker-instruction/preview?brokerId=&note=` | `orders.route` | The exact instruction that would be sent |
| `POST /orders/:id/route` | `orders.route`, step-up | Approved only; router must not be the approver (BR-003); broker must be Active with an email (`409 broker_unavailable`); writes `broker_instructions` (EMAIL, QUEUED) and queues `email.send`. `Idempotency-Key` required |
| `POST /orders/:id/fills` | `orders.route` | Routing or PartiallyFilled. `Idempotency-Key` required. Fill > remaining is `409 overfill`; a fill outside a limit is `409 limit_breach`; a sell above the holding is `409 insufficient_position` |
| `POST /orders/:id/cancel` | creator or `orders.approve` | `reason` required; releases the reservation; partial fills stay |

Notifications (outbox): submitted -> everyone with `orders.approve`; approved -> everyone with `orders.route`;
rejected/cancelled by someone else -> the maker. Audit actions: `order.created`, `.updated`, `.validated`,
`.precheck_failed`, `.submitted`, `.approved`, `.rejected`, `.routed`, `.fill_recorded`, `.cancelled`
(object type `order`).

### Pre-trade checks (`runPreTradeChecks`)

`import { runPreTradeChecks } from '../orders'` (also exports `reservedCash`, `committedShares`, `estimateFee`,
`FEE_ESTIMATE_PCT`, types). Signature:
`runPreTradeChecks(portfolioIdOrRef, { securityId, side, quantity, price, excludeOrderId? }, { asOf? })`. Read-only, so
Risk can run what-if trades. Returns `overall` (`Within | Review | Blocked`), `checks[]` (`key`, `label`, `result`
`Pass | Review | Fail`, `detail`, `metrics`), `notional`, `estimatedFee` (0.75% of notional, a constant), `currency`.
Any Fail is Blocked, otherwise any Review is Review.

| Check | Fail | Review |
|---|---|---|
| mandate | portfolio not Active, security not Active, restricted ticker, market or asset class outside `allowedMarkets` / `allowedAssetClasses`, buy takes the name above `maxSingleNamePct`, new position beyond `maxPositions` | within 5% of `maxSingleNamePct`, post-trade cash under `cashFloorPct` (buys) or over `maxCashPct` (sells), limits that cannot be tested |
| cash (buys) | notional + fee > cash available in the security currency minus cash reserved by other open buys | n/a |
| position (sells) | quantity > held minus shares committed to other open sells | n/a |
| concentration | buy takes the sector above `maxSectorPct` | within 5% of the sector limit, no name limit and weight above 25%, or the book cannot be fully valued (missing price / FX) |
| liquidity | quantity not a multiple of the board lot, or above 25% of `average_daily_volume` | above 10% of ADV (no ADV on file: board lot only) |
| price | no price on file | reference price more than 10% from the latest price |

Weights use the portfolio snapshot (percent of securities + cash, base currency); cash is checked in the security
currency only (no cross-currency funding). The order's own reservation is excluded when it is re-checked.

### Reservation, fills and the books

- Submit reserves `quantity x reference price x (1 + 0.75%)` for buys (`reserved_amount`, reference = limit price, else
  decision price); sells reserve nothing in cash but their remaining quantity counts against the holding.
  Reservations are released on cancel, reject and when the order is Filled, and shrink with each fill.
- A fill runs in one transaction under a lock on the portfolio row: it upserts today's `positions` row (weighted
  average cost on buys, cost kept on sells) and today's `portfolio_cash` row (buy: minus notional and fees; sell: plus
  notional minus fees), inserts `order_fills`, updates `filled_qty`, weighted `avg_price`, status and reservation, and
  writes the audit event with the position and cash after. History rows are never edited.
- Slippage (BR-017) = (average fill - decision price) / decision price x 10,000, sign flipped for sells, so positive is
  always worse than the decision price. The decision price is re-taken from the latest price at validate and submit.

### Permission and step-up matrix

| Action | Permission | Also required | Step-up | Idempotency-Key |
|---|---|---|---|---|
| View blotter / order | `orders.view` | Drafts only for their maker | no | n/a |
| Create, edit, validate, submit | `orders.create` | maker only (edit, validate, submit) | no | create and submit: required |
| Approve | `orders.approve` | approver != maker | yes | required |
| Reject | `orders.approve` | approver != maker, reason | yes | optional |
| Broker preview | `orders.route` | | no | n/a |
| Route | `orders.route` | status Approved, router != approver (BR-003), broker with email | yes | required |
| Record fill | `orders.route` | status Routing / PartiallyFilled | no | required |
| Cancel | creator, or `orders.approve` | reason | no | optional |

Seeded roles: `portfolio_manager` creates; `investment_director` creates and approves; `dealer` creates and routes;
compliance, auditor, fund accountant, operations and system admin only view. The `order_approval` policy flag is not
read yet (approval is always required).

### Screens

`/ops/orders` (blotter: status / portfolio / security / date filters, tiles for working, awaiting approval, filled and
slippage), `/ops/orders/new` (ticket with security search and price, **Run pre-trade check**, Save as draft, Submit for
approval), `/ops/orders/[id]` (details, checks, fills, instruction, timeline, and the actions in `allowed`). Nav section
"Trading". Approve, reject and route use the shared step-up prompt (`StepUpHost`).

### Demo seed

`prisma/seed-orders.ts` (called from `seed-demo.ts` and `seed-uat.ts`, also standalone): sets average daily volumes on
the demo securities and adds four orders on Zimbabwe Opportunities (awaiting approval, approved, filled, rejected).
Inserted directly, so positions and cash are not changed by the seeded fills. Idempotent; skipped when no
`portfolio_manager` / `investment_director` user exists.

### Running the test

```
# disposable DB only, e.g. a schema named nexus_orders_test on the local private MySQL
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4191 npx tsx --env-file-if-exists=../../.env src/server.ts       # another terminal; avoid 4190 (blocked by fetch)
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4191 npx tsx --env-file-if-exists=../../.env scripts/test-orders.ts
```

Covers: portal and permission refusals, create with `Idempotency-Key` (replay, reuse, missing), validation, draft
visibility, version conflict, every pre-trade outcome (mandate fail/review, restricted, market, cash, position,
liquidity lot and ADV, price), Blocked cannot be submitted, reservation reducing free cash and released on cancel,
re-check under lock at submit, share commitment on sells, the full lifecycle, SoD (maker cannot approve or reject,
approver cannot route), step-up on approve / reject / route, fills (partial, over-fill, limit breach, average price,
position and cash, snapshot), slippage, cancel rules, blotter filters and KPIs, audit events and timeline, outbox
notifications and the instruction email. Verified locally: 153 checks, all passing, on a throwaway MySQL 8.4 instance.
Needs `FILE_ENCRYPTION_KEY` (64 hex chars) in the API environment for the TOTP enrolment.

### Not done

CSV export and CSV/JSON import (FR-OMS-010, 012 export), FIX feed, post-trade allocation and contract-note matching
(FR-OMS-011), Settled transition, stop-limit orders, and a worker update of `broker_instructions.delivery_status`
(stays `QUEUED`; the email itself goes through the outbox).

## Risk

Risk & Compliance (SRD 5.A.7, 6.8 FR-RSK-001..005, BR-001, BR-014). Branch `feat/risk-compliance`, migration
`20261002120000_risk` (additive, one folder; models between `// ---- Risk ----` and `// ---- end Risk ----` at the end
of `schema.prisma`). Code: `backend/api/src/modules/risk/` (`risk.engine.ts` pure maths, `risk.service.ts` DB logic and
the exports for Orders, `risk.routes.ts`), UI in `portals/admin-web/src/ops/risk/` and `/ops/risk`. Also touched:
`lib/refs.ts` (kinds `riskLimit` = `LIM-1001`, `riskCase` = `RC-1001`), `routes/v1.ts` (mount `/risk`), `ops/Shell.tsx`
(nav "Risk & compliance"), `prisma/seed-risk.ts` (called by `seed-uat.ts` and `seed-demo.ts`).

### Tables

| Table | Model | Notes |
|---|---|---|
| `risk_limits` | `RiskLimit` | `ref` LIM-####, `metric`, `scope_type` PORTFOLIO/FIRM, `scope_id` (portfolio id, null for FIRM), `threshold` (percent, 0-100), `unit` PCT, `breach_action` ALERT/ESCALATE/BLOCK, `owner_user_id`, `status` DRAFT/PENDING_APPROVAL/ACTIVE/RETIRED, `maker_id`, `checker_id`, `approved_at`, `retired_at`, `version` |
| `risk_breaches` | `RiskBreach` | `limit_id` (FK), `portfolio_id`, `detected_on` (date), `value`, `threshold`, `detail` JSON, `status` OPEN/ACKNOWLEDGED/RESOLVED, `case_id`, ack fields. Unique (`limit_id`, `portfolio_id`, `detected_on`) |
| `risk_scenarios` | `RiskScenario` | unique `name`, `shocks` JSON, `preset` (`liquidity`/`equity`/`fx` for the built-ins) |
| `risk_scenario_runs` | `RiskScenarioRun` | `scenario_id` (FK), `portfolio_id`, `as_of`, `results` JSON (the full result, see below), `run_by` |
| `risk_cases` | `RiskCase` | `ref` RC-####, `type`, `description` (required), `severity` LOW..CRITICAL, `status` OPEN/INVESTIGATING/RESOLVED/CLOSED, `owner_user_id`, `source_breach_id`, `portfolio_id`, `resolution_note`, `resolved_at`, `version` |

Portfolio, user and scope ids are logical references (no FK), like the foundation. The Portfolio model is untouched.

### Endpoints (`/api/v1/risk`, admin portal staff only)

`risk.view` reads, `risk.manage` writes (compliance officers hold both; analysts, PMs and directors hold `risk.view`).
Creates need `Idempotency-Key` (limits, scenarios, cases); monitor and scenario run accept it optionally. Every write
audits inside its transaction.

| Method and path | Permission | Notes |
|---|---|---|
| `GET /limits?status=&metric=&portfolioId=&q=` | view | rows carry owner, maker, checker and scope names |
| `GET /limits/:idOrRef` | view | |
| `POST /limits` | manage | 201 DRAFT; owner defaults to the creator; `risk.limit_created` |
| `PATCH /limits/:id` | manage | DRAFT only (409 `limit_not_editable`), `version` optimistic; `risk.limit_updated` |
| `DELETE /limits/:id` | manage | DRAFT only; `risk.limit_deleted` |
| `POST /limits/:id/submit` | manage | DRAFT to PENDING_APPROVAL; `risk.limit_submitted` |
| `POST /limits/:id/approve` | manage + **step-up MFA** | PENDING_APPROVAL to ACTIVE; approver must not be the maker (403 `sod_violation`); 409 `limit_exists` if another ACTIVE limit has the same metric and scope; `risk.limit_approved` |
| `POST /limits/:id/reject` | manage | `{reason}`, back to DRAFT; `risk.limit_rejected` |
| `POST /limits/:id/retire` | manage | `{reason}`, ACTIVE to RETIRED; `risk.limit_retired` |
| `POST /monitor` | manage | optional `{portfolioId}`; see Monitoring; `risk.monitor_run` |
| `POST /check` | view | `{portfolioId, hypothetical?}`; read only, same function Orders imports |
| `GET /breaches?status=&limitId=&portfolioId=&from=&to=` | view | |
| `POST /breaches/:id/acknowledge` | manage | OPEN to ACKNOWLEDGED, optional `note`; `risk.breach_acknowledged` |
| `GET /scenarios` | view | `{data, presets}` |
| `POST /scenarios`, `PATCH`, `DELETE /scenarios/:id` | manage | presets are locked (`preset_locked`); a scenario with runs cannot be deleted |
| `POST /scenarios/preview` | view | `{portfolioId, shocks, asOf?}`, runs the maths and stores nothing |
| `POST /scenarios/:id/run` | manage | `{portfolioId, asOf?}`, stores a run (201); `risk.scenario_run` |
| `GET /runs?scenarioId=&portfolioId=`, `GET /runs/:id` | view | |
| `GET /cases?status=&severity=&ownerId=&mine=1&open=1&q=` | view | |
| `POST /cases` | manage | `description` required; optional `sourceBreachId` links the breach; `risk.case_created` |
| `PATCH /cases/:id` | manage | type, description, severity (`version`); not once CLOSED |
| `POST /cases/:id/assign` | manage | `{ownerUserId}`; `risk.case_assigned` |
| `POST /cases/:id/transition` | manage | `{status, note?}`; OPEN to INVESTIGATING, INVESTIGATING to RESOLVED or CLOSED, RESOLVED to CLOSED; a resolution note is required for RESOLVED (and for CLOSED if none yet); RESOLVED/CLOSED also resolves the source breach; `risk.case_transitioned` |
| `DELETE /cases/:id` | manage | only an OPEN, manually created case; `risk.case_deleted` |
| `GET /users` | view | active staff `{id, name, email}` for owner pickers |

Permission and step-up matrix: read endpoints need `risk.view`; all writes need `risk.manage`; only `approve` also
runs `requireStepUp` (a code verified within 5 minutes; 401 `step_up_required`, the console's step-up modal handles it
and retries with the same idempotency key). Retire needs a reason but no step-up, no second person (decision for the
owner: a retire loosens a control, so consider adding step-up). Investor, custodian and investee sessions get 403.

### Metrics

All weights are percent of the book's total value (securities + cash) in the portfolio base currency, 4 dp, from
`getPortfolioSnapshot` (lines that cannot be priced are left out and listed in `valuationWarnings`).

| Metric | Value measured | Breach when | Warning when |
|---|---|---|---|
| `SINGLE_NAME_PCT` | weight of the largest security | value > threshold | value >= 90% of threshold |
| `SECTOR_PCT` | weight of the largest sector (unclassified securities form one sector; cash excluded) | value > threshold | value >= 90% of threshold |
| `TOP5_PCT` | combined weight of the five largest securities | value > threshold | value >= 90% of threshold |
| `CASH_FLOOR_PCT` | cash weight | value < threshold | value <= 110% of threshold |

Equal to the limit is not a breach. FIRM-scope limits apply to every Active portfolio; PORTFOLIO-scope to one.

### Monitoring and the Orders hook

`POST /monitor` evaluates every ACTIVE limit for every Active portfolio (or one). A breach is recorded once per limit,
portfolio and calendar day (unique key; re-runs and concurrent runs record nothing twice), opens a `LIMIT_BREACH` case
owned by the limit owner and queues a `notify.users` outbox event to the owner (link `/ops/risk`). Case severity from
how far past the limit: excess = |value - threshold| / threshold; under 5% LOW, under 15% MEDIUM, under 30% HIGH,
otherwise CRITICAL. Warnings are counted in the response but not recorded.

For Orders (do not edit the risk module, import it):

```ts
import { checkLimitsForPortfolio } from '../risk/risk.service';
checkLimitsForPortfolio(portfolioIdOrRef: string,
  hypothetical?: { ticker: string; side: 'BUY' | 'SELL'; quantity: number | string; price?: number | string } | null,
  opts?: { asOf?: Date }): Promise<LimitCheckResult>
```

Pure read (records nothing). With a hypothetical, the book is recomputed as if the trade had settled: BUY adds the
trade value (quantity x price, default the latest price, converted to base) to the holding and takes it out of the cash
of the security currency, SELL does the reverse (capped at the holding). Result: `evaluations[]` (limit ref, metric,
threshold, value, `state` BREACH/WARNING/OK, plus `valueBefore`, `stateBefore`, `worsened` when a trade is applied),
`breaches[]`, `warnings[]`, `blocked` (a limit with breach action BLOCK is newly breached or made worse),
`hypothetical` (the applied trade), `cashBase`, `valuationWarnings`. Only ACTIVE limits count; the mandate limits in
`portfolios.mandate_json` are separate and still the Orders engineer's to check.

### Scenario lab (BR-014)

Shocks (all optional, defaults 0, duration 1): `equityPct` (-100..100), `fxPct` (-50..99, ZWG depreciation against USD),
`ratePctPoints` (-20..50), `durationYears` (0..30), `redemptionPct` (0..100). Per holding:
`post = value x local x fx`, where `local` = `1 + equityPct/100` for Equity, Fund and Private; `max(0, 1 - duration x
ratePctPoints/100)` for Fixed income; 1 otherwise. `fx`: a ZWG depreciation of x% means one ZWG buys x% less USD, so
ZWG holdings in a USD book are multiplied by `(1 - x)`, USD holdings in a ZWG book by `1/(1 - x)`, everything else by 1; cash is
hit by FX only.

Results (`results` JSON): `nav`, `postShockValue`, `loss` and `lossPct` (negative = gain), `impacts` {equity, rate, fx}
(signed, sum to minus the loss), `liquidity` {`liquidAssets` = post-shock cash + post-shock fixed income,
`redemptionAmount` = `redemptionPct` x post-shock NAV, `coverage` = liquid / redemption (null with no redemption)},
`limitChecks` (the ACTIVE limits that apply, re-measured on the post-shock book), `notes` (for example "no fixed-income
securities, so the interest-rate shock has no effect (0)"), `reasons`, `status`.

Status: `Escalate` when a limit is breached after the shock or coverage is below 1.0x; `Review` when a limit is within
10% of its threshold or coverage is below 1.1x; otherwise `Within`. The worst of the two wins. Presets: liquidity
(15% redemptions), equity (-20%), fx (ZWG -25%). Hand-computed examples are in `scripts/test-risk.ts`.

### Console

`/ops/risk` (nav "Risk & compliance", visible with `risk.view` or `risk.manage`). Tabs: **Limits** (filter, add or edit
a draft, submit, delete draft, approve, return to draft, retire; the Approve button is disabled for the maker and the
server refuses it anyway; step-up is handled by the console's TOTP modal), **Breaches** (acknowledge, open a case,
jump to the linked case), **Scenarios** (shock inputs, presets, run without saving, save, save and run, saved list,
recent runs, result card with status), **Cases** (filters, create, assign, start investigation, resolve, close).
Header action "Run monitor". Read-only users see the same tabs without action buttons. Typecheck only; no browser
verification was done for this screen.

### Seed

`prisma/seed-risk.ts` (idempotent, run by `seed-uat.ts` and `seed-demo.ts`): the three preset scenarios; and, when two
staff users exist, one ACTIVE firm-wide single-name limit at 15% (ESCALATE), one DRAFT top-5 limit for Balanced Growth
Fund and one OPEN manual case (descriptions start with `[seed]`). Standalone: `npx tsx --env-file-if-exists=../../.env prisma/seed-risk.ts`.

### Running the test

```
# disposable DB only (for example schema nexus_risk_test); same steps as the foundation test
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4170 npx tsx --env-file-if-exists=../../.env src/server.ts      # in another terminal
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4170 npx tsx --env-file-if-exists=../../.env scripts/test-risk.ts
```

Covers (168 checks, all passing on a disposable MySQL 8.4 schema): seed idempotency; 401/403 per portal and
permission; limit lifecycle with draft-only edits, optimistic version, maker cannot approve (`sod_violation`), stale
MFA gives `step_up_required`, a different user with step-up approves, duplicate ACTIVE guard, reject, retire, audit
actors; each metric against known book values (40 / 50 / 80 / 15) and the warning band; hypothetical BUY, SELL and
unheld security with `worsened` and `blocked`; monitor creates exactly one breach and one case per day and is
idempotent (new key, no key, same key replay), FIRM scope across portfolios, severity, outbox notification;
breach acknowledge; scenario maths for rate, equity, FX in both base currencies, liquidity coverage thresholds
(Within/Review/Escalate), limit-driven Review and Escalate, presets, stored runs; cases (validation, filters, assign,
every allowed and refused transition, resolution note, breach resolution); audit events.

## NAV

NAV & Valuation (SRD 5.A.18, 6.11 FR-VAL-001..005, 7.8; BR-001, BR-012, BR-013). Branch `feat/nav-valuation`, migration
`20261003110000_nav` (additive, one folder; models between `// ---- NAV ----` and `// ---- end NAV ----` at the end of
`schema.prisma`). Code: `backend/api/src/modules/nav/` (`nav.engine.ts` pure maths, `nav.service.ts` valuation and
persistence, `nav.routes.ts`), screens `/ops/nav` and `/ops/nav/[id]` with `src/ops/nav.tsx`, nav section "Valuation".

Changes outside the NAV block: `funds.portfolio_id` (nullable `CHAR(36)`, logical link to `portfolios.id`, no FK; one
field added to the `Fund` model), `lib/refs.ts` (kind `navRun` = `NAV-00001`), `routes/v1.ts` (mount `/nav`),
`ops/Shell.tsx`, `prisma/seed/role-catalog.json` (new permission `valuation.release`), `prisma/seed-nav.ts` (called by
`seed-uat.ts` and `seed-demo.ts`; links `FND-AEOF` Matanho Equity Opportunities Fund to the "USD Equity Fund" portfolio,
`FND-AGFI` is private capital and stays unlinked).

### Tables

| Table | Model | Notes |
|---|---|---|
| `nav_runs` | `NavRun` | `ref` `NAV-#####`, `portfolio_id`, `fund_id?`, `nav_date`, `version` (unique with portfolio + date), `stage`, `base_currency`, `market_value`, `cash`, `accruals`, `fees`, `liabilities`, `fee_rate_pct?`, `nav`, `units?`, `nav_per_unit?` (4 dp), `price_coverage` (percent, 4 dp), `position_count`, `status`, `maker_id` (preparer), `reviewer_id` + `reviewed_at` (maker review), `checker_id` + `released_at` (release), `notes`, `detail` JSON (cash by currency, settings applied) |
| `nav_run_lines` | `NavRunLine` | `run_id`, `security_id`, ticker, name, currency, `quantity`, `price`, `price_source`, `price_date`, `fx_rate`, `value_local`, `value_base`, `flags` JSON |
| `nav_exceptions` | `NavException` | `run_id`, `type`, `security_id?`, `detail`, `current_value`, `reference_value`, `difference`, `material`, `status` OPEN/RESOLVED, `resolution`, `evidence_ref`, `resolved_by`, `resolved_at` |

### Calculation (deterministic, from `getPortfolioSnapshot` at the NAV date)

- Market value = sum of base-currency values of positions that have a price and an FX rate. Cash = snapshot cash in base.
- **NAV = market value + cash + accruals - fees - liabilities** (BR-012), 2 dp. **NAV per unit = NAV / units**, 4 dp half-up,
  null with no units. Fees are a manual amount, or when `feeRatePct` is set `fees = rate / 100 x (market value + cash +
  accruals) / 365` (one day of accrual); setting a manual `fees` clears the rate.
- **Price coverage** (BR-013) = valued / (valued + reference of unvalued) x 100, 4 dp. A position is valued when it has a
  price and an FX rate (a stale price still counts as valued). Reference of an unvalued position = cost (quantity x average
  cost x FX), else local value. 100 when there is nothing to value.
- Exceptions:

| Type | Raised when | Material |
|---|---|---|
| `MISSING_PRICE` | no price on or before the NAV date | always |
| `MISSING_FX` | priced position or cash balance with no FX rate to base | always |
| `NEGATIVE_CASH` | a cash balance below zero | always |
| `TOLERANCE` | price moved more than `nav_price_move_pct` against the previous run's price (latest earlier RELEASED run, else the latest earlier non-superseded run, else the security's previous market price) | difference (current value minus value at the previous price) above `nav_tolerance_pct` of the position or above `nav_tolerance_abs` (BR-013) |
| `STALE_PRICE` | price date more than `nav_stale_days` before the NAV date | never |

Tolerances are read from the `policies` table (numeric values) and default to `nav_stale_days` 3, `nav_price_move_pct` 10,
`nav_tolerance_pct` 1, `nav_tolerance_abs` 50000; the values used are stored in `nav_runs.detail.settings`.

Versions: creating or recalculating for a portfolio and date inserts the next `version` (under a lock on the portfolio row)
and marks every unreleased earlier version (DRAFT, EXCEPTIONS_OPEN, MAKER_REVIEWED) SUPERSEDED. Inputs not supplied
(accruals, fees or fee rate, liabilities, units, notes) carry over from the latest unreleased version, else the latest one
for that date; units default to the previous run's units, else fund total NAV / NAV per unit. Resolved exceptions carry over
when type, security and current value are unchanged.

### State machine (SRD 7.8)

```
DRAFT <-> EXCEPTIONS_OPEN   (open exception present / all resolved)
DRAFT | EXCEPTIONS_OPEN --maker review (no material exception open; units set for a fund NAV)--> MAKER_REVIEWED
MAKER_REVIEWED --release (different user, valuation.release, step-up)--> RELEASED
any unreleased --recalculate / new run for the same date--> SUPERSEDED     RELEASED --a later version is released--> SUPERSEDED
```

`RELEASED` and `SUPERSEDED` are immutable: edits, resolutions, recalculation and review return `409 run_immutable`
(create a new run for the date instead). Inputs and exception resolution are only allowed in DRAFT / EXCEPTIONS_OPEN
(`409 run_not_editable` once MAKER_REVIEWED). Stage bar (derived, stored in `stage`): Positions, Cash, Prices & FX, Fees,
Units, Maker review, Release.

### Endpoints (`/api/v1/nav`, admin portal staff only)

| Method and path | Permission | Notes |
|---|---|---|
| `GET /runs?portfolioId=&fundId=&status=&from=&to=&q=&limit=&offset=` | `valuation.view` | `portfolioId`/`fundId` take id or ref, `status` a comma list; returns `data`, `total`, `summary` |
| `POST /runs` | `valuation.view` | `{portfolioId, navDate, accruals?, fees?, feeRatePct?, liabilities?, units?, notes?}`; `Idempotency-Key` required; 201 with detail; no future dates; `409 currency_mismatch` when the linked fund and portfolio currencies differ |
| `GET /runs/:idOrRef` | `valuation.view` | run, `stageBar`, `bridge`, `lines`, `exceptions`, `versions`, `timeline`, `allowed` (what this user may do and why not) |
| `POST /runs/:id/recalculate` | `valuation.view` | new version, 201; `Idempotency-Key` optional |
| `PATCH /runs/:id/inputs` | `valuation.view` | accruals, fees, feeRatePct, liabilities, units, notes; recomputes NAV and NAV per unit; fees and a rate together is 400 |
| `PATCH /runs/:id/exceptions/:exId` | `valuation.view` | `{resolution (5+ chars), evidenceRef?}`; resolved twice is `409 already_resolved` |
| `POST /runs/:id/maker-review` | `valuation.view` | `409 material_exceptions_open`, `409 units_required` (fund NAV); reviewer recorded; notifies holders of `valuation.release` |
| `POST /runs/:id/release` | `valuation.release` + **step-up** | status MAKER_REVIEWED; releaser must not be the maker reviewer (`403 segregation_of_duties`); supersedes the previous RELEASED version for the portfolio and date; updates the fund |
| `GET /runs/:id/pack` | `valuation.view` | JSON summary for a preview (KPIs, bridge, top positions, exceptions, approvals, fund impact), `draft` until released |

Every write audits inside its transaction (`nav.run_created`, `.run_recalculated`, `.run_superseded`, `.inputs_updated`,
`.exception_resolved`, `.maker_reviewed`, `.released`; object type `nav_run`). Release audits the fund before and after.
## Reconciliation

Reconciliations (SRD 5.A.17, 6.10 FR-OPS-002..005, 7.7 break lifecycle, 5.E.4 custodian hand-off; BR-001, BR-065, BR-067).
Branch `feat/reconciliation`, migration `20261003100000_reconciliation` (additive, one folder; models between
`// ---- Reconciliation ----` and `// ---- end Reconciliation ----` at the end of `schema.prisma`). Code:
`backend/api/src/modules/recon/` (`recon.engine.ts` pure matching rules and severity, `recon.service.ts` detection,
persistence and sign-off readiness, `recon.routes.ts`), UI in `portals/admin-web/src/ops/recon/` and `/ops/reconciliation`.
Also touched outside the block: `routes/v1.ts` (mount `/recon`), `ops/Shell.tsx` (nav section "Operations"),
`prisma/seed/role-catalog.json` (new permissions), `prisma/seed-uat.ts` (calls `seed-recon.ts`). No Prisma model outside
the block was edited and no ref kind was added to `lib/refs.ts` (refs use `seqRef`).

### What is reconciled

The external side is what the custodian portal already stores (`counterparty_executions`, `counterparty_day_end_packages`,
latest non-Superseded row). The internal side is the Orders module (`orders`, `order_fills`) and the portfolio foundation
(`getPortfolioSnapshot`, `portfolio_cash`). `counterparties.accounts` is only a list of account strings and nothing linked
an account to a portfolio, so this migration adds **`recon_account_map`** (counterparty, account, portfolio; unique per
counterparty + account). Only mapped accounts are reconciled; unmapped ones are listed on the run (`summary.unmappedAccounts`)
and in `/sources`. Manage the mapping with `PUT /recon/account-map` (UI: Run matching tab, "Account mapping"). One portfolio
may have several accounts; if a portfolio is held at several counterparties and a run is limited to one of them, the
internal side still contains the other counterparties' fills (there is no fill-to-counterparty link), so run such
portfolios with the counterparty left blank.

### Tables

| Table | Model | Key columns |
|---|---|---|
| `recon_account_map` | `ReconAccountMap` | `counterparty_id`, `account_ref`, `portfolio_id` (logical refs); unique (counterparty, account) |
| `recon_runs` | `ReconRun` | `ref` `RUN-00001`, `scope_key` (unique: family, date, counterparty or `*`, portfolio or `*`), `family`, `as_of_date`, `counterparty_id?`, `portfolio_id?`, `status` CLEAN / BREAKS / SOURCE_MISSING, `matched_count`, `break_count`, `params` (tolerances), `summary` (missing sources, unmapped accounts), `run_count`, `run_by` |
| `recon_breaks` | `ReconBreak` | `ref` `REC-00001`, `run_id` (FK), `family`, `item_key` (unique per run), `kind`, `label`, `internal_value` / `external_value` JSON, `difference`, `difference_pct`, `currency`, `cause` (maker's), `severity`, `status`, `owner_user_id`, `counterparty_id`, `portfolio_id`, `resolution_note`, `evidence_ref`, `maker_id`, `checker_id`, `resolved_at`, `closed_at`, `last_seen_at`, `version`; age is `created_at` |
| `recon_break_events` | `ReconBreakEvent` | `break_id`, `action`, `from_status`, `to_status`, `actor_id`, `note`, `detail`, `created_at` (the break timeline) |
| `recon_signoffs` | `ReconSignoff` | `scope_key` (unique: family, date, counterparty or `*`), `family`, `as_of_date`, `counterparty_id?`, `signed_by`, `signed_at`, `note`, `summary` |

Families are stored as `TRADES`, `CASH`, `HOLDINGS`, `DAYEND_COUNT` (the API also accepts `DAYEND-COUNT`).

### Matching rules

- **TRADES**, per portfolio: external = the date's custodian executions (UTC day, Superseded excluded) of its mapped accounts;
  internal = `order_fills` of the portfolio's orders executed that day. Pass 1, exact reference: custodian `trade_ref` equals
  the fill's `source_ref` (contract-note reference) or the order ref, case-insensitive. Pass 2: ticker + side + **exact**
  quantity, taking the closest price. A paired trade must have the same ticker, side and currency (else `ATTRIBUTE_DIFF`),
  the same quantity (else `QUANTITY_DIFF`) and a price within **+/- 0.01** (else `PRICE_OUT_OF_TOLERANCE`; exactly 0.01 passes).
  A custodian trade with no internal fill is `MISSING_INTERNAL`; an internal fill with no custodian trade is `MISSING_EXTERNAL`.
  Partial fills are not aggregated. The custodian execution's status becomes `Matched` or `Exception` (Queried and
  Superseded are never touched).
- **CASH**, per mapped account with a day-end package: package `closing_cash` against the latest `portfolio_cash` row at or
  before the date in the statement currency (no row counts as 0). Tolerance: absolute **0.01** (inclusive).
- **HOLDINGS**: package `holdings_mv` (a control total) against the portfolio's securities market value at the latest
  prices (`getPortfolioSnapshot` lines, other currencies converted by `resolveFxRate`). Tolerance: **0.5% of the custodian
  value** (inclusive). A position that cannot be valued (no price or no FX rate) is named in the break and raises it to at
  least HIGH.
- **DAYEND_COUNT**: package `trade_count` against the number of executions received for that account and date.
- Tolerances are run parameters (`tolerances: { price, cash, holdingsPct }` in `POST /runs`, stored in `params`), with the
  defaults above. SRD BR-067 wants them effective-dated configuration per family; that is not built.
- **A missing source is not a break** (BR-065). A mapped account with no day-end package for CASH, HOLDINGS or DAYEND_COUNT
  is listed in `summary.missingSources`, the run status is `SOURCE_MISSING`, and sign-off is blocked (`source_missing`).

### Severity thresholds

Difference as a percent of the larger of the two amounts: **>= 20% CRITICAL, > 5% HIGH, > 1% MEDIUM, otherwise LOW**
(1.00% exactly is LOW). Used for price, cash, holdings and count. Fixed rules on top:

| Break | Severity |
|---|---|
| Custodian trade not in the internal book (`MISSING_INTERNAL`) | CRITICAL |
| Internal fill not confirmed by the custodian (`MISSING_EXTERNAL`) | HIGH |
| Quantity differs on a reference match | at least HIGH (CRITICAL from 20%) |
| Ticker, side or currency differs on a match | HIGH |
| Day-end count differs from executions received (a trade is missing or extra) | at least HIGH (CRITICAL from 20%) |
| Holdings with an unvalued position | at least HIGH |

HIGH and CRITICAL are "material": they block sign-off while open. A break is **overdue** when open and CRITICAL, or older
than 3 days (`SLA_DAYS` in `recon.engine.ts`).

### Run semantics (idempotent)

One run row per scope key, so `POST /runs` for the same family, date, counterparty and portfolio is a **re-run of the same
run** (200, `rerun: true`, `run_count` + 1), never a second set of breaks. On a re-run: a known item keeps its workflow
state and ref (values and severity are refreshed, timeline entry `updated`); an item that no longer differs and is
NEW/ASSIGNED/INVESTIGATING becomes MATCHED (`auto_cleared`); a MATCHED item that differs again is reopened to NEW; a
CLOSED item (accepted by a checker) is reopened only if the difference changed; PENDING_CHECKER is left alone. Overlapping
scopes (for example all counterparties and one counterparty on the same date) do not duplicate items: the first run to
find an item owns it (`sharedWithOtherRuns` in the audit event). `Idempotency-Key` is required and replays the stored
response; two simultaneous runs serialise on the run row.

### Endpoints (`/api/v1/recon`, admin portal staff only)

| Method and path | Permission | Notes |
|---|---|---|
| `GET /overview?asOf=` | `operations.view` | Per-family matched / breaks / match rate / open / signed-off for the date (default: latest run date), open breaks by severity, overdue |
| `GET /sources?asOf=` | view | Per counterparty: accounts with mapping, day-end received, executions for the date, `lastDayEnd`, `missingSource`, unmapped accounts |
| `GET /counterparties`, `GET /users` | view | Pickers |
| `GET /account-map`, `PUT /account-map`, `DELETE /account-map/:id` | view / `recon.manage` | PUT `{counterpartyId, accountRef, portfolioId}` (account must be one the counterparty lists); audited |
| `POST /runs` | `recon.manage` | `{family, asOfDate, counterpartyId?, portfolioId?, tolerances?}` (ids or refs). `Idempotency-Key` required. 201 new / 200 re-run; returns `data` (run), `breaks`, `rerun`. 409 `no_account_mapping`; no future dates |
| `GET /runs?family=&asOf=&counterpartyId=&portfolioId=&status=`, `GET /runs/:idOrRef` | view | Detail includes the run's breaks |
| `GET /breaks?family=&status=&severity=&ownerId=&mine=1&counterpartyId=&portfolioId=&runId=&asOf=&ageDays=&overdue=1&q=` | view | Lists accept commas; `status=open` (four open states) and `resolved` (MATCHED + CLOSED); oldest first; `summary` has open, overdue, byStatus, openBySeverity, openByFamily |
| `GET /breaks/:idOrRef` | view | Break, `events` (timeline) and `allowed` (assign, investigate, resolve, approve, reject, `approveBlockedReason`) for the caller |
| `POST /breaks/:id/assign` | `recon.manage` | `{ownerUserId, note?}`; NEW to ASSIGNED, owner can change while open; notifies the new owner |
| `POST /breaks/:id/investigate` | `recon.manage` | `{note}`; NEW/ASSIGNED to INVESTIGATING (a further note while investigating); owner defaults to the caller |
| `POST /breaks/:id/resolve` | `recon.manage` | `{cause, rationale (10+ chars), evidenceRef}`; to PENDING_CHECKER, caller becomes the maker; notifies `recon.signoff` holders |
| `POST /breaks/:id/approve` | `recon.signoff` + **step-up MFA** | PENDING_CHECKER to CLOSED; caller must not be the maker (403 `segregation_of_duties`) |
| `POST /breaks/:id/reject` | `recon.signoff` | `{reason}`; back to INVESTIGATING, maker notified; not the maker |
| `GET /signoffs/readiness?family=&asOf=&counterpartyId=` | view | Open material breaks, missing sources, runs, `canSign`, `independent` |
| `POST /signoffs` | `recon.signoff` + **step-up MFA** | `{family, asOfDate, counterpartyId?, note?}`; see below |
| `GET /signoffs?family=&from=&to=&counterpartyId=` | view | History |

Transitions are `UPDATE ... WHERE status=? AND version=?`; `If-Match` or `version` in the body is compared first
(`409 version_conflict`); any other move is `409 invalid_transition`. MATCHED (auto-cleared by a run) and CLOSED (approved)
are the two terminal states; there is no reopen endpoint (a later run reopens, see above).

### Sign-off rules

`POST /signoffs` is refused with: `409 no_run` (no run for the family and date), `409 open_material_breaks` (details list
the breaks), `409 source_missing` (families other than TRADES: a mapped account in scope has no day-end package),
`403 segregation_of_duties` (the caller ran any covering run or made a resolution on any of its breaks), `409
already_signed_off` (unique per family, date and counterparty or all). LOW and MEDIUM breaks do not block and are
carried forward (`summary.openOther`). A sign-off without a counterparty covers every mapped counterparty.

### Permission and step-up matrix

| Action | Permission | Also required | Step-up |
|---|---|---|---|
| View, pack | `valuation.view` | | no |
| Create, recalculate, edit inputs, resolve exceptions, maker review | `valuation.view` | | no |
| Release | `valuation.release` | status MAKER_REVIEWED, releaser != maker reviewer | yes |

`valuation.view` was already in the catalogue (investment director, portfolio manager, compliance, operations, fund
accountant, auditor, system admin). **New `valuation.release`** is granted to `fund_accountant`, `investment_director` and
`compliance`, not `system_admin`. Existing databases pick the grant up when `prisma/seed.ts` runs again. Note for the owner:
as specified, preparing and reviewing need only `valuation.view`, so auditors and system admins can prepare runs; consider a
separate manage right.

### Link to the LP portal

`funds.portfolio_id` links a fund to its portfolio. A run for a portfolio that backs a fund records the fund (`fund_id`),
and **release** updates in one transaction: `funds.nav_per_unit`, `total_nav` (the NAV), `as_of_date` (the NAV date),
`valuation_status` = `FINAL`, `dealing_rules_json.navHistory` (the LP NAV chart reads it, last 24 points), and every active
`lp_holdings` row of the fund (`nav_per_unit`, `account_value` = units x NAV per unit, `as_of_date`, status FINAL). The LP
session (`as_of_date`, `valuation_status`), dashboard (`openEndedSummary`) and dealing NAV read these. If the NAV date is older
than the fund's current as-of date only the NAV history is updated. Drafts, exceptions and maker review change nothing on
the fund. A portfolio with no linked fund can be valued on its own, with units entered by hand.

### Console

`/ops/nav`: filters (portfolio, status, NAV date range), tiles (awaiting release, exceptions open, released), table, and
**New NAV run** (portfolio, date, optional inputs). `/ops/nav/[id]`: stage bar, KPIs (NAV, NAV per unit, units, coverage,
exceptions), NAV bridge, exceptions with a resolve form (rationale, evidence ref), positions with price source and date,
inputs and controls, versions and history, pack preview, and the actions Recalculate, Edit inputs, Maker review and
Release NAV, enabled from the server's `allowed` flags (the release button is disabled for the maker reviewer and for users
without `valuation.release`; the TOTP step-up modal appears on release). Typecheck only; no browser verification was done.
| View everything | `operations.view` | | no |
| Map accounts, run matching, assign, investigate, resolve | `operations.view` + `recon.manage` | | no (run needs `Idempotency-Key`) |
| Approve a resolution | `operations.view` + `recon.signoff` | checker != maker | yes |
| Return a resolution to the maker | `operations.view` + `recon.signoff` | checker != maker, reason | no |
| Daily sign-off | `operations.view` + `recon.signoff` | independent of the runner and the makers | yes |

**New permission codes** `recon.manage` and `recon.signoff` (none existed), granted in `role-catalog.json` to `operations`,
`compliance` and `fund_accountant`; `system_admin` is locked to its bundle and gets neither. Existing databases pick the
grants up when `prisma/seed.ts` runs again. Because the same three roles hold both codes, the maker/checker split is
enforced per user (different people), not per role.

Notifications (outbox): a new, reopened or newly-escalated CRITICAL break and every resolution go to `recon.signoff`
holders (`notify.permission`, link `/ops/reconciliation?break=<id>`); an assignment goes to the owner, a return or
closure to the maker (`notify.users`). Audit actions: `recon.run_executed` (counts: matched, breaks, created, reopened,
cleared, updated), `recon.break_assigned`, `.break_investigating`, `.break_resolved`, `.break_approved`, `.break_rejected`,
`recon.signoff_recorded`, `recon.account_mapped`, `recon.account_unmapped`. Break creation by a run is audited once on
the run, and per break in the timeline.

### Screens

`/ops/reconciliation` (nav "Operations", visible with `operations.view`). Tabs: **Overview** (match-rate tile per family,
open breaks by severity and overdue, source health table; tiles jump to the filtered queue), **Breaks** (filters for
family, severity, status, counterparty, minimum age, mine, search; oldest first), **Run matching** (family, date,
counterparty, portfolio, optional tolerance, result with the breaks, recent runs, account mapping), **Daily sign-off**
(readiness with blocking breaks and missing sources, sign-off with step-up, history). A break opens in a dialog with
internal vs external, difference, timeline and only the actions `allowed` for the user (the approve button is disabled for
the maker with the reason; the TOTP prompt is the console's shared step-up). `?break=<id>` deep-links a break. Typecheck
only; no browser verification was done for these screens.

### Demo seed

`prisma/seed-recon.ts` (called by `seed-uat.ts`, also standalone, idempotent via `DEMO-` trade refs, skipped with a message
when the custodian, portfolio, `OKZ.ZW` or a staff user is missing): maps the first custodian account to Zimbabwe
Opportunities and, for yesterday, adds a filled internal SELL order (contract-note ref `DEMO-CN-001`), the matching custodian
execution, a second custodian execution `DEMO-CN-002` that is not in the book (CRITICAL break) and a day-end package whose
cash is 250.00 above the book. It runs no matching: press Run matching for Trades and Cash.

### Running the test

```
# disposable DB only (for example schema nexus_nav_test on a private MySQL); same steps as the other modules
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4181 npx tsx --env-file-if-exists=../../.env src/server.ts      # in another terminal; FILE_ENCRYPTION_KEY must be set
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-nav.ts
```

Covers (134 checks, all passing on a disposable MySQL 8.4 schema): formulas (NAV, NAV per unit rounding, coverage, fee
accrual, materiality); 401/403 per portal and permission; create with `Idempotency-Key` (replay, reuse, missing) and
validation; hand-computed NAV 25,025.00, NAV per unit 10.0100 and coverage 100%; inputs and fee rate; `units_required`;
recalculation versioning and supersede; each exception type with its values (coverage 90.2778%); maker review blocked by a
material exception; resolution validation and carry-over; release refused for no permission, system admin, the maker
reviewer (even with step-up) and a stale MFA; release by a different user; immutability of released and superseded runs; a
later release superseding the previous one; fund row, NAV history, LP holding, and the LP session and dashboard read as the
LP persona before and after release; an older NAV date not rolling the fund back; list filters, pack, audit events and the
outbox notification.

### Not done

Scheduled or automatic daily runs, NAV approval limits per amount, bulk release, PDF/CSV export of the pack (the pack is a
JSON summary), per-share-class NAV, and accrual or fee schedules beyond the single management-fee rate.
# disposable DB only (schema nexus_recon_test on a throwaway MySQL); same steps as the other modules
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4251 npx tsx --env-file-if-exists=../../.env src/server.ts      # another terminal; needs FILE_ENCRYPTION_KEY
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4251 npx tsx --env-file-if-exists=../../.env scripts/test-recon.ts
```

Covers (168 checks, all passing, repeatable on the same schema): the pure engine (severity bands, tolerance edges, matching
passes); 401 / portal / permission refusals (investor, analyst, portfolio manager and system admin cannot write); mapping
and run validation; TRADES against a hand-computed book (2 matched, 4 breaks: price +0.02, quantity 11 vs 10, custodian-only,
internal-only; +0.01 passes; ignored superseded, other-date executions and out-of-date fills; custodian status updates);
idempotent re-runs (key replay, key reuse, new key, concurrent runs, no duplicate breaks, stable refs); auto-clear, reopen
of a cleared break, a CLOSED break staying closed unless the difference changes; the full lifecycle (assign, investigate,
validation errors, resolve, maker cannot approve or return, stale MFA gives `step_up_required`, return to maker,
approve by a different user, timeline, version conflict, invalid transitions); queue filters and KPIs; CASH (equal, +0.01,
+0.02, configurable tolerance, severity at 1%, 4%, 15%, 20%); HOLDINGS (12,500 exact, 0.4975% inside, 0.557% LOW, MEDIUM,
HIGH, configurable tolerance); DAYEND_COUNT (match, 6 vs 5 HIGH, 7 vs 5 CRITICAL, clear); sources (received, missing,
unmapped, default today); `SOURCE_MISSING` is not a break; sign-off blocked by open Critical/High, by a missing source and
by no run, refused for the runner, stale MFA, allowed for an independent checker after resolution, duplicate refused,
counterparty-scoped sign-off; overview; audit events with actors and the audit chain; outbox notifications. The test uses a
date nine days back so UAT demo records never mix in. Run it on a schema without other unmapped custodian fixtures: a
mapped account left over from other data would join the all-counterparty runs.

### Not done

Effective-dated tolerance configuration per family (BR-067) and Q-13 per-family price tolerance admin, manual source
upload with hash and the scheduled-source registry (a "missing source" is derived from mapped accounts and day-end
packages only), query-source and escalate break actions, an explicit reopen endpoint, attaching evidence files (a reference
string is stored), aggregating partial fills, FX-aware trade price comparison across currencies, the NAV-close and
Operations-runbook gating, and CSV export of breaks. The prototype's other reconciliation families (positions vs custody
quantities, settlement fails, corporate actions) are not implemented.

## Accounting & Close

Page 21 `accounting` (SRD 5.A, permission `valuation.view`) and its `accounting-close` second layer, backed by the ABOR books: chart of accounts, double-entry journals, trial balance, ledger, and a month-end close. Module `backend/api/src/modules/accounting` (`accounting.engine.ts` pure rules, `accounting.service.ts` balances and checklist, `accounting.routes.ts`), mounted at `/api/v1/accounting`, admin portal staff only.

### Tables (migration `20261004100000_accounting`, additive)

`acc_accounts` (per entity = portfolio; unique code; type ASSET, LIABILITY, EQUITY, INCOME or EXPENSE), `acc_journals` (ref `JNL-00001`, entry date, status, totals, maker, poster, reversal links), `acc_journal_lines` (debit or credit, DECIMAL(20,4)), `acc_periods` (calendar month per entity; OPEN, CLOSING, CLOSED; close snapshot, reopen reason). The entity is the portfolio (a fund-backing portfolio stands for the fund); there is no foreign key to `portfolios`, like the NAV tables.

### Rules

- Journal states: DRAFT, PENDING_APPROVAL, POSTED, REVERSED, DISCARDED. A journal needs at least two lines, each exactly one positive side, debits equal to credits (Decimal maths), accounts active and belonging to the entity. Checked on create, edit, submit and post.
- Maker-checker: the creator edits and submits; **a different user with `accounting.post` posts, with step-up MFA** (same as NAV release). The creator cannot post (403 `segregation_of_duties`). A poster can return a pending journal with a reason. Drafts and pending journals can be discarded; nothing is deleted.
- Posted journals are immutable (409 `journal_immutable` on edit or discard). **Reverse** (`accounting.post` + step-up + reason) posts a new journal with debits and credits swapped, links both ways, and marks the original REVERSED. A reversal cannot itself be reversed.
- Trial balance and ledger count POSTED and REVERSED journals (the reversal offsets the original). Balances are shown on the natural side per type.
- Periods: open a month, optionally **start close** (CLOSING, posting still allowed), then **close**. Close refuses with 409 `close_blocked` and `error.details.blockers` listing every blocker: unposted journals dated in the period, open reconciliation breaks for the entity (status not MATCHED or CLOSED, run as-of date on or before period end), no RELEASED NAV run for the period-end date, trial balance not in balance. Closing needs `accounting.close` + step-up and stores the checklist and totals. A CLOSED period refuses creating, editing, posting and reversing into it (409 `period_closed`). **Reopen** needs `accounting.reopen` + step-up + a reason (5+ characters), refused while a later period is closed.
- Mutations that create records take `Idempotency-Key`; actions accept it. Audit actions: `accounting.account_created`, `.account_updated`, `.journal_created`, `.journal_updated`, `.journal_submitted`, `.journal_returned`, `.journal_discarded`, `.journal_posted`, `.journal_reversed`, `.period_opened`, `.period_closing_started`, `.period_closed`, `.period_reopened`. Submit notifies `accounting.post` holders; close and reopen notify `accounting.close` holders.

### Endpoints (`/api/v1/accounting`)

| Endpoint | Permission |
|---|---|
| `GET /accounts`, `/journals`, `/journals/:id`, `/trial-balance?portfolioId&asOf`, `/ledger?accountId&from&to`, `/periods`, `/periods/:id` | `valuation.view` |
| `POST /journals`, `PATCH /journals/:id`, `POST /journals/:id/submit`, `/discard`, `POST /periods`, `/periods/:id/start-close` | `valuation.view` (edit, submit and discard: creator only) |
| `POST /accounts`, `/accounts/default-chart`, `PATCH /accounts/:id` | `accounting.post` |
| `POST /journals/:id/post`, `/reverse` | `accounting.post` + step-up (post: not the creator) |
| `POST /journals/:id/return` | `accounting.post` (not the creator) |
| `POST /periods/:id/close` | `accounting.close` + step-up |
| `POST /periods/:id/reopen` | `accounting.reopen` + step-up + reason |

**New permission codes** `accounting.post`, `accounting.close`, `accounting.reopen`, added to `role-catalog.json`: `fund_accountant` gets post and close; `investment_director` gets all three; the Auditor stays read-only through `valuation.view`. Existing databases pick the grants up when `prisma/seed.ts` runs again.

### Console

`/ops/accounting` (nav section "Accounting", `valuation.view`): entity selector and tabs Journals (filters, New journal with a balanced line grid), Trial balance (as-of date, balanced flag), Account ledger (opening, running and closing balance), Periods and close, Chart of accounts (standard chart, new account, edit). `/ops/accounting/journals/[id]`: lines, control, history, and Submit, Post, Return, Discard, Reverse enabled from the server `allowed` flags. `/ops/accounting/periods/[id]`: the close checklist with each blocker, Start close, Close period, Reopen. `?journal=` and `?period=` deep-link from notifications. Typecheck only; no browser verification was done.

### Demo seed

`prisma/seed-accounting.ts` (called by `seed-uat.ts` and `seed-demo.ts`, also standalone, idempotent): adds the standard chart to each fund-backing portfolio and opens the previous and current month. It posts nothing.

### Running the test

```
# disposable DB only; same steps as the other modules
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4181 npx tsx --env-file-if-exists=../../.env src/server.ts      # another terminal; FILE_ENCRYPTION_KEY must be set
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-accounting.ts
```

The script (`scripts/test-accounting.ts`) covers the engine rules, permissions, chart of accounts, validation, lifecycle, maker-checker and step-up, immutability, reversal, trial balance and ledger numbers, the 3-blocker close refusal, locking, reopen and audit. It was typechecked but **not run** (no local database was started).

### Not done

- No automatic journals from NAV, fees, trades or cash (all entries are manual); no multi-currency or FX revaluation; no journal attachments.
- Close does not cover unreconciled non-entity breaks (those with no portfolio) or per-fund tax and audit steps.
- Chart editing needs `accounting.post`; there is no separate chart-admin right.

## Corporate Actions

Page 19 `corporate-actions` (SRD 5.A, permission `operations.view`). Module `backend/api/src/modules/corporate-actions` (`ca.engine.ts` pure entitlement maths, `ca.service.ts` entitlements, processing and views, `ca.routes.ts`), mounted at `/api/v1/corporate-actions`, admin portal staff only.

### Tables (migration `20261005100000_corporate_actions`, additive)

`corp_action_events` (ref `CA-00001`, security, type, status, ex/record/pay dates, election deadline, rate, ratio new:old, withholding %, merger acquirer, default option, maker, confirmer, processor, cancel reason, processing summary) and `corp_action_entitlements` (one per portfolio and event: record-date quantity, option and election, gross, tax, net cash, shares delta, merger target shares, PENDING/APPLIED/SKIPPED). The security and portfolio links are logical (no foreign key), like NAV; entitlements cascade with the event.

### Rules

- Types: CASH_DIVIDEND, STOCK_SPLIT, BONUS_ISSUE, SCRIP_DIVIDEND (election CASH or SCRIP, default CASH), RIGHTS_ISSUE (TAKE_UP or LAPSE, default LAPSE), MERGER (acquirer security, ratio, optional cash per share). Dates must satisfy ex-date <= record date <= pay date; elective types need an election deadline on or before the pay date.
- Status: ANNOUNCED -> CONFIRMED -> PROCESSED, or CANCELLED (reason, any time before processed). Only ANNOUNCED can be edited (editing clears the entitlements).
- Entitlements: from each portfolio's latest position row on or before the record date (Closed portfolios and zero holdings skipped), Decimal maths, cash rounded half-up to 4 dp, shares rounded **down** to whole shares (fractions are reported, no cash in lieu). Calculation needs the record date to have passed; recalculating keeps valid elections.
- Elections: `PUT /events/:id/elections`, allowed until the end of the deadline day; the portfolio's entitlement is re-priced for the option. Holders who do not elect get the default option when processed.
- **Processing** (`corporate_actions.process` + step-up MFA; the processor must differ from the creator, 403 `segregation_of_duties`; needs calculated entitlements) applies every entitlement in one transaction through the same append-by-date rows Orders writes: `positions` (quantity and average cost: splits and bonus keep total cost, scrip and rights add their cost, a merger closes the holding and opens the acquirer at the carried cost) and `portfolio_cash` (net dividend, rights cost, merger cash, in the event currency). Effect date is the ex-date for splits and bonus issues, else the pay date, never earlier than today (history is not rewritten). If a portfolio sold since the record date the share change is limited to what it holds (flagged on the entitlement).
- Mutations that create records take `Idempotency-Key`; actions accept it; every state change is guarded by a state-checked update (409 `version_conflict` if it moved). Audit actions: `corp_action.created`, `.updated`, `.confirmed`, `.entitlements_calculated`, `.election_recorded`, `.processed`, `.cancelled`. Confirm notifies `corporate_actions.process` holders.

### Endpoints (`/api/v1/corporate-actions`)

| Endpoint | Permission |
|---|---|
| `GET /events` (filters security, type, status, from/to ex-date, q), `/events/:id`, `/upcoming?days` | `operations.view` |
| `POST /events`, `PATCH /events/:id`, `POST /events/:id/confirm`, `/entitlements/calculate`, `/cancel`, `PUT /events/:id/elections` | `operations.view` |
| `POST /events/:id/process` | `corporate_actions.process` + step-up (not the creator) |

**New permission** `corporate_actions.process` in `role-catalog.json` for Operations, Fund Accountant and Investment Director; Dealer and Auditor keep `operations.view` only (Auditor read-only). Existing databases pick it up when `prisma/seed.ts` runs again.

### Console

`/ops/corporate-actions` (nav section "Operations"): tiles, an Upcoming list (next 90 days) and an All events list with filters, and New corporate action (fields change with the type). `/ops/corporate-actions/[id]`: terms, entitlements per portfolio with Record election, history, and Edit, Confirm, Calculate, Process, Cancel enabled from the server `allowed` flags. Typecheck only; no browser verification was done.

### Demo seed

`prisma/seed-corporate-actions.ts` (called by `seed-uat.ts` and `seed-demo.ts`, also standalone, idempotent): a DLTA.ZW cash dividend, a SIM.ZW scrip dividend (confirmed, with election) and a CMCL.VX 2-for-1 split, dated relative to the seed day. Nothing is processed.
## Cash & Ledgers

Page 16 `cash` (SRD 5.A.15, permission `cash.view`; FR-CASH-001..008 and the related FR-CASH-009..019 where noted): a double-entry cash sub-ledger per portfolio with derived balances, maker-checker journals, reservations, expected movements, statement imports and a cash period close. Module `backend/api/src/modules/cash` (`cash.engine.ts` pure rules and statement parsing, `cash.service.ts` balances and the close pre-check, `cash.routes.ts`), mounted at `/api/v1/cash`, admin portal staff only. It builds on `portfolios`, `orders` (a reservation may reference an order id) and the accounting/reconciliation close pattern; the Phase 1 `cash_accounts` table (client bank accounts) is reused by reference (`cash_ledgers.cash_account_id`) and not duplicated.

### Tables (migration `20261006100000_cash_ledgers`, additive)

`cash_ledgers` (ref `CLG-1001`; per portfolio and currency; kind BANK, CONTROL, CLEARING, SUSPENSE or EXPENSE; min buffer, tolerance, status), `cash_journals` (ref `CJ-00001`, purpose, source and evidence refs, status, totals, maker, poster, reversal links, optional reservation and expectation link), `cash_journal_lines` (debit or credit DECIMAL(20,4) against a ledger), `cash_reservations` (ref `RSV-1001`), `cash_expectations` (ref `EXP-1001`), `cash_statement_imports` (ref `IMP-1001`, file hash, opening, closing, variance) with `cash_statement_lines` (fingerprint, match state), `cash_period_closes`. No stored balances.

### Rules

- Balances are derived: posted = sum of debit minus credit on BANK ledger lines of POSTED and REVERSED journals up to the as-of date. `available = max(0, posted - live reservations - minimum buffer)`, label `AVAIL-v1`; withdrawable equals it. Expected movements never change availability; a statement balance is evidence only. `GET /balances/explain` lists the journal lines and reservations behind the figures (they sum to the tile values).
- Journals: DRAFT, PENDING_APPROVAL, POSTED, REVERSED, REJECTED, DISCARDED. At least two lines, one positive side each, debits equal credits, one currency, ledgers active and in the portfolio. The creator edits and submits (`cash.journal.create`); **a different `cash.journal.approve` holder posts, with step-up MFA** (403 `sod_violation` for the maker). Approvers can return or reject (reason required). Posted journals are immutable (409 `journal_immutable`); **reverse** (approve + step-up + reason) posts the exact inverse, links both ways, one reversal per journal. A journal dated on or before a CLOSED cash close returns 409 `period_closed`.
- Posting a journal linked to a reservation consumes it by the cash credited to its ledger; one linked to an expectation sets that expectation POSTED.
- Reservations (`cash.reservation` or `cash.journal.create`): created against a BANK ledger inside a transaction that takes a row lock on the ledger first, so concurrent holds cannot overspend (409 `insufficient_available_cash`). Release never deletes; releasing someone else's hold needs `cash.journal.approve`. Consume (partial or full); expiry date (a lapsed hold stops counting at once, and `POST /reservations/expire-sweep` marks it EXPIRED). Optional `orderId` (checked against orders; one live hold per order). `releaseOrderReservations(tx, orderId, actorId, reason)` is exported for the Orders module.
- Expectations: IN or OUT forecast; EXPECTED, DUE (shown once the date arrives), POSTED, CANCELLED.
- Statement import (`cash.import` stages): CSV (header with date, amount or credit/debit, optional reference and description; quoted fields) or JSON; positive = cash in. It must foot (opening + lines = closing within the ledger tolerance, else 400 `statement_does_not_foot`) and be new (409 `duplicate_file`, `duplicate_statement`, `duplicate_lines`). A different `cash.journal.approve` holder commits it with step-up (403 `sod_violation` for the uploader); commit auto-matches lines one-to-one to posted journals (equal amount, within 3 days). Manual match and write-off (needs a note and a person other than the uploader) are available.
- **Cash period close pre-check** (`cash.close` prepares, closes and reopens; `cash.journal.approve` approves): STATEMENT_COVERAGE (a committed, continuous statement reaching the date for every bank ledger), BALANCE_VARIANCE (statement balance at the date vs ledger, within tolerance), SUSPENSE (suspense ledgers net zero), AGED_ITEMS (unmatched statement lines and expectations older than 5 days), UNPOSTED_JOURNALS, CHECKER_APPROVAL (approved by someone other than the preparer). `GET /period-closes/precheck` is informational; `POST /period-closes/:id/close` (step-up) returns 409 `close_blocked` with `error.details.blockers` and the full checklist. Reopen needs step-up and a reason.
- Mutations that create records take `Idempotency-Key`. Audit actions use the `cash.` prefix (`journal_created`, `journal_posted`, `journal_reversed`, `reservation_created`, `reservation_released`, `import_staged`, `import_committed`, `close_closed`, and so on). Submit, stage, close prepare and approve notify the next role.

### Endpoints (`/api/v1/cash`)

| Endpoint | Permission |
|---|---|
| `GET /ledgers`, `/balances`, `/balances/explain`, `/journals`, `/journals/:id`, `/reservations`, `/expectations`, `/statement-imports`, `/statement-imports/:id`, `/statement-lines`, `/period-closes`, `/period-closes/precheck`, `/period-closes/:id` | `cash.view` |
| `POST /journals`, `PATCH /journals/:id`, `POST /journals/:id/submit`, `/discard`, `POST /expectations`, `/expectations/:id/cancel`, `POST /reservations/:id/consume` | `cash.journal.create` (edit and submit: creator only) |
| `POST /reservations`, `/reservations/:id/release` | `cash.reservation` or `cash.journal.create` |
| `POST /journals/:id/post`, `/reverse` | `cash.journal.approve` + step-up (post: not the creator) |
| `POST /journals/:id/return`, `/reject`, `POST /ledgers`, `/ledgers/default-set`, `PATCH /ledgers/:id`, `POST /reservations/expire-sweep`, `/period-closes/:id/approve`, `/statement-lines/:id/ignore` | `cash.journal.approve` |
| `POST /statement-imports`, `/statement-imports/:id/reject`, `/statement-lines/:id/match` | `cash.import` |
| `POST /statement-imports/:id/commit` | `cash.journal.approve` + step-up (not the uploader) |
| `POST /period-closes`, `/period-closes/:id/close`, `/reopen` | `cash.close` (close and reopen + step-up) |

No new permission codes: `cash.view`, `cash.journal.create`, `cash.journal.approve`, `cash.reservation`, `cash.import` and `cash.close` already exist in `role-catalog.json` (`operations` and `fund_accountant` hold the maker and checker set; `portfolio_manager` and `dealer` hold `cash.reservation`; the Auditor is read-only).

### Console

`/ops/cash` (nav section "Cash", `cash.view`): portfolio filter and tabs Balances (as-of date, Explain, add the standard ledgers), Cash ledger (journals, New controlled journal with a balanced line grid), Reservations (new, consume, release, sweep), Expected cash, Statement imports (file upload, CSV or JSON), Period close (prepare). `/ops/cash/journals/[id]` (submit, approve and post, return, reject, discard, reverse, enabled from the server `allowed` flags), `/ops/cash/imports/[id]` (arithmetic, staged lines, commit, reject, match, write off), `/ops/cash/closes/[id]` (pre-check with every blocker, approve, close, reopen). `?journal=`, `?import=`, `?close=` deep-link from notifications. Typecheck only; no browser verification was done.

### Demo seed

`prisma/seed-cash.ts` (called by `seed-uat.ts` and `seed-demo.ts`, also standalone, idempotent): adds the standard ledger set per portfolio and currency and, for a portfolio with no cash journal and a latest `portfolio_cash` figure, one POSTED opening-balance journal so derived balances start from the existing cash record.

### Running the test

```
# disposable DB only; same steps as the other modules
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4181 npx tsx --env-file-if-exists=../../.env src/server.ts      # another terminal; FILE_ENCRYPTION_KEY must be set
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-corporate-actions.ts
```

The script (`scripts/test-corporate-actions.ts`) covers the engine maths, validation, permissions, the full flow, maker-checker and step-up, effects on positions and cash for each type, elections and deadline, cancel, idempotency and audit. It was typechecked but **not run** (no local database was started).

### Not done

- No cash in lieu of fractional shares, no tax on non-dividend actions, no partial rights take-up or oversubscription, no rights trading or sale.
- Processing books the cash legs as PENDING_APPROVAL journals in Accounting and the cash ledger (`postCorporateActionJournals`, `ca.routes.ts` process handler) as well as updating the portfolio position and cash rows. No automatic corporate-action feed; announcements are entered by hand. Entitlements use the portfolio positions, not LP or client level holdings.
- A processed action cannot be reversed; correct it with a new action or a manual adjustment.
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-cash.ts
```

`scripts/test-cash.ts` covers the engine and parser, permissions, derived balances, journal lifecycle, maker-checker and step-up, reversal, concurrent reservations (one 201, one 409), consume on post, expiry, expectations, statement staging, duplicates, checker commit and auto-match, the multi-blocker 409 close, clearing each blocker, closing, the period lock, reopen, idempotency and audit. It was typechecked but **not run** (no local database was started).

### Not done

- Orders do not yet call the reservation service on submit, cancel or fill (FR-CASH-015); `releaseOrderReservations` is exported for that and the order ticket still reads its own availability.
- Reversing a settlement journal does not restore a consumed reservation; no CAMT.053 parser; no client/mandate context bar; no holds, pending-withdrawal or reusable-proceeds components in availability; no sub-ledger-to-GL tie-out to the accounting module; cash-account lifecycle stays on the Clients page.

## Wiring, Operations Control and Command Centre

Cross-module wiring plus two pages. Migration `20261012100000_wiring` adds `acc_journals.source_ref` (unique) and the `ops_tasks` table. No new permission codes.

### Orders and Cash (FR-CASH-015)

- The ticket's cash check reads the portfolio's active BANK cash ledger (posted balance less buffer and every hold) when one exists in the currency; otherwise it keeps the old portfolio-cash behaviour. The check metrics name the source.
- Submit holds cash on the ledger (`cash.orders.ts`, row-locked; 409 `insufficient_available_cash` rolls the submit back). Approve ensures a single live hold. Cancel and reject release it. Each fill resizes the hold to filled value plus fees plus the unfilled remainder; a complete fill makes it the exact cost.
- `POST /orders/:id/settle` (`orders.route`): Filled to Settled. Creates two PENDING_APPROVAL journals by the system actor, idempotent per order (`ORDER:<ref>:SETTLE`): a cash-ledger journal linked to the hold (posting it consumes the hold) and an accounting journal. Realised gains are not split out.
- Reversing a cash journal that consumed a reservation puts the consumed amount back on hold (`cash.reservation_restored` audit).

### Automatic journals

The system actor (`lib/system.ts`, shown as "System") is the maker, so a human with the posting permission must still post. Each journal is unique per source ref (accounting by unique index, cash by lookup) and a closed period is skipped, never written to.

- NAV release: fee and accrual journal `NAV:<ref>` (Dr 5000 / Cr 2000, Dr 1200 / Cr 4100). A superseded run's pending journal is discarded; if already posted, only the difference is booked. A closed period raises a runbook task.
- Corporate action processing: per portfolio `CA:<ref>:<portfolioId>` accounting journal (dividend: net cash, withholding 5300, income 4000) and cash-ledger journal (bank against clearing), plus a runbook task and a notification to `operations.view`. Missing chart accounts (including 5300) are added to the portfolio chart.
- Risk breaches already notify the limit owner and open a case; the runbook generator adds a task while any breach is open.

### Operations Control (`/ops/operations`, `operations.view`)

`GET /api/v1/operations/status` aggregates recon breaks, cash close pre-check blockers (previous month end, first 25 active portfolios), NAV runs, accounting periods and pending journals, corporate actions due, unsettled orders and database health into six KPIs and four dependency tiles with readiness percentages. Runbook tasks are persisted (`ops_tasks`): `GET /tasks?filter=all|due|blocked|scheduled|done&format=csv`, `POST /tasks` (Idempotency-Key), `PATCH /tasks/:id`, `POST /tasks/:id/start|complete|block|reopen|cancel`, `POST /tasks/generate`. A task with an unfinished dependency shows BLOCKED and cannot complete. Generated tasks are unique per source and per day and are closed by the system when their condition clears. Every change is audited.

### Command Centre (`/ops/command`, `dashboard.view`)

`GET /api/v1/dashboard/today`: AUM by currency, orders working, open breaks, approval queue (only queues the caller can act on), bank cash after holds, NAV status, risk breaches, runbook tasks due. Sections the caller lacks permission for are null.

### Demo seed and test

`prisma/seed-wiring.ts` (called by `seed-uat.ts` and `seed-demo.ts`, idempotent) generates today's runbook and adds two manual tasks, one dependent on the other. Run `scripts/test-wiring.ts` the same way as the other module tests (disposable DB, running API).

### Not done

- Buy settlement books at the filled cost; sells do not compute realised gain. Settlement is a manual step (no custodian settlement feed).
- The hold is kept through fills until the settlement journal posts, so "consume on fill" is deliberately "consume on settlement posting": consuming earlier would free cash that has not left the ledger.
- Operations: no calendar, no workload or cash-deadline charts, no per-task comments, no CSV button in the UI (the endpoint exists). Cash readiness uses the previous month end for the first 25 portfolios.
- Command Centre has the KPI and queue panels only; performance chart, allocation and scenario panels are not built.
## IBOR & Positions and Performance & Attribution

SRD 5.A.14 (`ibor`, `portfolio.view`) and 5.A.8 (`performance`, `reports.view`), BR-030, FR-PERF-001..003. Migration `20261007100000_ibor_performance`; modules `backend/api/src/modules/ibor` and `.../performance`; Prisma block `// ---- IborPerformance ----`.

### What is real

- **IBOR book.** Positions, prices, FX, orders, fills, cash and reconciliations stay in their modules; IBOR reads them (`getPortfolioSnapshot`) and adds `ibor_lots` (tax lots, FIFO), `ibor_events` (sequenced lineage, refs `IBE-000001`) and `ibor_snapshots` (refresh runs, `IBR-1001`). A **refresh** books each unprocessed order fill (idempotent on the fill id) into lots, consumes lots first in first out on sells, opens an OPENING lot from the position record where none exists, and books any remaining difference between lots and the position record as an ADJUSTMENT event (corporate actions, manual corrections).
- **Unsettled activity and available-to-trade.** Fills on orders not yet Settled are unsettled; settlement date is trade date + 3 business days (`SETTLEMENT_DAYS` in `ibor.engine.ts`). Settled = held - unsettled buys + unsettled sells; available = settled - unsettled sells - remaining open sell orders; private assets are Restricted. The **ladder** buckets unsettled fills Overdue / Today / T+1 / T+2 / T+3 / Later with net cash per currency. Available cash is the portfolio cash record less live cash reservations.
- **Book health.** Lots agree with positions, all fills ingested, positions priced, and holdings reconciled. The reconciliation **hook** runs the Reconciliations module's HOLDINGS family for the portfolio (`executeRun`) and records a RECON event; open HOLDINGS breaks mark positions Review.
- **Performance.** Daily time-weighted return from position history, price history, FX and cash, with posted client deposits and withdrawals (cash journals) neutralised at the start of the day. Benchmarks are `perf_benchmarks` with target-weight constituents (by security, plus an optional cash sleeve), held constant-mix. **Brinson-Fachler** attribution by sector (allocation, selection, interaction on average start-of-day weights and linked sector returns) with an explicit "linking, trading and timing" line, and a contribution table by security whose rows (with residual and compounding lines) sum to the return. Charts and tables drill to IBOR positions and orders.
- **Official periods (BR-030).** `perf_periods` (`PRF-1001`) stores the return, series, attribution, contributions and the five controls as evidence. DRAFT is prepared by `reports.create`; **lock** needs `performance.lock` + step-up, a different person from the preparer, all five controls done (IBOR positions reconciled, cash reconciled, valuation sources approved, composite membership review, fees and flows validated, each computed live) and an unchanged data hash. A locked period is immutable; a **correction** is a new version with a reason, and locking it marks the earlier version SUPERSEDED.

### Endpoints

| Route | Permission |
| --- | --- |
| `GET /ibor/overview`, `/ledger`, `/settlement-ladder`, `/health`, `/lots`, `/events`, `/snapshots`, `/position` | `portfolio.view` (existing `GET /ibor/positions` is unchanged) |
| `POST /ibor/refresh` | `portfolio.view` + `portfolio.manage`, idempotent |
| `POST /ibor/reconcile` | `portfolio.view` + `recon.manage`, idempotent |
| `GET /performance/returns`, `/attribution`, `/summary`, `/benchmarks`, `/periods`, `/periods/:id` | `reports.view` |
| `POST /performance/periods`, `/periods/:id/recompute`, `/periods/:id/correct`, `POST /benchmarks`, `PUT /benchmarks/:id/constituents` | `reports.view` + `reports.create` |
| `POST /performance/periods/:id/lock` | `reports.view` + `performance.lock` + step-up (not the preparer) |

New permission code `performance.lock` (added to `investment_director`, `compliance` and `fund_accountant`, the roles that hold `valuation.release`; also in the admin protected list). All other codes already exist.

### Console

`/ops/ibor` (nav "Portfolio", `portfolio.view`): control bar tiles, six KPI tiles, filterable Position ledger with Open, Position & cash ladder, Authoritative-data controls, Book events & lineage, header actions Refresh IBOR and Reconcile positions. `/ops/ibor/position?portfolioId=&securityId=` is the Position second layer (Position ledger, Lots & settlement, Reconciliation, History). `/ops/performance` (`reports.view`): returns by portfolio, cumulative return chart, Allocation & selection, Contributions, Official-return controls, Periods, Benchmarks (create, edit composition); `Prepare official period`. `/ops/performance/[id]` shows the stored evidence, live controls for a draft, Recompute, Lock official return and Start correction. Typecheck only; no browser verification was done.

### Demo seed

`prisma/seed-ibor-performance.ts` (called by `seed-uat.ts` and `seed-demo.ts`, also standalone, idempotent): about 60 weekdays of deterministic price and FX history before the earliest seeded price, one backdated position and cash row per portfolio at the start of that history, opening lots and OPENING events for every current position, and benchmark compositions for the benchmark names the seeded portfolios carry (the "USD LIBOR + 3%" portfolio has none, so its composite control stays open). Seeded prices end in August 2026, so a period ending later shows a stale-price warning.
## Research, Private Markets, Portfolio Construction and Financing

Branch `worktree-wf_7f59526f-b16-3`. Migration `20261008100000_research_privates` (additive; models between the `// ---- ResearchPrivates ----` markers at the end of `schema.prisma`). Code: `backend/api/src/modules/{research,private-markets,portfolio-lab,financing}` (engine, service/routes, index) plus the shared helpers in `modules/rp-common.ts`. Screens: `/ops/research`, `/ops/private-markets`, `/ops/portfolio-lab`, `/ops/financing` (shared pieces in `src/ops/rp.tsx`). Seed: `prisma/seed-research-privates.ts` (called by `seed-demo.ts` and `seed-uat.ts`, idempotent). Test: `scripts/test-research-privates.ts`.

### New permissions (role catalogue)

| Code | Granted to | Used for |
|---|---|---|
| `research.ic.decide` | investment_director, portfolio_manager | Checker: publishes a research case (not its author), ratifies an IC vote tally (not the proposer, step-up) |
| `private.mark.approve` | investment_director, fund_accountant | Checker for NAV marks (not the maker, step-up, evidence required) |
| `financing.manage` | investment_director, portfolio_manager, compliance, operations | Prepares facilities, pools, haircut rules (step-up), drawdowns (step-up), margin calls |
| `financing.approve` | investment_director, compliance | Checker: activates a facility, reactivates, waives a margin call (not the issuer, step-up) |

Existing codes reused: `research.view`/`research.edit`, `portfolio.view`/`portfolio.manage`, `risk.view`, `orders.create` (creating draft orders).

### Research & IC (`/api/v1/research`)

Tables: `research_cases`, `research_rating_changes` (append-only), `ic_meetings`, `ic_decisions`, `ic_votes`, `ic_decision_orders`. Refs `RSC-`, `ICM-`, `ICD-`.

| Method and path | Permission | Notes |
|---|---|---|
| `GET /summary`, `/cases`, `/cases/:id`, `/meetings`, `/meetings/:id`, `/decisions`, `/decisions/:id`, `/orders/:orderId/decision` | `research.view` | Case view has latest price and upside to target |
| `POST /cases`, `PATCH /cases/:id` (DRAFT, author only) | `research.edit` | Idempotency-Key on create |
| `POST /cases/:id/submit` (author), `/revise`, `/archive` | `research.edit` | DRAFT -> IN_REVIEW; a published case revises back to DRAFT |
| `POST /cases/:id/publish`, `/return` | `research.ic.decide` | Not the author (403 `sod_violation`); publish appends a rating-history row |
| `POST /meetings`, `PATCH /meetings/:id` | `research.edit` | HELD needs every decision ratified; quorum per meeting |
| `POST /decisions` | `research.edit` | Only on a PUBLISHED case; BUY/SELL need a quantity |
| `POST /decisions/:id/open-voting` (proposer), `/vote`, `/withdraw` (proposer) | `research.edit` | One vote each, changeable until ratified |
| `POST /decisions/:id/ratify` | `research.ic.decide` + step-up | Not the proposer; needs quorum (409 `no_quorum`); outcome is the tally (FOR > AGAINST, a tie is rejected) |
| `POST /decisions/:id/orders` | `research.edit` + `orders.create` | APPROVED BUY/SELL only; creates a DRAFT order (`ORD-`), linked in `ic_decision_orders`; one live order per decision and portfolio |

### Private Markets (`/api/v1/private-markets`, next to the unchanged company-reporting hub)

Tables: `pm_funds`, `pm_commitments`, `pm_cashflows`, `pm_marks`, `pm_evidence`. Refs `PMF-`, `PMC-`, `PMX-`, `PMM-`.

| Method and path | Permission | Notes |
|---|---|---|
| `GET /summary?portfolioId=`, `/funds`, `/funds/:id`, `/commitments`, `/commitments/:id`, `/marks` | `portfolio.view` | Paid-in, distributed, NAV, DPI, RVPI, TVPI and XIRR derived from PAID cashflows and the latest APPROVED mark; stale-mark flag after 120 days |
| `POST /funds`, `PATCH /funds/:id`, `POST /funds/:id/commitments`, `POST /commitments/:id/cancel` | `portfolio.manage` | One commitment per fund and portfolio |
| `POST /commitments/:id/cashflows` | `portfolio.manage` | CALL or DISTRIBUTION; a call cannot exceed the unfunded commitment (409 `exceeds_commitment`, checked in the transaction) |
| `POST /cashflows/:id/pay`, `/cancel` | `portfolio.manage` | Settlement cannot be in the future |
| `POST /commitments/:id/marks`, `/marks/:id/evidence`, `/marks/:id/submit` | `portfolio.manage` (maker only) | Submit needs evidence (409 `evidence_required`); a NAV move over 30% needs a note |
| `POST /marks/:id/approve` | `private.mark.approve` + step-up | Not the maker; evidence re-checked; `/return` and `/reject` take a reason |

### Portfolio Construction (`/api/v1/portfolio-lab`)

Tables: `model_portfolios`, `model_weights`, `pl_rebalances`, `pl_rebalance_lines`. Refs `MDL-`, `RBL-`.

| Method and path | Permission | Notes |
|---|---|---|
| `GET /models`, `/models/:id`, `/rebalances`, `/rebalances/:id`; `POST /whatif` | `portfolio.view` | What-if saves nothing |
| `POST /models`, `PATCH /models/:id` (DRAFT), `/clone`, `/retire` | `portfolio.manage` | Weights plus the cash target must not exceed 100% |
| `POST /models/:id/activate` | `portfolio.manage` | Not the author (maker-checker); must total exactly 100%; securities must be active |
| `POST /rebalances` | `portfolio.manage` | Sizes trades in board lots, skips drift under the threshold, scales buys to cash plus sale proceeds above the reserve, runs the orders pre-trade checks and the risk-limit check per line and the mandate checks on the whole after-trade book |
| `POST /rebalances/:id/orders` | `portfolio.manage` + `orders.create` | DRAFT orders for lines that did not fail; 409 when the mandate is breached after the trades, the proposal is over a day old, or nothing is left; `/discard` takes a reason |

### Collateral & Financing (`/api/v1/financing`)

Tables: `fin_facilities`, `fin_movements`, `fin_pools`, `fin_collateral_items`, `fin_eligibility_rules`, `fin_margin_calls`. Refs `FAC-`, `POOL-`, `MC-`.

| Method and path | Permission | Notes |
|---|---|---|
| `GET /summary`, `/facilities`, `/facilities/:id`, `/pools`, `/pools/:id`, `/rules`, `/calls`, `/calls/:id` | `risk.view` | Drawn balance, collateral value, coverage and margin state are derived on every read |
| `POST /facilities`, `PATCH` (DRAFT, maker), `/submit`, `/suspend`, `/close` | `financing.manage` | Initial ratio at or above maintenance, maintenance at or above 1; a pool must be linked to submit; close needs zero balance and no open calls |
| `POST /facilities/:id/approve`, `/return`, `/reactivate` | `financing.approve` (+ step-up on approve and reactivate) | Not the maker |
| `POST /facilities/:id/draw` (step-up), `/repay` | `financing.manage` | Row-locked; a draw cannot pass the limit, an open margin call, or leave coverage under the initial ratio (409 `insufficient_collateral`) |
| `POST /pools`, `/pools/:id/collateral`, `/pools/:id/collateral/:itemId/release` | `financing.manage` | Only eligible assets the portfolio holds and has not pledged elsewhere; release (step-up) is refused if a linked facility would fall below its initial ratio |
| `PUT /rules` | `financing.manage` + step-up | Haircut, eligibility and optional pool cap by asset class and market; most specific rule wins; no rule means ineligible |
| `POST /facilities/:id/check`, `/monitor` | `financing.manage` | Raises a margin call when coverage is below maintenance and none is open; the call restores the initial ratio |
| `POST /calls/:id/acknowledge`, `/dispute`, `/resolve` (step-up), `/cancel` | `financing.manage` | Resolve needs live coverage at the initial ratio (409 `call_not_met`); only the issuer cancels, and only when no longer in deficit |
| `POST /calls/:id/waive` | `financing.approve` + step-up | Not the issuer |

Every mutation writes an audit event (`research.*`, `pm.*`, `lab.*`, `fin.*`); creates take `Idempotency-Key`.
## Reports, Regulatory, Data Fabric and Model Governance

Four pages (SRD 5.A `reports`, `regulatory`, `data`, `model-governance`), all real: persisted in MySQL, permission-gated, audited, idempotent, with seed data and consoles wired to the live API.

### Tables (migration `20261010100000_reports_regulatory`, additive)

`report_definitions`, `report_runs`, `report_schedules`; `reg_templates`, `reg_filings`, `reg_evidence`; `data_sources`, `data_ingestion_jobs`, `data_quality_rules`, `data_quality_runs`, `data_quality_exceptions`; `gov_models`, `gov_model_versions`, `gov_model_validations`, `gov_model_usage`. Reference numbers `RPT-`, `REG-`, `JOB-`, `DQR-`, `MDL-`.

### Permissions

Pages: Reports and Regulatory `reports.view`; Data `operations.view`; Model governance `risk.view`. New codes in the role catalogue: `reports.approve` (approve or return a filing, distribute a report to the LP portal; step-up MFA), `reports.submit` (record a filing submission; step-up MFA), `data.manage` (register sources, run jobs and rules, work exceptions), `model.approve` (validate, approve, reject and retire models). Existing `reports.create` prepares reports and filings; `risk.manage` registers models and drafts versions.

### Reports & BI (`/api/v1/reports`)

Catalogue of five reports (fund fact sheet, holdings, transactions, NAV pack, cash) generated from live data (NAV valuation, order fills, cash journals and balances) to CSV, JSON or print-ready HTML, stored as an encrypted file with a SHA-256 and downloaded by a 2-minute signed link. Schedules (daily to quarterly) run hourly in the worker as the schedule's creator, or on demand (`run-now`, `run-due`). A fact sheet or NAV pack for a fund-linked portfolio can be sent to the LP portal by an approver: it creates a published Document and a Publication for each investor with an active commitment (once only). Endpoints: `GET catalogue|lookups|runs|runs/:id|runs/:id/link|schedules`, `POST runs`, `runs/:id/distribute`, `schedules`, `schedules/:id/run-now`, `schedules/run-due`, `PATCH schedules/:id`.

### Regulatory Reporting (`/api/v1/regulatory`)

Four templates (SECZ quarterly return, SECZ annual funds under management, FIU large cash transaction report, FIU client risk and screening summary) populated from NAV runs, clients, KYC cases, screening results, orders, fills, cash journals and risk breaches. Filing calendar with derived OVERDUE and due-date counts; `calendar/generate` opens the current periods (idempotent). A filing is DRAFT, then IN_REVIEW (needs evidence; the payload hash is locked), APPROVED (a different person, step-up MFA, hash re-checked), SUBMITTED (a person other than the preparer, step-up MFA, regulator reference), with RETURNED and WAIVED side exits. Evidence upload and signed download, CSV export, audit timeline. The FIU threshold is the policy `reg.fiu_ctr_threshold` (default 10,000, no FX conversion). Form codes are internal working codes, not regulator-issued.

### Data Fabric & Studio (`/api/v1/data`)

Source registry (table, file feed, API, manual), ingestion jobs (table sources are profiled live: row count and newest record; other kinds record the feed run), data-quality rules (NOT_NULL, UNIQUE, RANGE, FRESHNESS, ORPHAN) compiled to parameterised SQL over a whitelist of nine datasets, run results, and an exceptions list (acknowledge, resolve or waive with a reason). A re-run raises new failures, keeps open ones and clears those that now pass. No SQL, table or column name from the client is ever executed unless it is in the registry (`data.engine.ts`).

### Model Governance (`/api/v1/model-governance`)

Model inventory (type, tier, owner, review date), versions DRAFT, SUBMITTED, VALIDATED, APPROVED (or REJECTED, RETIRED), validation records, and a usage log. Author, validator and approver must be three different people; approval and retirement need step-up MFA; a failed validation rejects the version; the usage log refuses a model with no approved version and warns when its review is overdue.

### Console

`/ops/reports`, `/ops/regulatory`, `/ops/data`, `/ops/model-governance`, navigation under "Risk & compliance" and "Reporting & data".

### Demo seed

`prisma/seed-reports.ts` (called by `seed-uat.ts` and `seed-demo.ts`, also standalone, idempotent): report catalogue and sample schedules, regulator templates and the current calendar filings (unpopulated drafts), nine table sources plus feed/API/manual sources, 19 quality rules (never run), and three models (one legacy-attested approved model, one awaiting validation, one draft). The approved model is labelled as seed data, not a live approval.

### Running the test

```
# disposable DB only; same steps as the other modules
cd backend/api
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx --env-file-if-exists=../../.env prisma/seed.ts
API_PORT=4181 npx tsx --env-file-if-exists=../../.env src/server.ts      # another terminal; FILE_ENCRYPTION_KEY must be set
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-ibor-performance.ts
```

`scripts/test-ibor-performance.ts` covers the pure rules, permissions, lots from fills, idempotent refresh, drift, the ladder, the reconciliation hook, returns against a hand calculation, attribution sums, benchmarks, the lock (step-up, segregation, controls, immutability) and corrections. It was typechecked but **not run** (no local database was started).

### Not done

- Money values in the return maths use floating point (returns are fractions; stored money is rounded to 4 dp). No multi-period linking (Carino) of attribution, no currency or trading-implementation effects, no composites across portfolios.
- External flows come only from posted CLIENT_DEPOSIT / CLIENT_WITHDRAWAL cash journals; the portfolio cash record is not updated by those journals, so a deposit that was not also written to `portfolio_cash` would distort a period (the cash control compares ledger and book cash to catch this).
- The refresh is a manual action, not a job or event stream; accrued income covers confirmed, unpaid corporate-action cash only (no bond coupons); settlement days are a constant, not a calendar; no ISIN search; "Historical snapshot" re-values positions as of a date but does not replay lots.
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-research-privates.ts
```

The engine checks were run (IRR, TVPI/DPI, rebalance sizing, haircut and margin maths); the API flow script was typechecked but **not run** (no local database was started). Role-catalogue changes need `prisma/seed.ts` to be re-run.

### Not done

- Research: no market-data or earnings feed, no document attachments on cases, no IC attendance list (voters are any `research.edit` holder), no scheduled reminders. Orders still do not show the decision that created them on the order ticket (read it via `GET /research/orders/:orderId/decision`).
- Private markets: capital calls and distributions are not posted to the cash ledger or accounting; no FX for non-USD funds in the pooled totals; no look-through to underlying companies or J-curve forecast; evidence is a vault reference, not an uploaded file.
- Portfolio Construction: no optimiser, tax or transaction-cost model, no model drift monitor or scheduled rebalance; per-line checks run against today's book, so one line's effect on another is only caught by the whole-book mandate check.
- Financing: no interest accrual or fee postings, no lender-side margin feed, no FX conversion of pool value beyond the latest `fx_rates`, no intraday revaluation (coverage is computed on demand and by the monitor button); `financing.*` codes are not in the system-admin SoD blocklist in `admin.routes.ts`.
## Clients & Accounts, Investor Services, Onboarding & KYC, Document Vault (`clients`, `investor-services`, `onboarding`, `vault`)

Reuses the existing client, cash-account, mandate, service-request, KYC and document tables and routes; adds `/api/v1/client-ops/*` (module `backend/api/src/modules/clients-onboarding`) and four ops screens under `/ops/clients`, `/ops/investor-services`, `/ops/onboarding`, `/ops/vault`. Migration `20261009100000_clients_onboarding` (additive: `kyc_checks`, `kyc_risk_assessments`, `service_sla_policies`, `document_changes`, `document_holds`; logical references only, no FKs).

| Page | Endpoints (under `/client-ops`) | Permissions |
|---|---|---|
| Clients & Accounts | `GET /clients/summary`, `GET /clients/:id/360` (adds portfolios and fund commitments), `POST /clients/:id/dealing-hold` (release needs step-up), `/relationship-owner`, `/review-date`, `/mandates/:ref/status` (activation gated on current KYC, no hold, an active cash account), `GET /staff`. Existing `/clients` and `/cash-accounts/:id/:action` are used for create and the account lifecycle. | `clients.view`, `clients.edit` |
| Investor Services | `GET /services/summary`, `/services/requests[/:ref]`, `POST /services/requests` (due date from policy), `/assign`, `/status` (notifies investor users), `/note`, `/sla`; `GET/PUT /services/sla-policies` | `clients.view`, `clients.edit` |
| Onboarding & KYC | `GET /onboarding/queue`, `/cases/:id/workup`, `POST /cases/:id/checks`, `/risk` (maker proposes a computed rating; an override needs a rationale), `/risk/:id/approve` (checker, a different person, step-up) and `/reject`, `/cases/:id/assign`. Request-more-info, stage moves, decision and activation reuse `/kyc/cases/*`. | `onboarding.view`, `onboarding.manage`, new `onboarding.approve` |
| Document Vault | `GET /vault/summary`, `/vault/documents[/:id]`, `/documents/:id/download-url` (writes the access log), `POST /documents/:id/changes` (classification or retention, maker-checker), `/changes/:id/approve` (step-up) and `/reject`, `/documents/:id/hold`, `/holds/:id/release` (a different person, step-up), `/documents/:id/link` (client, fund), `GET /vault/changes`, `/vault/access-log` | `documents.view`, `documents.edit`, new `documents.approve` (access log: `audit.view` or `documents.approve`) |

New permissions `onboarding.approve` and `documents.approve` are granted to the Compliance role in `prisma/seed/role-catalog.json`. New policy `kyc_risk_assessment_required` (default off): when on, a KYC approval also needs an approved risk assessment matching the case rating. Every mutation is audited; creating endpoints accept an `Idempotency-Key`.

Seed: `prisma/seed-clients-onboarding.ts` (called by `seed-uat.ts` and `seed-demo.ts`, idempotent) adds SLA policies, assigns and dates service requests, sets client review dates, adds checks and a proposed risk rating on open cases, one pending classification change and one legal hold.

Tests: `npx tsx scripts/test-clients-onboarding.ts` runs the pure rules (risk score, SLA state, retention, change validation) with no database. The endpoints were typechecked but **not run** (no database started).

### Not done

- No document upload or deletion in the vault screen (upload and lifecycle stay on the existing `/documents` API); retention only flags disposal eligibility, nothing is destroyed.
- Screening is still the existing stub provider; checks are recorded manually. Risk factors are fixed rules, not configurable.
- Client dealing-hold and mandate changes are audited but single-step (no checker).
cd backend/api
E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-reports.ts
```

Covers the engine maths, permissions, generation in every format with hash and signed download, idempotency, scheduling, LP distribution, the filing maker-checker with hash lock and step-up, data-quality rules over live tables with exceptions, ingestion, and model version separation and the usage gate. Typechecked but **not run** (no local database was started).

### Not done

- No PDF binary output (HTML is print-ready); no email delivery of scheduled reports; date-range report schedules repeat fixed dates.
- Filing payloads are internal working layouts, not the regulators' official XML or portal formats; no direct upload to SECZ or FIU; the FIU report has no FX conversion.
- No streaming or file-based ingestion engine: table sources are profiled, feed runs are recorded by an operator. Rules cover single-column checks, not cross-table reconciliations.
- Models are not yet called automatically by NAV or risk; `POST models/:id/usage` is available to callers. No periodic-review workflow beyond the review date.
## Admin Core: RBAC & Controls, Settings, Audit Trail, Investment Copilot

Migration `20261011100000_admin_core`; API `/api/v1/admin-core/*` (module `backend/api/src/modules/admin-core`) on top of the existing `/api/v1/admin/*` routes (users, roles, policy, SoD scan, audit evidence, verify). Screens: `/ops/rbac`, `/ops/settings`, `/ops/audit`, `/ops/copilot`. Demo data: `prisma/seed-admin-core.ts` (settings history, one open access review), called from `seed-demo.ts` and `seed-uat.ts`.

- **RBAC (`admin.rbac`)**: role/permission matrix from the live role catalogue; role and user changes go through access change requests (`access_change_requests`). A privileged change (a monetary or `admin.*` permission, `accounting.close/reopen`, `valuation.release`, `risk.manage`, or the System Administrator role) waits for a different `admin.rbac` holder to approve under step-up; the target user cannot approve their own change. Non-privileged changes apply at once and are recorded the same way. The older direct `PUT /admin/users/:id/roles` and `PUT /admin/roles/:key/permissions` now refuse privileged grants (`approval_required`). Access reviews snapshot active staff; reviewers cannot certify themselves; revocations become disable requests for an independent approver. The SoD report lists conflicting permission pairs per role and per user; the step-up view lists the guarded actions and MFA enrolment.
- **Settings (`admin.settings`)**: registry of feature flags, retention, notification and security settings with validation, optimistic version, mandatory reason, step-up for security keys, change history (`platform_setting_changes`) and an audit event. Security settings write through to the `policies` table that enforcement reads. The Copilot flag is enforced; other flags and retention values are recorded for modules to adopt. Numbering shows the live reference counters.
- **Audit Trail (`audit.view`)**: filterable log over the hash chain, entity drill-down (object type and id), event detail with chain links, the existing verify endpoint, CSV export (itself audited).
- **Copilot (`dashboard.view`)**: deterministic keyword router, no external model or key. Answers positions, orders, NAV, breaks, risk, cash, approvals and audit questions from live rows, only for domains the caller's permissions allow, with cited sources; questions are logged per user.

Test: `npx tsx scripts/test-admin-core.ts` (engine rules, no database needed). Typechecked; the API flows were **not run** (no database started).

### Not done

- No LLM; unrecognised questions get a help message. Copilot does not add values across currencies.
- Retention, notification and most feature-flag settings are recorded but not yet read by other modules. No scheduled purge.
- Custom permission codes cannot be created; role creation and staff invitation still use the direct `/admin` endpoints.

## WP-2: orders, cash, private-markets and corporate-action wiring (GAP-004, 005, 007, part of 010)

Migration `20261021100000_orders_pm_wiring`. Typechecked only (backend, admin-web); `scripts/test-orders-pm-wiring.ts` was not run on a database.

- Orders and cash (GAP-004): the reservation wiring already existed in `cash/cash.orders.ts` (hold on submit, resize on fill, release on cancel/reject, consumed when the settlement journal posts, restored on reversal); the gap table was stale. New: the order ticket (`GET /orders/:id`) returns `cash` (the order's holds and the bank ledger availability) and `decision` (the IC decision and research case that produced it); the screen shows both.
- Realised gain (GAP-010 part): each SELL fill writes `order_realised_gains` (average cost); settlement books investments out at cost and the gain to account 4300; the ticket shows the gain.
- Private markets (GAP-005): paying a call or distribution and approving a mark create PENDING_APPROVAL system journals (`PMX:<ref>`, `PMM:<ref>`) and a `pm_postings` row (carrying value, FX rate used, journal refs). Accounts 1150, 4300, 4400 were added to the auto-journal chart. Non-USD funds need an FX rate (409 `no_fx_rate` otherwise); pooled summary totals are in USD with `fxMissing`. Distributions can carry `returnOfCapital`. `GET /private-markets/jcurve` and `/clients` (exposure per client). Evidence files: `POST /marks/:id/evidence/upload` (multipart) files a restricted vault document; `documentId` links an existing one.
- Corporate actions (GAP-007): per-event `cashInLieu` + `cilPrice` pay fractions in cash (the fraction's cost leaves the position, gain to 4300); `POST /events/:id/reverse` (process permission, step-up, not the processor) reverses by adjustment (new rows dated today, pending journals discarded, posted ones get an inverse `:REV` journal); status REVERSED. Client level: `GET /events/:id/clients` and `GET /corporate-actions/clients/:clientId/entitlements`.
- Seed: `prisma/seed-orders-pm.ts` (called last by seed-demo and seed-uat). Remaining: realised gain uses the position average cost, not IBOR lots; a CA reversal limits itself to what is held if the position moved since.

## Reconciliation depth and Operations control (WP-3, GAP-006, GAP-010 operations part)

Migration `20261022100000_recon_ops`. Test: `backend/api/scripts/test-recon-ops.ts` (needs a disposable MySQL and a running
API; typechecked here, not run). Seed: `prisma/seed-recon-ops.ts` (called by `seed-uat.ts`).

### What was added to `/ops/reconciliation`

- **Three new families.** `POSITIONS_VS_CUSTODY` (internal quantity per security against the custodian's position file;
  custodian-only holding CRITICAL, internal-only HIGH, quantity difference at least HIGH), `SETTLEMENT_FAILS` (filled
  trades past their expected settlement date plus grace and still unsettled; expected date is the custodian execution's
  settlement date, else trade date + 2 days; 1-2 days late MEDIUM, 3-5 HIGH, more CRITICAL; a trade settled after the
  as-of date is still a fail as of that date) and `CORP_ACTIONS` (our entitlements for events paying on the date against
  the custodian's notices per security and ex date: not reported HIGH, unknown notice CRITICAL, quantity or cash
  difference at least HIGH). The `family` columns were widened to 32 characters.
- **Custodian feeds.** `POST /recon/custody-positions` and `/custody-ca-notices` (CSV file upload, pasted CSV or JSON rows;
  the file replaces the earlier one for the same account and date, refused once the family/date is signed off). Each
  upload writes a source receipt (`recon_source_receipts`: SHA-256, row count, version, stored original) which drives
  "source missing" for these families (BR-065). `GET /recon/feeds`, `/custody-positions`, `/custody-ca-notices`.
- **Effective-dated tolerances (BR-067, Q-13).** `recon_tolerances`: per family, optionally per counterparty, with an
  effective date. Per field the newest row in force wins (counterparty rows first, then global, then the built-in
  default). `GET /recon/tolerances`, `/tolerances/effective`, `POST /recon/tolerances` (recon.signoff, step-up, today or
  later), `DELETE` for a change not yet in force. A run records the values and where each came from in `params`; a run
  override is still allowed.
- **Evidence files.** `POST /breaks/:id/evidence` (multipart, SHA-256, stored encrypted), list and byte-checked download;
  a maker can resolve with attached files instead of a reference string.
- **Query source and escalate.** `POST /breaks/:id/query` (QRY ref, flags the custodian execution `Queried`, moves the
  break into investigation), `/actions/:id/respond`, `/actions/:id/close`, `POST /breaks/:id/escalate` (ESC ref, level
  1-3, ownership moves to the target and they are notified), `GET /recon/actions` queue.
- **Reopen.** `POST /breaks/:id/reopen` (recon.signoff, step-up, reason of 10+ characters). If a sign-off covers the break
  it is refused with `signed_off` until `revokeSignoff` is sent, which moves the sign-off to `recon_signoff_voids`.
- **Trade matching.** Partial fills of one order are aggregated (volume-weighted price) and matched against one custodian
  trade; custodian prices in another currency are converted with the FX rate for the date (plus 0.1% of the price for
  rate rounding) and compared in the internal currency; no rate is an attribute break.
- **CSV export of breaks.** `GET /recon/breaks?format=csv` with the same filters (formula-safe cells, audited).
- **Close gate.** `reconGate()` (open Critical or High breaks, scoped to a portfolio and up to the as-of date) blocks
  `POST /nav/runs/:id/release` with `recon_breaks_open`, and blocks completing runbook tasks in the VALUATION or CLOSE
  areas (manual ones, and the generated NAV release, cash close and accounting journal tasks) with `recon_gate`.
  Policy `recon_nav_gate` set to `false` turns it off. `GET /recon/gate` shows the current state.

### What was added to Operations Control and the Command Centre

- Task comments (`ops_task_comments`, `GET/POST /operations/tasks/:id/comments`, count on the task view).
- `GET /operations/calendar` (tasks, corporate-action dates, expected cash, custodian settlements, NAV runs, month ends)
  and `GET /operations/workload` (by owner and area, tasks due and cash deadlines for the next 7 days), shown as a month
  calendar with agenda and bar charts. CSV export button for the runbook.
- The runbook generator adds `RECON:MATERIAL` (clear Critical and High breaks) and one sign-off task per family run today
  and not signed off; NAV release, cash close and accounting journal tasks depend on `RECON:MATERIAL`.
- `GET /dashboard/panels` and the Command Centre panels: performance (net TWR and benchmark curve for the five largest
  portfolios), allocation (asset class, sector and market, per base currency) and scenarios (the three risk presets on the
  eight largest portfolios).

### Not done (this package)

Scheduled-source registry with expected-by times (a missing source is still derived from receipts and day-end
packages); automatic ingestion from a custodian feed (needs the WP-8 `CustodianFeedAdapter`); per-account tolerances;
positions reconciled per lot or per currency of listing; settlement fails do not read an MT548 status; notifications to
the custodian for queries are recorded and audited but not sent (no custodian-side inbox); the NAV gate is not applied to
the cash period close or accounting period close endpoints (only their runbook tasks).
## Admin shell, security hardening and notifications (WP-4)

Migration `20261023100000_admin_shell_security`; API `/api/v1/shell/*` (`modules/search`), `/api/v1/notifications/preferences`, `/api/v1/admin/permissions` (custom codes), `/api/v1/admin-core/{retention,sod/rules}`. Screens: the shell itself (`ops/Shell.tsx`, components in `ops/shell/*`), `/ops/profile`, `/ops/notifications`, `/ops/security`, `/ops/record/<kind>/<id>`. Seed: `prisma/seed-admin-shell.ts`. Test: `scripts/test-admin-shell.ts` (the pure rules run without a database; the API, outbox claim, digest and purge sections need a throwaway database and a running API).

- **Shell**: breadcrumb trail with deep links, command palette (Ctrl/Cmd+K or `/`) over pages, actions and a permission-filtered record search across 23 record kinds, notification bell (unread count, latest items, mark read, link through), avatar menu with role focus (a saved viewing lens over the navigation; it never widens or narrows API authorisation), generic record page with audit history, shared `Drawer`/`RecordDrawer` and `DocumentModal` (PDF and image preview from a signed URL) for other screens to reuse.
- **Profile**: display name, authenticator enrolment (uses the existing `/auth/mfa/enroll` and `/verify`), password change (current password required, other sessions signed out, audited) and a session list with revoke. Resetting a second factor stays an administrator action.
- **Notifications**: the worker routes each notification per recipient (`modules/notifications/delivery.ts`): platform `notify.email_enabled`, `notify.critical_channel` for critical types, LP `lp.prefs:*` settings (per-category email and in-app flags, digest frequency), investee and staff `notification_preferences`. Email goes through its own outbox event so a mail failure retries the mail, not the notification. Daily and Monday weekly digests are sent once per user per period (`notification_digest_logs` primary key) after the `notify.digest_hour` Harare hour.
- **Enforcement**: `lib/settings.ts` is the one reader for platform settings. Consumers: the feature flags (LP dealing submit, staff investee questions, cash statement staging, Copilot), `notify.*` in the worker, `retention.*` in the daily purge job (`admin-core/retention.ts`: expired sessions, reset tokens, unaccepted invitations, idempotency keys, delivered outbox rows, old read notifications; audit events are never deleted and documents past retention are only counted). Dry run and live run from `/ops/security`, each recorded in `purge_runs`.
- **Separation of duties**: one list. `admin-core.engine.ts` `MONETARY` now also covers `valuation.release`, `accounting.close/reopen`, `capital.*`, `distributions.*`, `corporate_actions.process`, `financing.manage/approve`, `private.mark.approve`, `research.ic.decide`, `reports.approve/submit`, `model.approve`; the legacy `/admin` routes import it. 17 new conflicting pairs (financing, PM marks, research, reports, models, capital, distributions, accounting reopen, access control against each approval). The legacy SoD scan reports role-level and cross-role conflicts.
- **Access control**: custom permission codes (`custom_permissions`; reserved codes refused, unknown codes refused on role edit, removal blocked while in use); a new role cannot start with privileged permissions from a template (they are listed as deferred for a change request); inviting directly into a privileged role needs a checker.
- **Security**: CSP, frame-ancestors, nosniff, referrer and permissions policies on all five portals (`next.config.ts`) and HSTS plus API headers in `deploy/nginx`; 600 requests/min and 30 uploads/min per client (`RATE_LIMIT_PER_MIN`, `UPLOAD_LIMIT_PER_MIN`); one JSON log line per request with request id, never the query string, headers, cookies or bodies; optional Prometheus metrics behind `METRICS_TOKEN`; the console mail transport no longer prints bodies (invite and reset links); worker row claiming (`claimed_by/claimed_at/next_attempt_at`, stale claims taken over after five minutes) and job locks for scheduled jobs (`job_locks`).
- **Idempotency and paging**: audit of 256 staff write routes; every state-changing route without an `Idempotency-Key` handler now accepts one (118 routes, optional so existing screens keep working; posting, release and approval routes already required it). Staff list endpoints return `page`, `pageSize` and `total` (`middleware/paginate.ts`); `?page=&pageSize=` returns a window.

### Not done

- Paging is applied to the list envelope (bounded by each handler's existing `take`), not pushed down to SQL `skip`; very large lists still read up to the cap.
- `If-Match` is still only on some routes (NFR-SEC-012).
- Create-role and staff-invite still use the direct `/admin` endpoints (now guarded against privileged grants) rather than change requests.
- Role focus changes the menu only. The session list shows the user agent string, not a parsed device name.
- Nothing here was run against a database or browser; typechecked only.
## Investee workspace tables (WP-5, GAP-016)

Migration `20261024100000_investee_workspace` (16 tables, no change to existing tables). Cap table, forecast, governance consents, requisitions are tables now; old `settings` JSON (`workspace.cap|governance|forecast|requests`) is copied once per company on first use (`ensureWorkspace`) and then ignored.

- Cap table: transactions (issue, transfer, cancel) need a second company user with the sign capability and step-up; certificates carry a SHA-256 and can be re-verified; issue and cancel with a price post a PENDING_APPROVAL journal (`CAP:<ref>`) into a per-company ledger portfolio; exit waterfall (1x or n x preference, participating or not, seniority, conversion); register readable as of a date. `PUT /cap-table` is now baseline-only and refused once transactions exist.
- Forecast cells are rows with month locks (approver locks, administrator unlocks). Board meetings, pack (frozen and hashed on publish), board actions. Company-initiated signature requests with tokened public signer page (`/sign/<token>` on company-web, `/api/v1/investee-public/sign/*`), remind (rotates link, 1 per hour, 5 max) and void. Share links (max 7 days, hash-only storage, access count, text watermark, revoke). Global search, derived KPI history with CSV/xlsx export, MFA coverage and access review.
- Company-web: `/workspace` page (needs `workspace` in `INVESTEE_LIVE_ACTIONS` or `all`).
- Not done: cap-table GL journals still need approval in accounting; non-text share files are not watermarked; signature e-mail goes through the existing outbox mailer (adapter comes from WP-8); no staff-side screen for cap-table data.
## WP-6: reports, data fabric, models, vault and clients (supersedes the matching "Not done" lines above)

Migration `20261025100000_wp6_reports_data_models_vault`. Test: `npx tsx scripts/test-wp6.ts` (pure block runs anywhere; API flows need `E2E_CONFIRM=throwaway-db`; typechecked, flows not run here).

- **Reports**: PDF output (`reports/pdf.ts`, paginated tables, page footer, hash stored). Schedules carry a rolling window (previous day or month or quarter, month/quarter/year to date, trailing 30 days) re-dated at every run, and optional recipients: a completed run mails a link (never the data) through `sendMail`; to move to the EmailAdapter swap that call in `emailRun`. Runs can also be emailed on demand.
- **Data Fabric**: FILE_FEED sources have a column contract (`schemaSpec`) and a CSV upload that types and validates rows, stages accepted rows (`data_staged_records`), keeps refused rows with reasons (`data_rejected_rows`) and refuses an identical repeat file. Rules can target a feed (`feed:<source key>`); new check types cover composite uniqueness, cross-table existence and column comparison, on registry tables and feeds.
- **Model governance**: periodic review workflow (OPEN, SUBMITTED, COMPLETED; the reviewer is not the version author or approver, approval by a third person with step-up) that moves the next review date by tier cadence or retires the model. Bindings tie NAV runs and risk scenario runs to an approved model, log each use automatically and can be enforced (refuse when there is no approved version or the review is overdue). `openDueReviews()` is exported for a scheduler.
- **Vault**: upload, new version, submit, approve, return and publish buttons over the document lifecycle API; disposal as a maker-checker change (retention ended, no hold; withdrawn, not downloadable, audit kept); valuation evidence files for private-markets marks (`pm_evidence.document_id`).
- **Clients**: KYC risk factors and rating thresholds are stored and editable (approver permission and step-up). Releasing a dealing hold and activating or closing a mandate go through change requests approved by a different person (`onboarding.approve`, step-up). Placing a hold stays immediate.

### Not done (WP-6)

- Scheduled-report email carries a link, not an attachment, until the EmailAdapter exists. Feed upload is CSV only (no MT535 or CAMT, no API pull). Cross-table rules compare one column to one reference column. The review sweep is a button and an exported function, not yet called by the worker (worker.ts belongs to WP-4).
## WP-7: custodian, onboarding and legacy retirement

Migration `20261026100000_custodian_ops`. Closed: GAP-018 (bulk CSV upload with declared control totals, amend and cancel with reason, status history, day-end quantity/notional control totals), GAP-019 (DEF-458 live script already replaces the disabled bridge; DEF-459 dead `v57-rail-nav.js` is not in the tree; DEF-460 rail forward validation fixed in `legacy-static/v65/public-onboarding.html` and the published `01-inline.js`; Playwright smoke in `tools/uat/e2e`), GAP-021 (`/` redirects to `/ops`, prototype moved to `/classic` with only live-bridged pages in its nav, old `/#page` links forwarded), GAP-017 (LP realtime polling contract `GET /lp-portal/realtime?since=`, styled performance statement PDF), GAP-025 (zod contracts in `packages/shared/src/staff-contracts.ts`, `ops/types.ts` derives four types from them, `tools/uat/contract-staff.ts` validates every module against a live API).

Custodian API additions (all under `/api/v1/custodian`): `POST /executions/bulk` (multipart CSV, optional `declaredCount`, `declaredQuantity`, `declaredNotional`, `dryRun`; any invalid row or control mismatch rejects the whole file and keeps a Rejected batch), `GET /executions-batches`, `PATCH /executions/:id` (amend), `POST /executions/:id/cancel`, `GET /executions/:id/history`, `GET /history`, `GET /day-end/:id/history`. Amend and cancel are allowed while the status is Received, Exception or Queried and no Approved/Accepted day-end package covers the account and date. A day-end package may declare `tradeQuantity` and `tradeNotional`; submit is blocked (`control_total_mismatch`) when a declared total disagrees with the executions received. Test: `backend/api/scripts/test-custodian-ops.ts` (needs a disposable DB and a running API).

Not done: the superseded legacy page fragments are unreachable (redirected) but not yet deleted from `src/legacy/markup`; the Playwright suites were written but not run (no browser in this build); staff `/ops/custodian` does not yet list bulk batches.
## Integrations layer (WP-8): `/ops/integrations`

Migration `20261027100000_integrations` (`integration_calls`, `integration_inbox`, `integration_state`). Code: `backend/api/src/integrations/` (registry in `core/`, one folder per adapter with `types.ts`, `fake.ts`, `live.ts`, `index.ts`), API `/api/v1/admin-core/integrations/*` (`modules/admin-core/integrations.routes.ts`, permission `admin.settings`), screen `/ops/integrations`, banner `ops/IntegrationsBanner.tsx`. Seed: `prisma/seed-integrations.ts` (state rows and one baseline call per adapter; called by `seed-demo.ts` and `seed-uat.ts`). Test: `npx tsx scripts/test-integrations.ts` (startup rules, live stubs, redaction and the deterministic fakes need no database; `E2E_CONFIRM=throwaway-db` adds persistence, failure simulation and upload scanning).

- **Adapters (GAP-A01..A13)**: email, sms, screening, identity-verification, market-data, custodian-feed, bank-statement, payment, esign, av-scan, llm, sso, object-storage, regulator-filing, broker-routing. Flag `INTEGRATION_<NAME>=fake|live` (default fake). `live` needs its credentials (listed on the screen and in `deploy/.env.production.example`) or the API and worker refuse to start; in production `fake` is refused unless `ALLOW_FAKE_INTEGRATIONS=1` (email over SMTP, local encrypted file storage and the deterministic Copilot are exempt). Live classes are throwing stubs (`NotConfiguredError`, HTTP 503) except email, which is a real SMTP relay.
- **Logging**: the registry wraps every adapter, so each operation writes a row to `integration_calls` (request hash, redacted request and result, status, duration, correlation id). Fakes keep simulated artefacts in `integration_inbox` (emails outside production, SMS codes, payment instructions, envelopes, receipts). Failure simulation (`PUT /:name/failure`, fake only) fails the next N calls or all until cleared.
- **Rewired call sites** (same behaviour in fake mode): `lib/mailer.ts` (email), `lib/storage.ts` (object-storage plus an av-scan of every upload; EICAR is rejected 422), `modules/kyc/screening.ts` (screening logic moved into `integrations/screening/fake.ts`), `admin-core` Copilot route (llm), regulatory filing submit (regulator-filing receipt stored in the audit event), worker tick (fake payments settle).
- **Simulated feeds**: `POST /market-data/sync` (alias `/simulate`) writes `VENDOR` prices and FX without overwriting existing ones, `POST /bank-statement/simulate` stages a cash statement import for a different person to commit, `POST /custodian-feed/simulate` records a Received day-end package.

### Not done

- Fake SSO has the dev identity-provider page and code exchange but no staff login flow consumes it yet. SMS, identity verification, e-sign, payment payouts and broker routing have adapters, fakes and test calls but no business module calls them yet (distribution payouts, term-sheet signing, order routing, OTP sign-in are the next wiring steps).
- The three feed simulations need only `admin.settings` and an audit event (no step-up).
## E-signatures (`/ops/esign`)

Migration `20261030100000_esign` (tables `esign_requests`, `esign_signers`, `esign_events`; no columns added to existing tables). API `/api/v1/esign/*` (module `backend/api/src/modules/esign`), adapter `backend/api/src/integrations/esign` (`INTEGRATION_ESIGN=native|live`; `live` is a `NotConfiguredError` stub for a future vendor). Native sealing uses `pdf-lib` (MIT); there is no paid vendor. Files use the existing `lib/storage.ts` (no object-storage adapter exists yet).

- **Requests** run on a PDF from the document store or an uploaded PDF. Signers can be staff, LP signatories (signatory or manager role), investee users with signing authority, or external e-mail signers. Order is parallel or sequential (signers sharing an order number sign together). Statuses: draft, pending, completed, declined, voided, expired.
- **Identity**: signed-in signers sign from their portal under the existing step-up (authenticator code if enrolled); external signers open a one-time link (`ONBOARDING_PORTAL_URL/sign/<token>`), then confirm a 6-digit e-mail code sent through the outbox mailer (10 minutes, 5 attempts). Signature is typed or drawn, with a versioned consent text that is hashed.
- **Seal**: every signature joins a SHA-256 chain (`genesis = ref + original hash`, each link covers signer, time, IP, method, signature, consent and document hash). On the last signature the original pages get a seal footer, a signature page with stamped signatures and an audit block is appended, followed by a certificate of completion (signers, IPs, timestamps, hashes, consent text, event trail). The sealed PDF and a stand-alone certificate are stored; the sealed hash is recorded; if the request came from a document, the sealed copy becomes its next version. A completed request cannot be changed or voided. Each request also has its own hash-chained event log, and every action writes the platform audit log.
- **Verify**: staff `GET /esign/requests/:id/verify` recomputes file hashes, signature chain and event chain; public `POST /esign/public/verify` (upload or SHA-256) answers sealed / original / none at `/sign/verify` in the onboarding portal.
- **Lifecycle**: resend (new link for external signers), void with reason, decline with reason, expiry and up to three reminders every three days (worker scan, every 15 minutes).
- **Flows** (generic `POST /esign/requests` plus two concrete): `POST /esign/flows/commitment/:commitmentId` generates the subscription and commitment agreement, files it in the vault and asks the investor's signatories (optional staff countersigner next); completion activates a PENDING commitment. `POST /esign/flows/capital-call-ack/:allocationId` generates an acknowledgement for an issued call; completion sets `acknowledged_at/by` on the allocation. New flows register a completion hook keyed by `subjectType`.
- **Signer pages**: LP portal `/lp-portal/signatures`, investee portal `/esign`, public token page `/sign/<token>` and `/sign/verify` (onboarding portal); one shared component in `packages/portal-kit`.
- **Permissions** (appended to `role-catalog.json`): `esign.view`, `esign.manage`, `esign.void`.

Seed: `prisma/seed-esign.ts` (called by `seed-demo.ts` and `seed-uat.ts`, idempotent): one completed and sealed request, one waiting on an external signer, one voided, plus a capital call acknowledgement when an issued call exists.

Test: `npx tsx scripts/test-esign.ts` (hash chain, tamper detection, ordering, PNG validation, real PDF sealing; no database or SMTP). The API flows and pages were typechecked but **not run** (no database started, no browser).

### Not done

- No in-document signature field placement: signatures are stamped on an appended signature page, not at positions chosen on the PDF. Not a qualified or PAdES cryptographic signature; tamper evidence is the hash chain plus the recorded sealed hash.
- No vendor integration (`live` is a stub); external signer e-mails go through the console transport until SMTP is configured; the OTP and link sit in outbox payloads until sent.
- The flows screen takes a commitment or allocation id by hand; a capital call acknowledgement waits for one signatory. The legacy investee prototype's "signatures" page is untouched (the real inbox is `/esign`); LP acknowledgement through the old button still works and is not blocked by an open request.
## Integrations: Market Data and Custodian Feed (`backend/api/src/integrations`)

Migration `20261032100000_market_data` (models between `// ---- MarketData ----` markers at the end of `schema.prisma`: `md_source_status`, `md_provenance`, `md_refresh_runs`, `custodian_feed_files`, `custodian_feed_holdings`). APIs: `/api/v1/market-data/*` and `/api/v1/custodian-feed/*`. Screens: a "Market data feed" section on `/ops/securities` and a "Custodian feed" tab on `/ops/reconciliation`. Seed: `prisma/seed-market-data.ts` (registers the sources; called by `seed-demo.ts` and `seed-uat.ts`).

### Market data (GAP-A04)

`INTEGRATION_MARKET_DATA=public|fake|live` (default `fake`, so nothing reaches the internet unless production opts in). Interface `fetchQuotes / fetchHistory / fetchFx / healthCheck` in `integrations/market-data/types.ts`.

- **public** reads free pages. Vetted 2026-10-03, selectors and notes in the one file `public/sources.config.ts`:
  - `ZSE_AFX` (afx.kwayisi.org/zse): ZSE counters in ZWG, list page plus per-counter history. robots.txt allows crawling with `Crawl-delay: 60`, which the fetcher enforces; no restriction on automated reading found. Maps `XXX.ZW` to `XXX`.
  - `ER_API` (open.er-api.com): documented free USD-base endpoint with ZWG, updated daily, attribution "Rates By Exchange Rate API" shown on the screen.
  - Not usable: zse.co.zw and vfex.exchange (market data is a JavaScript app behind the login-only Data Direct portal; no public page), rbz.co.zw and africanfinancials.com (HTTP 403 to automated clients, not worked around). So **VFEX (`.VX`) and OTC securities have no free public source**: they are skipped and reported, and need the paid feed, a file drop or manual prices.
  - Polite by design: host allow-list, https only, `MatanhoNexusBot/1.0 (+mailto:...)` User-Agent, one request per host per interval, response cache, no off-host redirects, size cap and timeout; repeated failures back a source off (after 3 failures, 1 minute doubling to 6 hours).
- **Validation** (`validate.ts`, applied to every provider): plain positive number, valid and not-future date, move vs the previous stored price within 40 percent (FX 25 percent) else rejected, stale after 3 business days (flagged, not rejected). Layout drift (missing table or columns, no valid rows) raises a parse exception instead of writing anything.
- **Writes** go to `security_prices` (source `ZSE_AFX`/`FAKE`) and `fx_rates` (`ER_API`/`FAKE`), the tables Orders, NAV, IBOR and Performance already read. A `MANUAL` price or rate for the same date always wins; the feed value is then recorded as OVERRIDDEN. Existing manual override stays the `Set price` action (`POST /securities/:id/prices`, `portfolio.manage`, audited).
- **Provenance** (`md_provenance`): per accepted price source, page URL, fetched-at and a sha-256 of the raw row; rejected and failed values form the exception list (acknowledge with `portfolio.manage`).
- **Worker**: `marketDataTick()` from `worker.ts`, clock Harare UTC+2, Mon-Fri: FX once after 07:30, intraday every 30 minutes 09:30-14:00, end of day after 15:00 (retried up to 3 times). State is in `md_refresh_runs`. On by default only for `public`; override with `MARKET_DATA_SCHEDULER=on|off`. Scheduled runs allow up to 5 per-counter fallback page fetches; **Refresh now** (`POST /market-data/refresh`, `portfolio.manage`) does not, to stay fast, and honours back-off and the crawl delay.
- **fake**: deterministic generator for tests and demos. **live**: `NotConfigured` stub naming `MARKET_DATA_LIVE_BASE_URL` and `MARKET_DATA_LIVE_API_KEY`.

### Custodian feed (GAP-A05)

`INTEGRATION_CUSTODIAN_FEED=file-drop|fake|live` (default `file-drop`). Interface `listStatements / fetchStatement / fetchHoldings / fetchTransactions`.

- **file-drop**: staff upload CSV, MT940-like or JSON text (`POST /custodian-feed/upload`, `recon.manage`, 1 MB, idempotent). Parsing is strict (any bad row rejects the file with the first problems listed). Trades become `counterparty_executions` (known trade references are skipped), cash and holdings value a `counterparty_day_end_packages` row (an earlier package for the same account and date is superseded), holdings lines go to `custodian_feed_holdings`. Identical content per counterparty is refused (sha-256). Reconciliation matches the loaded rows with no change. Format templates download from the screen (`GET /custodian-feed/templates/:format`); format notes are at the top of `custodian-feed/parsers.ts`.
- **fake**: deterministic statements and a "Generate fake statement" action that goes through the same ingest path. **live**: `NotConfigured` stub naming `CUSTODIAN_FEED_SWIFT_BIC`, `CUSTODIAN_FEED_SWIFT_ENDPOINT`, `CUSTODIAN_FEED_SWIFT_CERT`, `CUSTODIAN_FEED_API_BASE_URL`, `CUSTODIAN_FEED_API_KEY`.

Test: `cd backend/api && npx tsx scripts/test-market-data.ts` (offline, no database or network; parsers run against `backend/api/test-fixtures/market-data`). Typechecked; the API flows and screens were **not run** (no database, no browser).

### Not done

- No free public source for VFEX or OTC prices; the AFX list price is the last traded price stamped with the page date, so a counter that did not trade carries its previous close under today's date (the per-counter history page has the true last-trade date but costs one request per counter).
- FX: stored and read by NAV and the portfolio snapshot through existing `fx_rates`; no new conversion logic was added. Only USD-base pairs plus pairs already in `fx_rates` are refreshed.
- Corporate actions and benchmark series are not fed. Custodian: no MT535/536 or CAMT.053 proper, no SWIFT or API connectivity (stub), no automatic mapping of unmapped accounts (a warning points to the Reconciliation account map).

## R4-1 Admin platform remainders

Migration `20261101100000_ops_health` (tables `worker_heartbeats`, `ops_alerts`; no column added to an existing model).

- **Real SQL paging (GAP-014).** `sqlPage(req, limit)` / `pageEnvelope()` in `middleware/paginate.ts`: `?page=&pageSize=` becomes `skip/take` plus a `count` with the same `where`, and the body carries `total`, so `paginateData` no longer slices in memory. Converted: `/admin-core/rbac/requests`, `/admin-core/settings/history`, `/admin-core/ops-health/*`, cash statement imports and lines, risk breaches/runs/cases, model-governance reviews, recon sign-offs, security price history. Lists whose summary tiles are computed over the loaded rows (cash reservations and expectations, runbook tasks) keep `limit` plus the in-memory envelope.
- **If-Match.** `expectVersion` (header `If-Match` or numeric `body.version`) added to the state-changing handlers that read, then `updateMany where version`, and lacked it: accounting, cash, financing, NAV, capital calls, distributions, dealing, notices, portfolio lab, regulatory filings, research, recon, wiring control, client services status, access change requests, ops alerts. Absent header keeps the old behaviour.
- **Role create and staff invite are maker-checker.** `POST /admin-core/rbac/requests` kinds `ROLE_CREATE` and `STAFF_INVITE` always wait for a different `admin.rbac` holder (step-up on approve); the role or the invitation (email queued) is created at approval, audited as `role.created` / `staff_user.invited`. The legacy `POST /admin/roles` and `POST /admin/users` now answer 409 `approval_required`. RBAC screen: New role (matrix tab), Invite staff member (staff tab); the requests list shows both kinds.
- **SoD list.** `dealing.approve`, `recon.signoff`, `term_sheets.approve`, `onboarding.approve`, `documents.approve`, `notices.publish` joined the blocklist (so granting them needs a checker); new rules `term-sheets-maker-checker` and `rbac-*` for every newer approve, close and lock code.
- **Platform health (GAP-023).** The worker writes a heartbeat (10 s) and runs `ops.health` every minute; `/ops/health` (nav Administration, `admin.settings`) shows workers, outbox backlog by type, dead letters (paged, Retry or Discard with reason, row kept), job lateness and alerts (acknowledge with note). Alerts are `ops_alerts` rows (worker.down, outbox.backlog, outbox.dead, job.stale:*), raised by the worker and by the API when the screen opens; each new alert notifies `admin.settings` holders once (critical also by email, link `/ops/health`). Test: `scripts/test-admin-platform.ts`.
- Remaining: paging for reservations, expectations and tasks needs server-side summary aggregates; service-layer version guards (esign, kyc, company) are not exposed to If-Match.
## Operations and finance controls (R4-2)

Migration `20261102100000_ops_controls` (models between `// ---- OpsControls ----` and `// ---- end OpsControls ----`; no existing column changed). Code: `backend/api/src/modules/opsctl/` (`payrecon.engine.ts` pure matching, `payrecon.service.ts` run, `opsctl.gates.ts`, `opsctl.routes.ts` mounted at `/api/v1/ops-controls`), UI `/ops/payments-recon` (`portals/admin-web/src/ops/payrecon/`). Permissions reuse `operations.view` (read), `recon.manage` (run, work breaks), `recon.signoff` + step-up (approve). Seed: `prisma/seed-opsctl.ts` (one committed bank statement built from the issued calls and distributions). Flow test: `scripts/test-opsctl.ts`.

### Close gates (cash and accounting period close)

`GET /close-gates?portfolioId&periodEnd&type=cash|accounting` and the close endpoints themselves refuse with `409 close_blocked` and itemised blockers. Cash close adds three checklist items to its pre-check: `NAV_RELEASED` (a RELEASED NAV run at the period end; unreleased runs are named), `RECON_SIGNOFF` (CASH signed off for the date, for every counterparty with an account mapped to the portfolio, or an all-counterparty sign-off) and `RECON_MATERIAL` (no open Critical or High break up to the date). Accounting close already had NAV and open breaks; it gains `RECON_SIGNOFF` for TRADES, CASH and HOLDINGS. A portfolio with no mapped custodian account has nothing to sign off. Policy `close_gates` = false switches the new gates off.

### Payments reconciliation

Expected payments: each investor's share of an ISSUED/PARTIALLY_PAID/PAID distribution (money out, dated by `distribution_date`) and capital call (money in, `due_date`), stored as `pay_recon_items` (unique kind + allocation). Actual: lines of COMMITTED statement imports on BANK cash ledgers (the file-drop feed: `POST /cash/statement-imports`), read-only, never edited. Rules: (1) reference (call or distribution ref, or the call's wire reference) on word boundaries, same direction and currency; a shared reference is narrowed by payee (first two significant words), then exact amount, else the line is AMBIGUOUS; a reference match with an amount outside the tolerance (0.01) is an AMOUNT_DIFF; (2) no reference: unique exact amount within 5 days of the due date, both ways. No line: NOT_DUE until due + 2 days, then MISSING_PAYMENT, but only when a committed statement runs past that date (otherwise it is listed under `awaitingStatement`, not a break, BR-065). Second line for a paired payee is a DUPLICATE; wrong direction or currency is raised too (UNPAIRED_LINE). Severity: difference percent (>=20 critical, >5 high, >1 medium), days overdue (>=10 critical, >=3 high).

| Endpoint | Permission | Notes |
|---|---|---|
| `POST /pay-recon/runs` | `recon.manage` | `{fundId?, from, to, tolerance?, graceDays?, dateWindowDays?}`; `Idempotency-Key` required; one run per fund and window, a repeat is a re-run (200) and never duplicates items or breaks; known breaks keep their workflow, paired ones auto-clear |
| `GET /pay-recon/{summary,runs,runs/:id,items,lines,breaks,breaks/:id,funds}` | `operations.view` | `lines` = unpaired statement lines for manual matching |
| `POST /pay-recon/breaks/:id/{assign,investigate,resolve}` | `recon.manage` | resolve: MANUAL_MATCH (line or payment), ACCEPT_DIFFERENCE, TIMING (new date), RETURNED_PAYMENT; rationale 10+ chars and an evidence reference; goes to PENDING_CHECKER |
| `POST /pay-recon/breaks/:id/{approve,reject}` | `recon.signoff` (approve: step-up) | maker cannot approve (403 `segregation_of_duties`); approval applies the resolution to the item |

Tables: `pay_recon_runs`, `pay_recon_items`, `pay_recon_breaks` (unique `item_key` = `ITEM:<kind>:<allocation id>` or `LINE:<line id>`), `pay_recon_break_events`.

### Positions vs custody through the adapter, settlement fails

`POST /ops-controls/custody-positions/pull {asOfDate, counterpartyId?, accountRef?, run?}` (`recon.manage`) reads the custodian's statement holdings through `getCustodianFeedAdapter()` (file-drop, fake or live; live without credentials answers with the usual not-configured error), writes `recon_custody_positions` and a source receipt (hash, version, stored CSV), skips an unchanged file, refuses a signed-off date, and with `run: true` runs POSITIONS_VS_CUSTODY. `GET /ops-controls/settlement-fails?asOf&counterpartyId&portfolioId&status` lists the SETTLEMENT_FAILS breaks with days late, aging buckets, counterparty and security grouping and whether detection is stale; "Refresh detection" in the UI posts a normal `/recon/runs`.

### Not done

Payment items are not tied to a fund bank account (a line is matched by reference, payee and amount across all BANK ledgers); partial payments in several lines are not summed (resolve with a manual match or accept the difference); bank statements are not pulled automatically from the bank-statement adapter (committed file-drop imports only); the existing `test-cash.ts` and `test-accounting.ts` close tests need a released NAV and a CASH sign-off (or policy `close_gates` = false) to reach a successful close.
## R4-3: investee remainders

Migration `20261103100000_investee_remainders` (3 new tables, no change to existing tables). Test: `backend/api/scripts/test-investee-remainders.ts` (needs a disposable DB and a running API; typechecked, not run here). Seed: `prisma/seed-investee-remainders.ts`.

- **Staff screen** `/ops/investee-review` (`research.view` to read, `research.edit` to review): cap table (holders, classes, transactions, certificates with hash re-check), forecast, governance (consents, meetings, actions), reporting sign-off, e-mail deliveries. A review (REVIEWED or QUERIED, a query needs a note and e-mails the company) pins the SHA-256 of the data shown; a stale snapshot is refused and the screen flags "changed since review". Idempotent per reviewer and snapshot. API: `/api/v1/ops/investee-review/*`.
- **Watermark**: share-link downloads are watermarked per recipient: PDFs on every page (diagonal text plus footer), PNG/JPEG placed on a one-page PDF, text with header and footer. Other formats are refused at link creation (415).
- **Reporting sign-off**: after a period is submitted, staff (`POST /ops/investee-review/:companyId/signoffs`) or the company (`POST /investee-portal/reporting/requests/:period/signoff`, `submit_pack`) generate a declaration PDF and open a native e-sign request (subject `INVESTEE_REPORT`) for members with signing authority. The completion hook marks the sign-off SIGNED and notifies staff. One open request per period; a signed period cannot be requested again.
- **E-mail**: share links (optional `recipientEmail`) and company signature requests and reminders go through the outbox event `investee.mail`, which sends via the email adapter and records each delivery in `investee_mail_log` (QUEUED, SENT, FAILED with attempts; one mail per event key).
- **Notifications**: a company consent or submitted request notifies staff holding `research.edit`; staff decisions on consents and requests notify the company users (e-mail included).
- Not done: no company-web button for reporting sign-off (API only); documents in other formats cannot be shared by link; the signed declaration is not yet shown in the company vault view.

## E-signatures depth (R4-4, `/ops/esign`)

Migration `20261104100000_esign_depth` (models between `// ---- EsignDepth ----` markers at the end of `schema.prisma`: `esign_fields`, `esign_batches`). Columns added to the existing `esign_requests`: `reminder_interval_days`, `reminder_max`, `bulk_batch_id` (all nullable; esign-owned). No other existing model changed (only back-relations `fields` on `EsignRequest` / `EsignSigner`).

- **Positioned signature fields**: boxes (signature, initials, date, printed name) per signer on specific pages, stored as page fractions (origin top-left, rounded to 5 decimals). Set at creation (`fields` on `POST /esign/requests`) or on a DRAFT with `PUT /esign/requests/:id/fields`; locked once sent. Every signer needs a signature box once any box exists; boxes may not overlap or leave the page. The layout hash (SHA-256 of the canonical layout keyed by signer e-mail) is written to the CREATED / FIELDS_SET event, and `GET /requests/:id/verify` recomputes it ("Signature field layout"). On completion the boxes are stamped on the original pages (typed or drawn signature, date, initials, name, "signed by" caption) in addition to the appended signature page and certificate, which now prints the field count and layout hash. Original bytes and the signature chain are unchanged. Signers see their own boxes highlighted in the document while the request is open.
- **Field editor**: `/ops/esign` wizard step 3 and the request detail ("Place / Edit signature fields"). No PDF library or CDN: pages are drawn as page-shaped sheets with their true aspect ratio, `GET /esign/source/pages` gives sizes and `GET /esign/source/pages/:n` a single page as its own PDF which the browser's viewer shows behind the boxes. "Preview on the PDF" (`POST /esign/source/preview`) stamps labelled boxes on the real file for an exact check. Click to place, drag to move, drag the corner to resize, arrow keys nudge.
- **Pickers**: flows search by name or reference (`GET /esign/lookup/commitments|allocations|term-sheets`, `/esign/directory`, `/esign/documents`); no raw ids anywhere.
- **New flows** (`/esign/flows/*`): `commitment-pack/:commitmentId` (subscription agreement + investor declarations + payment notice in one PDF, each part with its own boxes, optional staff countersignature on part 1; completion activates a pending commitment like the one-page flow); `term-sheet-countersign/:termSheetId` (term sheet signed by the company, fund countersignature page appended to the term sheet file; the issuer and author are refused; completion moves SIGNED_BY_COMPANY to COUNTERSIGNED with the same audit action as the term sheet module; marking it executed stays the existing separate, different-person step); `staff-approval` (sequential or parallel staff approvers, optional supporting PDF, maker-checker: the requester cannot be an approver; completion audits `esign.staff_approval.approved`). Staff signers sign from "My signatures" at `/ops/esign` (shared inbox component, available even without `esign.view`).
- **Reminder cadence**: per request `reminderIntervalDays` (1-30) and `reminderMax` (0-10), blank = every 3 days up to 3; set at creation, in every flow, or later with `PATCH /requests/:id/reminders` (audited, event `CADENCE_CHANGED`). The worker scan honours each request's cadence; the detail shows the next reminder per signer. Staff approvals default to daily.
- **Bulk send**: `POST /esign/bulk` (up to 100 recipients of any signer kind, one request each, shared box template with `signerEmail` ignored, `idempotencyKey` required: replaying returns the same batch). `GET /esign/batches`, `/batches/:id`, `POST /batches/:id/remind`. Per-recipient failures are recorded on the batch.
- **Verification**: staff verify report adds the field layout check and (native sealing) that the sealed PDF embeds the reference, original hash and chain head; the public verifier (`/sign/verify`) now returns the recomputed checks, signer identity method, field count and hashes.
- **Permissions**: unchanged (`esign.view`, `esign.manage`, `esign.void`).

Seed: `seedEsignDepth()` in `prisma/seed-esign.ts` (idempotent, also runs on databases that already have e-sign data): placed-field request with a 2-day / 5-reminder cadence, a 3-recipient bulk batch, a staff approval, a subscription pack for a PENDING commitment and a term sheet countersignature when the data and a second staff user exist.

Test: `npx tsx scripts/test-esign-depth.ts` (field validation, layout hash, cadence, pack layout and page offsets, real PDF stamping; no database or SMTP). API flows and pages were typechecked but **not run** (no database, no browser).

### Not done (R4-4)

- The editor's backdrop is the browser's PDF viewer (it may add a thin margin); no raster renderer or pdf.js is bundled, so use "Preview on the PDF" for an exact check. Rotated source pages are stamped in unrotated page space.
- Boxes are not editable after sending (void and re-send instead). Signers cannot move or add boxes. No per-field text input (free text fields).
- Pack text is generic legal boilerplate and must be replaced by counsel-approved wording before production use.
- Bulk send runs the recipients one after another inside the request (100 at most); no background job or CSV import.
## Onboarding portal, native (R4-6)

The public onboarding portal (`portals/onboarding-web`) is now native React; the legacy injected-script page (`legacy-runtime`, `public/live/onboarding-live.js`) is removed from it.

- Routes: `/` six-step wizard (entity types, UBOs, directors, signatories, KYC/AML declarations, tax + bank, evidence, review/submit), `/resume` magic-link exchange and request, `/status` tracker with the admin loop-back (upload requested documents, reply). Legacy `/?resume=<id>.<token>` links still work.
- API (all under `/api/v1/public`): existing `applications` endpoints plus `directors` on PATCH/submit/GET, `scanStatus` on evidence; new `GET /onboarding/meta`, `POST /onboarding/resume-link` (always 202, rate limited), `POST /onboarding/resume` (single use, rotates the draft token), `GET /applications/:id/status`, `POST /applications/:id/reply` (idempotent).
- Uploads go through `storeFile`, which calls the av-scan adapter; infected files are refused 422 and audited (`kyc.evidence.rejected_malware`). Magic-link and loop-back emails go through the outbox/email adapter.
- Admin side is unchanged: `POST /kyc/cases/:id/request-evidence` moves the case to Client action; the applicant's upload returns it to Compliance review.
- Migration `20261106100000_onboarding_resume` (table `onboarding_resume_links`). Seed: `prisma/seed-onboarding.ts`. Test: `npx tsx scripts/test-onboarding.ts` (flow part with `E2E_CONFIRM=throwaway-db`).
- Remaining: no browser run was done; OCR assist from the prototype is not ported; admin case view does not yet render `directors` beyond the staff form view JSON.
## R4-7: custodian portal native

No migration and no new columns: the portal sits on the WP-7 tables. `portals/custodian-web` is now native React (portal-kit sign-in, `proxy.ts` gate requiring a custodian role, `REQUIRE_AUTH_PORTALS`); the injected `custodian-live.js`, the legacy markup and the `@matanho/legacy-runtime` dependency are gone from this portal (the package stays for admin and onboarding; `tools/extract-legacy.mjs` and `tools/legacy-bridge.mjs` no longer list custodian). Pages: Dashboard, Executions (new, amend, cancel, per-execution history), Bulk upload (dry-run validation with row errors and declared control totals), Day-end (draft, control totals prefilled from executions received, submit, approve by a different user, supersede with reason, declared-versus-received controls, timeline), Statements and holdings, Status history, Users and roles, Notifications (existing `/api/v1/notifications`).

API additions in `custodian.native.ts` (all under `/api/v1/custodian`, scoped to the user's counterparty): `GET /dashboard`, `GET /control-totals?date=`, `GET /day-end/:id/controls`, `POST /statements/validate`, `POST /statements` (JSON `{filename, content, format?}`, permission `custodian.dayend.submit`), `GET /statements`, `GET /statements/files/:id`, `GET /statements/template/:format`, `GET /holdings`, `GET /users`, `POST /users/invite`, `PATCH /users/:userId`.

- **Statements via the adapter layer.** Upload goes through the custodian-feed ingest path (file-drop or fake; live returns 503 `integration_not_configured`). The file is parsed strictly and checked for account scope, future dates, currencies and days already covered by an Approved or Accepted package. Trades become executions, cash and holdings value a Received day-end package, holdings lines go to `custodian_feed_holdings`. The package fingerprint is then set to the portal's canonical hash so a second counterparty user can approve it. Identical content is refused (409 `duplicate_file`); the listing also calls the adapter's `listStatements`.
- **Users.** Listing is open to the counterparty; invite and change need the approver role (link and permission). Role changes also swap the `custodian` portal role; deactivation cuts access at once; own access cannot be changed; a reason is mandatory and audited (`custodian.user.invited`, `custodian.user.updated`). Invitations reuse the shared invitation flow and grant.
- **Idempotency and audit.** Every write takes an `Idempotency-Key` (the UI keeps one key per intent and renews it after success); statement upload, invite and user change are audited and notify approvers or the user.
- Test: `backend/api/scripts/test-custodian-native.ts` (disposable DB, running API). Browser smoke: `tools/uat/e2e/custodian.spec.ts`.

### Not done

- The statement upload runs the ingest and the follow-up audit, package fingerprint and notification writes in separate transactions (the ingest has its own); a crash between them leaves a package with the ingest fingerprint, which only blocks its approval until re-uploaded or superseded.
- Pending invitations are not listed or revocable from the portal; notification preferences stay staff-only; no live SWIFT or API statement pull.
## R4-8 AI and reporting depth

- Copilot: LlmAdapter plan/compose run cited, permission-gated tool calls (positions, orders, NAV, breaks, risk, cash, approvals, audit, accounting); keyword router remains the fallback (engine ROUTER). Tool calls and engine are stored per query.
- Onboarding: advisory AI triage panel in the case review (POST/GET /client-ops/onboarding/cases/:id/triage, onboarding.manage to run); idempotent on unchanged facts, audited, never changes the case.
- Reports: email can attach the stored file (8 MB cap); schedules can mail attachments and publish each run to LP portal Documents (switched on by a different reports.approve holder with step-up, never the creator).
- Regulatory: submit goes through the regulator-filing adapter; each acknowledgement receipt is stored (reg_filing_submissions) and shown on the filing.
- Gaps: live LLM and live regulator adapters are NotConfigured stubs; the fake regulator can only reject an empty payload hash (blocked earlier by the integrity gate).
