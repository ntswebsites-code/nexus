/**
 * Trading and corporate-action feed demo data (R4-10). Idempotent:
 *   - two working demo orders (one limit, one market) and a contract note for the Zimbabwe Opportunities portfolio: one
 *     line matches fully, one fills part of the market order, one has an unknown order reference (an open break);
 *   - a settlement instruction for the already-filled demo sell order;
 *   - one corporate-action feed sync, so announced drafts await confirmation on /ops/corporate-actions.
 * Goes through the real services, so it needs the Orders and portfolio demo seeds first. Uses the configured adapters
 * (fake by default); anything an adapter refuses is logged and skipped.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-trading-feeds.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { systemCtx } from '../src/lib/system';
import { seqRef } from '../src/modules/ops/ops.common';
import { generateSettlementInstruction, ingestContractNote, syncCorporateActions } from '../src/modules/trading-feeds/tf.service';

const log = (m: string) => console.log(`[seed:trading-feeds] ${m}`);
const D = (v: string | number) => new Prisma.Decimal(v);
const FILE = 'demo-contract-note.csv';

async function userWithRole(key: string) {
  return (await prisma.user.findFirst({ where: { isActive: true, roles: { some: { role: { key } } } }, select: { id: true } }))?.id ?? null;
}

export async function seedTradingFeeds() {
  const portfolio = await prisma.portfolio.findFirst({ where: { name: 'Zimbabwe Opportunities' } });
  const broker = await prisma.broker.findFirst({ where: { status: 'Active' }, orderBy: { name: 'asc' } });
  const maker = (await userWithRole('portfolio_manager')) ?? (await userWithRole('investment_director')) ?? (await userWithRole('system_admin'));
  if (!portfolio || !broker || !maker) return log('portfolio, broker or a staff user missing; contract-note demo skipped');

  if (!(await prisma.tradeFeedFile.findFirst({ where: { filename: FILE } }))) {
    const secs = new Map((await prisma.security.findMany({ where: { ticker: { in: ['ECO.ZW', 'NMB.ZW'] } } })).map((s) => [s.ticker, s]));
    const eco = secs.get('ECO.ZW');
    const nmb = secs.get('NMB.ZW');
    const price = async (id: string) => (await prisma.securityPrice.findFirst({ where: { securityId: id }, orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }] }))?.price;
    if (eco && nmb && (await price(eco.id)) && (await price(nmb.id))) {
      const mk = async (sec: typeof eco, qty: number, type: 'LIMIT' | 'MARKET', limit: string | null) => {
        const ref = await prisma.$transaction((tx) => seqRef(tx, 'order', 'ORD-', 6, 1001));
        return prisma.order.create({
          data: { ref, portfolioId: portfolio.id, securityId: sec.id, side: 'BUY', quantity: D(qty), orderType: type, limitPrice: limit ? D(limit) : null, brokerId: broker.id, rationale: 'Demo seed: trading feeds', currency: sec.currency, decisionPrice: (await price(sec.id))!, status: 'Routing', makerId: maker, approverId: maker, approvedAt: new Date(), routerId: maker, routedAt: new Date(), submittedAt: new Date() },
        });
      };
      const a = await mk(eco, 1000, 'LIMIT', ((await price(eco.id))!.mul(1.05)).toFixed(6));
      const b = await mk(nmb, 500, 'MARKET', null);
      const pa = (await price(eco.id))!.toFixed(6);
      const pb = (await price(nmb.id))!.toFixed(6);
      const day = new Date().toISOString().slice(0, 10);
      const csv = [
        'trade_ref,order_ref,broker_order_ref,ticker,side,quantity,price,fees,trade_date,executed_at',
        `DEMO-T1,${a.ref},,ECO.ZW,BUY,1000,${pa},10.00,${day},${new Date(Date.now() - 3600_000).toISOString()}`,
        `DEMO-T2,${b.ref},,NMB.ZW,BUY,200,${pb},4.00,${day},${new Date(Date.now() - 3000_000).toISOString()}`,
        `DEMO-T3,ORD-999999,,NMB.ZW,BUY,100,${pb},2.00,${day},${new Date(Date.now() - 2400_000).toISOString()}`,
        '',
      ].join('\n');
      try {
        const r = await ingestContractNote({ brokerId: broker.id, filename: FILE, content: csv, format: 'CSV', userId: maker, ctx: { actorId: maker, actorRole: 'Seed', portal: 'admin' } });
        log(`contract note: ${r.matched} matched, ${r.breaks} break(s), ${r.duplicates} duplicate(s)`);
      } catch (e) {
        log(`contract note skipped: ${e instanceof Error ? e.message : e}`);
      }
    } else log('ECO.ZW / NMB.ZW or their prices missing; contract-note demo skipped');
  } else log('demo contract note already present');

  // Settlement instruction for filled demo orders (system maker; a person releases it).
  const filled = await prisma.order.findMany({ where: { status: { in: ['Filled', 'Settled'] }, rationale: { startsWith: 'Demo seed:' } }, select: { id: true }, take: 5 });
  let made = 0;
  for (const o of filled) {
    try {
      if ((await generateSettlementInstruction(systemCtx(), o.id, '00000000-0000-4000-8000-000000000000')).created) made++;
    } catch (e) {
      log(`instruction skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
  log(`${made} settlement instruction(s) generated`);

  if ((await prisma.caFeedRun.count()) === 0) {
    try {
      const r = await syncCorporateActions({ trigger: 'MANUAL', userId: null, ctx: systemCtx() });
      log(`corporate-action feed: ${r.status}, ${r.drafted} drafted, ${r.duplicates} duplicate(s), ${r.rejected} rejected${r.error ? ` (${r.error})` : ''}`);
    } catch (e) {
      log(`corporate-action feed skipped: ${e instanceof Error ? e.message : e}`);
    }
  } else log('corporate-action feed already synced');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedTradingFeeds();
  } catch (err) {
    console.error('[seed:trading-feeds] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
