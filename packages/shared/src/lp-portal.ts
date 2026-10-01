/**
 * LP portal contract (/api/v1/lp-portal/*). Types are copied verbatim from
 * portals/investor-web/src/lib/api/lp-portal-api.ts, the executable spec agreed with the UI
 * (DEV-PLAN 7). Money, units, rates and multiples are decimal STRINGS; counts are numbers.
 */

// ── Envelopes ──────────────────────────────────────────────────────────

export interface LpPortalMeta {
  requestId?: string
}

export interface LpPortalResponse<T = unknown> {
  success: boolean
  message?: string
  data: T
  timestamp?: string
  meta?: LpPortalMeta
}

export interface LpListData<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface LpApiErrorBody {
  code?: string
  message?: string
  fieldErrors?: Record<string, string>
  details?: Record<string, string>
  retryable?: boolean
}

// ── Session ────────────────────────────────────────────────────────────

export interface LpSessionFund {
  fundId: string
  publicReference: string
  fundName: string
  shortName: string
  operatingModel: "PRIVATE_CAPITAL" | "OPEN_ENDED"
  currencyCode: string
  shareClass: string | null
  asOfDate: string
  valuationStatus: string
  investorAccountReference: string
  commitmentAmount: string
}

export interface LpSession {
  client: {
    id: string
    legalName: string
    email: string
    investorId: string
    displayName?: string
  }
  lpRole: "VIEWER" | "SIGNATORY" | "MANAGER"
  presentationCurrency: string
  defaultAsOfDate: string
  defaultValuationStatus: string
  funds: LpSessionFund[]
  unreadCounts: {
    requests: number
    messages: number
    notices: number
    notifications: number
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────

export interface LpDashboardKpis {
  totalCommitment: string
  paidIn: string
  called?: string
  outstandingCalled?: string
  unfunded: string
  currentNav: string
  distributions: string
  netIrr: string
  tvpi: string
  dpi: string
  rvpi: string
  /** The investor's own fund commitments — the count behind Total Commitment. */
  investmentCount: number
  /** Non-exited portfolio companies held by the funds they are invested in. */
  portfolioCompanyCount?: number
}

export interface LpOpenEndedSummary {
  accountValue: string
  unitsHeld: string
  navPerUnit: string
  ytdReturn: string
}

export interface LpOpenEndedHistoryPoint {
  label: string
  navPerUnit: string
  date?: string
}

export interface LpDashboardData {
  asOfDate: string
  valuationStatus: string
  kpis: LpDashboardKpis
  openEndedSummary?: LpOpenEndedSummary | null
  openEndedHistory?: { points: LpOpenEndedHistoryPoint[] }
}

export interface LpDashboardAction {
  id: string
  type: string
  severity: string
  title: string
  fundId: string
  relatedRecordId: string
  href: string
  dueDate: string | null
  amount?: string
  fundName?: string
  label?: string
}

export interface LpRecentActivity {
  id: string
  type: string
  title: string
  fundId: string
  amount: string
  status: string
  at: string
}

// ── Capital calls ──────────────────────────────────────────────────────

export interface LpCapitalCall {
  id: string
  callNo: number
  fundId: string
  fundName: string
  issueDate: string
  dueDate: string
  currencyCode: string
  amount: string
  paid: string
  outstanding: string
  status: string
  acknowledgedAt: string | null
}

export interface LpCapitalCallWiring {
  bankName: string
  accountName: string
  accountNumber: string | null
  accountNumberMasked: string
  abaRouting: string
  reference: string
  raw: string | null
}

export interface LpCapitalCallTimelineStep {
  code: string
  at: string | null
  completed: boolean
}

export interface LpCapitalCallDetail extends LpCapitalCall {
  wiring: LpCapitalCallWiring
  timeline: LpCapitalCallTimelineStep[]
}

export interface LpCapitalCallSummary {
  openCount: number
  outstanding: string
  overdue: string
  paidYtd: string
  currencyCode: string
  paidCallCount?: number
  dueSoonCount?: number
  dueSoonAmount?: string
  totalDistributions?: string
  upcomingDistributionNotices?: { count: number; amount?: string }
}

export interface LpCapitalCallDocument {
  id: string
  name: string
  category: string
  publishedDate: string
  checksumSha256: string
  status: string
}

// ── Distributions ──────────────────────────────────────────────────────

export interface LpDistribution {
  id: string
  reference: string
  fundId: string
  fundName: string
  paymentDate: string
  type: string
  currencyCode: string
  gross: string
  adjustments: string
  netPaid: string
  status: string
  destinationBankMasked: string | null
  documentId: string | null
}

// ── Account activity / ledger ──────────────────────────────────────────

export interface LpAccountActivityEntry {
  entryId: string
  entryType: string
  fundId: string
  fundName: string
  transactionDate: string
  amount: string
  currency: string
  description: string
  status: string
  structure?: string
  operatingModel?: "PRIVATE_CAPITAL" | "OPEN_ENDED"
}

export interface LpLedgerDocument {
  id: string
  name: string
  publishedDate: string
  size?: number
}

export interface LpLedgerDetail {
  entryType: string
  allocation?: {
    id: string
    clientId: string
    currentCallAmount: string
    amountPaid: string
    status: string
  }
  payments: unknown[]
  callNoticeDocumentId?: string | null
  documents?: LpLedgerDocument[]
}

// ── Dealing ────────────────────────────────────────────────────────────

export interface LpBankAccount {
  id: string
  label: string
  bankName: string
  accountName: string
  accountNumberMasked: string
  currencyCode: string
  isDefault: boolean
  fundId: string | null
  status: string
}

export interface LpDealingRules {
  minBalanceAmount: string
  minBalanceUnits: string
  noticeDays: number
  dealingFrequency: string
  nextEligibleDealingDate: string
  settlementLagDays: number
  subscription: {
    mgmtFeeRate: string
    otherFeeFlat: string
    maxFileMb: number
  }
  redemption: {
    feeRate: string
    modes: Array<"AMOUNT" | "UNITS" | "FULL">
  }
}

export interface LpDealingCompliance {
  accreditedInvestor: boolean
  kycStatus: string
  noUnsettledCapitalCalls?: boolean
  noLegalHolds: boolean
  blockers: string[]
  termsUrl?: string | null
  holdReason?: string | null
}

export interface LpDealingOverview {
  fundId: string
  shareClass: string
  asOfDate: string
  valuationStatus: string
  navPerUnit: string
  accountValue: string
  unitsHeld: string
  availableToRedeemValue: string
  availableUnits: string
  pendingSubscriptions: string
  pendingRedemptions: string
  rules: LpDealingRules & { compliance?: LpDealingCompliance }
  compliance: LpDealingCompliance
}

export interface LpDealingRequest {
  id: string
  fundId: string
  fundName?: string
  shareClass?: string
  requestType: "SUBSCRIPTION" | "REDEMPTION"
  status: string
  amount: string
  units: string
  redemptionMode: string | null
  currencyCode: string
  requestedDealingDate: string
  estimateSnapshotId: string
  isEstimate: boolean
  createdAt: string
  notes?: string | null
}

export interface LpSubscriptionEstimate {
  estimateSnapshotId: string
  navPerUnit: string
  estimatedUnits: string
  managementFee: string
  otherFees: string
  estimatedTotalInvestment: string
  isEstimate: boolean
  disclaimer: string
}

export interface LpRedemptionEstimate {
  estimateSnapshotId: string
  estimatedUnitsToCancel: string
  estimatedSettlementAmount: string
  earliestDealingDate: string
  estimatedSettlementDate: string
  noticeDays: number
  aboveMinBalance: boolean
  isEstimate: boolean
  redemptionFee: string
  disclaimer: string
}

// ── Performance ────────────────────────────────────────────────────────

export interface LpPerformanceMetrics {
  totalCommitment: string
  paidIn: string
  distributions: string
  currentNav: string
  netIrr: string
  tvpi: string
  dpi: string
  rvpi: string
}

export interface LpPerformanceByFundRow {
  fundId: string
  fundName: string
  /**
   * Private-capital multiples. Null for OPEN_ENDED funds, which have no called or paid-in capital
   * to define them against — see SRD sections 3 and 37. Render an absent measure as "—", never 0.
   */
  netIrr: string | null
  tvpi: string | null
  dpi: string | null
  rvpi: string | null
  nav: string
  paidIn: string
  distributions: string
  operatingModel?: "PRIVATE_CAPITAL" | "OPEN_ENDED"
  structure?: string
}

export interface LpOpenEndedMetrics {
  ytdReturn: string
  navPerUnit: string
  unitsHeld: string
  accountValue: string
}

export interface LpPerformanceData {
  asOfDate: string
  valuationStatus: string
  period: string
  calculationDate: string
  version: string
  sourceModule: string
  reportingCurrency: string
  approvedBy: string | null
  metrics: LpPerformanceMetrics
  byFund: LpPerformanceByFundRow[]
  benchmark: unknown | null
  openEndedMetrics?: LpOpenEndedMetrics
}

export interface LpPerformanceHistoryPoint {
  date: string
  label: string
  nav: string
  paidIn: string
  distributions: string
}

export interface LpPerformanceHistory {
  asOfDate: string
  valuationStatus: string
  range: string
  points: LpPerformanceHistoryPoint[]
}

export interface LpBenchmarkSeries {
  metric: string
  benchmarkId?: string
  asOfDate: string
  /** FINAL when approved points exist, otherwise UNAVAILABLE. */
  valuationStatus: string
  /** False when no approved series is configured for this benchmark and metric. */
  configured?: boolean
  series: Array<{ date: string; label: string; value: string }>
  source?: string | null
  approvedAt?: string | null
  /** Only set when the benchmark is not configured; never developer placeholder prose. */
  note: string | null
}

export interface LpJobStatus {
  jobId: string
  jobType: string
  status: string
  result?: unknown
  downloadUrl?: string | null
  errorMessage?: string | null
  createdAt: string
  completedAt?: string | null
}

// ── Documents ──────────────────────────────────────────────────────────

export interface LpDocument {
  id: string
  name: string
  fundId: string
  fundName: string
  category: string
  period: string | null
  publishedDate: string
  version: string
  status: string
  accessScope: string
  checksumSha256: string
  permissions: string[]
  sourceType?: string
  sourceRefId?: string
  fileSizeBytes?: number
  /** Null when the file has no stored page count. */
  pageCount?: number | null
  mimeType?: string
  history?: Array<{ user: string; action: string; at: string; ip: string }>
}

export interface LpDocumentsSummaryCategoryCount {
  category: string
  count: number
}

export interface LpDocumentsSummary {
  total?: number
  byCategory?: LpDocumentsSummaryCategoryCount[]
  newThisWeek?: number
  requiresSignature?: number
  secureDownloadsYtd?: number
}

export interface LpVaultDocument {
  documentId: string
  category: string
  title: string
  fundId: string
  fundName: string
  publishedAt: string
  sourceType: string
  sha256: string
}

// ── Notices ────────────────────────────────────────────────────────────

export interface LpNotice {
  id: string
  title: string
  status: string
  fundId: string
  fundName?: string
  shareClass: string | null
  publishedAt: string
  acknowledgedAt: string | null
  category?: string
  kind?: string
  requiresAcknowledgement?: boolean
  preview?: string
  body?: string
  openedAt?: string | null
}

// ── Requests & messages ────────────────────────────────────────────────

export interface LpServiceRequestAttachment {
  id: string
  name: string
  size: number
  downloadUrl?: string
}

export interface LpRequestAttachment {
  id: string
  name: string
  size: number
  mimeType?: string
  uploadedAt: string
}

export interface LpServiceRequest {
  id: string
  reference: string
  type: string
  fundId: string
  fundName: string
  status: string
  subject: string
  description: string
  createdAt: string
  updatedAt: string
  priority?: string
  /** The API returns an actor object here, not a bare name. */
  submittedBy?: string | { id?: string; email?: string; name?: string } | null
  attachments?: LpServiceRequestAttachment[]
  messages?: Array<{
    id: string
    authorType: string
    authorId: string
    body: string
    createdAt: string
    attachments?: LpServiceRequestAttachment[]
  }>
}

export interface LpMessageThreadSummary {
  id: string
  subject: string
  fundId: string
  fundName: string
  relatedType: string
  relatedId: string
  status: string
  lastMessageAt: string
  lastMessagePreview: string
  unreadCount: number
}

export interface LpMessageThreadParticipant {
  name: string
  initials?: string
  role?: string
}

export interface LpMessageThreadDetail {
  id: string
  subject: string
  fundId: string
  fundName: string
  relatedType: string
  relatedId: string
  status: string
  participants?: LpMessageThreadParticipant[]
  messages: Array<{
    id: string
    authorType: string
    authorId: string
    body: string
    readAt: string | null
    createdAt: string
    attachments?: LpServiceRequestAttachment[]
  }>
}

// ── Organisation & settings ─────────────────────────────────────────────

export interface LpColleague {
  membershipId: string
  userId: string
  email: string
  name: string
  lpRole: string
  fundIds: string[]
  isActive: boolean
  status: string
  revokedAt: string | null
  mfaEnabled?: boolean
  lastActiveAt?: string | null
}

export interface LpOrganisation {
  id: string
  legalName: string
  investorId: string
  email: string
  country: string
  phone: string
  address: string
  status: string
  lpRole: string
  colleagues: LpColleague[]
}

export interface LpNotificationPreferences {
  emailCapitalCalls: boolean
  emailDistributions: boolean
  emailDocuments: boolean
  emailMessages: boolean
  emailNotices: boolean
  inAppCapitalCalls?: boolean
  inAppDistributions?: boolean
  inAppDocuments?: boolean
  inAppMessages?: boolean
  inAppNotices?: boolean
  digest?: "daily" | "weekly" | "off" | null
}

export interface LpSettings {
  notifications: LpNotificationPreferences
  mfa: {
    requireMfaForLp: boolean
    issuerName: string
    enabled: boolean
    enabledAt: string | null
    manageUrl?: string | null
    sessionsUrl?: string | null
    passwordUrl?: string | null
  }
  presentationCurrency: string
  defaultAsOfPreference?: string
}

export interface LpDisplaySettings {
  presentationCurrency?: string
  defaultAsOfPreference?: string
}

export interface LpNotificationItem {
  id: string
  title: string
  href: string
  fundName?: string
  createdAt: string
  type?: string
  read?: boolean
}

export interface LpBankInstructionChange {
  id: string
  fundId: string
  fundName?: string
  bankName?: string
  accountNumberMasked: string
  requestedBy: string
  submittedAt: string
  status: string
}

export interface LpRealtimeInfo {
  enabled: boolean
  wsUrl?: string
  namespace?: string
  events?: string[]
  pollingIntervalMs?: number
}

// ── Legacy reports (thin list) ───────────────────────────────────────────

export interface LpReportMetrics {
  dpi: number
  nav: number
  rvpi: number
  tvpi: number
  fundId: string
  netIrr: number
  clientId: string
  fundName: string
  periodEnd: string
  lpLegalName: string
  periodStart: string
  totalPaidIn: number
  currencyCode: string
  holdingsSummary: string
  totalCommitment: number
  totalDistributions: number
  unfundedCommitment: number
}

export interface LpReport {
  jobId: string
  runId: string
  fundName: string
  templateName: string
  reportLevel: string
  periodStart: string
  periodEnd: string
  status: string
  deliveredAt: string
  transportMethod: string
  metrics: LpReportMetrics
}

export interface LpReportsPagination {
  page: number
  limit: number
  total: number
  pages: number
}

// ── Legacy dashboard shape (old components) ────────────────────────────

export interface LpClientInfo {
  id: string
  legalName: string
  email: string
  investorId: string
}

export interface LpFundSummary {
  fundId: string
  fundName: string
  commitment: number
  paidIn: number
  distributions: number
  nav: number
  dpi: number
  tvpi: number
  rvpi: number
  netIrr: number
  currencyCode: string
}

export interface LpDashboard {
  client: LpClientInfo
  lpRole: string | null
  presentationCurrency: "USD" | "ZIG"
  funds: LpFundSummary[]
  exchangeRateWidget: null
  latestReports: unknown[]
}

export type LpVaultCategory =
  | "TAX"
  | "AUDIT"
  | "PERFORMANCE_REPORT"
  | "CALL_NOTICE"
  | "MANUAL"
  | "QUARTERLY_STATEMENT"
  | "LEGAL"

export interface LpVaultVerifyResult {
  documentId: string
  verified: boolean
  expectedSha256: string
  actualSha256: string
}

export type LedgerEntryType = "CAPITAL_CALL" | "DISTRIBUTION" | "FEE" | "OTHER"

export interface LpLedgerEntry {
  entryId: string
  entryType: string
  fundId: string
  fundName: string
  transactionDate: string
  amount: string
  currency: string
  description: string
  status: string
}

export interface LpLedgerEntryDetail extends LpLedgerDetail {
  entryId?: string
}
