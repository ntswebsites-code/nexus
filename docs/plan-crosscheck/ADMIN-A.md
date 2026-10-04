# ADMIN-A cross-check: FR-CASH, REC, OPS, OMS, RSK, IBOR, PORT, PERF, VAL, PM, RES, FIN

Scope: the 112 IDs that appear in docs/srd/REGISTER.md for these groups (SRD.md-only IDs such as FR-CASH-001..008, FR-OMS-001..005 are not counted). Status judged from code on feat/admin-recon-nav, not from docs (ADMIN-REAL-PAGES "Not done" lists are partly stale: recon query/escalate/reopen/tolerances, order-cash reservation and trading-feeds exist).

Counts: BUILT 66, PARTIAL 31, MISSING 15, ADAPTER 0, N/A 0.
Per group (B/P/M): CASH 6/5/0, FIN 0/2/1, IBOR 5/2/1, OMS 7/5/1, OPS 6/3/2, PERF 4/0/3, PM 3/1/1, PORT 2/5/0, REC 15/2/0, RES 1/2/2, RSK 9/0/2, VAL 8/4/2.

Status per row below: P = PARTIAL, M = MISSING.

| id | st | requirement (short) | what exists | what is missing | evidence |
|---|---|---|---|---|---|
| FR-CASH-009 | P | Context bar by client, portfolio, account, currency + As of | portfolio, currency, asOf filters | client and cash-account selectors | backend/api/src/modules/cash/cash.routes.ts (balQuery); portals/admin-web/src/app/(ops)/ops/cash/page.tsx |
| FR-CASH-010 | P | Explain shows journals, reservations, holds, policy lines | /balances/explain per ledger | holds, pending-withdrawal, reusable proceeds not modelled; policy lines unverified | cash/cash.service.ts explainLedger |
| FR-CASH-017 | P | CAMT.053 + CSV import | CSV and JSON parse, duplicate hash, tolerance, maker-checker commit | no CAMT.053 parser (only mentioned in the fake bank-statement adapter) | cash/cash.engine.ts parseStatement; integrations/bank-statement |
| FR-CASH-018 | P | Close with blockers incl. sub-ledger-to-GL | gates: coverage, variance, suspense, aged items, unposted journals, checker, NAV/recon | sub-ledger-to-GL tie-out | cash/cash.service.ts ~L464 |
| FR-CASH-019 | P | Filters, search, sort, empty state, aria-selected tabs | empty states, filters | no role=tab / aria-selected found; sort unverified | ops/cash/page.tsx |
| FR-FIN-002 | P | Funding a margin call creates cash expectation | resolve needs coverage restored, audited | no cash expectation/journal on funding | financing/fin.routes.ts ~L476 |
| FR-FIN-004 | P | Disposition needs financing.manage, reason, independent checker | manage + reason + step-up | no independent checker on resolve (only waive has one); no counterparty evidence / house calc | financing/fin.routes.ts |
| FR-FIN-005 | M | Margin statement import with control totals | none | whole feature | no import route in modules/financing |
| FR-IBOR-002 | P | Server-side search/filter/sort/paging for 50k book | q, assetClass, state, limit, offset | in-memory filter then slice (not SQL paging); search omits ISIN; sort unverified | ibor/ibor.routes.ts L56-66 |
| FR-IBOR-004 | P | Refresh IBOR as async job with status | POST /refresh with in-progress lock | synchronous; no queued/running/failed job status | ibor/ibor.routes.ts L165 |
| FR-IBOR-007 | M | Column chooser persisted per user | none | whole feature | ops/ibor/page.tsx |
| FR-OMS-010 | M | Import orders CSV/JSON with preview | none | whole feature | modules/orders |
| FR-OMS-011 | P | Post-trade allocation, contract-note match, slippage | /settle, fills, trading-feeds contract-note ingest | allocation UI and slippage unverified; PDF notes not parsed; no auto-routing via adapter | modules/trading-feeds; orders/orders.settle.ts |
| FR-OMS-012 / 020 | P | Blotter filters (status, portfolio, security, date), sort, CSV export | API takes from/to/securityId; UI has status + portfolio | no CSV export; no security/date UI filters found | ops/orders/page.tsx |
| FR-OMS-018 | P | Lot multiple, price +-10% unless override reason, stop price for Stop limit | board-lot field error; price is a Review check | no inline price error/override reason; no STOP_LIMIT order type | orders/orders.checks.ts; orders.routes.ts |
| FR-OMS-019 | P | Saved drafts restorable ("Resume draft") | drafts persist, open from blotter | no resume prompt on the ticket | ops/orders/new/page.tsx |
| FR-OPS-010 | P | Dependency + hand-off notification | dependsOn, auto BLOCKED | no notify-next-owner on complete found | wiring/tasks.ts; wiring/control.routes.ts |
| FR-OPS-011 | P | Calendar + CSV/XLSX export | calendar card, CSV | no XLSX | wiring/control.routes.ts L141; ops/opsinsights.tsx |
| FR-OPS-012 | M | operations.task.manage permission | any operations.view role can create/complete | permission code absent; auditor not read-only | wiring/control.routes.ts L29; prisma/seed/role-catalog.json |
| FR-OPS-013 | M | Chart tooltips + click-through to filtered tasks | workload and calendar cards | no click-through handlers | ops/opsinsights.tsx |
| FR-OPS-015 | P | CA vocabulary Announced..Reconciled (7 states) | ANNOUNCED, CONFIRMED, PROCESSED, REVERSED, CANCELLED | projected/election/instructed/reconciled states | corporate-actions/ca.engine.ts L14 |
| FR-PERF-005 | M | Export attribution CSV/XLSX + audit | none | whole feature | modules/performance; ops/performance |
| FR-PERF-006 | M | Chart event markers (cash flow, rebalance, IC) | none | whole feature | ops/performance |
| FR-PERF-007 | M | Chart keyboard operation | none | whole feature | ops/performance |
| FR-PM-002 | P | Drawers: investment, diligence case, cashflow scenario persist | funds, commitments, cashflows, marks | no pipeline / diligence case / scenario records | private-markets/pm.routes.ts |
| FR-PM-003 | M | Export look-through CSV | none | whole feature | modules/private-markets |
| FR-PORT-009 | P | List with strategy, risk, manager filters + saved views | q, type, currency, status, manager | no strategy/risk fields; no saved views | portfolio/portfolio.routes.ts; schema Portfolio |
| FR-PORT-010 | P | KPI summary (AUM, weighted TWR, open breaches) | per-row market value | summary KPIs not found | ops/portfolios/page.tsx |
| FR-PORT-011 | P | Create needs permission; evidence file to vault | portfolio.manage create | no evidence upload; wizard fields limited | portfolio/portfolio.routes.ts |
| FR-PORT-013 | P | KPIs from optimiser job with as-of | synchronous what-if / rebalance proposal | no optimiser job | portfolio-lab/lab.engine.ts |
| FR-PORT-015 | P | Save/list/delete scenarios (owner) | models CRUD, clone, retire | retire not delete; owner-only unverified | portfolio-lab/lab.routes.ts |
| FR-REC-006 | P | Assign, evidence, accept candidate, query, escalate, return | all except candidate | "Accept candidate match" not found | recon/recon.ext.routes.ts |
| FR-REC-017 | P | Manual import and connector share counterpart_imports pipeline | ReconSourceReceipt with sha256, custody feeds, custodian-feed adapter (live = stub) | no counterpart_imports batch table; live broker/counterparty connector is a NotConfigured stub | prisma ReconSourceReceipt; integrations/custodian-feed |
| FR-RES-006 | P | Issuer universe, prices, financials, filings with as-of/source | securities + prices with source | no financials or filings | portfolio/portfolio.routes.ts |
| FR-RES-007 | M | Valuation model with ranges, versions, target | case target price only | model inputs, version history | research/research.routes.ts |
| FR-RES-008 | P | Notes, catalysts, risks as entries | case thesis/risks text, rating history | timestamped note list, catalyst records | schema ResearchCase |
| FR-RES-009 | M | Import filing to vault | none | whole feature | modules/research |
| FR-RSK-012 | M | Import positions/limits files | none | whole feature | risk/risk.routes.ts |
| FR-RSK-013 | M | Compliance report print/download | none | whole feature | ops/risk |
| FR-VAL-009 | P | Gate by valuation.run / .maker / .release | view + release; checker != maker | no run/maker permission codes | nav/nav.routes.ts L35-45 |
| FR-VAL-011 | P | Exception evidence document; material override to independent approver | rationale + evidenceRef string | document link; override approver | nav/nav.routes.ts L82 |
| FR-VAL-014 | P | Link exception to recon break and ops task | recon gate blocks release | link; resolving does not update break/task | nav/nav.routes.ts L333 |
| FR-VAL-015 | M | NAV history + valuation policy panels | runs list only | history drawer, policy panel (unverified in UI) | ops/nav |
| FR-VAL-016 | P | Generated evidence documents | JSON pack | generated documents/PDF | nav/nav.routes.ts L154 |
| FR-VAL-017 | M | Variance = external NAV - ABOR, Agree within tolerance | none | no external NAV / ABOR comparison | modules/accounting; modules/nav |
