/**
 * Post-trade view of one order (SRD 6.6 FR-OMS-011): how the fills were allocated to the portfolio, slippage against the
 * decision price (BR-017), and the contract-note match. Read-only; fills, notes and positions are the book of record.
 *
 * Allocation: an order belongs to one portfolio, so the order allocates 100% of its filled quantity to it; each fill is a
 * line with its gross, fees and net settlement amount, and the position (quantity and average cost) it leaves behind.
 * Contract-note match: every trade-feed line that points at the order (matched, or a break quoting its reference) with the
 * variance of quantity, price and fees against the fill it created.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { slippageBp, type OrderRow } from './orders.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const m2 = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const p6 = (v: Dec) => v.toDecimalPlaces(6, D.ROUND_HALF_UP).toFixed(6);
const q6 = (v: Dec) => v.toDecimalPlaces(6, D.ROUND_HALF_UP).toString();

export interface PostTradeView {
  orderId: string;
  ref: string;
  status: string;
  currency: string;
  side: string;
  decisionPrice: string;
  allocation: {
    portfolio: { id: string; ref: string; name: string };
    filledQty: string;
    orderQty: string;
    sharePct: string;
    avgPrice: string | null;
    gross: string;
    fees: string;
    net: string;
    positionAfter: { quantity: string; avgCost: string | null; asOf: string } | null;
    fills: { id: string; executedAt: string; source: string; quantity: string; price: string; fees: string; gross: string; net: string; slippageBp: number | null }[];
  };
  slippage: {
    decisionPrice: string;
    avgPrice: string | null;
    bp: number | null;
    /** Positive = cost against the decision price (paid more on a buy, received less on a sell), in the order currency. */
    amount: string | null;
    worstFillBp: number | null;
  };
  contractNote: {
    status: 'NONE' | 'MATCHED' | 'BREAK' | 'PARTIAL';
    lines: {
      ref: string;
      source: string;
      externalRef: string;
      status: string;
      breakReason: string | null;
      detail: string | null;
      quantity: string;
      price: string;
      fees: string;
      tradeDate: string;
      fillId: string | null;
      variance: { quantity: string; price: string; fees: string } | null;
    }[];
  };
  settlement: { settled: boolean; readyToSettle: boolean; fillsTieToOrder: boolean };
}

export async function postTradeView(o: OrderRow): Promise<PostTradeView> {
  const buy = o.side === 'BUY';
  const [fills, portfolio, lines, pos] = await Promise.all([
    prisma.orderFill.findMany({ where: { orderId: o.id }, orderBy: [{ executedAt: 'asc' }, { createdAt: 'asc' }] }),
    prisma.portfolio.findUniqueOrThrow({ where: { id: o.portfolioId }, select: { id: true, ref: true, name: true } }),
    prisma.tradeFeedLine.findMany({ where: { OR: [{ orderId: o.id }, { orderRef: o.ref, orderId: null }] }, orderBy: { createdAt: 'asc' }, take: 200 }),
    prisma.portfolioPosition.findFirst({ where: { portfolioId: o.portfolioId, securityId: o.securityId }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const byId = new Map(fills.map((f) => [f.id, f]));

  const fillLines = fills.map((f) => {
    const gross = f.quantity.mul(f.price);
    const net = buy ? gross.add(f.fees) : gross.sub(f.fees);
    return {
      id: f.id,
      executedAt: f.executedAt.toISOString(),
      source: f.source,
      quantity: q6(f.quantity),
      price: p6(f.price),
      fees: m2(f.fees),
      gross: m2(gross),
      net: m2(net),
      slippageBp: slippageBp(o.side, f.price, o.decisionPrice),
    };
  });
  const gross = fills.reduce((s, f) => s.add(f.quantity.mul(f.price)), ZERO);
  const fees = fills.reduce((s, f) => s.add(f.fees), ZERO);
  const qty = fills.reduce((s, f) => s.add(f.quantity), ZERO);
  const avg = qty.gt(0) ? gross.div(qty) : null;
  const cost = avg ? (buy ? avg.sub(o.decisionPrice) : o.decisionPrice.sub(avg)).mul(qty) : null;
  const bps = fillLines.map((f) => f.slippageBp).filter((x): x is number => x !== null);

  const noteLines = lines.map((l) => {
    const fill = l.fillId ? byId.get(l.fillId) : undefined;
    return {
      ref: l.ref,
      source: l.source,
      externalRef: l.externalRef,
      status: l.status,
      breakReason: l.breakReason,
      detail: l.detail,
      quantity: q6(l.quantity),
      price: p6(l.price),
      fees: m2(l.fees),
      tradeDate: l.tradeDate.toISOString().slice(0, 10),
      fillId: l.fillId,
      variance: fill ? { quantity: q6(l.quantity.sub(fill.quantity)), price: p6(l.price.sub(fill.price)), fees: m2(l.fees.sub(fill.fees)) } : null,
    };
  });
  const notes = noteLines.filter((l) => l.source === 'CONTRACT_NOTE');
  const open = notes.filter((l) => l.status === 'BREAK').length;
  const matched = notes.filter((l) => l.status === 'MATCHED' || l.status === 'RESOLVED').length;
  const noteStatus: PostTradeView['contractNote']['status'] = !notes.length ? 'NONE' : open && matched ? 'PARTIAL' : open ? 'BREAK' : 'MATCHED';

  return {
    orderId: o.id,
    ref: o.ref,
    status: o.status,
    currency: o.currency,
    side: o.side,
    decisionPrice: p6(o.decisionPrice),
    allocation: {
      portfolio,
      filledQty: q6(qty),
      orderQty: q6(o.quantity),
      sharePct: o.quantity.gt(0) ? qty.div(o.quantity).mul(100).toDecimalPlaces(2).toFixed(2) : '0.00',
      avgPrice: avg ? p6(avg) : null,
      gross: m2(gross),
      fees: m2(fees),
      net: m2(buy ? gross.add(fees) : gross.sub(fees)),
      positionAfter: pos ? { quantity: q6(pos.quantity), avgCost: pos.avgCost ? p6(pos.avgCost) : null, asOf: pos.asOf.toISOString().slice(0, 10) } : null,
      fills: fillLines,
    },
    slippage: {
      decisionPrice: p6(o.decisionPrice),
      avgPrice: avg ? p6(avg) : null,
      bp: slippageBp(o.side, avg, o.decisionPrice),
      amount: cost ? m2(cost) : null,
      worstFillBp: bps.length ? Math.max(...bps) : null,
    },
    contractNote: { status: noteStatus, lines: noteLines },
    settlement: { settled: o.status === 'Settled', readyToSettle: o.status === 'Filled', fillsTieToOrder: qty.eq(o.filledQty) },
  };
}
