import { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { syncOrderReservation } from '../cash/cash.orders';
import { assertUpdated } from '../ops/ops.common';
import { assertTransition, loadOrderRow, today, type OrderRow, type OrderStatus } from './orders.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

export interface FillInput {
  quantity: Dec;
  price: Dec;
  fees: Dec;
  executedAt: Date;
  source: 'MANUAL' | 'FIX' | 'CONTRACT_NOTE';
  sourceRef?: string | null;
  /** Who is recorded on the fill (the keying user, or the system actor for adapter-fed fills). */
  recordedBy: string;
}

export const FILLABLE: OrderStatus[] = ['Routing', 'PartiallyFilled'];

/** Locks the portfolio row so checks, reservations and fills for one book are serialised. */
export async function lockPortfolio(tx: Prisma.TransactionClient, portfolioId: string) {
  await tx.$queryRaw`SELECT id FROM portfolios WHERE id = ${portfolioId} FOR UPDATE`;
}

/**
 * Applies one fill to an order inside the caller's transaction: position, cash, order_fills, realised gain, order totals,
 * status and cash reservation, plus the audit event. Shared by the manual fill endpoint and the broker feeds
 * (FIX execution reports and contract notes). Throws HttpError (409 overfill, limit_breach, insufficient_position,
 * invalid_transition); the caller's transaction must be rolled back on error.
 */
export async function applyFillTx(tx: Prisma.TransactionClient, ctx: AuditContext, first: Pick<OrderRow, 'id' | 'portfolioId'>, f: FillInput): Promise<{ fillId: string; order: OrderRow; complete: boolean }> {
  await lockPortfolio(tx, first.portfolioId);
  const o = await loadOrderRow(first.id, tx); // fresh, under the lock
  if (!FILLABLE.includes(o.status as OrderStatus)) throw new HttpError(409, 'invalid_transition', `A fill cannot be recorded on an order that is ${o.status}`);
  const { quantity: qty, price, fees, executedAt } = f;
  const remaining = o.quantity.sub(o.filledQty);
  if (qty.gt(remaining)) throw new HttpError(409, 'overfill', `Fill of ${qty.toString()} exceeds the remaining ${remaining.toString()} on this order`);
  if ((o.orderType === 'LIMIT' || o.orderType === 'STOP_LIMIT') && o.limitPrice) {
    const breach = o.side === 'BUY' ? price.gt(o.limitPrice) : price.lt(o.limitPrice);
    if (breach) throw new HttpError(409, 'limit_breach', `A ${o.side} fill at ${price.toString()} is outside the ${o.limitPrice.toString()} limit`);
  }
  const buy = o.side === 'BUY';
  const day = today();

  // ---- position (append-by-date: today's row is created or updated, history is never edited)
  const pos = await tx.portfolioPosition.findFirst({
    where: { portfolioId: o.portfolioId, securityId: o.securityId, asOf: { lte: day } },
    orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
  });
  const heldQty = pos?.quantity ?? ZERO;
  if (!buy && qty.gt(heldQty)) throw new HttpError(409, 'insufficient_position', `The portfolio holds ${heldQty.toString()}; it cannot sell ${qty.toString()}`);
  const newQty = buy ? heldQty.add(qty) : heldQty.sub(qty);
  const newAvgCost = buy
    ? heldQty.mul(pos?.avgCost ?? ZERO).add(qty.mul(price)).div(newQty).toDecimalPlaces(6, D.ROUND_HALF_UP)
    : (pos?.avgCost ?? price);
  await tx.portfolioPosition.upsert({
    where: { portfolioId_securityId_asOf: { portfolioId: o.portfolioId, securityId: o.securityId, asOf: day } },
    create: { portfolioId: o.portfolioId, securityId: o.securityId, quantity: newQty, avgCost: newAvgCost, asOf: day },
    update: { quantity: newQty, avgCost: newAvgCost },
  });

  // ---- cash in the security currency
  const cashRow = await tx.portfolioCash.findFirst({ where: { portfolioId: o.portfolioId, currency: o.currency, asOf: { lte: day } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
  const cashBefore = cashRow?.available ?? ZERO;
  const gross = qty.mul(price);
  const cashAfter = (buy ? cashBefore.sub(gross).sub(fees) : cashBefore.add(gross).sub(fees)).toDecimalPlaces(4, D.ROUND_HALF_UP);
  await tx.portfolioCash.upsert({
    where: { portfolioId_currency_asOf: { portfolioId: o.portfolioId, currency: o.currency, asOf: day } },
    create: { portfolioId: o.portfolioId, currency: o.currency, available: cashAfter, asOf: day },
    update: { available: cashAfter },
  });

  // ---- fill, order totals, status
  const fill = await tx.orderFill.create({
    data: { orderId: o.id, quantity: qty, price, fees, executedAt, source: f.source, sourceRef: f.sourceRef ?? null, recordedBy: f.recordedBy },
  });
  // A sell realises a gain or loss against the position's average cost (average-cost method); fees are booked separately as trade costs.
  if (!buy) {
    const unitCost = pos?.avgCost ?? price;
    const proceeds = qty.mul(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
    const costBasis = qty.mul(unitCost).toDecimalPlaces(4, D.ROUND_HALF_UP);
    await tx.orderRealisedGain.create({
      data: { orderId: o.id, fillId: fill.id, portfolioId: o.portfolioId, securityId: o.securityId, quantity: qty, unitCost, proceeds, costBasis, fees, realisedGain: proceeds.sub(costBasis), currency: o.currency },
    });
  }
  const filledQty = o.filledQty.add(qty);
  const avgPrice = o.filledQty.mul(o.avgPrice ?? ZERO).add(qty.mul(price)).div(filledQty).toDecimalPlaces(6, D.ROUND_HALF_UP);
  const complete = filledQty.eq(o.quantity);
  const reservedAmount = buy && !complete && o.reserveUnit ? o.quantity.sub(filledQty).mul(o.reserveUnit).toDecimalPlaces(4, D.ROUND_HALF_UP) : ZERO;
  const to: OrderStatus = complete ? 'Filled' : 'PartiallyFilled';
  assertTransition(o.status, to);
  assertUpdated((await tx.order.updateMany({ where: { id: o.id, status: o.status, version: o.version }, data: { filledQty, avgPrice, reservedAmount, status: to, version: { increment: 1 } } })).count);
  await writeAudit(tx, ctx, {
    action: 'order.fill_recorded',
    objectType: 'order',
    objectId: o.id,
    before: { status: o.status },
    after: {
      status: to,
      fillId: fill.id,
      fillQuantity: qty.toString(),
      fillPrice: price.toString(),
      fees: fees.toString(),
      filledQty: filledQty.toString(),
      avgPrice: avgPrice.toString(),
      positionAfter: newQty.toString(),
      cashAfter: cashAfter.toString(),
      currency: o.currency,
      source: f.source,
    },
  });
  // The cash hold now covers what was filled plus the unfilled remainder; it is consumed when the settlement journal posts.
  if (buy) await syncOrderReservation(tx, ctx, { id: o.id, ref: o.ref, portfolioId: o.portfolioId, currency: o.currency }, { quantity: o.quantity, filledQty, reserveUnit: o.reserveUnit });
  return { fillId: fill.id, order: await loadOrderRow(o.id, tx), complete };
}
