import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

/** Pure drawdown ledger arithmetic (no database); see drawdown.ts for the rules. */
export const OVERDRAW_MESSAGE = 'Drawdown Request Exceeds Available Investment Tranche.';

/** SUBMITTED is the pending VC executive review state; the longer names are accepted for imported rows. */
export const RESERVING_STATUSES = ['SUBMITTED', 'PENDING_VC_EXECUTIVE_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'RFQ_SENT', 'CONVERTED_TO_PO', 'FULFILLED'] as const;
export const LEDGER_APPROVED_STATUSES = ['APPROVED', 'RFQ_SENT', 'CONVERTED_TO_PO'] as const;
/** BR-230: pending VC executive review for longer than this is an SLA breach. */
export const SLA_HOURS = 48;

export interface LedgerRow {
  id: string;
  status: string;
  amount: number;
  approvedAt: Date | null;
}

/** BR-272: a request counts as approved once approvedAt is set or its status is one of the approved statuses. */
export const isApprovedForLedger = (r: Pick<LedgerRow, 'status' | 'approvedAt'>) =>
  r.approvedAt !== null || (LEDGER_APPROVED_STATUSES as readonly string[]).includes(r.status);

const quarterStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));

export function computeTranche(committed: number, rows: LedgerRow[], opts: { excludeId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const from = quarterStart(now);
  const reserved = rows
    .filter((r) => r.id !== opts.excludeId && (RESERVING_STATUSES as readonly string[]).includes(r.status))
    .reduce((s, r) => s + r.amount, 0);
  const approvedThisQuarter = rows
    .filter((r) => (r.approvedAt !== null && r.approvedAt >= from) || (LEDGER_APPROVED_STATUSES as readonly string[]).includes(r.status))
    .reduce((s, r) => s + r.amount, 0);
  const totalApproved = rows.filter(isApprovedForLedger).reduce((s, r) => s + r.amount, 0);
  return { committed, reserved, available: Math.max(committed - reserved, 0), approvedThisQuarter, totalApproved };
}

/** BR-273: hash of the header and amount; a resubmission after a return or rejection must change it. */
export function requisitionFingerprint(r: { title: string; description?: string | null; category: string; currency: string; amount: number | string | Prisma.Decimal; needBy?: string | null; priority: string }) {
  const norm = [r.title.trim(), (r.description ?? '').trim(), r.category.trim(), r.currency.toUpperCase(), new Prisma.Decimal(r.amount).toFixed(2), r.needBy ?? '', r.priority].join('\u001f');
  return createHash('sha256').update(norm).digest('hex');
}
