/**
 * Package S6 demo data: USD/ZIG exchange rates so the LP presentation currency (BR-087) and the transaction-date FX
 * stamps (BR-152) have stored rates to use. One rate per month for the last 30 months, `rate` = ZIG per 1 USD.
 * Idempotent: only dates that have no USD/ZIG row are inserted. No benchmark points are seeded on purpose (BR-091: the
 * platform never invents a benchmark series; operations enter and approve them).
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-lp-remainder.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

const log = (m: string) => console.log(`[seed:lp-remainder] ${m}`);

export async function seedLpRemainder() {
  const now = new Date();
  const rows: Prisma.FxRateCreateManyInput[] = [];
  for (let back = 30; back >= 0; back--) {
    const rateDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    // gentle, deterministic drift around 26.5 so different dates give different stamped rates
    const rate = new Prisma.Decimal(26.5).add(new Prisma.Decimal(30 - back).mul('0.0400000000')).toDecimalPlaces(10);
    rows.push({ fromCurrency: 'USD', toCurrency: 'ZIG', rateDate, rate, source: 'SEED' });
  }
  const made = await prisma.fxRate.createMany({ data: rows, skipDuplicates: true });
  log(`USD/ZIG rates: ${made.count} added`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedLpRemainder();
  } catch (err) {
    console.error('[seed:lp-remainder] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
