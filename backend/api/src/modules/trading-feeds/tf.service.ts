import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { SYSTEM_ACTOR_ID, systemCtx } from '../../lib/system';
import { enqueue } from '../../lib/outbox';
import { assertSegregation, assertUpdated, notifyPermission } from '../ops/ops.common';
import { applyFillTx } from '../orders/orders.fill';
import { FeedParseError, brokerRoutingMode, getBrokerRoutingAdapter, orderRefForBrokerRef, type FixExecutionReport } from '../../integrations/broker-routing';
import { getMarketDataAdapter, marketDataMode } from '../../integrations/market-data';
import { hararePartsOf } from '../../integrations/common';
import { ELECTION_OPTIONS, type CaType } from '../corporate-actions/ca.engine';
import { announcementErrors, announcementKey, checkMatch, lineDedupeKey, reasonForApplyError, settleDateFor, settlementAmounts, sha256, type BreakReason } from './tf.engine';

const D = Prisma.Decimal;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dayDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isP2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

// ================================================================ inbound trade lines (contract notes and FIX)

export interface InboundLine {
  source: 'CONTRACT_NOTE' | 'FIX';
  brokerId: string | null;
  fileId: string | null;
  externalRef: string;
  orderRef?: string | null;
  brokerOrderRef?: string | null;
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  fees: string;
  tradeDate: string;
  executedAt: string;
  raw?: unknown;
}
export type LineOutcome = { outcome: 'MATCHED' | 'BREAK' | 'DUPLICATE'; lineId: string; ref: string | null; reason?: BreakReason; detail?: string; orderId?: string | null; orderRef?: string | null; orderFilled?: boolean };

async function findOrder(l: Pick<InboundLine, 'orderRef' | 'brokerOrderRef'>) {
  let ref = l.orderRef?.trim().toUpperCase() || null;
  if (!ref && l.brokerOrderRef) ref = (await orderRefForBrokerRef(l.brokerOrderRef))?.toUpperCase() ?? null;
  if (!ref) return null;
  const o = await prisma.order.findUnique({ where: { ref } });
  if (!o) return null;
  const sec = await prisma.security.findUnique({ where: { id: o.securityId }, select: { ticker: true } });
  return { order: o, ticker: sec?.ticker ?? '?' };
}

async function createLine(tx: Prisma.TransactionClient, l: InboundLine, key: string, userId: string, data: { status: 'MATCHED' | 'BREAK'; orderId?: string | null; fillId?: string | null; reason?: BreakReason; detail?: string }) {
  const ref = await nextRef(tx, 'tradeFeedLine');
  return tx.tradeFeedLine.create({
    data: {
      ref,
      source: l.source,
      fileId: l.fileId,
      brokerId: l.brokerId,
      dedupeKey: key,
      externalRef: trunc(l.externalRef, 120),
      orderRef: l.orderRef ? trunc(l.orderRef, 32) : null,
      brokerOrderRef: l.brokerOrderRef ? trunc(l.brokerOrderRef, 64) : null,
      orderId: data.orderId ?? null,
      fillId: data.fillId ?? null,
      ticker: trunc(l.ticker, 32),
      side: l.side,
      quantity: new D(l.quantity),
      price: new D(l.price),
      fees: new D(l.fees || '0'),
      tradeDate: dayDate(l.tradeDate),
      executedAt: new Date(l.executedAt),
      status: data.status,
      breakReason: data.reason ?? null,
      detail: data.detail ? trunc(data.detail, 500) : null,
      raw: l.raw === undefined ? undefined : json(l.raw),
      createdBy: userId,
    },
  });
}

async function recordBreak(ctx: AuditContext, l: InboundLine, key: string, userId: string, reason: BreakReason, detail: string, orderId: string | null): Promise<LineOutcome> {
  try {
    const row = await prisma.$transaction(async (tx) => {
      const r = await createLine(tx, l, key, userId, { status: 'BREAK', reason, detail, orderId });
      await writeAudit(tx, ctx, { action: 'trade_feed.break_opened', objectType: 'trade_feed_line', objectId: r.id, after: { ref: r.ref, source: l.source, externalRef: l.externalRef, reason, detail, ticker: l.ticker, side: l.side, quantity: l.quantity, price: l.price } });
      return r;
    });
    return { outcome: 'BREAK', lineId: row.id, ref: row.ref, reason, detail, orderId };
  } catch (e) {
    if (!isP2002(e)) throw e;
    const ex = await prisma.tradeFeedLine.findUniqueOrThrow({ where: { dedupeKey: key } });
    return { outcome: 'DUPLICATE', lineId: ex.id, ref: ex.ref };
  }
}

/**
 * Applies one inbound line: a known line is a DUPLICATE (never applied twice); otherwise it is matched to its order and
 * either becomes an order fill (MATCHED) or an open BREAK for an operator. Never throws for business problems.
 */
export async function applyInboundLine(ctx: AuditContext, userId: string, l: InboundLine): Promise<LineOutcome> {
  const key = lineDedupeKey(l.source, l.brokerId, l.externalRef);
  const known = await prisma.tradeFeedLine.findUnique({ where: { dedupeKey: key } });
  if (known) return { outcome: 'DUPLICATE', lineId: known.id, ref: known.ref };
  if (new Date(l.executedAt).getTime() > Date.now() + 60_000) return recordBreak(ctx, l, key, userId, 'APPLY_FAILED', 'The execution time is in the future', null);
  const found = await findOrder(l);
  if (!found) return recordBreak(ctx, l, key, userId, 'NO_ORDER', `No order matches ${l.orderRef ?? l.brokerOrderRef ?? 'the reference on the line'}`, null);
  const { order, ticker } = found;
  const miss = checkMatch({ status: order.status, side: order.side, ticker, quantity: order.quantity, filledQty: order.filledQty, orderType: order.orderType, limitPrice: order.limitPrice, decisionPrice: order.decisionPrice }, { ticker: l.ticker, side: l.side, quantity: new D(l.quantity), price: new D(l.price) });
  if (miss) return recordBreak(ctx, l, key, userId, miss.reason, miss.detail, order.id);
  try {
    const out = await prisma.$transaction(async (tx) => {
      const fill = await applyFillTx(tx, ctx, order, { quantity: new D(l.quantity), price: new D(l.price), fees: new D(l.fees || '0'), executedAt: new Date(l.executedAt), source: l.source, sourceRef: trunc(`${l.source}:${l.externalRef}`, 120), recordedBy: SYSTEM_ACTOR_ID });
      const row = await createLine(tx, l, key, userId, { status: 'MATCHED', orderId: order.id, fillId: fill.fillId });
      return { row, complete: fill.complete };
    });
    return { outcome: 'MATCHED', lineId: out.row.id, ref: out.row.ref, orderId: order.id, orderRef: order.ref, orderFilled: out.complete };
  } catch (e) {
    if (isP2002(e)) {
      const ex = await prisma.tradeFeedLine.findUniqueOrThrow({ where: { dedupeKey: key } });
      return { outcome: 'DUPLICATE', lineId: ex.id, ref: ex.ref };
    }
    if (e instanceof HttpError) return recordBreak(ctx, l, key, userId, reasonForApplyError(e.code), e.message, order.id);
    throw e;
  }
}

/** Generates the settlement instruction for orders a feed just filled (system maker; a human releases it). Best effort. */
async function autoInstruct(orderIds: string[]) {
  for (const id of new Set(orderIds)) {
    try {
      await generateSettlementInstruction(systemCtx(), id, SYSTEM_ACTOR_ID);
    } catch (e) {
      console.error(`[trading-feeds] settlement instruction for order ${id} failed:`, e instanceof Error ? e.message : e);
    }
  }
}

// ---------------------------------------------------------------- contract notes

export interface NoteResult {
  fileId: string;
  adapter: string;
  format: string;
  total: number;
  matched: number;
  breaks: number;
  duplicates: number;
  lines: { ref: string | null; tradeRef: string; outcome: string; reason?: string; detail?: string; orderRef?: string | null }[];
}

export async function ingestContractNote(input: { brokerId: string; filename: string; content: string; format?: 'CSV' | 'JSON'; userId: string; ctx: AuditContext }): Promise<NoteResult> {
  const broker = await prisma.broker.findUnique({ where: { id: input.brokerId } });
  if (!broker) throw HttpError.notFound('Broker not found');
  if (broker.status !== 'Active') throw HttpError.conflict('Broker is not active', 'broker_inactive');
  const filename = trunc(input.filename.replace(/[^\w.\- ]/g, '_'), 200) || 'contract-note';
  const digest = sha256(input.content);
  const dup = await prisma.tradeFeedFile.findUnique({ where: { brokerId_sha256: { brokerId: broker.id, sha256: digest } } });
  if (dup?.status === 'Imported') throw HttpError.conflict(`This file was already imported as ${dup.filename} on ${isoDay(dup.createdAt)}`, 'duplicate_file');
  const adapter = getBrokerRoutingAdapter();
  const adapterName = brokerRoutingMode();

  let parsed;
  try {
    parsed = await adapter.parseContractNote({ brokerCode: broker.name, filename, content: input.content, format: input.format });
  } catch (e) {
    if (!(e instanceof FeedParseError)) throw e;
    const data = { brokerId: broker.id, adapter: adapterName, filename, format: input.format ?? 'CSV', sha256: digest, status: 'Failed', error: trunc(e.message, 500), uploadedBy: input.userId };
    await prisma.tradeFeedFile.upsert({ where: { brokerId_sha256: { brokerId: broker.id, sha256: digest } }, create: data, update: { error: data.error, filename } });
    throw new HttpError(422, 'contract_note_rejected', e.message, { problems: e.problems });
  }
  const file = await prisma.tradeFeedFile.upsert({
    where: { brokerId_sha256: { brokerId: broker.id, sha256: digest } },
    create: { brokerId: broker.id, adapter: adapterName, filename, format: parsed.format, sha256: digest, status: 'Imported', linesTotal: parsed.lines.length, uploadedBy: input.userId },
    update: { status: 'Imported', error: null, filename, format: parsed.format, linesTotal: parsed.lines.length },
  });
  const out: NoteResult = { fileId: file.id, adapter: adapterName, format: parsed.format, total: parsed.lines.length, matched: 0, breaks: 0, duplicates: 0, lines: [] };
  const filled: string[] = [];
  for (const l of parsed.lines) {
    const r = await applyInboundLine(input.ctx, input.userId, { source: 'CONTRACT_NOTE', brokerId: broker.id, fileId: file.id, externalRef: l.tradeRef, orderRef: l.orderRef, brokerOrderRef: l.brokerOrderRef, ticker: l.ticker, side: l.side, quantity: l.quantity, price: l.price, fees: l.fees, tradeDate: l.tradeDate, executedAt: l.executedAt, raw: l });
    if (r.outcome === 'MATCHED') out.matched++;
    else if (r.outcome === 'BREAK') out.breaks++;
    else out.duplicates++;
    if (r.orderFilled && r.orderId) filled.push(r.orderId);
    out.lines.push({ ref: r.ref, tradeRef: l.tradeRef, outcome: r.outcome, reason: r.reason, detail: r.detail, orderRef: r.orderRef });
  }
  await prisma.$transaction(async (tx) => {
    await tx.tradeFeedFile.update({ where: { id: file.id }, data: { linesMatched: out.matched, linesBreak: out.breaks, linesDuplicate: out.duplicates } });
    await writeAudit(tx, input.ctx, { action: 'trade_feed.file_imported', objectType: 'trade_feed_file', objectId: file.id, after: { filename, broker: broker.name, format: parsed.format, total: out.total, matched: out.matched, breaks: out.breaks, duplicates: out.duplicates } });
    if (out.breaks) await notifyPermission(tx, 'orders.route', { type: 'trade_feed.breaks', title: `${out.breaks} contract-note break(s) from ${broker.name}`, body: `${filename}: ${out.matched} matched, ${out.breaks} need review.`, link: '/ops/trading-feeds' });
  });
  await autoInstruct(filled);
  return out;
}

// ---------------------------------------------------------------- FIX execution reports

export interface FixResult {
  received: number;
  matched: number;
  breaks: number;
  duplicates: number;
  ignored: number;
  rejected: { index: number; message: string }[];
  results: { execId: string; outcome: string; ref: string | null; reason?: string; detail?: string }[];
}

export async function ingestExecutionReports(input: { messages: string[]; brokerId?: string | null; userId: string; ctx: AuditContext }): Promise<FixResult> {
  if (input.brokerId) {
    const b = await prisma.broker.findUnique({ where: { id: input.brokerId } });
    if (!b) throw HttpError.notFound('Broker not found');
  }
  const adapter = getBrokerRoutingAdapter();
  const out: FixResult = { received: input.messages.length, matched: 0, breaks: 0, duplicates: 0, ignored: 0, rejected: [], results: [] };
  const filled: string[] = [];
  for (const [index, raw] of input.messages.entries()) {
    let rep: FixExecutionReport;
    try {
      rep = await adapter.parseExecutionReport({ raw });
    } catch (e) {
      if (!(e instanceof FeedParseError)) throw e;
      out.rejected.push({ index, message: e.message });
      continue;
    }
    if (rep.execType !== 'TRADE') {
      out.ignored++;
      continue;
    }
    const r = await applyInboundLine(input.ctx, input.userId, {
      source: 'FIX',
      brokerId: input.brokerId ?? null,
      fileId: null,
      externalRef: rep.execId,
      orderRef: rep.clOrdId,
      brokerOrderRef: rep.orderId,
      ticker: rep.symbol,
      side: rep.side,
      quantity: rep.lastQty,
      price: rep.lastPx,
      fees: rep.commission,
      tradeDate: hararePartsOf(new Date(rep.transactTime)).iso,
      executedAt: rep.transactTime,
      raw: { execId: rep.execId, clOrdId: rep.clOrdId, orderId: rep.orderId, symbol: rep.symbol, raw: rep.raw },
    });
    if (r.outcome === 'MATCHED') out.matched++;
    else if (r.outcome === 'BREAK') out.breaks++;
    else out.duplicates++;
    if (r.orderFilled && r.orderId) filled.push(r.orderId);
    out.results.push({ execId: rep.execId, outcome: r.outcome, ref: r.ref, reason: r.reason, detail: r.detail });
  }
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, input.ctx, { action: 'trade_feed.fix_ingested', objectType: 'trade_feed', objectId: 'fix', after: { received: out.received, matched: out.matched, breaks: out.breaks, duplicates: out.duplicates, ignored: out.ignored, rejected: out.rejected.length } });
    if (out.breaks) await notifyPermission(tx, 'orders.route', { type: 'trade_feed.breaks', title: `${out.breaks} FIX fill break(s) need review`, link: '/ops/trading-feeds' });
  });
  await autoInstruct(filled);
  return out;
}

/** Drains the adapter's FIX session (the fake sender in tests) and ingests what it returns. */
export async function pollExecutionReports(input: { userId: string; ctx: AuditContext; limit?: number }): Promise<FixResult> {
  const { messages } = await getBrokerRoutingAdapter().pollExecutionReports({ limit: input.limit });
  return ingestExecutionReports({ messages, userId: input.userId, ctx: input.ctx });
}

/** Sends a working order to the broker through the routing adapter (so the FIX session knows it). Idempotent per order. */
export async function routeOrderViaAdapter(input: { orderId: string; ctx: AuditContext }) {
  const o = await prisma.order.findFirst({ where: UUID.test(input.orderId) ? { id: input.orderId } : { ref: input.orderId.toUpperCase() } });
  if (!o) throw HttpError.notFound('Order not found');
  if (!['Routing', 'PartiallyFilled'].includes(o.status)) throw HttpError.conflict(`An order that is ${o.status} cannot be sent to the broker`, 'invalid_state');
  const [sec, broker] = await Promise.all([prisma.security.findUnique({ where: { id: o.securityId } }), o.brokerId ? prisma.broker.findUnique({ where: { id: o.brokerId } }) : null]);
  const remaining = o.quantity.sub(o.filledQty);
  const ack = await getBrokerRoutingAdapter().routeOrder({ orderRef: o.ref, brokerCode: broker?.name ?? 'UNASSIGNED', ticker: sec?.ticker ?? '', side: o.side as 'BUY' | 'SELL', quantity: remaining.toString(), limitPrice: o.limitPrice?.toString(), referencePrice: o.decisionPrice.toString() });
  await prisma.$transaction((tx) => writeAudit(tx, input.ctx, { action: 'order.sent_to_broker', objectType: 'order', objectId: o.id, after: { ref: o.ref, brokerOrderRef: ack.brokerOrderRef, status: ack.status, broker: broker?.name ?? null } }));
  return { orderId: o.id, orderRef: o.ref, ...ack };
}

// ---------------------------------------------------------------- break resolution

export async function resolveBreak(input: { lineId: string; action: 'MATCH' | 'REJECT'; orderId?: string; note: string; force?: boolean; userId: string; ctx: AuditContext }) {
  const line = await prisma.tradeFeedLine.findFirst({ where: UUID.test(input.lineId) ? { id: input.lineId } : { ref: input.lineId.toUpperCase() } });
  if (!line) throw HttpError.notFound('Line not found');
  if (line.status !== 'BREAK') throw HttpError.conflict(`${line.ref} is ${line.status}; only an open break can be resolved`, 'invalid_state');
  const resolution = trunc(input.note, 500);
  if (input.action === 'REJECT') {
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.tradeFeedLine.updateMany({ where: { id: line.id, status: 'BREAK' }, data: { status: 'REJECTED', resolvedBy: input.userId, resolvedAt: new Date(), resolution } })).count);
      await writeAudit(tx, input.ctx, { action: 'trade_feed.break_rejected', objectType: 'trade_feed_line', objectId: line.id, before: { status: 'BREAK', reason: line.breakReason }, after: { status: 'REJECTED', ref: line.ref }, reason: resolution });
    });
    return prisma.tradeFeedLine.findUniqueOrThrow({ where: { id: line.id } });
  }
  // Applying a fill that the automatic match refused changes positions and cash: a second person must do it.
  if (line.createdBy !== SYSTEM_ACTOR_ID) assertSegregation(input.userId, line.createdBy);
  const target = input.orderId ?? line.orderId;
  if (!target) throw HttpError.badRequest('Validation failed', [{ path: 'orderId', message: 'Choose the order this line belongs to' }]);
  const order = await prisma.order.findFirst({ where: UUID.test(target) ? { id: target } : { ref: target.toUpperCase() } });
  if (!order) throw HttpError.badRequest('Validation failed', [{ path: 'orderId', message: 'Unknown order' }]);
  const sec = await prisma.security.findUnique({ where: { id: order.securityId }, select: { ticker: true } });
  const miss = checkMatch({ status: order.status, side: order.side, ticker: sec?.ticker ?? '?', quantity: order.quantity, filledQty: order.filledQty, orderType: order.orderType, limitPrice: order.limitPrice, decisionPrice: order.decisionPrice }, { ticker: line.ticker, side: line.side, quantity: line.quantity, price: line.price }, { force: !!input.force });
  if (miss) throw new HttpError(409, miss.reason.toLowerCase(), miss.detail, { reason: miss.reason });
  const done = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.tradeFeedLine.updateMany({ where: { id: line.id, status: 'BREAK' }, data: { status: 'RESOLVED' } })).count);
    const fill = await applyFillTx(tx, input.ctx, order, { quantity: line.quantity, price: line.price, fees: line.fees, executedAt: line.executedAt, source: line.source as 'FIX' | 'CONTRACT_NOTE', sourceRef: trunc(`${line.source}:${line.externalRef}`, 120), recordedBy: SYSTEM_ACTOR_ID });
    await tx.tradeFeedLine.update({ where: { id: line.id }, data: { orderId: order.id, fillId: fill.fillId, resolvedBy: input.userId, resolvedAt: new Date(), resolution, breakReason: line.breakReason } });
    await writeAudit(tx, input.ctx, { action: 'trade_feed.break_resolved', objectType: 'trade_feed_line', objectId: line.id, before: { status: 'BREAK', reason: line.breakReason }, after: { status: 'RESOLVED', ref: line.ref, orderRef: order.ref, fillId: fill.fillId, forced: !!input.force }, reason: resolution });
    return fill;
  });
  if (done.complete) await autoInstruct([order.id]);
  return prisma.tradeFeedLine.findUniqueOrThrow({ where: { id: line.id } });
}

// ================================================================ settlement instructions

export type InstructionRow = Prisma.SettlementInstructionGetPayload<object>;

/** One instruction per filled order; calling it again returns the existing one. */
export async function generateSettlementInstruction(ctx: AuditContext, orderIdOrRef: string, userId: string): Promise<{ instruction: InstructionRow; created: boolean }> {
  const o = await prisma.order.findFirst({ where: UUID.test(orderIdOrRef) ? { id: orderIdOrRef } : { ref: orderIdOrRef.toUpperCase() } });
  if (!o) throw HttpError.notFound('Order not found');
  const existing = await prisma.settlementInstruction.findUnique({ where: { orderId: o.id } });
  if (existing) return { instruction: existing, created: false };
  if (!['Filled', 'Settled'].includes(o.status)) throw HttpError.conflict(`An order that is ${o.status} has nothing to settle yet; only Filled orders get an instruction`, 'invalid_state');
  const [fills, sec, broker, map] = await Promise.all([
    prisma.orderFill.findMany({ where: { orderId: o.id }, orderBy: { executedAt: 'asc' } }),
    prisma.security.findUniqueOrThrow({ where: { id: o.securityId } }),
    o.brokerId ? prisma.broker.findUnique({ where: { id: o.brokerId } }) : null,
    prisma.reconAccountMap.findFirst({ where: { portfolioId: o.portfolioId }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!fills.length) throw HttpError.conflict('The order has no fills', 'invalid_state');
  const amounts = settlementAmounts(o.side, fills);
  const tradeDate = hararePartsOf(fills[fills.length - 1]!.executedAt).iso;
  const settleDate = settleDateFor(sec.market, tradeDate);
  const qty = fills.reduce((s, f) => s.add(f.quantity), new D(0));
  const avg = qty.gt(0) ? amounts.gross.div(qty).toDecimalPlaces(6, D.ROUND_HALF_UP) : new D(0);
  const type = o.side === 'BUY' ? 'RVP' : 'DVP';
  const cp = map ? await prisma.counterparty.findUnique({ where: { id: map.counterpartyId }, select: { id: true, name: true } }) : null;
  const payload = {
    instructionType: type,
    orderRef: o.ref,
    security: { ticker: sec.ticker, isin: sec.isin, name: sec.name, market: sec.market },
    side: o.side,
    quantity: qty.toString(),
    avgPrice: avg.toString(),
    gross: amounts.gross.toFixed(4),
    fees: amounts.fees.toFixed(4),
    net: amounts.net.toFixed(4),
    currency: o.currency,
    tradeDate,
    settleDate,
    broker: broker?.name ?? null,
    custodian: cp?.name ?? null,
    accountRef: map?.accountRef ?? null,
    fills: fills.map((f) => ({ quantity: f.quantity.toString(), price: f.price.toString(), fees: f.fees.toFixed(4), executedAt: f.executedAt.toISOString(), source: f.source, sourceRef: f.sourceRef })),
  };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'settleInstruction');
      const r = await tx.settlementInstruction.create({
        data: { ref, orderId: o.id, orderRef: o.ref, portfolioId: o.portfolioId, securityId: o.securityId, ticker: sec.ticker, side: o.side, instructionType: type, quantity: qty, avgPrice: avg, grossAmount: amounts.gross, fees: amounts.fees, netAmount: amounts.net, currency: o.currency, tradeDate: dayDate(tradeDate), settleDate: dayDate(settleDate), brokerId: o.brokerId, counterpartyId: map?.counterpartyId ?? null, accountRef: map?.accountRef ?? null, payload: json(payload), generatedBy: userId },
      });
      await writeAudit(tx, ctx, { action: 'settlement_instruction.generated', objectType: 'settlement_instruction', objectId: r.id, after: { ref, orderRef: o.ref, type, settleDate, net: amounts.net.toFixed(2), currency: o.currency } });
      if (userId === SYSTEM_ACTOR_ID) await notifyPermission(tx, 'orders.approve', { type: 'settlement_instruction.generated', title: `Settlement instruction ${ref} for ${o.ref} awaits release`, body: `${type} ${sec.ticker}, settles ${settleDate}.`, link: '/ops/trading-feeds' });
      return r;
    });
    return { instruction: row, created: true };
  } catch (e) {
    if (!isP2002(e)) throw e;
    return { instruction: await prisma.settlementInstruction.findUniqueOrThrow({ where: { orderId: o.id } }), created: false };
  }
}

/** Instructions for every Filled or Settled order that has none yet (capped at 200 per call). */
export async function generateMissingInstructions(ctx: AuditContext, userId: string) {
  const orders = await prisma.order.findMany({ where: { status: { in: ['Filled', 'Settled'] } }, select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 400 });
  const have = new Set((await prisma.settlementInstruction.findMany({ where: { orderId: { in: orders.map((x) => x.id) } }, select: { orderId: true } })).map((x) => x.orderId));
  const todo = orders.filter((x) => !have.has(x.id)).slice(0, 200);
  let created = 0;
  const failed: { orderId: string; message: string }[] = [];
  for (const t of todo) {
    try {
      if ((await generateSettlementInstruction(ctx, t.id, userId)).created) created++;
    } catch (e) {
      failed.push({ orderId: t.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { created, failed };
}

async function loadInstruction(idOrRef: string) {
  const r = await prisma.settlementInstruction.findFirst({ where: UUID.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!r) throw HttpError.notFound('Settlement instruction not found');
  return r;
}

type InstructionAction = 'release' | 'confirm' | 'fail' | 'cancel';
const FROM: Record<InstructionAction, string[]> = { release: ['GENERATED'], confirm: ['RELEASED'], fail: ['RELEASED'], cancel: ['GENERATED', 'RELEASED'] };
const TO: Record<InstructionAction, string> = { release: 'RELEASED', confirm: 'CONFIRMED', fail: 'FAILED', cancel: 'CANCELLED' };

/** Release is the checker step: the person who generated it cannot release it (the system actor is not a person). */
export async function moveInstruction(input: { id: string; action: InstructionAction; reason?: string; userId: string; ctx: AuditContext }) {
  const r = await loadInstruction(input.id);
  if (!FROM[input.action].includes(r.status)) throw HttpError.conflict(`${r.ref} is ${r.status}; it cannot be ${TO[input.action].toLowerCase()}`, 'invalid_state');
  if (input.action === 'release' && r.generatedBy !== SYSTEM_ACTOR_ID) assertSegregation(input.userId, r.generatedBy);
  if ((input.action === 'fail' || input.action === 'cancel') && !(input.reason && input.reason.trim().length >= 3)) throw HttpError.badRequest('Validation failed', [{ path: 'reason', message: 'A reason is required' }]);
  const now = new Date();
  const data: Prisma.SettlementInstructionUncheckedUpdateManyInput = { status: TO[input.action], version: { increment: 1 } };
  if (input.action === 'release') Object.assign(data, { releasedBy: input.userId, releasedAt: now });
  if (input.action === 'confirm') Object.assign(data, { confirmedBy: input.userId, confirmedAt: now });
  if (input.action === 'fail' || input.action === 'cancel') data.failReason = trunc(input.reason!.trim(), 500);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.settlementInstruction.updateMany({ where: { id: r.id, status: r.status, version: r.version }, data })).count);
    await writeAudit(tx, input.ctx, { action: `settlement_instruction.${input.action === 'release' ? 'released' : input.action === 'confirm' ? 'confirmed' : input.action === 'fail' ? 'failed' : 'cancelled'}`, objectType: 'settlement_instruction', objectId: r.id, before: { status: r.status }, after: { status: TO[input.action], ref: r.ref, orderRef: r.orderRef }, reason: input.reason ?? null });
    if (input.action === 'fail') await enqueue(tx, 'notify.permission', { permission: 'orders.route', type: 'settlement_instruction.failed', title: `Settlement ${r.ref} for ${r.orderRef} failed`, body: input.reason!.slice(0, 200), link: '/ops/trading-feeds' });
  });
  return prisma.settlementInstruction.findUniqueOrThrow({ where: { id: r.id } });
}

/** The instruction as a file the operator hands to the custodian or broker (CSV or JSON). */
export async function instructionFile(idOrRef: string, format: 'csv' | 'json') {
  const r = await loadInstruction(idOrRef);
  const p = r.payload as Record<string, unknown> & { security: { ticker: string; isin: string | null }; instructionType: string };
  if (format === 'json') return { filename: `${r.ref}.json`, content: JSON.stringify({ ref: r.ref, ...p }, null, 2) };
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['instruction_ref', 'type', 'order_ref', 'ticker', 'isin', 'side', 'quantity', 'avg_price', 'gross', 'fees', 'net', 'currency', 'trade_date', 'settle_date', 'custodian', 'account_ref'];
  const row = [r.ref, p.instructionType, r.orderRef, p.security.ticker, p.security.isin, r.side, r.quantity.toString(), r.avgPrice.toString(), r.grossAmount.toFixed(4), r.fees.toFixed(4), r.netAmount.toFixed(4), r.currency, isoDay(r.tradeDate), isoDay(r.settleDate), p.custodian, r.accountRef];
  return { filename: `${r.ref}.csv`, content: `${head.join(',')}\n${row.map(q).join(',')}\n` };
}

export const instructionView = (r: InstructionRow) => ({
  id: r.id,
  ref: r.ref,
  orderId: r.orderId,
  orderRef: r.orderRef,
  ticker: r.ticker,
  side: r.side,
  instructionType: r.instructionType,
  quantity: r.quantity.toString(),
  avgPrice: r.avgPrice.toString(),
  gross: r.grossAmount.toFixed(2),
  fees: r.fees.toFixed(2),
  net: r.netAmount.toFixed(2),
  currency: r.currency,
  tradeDate: isoDay(r.tradeDate),
  settleDate: isoDay(r.settleDate),
  accountRef: r.accountRef,
  status: r.status,
  generatedBy: r.generatedBy,
  releasedBy: r.releasedBy,
  releasedAt: r.releasedAt?.toISOString() ?? null,
  confirmedAt: r.confirmedAt?.toISOString() ?? null,
  failReason: r.failReason,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

// ================================================================ corporate-action feed

export interface CaSyncResult {
  runId: string;
  provider: string;
  status: 'OK' | 'ERROR' | 'UNSUPPORTED';
  fetched: number;
  drafted: number;
  duplicates: number;
  rejected: number;
  error?: string;
  items: { ticker: string; type: string; exDate: string; outcome: string; reason?: string; eventRef?: string }[];
}

/**
 * Pulls announced corporate actions from the market-data adapter and drafts them as ANNOUNCED events (maker = system, so
 * a person must confirm and a different person process them). A repeated announcement is counted, not re-created, and an
 * announcement for an action already on file (same security, type and ex-date, not cancelled) is a DUPLICATE.
 */
export async function syncCorporateActions(input: { trigger: 'MANUAL' | 'SCHEDULE'; userId: string | null; ctx: AuditContext }): Promise<CaSyncResult> {
  const provider = marketDataMode();
  const run = await prisma.caFeedRun.create({ data: { trigger: input.trigger, provider, status: 'OK', startedBy: input.userId } });
  const res: CaSyncResult = { runId: run.id, provider, status: 'OK', fetched: 0, drafted: 0, duplicates: 0, rejected: 0, items: [] };
  const finish = async (error?: string) => {
    if (error) {
      res.error = error;
      res.status = res.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'ERROR';
    }
    await prisma.$transaction(async (tx) => {
      await tx.caFeedRun.update({ where: { id: run.id }, data: { status: res.status, fetched: res.fetched, drafted: res.drafted, duplicates: res.duplicates, rejected: res.rejected, error: error ? trunc(error, 500) : null, finishedAt: new Date() } });
      await writeAudit(tx, input.ctx, { action: 'ca_feed.synced', objectType: 'ca_feed_run', objectId: run.id, after: { provider, trigger: input.trigger, status: res.status, fetched: res.fetched, drafted: res.drafted, duplicates: res.duplicates, rejected: res.rejected } });
    });
    return res;
  };
  const adapter = getMarketDataAdapter();
  if (!adapter.fetchCorporateActions) {
    res.status = 'UNSUPPORTED';
    return finish(`The ${provider} market-data provider has no corporate-action source; announcements must be entered by hand`);
  }
  const secs = await prisma.security.findMany({ where: { status: 'Active', assetClass: 'Equity' }, select: { id: true, ticker: true, name: true, currency: true } });
  const byTicker = new Map(secs.map((s) => [s.ticker.toUpperCase(), s]));
  let batch;
  try {
    batch = await adapter.fetchCorporateActions(secs.map((s) => s.ticker));
  } catch (e) {
    return finish(e instanceof Error ? e.message : String(e));
  }
  res.fetched = batch.items.length;
  for (const a of batch.items) {
    const key = announcementKey(a);
    const note = (outcome: string, reason?: string, eventRef?: string) => res.items.push({ ticker: a.ticker, type: a.type, exDate: a.exDate, outcome, reason, eventRef });
    const seen = await prisma.caFeedItem.findUnique({ where: { dedupeKey: key } });
    if (seen) {
      await prisma.caFeedItem.update({ where: { id: seen.id }, data: { seenCount: { increment: 1 }, lastSeenAt: new Date() } });
      res.duplicates++;
      note('DUPLICATE', 'Already seen on the feed');
      continue;
    }
    const item = { dedupeKey: key, source: a.source.slice(0, 24), sourceRef: a.sourceRef ? a.sourceRef.slice(0, 120) : null, ticker: a.ticker.slice(0, 24), caType: a.type, exDate: /^\d{4}-\d{2}-\d{2}$/.test(a.exDate) ? dayDate(a.exDate) : null, announcement: json({ ...a, fetchedAt: a.fetchedAt.toISOString() }), runId: run.id };
    const sec = byTicker.get(a.ticker.toUpperCase());
    const target = a.targetTicker ? byTicker.get(a.targetTicker.toUpperCase()) : null;
    const errs = sec ? announcementErrors(a) : [`Unknown or inactive security ${a.ticker}`];
    if (sec && a.type === 'MERGER' && !target) errs.push(`Unknown acquirer ${a.targetTicker}`);
    if (errs.length) {
      await prisma.caFeedItem.create({ data: { ...item, status: 'REJECTED', reason: trunc(errs.join('; '), 500) } }).catch((e) => { if (!isP2002(e)) throw e; });
      res.rejected++;
      note('REJECTED', errs[0]);
      continue;
    }
    const onFile = await prisma.corpActionEvent.findFirst({ where: { securityId: sec!.id, type: a.type, exDate: dayDate(a.exDate), status: { not: 'CANCELLED' } } });
    if (onFile) {
      await prisma.caFeedItem.create({ data: { ...item, status: 'DUPLICATE', reason: `Already on file as ${onFile.ref}`, eventId: onFile.id } }).catch((e) => { if (!isP2002(e)) throw e; });
      res.duplicates++;
      note('DUPLICATE', `Already on file as ${onFile.ref}`, onFile.ref);
      continue;
    }
    try {
      const ev = await prisma.$transaction(async (tx) => {
        const ref = await nextRef(tx, 'corpAction');
        const row = await tx.corpActionEvent.create({
          data: {
            ref,
            securityId: sec!.id,
            ticker: sec!.ticker,
            securityName: sec!.name,
            type: a.type,
            currency: (a.currency ?? sec!.currency).toUpperCase().slice(0, 3),
            exDate: dayDate(a.exDate),
            recordDate: dayDate(a.recordDate),
            payDate: dayDate(a.payDate),
            electionDeadline: a.electionDeadline ? dayDate(a.electionDeadline) : null,
            rate: a.rate ? new D(a.rate) : null,
            ratioNew: a.ratioNew ? new D(a.ratioNew) : null,
            ratioOld: a.ratioOld ? new D(a.ratioOld) : null,
            withholdingPct: a.withholdingPct ? new D(a.withholdingPct) : new D(0),
            targetSecurityId: target?.id ?? null,
            targetTicker: target ? byTicker.get(a.targetTicker!.toUpperCase())!.ticker : null,
            defaultOption: ELECTION_OPTIONS[a.type as CaType]?.[0] ?? null,
            description: trunc(`Feed ${a.source}${a.sourceRef ? ` ${a.sourceRef}` : ''}: ${a.description ?? ''}`.trim(), 1000),
            makerId: SYSTEM_ACTOR_ID,
          },
        });
        await tx.caFeedItem.create({ data: { ...item, status: 'DRAFTED', eventId: row.id } });
        await writeAudit(tx, input.ctx, { action: 'corp_action.created', objectType: 'corp_action', objectId: row.id, after: { ref, ticker: sec!.ticker, type: a.type, exDate: a.exDate, recordDate: a.recordDate, payDate: a.payDate, rate: a.rate ?? null, ratio: a.ratioNew ? `${a.ratioNew}:${a.ratioOld}` : null, feed: a.source, draft: true } });
        await notifyPermission(tx, 'corporate_actions.manage', { type: 'corp_action.feed_draft', title: `${ref} ${sec!.ticker} ${a.type.replace(/_/g, ' ').toLowerCase()} announced on the feed`, body: `Ex-date ${a.exDate}. Review and confirm, or cancel if wrong.`, link: `/ops/corporate-actions/${row.id}` });
        return row;
      });
      res.drafted++;
      note('DRAFTED', undefined, ev.ref);
    } catch (e) {
      if (!isP2002(e)) throw e;
      res.duplicates++;
      note('DUPLICATE', 'Created concurrently');
    }
  }
  return finish();
}

