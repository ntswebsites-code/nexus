import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';

/**
 * Drawdown ledger (BR-229, BR-270, BR-272, FR-CMP-035).
 *
 *   committed = the company's total committed tranche when set (> 0), else the sum of its executed term sheets
 *               (there is no disbursement table yet, so executed term sheets stand in for approved disbursements)
 *   reserved  = requests waiting for review, approved, out to RFQ, converted to a PO or fulfilled, excluding the one being checked
 *   available = max(committed - reserved, 0)
 *   create, submit and resubmit require reserved + amount <= committed
 *
 * With no tranche on record (committed = 0) the over-draw check is not applied, because nothing has been agreed
 * to measure against; the panel then reports `configured: false`.
 */
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

type Db = Prisma.TransactionClient | typeof prisma;

export async function committedFor(companyId: string, db: Db = prisma) {
  const company = await db.portfolioCompany.findUnique({ where: { id: companyId }, select: { totalCommittedAmount: true, reportingCurrency: true } });
  const set = company?.totalCommittedAmount?.toNumber() ?? 0;
  if (set > 0) return { committed: set, source: 'tranche' as const, currency: company?.reportingCurrency ?? 'USD' };
  const sheets = await db.termSheet.findMany({ where: { companyId, status: 'EXECUTED' }, select: { investmentAmount: true } });
  return { committed: sheets.reduce((s, t) => s + t.investmentAmount.toNumber(), 0), source: 'term_sheets' as const, currency: company?.reportingCurrency ?? 'USD' };
}

export async function trancheLedger(companyId: string, opts: { excludeId?: string; db?: Db } = {}) {
  const db = opts.db ?? prisma;
  const [base, rows] = await Promise.all([
    committedFor(companyId, db),
    db.investeeRequisition.findMany({ where: { companyId, status: { not: 'DRAFT' } }, select: { id: true, status: true, amount: true, approvedAt: true } }),
  ]);
  const t = computeTranche(base.committed, rows.map((r) => ({ id: r.id, status: r.status, amount: r.amount.toNumber(), approvedAt: r.approvedAt })), { excludeId: opts.excludeId });
  return { currency: base.currency, source: base.source, configured: base.committed > 0, ...t };
}

/** Throws 409 `tranche_exceeded` when the amount would take reserved past committed. */
export async function assertWithinTranche(db: Db, companyId: string, amount: number, excludeId?: string) {
  const t = await trancheLedger(companyId, { excludeId, db });
  if (!t.configured) return t;
  if (t.reserved + amount > t.committed + 1e-9) {
    throw new HttpError(409, 'tranche_exceeded', OVERDRAW_MESSAGE, { committed: t.committed, reserved: t.reserved, available: t.available, requested: amount });
  }
  return t;
}

/** BR-273: hash of the header and amount; a resubmission after a return or rejection must change it. */
export function requisitionFingerprint(r: { title: string; description?: string | null; category: string; currency: string; amount: number | string | Prisma.Decimal; needBy?: string | null; priority: string }) {
  const norm = [r.title.trim(), (r.description ?? '').trim(), r.category.trim(), r.currency.toUpperCase(), new Prisma.Decimal(r.amount).toFixed(2), r.needBy ?? '', r.priority].join('\u001f');
  return createHash('sha256').update(norm).digest('hex');
}
