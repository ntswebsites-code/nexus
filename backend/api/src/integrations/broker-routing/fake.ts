import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import type { BrokerAck, BrokerFill, BrokerRoutingAdapter, RoutedOrder } from './types';

const refOf = (orderRef: string) => `BRK-${createHash('sha256').update(orderRef).digest('hex').slice(0, 10).toUpperCase()}`;

/** Orders are acknowledged at once and fully filled (at the limit, or 100.000000) the first time fills are fetched. */
export class FakeBrokerRouting implements BrokerRoutingAdapter {
  async routeOrder(o: RoutedOrder): Promise<BrokerAck> {
    const brokerOrderRef = refOf(o.orderRef);
    const existing = await prisma.integrationInbox.findFirst({ where: { adapter: 'broker-routing', kind: 'broker_order', externalRef: brokerOrderRef } });
    if (!existing) await prisma.integrationInbox.create({ data: { adapter: 'broker-routing', kind: 'broker_order', externalRef: brokerOrderRef, status: 'PENDING', payload: { ...o } } });
    return { brokerOrderRef, status: 'ACKNOWLEDGED' };
  }
  async fetchFills({ brokerOrderRef }: { brokerOrderRef: string }) {
    const row = await prisma.integrationInbox.findFirst({ where: { adapter: 'broker-routing', kind: 'broker_order', externalRef: brokerOrderRef } });
    if (!row) throw new Error(`Unknown broker order ${brokerOrderRef}`);
    const p = row.payload as unknown as RoutedOrder & { fill?: BrokerFill };
    if (row.status === 'SETTLED' && p.fill) return { status: 'FILLED' as const, fills: [p.fill] };
    const fill: BrokerFill = { fillRef: `${brokerOrderRef}-F1`, quantity: p.quantity, price: p.limitPrice ?? '100.000000', at: new Date().toISOString(), source: 'FIX' };
    await prisma.integrationInbox.update({ where: { id: row.id }, data: { status: 'SETTLED', processedAt: new Date(), payload: JSON.parse(JSON.stringify({ ...p, fill })) } });
    return { status: 'FILLED' as const, fills: [fill] };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter acknowledging and fully filling every order' };
  }
}
