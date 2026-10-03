'use client';

import { formatDecimal } from './money';

// ------------------------------------------------------------------ types (mirror /api/v1/cash)

export interface LedgerRow {
  id: string;
  ref: string;
  name: string;
  portfolioId: string;
  portfolioName: string | null;
  currency: string;
  kind: 'BANK' | 'CONTROL' | 'CLEARING' | 'SUSPENSE' | 'EXPENSE';
  minBuffer: string;
  tolerance: string;
  status: string;
}

export interface BalanceRow {
  ledgerId: string;
  ref: string;
  name: string;
  portfolioId: string;
  portfolioName: string | null;
  currency: string;
  status: string;
  posted: string;
  reserved: string;
  minBuffer: string;
  expectedNet: string;
  available: string;
  withdrawable: string;
}

export interface Balances {
  asOf: string;
  calculation: string;
  note: string;
  ledgers: BalanceRow[];
  totals: { portfolioId: string; portfolioName: string | null; currency: string; posted: string; reserved: string; available: string; expectedNet: string }[];
}

export interface Explain {
  ref: string;
  name: string;
  currency: string;
  formula: string;
  posted: string;
  reserved: string;
  minBuffer: string;
  available: string;
  journalLines: { journalId: string; ref: string; entryDate: string; status: string; description: string; signed: string }[];
  reservations: { id: string; ref: string; source: string; purpose: string; remaining: string }[];
}

export interface CashJournalRow {
  id: string;
  ref: string;
  portfolioId: string;
  portfolioName: string | null;
  entryDate: string;
  description: string;
  purpose: string;
  sourceRef: string | null;
  evidenceRef: string | null;
  currency: string;
  status: string;
  totalDebit: string;
  totalCredit: string;
  makerId: string;
  makerName: string | null;
  postedByName: string | null;
  postedAt: string | null;
  rejectReason: string | null;
  expectationId: string | null;
  reservationId: string | null;
  reversalOfId: string | null;
  reversalOfRef: string | null;
  reversedById: string | null;
  reversedByRef: string | null;
  reverseReason: string | null;
}

export interface CashJournalList {
  data: CashJournalRow[];
  total: number;
  summary: { byStatus: Record<string, number>; drafts: number; pendingApproval: number; posted: number };
}

export interface CashJournalDetail extends CashJournalRow {
  periodClosed: boolean;
  lines: { id: string; lineNo: number; ledgerId: string; ledgerRef: string; ledgerName: string; ledgerKind: string; debit: string; credit: string; memo: string | null }[];
  timeline: { at: string; action: string; actor: string; reason: string | null }[];
  allowed: { edit: boolean; submit: boolean; discard: boolean; returnToMaker: boolean; reject: boolean; post: boolean; postBlocker: string | null; reverse: boolean };
}

export interface ReservationRow {
  id: string;
  ref: string;
  portfolioName: string | null;
  ledgerRef: string | null;
  ledgerName: string | null;
  source: string;
  purpose: string;
  currency: string;
  amount: string;
  consumed: string;
  remaining: string;
  requiredDate: string;
  expiresOn: string | null;
  lapsed: boolean;
  status: string;
  createdByName: string | null;
  releaseReason: string | null;
}

export interface ExpectationRow {
  id: string;
  ref: string;
  portfolioName: string | null;
  ledgerRef: string | null;
  ledgerName: string | null;
  direction: 'IN' | 'OUT';
  kind: string;
  source: string | null;
  currency: string;
  amount: string;
  signedAmount: string;
  expectedDate: string;
  status: string;
  journalId: string | null;
  note: string | null;
}

export interface ImportRow {
  id: string;
  ref: string;
  ledgerRef: string | null;
  ledgerName: string | null;
  currency: string | null;
  portfolioName: string | null;
  filename: string;
  format: string;
  statementFrom: string;
  statementTo: string;
  openingBalance: string;
  closingBalance: string;
  lineCount: number;
  unmatchedLines: number;
  variance: string;
  status: string;
  makerName: string | null;
  checkerName: string | null;
  rejectReason: string | null;
}

export interface ImportDetail extends ImportRow {
  lines: { id: string; lineNo: number; valueDate: string; amount: string; reference: string | null; description: string | null; status: string; matchedJournalId: string | null; note: string | null }[];
  timeline: { at: string; action: string; actor: string; reason: string | null }[];
  allowed: { commit: boolean; commitBlocker: string | null; reject: boolean };
}

export interface CloseRow {
  id: string;
  portfolioId: string;
  portfolioName: string | null;
  periodEnd: string;
  status: 'PREPARED' | 'APPROVED' | 'CLOSED';
  preparedByName: string | null;
  approvedByName: string | null;
  closedByName: string | null;
  closedAt: string | null;
  reopenReason: string | null;
}

export interface PrecheckItem {
  key: string;
  label: string;
  ok: boolean;
  blockers: string[];
  detail: string;
}

export interface CloseDetail extends CloseRow {
  checklist: PrecheckItem[];
  blockers: string[];
  canClose: boolean;
}

// ------------------------------------------------------------------ presentation

export const money2 = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatDecimal(v, 2));
/** Blank for a zero side so the debit and credit columns read like a ledger. */
export const side = (v: string) => (/^0+(\.0+)?$/.test(v) ? '' : money2(v));
export const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

const TONE: Record<string, string> = {
  DRAFT: 'grey',
  PENDING_APPROVAL: 'amber',
  POSTED: 'green',
  REVERSED: 'blue',
  REJECTED: 'red',
  DISCARDED: 'grey',
  ACTIVE: 'amber',
  PARTIALLY_CONSUMED: 'amber',
  CONSUMED: 'green',
  RELEASED: 'grey',
  EXPIRED: 'grey',
  EXPECTED: 'blue',
  DUE: 'amber',
  CANCELLED: 'grey',
  STAGED: 'amber',
  COMMITTED: 'green',
  MATCHED: 'green',
  UNMATCHED: 'amber',
  IGNORED: 'grey',
  PREPARED: 'amber',
  APPROVED: 'blue',
  CLOSED: 'green',
};
export function CashBadge({ status }: { status: string }) {
  return <span className={`ops-badge ${TONE[status] ?? 'grey'}`}>{label(status)}</span>;
}

export const PURPOSES = ['BUY_SETTLEMENT', 'CLIENT_DEPOSIT', 'CLIENT_WITHDRAWAL', 'EXTERNAL_FEE', 'TRANSFER', 'MANUAL_CORRECTION'];
export const RESERVATION_PURPOSES = ['BUY_SETTLEMENT', 'WITHDRAWAL', 'TRANSFER'];
export const EXPECTATION_KINDS = ['SETTLEMENT', 'DIVIDEND', 'CAPITAL_CALL', 'DISTRIBUTION', 'FEE', 'OTHER'];
export const JOURNAL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'REJECTED', 'DISCARDED'];

export const ACTION_LABEL: Record<string, string> = {
  'cash.journal_created': 'Created',
  'cash.journal_updated': 'Edited',
  'cash.journal_submitted': 'Submitted for approval',
  'cash.journal_returned': 'Returned to the creator',
  'cash.journal_rejected': 'Rejected',
  'cash.journal_discarded': 'Discarded',
  'cash.journal_posted': 'Posted',
  'cash.journal_reversed': 'Reversed',
  'cash.import_staged': 'Staged',
  'cash.import_committed': 'Committed',
  'cash.import_rejected': 'Rejected',
  'cash.statement_line_matched': 'Line matched',
  'cash.statement_line_ignored': 'Line written off',
};
