# STATE MACHINES (from the 5B draft)

##### A. Target state machines for Nexus [P] (what to build; the as-implemented machines of the reference backend follow in sections B and C)

Actors: **LP** = signed-in LP user with the stated minimum role (VIEWER < SIGNATORY < MANAGER); **Staff** = Nexus admin-portal user with the stated permission; **System** = worker, cron or derived on read.

**A1. Capital call (header and investor allocation)**

`mermaid
stateDiagram-v2
 [*] --> DRAFT: Staff creates call (clients.edit)
 DRAFT --> PENDING_APPROVAL: Staff submits
 PENDING_APPROVAL --> APPROVED: Staff approves (cash.approve, step-up, checker differs from maker)
 PENDING_APPROVAL --> DRAFT: Staff returns with reason
 APPROVED --> ISSUED: Staff issues (notice published, LP notified)
 DRAFT --> CANCELLED: Staff cancels
 APPROVED --> CANCELLED: Staff cancels
 ISSUED --> CANCELLED: Staff cancels (before any payment)
 ISSUED --> PARTIALLY_PAID: Staff records receipt below the call amount
 PARTIALLY_PAID --> PARTIALLY_PAID: Staff records another receipt
 ISSUED --> PAID: Staff records receipt equal to the call amount
 PARTIALLY_PAID --> PAID: Staff records the remaining receipt
 PAID --> [*]
 CANCELLED --> [*]
`

Investor-facing derived status per allocation (computed on read, precedence CANCELLED, PAID, PARTIALLY_PAID, OVERDUE, ACKNOWLEDGED, ISSUED); acknowledgement is a flag, not a status:

`mermaid
stateDiagram-v2
 [*] --> ISSUED: issued, paid = 0, not past due
 ISSUED --> ACKNOWLEDGED: LP SIGNATORY acknowledges (flag acknowledged_at)
 ISSUED --> OVERDUE: System, due date passed and unpaid
 ACKNOWLEDGED --> OVERDUE: System, due date passed and unpaid
 ISSUED --> PARTIALLY_PAID: receipt recorded
 ACKNOWLEDGED --> PARTIALLY_PAID: receipt recorded
 OVERDUE --> PARTIALLY_PAID: receipt recorded
 ISSUED --> PAID: full receipt
 ACKNOWLEDGED --> PAID: full receipt
 OVERDUE --> PAID: full receipt
 PARTIALLY_PAID --> PAID: remaining receipt
`

| Transition | Trigger | Actor and permission | Guards | Side effects |
| --- | --- | --- | --- | --- |
| DRAFT to ISSUED (via PENDING_APPROVAL, APPROVED) | staff create, submit, approve, issue | Staff `clients.edit`, then `cash.approve` + step-up (checker differs from maker), then issue permission | allocation total equals the call total; every investor has an active commitment with uncalled capital; single currency per fund | one allocation per investor; journal posted at issue; notice document generated and linked; notification `capital.published`; LP event; audit |
| ISSUED to ACKNOWLEDGED (flag) | `POST /capital-calls/:id/acknowledge` | LP SIGNATORY or MANAGER (`lp.capital_calls.acknowledge`) | allocation belongs to the client and fund scope; call issued and not cancelled; not already acknowledged | `acknowledged_at`, `acknowledged_by`; audit; never touches `paid` |
| Payment confirmation upload | `POST /capital-calls/:id/payment-confirmations` | LP SIGNATORY or MANAGER (`lp.capital_calls.upload_payment_confirmation`) | file present, type and size allowed, scanned | confirmation row with SHA-256; staff queue item; notification to `cash.approve` holders; audit; no change to `paid` |
| Receipt recorded | staff records or matches a receipt per allocation | Staff `cash.approve` or `cash.journal.approve` + step-up (matcher differs from the confirming user) | amount > 0 and at most the remaining balance; rounding half-up | `amount_paid`, allocation status, header status; journal; LP event and notification |
| To CANCELLED | staff cancels | Staff `cash.approve` | no receipts recorded (otherwise reverse first) | LP notice of cancellation; allocation hidden from lists |
| ISSUED to OVERDUE | derived on read | System | due date before today (UTC) and paid below amount | none persisted; optional reminder notification |

**A2. Distribution**

`mermaid
stateDiagram-v2
 [*] --> DRAFT: Staff declares (clients.edit)
 DRAFT --> APPROVED: Staff approves (cash.approve, step-up, checker differs)
 APPROVED --> ISSUED: Staff announces (notice and statement published)
 ISSUED --> PARTIALLY_PAID: payout recorded below the share
 PARTIALLY_PAID --> PARTIALLY_PAID: further payout
 ISSUED --> PAID: payout equals the share
 PARTIALLY_PAID --> PAID: remaining payout
 DRAFT --> CANCELLED
 APPROVED --> CANCELLED
 PAID --> [*]
`

Guards: gross greater than 0; net to investors greater than 0; split sums to net; payout at most the remaining share. Visible to LPs from ISSUED. Actors as in A1.

**A3. Dealing request (subscription and redemption)**

`mermaid
stateDiagram-v2
 [*] --> SUBMITTED: LP SIGNATORY submits with a valid estimate snapshot
 SUBMITTED --> COMPLIANCE_REVIEW: Staff starts review
 COMPLIANCE_REVIEW --> AWAITING_FUNDS: Staff clears (subscription)
 COMPLIANCE_REVIEW --> UNDER_REVIEW: Staff clears (redemption)
 AWAITING_FUNDS --> FUNDS_RECEIVED: Staff matches funds
 FUNDS_RECEIVED --> AWAITING_NAV: Staff confirms
 UNDER_REVIEW --> AWAITING_NAV: Staff approves
 AWAITING_NAV --> ALLOCATED: Staff allocates at the approved dealing NAV (checker differs)
 ALLOCATED --> SETTLED: Staff records settlement (redemption)
 SUBMITTED --> REJECTED
 COMPLIANCE_REVIEW --> REJECTED
 AWAITING_FUNDS --> REJECTED
 UNDER_REVIEW --> REJECTED
 SUBMITTED --> CANCELLED: LP or Staff cancels before review
 AWAITING_FUNDS --> CANCELLED
 REJECTED --> [*]
 CANCELLED --> [*]
 SETTLED --> [*]
`

| Transition | Trigger | Actor and permission | Guards | Side effects |
| --- | --- | --- | --- | --- |
| Estimate to snapshot | `POST /dealing/{subscriptions,redemptions}/estimate` | any LP role (`lp.dealing.estimate`) | fund in scope; no hold; not suspended; units and minimum balance; notice date | snapshot row, 15-minute expiry; nothing committed |
| To SUBMITTED | `POST /dealing/{subscriptions,redemptions}` + `Idempotency-Key` | LP SIGNATORY or MANAGER (`lp.dealing.subscribe`, `lp.dealing.redeem`) | snapshot valid, unexpired, same client, type, fund and canonical payload; all rules re-checked; bank account active | request row with units and dates from the snapshot, snapshot consumed, files stored, audit with payload hash, staff queue |
| Review, funds, NAV, allocation, settlement | staff actions in the dealing desk | Staff with a dealing permission; allocator differs from reviewer | per transition above | ledger entries, holding update (units, account value), investor notification and dashboard action |

**A4. Service request**

`mermaid
stateDiagram-v2
 [*] --> SUBMITTED: LP SIGNATORY creates
 SUBMITTED --> ASSIGNED: Staff assigns
 ASSIGNED --> UNDER_REVIEW: Staff starts
 UNDER_REVIEW --> AWAITING_INVESTOR: Staff asks the investor
 AWAITING_INVESTOR --> UNDER_REVIEW: LP replies
 UNDER_REVIEW --> AWAITING_INTERNAL: Staff waits for another team
 AWAITING_INTERNAL --> UNDER_REVIEW
 UNDER_REVIEW --> RESOLVED: Staff resolves
 RESOLVED --> CLOSED: Staff closes (or auto after 7 days)
 RESOLVED --> UNDER_REVIEW: LP replies (reopen)
 CLOSED --> UNDER_REVIEW: LP replies within 30 days
`

Guards: staff transitions are explicit sub-resources with the permission `clients.edit`; any reply by the investor on AWAITING_INVESTOR moves the request to UNDER_REVIEW; SLA due date set at creation (priority HIGH 8 h, others 48 h). Side effects: realtime event `lp_request_updated`, notification and e-mail to the investor, audit.

**A5. Message thread**

`mermaid
stateDiagram-v2
 [*] --> OPEN: Staff or LP SIGNATORY creates (linked record optional)
 OPEN --> OPEN: either side replies (lastMessageAt updated)
 OPEN --> CLOSED: Staff closes
 CLOSED --> OPEN: LP SIGNATORY replies
`

Read state per user and message; `lp_thread_read` is emitted when a user marks a thread read.

**A6. Notice**

`mermaid
stateDiagram-v2
 [*] --> DRAFT: Staff composes
 DRAFT --> PUBLISHED: Staff publishes (approver permission), receipts created
 PUBLISHED --> RECALLED: Staff recalls
 PUBLISHED --> EXPIRED: System at expiry date
`

Per-recipient receipt: DELIVERED, then OPENED (first detail read), then ACKNOWLEDGED (SIGNATORY or MANAGER; first timestamp kept).

**A7. Colleague membership**

`mermaid
stateDiagram-v2
 [*] --> INVITED: LP MANAGER (or Staff) invites with role and fund subset
 INVITED --> ACTIVE: invitee accepts the one-time link and sets a password
 INVITED --> EXPIRED: 7 days pass
 EXPIRED --> INVITED: resend
 ACTIVE --> ACTIVE: role or fund scope changed (last-manager guard)
 ACTIVE --> SUSPENDED: LP MANAGER or Staff revokes (sessions invalidated)
 SUSPENDED --> INVITED: re-invite
`

**A8. Bank-instruction change**

`mermaid
stateDiagram-v2
 [*] --> SUBMITTED: LP SIGNATORY or MANAGER submits (MFA, idempotent)
 SUBMITTED --> UNDER_VERIFICATION: Staff starts verification
 UNDER_VERIFICATION --> APPROVED: Staff approves after callback (checker differs from verifier)
 UNDER_VERIFICATION --> REJECTED: Staff rejects with reason
 SUBMITTED --> REJECTED
 APPROVED --> ACTIVATED: effective date reached; previous instruction ARCHIVED
 REJECTED --> [*]
 ACTIVATED --> [*]
`

Until ACTIVATED the previous instruction stays active for every dealing and payout; the investor always sees the account number masked.

##### B. As implemented in the reference backend (capital, dealing, performance)

Note on actors: "LP SIGNATORY" = lpRole SIGNATORY or MANAGER (VIEWER cannot write). "Staff" = authenticated user hitting `/api/funds/...` (route has `authenticate` only; NO role/permission guard found in the route files, and controllers only require a user id) — flagged as unknown/gap, not a confirmed permission.

**B.1 Capital call (header) and LP allocation**


`mermaid
stateDiagram-v2
 [*] --> INITIATED: staff POST /funds/:fundId/capital-calls
 INITIATED --> NOTICES_SENT: staff POST send-notices (all emails ok)
 INITIATED --> PARTIALLY_PAID: staff records payment (before notices)
 INITIATED --> FULLY_PAID: all allocations fully paid before notices
 NOTICES_SENT --> PARTIALLY_PAID: staff records payment
 NOTICES_SENT --> FULLY_PAID: last allocation fully paid
 PARTIALLY_PAID --> PARTIALLY_PAID: further payment
 PARTIALLY_PAID --> FULLY_PAID: all allocations PAID
 FULLY_PAID --> [*]
 note right of INITIATED: not visible to LP (no noticesSentAt, not in visible set)
 note right of FULLY_PAID: visible to LP only if noticesSentAt is set
mermaid
stateDiagram-v2
 [*] --> PENDING: allocation created at initiate (amountPaid 0)
 PENDING --> PARTIALLY_PAID: staff payment 0 < paid < currentCallAmount
 PENDING --> PAID: staff payment equals currentCallAmount
 PARTIALLY_PAID --> PARTIALLY_PAID: further payment
 PARTIALLY_PAID --> PAID: remaining paid
 PAID --> [*]
`

Portal-derived investor status (computed on read, not stored) — precedence CANCELLED > PAID > PARTIALLY_PAID > ACKNOWLEDGED > OVERDUE > ISSUED :

`mermaid
stateDiagram-v2
 [*] --> ISSUED: visible call, paid = 0, not acknowledged, not past due
 ISSUED --> ACKNOWLEDGED: LP signatory acknowledge
 ISSUED --> OVERDUE: due date passes (UTC date compare), unpaid, not acknowledged
 ISSUED --> PARTIALLY_PAID: staff records partial payment
 ACKNOWLEDGED --> PARTIALLY_PAID: staff records partial payment
 OVERDUE --> PARTIALLY_PAID: staff records partial payment
 ISSUED --> PAID: staff records full payment
 ACKNOWLEDGED --> PAID: full payment
 OVERDUE --> PAID: full payment
 PARTIALLY_PAID --> PAID: remaining paid
 ISSUED --> CANCELLED: header CANCELLED (no writer found in code)
 PAID --> [*]
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> INITIATED (header) / PENDING (allocations) | UI(staff) `POST /api/funds/:fundId/capital-calls` body `{callPercent, paymentDueDate, bankInstructions, transactionDate}` | staff; `authenticate` only (no role check found) | `bankInstructions` non-empty (400 "bankInstructions is required"); dates parse; `0<callPercent<=100`; fund exists; >=1 eligible commitment (ACTIVE/PENDING) else "No eligible investment commitments..."; single currency else error; >=1 callable balance else "No callable balances — all commitments are fully drawn or call percent yields zero."; COA 1210 and 3010 active | In one transaction: journal entry POSTED (Dr 1210 Capital Contributions Receivable / Cr 3010 Partners Capital Uncalled, ref `CCALL-<fund6>-<ts>`), `CapitalCall` + `CapitalCallAllocation`s; then `FundService.recordPerformanceSnapshot(fundId)` (best-effort). No LP notification, no realtime, no LP snapshot refresh. Response 201 "Capital call initiated; journal entry posted (Dr 1210 / Cr 3010)." |
| INITIATED -> NOTICES_SENT | staff `POST /api/funds/:fundId/capital-calls/:capitalCallId/send-notices` | staff | at least one allocation with a valid client email else error; ALL sends must succeed or error with failure report and NO status change | Per-LP HTML email + PDF notice (subject "Capital Call Notice, {fund}, {date}"); sets `noticesSentAt=now`, status NOTICES_SENT only if currently INITIATED => call becomes LP-visible (C1). Re-sending allowed (updates noticesSentAt, keeps status) |
| NOTICES_SENT/INITIATED/PARTIALLY_PAID -> PARTIALLY_PAID / FULLY_PAID (header) and allocation PENDING/PARTIALLY_PAID -> PARTIALLY_PAID/PAID | staff `POST /api/funds/:fundId/capital-calls/:capitalCallId/allocations/:allocationId/payments` body `{amount, transactionDate?, cashChartOfAccountId?}` | staff | allocation found; `amount>0`; remaining>0 else "This allocation is already fully paid."; `amount<=remaining` else "Payment exceeds remaining balance (x)."; cash GL resolvable | Transaction: insert `CapitalCallAllocationPayment`; update allocation `amountPaid=round2(paid+amt)`, status; recompute header (all PAID->FULLY_PAID; any activity->PARTIALLY_PAID; else NOTICES_SENT/INITIATED); journal POSTED Dr cash-bank / Cr 1210, ref `CCALLPAY-<alloc8>-<ts>`. Then `recordPerformanceSnapshot` (fund). No LP notification/realtime; portal status flips on next read |
| ISSUED/OVERDUE -> ACKNOWLEDGED (portal) | UI(LP) `POST /api/lp-portal/capital-calls/:id/acknowledge`, header `Idempotency-Key` | LP SIGNATORY/MANAGER, `lp.capital_calls.acknowledge` | active client; owns allocation & fund in scope; call visible; not CANCELLED; not already acknowledged | Upsert `LpCapitalCallPortalState{acknowledgedAt, acknowledgedById}`; returns `{acknowledgedAt}`; no change to amounts/status; no audit/realtime |
| ISSUED -> OVERDUE (portal) | system (derived on read; no cron) | n/a | `dueDate < todayUTC` and `paid<amount` and not acknowledged and paid==0 (an acknowledged call stays ACKNOWLEDGED) | none persisted; no notification |
| any -> PARTIALLY_PAID / PAID (portal) | derived from `amountPaid` | n/a | `paid>0` / `paid>=amount` | none |
| upload payment confirmation | UI(LP) `POST /api/lp-portal/capital-calls/:id/payment-confirmations` multipart `file`(<=25MB), `amountClaimed?`, `notes?` | LP SIGNATORY/MANAGER, `lp.capital_calls.upload_payment_confirmation`, Idempotency-Key | file present; allocation visible & owned | Row in `lp_capital_call_payment_confirmations` + file on disk + sha256; NO state change, no staff queue/notification (not found in code) |
| -> CANCELLED / DRAFT / ISSUED / ACTIVE / PAID / CLOSED (header) | not found in code (no staff writer) | - | - | - |

**B.2 Distribution (header) and LP allocation**


`mermaid
stateDiagram-v2
 [*] --> DECLARED: staff POST /funds/:fundId/distributions
 DECLARED --> NOTICES_SENT: staff send-notices (no failures)
 DECLARED --> PARTIALLY_PAID: payout recorded
 NOTICES_SENT --> PARTIALLY_PAID: payout recorded
 PARTIALLY_PAID --> PARTIALLY_PAID: more payout
 PARTIALLY_PAID --> PAID: all allocations PAID
 NOTICES_SENT --> PAID: single payout completes all
 PAID --> [*]
`
Allocation: `PENDING -> PARTIALLY_PAID -> PAID`. LP sees the ALLOCATION status from DECLARED onward (D2).

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> DECLARED (allocations PENDING) | staff `POST /api/funds/:fundId/distributions` body `{distributionDate, source, grossAmount, sourceCompanyId?, sourceDividendId?, carryRateOverride?, currencyCode?, notes?}` | staff, `authenticate` only | source in allowed set else "source must be one of:..."; `gross>0`; dividend/company belong to fund and `gross<=dividend.amount`; >=1 eligible commitment; single currency (and request currency must match); carry in [0,1]; `netToLPs>0`; COA 2400, 4020 and source-income account exist (income account falls back to 4100) | Journal POSTED (Dr source income/equity account = gross; Cr 2400 = net; Cr 4020 = carry) ref `DIST-<fund6>-<ts>`; header+allocations (pro-rata by paid-in; commitment if none paid); response 201 "Distribution declared successfully." No LP notification/realtime/snapshot refresh |
| DECLARED -> NOTICES_SENT | staff `POST /api/funds/:fundId/distributions/:distributionId/send-notices` | staff | >=1 valid email; failed sends reported but only block the status change when failures>0 — note sends are best-effort per LP, status changes only if zero failures | HTML email "Distribution Notice — {fund}" (no PDF); `noticesSentAt`, status NOTICES_SENT |
| -> PARTIALLY_PAID / PAID | staff `POST /api/funds/:fundId/distributions/:distributionId/allocations/:allocationId/payouts` body `{amount, transactionDate?, cashChartOfAccountId?}` | staff | `amount>0`; `<=` remaining ("Payout exceeds remaining balance (x)."); "This allocation is already fully paid out." | Insert `DistributionAllocationPayment`; update allocation; recompute header (all PAID -> PAID); journal POSTED Dr 2400 / Cr cash, ref `DISTPAY-...`. LP sees `netPaid` grow |
| -> CANCELLED / DRAFT | not found in code (filters exist in the metrics, ledger and performance readers) but no writer | - | - | - |

**B.3 Dealing request (subscription / redemption)**


`mermaid
stateDiagram-v2
 [*] --> SUBMITTED: LP SIGNATORY creates subscription or redemption (valid estimate snapshot)
 SUBMITTED --> COMPLIANCE_REVIEW: staff (not found in code)
 COMPLIANCE_REVIEW --> AWAITING_FUNDS: staff (not found in code)
 AWAITING_FUNDS --> FUNDS_RECEIVED: staff (the design SRD only)
 FUNDS_RECEIVED --> AWAITING_NAV: staff (the design SRD only)
 AWAITING_NAV --> ALLOCATED: staff (the design SRD only)
 SUBMITTED --> REJECTED: staff (the design SRD only)
 SUBMITTED --> CANCELLED: the design SRD only
`
Only `[*] -> SUBMITTED` exists in code; the remaining arrows are the the design SRD §12 vocabulary and the statuses that code READS. `UNDER_REVIEW` is read by code but is not in the the design SRD vocabulary.

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> estimate snapshot | UI(LP) `POST /api/lp-portal/dealing/subscriptions/estimate` or `/redemptions/estimate` | any LP role with `lp.dealing.estimate` (VIEWER+), no idempotency key | active client; fund in scope; no compliance hold; dealing not suspended; amount/units valid; redemption: units held, min-balance, notice (F9) | Insert `LpDealingEstimateSnapshot` (expires +15 min); returns `isEstimate:true` payload. Nothing committed |
| (none) -> SUBMITTED (subscription) | UI(LP) `POST /api/lp-portal/dealing/subscriptions` (JSON or multipart; Idempotency-Key) | SIGNATORY/MANAGER, `lp.dealing.subscribe` | as estimate gates + valid unexpired estimate for same client/type/fund/4-field payload hash | Insert `LpDealingRequest` (status SUBMITTED, units from estimate, requestedDealingDate=expectedFundingDate); 201 "Subscription submitted"; idempotency record; no audit/notification/realtime/ledger/holding change |
| (none) -> SUBMITTED (redemption) | UI(LP) `POST /api/lp-portal/dealing/redemptions` (Idempotency-Key) | SIGNATORY/MANAGER, `lp.dealing.redeem` | as above; **DEF-453** payload-hash check cannot pass (F10) | Insert `LpDealingRequest` (REDEMPTION, FULL or PARTIAL, USD); 201 "Redemption submitted" |
| SUBMITTED -> COMPLIANCE_REVIEW / AWAITING_FUNDS / AWAITING_NAV / UNDER_REVIEW / FUNDS_RECEIVED / ALLOCATED / REJECTED / CANCELLED | staff | not found in code (no staff route/service/UI writes `lp_dealing_requests.status`) | - | Expected (the design SRD): on ALLOCATED update `LpHoldingPosition` units/NAV and ledger; not found in code |

**B.4 Performance report job (`LpPortalJob`, jobType PERFORMANCE_REPORT)**


`mermaid
stateDiagram-v2
 [*] --> QUEUED: LP POST /jobs/performance-report or GET /performance/report/download
 QUEUED --> READY: same request, synchronously after computing performance
 QUEUED --> FAILED: not implemented (no catch/update found)
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> QUEUED | UI(LP) `POST /api/lp-portal/jobs/performance-report` body `{fundId?, asOfDate?, period?}` (Idempotency-Key) or `GET /api/lp-portal/performance/report/download?fundId=` | LP VIEWER+, `lp.performance.download_report` | active client; fundId in scope | Insert `LpPortalJob{requestJson}` |
| QUEUED -> READY | same call (inline) | system | none; if `getPerformance` throws the job stays QUEUED forever and request returns the error | `resultJson = performance payload`, `completedAt`, `downloadPath=null`; POST responds 202 `{jobId,status:"READY",createdAt}` |
| poll | UI(LP) `GET /api/lp-portal/jobs/:jobId` | `lp.portal.access` | job belongs to client else 404 `LP_NOT_FOUND` "Job not found" | returns `downloadUrl:null` (no file generated) |

Related staff-side report runs (investor-facing reports list): `FundReportRun` QUEUED -> COMPILING -> DISPATCHING -> COMPLETED | FAILED; `FundReportRecipientJob` PENDING -> COMPILED -> DELIVERED | FAILED; LP sees jobs with status DELIVERED/SENT/COMPILED on dashboard.

**B.5 Performance snapshot / valuation status**


`mermaid
stateDiagram-v2
 [*] --> NoSnapshot
 NoSnapshot --> Computed: cron daily or event hook upserts (clientId, fundId, asOfDate)
 Computed --> Computed: re-run same asOfDate overwrites metrics
 Computed --> NewDate: later asOfDate creates a new row
 state ValuationStatus {
 [*] --> FINAL: default (context / holding / API output)
 FINAL --> PROVISIONAL: staff (no writer found)
 FINAL --> ESTIMATED: staff (no writer found)
 FINAL --> RESTATED: staff (no writer found)
 note right of FINAL: benchmarks emit UNAVAILABLE when no series
 }
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| none -> snapshot(asOf=today UTC date) | cron `POST /api/cron/lp-portal/snapshot-refresh` | scheduler; `X-Cron-Secret` (env `LP_PORTAL_CRON_SECRET` or `CRON_SECRET`) or loopback | per-commitment compute; no isolation | upsert `lp_portal_metric_snapshots`; returns `{refreshed, asOfDate}` |
| none/old -> snapshot | cap-table transaction executed (`CapTableLpPortalHook`) | system | stakeholder linked to a client | upsert with `asOfDate=now`; exception reverts cap-table execution |
| none/old -> snapshot | LP provisioning / fundraising deal close; quarterly statement publish | staff workflows | best-effort | upsert (asOf now / periodEnd) |
| FINAL <-> other valuation statuses | staff | not found in code (no writer of `LpFundPortalContext` or `LpHoldingPosition`, other than SEED script) | - | - |
| UNAVAILABLE -> FINAL (benchmark) | rows inserted into `lp_benchmark_series_points` | staff/DB only (no endpoint) | `asOfDate <= requested asOf` | benchmarks response flips `configured` and status |

##### C. As implemented in the reference backend (documents, notices, requests, messages, organisation, settings)

**C.1 Document (publication, read, signature)**


Publication (code reachable): documents are born published; DRAFT, REQUIRES_SIGNATURE, SUPERSEDED, RESTATED, WITHDRAWN are SRD-only and not implemented.

`mermaid
stateDiagram-v2
 [*] --> PUBLISHED: staff upload / report sync / quarterly sync / tax sync (publishedAt = now)
 PUBLISHED --> PUBLISHED: LP VIEW / PREVIEW / DOWNLOAD (audit row only)
 note right of PUBLISHED
 DRAFT = publishedAt null (unreachable by code)
 REQUIRES_SIGNATURE, SUPERSEDED, RESTATED, WITHDRAWN: not found in code
 signature workflow: not found in code (requiresSignature = 0)
 end note
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> PUBLISHED | `POST /admin/documents` (multipart, <=25 MB) | staff, `requireGpAdmin` | file present (400 "file is required (multipart)"); clientId valid (FK) | upload to `lp-portal-vault`, sha256, row with `sourceType GP_UPLOAD`; no notification, no realtime, no audit row |
| (none) -> PUBLISHED | fund-report job becomes DELIVERED | system (`FundReportRunOrchestrator`) | job DELIVERED; one doc per job (`FUND_REPORT_SYNC`+jobId) | category PERFORMANCE_REPORT; no notification |
| (none) -> PUBLISHED | quarterly statement recipient publish | staff approver via quarterly statement flow | PDF generated | doc category QUARTERLY_STATEMENT; recipient status PUBLISHED with `portalDocumentId`; metric snapshot upsert (best effort) |
| (none) -> PUBLISHED | tax return pack publish | staff approver | pack has `fundId`; client = earliest ACTIVE/PENDING commitment | category TAX, only one investor |
| PUBLISHED -> PUBLISHED (VIEW) | `GET /documents/:id` | LP any role, `lp.documents.view` | document of client; fund allowed; else 404 | `LpDocumentAccessAudit` VIEW (userId, ip, UA) |
| PUBLISHED -> PUBLISHED (PREVIEW) | `GET /documents/:id/preview` | LP any role, `lp.documents.view` | mime pdf/image else 415 (unreachable) | audit PREVIEW |
| PUBLISHED -> PUBLISHED (DOWNLOAD) | `GET /documents/:id/download` or `/vault/:id/download` | LP any role, `lp.documents.download` | file available else 404 | audit DOWNLOAD; counts in `secureDownloadsYtd` |
| PUBLISHED -> PUBLISHED (VERIFY) | `GET /vault/:id/verify` | LP any role, `lp.documents.view` | sha256 present else `verified:false` | none |

**C.2 Notice**


Stored status is only PUBLISHED; the LP-facing status is derived per client from receipts.

`mermaid
stateDiagram-v2
 [*] --> PUBLISHED: staff POST /admin/notices
 PUBLISHED --> DELIVERED: receipt materialised for entitled client (recorded fact, not a status column change)
 DELIVERED --> OPENED: LP GET /notices/:id (first open)
 PUBLISHED --> OPENED: LP GET /notices/:id (no delivery receipt)
 OPENED --> ACKNOWLEDGED: LP POST /notices/:id/acknowledge
 PUBLISHED --> ACKNOWLEDGED: acknowledge without prior open
 ACKNOWLEDGED --> ACKNOWLEDGED: re-acknowledge (timestamp overwritten)
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> PUBLISHED | `POST /admin/notices{title, body, category?, targetType ALL/FUND/ORG/USER, fundId?, clientId?, userId?, shareClass?}` | staff `requireGpAdmin` | title/body non-empty; FUND needs fundId; ORG/USER need clientId (400s) | notice row `status PUBLISHED`, `publishedAt now`; receipts (userId null or notice userId) created per recipient client with ACTIVE/PENDING commitment (ALL/FUND) or the one client; NO email/realtime/notification |
| PUBLISHED -> (derived) DELIVERED | at create | system | recipient has a commitment | `delivered` counter = distinct clients with a receipt; the LP list shows stored status `PUBLISHED` until opened (the derived status is `OPENED/ACKNOWLEDGED` only; `DELIVERED` appears only if the stored status were set to DELIVERED - not found in code) |
| (any) -> OPENED | `GET /notices/:id` | LP any role, `lp.notices.view` | notice visible (`noticeVisible`); no receipt/openedAt yet for the caller | receipt created/updated with `openedAt`; `lp_notice_updated {OPENED}` to org room; `lp_notification` to all active org users incl. actor |
| (any) -> ACKNOWLEDGED | `POST /notices/:id/acknowledge` | LP SIGNATORY or MANAGER (`lp.notices.acknowledge`) + Idempotency-Key | notice visible; else 404 | receipt (per user) `acknowledgedAt = now` (+`openedAt` if empty); `lp_notice_updated {ACKNOWLEDGED}` + `lp_notification`; counts as acknowledged for the whole organisation in list/unread/bell |
| ACKNOWLEDGED -> ACKNOWLEDGED | repeat acknowledge (new idempotency key) | same | none | `acknowledgedAt` overwritten (DEFECT) |
| any -> WITHDRAWN/EXPIRED/DRAFT | - | - | - | not found in code |

**C.3 Service request**


Vocabulary: SUBMITTED, OPEN, ASSIGNED, UNDER_REVIEW, AWAITING_INVESTOR, AWAITING_INTERNAL, RESOLVED, CLOSED. Staff may set any state from any state (no graph is enforced); the diagram shows the transitions the code performs or the SRD flow intends.

`mermaid
stateDiagram-v2
 [*] --> SUBMITTED: LP POST /requests
 SUBMITTED --> ASSIGNED: staff PATCH assignedToId (no status given)
 SUBMITTED --> AWAITING_INVESTOR: staff reply
 ASSIGNED --> UNDER_REVIEW: staff PATCH status
 UNDER_REVIEW --> AWAITING_INVESTOR: staff reply / PATCH
 UNDER_REVIEW --> AWAITING_INTERNAL: staff PATCH
 AWAITING_INVESTOR --> UNDER_REVIEW: staff PATCH (investor reply does NOT move it)
 UNDER_REVIEW --> RESOLVED: staff PATCH
 RESOLVED --> CLOSED: staff PATCH
 RESOLVED --> AWAITING_INVESTOR: LP reply
 CLOSED --> AWAITING_INVESTOR: LP reply
 OPEN --> ASSIGNED: staff PATCH
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> SUBMITTED | `POST /requests` | LP SIGNATORY/MANAGER, `lp.requests.create`, Idempotency-Key | subject required; fund allowed; attachmentIds valid | row + optional first INVESTOR message; attachments linked; `lp_request_created` (org + request room) and `lp_notification` to other org users; 201 "Service request created" |
| any -> ASSIGNED | `PATCH /admin/requests/:ref {assignedToId}` with no status | staff `requireGpAdmin` | at least one field; assignedToId truthy | `assignedToId` saved; status forced to ASSIGNED (also for RESOLVED/CLOSED); no event |
| any -> {8 states} | `PATCH /admin/requests/:ref {status}` | staff `requireGpAdmin` | status in the 8-value list else 400 | `updatedAt` changes; no event, no history row |
| non-final -> AWAITING_INVESTOR | `POST /admin/requests/:ref/messages` | staff `requireGpAdmin` | body non-empty | OPS message; status set unless already RESOLVED/CLOSED; no event/notification/email |
| RESOLVED/CLOSED -> AWAITING_INVESTOR | `POST /requests/:ref/messages` | LP SIGNATORY/MANAGER, `lp.messages.reply` | body non-empty; request of client | INVESTOR message; `lp_request_updated {status}`; `lp_request_message`; `lp_notification` |
| other -> same | `POST /requests/:ref/messages` | LP | as above | message only; status unchanged; `lp_request_message` + `lp_request_updated` (message payload) + `lp_notification` |

**C.4 Message thread**


Statuses: `OPEN` (default and the only value written); others not found in code. Threads are not creatable via API.

`mermaid
stateDiagram-v2
 [*] --> OPEN: created outside the API (seed / database only)
 OPEN --> OPEN: LP reply (lastMessageAt updated)
 OPEN --> OPEN: LP mark read (OPS messages readAt set)
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> OPEN | not available via API | - | - | seed script only |
| OPEN -> OPEN (reply) | `POST /messages/:id/replies` | LP SIGNATORY/MANAGER, `lp.messages.reply` | body non-empty; thread of client | INVESTOR message, attachments, `lastMessageAt = now`, status forced to OPEN; `lp_thread_message`, `lp_thread_updated`, `lp_notification` (others) |
| OPEN -> OPEN (read) | `POST /messages/:id/read` | LP any role, `lp.messages.view` | thread of client | all unread OPS messages get `readAt`; `lp_thread_read`; badge decrements org-wide |
| any -> CLOSED/ARCHIVED | - | - | - | not found in code |
| staff OPS message | - | - | - | no staff route (not found in code) |

**C.5 Colleague invitation / membership**


States visible in code: (no membership) -> ACTIVE (isActive true, revokedAt null) -> SUSPENDED (isActive false and/or revokedAt set). `INVITED` is SRD-only. The pending-activation state is implicit: user.mustChangePassword = true and an unused PasswordResetToken (7 days).

`mermaid
stateDiagram-v2
 [*] --> ACTIVE: invite (new or existing user) - membership created active
 ACTIVE --> ACTIVE: PATCH role / fundIds
 ACTIVE --> SUSPENDED: revoke (isActive false, revokedAt now, tokenVersion++)
 SUSPENDED --> ACTIVE: re-invite same email (reactivated)
 note right of ACTIVE
 "INVITED" not modelled; invitee shows ACTIVE before first login
 pending activation = token unused + mustChangePassword
 end note
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> ACTIVE (new user) | `POST /colleagues{email, role, fundIds}` | LP MANAGER or staff (`lp.organisation.manage_colleagues`) + Idempotency-Key | role != MANAGER unless staff; valid email; "Limited Partner" role exists | User created (temp password, `mustChangePassword`), activation token (7d) + invitation email (failure swallowed); membership created with fundIds (intersected with actor scope); 201 "Colleague invited"; no audit/realtime |
| (none) -> ACTIVE (existing user) | same | same | no active membership | membership created; NO email sent |
| ACTIVE -> (conflict) | same email again | same | existing `isActive` | 409 `LP_VERSION_CONFLICT` "User already has active access" |
| SUSPENDED -> ACTIVE | invite same email | same | existing inactive | `isActive true`, role/fundIds replaced (fundIds keep old if omitted), `revokedAt null`, `invitedById` set |
| ACTIVE -> ACTIVE | `PATCH /colleagues/:id {role?, fundIds?}` | LP MANAGER or staff | same client; role != MANAGER unless staff | row updated; NO last-manager guard; no audit |
| ACTIVE -> SUSPENDED | `PATCH /colleagues/:id/revoke` | LP MANAGER or staff | same client; target not MANAGER (403 "Cannot revoke manager via colleague API") | `isActive false`, `revokedAt now`, `User.tokenVersion` incremented (all sessions invalid); message "Colleague revoked" |
| ACTIVE -> SUSPENDED (staff) | `PATCH /admin/memberships/:id/revoke` | staff `requireGpAdmin` | membership exists | same, no manager guard |
| pending -> activated | invitee signs in with temp password / opens `/reset-password?token=` | invitee | token unused, unexpired (7d) | password set, `mustChangePassword false`, `tokenVersion++`, token `usedAt` |
| pending -> expired | 7 days pass | system | - | token invalid; `resendInvite` exists but is not routed |

**C.6 Bank-instruction change**


Only one state exists in code.

`mermaid
stateDiagram-v2
 [*] --> SUBMITTED: LP POST /bank-instructions/changes
 SUBMITTED --> SUBMITTED: no staff route (verification, approval, rejection not found in code)
`

| from -> to | trigger | actor / permission | guards | side effects |
|---|---|---|---|---|
| (none) -> SUBMITTED | `POST /bank-instructions/changes` (JSON, arbitrary body) | LP SIGNATORY/MANAGER, `lp.organisation.view`, Idempotency-Key | fundId allowed; if policy `requireMfaForLp` the user must have MFA enabled else 403 `LP_MFA_REQUIRED` | row with `payloadJson` = raw body, `requestedById`; 201 `{id, status, createdAt}`; no email/notification/audit/realtime |
| SUBMITTED -> VERIFIED/APPROVED/REJECTED/ACTIVE | - | - | maker/checker, callback verification | not found in code (no staff route, no model fields) |
