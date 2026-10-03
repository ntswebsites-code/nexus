/**
 * Orders (OMS) domain helpers: state machine, views, broker instruction, reservation maths.
 * HTTP lives in orders.routes.ts; pre-trade checks in orders.checks.ts.
 *
 * Status machine (SRD 7.2):
 *   Draft -> Validated -> AwaitingApproval -> Approved -> Routing -> PartiallyFilled -> Filled (-> Settled, reserved)
 *   plus Rejected (from AwaitingApproval) and Cancelled (from any open state). Anything else is 409 invalid_transition.
 */
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { FEE_ESTIMATE_PCT, type PreTradeResult } from './orders.checks';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ORDER_STATUSES = ['Draft', 'Validated', 'AwaitingApproval', 'Approved', 'Routing', 'PartiallyFilled', 'Filled', 'Settled', 'Rejected', 'Cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Draft: ['Validated', 'Cancelled'],
  Validated: ['Draft', 'AwaitingApproval', 'Cancelled'],
  AwaitingApproval: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Routing', 'Cancelled'],
  Routing: ['PartiallyFilled', 'Filled', 'Cancelled'],
  PartiallyFilled: ['PartiallyFilled', 'Filled', 'Cancelled'],
  Filled: ['Settled'],
  Settled: [],
  Rejected: [],
  Cancelled: [],
};

/** 409 invalid_transition unless the status machine allows `from -> to`. */
export function assertTransition(from: string, to: OrderStatus): void {
  if (!(from in TRANSITIONS) || !TRANSITIONS[from as OrderStatus].includes(to)) {
    throw new HttpError(409, 'invalid_transition', `An order that is ${from} cannot move to ${to}`);
  }
}

export const CANCELLABLE: OrderStatus[] = ['Draft', 'Validated', 'AwaitingApproval', 'Approved', 'Routing', 'PartiallyFilled'];

export const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

export type OrderRow = Prisma.OrderGetPayload<object>;

export async function loadOrderRow(idOrRef: string, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<OrderRow> {
  const o = await tx.order.findFirst({ where: UUID.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!o) throw HttpError.notFound('Order not found');
  return o;
}

/** Drafts and validated-but-unsubmitted orders belong to their maker only (not visible to others). */
export function visibleTo(o: Pick<OrderRow, 'status' | 'makerId'>, userId: string): boolean {
  return !(['Draft', 'Validated'].includes(o.status) && o.makerId !== userId);
}

// ---------------------------------------------------------------- money helpers

const m2 = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2));
const p6 = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toDecimalPlaces(6, D.ROUND_HALF_UP).toFixed(6));
const q = (v: Dec) => v.toDecimalPlaces(6, D.ROUND_HALF_UP).toString();

/** Reference price for reservation and checks: the limit, else the decision price. */
export const referencePrice = (o: Pick<OrderRow, 'orderType' | 'limitPrice' | 'decisionPrice'>): Dec =>
  o.orderType === 'LIMIT' && o.limitPrice ? o.limitPrice : o.decisionPrice;

/** BR-017 slippage in bp, positive = worse than the decision price (paid more on a buy, received less on a sell). */
export function slippageBp(side: string, avgPrice: Dec | null, decisionPrice: Dec): number | null {
  if (!avgPrice || decisionPrice.isZero()) return null;
  const bp = avgPrice.sub(decisionPrice).div(decisionPrice).mul(10000).toNumber();
  return Math.round((side === 'SELL' ? -bp : bp) * 10) / 10;
}

/** Reservation for a buy: remaining quantity x (reference price x (1 + fee estimate)). */
export function reservationFor(o: Pick<OrderRow, 'orderType' | 'limitPrice' | 'decisionPrice' | 'quantity' | 'filledQty'>) {
  const unit = referencePrice(o).mul(new D(1).add(new D(FEE_ESTIMATE_PCT).div(100))).toDecimalPlaces(8, D.ROUND_HALF_UP);
  const remaining = o.quantity.sub(o.filledQty);
  return { unit, amount: (remaining.gt(0) ? remaining : ZERO).mul(unit).toDecimalPlaces(4, D.ROUND_HALF_UP) };
}

// ---------------------------------------------------------------- views

interface Lookups {
  portfolios: Map<string, { id: string; ref: string; name: string; baseCurrency: string }>;
  securities: Map<string, { id: string; ticker: string; name: string; market: string; currency: string; boardLot: number; status: string; sector: string | null }>;
  brokers: Map<string, { id: string; name: string; email: string | null }>;
  users: Map<string, { id: string; name: string }>;
}

export async function lookups(rows: OrderRow[], extraUserIds: (string | null | undefined)[] = []): Promise<Lookups> {
  const ids = (f: (o: OrderRow) => string | null | undefined) => [...new Set(rows.map(f).filter((x): x is string => !!x))];
  const userIds = [...new Set([...ids((o) => o.makerId), ...ids((o) => o.approverId), ...ids((o) => o.routerId), ...extraUserIds.filter((x): x is string => !!x)])];
  const [portfolios, securities, brokers, users] = await Promise.all([
    prisma.portfolio.findMany({ where: { id: { in: ids((o) => o.portfolioId) } }, select: { id: true, ref: true, name: true, baseCurrency: true } }),
    prisma.security.findMany({ where: { id: { in: ids((o) => o.securityId) } }, select: { id: true, ticker: true, name: true, market: true, currency: true, boardLot: true, status: true, sector: true } }),
    prisma.broker.findMany({ where: { id: { in: ids((o) => o.brokerId) } }, select: { id: true, name: true, email: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
  ]);
  return {
    portfolios: new Map(portfolios.map((p) => [p.id, p])),
    securities: new Map(securities.map((s) => [s.id, s])),
    brokers: new Map(brokers.map((b) => [b.id, b])),
    users: new Map(users.map((u) => [u.id, { id: u.id, name: u.name || u.email }])),
  };
}

export function orderView(o: OrderRow, l: Lookups) {
  const user = (id: string | null) => (id ? (l.users.get(id) ?? { id, name: 'Unknown user' }) : null);
  const remaining = o.quantity.sub(o.filledQty);
  const ref = referencePrice(o);
  return {
    id: o.id,
    ref: o.ref,
    portfolio: l.portfolios.get(o.portfolioId) ?? { id: o.portfolioId, ref: '', name: 'Unknown portfolio', baseCurrency: '' },
    security: l.securities.get(o.securityId) ?? { id: o.securityId, ticker: '?', name: 'Unknown security', market: '', currency: o.currency, boardLot: 1, status: '', sector: null },
    side: o.side,
    quantity: q(o.quantity),
    orderType: o.orderType,
    limitPrice: p6(o.limitPrice),
    tif: o.tif,
    urgency: o.urgency,
    broker: o.brokerId ? (l.brokers.get(o.brokerId) ? { id: o.brokerId, name: l.brokers.get(o.brokerId)!.name } : { id: o.brokerId, name: 'Unknown broker' }) : null,
    rationale: o.rationale,
    currency: o.currency,
    decisionPrice: p6(o.decisionPrice),
    notional: m2(o.quantity.mul(ref)),
    status: o.status,
    precheck: (o.precheckResult as unknown as PreTradeResult | null) ?? null,
    precheckAt: o.precheckAt,
    maker: user(o.makerId),
    approver: user(o.approverId),
    approvedAt: o.approvedAt,
    router: user(o.routerId),
    routedAt: o.routedAt,
    filledQty: q(o.filledQty),
    remainingQty: q(remaining.gt(0) ? remaining : ZERO),
    avgPrice: p6(o.avgPrice),
    slippageBp: slippageBp(o.side, o.avgPrice, o.decisionPrice),
    reservedAmount: m2(o.reservedAmount),
    estimatedFee: m2(o.estimatedFee),
    cancelReason: o.cancelReason,
    rejectReason: o.rejectReason,
    submittedAt: o.submittedAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    version: o.version,
  };
}

export type OrderView = ReturnType<typeof orderView>;

export function fillView(f: Prisma.OrderFillGetPayload<object>, names: Map<string, { name: string }>) {
  return {
    id: f.id,
    quantity: q(f.quantity),
    price: p6(f.price),
    fees: m2(f.fees),
    notional: m2(f.quantity.mul(f.price)),
    executedAt: f.executedAt,
    source: f.source,
    sourceRef: f.sourceRef,
    recordedBy: names.get(f.recordedBy)?.name ?? f.recordedBy,
    createdAt: f.createdAt,
  };
}

/** Actions the current user may attempt on this order (the server stays authoritative). */
export function allowedActions(o: OrderRow, userId: string, perms: string[]): string[] {
  const has = (p: string) => perms.includes(p);
  const isMaker = o.makerId === userId;
  const out: string[] = [];
  if (['Draft', 'Validated'].includes(o.status) && isMaker && has('orders.create')) out.push('edit', 'validate');
  if (o.status === 'Validated' && isMaker && has('orders.create')) out.push('submit');
  if (o.status === 'AwaitingApproval' && has('orders.approve') && !isMaker) out.push('approve', 'reject');
  if (o.status === 'Approved' && has('orders.route') && o.approverId !== userId) out.push('route');
  if (['Routing', 'PartiallyFilled'].includes(o.status) && has('orders.route')) out.push('fill');
  if (o.status === 'Filled' && has('orders.route')) out.push('settle');
  if ((CANCELLABLE as string[]).includes(o.status) && (isMaker || has('orders.approve'))) out.push('cancel');
  return out;
}

// ---------------------------------------------------------------- broker instruction

export interface InstructionPayload {
  channel: 'EMAIL';
  to: string;
  brokerName: string;
  subject: string;
  text: string;
  fields: Record<string, string | null>;
}

export function buildInstruction(
  o: OrderRow,
  broker: { id: string; name: string; email: string | null },
  portfolio: { ref: string; name: string },
  security: { ticker: string; name: string; market: string; currency: string },
  note?: string | null,
): InstructionPayload {
  const remaining = o.quantity.sub(o.filledQty);
  const price = o.orderType === 'LIMIT' && o.limitPrice ? `LIMIT ${p6(o.limitPrice)} ${security.currency}` : 'MARKET (at best)';
  const fields = {
    orderRef: o.ref,
    side: o.side,
    security: `${security.ticker} - ${security.name}`,
    market: security.market,
    quantity: q(remaining),
    price,
    timeInForce: o.tif,
    urgency: o.urgency,
    account: `${portfolio.ref} ${portfolio.name}`,
    currency: security.currency,
  };
  const text = [
    `Dear ${broker.name},`,
    '',
    `Please execute the following order for account ${fields.account}:`,
    '',
    `  Reference:      ${fields.orderRef}`,
    `  Instruction:    ${fields.side} ${fields.quantity} ${security.ticker} (${security.name}) on ${security.market}`,
    `  Price:          ${fields.price}`,
    `  Time in force:  ${fields.timeInForce}`,
    `  Urgency:        ${fields.urgency}`,
    ...(note ? ['', `Note: ${note}`] : []),
    '',
    'Please confirm the execution (quantity, price, time) by reply and send the contract note, quoting the reference above.',
    '',
    'Matanho Capital - Dealing desk',
  ].join('\n');
  return {
    channel: 'EMAIL',
    to: broker.email ?? '',
    brokerName: broker.name,
    subject: `Order instruction ${o.ref}: ${o.side} ${q(remaining)} ${security.ticker}`,
    text,
    fields: { ...fields, note: note ?? null },
  };
}

// ---------------------------------------------------------------- misc

export function reqUser(req: Request) {
  const u = req.user;
  if (!u) throw HttpError.unauthorized();
  return u;
}
