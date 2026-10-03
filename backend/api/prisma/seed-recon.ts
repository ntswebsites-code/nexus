/**
 * Reconciliation demo data: maps the first custodian account to "Zimbabwe Opportunities" and adds, for yesterday,
 * one filled internal order, two custodian executions (one matches by reference, one is not in the internal book
 * so it is a deliberate CRITICAL break) and a day-end package whose cash differs from the book by a small amount.
 * Press "Run matching" in /ops/reconciliation (Trades, Cash) to see them.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-recon.ts      (standalone, after seed-uat)
 *
 * Idempotent: custodian trade references start with "DEMO-" and nothing is created when one exists. Skipped with a
 * message when the counterparty, the portfolio, the security or a custodian user is missing. The internal order is
 * inserted directly, so positions and cash do not change (like the Orders demo seed).
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { seqRef } from '../src/modules/ops/ops.common';
import { accountRefs } from '../src/modules/custodian/custodian.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const log = (m: string) => console.log(`[seed:recon] ${m}`);

export async function seedRecon() {
  const cp = await prisma.counterparty.findFirst({ where: { type: 'CUSTODIAN', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
  const account = cp ? accountRefs(cp.accounts)[0] : undefined;
  if (!cp || !account) return log('no custodian counterparty with an account; skipped');
  if (await prisma.counterpartyExecution.findFirst({ where: { counterpartyId: cp.id, tradeRef: { startsWith: 'DEMO-' } } })) return log('demo records already present');
  const link = await prisma.counterpartyUser.findFirst({ where: { counterpartyId: cp.id, status: 'active' } });
  const portfolio = await prisma.portfolio.findFirst({ where: { name: 'Zimbabwe Opportunities' } });
  const sec = await prisma.security.findFirst({ where: { ticker: 'OKZ.ZW' } });
  const maker = await prisma.userRole.findFirst({ where: { role: { portal: 'admin', key: { in: ['portfolio_manager', 'investment_director'] } }, user: { isActive: true } }, select: { userId: true } });
  if (!link || !portfolio || !sec || !maker) return log('custodian user, portfolio, security or staff user missing; skipped');

  await prisma.reconAccountMap.upsert({
    where: { counterpartyId_accountRef: { counterpartyId: cp.id, accountRef: account } },
    update: {},
    create: { counterpartyId: cp.id, accountRef: account, portfolioId: portfolio.id },
  });

  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const at = new Date(`${date}T09:30:00.000Z`);
  const ref = await prisma.$transaction((tx) => seqRef(tx, 'order', 'ORD-', 6, 1001));
  const price = D('5.20');
  const order = await prisma.order.create({
    data: {
      ref,
      portfolioId: portfolio.id,
      securityId: sec.id,
      side: 'SELL',
      quantity: D(100000),
      orderType: 'MARKET',
      currency: sec.currency,
      decisionPrice: price,
      status: 'Filled',
      rationale: 'Demo recon: filled order the custodian confirms',
      makerId: maker.userId,
      filledQty: D(100000),
      avgPrice: price,
      submittedAt: at,
    },
  });
  await prisma.orderFill.create({ data: { orderId: order.id, quantity: D(100000), price, executedAt: at, source: 'CONTRACT_NOTE', sourceRef: 'DEMO-CN-001', recordedBy: maker.userId } });

  const exec = (n: number, tradeRef: string, qty: number) => ({
    ref: `EXEC-DEMO${n}`,
    counterpartyId: cp.id,
    tradeRef,
    executionAt: at,
    accountRef: account,
    ticker: sec.ticker,
    side: 'SELL',
    quantity: D(qty),
    price,
    currency: sec.currency,
    status: 'Received',
    submittedById: link.userId,
  });
  await prisma.counterpartyExecution.create({ data: exec(1, 'DEMO-CN-001', 100000) });
  await prisma.counterpartyExecution.create({ data: exec(2, 'DEMO-CN-002', 40000) }); // not in the internal book

  const cash = await prisma.portfolioCash.findFirst({ where: { portfolioId: portfolio.id, currency: sec.currency }, orderBy: { asOf: 'desc' } });
  await prisma.counterpartyDayEndPackage.create({
    data: {
      ref: 'DAY-DEMO1',
      counterpartyId: cp.id,
      accountRef: account,
      statementDate: new Date(`${date}T00:00:00.000Z`),
      currency: sec.currency,
      closingCash: (cash?.available ?? D(0)).plus('250.00'),
      holdingsMv: D(0),
      tradeCount: 2,
      note: 'Demo seed: cash differs from the book by 250.00',
      submittedById: link.userId,
    },
  });
  log(`mapped ${cp.ref}/${account} to ${portfolio.ref}; demo records for ${date}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedRecon()
    .catch((err) => {
      console.error('[seed:recon] FAILED:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
