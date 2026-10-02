/**
 * Orders demo data: a few orders in different states on "Zimbabwe Opportunities" (ZWG) so the blotter, approval
 * queue and routing screens have something to show. Also sets a plausible average daily volume on the demo
 * securities that have none (the liquidity check reads it).
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-orders.ts      (standalone, after seed-portfolio)
 *
 * Idempotent: orders carry a "Demo seed:" rationale and nothing is created when one exists. Skipped with a
 * message when the portfolio foundation or staff users (portfolio_manager / investment_director) are missing.
 * The orders are inserted directly, so no positions or cash change: seeded fills are illustrative.
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { seqRef } from '../src/modules/ops/ops.common';
import { estimateFee } from '../src/modules/orders/orders.checks';
import { reservationFor } from '../src/modules/orders/orders.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const log = (m: string) => console.log(`[seed:orders] ${m}`);

const ADV: Record<string, number> = {
  'DLTA.ZW': 900000, 'CBZ.ZW': 400000, 'ECO.ZW': 1500000, 'INN.ZW': 700000, 'FBC.ZW': 1200000, 'MEIK.ZW': 250000,
  'SIM.ZW': 2000000, 'OKZ.ZW': 1000000, 'NMB.ZW': 3000000, 'ZIM.VX': 800000, 'CMCL.VX': 150000, 'SEED.VX': 1800000,
};

async function userWithRole(key: string, not?: string) {
  const r = await prisma.userRole.findFirst({
    where: { role: { portal: 'admin', key }, user: { isActive: true, ...(not ? { id: { not } } : {}) } },
    select: { userId: true },
  });
  return r?.userId ?? null;
}

export async function seedOrders() {
  for (const [ticker, adv] of Object.entries(ADV)) {
    await prisma.security.updateMany({ where: { ticker, averageDailyVolume: null }, data: { averageDailyVolume: D(adv) } });
  }
  const portfolio = await prisma.portfolio.findFirst({ where: { name: 'Zimbabwe Opportunities' } });
  if (!portfolio) return log('portfolio foundation not seeded; skipped');
  if (await prisma.order.findFirst({ where: { rationale: { startsWith: 'Demo seed:' } } })) return log('demo orders already present');
  const maker = (await userWithRole('portfolio_manager')) ?? (await userWithRole('investment_director'));
  const approver = await userWithRole('investment_director', maker ?? undefined);
  const router = await userWithRole('dealer', approver ?? undefined);
  if (!maker) return log('no portfolio_manager / investment_director user; skipped');
  const broker = await prisma.broker.findFirst({ where: { status: 'Active' }, orderBy: { name: 'asc' } });
  const secs = new Map((await prisma.security.findMany({ where: { ticker: { in: ['ECO.ZW', 'NMB.ZW', 'OKZ.ZW', 'INN.ZW'] } } })).map((s) => [s.ticker, s]));
  const price = async (securityId: string) => (await prisma.securityPrice.findFirst({ where: { securityId }, orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }] }))?.price;

  interface Spec {
    ticker: string;
    side: 'BUY' | 'SELL';
    qty: number;
    type: 'MARKET' | 'LIMIT';
    limit?: string;
    status: string;
    why: string;
    approved?: boolean;
    routed?: boolean;
    fill?: [number, string];
    rejectReason?: string;
  }
  const specs: Spec[] = [
    { ticker: 'ECO.ZW', side: 'BUY', qty: 200000, type: 'LIMIT', limit: '15.50', status: 'AwaitingApproval', why: 'Top up the telecoms weight after the results call' },
    { ticker: 'NMB.ZW', side: 'BUY', qty: 500000, type: 'MARKET', status: 'Approved', approved: true, why: 'Deploy surplus ZWG cash into financials' },
    { ticker: 'OKZ.ZW', side: 'SELL', qty: 300000, type: 'LIMIT', limit: '5.20', status: 'Filled', approved: true, routed: true, fill: [300000, '5.21'], why: 'Trim retail exposure into strength' },
    { ticker: 'INN.ZW', side: 'BUY', qty: 900000, type: 'MARKET', status: 'Rejected', rejectReason: 'Would breach the single-name limit', why: 'Increase consumer staples' },
  ];
  let n = 0;
  for (const s of specs) {
    const sec = secs.get(s.ticker);
    const last = sec ? await price(sec.id) : null;
    if (!sec || !last) continue;
    const ref = await prisma.$transaction((tx) => seqRef(tx, 'order', 'ORD-', 6, 1001));
    const decision = last;
    const base = { orderType: s.type, limitPrice: s.limit ? D(s.limit) : null, decisionPrice: decision, quantity: D(s.qty), filledQty: D(s.fill?.[0] ?? 0) };
    const open = ['AwaitingApproval', 'Approved', 'Routing', 'PartiallyFilled'].includes(s.status);
    const reserve = s.side === 'BUY' && open ? reservationFor(base) : null;
    const refPrice = s.limit ? D(s.limit) : decision;
    await prisma.order.create({
      data: {
        ref,
        portfolioId: portfolio.id,
        securityId: sec.id,
        side: s.side,
        quantity: base.quantity,
        orderType: s.type,
        limitPrice: base.limitPrice,
        brokerId: broker?.id ?? null,
        rationale: `Demo seed: ${s.why}`,
        currency: sec.currency,
        decisionPrice: decision,
        status: s.status,
        makerId: maker,
        approverId: s.approved ? approver : null,
        approvedAt: s.approved ? new Date() : null,
        routerId: s.routed ? router : null,
        routedAt: s.routed ? new Date() : null,
        filledQty: base.filledQty,
        avgPrice: s.fill ? D(s.fill[1]) : null,
        reserveUnit: reserve?.unit ?? null,
        reservedAmount: reserve?.amount ?? D(0),
        estimatedFee: estimateFee(base.quantity.mul(refPrice)),
        rejectReason: s.rejectReason ?? null,
        submittedAt: new Date(),
        fills: s.fill ? { create: { quantity: D(s.fill[0]), price: D(s.fill[1]), executedAt: new Date(), source: 'MANUAL', recordedBy: router ?? maker } } : undefined,
      },
    });
    n++;
  }
  log(`${n} demo orders created on ${portfolio.ref}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedOrders();
  } catch (err) {
    console.error('[seed:orders] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
