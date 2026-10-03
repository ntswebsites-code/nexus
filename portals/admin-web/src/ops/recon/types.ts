/** Wire types for `/api/v1/recon/*` (see backend/api/src/modules/recon). Decimals are strings. */

export type Family = 'TRADES' | 'CASH' | 'HOLDINGS' | 'DAYEND_COUNT' | 'POSITIONS_VS_CUSTODY' | 'SETTLEMENT_FAILS' | 'CORP_ACTIONS';
export const FAMILIES: { key: Family; label: string }[] = [
  { key: 'TRADES', label: 'Trades' },
  { key: 'CASH', label: 'Cash' },
  { key: 'HOLDINGS', label: 'Holdings' },
  { key: 'DAYEND_COUNT', label: 'Day-end trade count' },
  { key: 'POSITIONS_VS_CUSTODY', label: 'Positions vs custody' },
  { key: 'SETTLEMENT_FAILS', label: 'Settlement fails' },
  { key: 'CORP_ACTIONS', label: 'Corporate actions' },
];
export const familyLabel = (f: string) => FAMILIES.find((x) => x.key === f)?.label ?? f;

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ['NEW', 'ASSIGNED', 'INVESTIGATING', 'PENDING_CHECKER', 'MATCHED', 'CLOSED'] as const;
export type BreakStatus = (typeof STATUSES)[number];

export const CAUSES: { key: string; label: string }[] = [
  { key: 'TIMING', label: 'Timing difference' },
  { key: 'BOOKING_ERROR', label: 'Booking error (our side)' },
  { key: 'CUSTODIAN_ERROR', label: 'Custodian error' },
  { key: 'PRICE_SOURCE', label: 'Price source' },
  { key: 'FX', label: 'FX rate' },
  { key: 'FEES', label: 'Fees' },
  { key: 'CORPORATE_ACTION', label: 'Corporate action' },
  { key: 'OTHER', label: 'Other' },
];

export interface Ref {
  id: string;
  ref: string;
  name: string;
}

export interface ReconBreak {
  id: string;
  ref: string;
  runId: string;
  runRef: string | null;
  asOfDate: string | null;
  family: Family;
  familyLabel: string;
  itemKey: string;
  kind: string;
  label: string;
  internalValue: Record<string, unknown> | null;
  externalValue: Record<string, unknown> | null;
  difference: string | null;
  differencePct: string | null;
  currency: string | null;
  cause: string | null;
  severity: Severity;
  status: BreakStatus;
  ownerUserId: string | null;
  ownerName: string | null;
  counterparty: Ref | null;
  portfolio: Ref | null;
  resolutionNote: string | null;
  evidenceRef: string | null;
  makerId: string | null;
  makerName: string | null;
  checkerId: string | null;
  checkerName: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  ageHours: number;
  ageDays: number;
  overdue: boolean;
  version: number;
  createdAt: string;
}

export interface Allowed {
  assign: boolean;
  investigate: boolean;
  resolve: boolean;
  approve: boolean;
  reject: boolean;
  approveBlockedReason: string | null;
  reopen: boolean;
  query: boolean;
  escalate: boolean;
  attachEvidence: boolean;
}

export interface BreakEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  note: string | null;
  at: string;
}

export interface BreakDetail {
  data: ReconBreak;
  allowed: Allowed;
  events: BreakEvent[];
}

export interface BreaksPage {
  data: ReconBreak[];
  total: number;
  summary: {
    open: number;
    overdue: number;
    byStatus: Record<string, number>;
    openBySeverity: Record<Severity, number>;
    openByFamily: Record<string, number>;
  };
}

export interface ReconRun {
  id: string;
  ref: string;
  family: Family;
  familyLabel: string;
  asOfDate: string;
  counterparty: Ref | null;
  portfolio: Ref | null;
  status: 'CLEAN' | 'BREAKS' | 'SOURCE_MISSING';
  matchedCount: number;
  breakCount: number;
  openBreaks: number;
  matchRate: number | null;
  params: { tolerances?: Record<string, string | number>; toleranceSources?: Record<string, string> } | null;
  summary: { missingSources?: { counterpartyRef: string; accountRef: string; reason: string }[]; unmappedAccounts?: { counterpartyRef: string; accountRef: string }[] } | null;
  runCount: number;
  runByName: string | null;
  updatedAt: string;
}

export interface RunResult {
  data: ReconRun;
  breaks: ReconBreak[];
  rerun: boolean;
}

export interface Overview {
  asOfDate: string;
  families: { family: Family; label: string; runs: number; matched: number; breaks: number; matchRate: number | null; openBreaks: number; signedOff: boolean; sourceMissing: boolean }[];
  openBySeverity: Record<Severity, number>;
  openTotal: number;
  overdue: number;
}

export interface SourceAccount {
  accountRef: string;
  portfolio: { id: string; ref: string; name: string } | null;
  mapped: boolean;
  dayEndReceived: boolean;
  dayEnd: { ref: string; status: string; tradeCount: number; receivedAt: string | null } | null;
  executions: number;
}

export interface Source {
  counterpartyId: string;
  ref: string;
  name: string;
  type: string;
  status: string;
  lastDayEnd: { ref: string; statementDate: string; receivedAt: string | null } | null;
  executionsToday: number;
  missingSource: boolean;
  unmappedAccounts: string[];
  accounts: SourceAccount[];
}

export interface CounterpartyOption {
  id: string;
  ref: string;
  name: string;
  accounts: string[];
}

export interface AccountMapRow {
  id: string;
  counterparty: Ref;
  accountRef: string;
  portfolio: Ref;
}

export interface Readiness {
  family: Family;
  asOfDate: string;
  runs: { id: string; ref: string; status: string; runByName: string | null }[];
  openMaterial: { id: string; ref: string; severity: string; status: string; label: string }[];
  openOther: number;
  missingSources: { counterpartyRef: string; accountRef: string }[];
  signedOff: { id: string; signedByName: string | null; signedAt: string } | null;
  ready: boolean;
  reasons: string[];
  canSign: boolean;
  independent: boolean;
}

export interface Signoff {
  id: string;
  family: Family;
  familyLabel: string;
  asOfDate: string;
  counterparty: Ref | null;
  signedByName: string | null;
  signedAt: string;
  note: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export interface Evidence {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  note: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface ReconAction {
  id: string;
  ref: string;
  kind: 'QUERY' | 'ESCALATION';
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  subject: string;
  body: string;
  level: number | null;
  counterparty: { id: string; ref: string; name: string } | null;
  toUserName: string | null;
  raisedByName: string | null;
  raisedAt: string;
  respondedByName: string | null;
  respondedAt: string | null;
  response: string | null;
}

export interface BreakExtras {
  evidence: Evidence[];
  actions: ReconAction[];
}

export interface Tolerance {
  id: string;
  family: Family;
  familyLabel: string;
  scope: string;
  counterparty: { id: string; name: string } | null;
  effectiveFrom: string;
  status: 'FUTURE' | 'ACTIVE_OR_SUPERSEDED';
  price: string | null;
  cash: string | null;
  holdingsPct: string | null;
  positionQty: string | null;
  settleDays: number | null;
  caCash: string | null;
  note: string | null;
  createdByName: string | null;
}

export interface EffectiveTolerances {
  family: Family;
  asOfDate: string;
  tolerances: { price: string; cash: string; holdingsPct: string; positionQty: string; settleDays: number; caCash: string };
  sources: Record<string, string>;
}

export interface FeedReceipt {
  id: string;
  counterparty: { id: string; ref?: string; name?: string };
  accountRef: string;
  asOfDate: string;
  feed: 'POSITIONS' | 'CORP_ACTIONS';
  rowCount: number;
  sha256: string;
  version: number;
  note: string | null;
  receivedByName: string | null;
  receivedAt: string;
}

export const TOLERANCE_FIELDS: { key: 'price' | 'cash' | 'holdingsPct' | 'positionQty' | 'settleDays' | 'caCash'; label: string; families: Family[]; hint: string }[] = [
  { key: 'price', label: 'Price (±)', families: ['TRADES'], hint: 'Absolute execution price; quantity is always exact.' },
  { key: 'cash', label: 'Cash (±)', families: ['CASH'], hint: 'Absolute, statement currency.' },
  { key: 'holdingsPct', label: 'Holdings (%)', families: ['HOLDINGS'], hint: 'Percent of the custodian value.' },
  { key: 'positionQty', label: 'Position quantity (±)', families: ['POSITIONS_VS_CUSTODY'], hint: 'Shares.' },
  { key: 'settleDays', label: 'Settlement grace (days)', families: ['SETTLEMENT_FAILS'], hint: 'Days after expected settlement before a fail.' },
  { key: 'caCash', label: 'Entitlement cash (±)', families: ['CORP_ACTIONS'], hint: 'Absolute net cash, event currency.' },
];
