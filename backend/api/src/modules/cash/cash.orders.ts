import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { LIVE_RESERVATION } from './cash.engine';
import { ledgerAvailability, reservedByLedger, postedByLedger, startOfDay } from './cash.service';

/**
 * Orders <-> Cash wiring (FR-CASH-015). The Orders module calls these inside its own transaction:
 *   submit  -> reserveOrderCash      holds cash on the portfolio's bank ledger (row-locked availability check)
 *   approve -> ensureOrderReservation  re-creates the hold if it is missing (for example the ledger was set up later)
 *   fill    -> syncOrderReservation  resizes the hold to the filled value plus the unfilled remainder
 *   cancel / reject -> releaseOrderCash
 * The hold is consumed when the settlement journal for the order is posted (cash.routes /journals/:id/post), and
 * restored if that journal is reversed. A portfolio with no active bank ledger in the currency keeps the legacy behaviour.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
type Tx = Prisma.TransactionClient;
export interface OrderCashRef {
  id: string;
  ref: string;
  portfolioId: string;
  currency: string;
}

export async function bankLedgerFor(db: Tx | typeof prisma, portfolioId: string, currency: string) {
  return db.cashLedger.findFirst({ where: { portfolioId, currency, kind: 'BANK', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
}

/** What the order ticket reads: the ledger's posted balance, minimum buffer and holds (other orders and manual), or null with no ledger. */
export async function orderCashView(portfolioId: string, currency: string, excludeOrderId?: string) {
  const ledger = await bankLedgerFor(prisma, portfolioId, currency);
  if (!ledger) return null;
  const posted = (await postedByLedger([ledger.id], new Date('9999-12-31T00:00:00Z'))).get(ledger.id) ?? ZERO;
  let reserved = (await reservedByLedger([ledger.id])).get(ledger.id) ?? ZERO;
  if (excludeOrderId) {
    const own = await prisma.cashReservation.findMany({ where: { ledgerId: ledger.id, orderId: excludeOrderId, status: { in: LIVE_RESERVATION } } });
    reserved = own.reduce((s, r) => s.sub(r.amount.sub(r.consumed)), reserved);
  }
  const available = posted.sub(ledger.minBuffer);
  return { ledgerId: ledger.id, ledgerRef: ledger.ref, posted, minBuffer: ledger.minBuffer, reserved: reserved.lt(0) ? ZERO : reserved, available: available.lt(0) ? ZERO : available };
}

async function liveFor(tx: Tx, orderId: string) {
  return tx.cashReservation.findMany({ where: { orderId, status: { in: LIVE_RESERVATION } }, orderBy: { createdAt: 'asc' } });
}

/** Holds `amount` on the bank ledger for a buy order. Returns null when there is no ledger, or the existing hold when one is live. */
export async function reserveOrderCash(tx: Tx, ctx: AuditContext, order: OrderCashRef, amount: Dec) {
  if (amount.lte(0)) return null;
  const probe = await bankLedgerFor(tx, order.portfolioId, order.currency);
  if (!probe) return null;
  // The locking read comes first so concurrent holds on the same ledger serialise.
  await tx.$queryRaw`SELECT id FROM cash_ledgers WHERE id = ${probe.id} FOR UPDATE`;
  const ledger = await tx.cashLedger.findUniqueOrThrow({ where: { id: probe.id } });
  const existing = await liveFor(tx, order.id);
  if (existing.length) return existing[0]!;
  const av = await ledgerAvailability(ledger, tx);
  if (amount.gt(av.available)) {
    throw new HttpError(409, 'insufficient_available_cash', `Order ${order.ref} needs ${amount.toFixed(2)} ${ledger.currency} but the cash ledger has ${av.available.toFixed(2)} available (posted ${av.posted.toFixed(2)}, reserved ${av.reserved.toFixed(2)}, buffer ${ledger.minBuffer.toFixed(2)})`, {
      requested: amount.toFixed(2),
      available: av.available.toFixed(2),
      currency: ledger.currency,
    });
  }
  const ref = await nextRef(tx, 'cashReservation');
  const r = await tx.cashReservation.create({
    data: { ref, portfolioId: ledger.portfolioId, ledgerId: ledger.id, orderId: order.id, source: `Order ${order.ref}`, purpose: 'BUY_SETTLEMENT', currency: ledger.currency, amount, requiredDate: startOfDay(new Date()), createdBy: ctx.actorId ?? '' },
  });
  await writeAudit(tx, ctx, { action: 'cash.reservation_created', objectType: 'cash_reservation', objectId: r.id, after: { ref, ledger: ledger.ref, source: `Order ${order.ref}`, purpose: 'BUY_SETTLEMENT', amount: amount.toFixed(2), availableBefore: av.available.toFixed(2) } });
  return r;
}

/** Approval check: a buy that should hold cash but does not (no hold at submit) gets one now. */
export async function ensureOrderReservation(tx: Tx, ctx: AuditContext, order: OrderCashRef, amount: Dec) {
  if ((await liveFor(tx, order.id)).length) return null;
  return reserveOrderCash(tx, ctx, order, amount);
}

/** Releases the order's live holds (cancel, reject, or the remainder after a final fill). */
export async function releaseOrderCash(tx: Tx, ctx: AuditContext, orderId: string, reason: string) {
  const rows = await liveFor(tx, orderId);
  for (const r of rows) {
    await tx.cashReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedBy: ctx.actorId ?? null, releasedAt: new Date(), releaseReason: reason.slice(0, 500), version: { increment: 1 } } });
    await writeAudit(tx, ctx, { action: 'cash.reservation_released', objectType: 'cash_reservation', objectId: r.id, before: { status: r.status, remaining: r.amount.sub(r.consumed).toFixed(2) }, after: { status: 'RELEASED', orderId }, reason });
  }
  return rows.length;
}

/**
 * After a fill: the hold covers what has been filled (value + fees) plus the unfilled remainder at the reserve unit.
 * A complete fill shrinks the hold to the exact cost, ready to be consumed by the settlement journal.
 */
export async function syncOrderReservation(tx: Tx, ctx: AuditContext, order: OrderCashRef, o: { quantity: Dec; filledQty: Dec; reserveUnit: Dec | null }) {
  const rows = await liveFor(tx, order.id);
  if (!rows.length) return;
  const fills = await tx.orderFill.findMany({ where: { orderId: order.id }, select: { quantity: true, price: true, fees: true } });
  const filled = fills.reduce((s, f) => s.add(f.quantity.mul(f.price)).add(f.fees), ZERO);
  const remaining = o.quantity.sub(o.filledQty);
  const tail = remaining.gt(0) && o.reserveUnit ? remaining.mul(o.reserveUnit) : ZERO;
  const target = filled.add(tail).toDecimalPlaces(4, D.ROUND_HALF_UP);
  const r = rows[0]!;
  if (r.amount.eq(target) || target.lte(r.consumed)) return;
  await tx.cashReservation.update({ where: { id: r.id }, data: { amount: target, version: { increment: 1 } } });
  await writeAudit(tx, ctx, { action: 'cash.reservation_resized', objectType: 'cash_reservation', objectId: r.id, before: { amount: r.amount.toFixed(2) }, after: { amount: target.toFixed(2), filled: filled.toFixed(2), remainingQty: remaining.toString() } });
}

/**
 * Reversing a journal that consumed a reservation puts the consumed amount back on hold, so the cash stays protected
 * until the replacement settlement is posted. Called inside the reversal transaction.
 */
export async function restoreReservationOnReverse(tx: Tx, ctx: AuditContext, journal: { id: string; ref: string; reservationId: string | null }, lines: { ledgerId: string; credit: Dec }[]) {
  if (!journal.reservationId) return null;
  const rsv = await tx.cashReservation.findUnique({ where: { id: journal.reservationId } });
  if (!rsv || !['CONSUMED', 'PARTIALLY_CONSUMED'].includes(rsv.status) || rsv.consumed.lte(0)) return null;
  const paid = lines.filter((l) => l.ledgerId === rsv.ledgerId).reduce((s, l) => s.add(l.credit), ZERO);
  const back = paid.lt(rsv.consumed) ? paid : rsv.consumed;
  if (back.lte(0)) return null;
  const consumed = rsv.consumed.sub(back);
  await tx.cashReservation.update({ where: { id: rsv.id }, data: { consumed, status: consumed.gt(0) ? 'PARTIALLY_CONSUMED' : 'ACTIVE', releasedAt: null, releasedBy: null, releaseReason: null, version: { increment: 1 } } });
  await writeAudit(tx, ctx, { action: 'cash.reservation_restored', objectType: 'cash_reservation', objectId: rsv.id, before: { status: rsv.status, consumed: rsv.consumed.toFixed(2) }, after: { status: consumed.gt(0) ? 'PARTIALLY_CONSUMED' : 'ACTIVE', consumed: consumed.toFixed(2), restored: back.toFixed(2), reversedJournal: journal.ref } });
  return { reservationId: rsv.id, restored: back };
}
