# DOMAIN MODEL (from the 5B draft)

##### A. Entity map: what the LP experience needs, where the reference backend keeps it, and what Nexus has

"Reference" = NVCCZ Prisma model; "Nexus" = table in `backend/api/prisma/schema.prisma`; **S** = stored, **C** = computed on read; **[O]** the Nexus UI types and mock store carry it, **[I]** reference backend only, **[P]** proposed.

| # | Entity | Used by screens | Reference model(s) | Nexus table today | Stored or computed | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Investor organisation | shell, organisation | `Client` (`investorId`, `legalName`, `email`, `country`, `phone`, `address`, `status`) | `clients` (name, ref, email, phone, address, `portalEnabled`) | S | `investorId` format, `country`, status vocabulary |
| 2 | LP user and credentials | login, organisation, settings | `User`, `UserMfaTotp`, `AuthMfaPending`, `PasswordResetToken` | `users`, `user_mfa_factors`, `password_resets`, `invitations` | S | `lastSeen`, per-user MFA state exposure |
| 3 | Membership (colleague) | organisation, session | `LpUserRelation` (`lpRole`, `isActive`, `fundIds`, `invitedById`, `revokedAt`) | `client_users` (`investorRole`, `accountScope`) | S; `status`, `mfaEnabled`, `lastActiveAt` C | `fundIds`, `revokedAt`, LP role, status INVITED, last-manager guard |
| 4 | Fund | shell, every screen | `Fund` (name, `fundPurpose`, `currencyCode`) | none | S | whole entity |
| 5 | Fund portal context | shell, dashboard, dealing | `LpFundPortalContext` (operating model, currency, public reference, short name, default share class, valuation status, as-of) | none | S | whole entity and staff write path |
| 6 | Fund commitment (entitlement) | session, dashboard, notices | `InvestmentCommitment` (client, fund, amount, currency, status ACTIVE/PENDING) | `snapshot_investments.commitment` (per snapshot) | S | durable commitment per client and fund |
| 7 | Capital call | capital activity, dashboard, ledger | `CapitalCall` (fund, call percent, due date, transaction date, bank instructions, status, `noticesSentAt`) | `capital_events` (one row per client and event) | S | call header, call number, wiring text, status vocabulary |
| 8 | Capital call allocation | capital activity, dashboard | `CapitalCallAllocation` (commitment snapshot, uncalled before, call amount, amount paid, status) | `capital_events.amount` | S | per-investor allocation, paid roll-up |
| 9 | Capital call payment (receipt) | capital activity, ledger | `CapitalCallAllocationPayment` | `funding_evidence` (matching only) | S | amount and date of each receipt |
| 10 | Call portal state | capital activity | `LpCapitalCallPortalState` (`acknowledgedAt`, `acknowledgedById`) | none | S | acknowledgement |
| 11 | Payment confirmation | capital activity | `LpCapitalCallPaymentConfirmation` (file, SHA-256, claimed amount, notes) | `funding_evidence` (file, confirmer) | S | claimed amount, notes, SHA-256 on the row |
| 12 | Distribution and allocation | capital activity, ledger | `Distribution`, `DistributionAllocation`, `DistributionAllocationPayment` | `capital_events` type Distribution | S | gross, carry, net, per-investor share and payouts, type vocabulary |
| 13 | Investor ledger | account activity | read-time union of calls, payments, distributions, payouts and dealing rows | `snapshot_transactions` (securities) | C | ledger entity or read model with original and reporting amount and FX |
| 14 | Holding position | dashboard, dealing, performance | `LpHoldingPosition` (units, NAV per unit, account value, share class, account reference, as-of, status) | `snapshot_holdings` (securities) | S | units and NAV per unit per share class |
| 15 | Dealing rules | dealing | `LpDealingRules` | none | S | whole entity |
| 16 | Dealing request | dealing, dashboard, ledger | `LpDealingRequest` | none | S | whole entity and workflow |
| 17 | Estimate snapshot | dealing | `LpDealingEstimateSnapshot` (TTL 15 min, payload hash) | none | S (ephemeral) | whole entity, purge |
| 18 | Bank account | dealing, distributions | `LpBankAccount` (masked) | `bank_instructions` (one per client) | S | list per fund and currency |
| 19 | Compliance status | dealing, dashboard | `LpComplianceStatus` | `clients.kycStatus` | S | accredited flag, hold and reason |
| 20 | Performance snapshot | dashboard, performance | `LpPortalMetricSnapshot` (client, fund, as-of, metrics JSON) | `investor_snapshots` (+ children) | S | per-fund rows, valuation status, approver, version |
| 21 | Benchmark series | performance | `LpBenchmarkSeriesPoint` | none | S | whole entity |
| 22 | Job | performance | `LpPortalJob` | none | S | whole entity |
| 23 | Document | documents, dashboard, calls | `LpPortalDocument` (category, title, fund, SHA-256, MIME, size, pages, source type and ref) | `documents`, `document_versions`, `publications` | S; `version`, `period`, `accessScope`, `status` C | category, fund, period, MIME, size, pages |
| 24 | Document access audit | documents | `LpDocumentAccessAudit` | `audit_events` (`document.downloaded`), `document_reads` | S | VIEW and PREVIEW, IP, per-user history |
| 25 | Notice and receipt | notices, dashboard, bell | `LpNotice`, `LpNoticeReceipt` | none | S | whole entity |
| 26 | Service request, message, attachment | requests | `LpServiceRequest`, `LpServiceRequestMessage`, `LpPortalAttachment` | `service_requests`, `service_request_events`, `files` | S | fund link, messages with attachments, upload-then-attach |
| 27 | Message thread and message | messages | `LpMessageThread`, `LpMessage` | `message_threads`, `messages`, `message_reads` | S | `relatedType`, `relatedId`, fund link, attachments |
| 28 | Notification (bell) | shell | computed feed (notices, requests, calls) | `notifications` | C (reference) / S (Nexus) | feed shape |
| 29 | Notification preferences | settings | `LpNotificationPrefs` (10 booleans, digest, currency, as-of preference) | `notification_preferences` (unused) | S | endpoint and dispatcher |
| 30 | Bank-instruction change | organisation | `LpBankInstructionChange` (fund, status, payload JSON) | `bank_instructions` (seed only) | S | whole workflow |
| 31 | MFA policy | settings | `LpPortalMfaPolicy` | `policies` (`mfa_required`) | S | one policy |
| 32 | Idempotency key | all writes | `LpPortalIdempotencyKey` | none | S | whole entity |
| 33 | Realtime room membership | shell | Socket.IO rooms | none | C | transport |

##### B. UI view-model types (the contract the Nexus UI is typed against)

Every interface of `lib/api/lp-portal-api.ts` with its fields (`?` = optional, `string` = decimal string for money, units, rates and multiples). The mock store seeds exactly these shapes. **[O]**

| UI type (`lp-portal-api.ts`) | Fields (`?` = optional) |
| --- | --- |
| `LpPortalMeta` | requestId?: string |
| `LpPortalResponse` | success: boolean; message?: string; data: T; timestamp?: string; meta?: LpPortalMeta |
| `LpListData` | items: T[]; page: number; pageSize: number; total: number; totalPages: number |
| `LpApiErrorBody` | code?: string; message?: string; fieldErrors?: Record<string, string>; details?: Record<string, string>; retryable?: boolean |
| `LpSessionFund` | fundId: string; publicReference: string; fundName: string; shortName: string; operatingModel: "PRIVATE_CAPITAL" \| "OPEN_ENDED"; currencyCode: string; shareClass: string \| null; asOfDate: string; valuationStatus: string; investorAccountReference: string; commitmentAmount: string |
| `LpSession` | client: { id: string; legalName: string; email: string; investorId: string; displayName?: string }; lpRole: "VIEWER" \| "SIGNATORY" \| "MANAGER"; presentationCurrency: string; defaultAsOfDate: string; defaultValuationStatus: string; funds: LpSessionFund[]; unreadCounts: { requests: number; messages: number; notices: number; notifications: number } |
| `LpDashboardKpis` | totalCommitment: string; paidIn: string; called?: string; outstandingCalled?: string; unfunded: string; currentNav: string; distributions: string; netIrr: string; tvpi: string; dpi: string; rvpi: string; investmentCount: number; portfolioCompanyCount?: number |
| `LpOpenEndedSummary` | accountValue: string; unitsHeld: string; navPerUnit: string; ytdReturn: string |
| `LpOpenEndedHistoryPoint` | label: string; navPerUnit: string; date?: string |
| `LpDashboardData` | asOfDate: string; valuationStatus: string; kpis: LpDashboardKpis; openEndedSummary?: LpOpenEndedSummary \| null; openEndedHistory?: { points: LpOpenEndedHistoryPoint[] } |
| `LpDashboardAction` | id: string; type: string; severity: string; title: string; fundId: string; relatedRecordId: string; href: string; dueDate: string \| null; amount?: string; fundName?: string; label?: string |
| `LpRecentActivity` | id: string; type: string; title: string; fundId: string; amount: string; status: string; at: string |
| `LpCapitalCall` | id: string; callNo: number; fundId: string; fundName: string; issueDate: string; dueDate: string; currencyCode: string; amount: string; paid: string; outstanding: string; status: string; acknowledgedAt: string \| null |
| `LpCapitalCallWiring` | bankName: string; accountName: string; accountNumber: string \| null; accountNumberMasked: string; abaRouting: string; reference: string; raw: string \| null |
| `LpCapitalCallTimelineStep` | code: string; at: string \| null; completed: boolean |
| `LpCapitalCallDetail` extends `LpCapitalCall` | wiring: LpCapitalCallWiring; timeline: LpCapitalCallTimelineStep[] |
| `LpCapitalCallSummary` | openCount: number; outstanding: string; overdue: string; paidYtd: string; currencyCode: string; paidCallCount?: number; dueSoonCount?: number; dueSoonAmount?: string; totalDistributions?: string; upcomingDistributionNotices?: { count: number; amount?: string } |
| `LpCapitalCallDocument` | id: string; name: string; category: string; publishedDate: string; checksumSha256: string; status: string |
| `LpDistribution` | id: string; reference: string; fundId: string; fundName: string; paymentDate: string; type: string; currencyCode: string; gross: string; adjustments: string; netPaid: string; status: string; destinationBankMasked: string \| null; documentId: string \| null |
| `LpAccountActivityEntry` | entryId: string; entryType: string; fundId: string; fundName: string; transactionDate: string; amount: string; currency: string; description: string; status: string; structure?: string; operatingModel?: "PRIVATE_CAPITAL" \| "OPEN_ENDED" |
| `LpLedgerDocument` | id: string; name: string; publishedDate: string; size?: number |
| `LpLedgerDetail` | entryType: string; allocation?: { id: string; clientId: string; currentCallAmount: string; amountPaid: string; status: string }; payments: unknown[]; callNoticeDocumentId?: string \| null; documents?: LpLedgerDocument[] |
| `LpBankAccount` | id: string; label: string; bankName: string; accountName: string; accountNumberMasked: string; currencyCode: string; isDefault: boolean; fundId: string \| null; status: string |
| `LpDealingRules` | minBalanceAmount: string; minBalanceUnits: string; noticeDays: number; dealingFrequency: string; nextEligibleDealingDate: string; settlementLagDays: number; subscription: { mgmtFeeRate: string; otherFeeFlat: string; maxFileMb: number }; redemption: { feeRate: string; modes: Array<"AMOUNT" \| "UNITS" \| "FULL"> } |
| `LpDealingCompliance` | accreditedInvestor: boolean; kycStatus: string; noUnsettledCapitalCalls?: boolean; noLegalHolds: boolean; blockers: string[]; termsUrl?: string \| null; holdReason?: string \| null |
| `LpDealingOverview` | fundId: string; shareClass: string; asOfDate: string; valuationStatus: string; navPerUnit: string; accountValue: string; unitsHeld: string; availableToRedeemValue: string; availableUnits: string; pendingSubscriptions: string; pendingRedemptions: string; rules: LpDealingRules & { compliance?: LpDealingCompliance }; compliance: LpDealingCompliance |
| `LpDealingRequest` | id: string; fundId: string; fundName?: string; shareClass?: string; requestType: "SUBSCRIPTION" \| "REDEMPTION"; status: string; amount: string; units: string; redemptionMode: string \| null; currencyCode: string; requestedDealingDate: string; estimateSnapshotId: string; isEstimate: boolean; createdAt: string; notes?: string \| null |
| `LpSubscriptionEstimate` | estimateSnapshotId: string; navPerUnit: string; estimatedUnits: string; managementFee: string; otherFees: string; estimatedTotalInvestment: string; isEstimate: boolean; disclaimer: string |
| `LpRedemptionEstimate` | estimateSnapshotId: string; estimatedUnitsToCancel: string; estimatedSettlementAmount: string; earliestDealingDate: string; estimatedSettlementDate: string; noticeDays: number; aboveMinBalance: boolean; isEstimate: boolean; redemptionFee: string; disclaimer: string |
| `LpPerformanceMetrics` | totalCommitment: string; paidIn: string; distributions: string; currentNav: string; netIrr: string; tvpi: string; dpi: string; rvpi: string |
| `LpPerformanceByFundRow` | fundId: string; fundName: string; netIrr: string \| null; tvpi: string \| null; dpi: string \| null; rvpi: string \| null; nav: string; paidIn: string; distributions: string; operatingModel?: "PRIVATE_CAPITAL" \| "OPEN_ENDED"; structure?: string |
| `LpOpenEndedMetrics` | ytdReturn: string; navPerUnit: string; unitsHeld: string; accountValue: string |
| `LpPerformanceData` | asOfDate: string; valuationStatus: string; period: string; calculationDate: string; version: string; sourceModule: string; reportingCurrency: string; approvedBy: string \| null; metrics: LpPerformanceMetrics; byFund: LpPerformanceByFundRow[]; benchmark: unknown \| null; openEndedMetrics?: LpOpenEndedMetrics |
| `LpPerformanceHistoryPoint` | date: string; label: string; nav: string; paidIn: string; distributions: string |
| `LpPerformanceHistory` | asOfDate: string; valuationStatus: string; range: string; points: LpPerformanceHistoryPoint[] |
| `LpBenchmarkSeries` | metric: string; benchmarkId?: string; asOfDate: string; valuationStatus: string; configured?: boolean; series: Array<{ date: string; label: string; value: string }>; source?: string \| null; approvedAt?: string \| null; note: string \| null |
| `LpJobStatus` | jobId: string; jobType: string; status: string; result?: unknown; downloadUrl?: string \| null; errorMessage?: string \| null; createdAt: string; completedAt?: string \| null |
| `LpDocument` | id: string; name: string; fundId: string; fundName: string; category: string; period: string \| null; publishedDate: string; version: string; status: string; accessScope: string; checksumSha256: string; permissions: string[]; sourceType?: string; sourceRefId?: string; fileSizeBytes?: number; pageCount?: number; mimeType?: string; history?: Array<{ user: string; action: string; at: string; ip: string }> |
| `LpDocumentsSummaryCategoryCount` | category: string; count: number |
| `LpDocumentsSummary` | total?: number; byCategory?: LpDocumentsSummaryCategoryCount[]; newThisWeek?: number; requiresSignature?: number; secureDownloadsYtd?: number |
| `LpVaultDocument` | documentId: string; category: string; title: string; fundId: string; fundName: string; publishedAt: string; sourceType: string; sha256: string |
| `LpNotice` | id: string; title: string; status: string; fundId: string; fundName?: string; shareClass: string \| null; publishedAt: string; acknowledgedAt: string \| null; category?: string; kind?: string; requiresAcknowledgement?: boolean; preview?: string; body?: string; openedAt?: string \| null |
| `LpServiceRequestAttachment` | id: string; name: string; size: number; downloadUrl?: string |
| `LpRequestAttachment` | id: string; name: string; size: number; mimeType?: string; uploadedAt: string |
| `LpServiceRequest` | id: string; reference: string; type: string; fundId: string; fundName: string; status: string; subject: string; description: string; createdAt: string; updatedAt: string; priority?: string; submittedBy?: string \| { id?: string; email?: string; name?: string } \| null; attachments?: LpServiceRequestAttachment[]; messages?: Array<{ id: string; authorType: string; authorId: string; body: string; createdAt: string; attachments?: LpServiceRequestAttachment[] }> |
| `LpMessageThreadSummary` | id: string; subject: string; fundId: string; fundName: string; relatedType: string; relatedId: string; status: string; lastMessageAt: string; lastMessagePreview: string; unreadCount: number |
| `LpMessageThreadParticipant` | name: string; initials?: string; role?: string |
| `LpMessageThreadDetail` | id: string; subject: string; fundId: string; fundName: string; relatedType: string; relatedId: string; status: string; participants?: LpMessageThreadParticipant[]; messages: Array<{ id: string; authorType: string; authorId: string; body: string; readAt: string \| null; createdAt: string; attachments?: LpServiceRequestAttachment[] }> |
| `LpColleague` | membershipId: string; userId: string; email: string; name: string; lpRole: string; fundIds: string[]; isActive: boolean; status: string; revokedAt: string \| null; mfaEnabled?: boolean; lastActiveAt?: string \| null |
| `LpOrganisation` | id: string; legalName: string; investorId: string; email: string; country: string; phone: string; address: string; status: string; lpRole: string; colleagues: LpColleague[] |
| `LpNotificationPreferences` | emailCapitalCalls: boolean; emailDistributions: boolean; emailDocuments: boolean; emailMessages: boolean; emailNotices: boolean; inAppCapitalCalls?: boolean; inAppDistributions?: boolean; inAppDocuments?: boolean; inAppMessages?: boolean; inAppNotices?: boolean; digest?: "daily" \| "weekly" \| "off" \| null |
| `LpSettings` | notifications: LpNotificationPreferences; mfa: { requireMfaForLp: boolean; issuerName: string; enabled: boolean; enabledAt: string \| null; manageUrl?: string \| null; sessionsUrl?: string \| null; passwordUrl?: string \| null }; presentationCurrency: string; defaultAsOfPreference?: string |
| `LpDisplaySettings` | presentationCurrency?: string; defaultAsOfPreference?: string |
| `LpNotificationItem` | id: string; title: string; href: string; fundName?: string; createdAt: string; type?: string; read?: boolean |
| `LpBankInstructionChange` | id: string; fundId: string; fundName?: string; bankName?: string; accountNumberMasked: string; requestedBy: string; submittedAt: string; status: string |
| `LpRealtimeInfo` | enabled: boolean; wsUrl?: string; namespace?: string; events?: string[]; pollingIntervalMs?: number |
| `LpReportMetrics` | dpi: number; nav: number; rvpi: number; tvpi: number; fundId: string; netIrr: number; clientId: string; fundName: string; periodEnd: string; lpLegalName: string; periodStart: string; totalPaidIn: number; currencyCode: string; holdingsSummary: string; totalCommitment: number; totalDistributions: number; unfundedCommitment: number |
| `LpReport` | jobId: string; runId: string; fundName: string; templateName: string; reportLevel: string; periodStart: string; periodEnd: string; status: string; deliveredAt: string; transportMethod: string; metrics: LpReportMetrics |
| `LpReportsPagination` | page: number; limit: number; total: number; pages: number |
| `LpClientInfo` | id: string; legalName: string; email: string; investorId: string |
| `LpFundSummary` | fundId: string; fundName: string; commitment: number; paidIn: number; distributions: number; nav: number; dpi: number; tvpi: number; rvpi: number; netIrr: number; currencyCode: string |
| `LpDashboard` | client: LpClientInfo; lpRole: string \| null; presentationCurrency: "USD" \| "ZIG"; funds: LpFundSummary[]; exchangeRateWidget: null; latestReports: unknown[] |
| `LpVaultVerifyResult` | documentId: string; verified: boolean; expectedSha256: string; actualSha256: string |
| `LpLedgerEntry` | entryId: string; entryType: string; fundId: string; fundName: string; transactionDate: string; amount: string; currency: string; description: string; status: string |
| `LpLedgerEntryDetail` extends `LpLedgerDetail` | entryId?: string |

##### C. Reference Prisma models and enumerations (capital, dealing, performance)

All models in `nvccz\prisma\schema.prisma` (`prisma/schema.prisma`). `Decimal(p,s)` = MySQL decimal. Computed = derived at read time, not stored.

**C.1 Capital / distributions (staff-written)**


- `InvestmentCommitment` (table investment_commitments): id cuid; clientId; fundId; `amount Decimal(15,2)`; `currency String @default("USD")`; effectiveDate; `status String @default("PENDING")` (code uses ACTIVE|PENDING as eligible); eSign Json?; notes; unique(clientId, fundId); relations client, fund, capitalCallAllocations[], managementFeeAllocations[], distributionAllocations[].
- `CapitalCall` (capital_calls): id; fundId; currencyId -> Currency; `callPercent Decimal(12,6)`; `paymentDueDate Date`; `bankInstructions Text` (free text, JSON by convention); `transactionDate Date`; `journalEntryId @unique`; `status VarChar(32) @default("INITIATED")` (INITIATED | NOTICES_SENT | PARTIALLY_PAID | FULLY_PAID in staff code); `noticesSentAt DateTime?`; createdById; createdAt/updatedAt; relations fund, currency, journalEntry, createdBy, allocations[]. NO `callNumber` column.
- `CapitalCallAllocation` (capital_call_allocations): id; capitalCallId; clientId; investmentCommitmentId; `lpLegalNameSnapshot VarChar(512)`; `totalCommitmentSnapshot`, `uncalledCapitalBeforeSnapshot`, `currentCallAmount` Decimal(15,2); `amountPaid Decimal(15,2) default 0` (roll-up); `status VarChar(32) default "PENDING"` (PENDING|PARTIALLY_PAID|PAID); relations capitalCall, client, investmentCommitment, `payments[]`, `portalState?` (1:1 LpCapitalCallPortalState), `paymentConfirmations[]`. The portal's "capital call id" is THIS allocation id.
- `CapitalCallAllocationPayment` : id; capitalCallAllocationId; `amount Decimal(15,2)`; `recordedAt default now`; createdAt. Append-only receipts.
- `Distribution` (distributions): id; fundId; currencyId; `distributionDate Date`; `source VarChar(32)` (DIVIDEND|EXIT_PROCEEDS|REALISATION_PROCEEDS|INTEREST|INCOME|RETURN_OF_CAPITAL|OTHER); sourceCompanyId?; sourceDividendId?; `grossAmount`, `carryAmount default 0`, `netToLPs`, `hurdleAppliedAmount?` Decimal(15,2); `status VarChar(32) default "DECLARED"` (DECLARED|NOTICES_SENT|PARTIALLY_PAID|PAID); noticesSentAt?; journalEntryId @unique; notes; createdById.
- `DistributionAllocation` : id; distributionId; clientId; investmentCommitmentId; lpLegalNameSnapshot; commitmentSnapshot; `paidInSnapshot default 0`; `shareAmount` (net of carry, pro-rata); `amountPaid default 0`; `status default "PENDING"` (PENDING|PARTIALLY_PAID|PAID); relation payments[].
- `DistributionAllocationPayment` : id; distributionAllocationId; amount; recordedAt; createdAt.
- `Currency`: id; `code @unique`; name; symbol; decimalPlaces default 2; isActive; isDefault.
- `Fund`: relevant columns: `fundPurpose` enum FundPurpose {PRIVATE_EQUITY, LISTED_EQUITY}; `managementFeeRate`, `managementFeeBase`, `managementFeeFrequency`, `carryRate Decimal(7,4)?`, `hurdleRate Decimal(7,4)?`, `hurdleType VarChar(16)?`, `currencyCode VarChar(8)?`, `totalAmount` (fund size, used as "paid-in" by the portfolio dashboard service), `remainingAmount`.

**C.2 Portal-owned (investor workflow / read models)**


- `LpUserRelation` (lp_user_relations): userId; clientId; `lpRole VarChar(16) default "VIEWER"` (VIEWER|SIGNATORY|MANAGER + aliases); isActive; `fundIds Json?` (fund scope; null/empty = all); invitedById; revokedAt; unique(userId, clientId).
- `LpFundPortalContext` (lp_fund_portal_contexts): fundId @unique; `operatingModel VarChar(32) default "PRIVATE_CAPITAL"` (PRIVATE_CAPITAL | OPEN_ENDED; code also tolerates "CREDIT" label); `currencyCode default "USD"`; publicReference; shortName; `defaultShareClass`; `valuationStatus VarChar(16) default "FINAL"`; `asOfDate Date?`.
- `LpPortalMetricSnapshot` (lp_portal_metric_snapshots): clientId; fundId; `asOfDate Date`; `metrics Json`; unique(clientId, fundId, asOfDate); index clientId. Stored = cache of `LpFundMetricsSnapshot` (A11).
- `LpCapitalCallPortalState` (lp_capital_call_portal_states): capitalCallAllocationId @unique; clientId; `acknowledgedAt?`; `acknowledgedById?`.
- `LpCapitalCallPaymentConfirmation` : capitalCallAllocationId; clientId; uploadedById?; fileName VarChar(255); mimeType VarChar(128); storagePath VarChar(512); sha256 VarChar(64)?; `amountClaimed Decimal(15,2)?`; notes Text?; createdAt. (Never read by any other code.)
- `LpDealingRules` (lp_dealing_rules): fundId @unique; minBalanceAmount Decimal(15,2) def 1,000,000; minBalanceUnits Decimal(18,6) def 100,000; noticePeriodDays Int def 30; dealingSuspended Boolean def false; subscriptionFeeBps Decimal(10,4) def 0; redemptionFeeBps Decimal(10,4) def 0; nextDealingDate Date?; rulesJson Json? (keys read: `dealingFrequency`, `settlementLagDays`).
- `LpHoldingPosition` (lp_holding_positions): clientId; fundId; `shareClass VarChar(64)?`; `units Decimal(18,6)`; `navPerUnit Decimal(18,8)`; `accountValue Decimal(15,2)`; currencyCode def USD; accountRef VarChar(64)? (investorAccountReference); `asOfDate Date`; `valuationStatus VarChar(16) def FINAL`; `isActive`; unique(clientId, fundId, shareClass) => one live row per share class (no NAV history table; NOTE MySQL unique with NULL shareClass permits duplicates).
- `LpBankAccount` (lp_bank_accounts): clientId; fundId?; label VarChar(128); bankName; accountName; `accountNumberMasked VarChar(32)` (only masked stored); currencyCode; isDefault; `status default "ACTIVE"`.
- `LpDealingRequest` (lp_dealing_requests): clientId; fundId; `requestType VarChar(16)` SUBSCRIPTION|REDEMPTION; `status VarChar(32) default "SUBMITTED"`; `amount Decimal(15,2)?`; `units Decimal(18,6)?`; `redemptionMode VarChar(16)?` PARTIAL|FULL; currencyCode def USD; `requestedDealingDate Date?`; `estimateSnapshotId?`; `estimateJson Json?`; `payloadHash VarChar(64)?`; shareClass?; bankAccountId?; submittedById?; notes; indexes (clientId,fundId), status. No relation to `LpDealingEstimateSnapshot` (loose id).
- `LpDealingEstimateSnapshot` : id (uuid supplied by code); clientId; fundId; `estimateType VarChar(16)` SUBSCRIPTION|REDEMPTION; `estimateJson Json`; `payloadHash VarChar(64)`; `expiresAt`; createdAt; index expiresAt. No purge job found.
- `LpComplianceStatus` (lp_compliance_statuses): clientId @unique; `kycStatus VarChar(32) def "CLEAR"` (code compares to "UPDATE_REQUIRED"); `accredited Boolean def true`; `onHold Boolean def false`; `holdReason VarChar(255)?`; detailsJson.
- `LpBenchmarkSeriesPoint` (lp_benchmark_series_points): `benchmarkId VarChar(64)`; `metric VarChar(32)` (NET_IRR|TVPI per UI/doc); `asOfDate Date`; `value Decimal(18,6)`; label VarChar(64)?; source VarChar(255)?; approvedBy VarChar(191)?; approvedAt?; unique(benchmarkId, metric, asOfDate).
- `LpPortalJob` (lp_portal_jobs): clientId; `jobType VarChar(64)`; `status VarChar(32) def "QUEUED"` (QUEUED, READY used); requestJson; resultJson; downloadPath VarChar(512)?; errorMessage Text?; createdById; completedAt?; index (clientId,status).
- `LpPortalIdempotencyKey` : clientId; userId?; `scope VarChar(512)`; `idempotencyKey VarChar(200)`; `payloadHash VarChar(64)`; `statusCode Int`; `responseJson LongText`; unique(scope, idempotencyKey).
- `LpPortalDocument` : clientId; fundId?; category VarChar(32); title; fileUrl?; storagePath?; sha256?; mimeType; fileSizeBytes BigInt?; pageCount; publishedAt?; publishedById; `sourceType VarChar(32)` (CAPITAL_CALL | CAPITAL_CALL_ALLOCATION | QUARTERLY_STATEMENT_SYNC | MANUAL...); `sourceRefId?`; used for call notices (category CALL_NOTICE) and linked docs.
- `LpBankInstructionChange` : clientId; fundId?; `status def "SUBMITTED"`; requestedById; payloadJson (investor bank-change requests; outside this scope).
- Report-run models (staff reporting, shown to LPs as "reports"): `FundReportRun` (: fundId, templateId, scheduleId?, periodStart/End Date, `status def "QUEUED"` (QUEUED|COMPILING|DISPATCHING|COMPLETED|FAILED), triggerType def MANUAL, counts) and `FundReportRecipientJob` (: runId, clientId, userId?, email, lpLegalName, `status def "PENDING"` (PENDING|COMPILED|DELIVERED|FAILED; SENT read by portal), pdfStatus, transportMethod?, pdfStoragePath?, pdfFileUrl?, pdfFileSize?, pdfSha256?, `metricsSnapshot Json?`, retryCount, lastError, compiledAt, dispatchedAt, deliveredAt).

**C.3 Computed (not stored)**


Portal call status; `callNo`; `outstanding`; `reference` ("DIST-" + id tail); distribution `type/gross/adjustments/netPaid`; KPIs (`unfunded`, `outstandingCalled`, TVPI/DPI/RVPI at consolidation); `availableToRedeemValue/availableUnits`; blockers; history series; open-ended `ytdReturn`.

**C.4 Enumerations as found in code**

- operatingModel: PRIVATE_CAPITAL | OPEN_ENDED (dashboard and session services); "CREDIT" label branch in the performance service; structure labels "Open-End" | "Closed-End" | "Credit".
- valuationStatus emitted: FINAL; benchmarks: FINAL | UNAVAILABLE. (Doc: ESTIMATED | PROVISIONAL | FINAL | RESTATED.)
- Portal call status: ISSUED | ACKNOWLEDGED | PARTIALLY_PAID | PAID | OVERDUE | CANCELLED. Timeline codes: ISSUED | ACKNOWLEDGED | PAYMENT_RECEIVED | CLOSED.
- Distribution portal type: REALISATION_PROCEEDS | DIVIDEND | INTEREST | INCOME | RETURN_OF_CAPITAL | OTHER. Portal distribution status: PENDING | PARTIALLY_PAID | PAID.
- Ledger entryType: CAPITAL_CALL | CAPITAL_CALL_PAYMENT | DISTRIBUTION | DISTRIBUTION_PAYMENT | SUBSCRIPTION | REDEMPTION.
- Dealing: requestType SUBSCRIPTION|REDEMPTION; redemptionMode FULL or PARTIAL; request modes accepted AMOUNT|UNITS|FULL; blockers COMPLIANCE_HOLD|DEALING_SUSPENDED|NOT_ACCREDITED; error codes LP_VALIDATION, LP_ESTIMATE_EXPIRED, LP_INSUFFICIENT_UNITS, LP_MIN_BALANCE_BREACH, LP_NOTICE_PERIOD, LP_COMPLIANCE_HOLD, LP_DEALING_SUSPENDED, LP_ACCOUNT_INACTIVE, LP_CALL_NOT_ISSUED, LP_CALL_ALREADY_ACKNOWLEDGED, LP_NOT_FOUND, LP_FORBIDDEN, LP_UNAUTHORIZED, LP_IDEMPOTENCY_KEY_REUSED, LP_EXPORT_FAILED (fallback 500).
- Job: jobType PERFORMANCE_REPORT; status QUEUED | READY (FAILED never set).
- Period/range tokens: period SI|MAX|YTD|1Y|1YEAR|3Y|3YEAR|5Y; history range SI|1Y|3Y|5Y|10Y|MAX (other -> 24-month series); benchmark metric NET_IRR (default) / TVPI; benchmarkId default CAMBRIDGE.
- Dashboard action types in code: CAPITAL_CALL, KYC_UPDATE, NOTICE_REQUIRES_ACK, SUBSCRIPTION_AWAITING_FUNDS, REDEMPTION_UNDER_REVIEW; severities HIGH|MEDIUM|LOW.
- LP roles: VIEWER | SIGNATORY | MANAGER.

##### D. Reference Prisma models and vocabularies (documents, notices, requests, messages, organisation, settings, session)

All names from `SCHEMA` (`C:\Users\lysp\Downloads\nvccz\prisma\schema.prisma`), line numbers in brackets. "stored" vs "computed" is called out. All ids are `String @id @default(cuid)`. No Prisma enums are used for these domains; every vocabulary is a free `VarChar`.

**LpUserRelation** table `lp_user_relations` - colleague membership.
- `id`, `userId` -> User (cascade), `clientId` -> Client (cascade), `lpRole VarChar(16) default "VIEWER"` (VIEWER|SIGNATORY|MANAGER; legacy LP_MANAGER/ADMIN accepted), `isActive Boolean default true`, `fundIds Json?` (array of fundIds; null/[] = all funds), `invitedById? -> User (SetNull)`, `revokedAt?`, `createdAt`, `updatedAt`.
- Unique `(userId, clientId)`; indexes `(clientId)`, `(userId, isActive)`.
- Computed in API: `status` (ACTIVE|SUSPENDED), `mfaEnabled`, `lastActiveAt`, `name`.

**Client** (investor organisation) [model Client, SCHEMA]: `id, investorId unique, type, legalName, email unique, country, phone?, address?, taxId?, status default "ACTIVE", userId? unique (legacy primary portal user), createdAt, updatedAt`; relations `lpUserRelations, lpPortalDocuments, lpNotices, lpNoticeReceipts, lpServiceRequests, lpMessageThreads, lpDocumentAccessAudits, lpBankAccounts, lpDealingRequests, lpComplianceStatus, lpPortalJobs, investmentCommitments`.

**InvestmentCommitment** [1704]: `clientId, fundId, amount Decimal(15,2), currency default "USD", effectiveDate, status default "PENDING", eSign?, notes?`; unique `(clientId, fundId)`. Drives session funds and notice recipient resolution (status ACTIVE|PENDING).

**LpFundPortalContext** `lp_fund_portal_contexts`: `fundId unique, operatingModel default "PRIVATE_CAPITAL" (PRIVATE_CAPITAL|OPEN_ENDED), currencyCode default "USD", publicReference?, shortName?, defaultShareClass?, valuationStatus default "FINAL" VarChar(16), asOfDate? Date`. No staff write path found.

**LpHoldingPosition** [~5006] (used by session): fields read: `fundId, clientId, isActive, shareClass, asOfDate, valuationStatus, accountRef`. (Full model owned by the dealing/ledger research; not read here.)

**LpPortalDocument** `lp_portal_documents`: `clientId -> Client (cascade), fundId? -> Fund (SetNull), category VarChar(32), title VarChar(512), fileUrl? Text, storagePath? VarChar(512), sha256? VarChar(64), mimeType? VarChar(128), fileSizeBytes? BigInt, pageCount? Int, publishedAt?, publishedById? -> User (SetNull), sourceType VarChar(32), sourceRefId?, createdAt, updatedAt`; relation `accessAudits`. Indexes `(clientId)`, `(category)`, `(sourceType, sourceRefId)`. Computed: `status`, `version`, `period`, `accessScope`, `permissions`, `history`.

**LpDocumentAccessAudit** `lp_document_access_audits`: `documentId -> LpPortalDocument (cascade), clientId -> Client (cascade), userId?, action VarChar(16) (VIEW|DOWNLOAD|PREVIEW), ipAddress? VarChar(64), userAgent? VarChar(512), createdAt`; indexes on documentId, clientId. Append-only by convention.

**LpNotice** `lp_notices`: `title VarChar(512), body Text, category? VarChar(32), status default "PUBLISHED" VarChar(32), targetType default "ALL" VarChar(32) (ALL|FUND|ORG|USER), fundId? -> Fund (SetNull), clientId? -> Client (cascade), userId?, shareClass? VarChar(64), publishedAt?, createdAt, updatedAt`; relation `receipts`; index `(status, publishedAt)`. Computed: LP `status` (OPENED/ACKNOWLEDGED), `kind`, `requiresAcknowledgement (true)`, `preview`, counters `delivered/opened/acknowledged`.

**LpNoticeReceipt** `lp_notice_receipts`: `noticeId -> LpNotice (cascade), clientId -> Client (cascade), userId?, openedAt?, acknowledgedAt?, createdAt`; unique `(noticeId, clientId, userId)` (nullable userId: MySQL does not enforce uniqueness on NULL); index `(clientId)`.

**LpServiceRequest** `lp_service_requests`: `reference unique VarChar(32), clientId -> Client (cascade), fundId? -> Fund (SetNull), requestType VarChar(64), status default "OPEN" VarChar(32), priority default "NORMAL" VarChar(16), subject VarChar(512), body Text, createdById?, assignedToId? (no FK), createdAt, updatedAt`; relation `messages`; indexes `(assignedToId)`, `(clientId)`.

**LpServiceRequestMessage** `lp_service_request_messages`: `requestId -> LpServiceRequest (cascade), authorType VarChar(16) (INVESTOR|OPS), authorId?, body Text, createdAt`; index `(requestId)`.

**LpMessageThread** `lp_message_threads`: `clientId -> Client (cascade), fundId? -> Fund (SetNull), subject VarChar(512), relatedType? VarChar(32), relatedId?, status default "OPEN" VarChar(16), lastMessageAt?, createdAt, updatedAt`; relation `messages`; index `(clientId)`. **No participants model/table**; participants are derived (message authors + caller).

**LpMessage** `lp_messages`: `threadId -> LpMessageThread (cascade), authorType VarChar(16) (INVESTOR|OPS), authorId?, body Text, readAt?, createdAt`; index `(threadId)`. Read state is per message.

**LpPortalAttachment** `lp_portal_attachments`: `id (att_<12hex>, caller-assigned), clientId, fileName VarChar(255), mimeType VarChar(128), storagePath VarChar(512), fileSizeBytes? BigInt, sha256? VarChar(64), requestId?, messageId?, uploadedById?, createdAt`; indexes on clientId, requestId, messageId. No declared relations (FK-less).

**LpBankInstructionChange** `lp_bank_instruction_changes`: `clientId, fundId?, status default "SUBMITTED" VarChar(32), requestedById?, payloadJson Json (arbitrary), createdAt, updatedAt`; index `(clientId)`. No FK relations, no maker/checker/verification fields.

**LpNotificationPrefs** `lp_notification_prefs`: `clientId, userId, emailCapitalCalls/emailDistributions/emailDocuments/emailMessages/emailNotices Boolean default true, inAppCapitalCalls/inAppDistributions/inAppDocuments/inAppMessages/inAppNotices Boolean default true, emailDigest VarChar(16) default "WEEKLY", presentationCurrency VarChar(8) default "USD", defaultAsOfPreference VarChar(16) default "LATEST", createdAt, updatedAt`; unique `(clientId, userId)`. Per user per organisation.

**LpPortalMfaPolicy** `lp_portal_mfa_policy`: `id "default" (singleton), requireMfaForLp Boolean default false, issuerName VarChar(128) default "Arcus LP Portal", createdAt, updatedAt`.

**UserMfaTotp** `user_mfa_totp`: `userId unique -> User (cascade), encryptedSecret Text (AES-256-CBC "iv:cipher" hex), enabledAt?, backupCodes Json? ([{hash, used}]), createdAt, updatedAt`.

**AuthMfaPending** `auth_mfa_pending`: `userId, tokenHash unique VarChar(64), expiresAt, createdAt`; indexes on userId, expiresAt.

**PasswordResetToken** (reused as invitation token): `userId -> User (cascade), tokenHash unique (sha256 of raw), expiresAt, usedAt?, createdAt`. 7-day TTL for invitations, 1 hour for forgot-password.

**User fields used:** `email, firstName, lastName, password (bcrypt), roleId, roleCode ("LIMITED_PARTNER" for invited LPs), mustChangePassword, tokenVersion, lastSeen`. **Role** `name` "Limited Partner".

**LpPortalIdempotencyKey** : `clientId, userId?, scope VarChar(512), idempotencyKey VarChar(200), payloadHash VarChar(64), statusCode Int, responseJson LongText, createdAt`; unique `(scope, idempotencyKey)`; index `(clientId)`. No expiry/cleanup found.

**Contract-only (not tables):** session payload, notification feed items (computed), document summary, notice staff counters, request/thread/colleague mappers (rules above).

**Documented vocabularies (all free strings):**
- Role: VIEWER, SIGNATORY, MANAGER (aliases LP_MANAGER, ADMIN, LP_VIEWER).
- Document action: VIEW, DOWNLOAD, PREVIEW. Document sourceType: GP_UPLOAD, FUND_REPORT_SYNC, QUARTERLY_STATEMENT_SYNC, TAX_RETURN_PACK_SYNC. Document category written: PERFORMANCE_REPORT, QUARTERLY_STATEMENT, TAX, MANUAL.
- Notice targetType: ALL, FUND, ORG, USER. Notice category inferred: CAPITAL_CALL, REPORT, POLICY, GENERAL. Derived notice status: PUBLISHED, DELIVERED (accepted in filters), OPENED, ACKNOWLEDGED.
- Request status: SUBMITTED, OPEN, ASSIGNED, UNDER_REVIEW, AWAITING_INVESTOR, AWAITING_INTERNAL, RESOLVED, CLOSED. Request type default PROFILE_ACCESS (others per SRD: ACCOUNT_STATEMENT, CAPITAL_ACTIVITY, OPEN_ENDED_ACTIVITY). Priority default NORMAL.
- Message authorType: INVESTOR, OPS. Thread status: OPEN.
- Bank instruction change status: SUBMITTED. Email digest default WEEKLY. Default as-of preference LATEST. Valuation status default FINAL. Operating model PRIVATE_CAPITAL | OPEN_ENDED.
- Error codes seen in these domains: `LP_UNAUTHORIZED, LP_FORBIDDEN, LP_NOT_FOUND, LP_VALIDATION, LP_IDEMPOTENCY_KEY_REUSED, LP_VERSION_CONFLICT, LP_MFA_REQUIRED, LP_UNSUPPORTED_MEDIA, LP_EXPORT_FAILED (generic 500)`.
