'use client';

import type { ReactNode } from 'react';
import { formatDecimal } from './money';
import { formatDateTime } from './ui';

// ------------------------------------------------------------------ types (mirror /api/v1/orders)

export type CheckResult = 'Pass' | 'Review' | 'Fail';
export type PreTradeOverall = 'Within' | 'Review' | 'Blocked';

export interface PreTradeCheck {
  key: 'mandate' | 'cash' | 'position' | 'concentration' | 'liquidity' | 'price';
  label: string;
  result: CheckResult;
  detail: string;
  metrics?: Record<string, string | number | null>;
}

export interface PreTradeResult {
  overall: PreTradeOverall;
  checks: PreTradeCheck[];
  currency: string;
  notional: string;
  estimatedFee: string;
  price: string;
  asOf: string;
  warnings: string[];
  decisionPrice?: string;
}

export interface OrderRow {
  id: string;
  ref: string;
  portfolio: { id: string; ref: string; name: string; baseCurrency: string };
  security: { id: string; ticker: string; name: string; market: string; currency: string; boardLot: number; status: string; sector: string | null };
  side: 'BUY' | 'SELL';
  quantity: string;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice: string | null;
  tif: string;
  urgency: string;
  broker: { id: string; name: string } | null;
  rationale: string | null;
  currency: string;
  decisionPrice: string;
  notional: string;
  status: OrderStatusName;
  precheck: PreTradeResult | null;
  precheckAt: string | null;
  maker: { id: string; name: string } | null;
  approver: { id: string; name: string } | null;
  approvedAt: string | null;
  router: { id: string; name: string } | null;
  routedAt: string | null;
  filledQty: string;
  remainingQty: string;
  avgPrice: string | null;
  slippageBp: number | null;
  reservedAmount: string;
  estimatedFee: string;
  cancelReason: string | null;
  rejectReason: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface OrderFill {
  id: string;
  quantity: string;
  price: string;
  fees: string;
  notional: string;
  executedAt: string;
  source: string;
  sourceRef: string | null;
  recordedBy: string;
}

export interface OrderTimelineEntry {
  at: string;
  action: string;
  actor: string;
  actorRole: string | null;
  from: string | null;
  to: string | null;
  reason: string | null;
}

export interface OrderCashHold {
  id: string;
  ref: string;
  status: string;
  amount: string;
  consumed: string;
  remaining: string;
  currency: string;
  releaseReason: string | null;
}

export interface OrderDecision {
  id: string;
  ref: string;
  action: string;
  status: string;
  quantity: string | null;
  rationale: string;
  ratifiedAt: string | null;
  votes: { for: number; against: number; abstain: number };
  caseId: string;
  caseRef: string;
  caseTitle: string;
  link: string;
}

export interface OrderRealisedGain {
  method: string;
  currency: string;
  proceeds: string;
  costBasis: string;
  fees: string;
  gain: string;
  netOfFees: string;
  fills: { fillId: string; quantity: string; unitCost: string; proceeds: string; costBasis: string; gain: string }[];
}

export interface OrderDetail extends OrderRow {
  /** The cash service's view: this order's holds and the bank ledger availability (buys). */
  cash: { holds: OrderCashHold[]; ledger: { ref: string; posted: string; reservedByOthers: string; minBuffer: string; available: string } | null };
  /** The IC decision that produced this order, if any. */
  decision: OrderDecision | null;
  /** Sells: gain against average cost, recorded per fill. */
  realisedGain: OrderRealisedGain | null;
  fills: OrderFill[];
  instruction: { id: string; channel: string; payload: InstructionPayload; sentAt: string | null; deliveryStatus: string; createdAt: string } | null;
  timeline: OrderTimelineEntry[];
  allowed: string[];
}

export interface InstructionPayload {
  to: string;
  brokerName: string;
  subject: string;
  text: string;
}

export interface InstructionPreview {
  orderStatus: string;
  routable: boolean;
  broker: { id: string; name: string; email: string | null };
  instruction: InstructionPayload;
}

export interface OrdersList {
  data: OrderRow[];
  total: number;
  limit: number;
  offset: number;
  summary: { working: number; awaitingApproval: number; filled: number; slippageBp: number | null; byStatus: Record<string, number> };
}

export interface BrokerOption {
  id: string;
  name: string;
  email: string | null;
  status: string;
}

export type OrderStatusName = 'Draft' | 'Validated' | 'AwaitingApproval' | 'Approved' | 'Routing' | 'PartiallyFilled' | 'Filled' | 'Settled' | 'Rejected' | 'Cancelled';

export const STATUS_LABEL: Record<string, string> = {
  Draft: 'Draft',
  Validated: 'Validated',
  AwaitingApproval: 'Awaiting approval',
  Approved: 'Approved',
  Routing: 'Routing',
  PartiallyFilled: 'Partially filled',
  Filled: 'Filled',
  Settled: 'Settled',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
};

const STATUS_TONE: Record<string, string> = {
  Draft: 'grey',
  Validated: 'blue',
  AwaitingApproval: 'amber',
  Approved: 'blue',
  Routing: 'amber',
  PartiallyFilled: 'amber',
  Filled: 'green',
  Settled: 'green',
  Rejected: 'red',
  Cancelled: 'red',
};

export function OrderStatusBadge({ status }: { status: string }) {
  return <span className={`ops-badge ${STATUS_TONE[status] ?? 'grey'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function SideTag({ side }: { side: string }) {
  return <strong style={{ color: side === 'BUY' ? '#0f7a45' : '#b3261e' }}>{side}</strong>;
}

/** Whole shares, grouped. */
export const shares = (v: string | null | undefined) => formatDecimal(v, 0);
/** Price with trailing zeros trimmed to between 2 and 6 decimals. */
export function price6(v: string | null | undefined): string {
  if (!v) return '—';
  const dp = Math.min(6, Math.max(2, (v.split('.')[1] ?? '').replace(/0+$/, '').length));
  return formatDecimal(v, dp);
}

export function bp(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} bp`;
}

const RESULT_TONE: Record<string, string> = { Pass: 'green', Review: 'amber', Fail: 'red', Within: 'green', Blocked: 'red' };

export function ResultBadge({ result }: { result: string }) {
  return <span className={`ops-badge ${RESULT_TONE[result] ?? 'grey'}`}>{result}</span>;
}

/** The six pre-trade controls with their result and explanation. */
export function CheckList({ result, at }: { result: PreTradeResult; at?: string | null }): ReactNode {
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <strong>Overall</strong>
        <ResultBadge result={result.overall} />
        <span className="ops-muted">
          Notional {result.currency} {formatDecimal(result.notional)} · estimated fee {formatDecimal(result.estimatedFee)}
          {at ? ` · checked ${formatDateTime(at)}` : ''}
        </span>
      </div>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Control</th>
              <th style={{ width: 90 }}>Result</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {result.checks.map((c) => (
              <tr key={c.key}>
                <td>
                  <strong>{c.label}</strong>
                </td>
                <td>
                  <ResultBadge result={c.result} />
                </td>
                <td>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.warnings.length > 0 && (
        <p className="ops-muted" style={{ marginTop: 8 }}>
          Valuation warnings: {result.warnings.join('; ')}
        </p>
      )}
    </div>
  );
}

export const ACTION_LABEL: Record<string, string> = {
  'order.created': 'Created',
  'order.updated': 'Edited',
  'order.validated': 'Pre-trade check run',
  'order.precheck_failed': 'Check failed at submit',
  'order.submitted': 'Submitted for approval',
  'order.approved': 'Approved',
  'order.rejected': 'Rejected',
  'order.routed': 'Routed to broker',
  'order.fill_recorded': 'Fill recorded',
  'order.cancelled': 'Cancelled',
};
