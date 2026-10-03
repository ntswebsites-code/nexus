import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import type { PaymentAdapter, PaymentInstruction, PaymentResult, PaymentStatus } from './types';

const refOf = (reference: string) => `PAY-${createHash('sha256').update(reference).digest('hex').slice(0, 12).toUpperCase()}`;
const view = (paymentRef: string, status: string): PaymentResult => ({ paymentRef, status: (status === 'NEW' ? 'PENDING' : status) as PaymentStatus });

/** Instructions start PENDING; `settlePendingPayments` (worker tick or the admin test) moves them to SETTLED or FAILED. */
export class FakePayment implements PaymentAdapter {
  async instruct(i: PaymentInstruction): Promise<PaymentResult> {
    const paymentRef = refOf(i.reference);
    const existing = await prisma.integrationInbox.findFirst({ where: { adapter: 'payment', kind: 'payment_instruction', externalRef: paymentRef } });
    if (existing) return view(paymentRef, existing.status);
    await prisma.integrationInbox.create({ data: { adapter: 'payment', kind: 'payment_instruction', externalRef: paymentRef, status: 'PENDING', payload: { ...i } } });
    return { paymentRef, status: 'PENDING' };
  }
  async getStatus({ paymentRef }: { paymentRef: string }): Promise<PaymentResult> {
    const row = await prisma.integrationInbox.findFirst({ where: { adapter: 'payment', kind: 'payment_instruction', externalRef: paymentRef } });
    if (!row) throw new Error(`Unknown payment ${paymentRef}`);
    return view(paymentRef, row.status);
  }
  async health() {
    return { ok: true, detail: 'Fake adapter; instructions settle on the next worker tick' };
  }
}

/** Timer tick: settles instructions at least `minAgeMs` old. A beneficiary account containing FAIL is rejected. */
export async function settlePendingPayments(minAgeMs = 0): Promise<number> {
  const rows = await prisma.integrationInbox.findMany({
    where: { adapter: 'payment', kind: 'payment_instruction', status: 'PENDING', createdAt: { lte: new Date(Date.now() - minAgeMs) } },
    take: 100,
  });
  for (const r of rows) {
    const failed = String((r.payload as { beneficiaryAccount?: string }).beneficiaryAccount ?? '').toUpperCase().includes('FAIL');
    await prisma.integrationInbox.update({ where: { id: r.id }, data: { status: failed ? 'FAILED' : 'SETTLED', processedAt: new Date() } });
  }
  return rows.length;
}
