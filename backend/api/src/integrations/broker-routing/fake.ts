import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { buildFixExecutionReport, parseContractNoteText, parseFixMessage } from './parse';
import type { BrokerAck, BrokerFill, BrokerRoutingAdapter, RoutedOrder } from './types';

export const refOf = (orderRef: string) => `BRK-${createHash('sha256').update(orderRef).digest('hex').slice(0, 10).toUpperCase()}`;

/** Records the routed order in the integration inbox (shared by the fake and file-drop modes). Idempotent per order. */
export async function recordRoutedOrder(o: RoutedOrder): Promise<BrokerAck> {
  const brokerOrderRef = refOf(o.orderRef);
  const existing = await prisma.integrationInbox.findFirst({ where: { adapter: 'broker-routing', kind: 'broker_order', externalRef: brokerOrderRef } });
  if (!existing) await prisma.integrationInbox.create({ data: { adapter: 'broker-routing', kind: 'broker_order', externalRef: brokerOrderRef, status: 'PENDING', payload: { ...o } } });
  return { brokerOrderRef, status: 'ACKNOWLEDGED' };
}

/** The order reference a broker order reference was issued for (null when we never routed it). */
export async function orderRefForBrokerRef(brokerOrderRef: string): Promise<string | null> {
  const row = await prisma.integrationInbox.findFirst({ where: { adapter: 'broker-routing', kind: 'broker_order', externalRef: brokerOrderRef } });
  return row ? ((row.payload as unknown as RoutedOrder).orderRef ?? null) : null;
}

/**
 * Orders are acknowledged at once and fully filled (at the limit, else the reference price, else 100.000000) the first
 * time fills are fetched or FIX reports are polled. Contract notes and FIX reports go through the real parsers.
 */
export class FakeBrokerRouting implements BrokerRoutingAdapter {
  routeOrder(o: RoutedOrder): Promise<BrokerAck> {
    return recordRoutedOrder(o);
  }
  async fetchFills({ brokerOrderRef }: { brokerOrderRef: string }) {
    const row = await prisma.integrationInbox.findFirst({ where: { adapter: 'broker-routing', kind: 'broker_order', externalRef: brokerOrderRef } });
    if (!row) throw new Error(`Unknown broker order ${brokerOrderRef}`);
    const p = row.payload as unknown as RoutedOrder & { fill?: BrokerFill };
    if (row.status === 'SETTLED' && p.fill) return { status: 'FILLED' as const, fills: [p.fill] };
    const fill: BrokerFill = { fillRef: `${brokerOrderRef}-F1`, quantity: p.quantity, price: p.limitPrice ?? p.referencePrice ?? '100.000000', at: new Date().toISOString(), source: 'FIX' };
    await prisma.integrationInbox.update({ where: { id: row.id }, data: { status: 'SETTLED', processedAt: new Date(), payload: JSON.parse(JSON.stringify({ ...p, fill })) } });
    return { status: 'FILLED' as const, fills: [fill] };
  }
  async parseContractNote(i: { brokerCode: string; filename: string; content: string; format?: 'CSV' | 'JSON' }) {
    return parseContractNoteText(i.content, i.format);
  }
  async parseExecutionReport({ raw }: { raw: string }) {
    return parseFixMessage(raw);
  }
  /** The fake sender: one FIX ExecutionReport per routed order not reported yet. */
  async pollExecutionReports({ limit = 50 }: { limit?: number } = {}) {
    const rows = await prisma.integrationInbox.findMany({ where: { adapter: 'broker-routing', kind: 'broker_order', status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: Math.min(limit, 200) });
    const messages: string[] = [];
    for (const row of rows) {
      const p = row.payload as unknown as RoutedOrder;
      const price = p.limitPrice ?? p.referencePrice ?? '100.000000';
      messages.push(buildFixExecutionReport({ execId: `${row.externalRef}-X1`, clOrdId: p.orderRef, orderId: row.externalRef ?? undefined, symbol: p.ticker, side: p.side, lastQty: p.quantity, lastPx: price, time: new Date() }));
      await prisma.integrationInbox.update({ where: { id: row.id }, data: { status: 'SETTLED', processedAt: new Date(), payload: JSON.parse(JSON.stringify({ ...p, fill: { fillRef: `${row.externalRef}-X1`, quantity: p.quantity, price, at: new Date().toISOString(), source: 'FIX' } })) } });
    }
    return { messages };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter acknowledging and fully filling every order' };
  }
}
