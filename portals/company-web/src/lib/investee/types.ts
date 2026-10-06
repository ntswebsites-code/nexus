/**
 * Payload types for `/api/v1/investee-portal/*`. These are the shapes the Investee runtime reads
 * from its live payload (see `live*Record()` / `live*()` in matanho-investee-portal-runtime.js),
 * ported field for field from the NVCCZ applicant API that the runtime was written against.
 * Fields marked "Nexus" are additions the NVCCZ API never returned.
 *
 * Responses may arrive bare or wrapped in `{ success, data, message?, timestamp? }`; the adapter
 * unwraps either form, so every type below is the unwrapped `data`.
 */

export interface InvesteeProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  userDepartment: string | null;
  roleCode: string | null;
  createdAt: string;
  updatedAt: string;
  name?: string;
  accessProfile?: string;
  title?: string | null;
  mfaEnabled?: boolean;
  company?: { id: string; name: string; fundName?: string | null };
  /** Every workspace this account belongs to (INO-006). */
  companies?: Array<{ id: string; name: string; accessProfile: string; current: boolean }>;
}

/** PUT /profile. Email is not editable from the portal (it is the sign-in identifier). */
export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
}

export interface FinancialKpis {
  kpis?: Array<Record<string, unknown>>;
  metrics?: Array<Record<string, unknown>>;
  definitions?: Array<Record<string, unknown>>;
  /** period key -> metric name -> value (nested buckets are flattened by the host before render). */
  kpiValues?: Record<string, Record<string, unknown>>;
}

export interface InvesteeCompany {
  id: string;
  name: string;
  registrationNumber: string | null;
  industry: string | null;
  foundingDate: string | null;
  address: string | null;
  website: string | null;
  description: string | null;
  logoUrl: string | null;
  status: string;
  companySize: string | null;
  employeeCount: number | null;
  annualRevenue: number | string | null;
  fundingStage: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  fundId: string | null;
  startDate: string | null;
  endDate: string | null;
  capTable: unknown | null;
  financialKpis: FinancialKpis | null;
  createdAt: string;
  updatedAt: string;
  fund?: { id: string; name: string; description?: string | null } | null;
}

/** PUT /company. Whitelisted fields only; legal name and registration number are staff-managed. */
export interface UpdateCompanyRequest {
  industry?: string;
  website?: string;
  description?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface Letterhead {
  id: string;
  portfolioCompanyId: string;
  legalName: string;
  registrationNumber: string | null;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  addressLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

/** PUT /letterhead (company taken from the session, never from the URL). */
export interface UpdateLetterheadRequest {
  legalName?: string;
  registrationNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  line1?: string;
  line2?: string | null;
  city?: string;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
}

export interface DashboardApplication {
  id: string;
  currentStage: string;
  submittedAt: string | null;
  businessName: string;
  requestedAmount: string | number | null;
  industry: string | null;
  businessStage: string | null;
  applicationProgress?: number;
  approvedAmount?: string | number | null;
}

export interface DashboardPortfolioCompany {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  fundingStage: string | null;
}

export interface DashboardSummary {
  hasApplication: boolean;
  hasPortfolioCompany: boolean;
  hasReceivedInvestment: boolean;
  applicationStage: string | null;
  companyStatus: string | null;
  applicationProgress: number;
  requestedAmount: number | null;
  approvedAmount: number | null;
}

export interface DashboardActivity {
  id: string;
  notificationType?: string;
  title: string;
  message?: string;
  createdAt: string;
}

export interface InvesteeDashboard {
  hasReceivedInvestment: boolean;
  application: DashboardApplication | null;
  portfolioCompany: DashboardPortfolioCompany | null;
  recentActivities: DashboardActivity[];
  summary: DashboardSummary;
}

export interface TermSheetSignature {
  signatureUrl: string | null;
  signatureFileName: string | null;
  signedAt: string | null;
  signedBy?: string | null;
}

export interface TermSheet {
  id: string;
  applicationId: string | null;
  title: string;
  version: string;
  /** e.g. DRAFT, FINAL, ISSUED, SIGNED, DECLINED */
  status: string;
  investmentAmount: number | string | null;
  equityPercentage: number | string | null;
  valuation: number | string | null;
  keyTerms: string | null;
  conditions: string | null;
  timeline: string | null;
  documentUrl: string | null;
  documentFileName: string | null;
  documentSize: number | null;
  isDraft: boolean;
  isFinal: boolean;
  isSigned: boolean;
  signedAt: string | null;
  applicantSignatureUrl?: string | null;
  applicantSignedAt?: string | null;
  investorSignatureUrl?: string | null;
  investorSignedAt?: string | null;
  applicantSignature?: TermSheetSignature | null;
  investorSignature?: TermSheetSignature | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; firstName: string; lastName: string; email?: string } | null;
  application?: { id: string; businessName: string; applicantName?: string; currentStage: string } | null;
  /** Nexus: exact consent wording the signer must accept. */
  consentText?: string | null;
  /** Nexus: `{ version, text, hash }` from the term-sheet view. Sign echoes `version`. */
  consent?: { version: string; text: string; hash: string } | null;
  /** Nexus: SHA-256 of the document being signed. */
  documentHash?: string | null;
  /** Nexus */
  declinedAt?: string | null;
  /** Nexus */
  declineReason?: string | null;
}

export interface TermSheetList {
  termSheets: TermSheet[];
  total: number;
  page: number;
  totalPages: number;
}

/** POST /term-sheets/:id/sign, multipart. */
export interface SignTermSheetRequest {
  signature: Blob;
  name: string;
  consent: true;
  /** The `consent.version` from the term sheet being signed (`ts-esign-v1`). */
  consentTextVersion: string;
}

export interface DeclineTermSheetRequest {
  reason: string;
}

export type FinancialReportType =
  | 'BALANCE_SHEET'
  | 'INCOME_STATEMENT'
  | 'CASHFLOW_STATEMENT'
  | 'INCOME_STATEMENTS'
  | 'CASHFLOW_STATEMENTS'
  | 'STATEMENT_OF_FINANCIAL_POSITION'
  | 'BUSINESS_PLAN'
  | 'OPERATIONAL_KPIS';

export type PeriodType = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

export type FinancialReportStatus = 'DRAFT' | 'PENDING' | 'SUBMITTED' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED' | 'NEEDS_REVISION';

export interface FinancialReport {
  id: string;
  portfolioCompanyId: string;
  companyName: string;
  reportType: FinancialReportType;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  reportingPeriod?: string | null;
  title: string;
  description: string | null;
  reportUrl: string | null;
  fileUrl?: string | null;
  templateVersion: string;
  status: FinancialReportStatus;
  totalRevenue?: number | string | null;
  netProfit?: number | string | null;
  cashFlowNet?: number | string | null;
  reviewerId?: string | null;
  reviewedAt?: string | null;
  reviewerComment?: string | null;
  isDraft: boolean;
  canSubmit: boolean;
  canUploadFile?: boolean;
  canDownload: boolean;
  data?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** GET /financial-reports answers either an array or this page object. */
export interface FinancialReportPage {
  page: number;
  limit: number;
  total: number;
  items: FinancialReport[];
}

export interface ReportingRequest {
  id: string;
  portfolioCompanyId?: string;
  companyName?: string;
  /** ISO date (period end) or a period label */
  reportingPeriod: string;
  dueDate: string;
  version?: number;
  status?: 'OPEN' | 'SUBMITTED' | string;
  portalStatus?: 'REPORTING_OPEN' | 'SUBMITTED' | string;
  lastRequestedAt?: string;
  periodStart?: string;
  periodEnd?: string;
  label?: string;
  canEdit?: boolean;
  canSubmit?: boolean;
  mandatoryAttachments?: Array<{ name: string; formats: string[] }>;
}

export type FinancialStatementKind = 'income-statement' | 'balance-sheet' | 'cash-flow';

export interface FinancialReportDraftRequest {
  /** YYYY-MM-DD */
  reportingPeriod: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  title: string;
  description?: string;
  templateVersion?: string;
  version?: number;
  data: Record<string, unknown>;
}

export interface FinancialReportDraft {
  id: string;
  status?: string;
  reportType: string;
  reportingPeriod?: string;
}

export interface SubmitPeriodKpisRequest {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  netProfit: number;
  cashFlowNet: number;
}

export interface PeriodKpis {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number | string | null;
  netProfit: number | string | null;
  cashFlowNet: number | string | null;
}

export interface StartThreadRequest {
  recipientTeam: string;
  subject: string;
  body: string;
}

export interface InvesteeThread {
  id: string;
  subject: string;
  recipientTeam?: string;
  createdAt: string;
}

export interface WorkspaceDocument {
  id: string;
  ref?: string;
  fileName?: string;
  name?: string;
  documentType?: string;
  type?: string;
  isSubmitted?: boolean;
  uploadedAt?: string;
  updatedAt?: string;
  status?: string;
  version?: number;
}

export interface VaultVersionEntry {
  version: number;
  fileName: string;
  size: number | null;
  mime: string;
  sha256: string;
  uploadedById: string | null;
  uploadedAt: string;
}

export interface VaultVersions {
  id: string;
  ref: string;
  name: string;
  version: number;
  versions: VaultVersionEntry[];
}

export interface VaultDownloadUrl {
  url: string;
  expiresIn: number;
  name: string;
  version: number;
  inline: boolean;
}

export interface InvesteeApplication {
  id: string;
  businessName: string;
  currentStage: string;
  requestedAmount: number | null;
  documents: WorkspaceDocument[];
}

export interface InvesteeRequisition {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  sourcingCategory: string;
  currency: string;
  estimatedAmount: number;
  needBy: string;
  createdByName: string;
  createdById?: string;
  createdAt?: string;
  note?: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  rfqSentAt?: string | null;
  poRef?: string | null;
  hoursPending?: number | null;
  slaBreached?: boolean;
  canResubmit?: boolean;
}

export interface TrancheLedger {
  currency: string;
  source: string;
  configured: boolean;
  committed: number;
  reserved: number;
  available: number;
  approvedThisQuarter: number;
  totalApproved: number;
}

export interface CapShareholder {
  id: string;
  name: string;
  type: string;
  shares: number;
  pct: number;
  color: string;
}

export interface CapTableView {
  asOf: string;
  derived: boolean;
  shareholders: CapShareholder[];
  classes: { name: string; outstanding: number; voting: string; preference: string; conversion: string; status: string }[];
}

export interface GovernanceView {
  consents: { id: string; title: string; basis: string; submitted: string; due: string; owner: string; status: string; note: string }[];
  actions: { id: string; title: string; owner: string; due: string; evidence: string; status: string }[];
  reservedMatters: { name: string; detail: string }[];
  calendar: { title: string; due: string; status: string }[];
  metrics: { pendingConsents: number; openActions: number };
}

export interface GovernanceFullView extends GovernanceView {
  meetings?: unknown[];
  metrics: GovernanceView['metrics'] & {
    upcomingMeetings?: number;
    complianceHealth?: { due: number; onTime: number; ratio: number | null };
  };
  reservedMatters: { name: string; detail: string; noticeDays: number }[];
  calendar: { title: string; due: string; status: string; kind?: string }[];
}

export const FORECAST_INPUT_METRICS = [
  'merchantRevenue',
  'enterpriseRevenue',
  'otherRevenue',
  'processingCosts',
  'supportLosses',
  'salesMarketing',
  'productEngineering',
  'generalAdmin',
  'operatingCash',
  'capex',
  'financing',
  'openingCash',
  'minimumCash',
] as const;

export type ForecastInputMetric = (typeof FORECAST_INPUT_METRICS)[number];
export type ForecastCells = Partial<Record<ForecastInputMetric, Record<string, number>>>;

export interface ForecastPnlMonth {
  totalRevenue: number;
  grossProfit: number;
  ebitda: number;
  ebitdaMargin: number;
  openingCash: number;
  operatingCash: number;
  capex: number;
  financing: number;
  closingCash: number;
  minimumCash: number;
  liquidityHeadroom: number;
}

export interface ForecastView {
  scenario: string;
  months: { key: string; label: string; stage: string; locked?: boolean }[];
  actuals: Record<string, number | null>;
  forecast: Record<string, number | null>;
  scenarios: Record<string, { revenue: number; note: string }>;
}

export interface ForecastWorkingView extends ForecastView {
  lockedPeriods: string[];
  activeRevenue: number;
  workingVersion: number;
  latestSubmittedVersion: number | null;
  submittedVersions: { versionNo: number; scenario: string; submittedAt: string; sha256: string }[];
  cells: ForecastCells;
  pnl: { firstForecastMonth: string; months: Record<string, ForecastPnlMonth>; annual: ForecastPnlMonth };
}

export interface ForecastVersionDetail {
  versionNo: number;
  scenario: string;
  submittedAt: string;
  sha256: string;
  submittedBy: string;
  data: { scenario: string; cells: ForecastCells; pnl: ForecastWorkingView['pnl'] };
}

export interface InvesteeTeamMember {
  id: string;
  name: string;
  email: string;
  title: string | null;
  accessProfile: string;
  status: string;
  lastActiveAt: string | null;
  mfaEnabled: boolean;
  signingAuthority?: boolean;
  isYou?: boolean;
}

export interface InvesteeMessage {
  who: string;
  name: string;
  at: string;
  text: string;
}

export interface InvesteeConversation {
  id: string;
  title: string;
  from: string;
  role: string;
  opened: string;
  status: string;
  messages: InvesteeMessage[];
}

/** The object handed to the runtime's `hydrate()`. Keys mirror the NVCCZ host loader. */
export interface InvesteeSettings {
  security: { mfaEnabled: boolean; mfaRequired: boolean; sessionTimeoutMinutes: number };
  accessProfile: string;
}

export interface KpiCentre {
  definitions: Array<{ id: string; label: string; unit: string; prev: number; budget: number; invert: boolean; series: number[]; latest: number | null }>;
  periods: Array<{ reportingPeriod: string; label: string; status: string; values: Record<string, number | ''> }>;
}

export interface InvesteeLivePayload {
  profile: InvesteeProfile | null;
  company: InvesteeCompany | null;
  dashboard: InvesteeDashboard | null;
  termSheets: TermSheet[] | null;
  reportingRequests: ReportingRequest[] | null;
  financialReports: FinancialReport[] | null;
  application: InvesteeApplication | null;
  drawdown: { requisitions: InvesteeRequisition[] } | null;
  capTable: CapTableView | null;
  governance: GovernanceView | null;
  forecast: ForecastView | null;
  threads: InvesteeConversation[] | null;
  team: InvesteeTeamMember[] | null;
  letterhead: Letterhead | null;
  settings: InvesteeSettings | null;
  /** GET /kpis: company KPI definitions with labels, units and the latest value. */
  kpis: KpiCentre | null;
  /** Workspace e-signature requests (SIG-xxxx). */
  workspaceSignatures: Array<{ ref: string; title: string; status: string; createdBy: string; expiresAt: string; completedAt: string | null; signers: Array<{ name: string; status: string }> }> | null;
  /** Unread/recent notifications for the bell. */
  notifications: Array<{ id: string; title: string; body?: string | null; link?: string | null; createdAt: string; readAt: string | null }> | null;
  /** True when the account is not linked to any portfolio company. */
  noCompany: boolean;
  errors: string[];
  /** runtime page id -> error message shown instead of the page */
  pageErrors: Record<string, string>;
}
