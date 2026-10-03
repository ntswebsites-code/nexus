export interface FundOption {
  id: string;
  ref: string;
  name: string;
  currency: string;
}

export interface PayRun {
  id: string;
  ref: string;
  fundId: string | null;
  fund: { ref: string; name: string } | null;
  from: string;
  to: string;
  status: 'CLEAN' | 'BREAKS' | 'NO_STATEMENTS';
  itemCount: number;
  matchedCount: number;
  breakCount: number;
  notDueCount: number;
  lineCount: number;
  summary: { awaitingStatement?: { documentRef: string; payee: string; dueDate: string }[]; statementsCoverTo?: string | null; bankLedgers?: number; created?: number; reopened?: number; autoCleared?: number } | null;
  runCount: number;
  runByName: string | null;
  updatedAt: string;
}

export interface PaySummary {
  items: Record<string, number>;
  openBreaks: number;
  materialOpen: number;
  pendingChecker: number;
  bySeverity: Record<string, number>;
  byKind: Record<string, number>;
  oldestAgeDays: number;
  lastRun: PayRun | null;
  defaults: { tolerance: string; graceDays: number; dateWindowDays: number };
}

export interface PayItem {
  id: string;
  kind: 'DISTRIBUTION_PAYOUT' | 'CAPITAL_CALL_RECEIPT';
  documentRef: string;
  fund: { ref: string; name: string } | null;
  payeeName: string;
  direction: 'IN' | 'OUT';
  expectedAmount: string;
  currency: string;
  dueDate: string;
  status: string;
  matchedAmount: string | null;
  matchMethod: string | null;
  deferredUntil: string | null;
  line: { id: string; valueDate: string; amount: string; reference: string | null; description: string | null } | null;
}

export interface PayBreak {
  id: string;
  ref: string;
  kind: 'MISSING_PAYMENT' | 'AMOUNT_DIFF' | 'UNPAIRED_LINE';
  label: string;
  expected: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
  difference: string | null;
  currency: string | null;
  severity: string;
  material: boolean;
  status: string;
  itemId: string | null;
  lineId: string | null;
  owner: { id: string; name: string | null } | null;
  resolution: string | null;
  rationale: string | null;
  evidenceRef: string | null;
  maker: { id: string; name: string | null } | null;
  checker: { id: string; name: string | null } | null;
  createdAt: string;
  ageDays: number;
  overdue: boolean;
  version: number;
  allowed: { assign: boolean; investigate: boolean; resolve: boolean; approve: boolean; reject: boolean; approveBlockedReason: string | null };
}

export interface PayBreakDetail {
  data: PayBreak;
  item: { id: string; kind: string; documentRef: string; payeeName: string; direction: string; expectedAmount: string; currency: string; dueDate: string; status: string } | null;
  events: { id: string; action: string; fromStatus: string | null; toStatus: string | null; actor: string | null; note: string | null; at: string }[];
}

export interface StatementLine {
  id: string;
  valueDate: string;
  amount: string;
  currency: string | null;
  ledger: string | null;
  reference: string | null;
  description: string | null;
}

export interface SettlementFail {
  id: string;
  ref: string;
  runRef: string;
  orderRef: string | null;
  ticker: string | null;
  side: string | null;
  quantity: string | null;
  tradeDate: string | null;
  expectedSettlement: string | null;
  expectedFrom: string | null;
  account: string | null;
  currency: string | null;
  daysLate: number;
  bucket: '1-2' | '3-5' | '6+';
  severity: string;
  status: string;
  owner: string | null;
  counterparty: { id: string; ref: string; name: string } | null;
  portfolio: { id: string; ref: string; name: string } | null;
  open: boolean;
}

export interface SettlementFailsResponse {
  data: SettlementFail[];
  summary: {
    asOf: string;
    open: number;
    oldestDaysLate: number;
    material: number;
    byBucket: { key: string; count: number }[];
    byCounterparty: { key: string; count: number }[];
    byTicker: { key: string; count: number }[];
    lastRun: { ref: string; asOfDate: string; status: string; updatedAt: string } | null;
    stale: boolean;
  };
}

export interface GateItem {
  key: string;
  label: string;
  ok: boolean;
  blockers: string[];
  detail: string;
}
export interface GatesResponse {
  portfolio: { id: string; ref: string; name: string };
  periodEnd: string;
  type: 'cash' | 'accounting';
  enabled: boolean;
  items: GateItem[];
  blockers: string[];
  canClose: boolean;
}

export interface PullResponse {
  adapter: string;
  asOfDate: string;
  results: { counterpartyRef: string; accountRef: string; status: string; rows?: number; message?: string }[];
  run: { ref: string; status: string; matchedCount: number; breakCount: number; rerun: boolean } | null;
  runError: string | null;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
export const KIND_LABEL: Record<string, string> = { MISSING_PAYMENT: 'Missing payment', AMOUNT_DIFF: 'Amount difference', UNPAIRED_LINE: 'Unpaired statement line', DISTRIBUTION_PAYOUT: 'Distribution payout', CAPITAL_CALL_RECEIPT: 'Capital call receipt' };
export const RESOLUTION_LABEL: Record<string, string> = { MANUAL_MATCH: 'Match to a statement line', ACCEPT_DIFFERENCE: 'Accept the difference', TIMING: 'Timing: expected later', RETURNED_PAYMENT: 'Payment returned by the bank' };
