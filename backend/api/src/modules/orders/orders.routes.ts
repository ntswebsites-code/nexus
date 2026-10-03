import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { enqueue } from '../../lib/outbox';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { D, ZERO, assertSegregation, assertUpdated, audit, notifyPermission, seqRef } from '../ops/ops.common';
import { getBrokerList, latestPrices, loadPortfolio } from '../portfolio/portfolio.service';
import { ensureOrderReservation, orderCashView, releaseOrderCash, reserveOrderCash, syncOrderReservation } from '../cash/cash.orders';
import { settleOrder } from './orders.settle';
import { applyFillTx } from './orders.fill';
import { RESERVING_STATUSES, estimateFee, runPreTradeChecks, type PreTradeResult } from './orders.checks';
import {
  CANCELLABLE,
  allowedActions,
  assertTransition,
  buildInstruction,
  fillView,
  loadOrderRow,
  lookups,
  orderView,
  referencePrice,
  reservationFor,
  slippageBp,
  today,
  visibleTo,
  type OrderRow,
  type OrderStatus,
} from './orders.service';

/**
 * Orders (OMS), SRD 11.3 / 6.6 / 7.2. Mounted at `/api/v1/orders`, staff (admin portal) only; auth per route.
 *
 *   GET    /                                 orders.view      blotter + KPI summary
 *   POST   /precheck                         orders.create    what-if pre-trade check (writes nothing)
 *   POST   /                                 orders.create    Draft (Idempotency-Key required)
 *   GET    /:id                              orders.view      detail, fills, instruction, timeline, allowed actions
 *   PATCH  /:id                              orders.create    maker, Draft/Validated only (If-Match / version)
 *   POST   /:id/validate                     orders.create    maker; runs the checks, Draft <-> Validated
 *   POST   /:id/submit                       orders.create    maker; rationale; reserves cash for buys
 *   POST   /:id/approve | /reject            orders.approve   approver != maker, step-up
 *   GET    /:id/broker-instruction/preview   orders.route
 *   POST   /:id/route                        orders.route     Approved only, router != approver (BR-003), step-up
 *   POST   /:id/fills                        orders.route     partial/complete fills, updates positions and cash
 *   POST   /:id/cancel                       maker or orders.approve, reason
 */
export const ordersRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];

// ---------------------------------------------------------------- schemas

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idStr = z.string().trim().min(1).max(64);
const qtyInput = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,15}$/.test(v) && new D(v).gt(0), 'Quantity must be a positive whole number');
const priceInput = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,14}(\.\d{1,6})?$/.test(v) && new D(v).gt(0), 'Enter a positive price (up to 6 decimals)');
const feeInput = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v), 'Enter a fee amount (up to 4 decimals)');
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');

const ticketFields = {
  portfolioId: idStr,
  securityId: idStr,
  side: z.enum(['BUY', 'SELL']),
  quantity: qtyInput,
  orderType: z.enum(['MARKET', 'LIMIT']),
  limitPrice: priceInput.nullish(),
  tif: z.enum(['DAY', 'GTC', 'IOC']).default('DAY'),
  urgency: z.enum(['Low', 'Normal', 'High']).default('Normal'),
  brokerId: idStr.nullish(),
  rationale: z.string().trim().max(2000).nullish(),
};
const limitRule = (b: { orderType?: string; limitPrice?: string | null }) => b.orderType !== 'LIMIT' || !!b.limitPrice;
const limitMsg = { message: 'A limit price is required for a LIMIT order', path: ['limitPrice'] };

const createSchema = z.object(ticketFields).refine(limitRule, limitMsg);
const precheckSchema = z.object({ ...ticketFields, rationale: z.any().optional() }).refine(limitRule, limitMsg);
const patchSchema = z
  .object({
    portfolioId: ticketFields.portfolioId,
    securityId: ticketFields.securityId,
    side: ticketFields.side,
    quantity: ticketFields.quantity,
    orderType: ticketFields.orderType,
    limitPrice: priceInput.nullable(),
    tif: z.enum(['DAY', 'GTC', 'IOC']),
    urgency: z.enum(['Low', 'Normal', 'High']),
    brokerId: idStr.nullable(),
    rationale: z.string().trim().max(2000).nullable(),
    version: z.number().int().optional(),
  })
  .partial();
const submitSchema = z.object({ rationale: z.string({ error: 'A rationale is required' }).trim().min(3, 'A rationale is required').max(2000), version: z.number().int().optional() });
const reasonSchema = z.object({ reason: z.string({ error: 'A reason is required' }).trim().min(3, 'A reason is required').max(255), version: z.number().int().optional() });
const approveSchema = z.object({ note: z.string().trim().max(500).optional(), version: z.number().int().optional() });
const routeSchema = z.object({ brokerId: idStr.optional(), note: z.string().trim().max(500).optional(), version: z.number().int().optional() });
const fillSchema = z.object({
  quantity: qtyInput,
  price: priceInput,
  fees: feeInput.optional(),
  executedAt: z.string().datetime({ offset: true }).optional(),
  source: z.enum(['MANUAL', 'FIX', 'CONTRACT_NOTE']).default('MANUAL'),
  sourceRef: z.string().trim().max(120).optional(),
  version: z.number().int().optional(),
});
const listQuery = z.object({
  status: z.string().trim().max(200).optional(),
  portfolioId: z.string().trim().max(64).optional(),
  securityId: z.string().trim().max(64).optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  q: z.string().trim().max(60).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  mine: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------- helpers

const j = (v: unknown) => v as Prisma.InputJsonValue;

async function resolveSecurity(idOrTicker: string) {
  const s = await prisma.security.findFirst({ where: UUID.test(idOrTicker) ? { id: idOrTicker } : { ticker: idOrTicker.toUpperCase() } });
  if (!s) throw HttpError.notFound('Security not found');
  return s;
}

/** Early, field-level rejection of tickets that can never be valid: not a board-lot multiple, or absurdly large against volume. */
function assertTicketSize(security: { boardLot: number; averageDailyVolume: Prisma.Decimal | null; ticker: string }, quantity: string | Prisma.Decimal) {
  const qty = new D(quantity);
  const lot = security.boardLot > 0 ? security.boardLot : 1;
  if (!qty.mod(lot).isZero()) throw HttpError.badRequest('Validation failed', [{ path: 'quantity', message: `Quantity must be a multiple of the ${security.ticker} board lot (${lot})` }]);
  const adv = security.averageDailyVolume;
  if (adv && adv.gt(0) && qty.gt(adv.mul(10))) {
    throw HttpError.badRequest('Validation failed', [{ path: 'quantity', message: `Quantity ${qty.toString()} is more than 10 times the average daily volume of ${security.ticker} (${adv.toString()}); check the size` }]);
  }
}

async function assertBroker(brokerId: string | null | undefined) {
  if (!brokerId) return null;
  const b = await prisma.broker.findUnique({ where: { id: brokerId } });
  if (!b || b.status !== 'Active') throw HttpError.badRequest('Validation failed', [{ path: 'brokerId', message: 'Unknown or inactive broker' }]);
  return b;
}

async function latestPrice(securityId: string) {
  return (await latestPrices([securityId], new Date())).get(securityId)?.latestDec ?? null;
}

function assertMaker(o: OrderRow, userId: string) {
  if (o.makerId !== userId) throw HttpError.forbidden('Only the person who created this order can do that', 'not_order_maker');
}

/** Locks the portfolio row so checks, reservations and fills for one book are serialised. */
async function lockPortfolio(tx: Prisma.TransactionClient, portfolioId: string) {
  await tx.$queryRaw`SELECT id FROM portfolios WHERE id = ${portfolioId} FOR UPDATE`;
}

interface MoveOpts {
  data?: Prisma.OrderUncheckedUpdateManyInput;
  action: string;
  after?: Record<string, unknown>;
  reason?: string | null;
}

/** State-guarded, version-guarded status change plus its audit event (call inside the transaction). */
async function move(tx: Prisma.TransactionClient, req: Request, o: OrderRow, to: OrderStatus, opts: MoveOpts) {
  assertTransition(o.status, to);
  assertUpdated((await tx.order.updateMany({ where: { id: o.id, status: o.status, version: o.version }, data: { ...(opts.data ?? {}), status: to, version: { increment: 1 } } })).count);
  await writeAudit(tx, audit(req), {
    action: opts.action,
    objectType: 'order',
    objectId: o.id,
    before: { status: o.status },
    after: { status: to, ...(opts.after ?? {}) },
    reason: opts.reason ?? null,
  });
}

async function respond(res: import('express').Response, req: Request, id: string, status = 200) {
  res.status(status).json({ data: await detail(req, await loadOrderRow(id)) });
}

async function timeline(orderId: string) {
  const events = await prisma.auditEvent.findMany({ where: { objectType: 'order', objectId: orderId }, orderBy: { id: 'asc' }, take: 200 });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true, email: true } });
  const names = new Map(actors.map((a) => [a.id, a.name || a.email]));
  const st = (v: unknown) => (v && typeof v === 'object' && 'status' in v ? String((v as { status: unknown }).status) : null);
  return events.map((e) => ({
    at: e.occurredAt,
    action: e.action,
    actor: e.actorId ? (names.get(e.actorId) ?? 'Unknown user') : 'System',
    actorRole: e.actorRole,
    from: st(e.before),
    to: st(e.after),
    reason: e.reason,
    detail: e.after,
  }));
}

async function detail(req: Request, o: OrderRow) {
  const fills = await prisma.orderFill.findMany({ where: { orderId: o.id }, orderBy: [{ executedAt: 'asc' }, { createdAt: 'asc' }] });
  const instruction = await prisma.brokerInstruction.findFirst({ where: { orderId: o.id }, orderBy: { createdAt: 'desc' } });
  const l = await lookups([o], fills.map((f) => f.recordedBy));
  const user = req.user!;
  // The IC decision that produced this order, if any (research module links them in ic_decision_orders).
  const link = await prisma.icDecisionOrder.findFirst({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } });
  const icd = link ? await prisma.icDecision.findUnique({ where: { id: link.decisionId }, include: { researchCase: { select: { ref: true, title: true } } } }) : null;
  const gains = o.side === 'SELL' ? await prisma.orderRealisedGain.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } }) : [];
  const sum = (f: (g: (typeof gains)[number]) => Prisma.Decimal) => gains.reduce((s, g) => s.add(f(g)), ZERO);
  // The cash service's view of this order: its holds (all states) and the ledger's availability now, so ticket and Cash page agree.
  const holds = await prisma.cashReservation.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } });
  const ledgerNow = o.side === 'BUY' ? await orderCashView(o.portfolioId, o.currency, o.id) : null;
  return {
    ...orderView(o, l),
    cash: {
      holds: holds.map((h) => ({ id: h.id, ref: h.ref, status: h.status, amount: h.amount.toFixed(2), consumed: h.consumed.toFixed(2), remaining: h.amount.sub(h.consumed).toFixed(2), currency: h.currency, releaseReason: h.releaseReason })),
      ledger: ledgerNow ? { ref: ledgerNow.ledgerRef, posted: ledgerNow.posted.toFixed(2), reservedByOthers: ledgerNow.reserved.toFixed(2), minBuffer: ledgerNow.minBuffer.toFixed(2), available: ledgerNow.available.toFixed(2) } : null,
    },
    decision: icd
      ? { id: icd.id, ref: icd.ref, action: icd.action, status: icd.status, quantity: icd.quantity?.toString() ?? null, rationale: icd.rationale, ratifiedAt: icd.ratifiedAt, votes: { for: icd.votesFor, against: icd.votesAgainst, abstain: icd.votesAbstain }, caseId: icd.caseId, caseRef: icd.researchCase.ref, caseTitle: icd.researchCase.title, link: `/ops/research?decision=${icd.id}` }
      : null,
    realisedGain: o.side === 'SELL' && gains.length
      ? {
          method: 'AVG_COST',
          currency: o.currency,
          proceeds: sum((g) => g.proceeds).toFixed(2),
          costBasis: sum((g) => g.costBasis).toFixed(2),
          fees: sum((g) => g.fees).toFixed(2),
          gain: sum((g) => g.realisedGain).toFixed(2),
          netOfFees: sum((g) => g.realisedGain.sub(g.fees)).toFixed(2),
          fills: gains.map((g) => ({ fillId: g.fillId, quantity: g.quantity.toString(), unitCost: g.unitCost.toString(), proceeds: g.proceeds.toFixed(2), costBasis: g.costBasis.toFixed(2), gain: g.realisedGain.toFixed(2) })),
        }
      : null,
    fills: fills.map((f) => fillView(f, l.users)),
    instruction: instruction
      ? { id: instruction.id, channel: instruction.channel, payload: instruction.payload, sentAt: instruction.sentAt, deliveryStatus: instruction.deliveryStatus, createdAt: instruction.createdAt }
      : null,
    timeline: await timeline(o.id),
    allowed: allowedActions(o, user.id, user.permissions),
  };
}

/** Runs the checks for an order's current fields (decision price = the latest price now). */
async function precheckFor(o: OrderRow, excludeSelf: boolean): Promise<{ result: PreTradeResult; decision: Prisma.Decimal }> {
  const decision = (await latestPrice(o.securityId)) ?? o.decisionPrice;
  const result = await runPreTradeChecks(o.portfolioId, {
    securityId: o.securityId,
    side: o.side as 'BUY' | 'SELL',
    quantity: o.quantity,
    price: referencePrice({ ...o, decisionPrice: decision }),
    excludeOrderId: excludeSelf ? o.id : undefined,
  });
  return { result, decision };
}

// ---------------------------------------------------------------- list

ordersRoutes.get('/', ...staff, requirePermission('orders.view'), validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const me = req.user!.id;
  const and: Prisma.OrderWhereInput[] = [{ OR: [{ status: { notIn: ['Draft', 'Validated'] } }, { makerId: me }] }];
  if (f.status) {
    const list = f.status.split(',').map((s) => s.trim()).filter(Boolean);
    // Friendly groups used by the blotter KPI strip.
    const expand = list.flatMap((s) => (s === 'Working' ? ['Approved', 'Routing', 'PartiallyFilled'] : [s]));
    and.push({ status: { in: expand } });
  }
  const resolveId = async (v: string, kind: 'portfolio' | 'security') => {
    if (UUID.test(v)) return v;
    const row = kind === 'portfolio' ? await prisma.portfolio.findUnique({ where: { ref: v }, select: { id: true } }) : await prisma.security.findUnique({ where: { ticker: v.toUpperCase() }, select: { id: true } });
    return row?.id ?? '00000000-0000-0000-0000-000000000000';
  };
  if (f.portfolioId) and.push({ portfolioId: await resolveId(f.portfolioId, 'portfolio') });
  if (f.securityId) and.push({ securityId: await resolveId(f.securityId, 'security') });
  if (f.side) and.push({ side: f.side });
  if (f.q) and.push({ ref: { contains: f.q } });
  if (f.mine) and.push({ makerId: me });
  if (f.from) and.push({ createdAt: { gte: new Date(`${f.from}T00:00:00.000Z`) } });
  if (f.to) and.push({ createdAt: { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 86_400_000) } });
  const where: Prisma.OrderWhereInput = { AND: and };

  const [total, rows, grouped, filled] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.order.findMany({ where: { AND: [...and, { avgPrice: { not: null } }] }, select: { side: true, avgPrice: true, decisionPrice: true, filledQty: true }, take: 2000 }),
  ]);
  const count = (...s: string[]) => grouped.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
  // Slippage: fill-notional weighted average over the filtered orders that have fills.
  let weighted = ZERO;
  let weight = ZERO;
  for (const r of filled) {
    const bp = slippageBp(r.side, r.avgPrice, r.decisionPrice);
    if (bp === null) continue;
    const notional = r.filledQty.mul(r.avgPrice!);
    weighted = weighted.add(notional.mul(bp));
    weight = weight.add(notional);
  }
  const l = await lookups(rows);
  res.json({
    data: rows.map((o) => orderView(o, l)),
    total,
    limit: f.limit,
    offset: f.offset,
    summary: {
      working: count('Approved', 'Routing', 'PartiallyFilled'),
      awaitingApproval: count('AwaitingApproval'),
      filled: count('Filled', 'Settled'),
      slippageBp: weight.isZero() ? null : Math.round(weighted.div(weight).toNumber() * 10) / 10,
      byStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
    },
  });
});

// ---------------------------------------------------------------- what-if check

ordersRoutes.post('/precheck', ...staff, requirePermission('orders.create'), validateBody(precheckSchema), async (req, res) => {
  const b = req.body as z.infer<typeof precheckSchema>;
  const portfolio = await loadPortfolio(b.portfolioId);
  const security = await resolveSecurity(b.securityId);
  const last = await latestPrice(security.id);
  if (!last) throw HttpError.conflict(`${security.ticker} has no price on file`, 'no_price');
  const price = b.orderType === 'LIMIT' ? new D(b.limitPrice!) : last;
  const result = await runPreTradeChecks(portfolio.id, { securityId: security.id, side: b.side, quantity: b.quantity, price });
  res.json({ data: { ...result, decisionPrice: last.toString() } });
});

// ---------------------------------------------------------------- create / read / patch

ordersRoutes.post('/', ...staff, requirePermission('orders.create'), validateBody(createSchema), idempotent('orders.create'), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const portfolio = await loadPortfolio(b.portfolioId);
  const security = await resolveSecurity(b.securityId);
  if (security.status !== 'Active') throw HttpError.conflict(`${security.ticker} is ${security.status} and cannot be ordered`, 'security_not_tradable');
  const decision = await latestPrice(security.id);
  if (!decision) throw HttpError.conflict(`${security.ticker} has no price on file`, 'no_price');
  assertTicketSize(security, b.quantity);
  await assertBroker(b.brokerId);
  const id = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'order', 'ORD-', 6, 1001);
    const o = await tx.order.create({
      data: {
        ref,
        portfolioId: portfolio.id,
        securityId: security.id,
        side: b.side,
        quantity: new D(b.quantity),
        orderType: b.orderType,
        limitPrice: b.orderType === 'LIMIT' ? new D(b.limitPrice!) : null,
        tif: b.tif,
        urgency: b.urgency,
        brokerId: b.brokerId ?? null,
        rationale: b.rationale ?? null,
        currency: security.currency,
        decisionPrice: decision,
        status: 'Draft',
        makerId: req.user!.id,
      },
    });
    await writeAudit(tx, audit(req), {
      action: 'order.created',
      objectType: 'order',
      objectId: o.id,
      after: { ref, status: 'Draft', portfolio: portfolio.ref, security: security.ticker, side: b.side, quantity: b.quantity, orderType: b.orderType, limitPrice: b.limitPrice ?? null },
    });
    return o.id;
  });
  await respond(res, req, id, 201);
});

ordersRoutes.get('/:id', ...staff, requirePermission('orders.view'), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  res.json({ data: await detail(req, o) });
});

ordersRoutes.patch('/:id', ...staff, requirePermission('orders.create'), validateBody(patchSchema), idempotent('orders.patch.id', { required: false }), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  assertMaker(o, req.user!.id);
  if (!['Draft', 'Validated'].includes(o.status)) throw new HttpError(409, 'invalid_transition', `An order that is ${o.status} can no longer be edited`);
  expectVersion(req, o.version);
  const b = req.body as z.infer<typeof patchSchema>;

  const data: Prisma.OrderUncheckedUpdateManyInput = {};
  const changes: Record<string, unknown> = {};
  let material = false;
  let portfolioId = o.portfolioId;
  let security = null as Awaited<ReturnType<typeof resolveSecurity>> | null;
  if (b.portfolioId !== undefined) {
    portfolioId = (await loadPortfolio(b.portfolioId)).id;
    if (portfolioId !== o.portfolioId) {
      data.portfolioId = portfolioId;
      changes.portfolioId = portfolioId;
      material = true;
    }
  }
  if (b.securityId !== undefined) {
    security = await resolveSecurity(b.securityId);
    if (security.id !== o.securityId) {
      if (security.status !== 'Active') throw HttpError.conflict(`${security.ticker} is ${security.status} and cannot be ordered`, 'security_not_tradable');
      const decision = await latestPrice(security.id);
      if (!decision) throw HttpError.conflict(`${security.ticker} has no price on file`, 'no_price');
      Object.assign(data, { securityId: security.id, currency: security.currency, decisionPrice: decision });
      changes.securityId = security.id;
      material = true;
    }
  }
  if (b.quantity !== undefined || security) {
    const sec = security ?? (await resolveSecurity(o.securityId));
    assertTicketSize(sec, b.quantity ?? o.quantity);
  }
  const set = <K extends keyof typeof b>(k: K, apply: (v: NonNullable<(typeof b)[K]>) => void, isMaterial: boolean, same: (v: NonNullable<(typeof b)[K]>) => boolean) => {
    const v = b[k];
    if (v === undefined || v === null) return;
    if (same(v as NonNullable<(typeof b)[K]>)) return;
    apply(v as NonNullable<(typeof b)[K]>);
    changes[k as string] = v;
    if (isMaterial) material = true;
  };
  set('side', (v) => (data.side = v), true, (v) => v === o.side);
  set('quantity', (v) => (data.quantity = new D(v)), true, (v) => o.quantity.eq(v));
  set('orderType', (v) => (data.orderType = v), true, (v) => v === o.orderType);
  set('tif', (v) => (data.tif = v), true, (v) => v === o.tif);
  set('urgency', (v) => (data.urgency = v), false, (v) => v === o.urgency);
  if (b.limitPrice !== undefined && !(b.limitPrice === null ? o.limitPrice === null : o.limitPrice?.eq(b.limitPrice))) {
    data.limitPrice = b.limitPrice === null ? null : new D(b.limitPrice);
    changes.limitPrice = b.limitPrice;
    material = true;
  }
  if (b.brokerId !== undefined && b.brokerId !== o.brokerId) {
    await assertBroker(b.brokerId);
    data.brokerId = b.brokerId;
    changes.brokerId = b.brokerId;
  }
  if (b.rationale !== undefined && b.rationale !== o.rationale) {
    data.rationale = b.rationale;
    changes.rationale = b.rationale;
  }
  const orderType = (data.orderType as string | undefined) ?? o.orderType;
  const limit = data.limitPrice === undefined ? o.limitPrice : (data.limitPrice as Prisma.Decimal | null);
  if (orderType === 'LIMIT' && !limit) throw HttpError.badRequest('Validation failed', [{ path: 'limitPrice', message: 'A limit price is required for a LIMIT order' }]);
  if (orderType === 'MARKET' && limit) data.limitPrice = null;

  if (!Object.keys(changes).length) return respond(res, req, o.id);
  // A material edit invalidates the stored check: a Validated order drops back to Draft.
  const toDraft = material && o.status === 'Validated';
  if (material) Object.assign(data, { precheckResult: Prisma.DbNull, precheckAt: null });
  await prisma.$transaction(async (tx) => {
    if (toDraft) {
      await move(tx, req, o, 'Draft', { data, action: 'order.updated', after: { changes, precheckCleared: true } });
    } else {
      assertUpdated((await tx.order.updateMany({ where: { id: o.id, status: o.status, version: o.version }, data: { ...data, version: { increment: 1 } } })).count);
      await writeAudit(tx, audit(req), { action: 'order.updated', objectType: 'order', objectId: o.id, before: { status: o.status }, after: { status: o.status, changes } });
    }
  });
  await respond(res, req, o.id);
});

// ---------------------------------------------------------------- validate

ordersRoutes.post('/:id/validate', ...staff, requirePermission('orders.create'), idempotent('orders.post.id_validate', { required: false }), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  assertMaker(o, req.user!.id);
  if (!['Draft', 'Validated'].includes(o.status)) throw new HttpError(409, 'invalid_transition', `An order that is ${o.status} cannot be validated`);
  expectVersion(req, o.version);
  const { result, decision } = await precheckFor(o, false);
  const target: OrderStatus = result.overall === 'Blocked' ? 'Draft' : 'Validated';
  const data: Prisma.OrderUncheckedUpdateManyInput = { precheckResult: j(result), precheckAt: new Date(), decisionPrice: decision };
  await prisma.$transaction(async (tx) => {
    const after = { overall: result.overall, checks: result.checks.map((c) => `${c.key}:${c.result}`) };
    if (target === o.status) {
      assertUpdated((await tx.order.updateMany({ where: { id: o.id, status: o.status, version: o.version }, data: { ...data, version: { increment: 1 } } })).count);
      await writeAudit(tx, audit(req), { action: 'order.validated', objectType: 'order', objectId: o.id, before: { status: o.status }, after: { status: o.status, ...after } });
    } else {
      await move(tx, req, o, target, { data, action: 'order.validated', after });
    }
  });
  await respond(res, req, o.id);
});

// ---------------------------------------------------------------- submit

ordersRoutes.post('/:id/submit', ...staff, requirePermission('orders.create'), validateBody(submitSchema), idempotent('orders.submit'), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  assertMaker(o, req.user!.id);
  if (o.status === 'Draft') throw new HttpError(409, 'precheck_required', 'Run the pre-trade check and clear it (not Blocked) before submitting');
  assertTransition(o.status, 'AwaitingApproval');
  expectVersion(req, o.version);
  const { rationale } = req.body as z.infer<typeof submitSchema>;

  let blocked: PreTradeResult | null = null;
  await prisma.$transaction(async (tx) => {
    await lockPortfolio(tx, o.portfolioId);
    // The check is re-run under the portfolio lock: cash and shares are tested against every other open order.
    const { result, decision } = await precheckFor(o, true);
    if (result.overall === 'Blocked') {
      blocked = result;
      await move(tx, req, o, 'Draft', {
        data: { precheckResult: j(result), precheckAt: new Date(), decisionPrice: decision },
        action: 'order.precheck_failed',
        after: { overall: result.overall, failed: result.checks.filter((c) => c.result === 'Fail').map((c) => c.key) },
      });
      return;
    }
    if (result.overall === 'Review' && rationale.length < 10) {
      throw HttpError.badRequest('Validation failed', [{ path: 'rationale', message: 'A check is on Review: document the reason in the rationale (at least 10 characters)' }]);
    }
    const priced = { ...o, decisionPrice: decision };
    const buy = o.side === 'BUY';
    const reserve = buy ? reservationFor(priced) : null;
    const fee = estimateFee(o.quantity.mul(referencePrice(priced)));
    await move(tx, req, o, 'AwaitingApproval', {
      data: {
        rationale,
        precheckResult: j(result),
        precheckAt: new Date(),
        decisionPrice: decision,
        submittedAt: new Date(),
        estimatedFee: fee,
        reserveUnit: reserve?.unit ?? null,
        reservedAmount: reserve?.amount ?? ZERO,
      },
      action: 'order.submitted',
      after: { overall: result.overall, reservedAmount: reserve ? reserve.amount.toFixed(4) : '0', currency: o.currency },
      reason: rationale,
    });
    // FR-CASH-015: a buy holds cash on the portfolio's bank ledger (row-locked availability check; 409 when short).
    if (reserve) await reserveOrderCash(tx, audit(req), { id: o.id, ref: o.ref, portfolioId: o.portfolioId, currency: o.currency }, reserve.amount);
    const sec =await tx.security.findUnique({ where: { id: o.securityId }, select: { ticker: true } });
    await notifyPermission(tx, 'orders.approve', {
      type: 'order.submitted',
      title: `Order ${o.ref} awaiting approval: ${o.side} ${o.quantity.toString()} ${sec?.ticker ?? ''}`,
      body: rationale.slice(0, 200),
      link: `/ops/orders/${o.id}`,
    });
  });
  if (blocked) {
    const failed = (blocked as PreTradeResult).checks.filter((c) => c.result === 'Fail');
    const err = new HttpError(409, 'precheck_blocked', `Blocked by the pre-trade check: ${failed.map((c) => c.label).join(', ')}`, { checks: failed });
    throw err;
  }
  await respond(res, req, o.id);
});

// ---------------------------------------------------------------- approve / reject

ordersRoutes.post('/:id/approve', ...staff, requirePermission('orders.approve'), requireStepUp, validateBody(approveSchema), idempotent('orders.approve'), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  assertTransition(o.status, 'Approved');
  assertSegregation(req.user!.id, o.makerId);
  expectVersion(req, o.version);
  const { note } = req.body as z.infer<typeof approveSchema>;
  await prisma.$transaction(async (tx) => {
    await move(tx, req, o, 'Approved', { data: { approverId: req.user!.id, approvedAt: new Date() }, action: 'order.approved', reason: note ?? null });
    if (o.side === 'BUY' && o.reservedAmount.gt(0)) await ensureOrderReservation(tx, audit(req), { id: o.id, ref: o.ref, portfolioId: o.portfolioId, currency: o.currency }, o.reservedAmount);
    const sec = await tx.security.findUnique({ where: { id: o.securityId }, select: { ticker: true } });
    await notifyPermission(tx, 'orders.route', {
      type: 'order.approved',
      title: `Order ${o.ref} approved for routing: ${o.side} ${o.quantity.toString()} ${sec?.ticker ?? ''}`,
      link: `/ops/orders/${o.id}`,
    });
  });
  await respond(res, req, o.id);
});

ordersRoutes.post('/:id/reject', ...staff, requirePermission('orders.approve'), requireStepUp, validateBody(reasonSchema), idempotent('orders.post.id_reject', { required: false }), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  assertTransition(o.status, 'Rejected');
  assertSegregation(req.user!.id, o.makerId);
  expectVersion(req, o.version);
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  await prisma.$transaction(async (tx) => {
    await move(tx, req, o, 'Rejected', { data: { rejectReason: reason, reservedAmount: ZERO }, action: 'order.rejected', reason, after: { releasedReservation: o.reservedAmount.toFixed(4) } });
    await releaseOrderCash(tx, audit(req), o.id, `Order ${o.ref} rejected: ${reason}`);
    await enqueue(tx, 'notify.users', { userIds: [o.makerId], type: 'order.rejected', title: `Order ${o.ref} was rejected`, body: reason, link: `/ops/orders/${o.id}` });
  });
  await respond(res, req, o.id);
});

// ---------------------------------------------------------------- route

async function routingContext(o: OrderRow, brokerIdOverride?: string) {
  const brokerId = brokerIdOverride ?? o.brokerId;
  if (!brokerId) throw HttpError.badRequest('Validation failed', [{ path: 'brokerId', message: 'Choose the executing broker' }]);
  const broker = await prisma.broker.findUnique({ where: { id: brokerId } });
  if (!broker || broker.status !== 'Active') throw HttpError.conflict('The broker is unknown or inactive', 'broker_unavailable');
  if (!broker.email) throw HttpError.conflict(`${broker.name} has no email address for instructions`, 'broker_unavailable');
  const [portfolio, security] = await Promise.all([prisma.portfolio.findUniqueOrThrow({ where: { id: o.portfolioId } }), prisma.security.findUniqueOrThrow({ where: { id: o.securityId } })]);
  return { broker, portfolio, security };
}

ordersRoutes.get('/:id/broker-instruction/preview', ...staff, requirePermission('orders.route'), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  const q = typeof req.query.brokerId === 'string' && req.query.brokerId ? req.query.brokerId : undefined;
  const { broker, portfolio, security } = await routingContext(o, q);
  res.json({
    data: {
      orderStatus: o.status,
      routable: o.status === 'Approved',
      broker: { id: broker.id, name: broker.name, email: broker.email },
      instruction: buildInstruction(o, broker, portfolio, security, typeof req.query.note === 'string' ? req.query.note : null),
      brokers: await getBrokerList(),
    },
  });
});

ordersRoutes.post('/:id/route', ...staff, requirePermission('orders.route'), requireStepUp, validateBody(routeSchema), idempotent('orders.route'), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  assertTransition(o.status, 'Routing');
  // BR-003: whoever approved the order may not route it.
  assertSegregation(req.user!.id, o.approverId);
  expectVersion(req, o.version);
  const b = req.body as z.infer<typeof routeSchema>;
  const { broker, portfolio, security } = await routingContext(o, b.brokerId);
  const payload = buildInstruction(o, broker, portfolio, security, b.note ?? null);
  await prisma.$transaction(async (tx) => {
    await move(tx, req, o, 'Routing', {
      data: { routerId: req.user!.id, routedAt: new Date(), brokerId: broker.id },
      action: 'order.routed',
      after: { broker: broker.name, channel: 'EMAIL' },
      reason: b.note ?? null,
    });
    await tx.brokerInstruction.create({ data: { orderId: o.id, brokerId: broker.id, channel: 'EMAIL', payload: j(payload), deliveryStatus: 'QUEUED', createdBy: req.user!.id } });
    await enqueue(tx, 'email.send', { to: payload.to, subject: payload.subject, text: payload.text });
  });
  await respond(res, req, o.id);
});

// ---------------------------------------------------------------- fills

ordersRoutes.post('/:id/fills', ...staff, requirePermission('orders.route'), validateBody(fillSchema), idempotent('orders.fill'), async (req, res) => {
  const first = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(first, req.user!.id)) throw HttpError.notFound('Order not found');
  if (!['Routing', 'PartiallyFilled'].includes(first.status)) throw new HttpError(409, 'invalid_transition', `A fill cannot be recorded on an order that is ${first.status}`);
  expectVersion(req, first.version);
  const b = req.body as z.infer<typeof fillSchema>;
  const qty = new D(b.quantity);
  const price = new D(b.price);
  const fees = new D(b.fees ?? 0);
  const executedAt = b.executedAt ? new Date(b.executedAt) : new Date();
  if (executedAt.getTime() > Date.now() + 60_000) throw HttpError.badRequest('Validation failed', [{ path: 'executedAt', message: 'The execution time cannot be in the future' }]);

  await prisma.$transaction((tx) =>
    applyFillTx(tx, audit(req), first, { quantity: qty, price, fees, executedAt, source: b.source, sourceRef: b.sourceRef ?? null, recordedBy: req.user!.id }),
  );
  await respond(res, req, first.id, 201);
});

// ---------------------------------------------------------------- settle

/** Filled -> Settled. Creates the trade journals (accounting and cash ledger) as PENDING_APPROVAL by the system actor; idempotent per order. */
ordersRoutes.post('/:id/settle', ...staff, requirePermission('orders.route'), idempotent('orders.settle', { required: false }), async (req, res) => {
  const first = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(first, req.user!.id)) throw HttpError.notFound('Order not found');
  if (first.status !== 'Filled') throw new HttpError(409, 'invalid_transition', `An order that is ${first.status} cannot be settled; only a Filled order can`);
  const journals = await prisma.$transaction(async (tx) => {
    await lockPortfolio(tx, first.portfolioId);
    const o = await loadOrderRow(first.id, tx);
    await move(tx, req, o, 'Settled', { action: 'order.settled', after: { filledQty: o.filledQty.toString() } });
    return settleOrder(tx, audit(req), o);
  });
  const data = await detail(req, await loadOrderRow(first.id));
  res.json({ data: { ...data, settlementJournals: journals } });
});

// ---------------------------------------------------------------- cancel

ordersRoutes.post('/:id/cancel', ...staff, requirePermission('orders.view'), validateBody(reasonSchema), idempotent('orders.post.id_cancel', { required: false }), async (req, res) => {
  const o = await loadOrderRow(param(req, 'id'));
  if (!visibleTo(o, req.user!.id)) throw HttpError.notFound('Order not found');
  const me = req.user!;
  // Creator, or an approver (SRD 7.2). Checked before the state so an outsider learns nothing.
  if (o.makerId !== me.id && !me.permissions.includes('orders.approve')) {
    throw HttpError.forbidden('Only the order creator or an approver can cancel an order', 'permission_denied');
  }
  if (!(CANCELLABLE as string[]).includes(o.status)) throw new HttpError(409, 'invalid_transition', `An order that is ${o.status} cannot be cancelled`);
  expectVersion(req, o.version);
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  await prisma.$transaction(async (tx) => {
    await move(tx, req, o, 'Cancelled', {
      data: { cancelReason: reason, reservedAmount: ZERO },
      action: 'order.cancelled',
      reason,
      after: { releasedReservation: o.reservedAmount.toFixed(4), filledQty: o.filledQty.toString() },
    });
    await releaseOrderCash(tx, audit(req), o.id, `Order ${o.ref} cancelled: ${reason}`);
    if (o.makerId !== me.id) {
      await enqueue(tx, 'notify.users', { userIds: [o.makerId], type: 'order.cancelled', title: `Order ${o.ref} was cancelled`, body: reason, link: `/ops/orders/${o.id}` });
    }
  });
  await respond(res, req, o.id);
});

export { RESERVING_STATUSES };
