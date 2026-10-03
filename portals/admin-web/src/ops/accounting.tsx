'use client';

import { formatDecimal } from './money';

// ------------------------------------------------------------------ types (mirror /api/v1/accounting)

export type JournalStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'REVERSED' | 'DISCARDED';
export type PeriodStatus = 'OPEN' | 'CLOSING' | 'CLOSED';
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export const ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

export interface AccountRow {
  id: string;
  portfolioId: string;
  code: string;
  name: string;
  type: AccountType;
  description: string | null;
  isActive: boolean;
}

export interface JournalRow {
  id: string;
  ref: string;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  entryDate: string;
  description: string;
  currency: string;
  status: JournalStatus;
  totalDebit: string;
  totalCredit: string;
  makerId: string;
  makerName: string | null;
  postedByName: string | null;
  postedAt: string | null;
  reversalOfId: string | null;
  reversalOfRef: string | null;
  reversedById: string | null;
  reversedByRef: string | null;
  reverseReason: string | null;
}

export interface JournalList {
  data: JournalRow[];
  total: number;
  summary: { byStatus: Record<string, number>; drafts: number; pendingApproval: number; posted: number };
}

export interface JournalDetail extends JournalRow {
  periodId: string | null;
  periodStatus: PeriodStatus | null;
  lines: { id: string; lineNo: number; accountId: string; accountCode: string; accountName: string; accountType: string; debit: string; credit: string; memo: string | null }[];
  timeline: { at: string; action: string; actor: string; reason: string | null }[];
  allowed: { edit: boolean; submit: boolean; discard: boolean; returnToMaker: boolean; post: boolean; postBlocker: string | null; reverse: boolean };
}

export interface TrialBalance {
  portfolioId: string;
  asOf: string;
  rows: { accountId: string; code: string; name: string; type: string; isActive: boolean; periodDebits: string; periodCredits: string; debit: string; credit: string; balance: string }[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  difference: string;
}

export interface Ledger {
  account: { id: string; code: string; name: string; type: string };
  openingBalance: string;
  closingBalance: string;
  lines: { journalId: string; ref: string; entryDate: string; description: string; memo: string | null; status: string; debit: string; credit: string; balance: string }[];
}

export interface PeriodRow {
  id: string;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  periodStart: string;
  periodEnd: string;
  month: string;
  status: PeriodStatus;
  unpostedJournals: number;
  closingByName: string | null;
  closedByName: string | null;
  closedAt: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  blockers: string[];
  detail: string;
}

export interface PeriodDetail extends PeriodRow {
  checklist: ChecklistItem[];
  blockers: string[];
  canClose: boolean;
  trialBalance: { totalDebit: string; totalCredit: string; balanced: boolean };
}

// ------------------------------------------------------------------ presentation

export const JOURNAL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  POSTED: 'Posted',
  REVERSED: 'Reversed',
  DISCARDED: 'Discarded',
};
const JTONE: Record<string, string> = { DRAFT: 'grey', PENDING_APPROVAL: 'amber', POSTED: 'green', REVERSED: 'blue', DISCARDED: 'grey' };
export function JournalStatusBadge({ status }: { status: string }) {
  return <span className={`ops-badge ${JTONE[status] ?? 'grey'}`}>{JOURNAL_STATUS_LABEL[status] ?? status}</span>;
}

const PTONE: Record<string, string> = { OPEN: 'blue', CLOSING: 'amber', CLOSED: 'green' };
export function PeriodStatusBadge({ status }: { status: string }) {
  return <span className={`ops-badge ${PTONE[status] ?? 'grey'}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

export const TYPE_LABEL: Record<string, string> = { ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expense' };
export const money2 = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatDecimal(v, 2));
/** Blank for a zero side so the debit and credit columns read like a ledger. */
export const side = (v: string) => (/^0+(\.0+)?$/.test(v) ? '' : money2(v));

export const ACTION_LABEL: Record<string, string> = {
  'accounting.journal_created': 'Created',
  'accounting.journal_updated': 'Edited',
  'accounting.journal_submitted': 'Submitted for approval',
  'accounting.journal_returned': 'Returned to the creator',
  'accounting.journal_discarded': 'Discarded',
  'accounting.journal_posted': 'Posted',
  'accounting.journal_reversed': 'Reversed',
};
