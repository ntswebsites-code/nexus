/**
 * Investee remainders demo data (R4-3): a staff review of the first company's cap table, and a staff query on the
 * second company's forecast, so the staff screen opens with history. Idempotent (a review of the same data by the
 * same reviewer is a no-op). Needs the investee workspace seed first.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-investee-remainders.ts
 *   also called by seed-demo.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { SYSTEM_ACTOR_ID, systemCtx } from '../src/lib/system';
import { recordReview } from '../src/modules/investee-portal/remainders/review';

const log = (m: string) => console.log(`[seed:investee-remainders] ${m}`);

export async function seedInvesteeRemainders() {
  const companies = await prisma.portfolioCompany.findMany({ where: { status: { in: ['Active', 'Approved'] } }, orderBy: { ref: 'asc' }, take: 2 });
  const reviewer = { id: SYSTEM_ACTOR_ID, name: 'Investment team (demo)' };
  let done = 0;
  const first = companies[0];
  if (first) {
    await recordReview(first.id, reviewer, { area: 'CAP_TABLE', outcome: 'REVIEWED', note: 'Register agrees to the signed shareholder agreement.' }, systemCtx());
    done++;
  }
  const second = companies[1];
  if (second) {
    await recordReview(second.id, reviewer, { area: 'FORECAST', outcome: 'QUERIED', note: 'Please explain the step-up in revenue for the third month.' }, systemCtx());
    done++;
  }
  log(`${done} review(s) ensured`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedInvesteeRemainders();
  } catch (err) {
    console.error('[seed:investee-remainders] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
