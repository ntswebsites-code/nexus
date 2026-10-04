'use client';

import { formatDecimal } from './money';

// ------------------------------------------------------------------ types (mirror /api/v1/corporate-actions)

export type CaStatus = 'ANNOUNCED' | 'CONFIRMED' | 'PROCESSED' | 'REVERSED' | 'CANCELLED';
export type CaType = 'CASH_DIVIDEND' | 'STOCK_SPLIT' | 'BONUS_ISSUE' | 'SCRIP_DIVIDEND' | 'RIGHTS_ISSUE' | 'MERGER';
export const CA_TYPES: CaType[] = ['CASH_DIVIDEND', 'STOCK_SPLIT', 'BONUS_ISSUE', 'SCRIP_DIVIDEND', 'RIGHTS_ISSUE', 'MERGER'];

export interface CaEvent {
  id: string;
  ref: string;
  securityId: string;
  ticker: string;
  securityName: string;
  type: CaType;
  status: CaStatus;
  /** FR-OPS-015 lifecycle stage (derived by the API). */
  stage?: string;
  stageLabel?: string;
  currency: string;
  exDate: string;
  recordDate: string;
  payDate: string;
  electionDeadline: string | null;
  rate: string | null;
  ratioNew: string | null;
  ratioOld: string | null;
  withholdingPct: string;
  targetSecurityId: string | null;
  targetTicker: string | null;
  defaultOption: string | null;
  description: string | null;
  elective: boolean;
  options: string[];
  electionOpen: boolean;
  entitlementsAt: string | null;
  entitlementCount: number;
  electedCount: number;
  netCash: string;
  makerId: string;
  makerName: string | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  processedBy: string | null;
  processedByName: string | null;
  processedAt: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  cashInLieu: boolean;
  cilPrice: string | null;
  reversedBy: string | null;
  reversedByName: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  processing: { effectiveDate?: string; applied?: number; clamped?: number; cashInLieu?: string; netCash?: string; tax?: string; sharesDelta?: string; targetShares?: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CaList {
  data: CaEvent[];
  total: number;
  summary: { byStatus: Record<string, number>; upcoming: number; awaitingConfirmation: number; awaitingProcessing: number; processed: number };
}

export interface CaUpcoming {
  data: CaEvent[];
  from: string;
  to: string;
}

export interface CaEntitlement {
  id: string;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  quantity: string;
  option: string | null;
  elected: boolean;
  electedByName: string | null;
  electedAt: string | null;
  grossAmount: string;
  taxAmount: string;
  cashAmount: string;
  cashInLieu: string;
  sharesDelta: string;
  targetShares: string;
  fraction: string;
  status: 'PENDING' | 'APPLIED' | 'REVERSED' | 'SKIPPED';
  defaulted: boolean;
  note: string | null;
}

export interface CaDetail extends CaEvent {
  entitlements: CaEntitlement[];
  totals: { quantity: string; gross: string; tax: string; netCash: string; cashInLieu: string; sharesDelta: string; targetShares: string };
  timeline: { at: string; action: string; actor: string; reason: string | null }[];
  allowed: {
    edit: boolean;
    confirm: boolean;
    calculate: boolean;
    calculateBlocker: string | null;
    elect: boolean;
    process: boolean;
    processBlocker: string | null;
    cancel: boolean;
    instruct?: boolean;
    reconcile?: boolean;
    reverse: boolean;
    reverseBlocker: string | null;
  };
}

/** Entitlements rolled up per client (GET /events/:id/clients). */
export interface CaClientRow {
  clientId: string | null;
  clientRef: string | null;
  clientName: string;
  portfolios: string[];
  quantity: string;
  cash: string;
  cashInLieu: string;
  sharesDelta: string;
  targetShares: string;
  elected: number;
  entitlements: number;
}

// ------------------------------------------------------------------ presentation

export const TYPE_LABEL: Record<string, string> = {
  CASH_DIVIDEND: 'Cash dividend',
  STOCK_SPLIT: 'Stock split',
  BONUS_ISSUE: 'Bonus issue',
  SCRIP_DIVIDEND: 'Scrip dividend',
  RIGHTS_ISSUE: 'Rights issue',
  MERGER: 'Merger',
};
export const STATUS_LABEL: Record<string, string> = { ANNOUNCED: 'Announced', CONFIRMED: 'Confirmed', PROCESSED: 'Processed', REVERSED: 'Reversed', CANCELLED: 'Cancelled' };
const TONE: Record<string, string> = { ANNOUNCED: 'amber', CONFIRMED: 'blue', PROCESSED: 'green', REVERSED: 'red', CANCELLED: 'grey' };
export const OPTION_LABEL: Record<string, string> = { CASH: 'Take cash', SCRIP: 'Take scrip shares', TAKE_UP: 'Take up rights', LAPSE: 'Let rights lapse' };

const STAGE_TONE: Record<string, string> = { ANNOUNCED: 'amber', PROJECTED: 'blue', ELECTION_OPEN: 'amber', INSTRUCTED: 'blue', PROCESSED: 'green', RECONCILED: 'green', REVERSED: 'red', CANCELLED: 'grey' };
/** FR-OPS-015 stage: Announced, Entitlement projected, Election open, Instructed, Processed, Reconciled, Reversed, Cancelled. */
export function CaStageBadge({ stage, label }: { stage?: string; label?: string }) {
  if (!stage) return null;
  return <span className={`ops-badge ${STAGE_TONE[stage] ?? 'grey'}`} title="Lifecycle stage">{label ?? stage}</span>;
}

export function CaStatusBadge({ status }: { status: string }) {
  return <span className={`ops-badge ${TONE[status] ?? 'grey'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export const money2 = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatDecimal(v, 2));
export const shares = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatDecimal(v, 0));
export const signed = (v: string) => (Number(v) > 0 ? `+${money2(v)}` : money2(v));

/** One line describing the terms, e.g. "0.35 USD per share, 10% tax" or "2 new for 1 held". */
export function terms(e: CaEvent): string {
  const ratio = e.ratioNew && e.ratioOld ? `${e.ratioNew} new for ${e.ratioOld} held` : null;
  switch (e.type) {
    case 'CASH_DIVIDEND':
      return `${e.rate} ${e.currency} per share${Number(e.withholdingPct) ? `, ${e.withholdingPct}% withholding tax` : ''}`;
    case 'STOCK_SPLIT':
    case 'BONUS_ISSUE':
      return `${ratio ?? ''}${e.cashInLieu && e.cilPrice ? `, fractions paid in cash at ${e.cilPrice} ${e.currency}` : ''}`;
    case 'SCRIP_DIVIDEND':
      return `${e.rate} ${e.currency} cash per share or ${ratio}`;
    case 'RIGHTS_ISSUE':
      return `${ratio} at ${e.rate} ${e.currency}`;
    case 'MERGER':
      return `${ratio} of ${e.targetTicker ?? 'acquirer'}${Number(e.rate) ? ` plus ${e.rate} ${e.currency} cash per share` : ''}`;
    default:
      return '';
  }
}
