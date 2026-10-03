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
