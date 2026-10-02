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

(to be written by the Orders engineer)

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
