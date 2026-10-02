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

(to be written by the Risk engineer)
