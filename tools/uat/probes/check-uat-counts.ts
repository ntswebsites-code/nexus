import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const q: Array<[string, () => Promise<number>]> = [
    ['CashStatementImport', () => prisma.cashStatementImport.count()],
    ['CashStatementLine', () => prisma.cashStatementLine.count()],
    ['CashAccount', () => prisma.cashAccount.count()],
    ['ReconCounterpartImport', () => prisma.reconCounterpartImport.count()],
    ['CustodianFeedFile', () => prisma.custodianFeedFile.count()],
    ['CustodianExecutionBatch', () => prisma.custodianExecutionBatch.count()],
    ['TradeFeedFile', () => prisma.tradeFeedFile.count()],
    ['TradeFeedLine', () => prisma.tradeFeedLine.count()],
    ['PortfolioPosition', () => prisma.portfolioPosition.count()],
    ['PortfolioCash', () => prisma.portfolioCash.count()],
    ['IborSnapshot', () => prisma.iborSnapshot.count()],
    ['InvestorSnapshot', () => prisma.investorSnapshot.count()],
    ['SnapshotPerformancePoint', () => prisma.snapshotPerformancePoint.count()],
    ['ImportBatch', () => prisma.importBatch.count()],
    ['IntegrationInbox', () => prisma.integrationInbox.count()],
    ['IntegrationCall', () => prisma.integrationCall.count()],
    ['OutboxEvent', () => prisma.outboxEvent.count()],
  ];
  for (const [name, fn] of q) {
    try { console.log(`${name}: ${await fn()}`); } catch (e: any) { console.log(`${name}: ERR ${String(e.message).split('\n')[0].slice(0, 70)}`); }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
