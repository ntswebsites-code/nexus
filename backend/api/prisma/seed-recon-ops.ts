/**
 * Reconciliation depth demo data (WP-3). Idempotent.
 *  - opening effective-dated tolerances for every family (BR-067) plus one counterparty-specific trade price tolerance,
 *  - for yesterday: custodian position file for the demo account (one quantity difference, one holding we do not have),
 *    its source receipt, and a custodian corporate-action file when a confirmed event with an entitlement pays that day,
 *  - one older filled-but-unsettled order so "Settlement fails" has a deliberate break,
 *  - a comment on the demo runbook task.
 * Press "Run matching" for Positions vs custody / Settlement fails / Corporate actions in /ops/reconciliation.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-recon-ops.ts     (standalone, after seed-recon and seed-wiring)
 *   also called by seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { sha256Hex } from '../src/lib/crypto';
import { storeFile } from '../src/lib/storage';
import { seqRef } from '../src/modules/ops/ops.common';
import { accountRefs } from '../src/modules/custodian/custodian.service';
import { getPortfolioSnapshot } from '../src/modules/portfolio/portfolio.service';
import { FAMILIES, DEFAULT_TOLERANCES } from '../src/modules/recon/recon.engine';

const D = (v: string | number) => new Prisma.Decimal(v);
const log = (m: string) => console.log(`[seed:recon-ops] ${m}`);
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const dayOf = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function seedReconOps() {
  const author = await prisma.userRole.findFirst({ where: { role: { portal: 'admin', key: { in: ['operations', 'portfolio_manager', 'investment_director', 'system_admin'] } }, user: { isActive: true } }, select: { userId: true } });
  if (!author) return log('no staff user; skipped');

  // 1. Tolerances
  const from = dayOf('2026-01-01');
  let created = 0;
  for (const family of FAMILIES) {
    const exists = await prisma.reconTolerance.findUnique({ where: { family_scope_effectiveFrom: { family, scope: '*', effectiveFrom: from } } });
    if (exists) continue;
    await prisma.reconTolerance.create({
      data: {
        family,
        scope: '*',
        effectiveFrom: from,
        price: D(DEFAULT_TOLERANCES.price),
        cash: D(DEFAULT_TOLERANCES.cash),
        holdingsPct: D(DEFAULT_TOLERANCES.holdingsPct),
        positionQty: D(DEFAULT_TOLERANCES.positionQty),
        settleDays: DEFAULT_TOLERANCES.settleDays,
        caCash: D(DEFAULT_TOLERANCES.caCash),
        note: 'Opening tolerances (BR-067)',
        createdBy: author.userId,
      },
    });
    created++;
  }
  const cp = await prisma.counterparty.findFirst({ where: { type: 'CUSTODIAN', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
  const account = cp ? accountRefs(cp.accounts)[0] : undefined;
  if (cp && !(await prisma.reconTolerance.findFirst({ where: { family: 'TRADES', scope: cp.id } }))) {
    await prisma.reconTolerance.create({ data: { family: 'TRADES', scope: cp.id, counterpartyId: cp.id, effectiveFrom: dayOf('2026-06-01'), price: D('0.02'), note: 'Q-13: custodian rounds execution prices to 2 dp', createdBy: author.userId } });
    created++;
  }
  log(`${created} tolerance row(s)`);
  if (!cp || !account) return log('no custodian account; feeds skipped');

  const portfolio = await prisma.portfolio.findFirst({ where: { name: 'Zimbabwe Opportunities' } });
  const map = portfolio ? await prisma.reconAccountMap.findUnique({ where: { counterpartyId_accountRef: { counterpartyId: cp.id, accountRef: account } } }) : null;
  if (!portfolio || !map) return log('demo portfolio is not mapped (run seed-recon first); feeds skipped');

  const date = dayStr(-1);
  const receipt = async (feed: 'POSITIONS' | 'CORP_ACTIONS', asOf: string, rows: string[][], header: string[]) => {
    if (await prisma.reconSourceReceipt.findUnique({ where: { counterpartyId_accountRef_asOfDate_feed: { counterpartyId: cp.id, accountRef: account, asOfDate: dayOf(asOf), feed } } })) return false;
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    let fileId: string | null = null;
    try {
      fileId = (await storeFile({ name: `${feed.toLowerCase()}-${asOf}.csv`, mime: 'text/csv', data: Buffer.from(csv), uploadedById: author.userId })).id;
    } catch (e) {
      log(`file store unavailable (${e instanceof Error ? e.message : e}); receipt kept without the original`);
    }
    await prisma.reconSourceReceipt.create({ data: { counterpartyId: cp.id, accountRef: account, asOfDate: dayOf(asOf), feed, rowCount: rows.length, sha256: sha256Hex(csv), fileId, note: 'Demo seed', receivedBy: author.userId } });
    return true;
  };

  // 2. Positions
  const snap = await getPortfolioSnapshot(portfolio.id, { asOf: dayOf(date) });
  if (snap.lines.length && !(await prisma.reconCustodyPosition.findFirst({ where: { counterpartyId: cp.id, accountRef: account, asOfDate: dayOf(date) } }))) {
    const rows = snap.lines.slice(0, 6).map((l, i) => ({ ticker: l.ticker, quantity: i === 0 ? D(l.quantity).minus(5).toString() : l.quantity }));
    rows.push({ ticker: 'DEMOXX.ZW', quantity: '1200' });
    await prisma.reconCustodyPosition.createMany({ data: rows.map((r) => ({ counterpartyId: cp.id, accountRef: account, asOfDate: dayOf(date), ticker: r.ticker.toUpperCase(), quantity: r.quantity, batchRef: 'FEED-DEMO', createdBy: author.userId })) });
    await receipt('POSITIONS', date, rows.map((r) => [r.ticker, r.quantity]), ['ticker', 'quantity']);
    log(`custody positions for ${date}: ${rows.length} rows (first is 5 short, DEMOXX.ZW is custodian-only)`);
  }

  // 3. Corporate actions: mirror an entitlement that pays yesterday, if any
  const ev = await prisma.corpActionEvent.findFirst({ where: { payDate: dayOf(date), status: { in: ['CONFIRMED', 'PROCESSED'] }, entitlements: { some: { portfolioId: portfolio.id, status: { not: 'SKIPPED' } } } }, include: { entitlements: { where: { portfolioId: portfolio.id } } } });
  if (ev && ev.entitlements[0] && !(await prisma.reconCustodyCaNotice.findFirst({ where: { counterpartyId: cp.id, accountRef: account, payDate: dayOf(date) } }))) {
    const e = ev.entitlements[0];
    await prisma.reconCustodyCaNotice.create({ data: { counterpartyId: cp.id, accountRef: account, ticker: ev.ticker.toUpperCase(), caType: ev.type, exDate: ev.exDate, payDate: ev.payDate, quantity: e.quantity, cashAmount: e.cashAmount, currency: ev.currency, externalRef: `DEMO-${ev.ref}`, batchRef: 'FEED-DEMO', createdBy: author.userId } });
    await receipt('CORP_ACTIONS', date, [[ev.ticker, ev.exDate.toISOString().slice(0, 10), ev.payDate.toISOString().slice(0, 10), e.quantity.toString(), e.cashAmount.toString(), ev.currency]], ['ticker', 'ex_date', 'pay_date', 'quantity', 'cash_amount', 'currency']);
    log(`custody corporate-action notice for ${ev.ref}`);
  }

  // 4. A trade that should have settled days ago
  const sec = await prisma.security.findFirst({ where: { ticker: 'OKZ.ZW' } });
  const failRef = 'DEMO-CN-FAIL';
  if (sec && !(await prisma.orderFill.findFirst({ where: { sourceRef: failRef } }))) {
    const at = new Date(`${dayStr(-6)}T09:30:00.000Z`);
    const ref = await prisma.$transaction((tx) => seqRef(tx, 'order', 'ORD-', 6, 1001));
    const price = D('5.10');
    const order = await prisma.order.create({
      data: { ref, portfolioId: portfolio.id, securityId: sec.id, side: 'BUY', quantity: D(20000), orderType: 'MARKET', currency: sec.currency, decisionPrice: price, status: 'Filled', rationale: 'Demo recon: filled six days ago and never settled', makerId: author.userId, filledQty: D(20000), avgPrice: price, submittedAt: at },
    });
    await prisma.orderFill.create({ data: { orderId: order.id, quantity: D(20000), price, executedAt: at, source: 'CONTRACT_NOTE', sourceRef: failRef, recordedBy: author.userId } });
    log(`unsettled demo order ${ref}`);
  }

  // 5. Runbook comment
  const task = await prisma.opsTask.findFirst({ where: { sourceRef: { startsWith: 'SEED:CASH-STATEMENT:' } }, orderBy: { createdAt: 'desc' } });
  if (task && !(await prisma.opsTaskComment.findFirst({ where: { taskId: task.id } }))) {
    await prisma.opsTaskComment.create({ data: { taskId: task.id, body: 'Custodian said the statement lands after 10:00 UTC; chase at 10:30.', authorId: author.userId } });
    log('runbook comment');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedReconOps()
    .catch((err) => {
      console.error('[seed:recon-ops] FAILED:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
