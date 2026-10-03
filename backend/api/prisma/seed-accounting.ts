/**
 * Accounting demo wiring: gives each fund-backing portfolio the standard chart of accounts and opens the previous
 * and current calendar-month periods. Idempotent: existing accounts and periods are left alone; nothing is posted.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-accounting.ts   (standalone; run seed-portfolio and seed-nav first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { DEFAULT_COA, monthBounds } from '../src/modules/accounting/accounting.engine';

const log = (m: string) => console.log(`[seed:accounting] ${m}`);

export async function seedAccounting() {
  const funds = await prisma.fund.findMany({ where: { portfolioId: { not: null } }, select: { ref: true, portfolioId: true } });
  if (!funds.length) {
    log('no fund is linked to a portfolio: skipped');
    return;
  }
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) {
    log('no users yet: skipped');
    return;
  }
  const now = new Date();
  const months = [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))].map((d) => d.toISOString().slice(0, 7));
  for (const f of funds) {
    const portfolioId = f.portfolioId!;
    const have = new Set((await prisma.accAccount.findMany({ where: { portfolioId }, select: { code: true } })).map((a) => a.code));
    const missing = DEFAULT_COA.filter((a) => !have.has(a.code));
    if (missing.length) await prisma.accAccount.createMany({ data: missing.map((a) => ({ portfolioId, code: a.code, name: a.name, type: a.type, createdBy: actor })) });
    for (const m of months) {
      const { start, end } = monthBounds(m);
      await prisma.accPeriod.upsert({ where: { portfolioId_periodEnd: { portfolioId, periodEnd: end } }, create: { portfolioId, periodStart: start, periodEnd: end, createdBy: actor }, update: {} });
    }
    log(`${f.ref}: ${missing.length} account(s) added, periods ${months.join(', ')} ensured`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedAccounting();
  } catch (err) {
    console.error('[seed:accounting] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
