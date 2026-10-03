/**
 * NAV demo wiring: links funds to the portfolio that holds their assets (`funds.portfolio_id`), so a released NAV
 * run updates the LP dashboard. Only fills a link that is empty; never changes an existing one.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-nav.ts      (standalone; run seed-portfolio and the fund seed first)
 *   also called by seed-demo.ts and seed-uat.ts
 *
 * Links: FND-AEOF (Matanho Equity Opportunities Fund, open-ended) -> "USD Equity Fund". The private-capital fund
 * (FND-AGFI) has no unit NAV and is left unlinked.
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';

const log = (m: string) => console.log(`[seed:nav] ${m}`);
const LINKS: { fundRef: string; portfolioName: string }[] = [{ fundRef: 'FND-AEOF', portfolioName: 'USD Equity Fund' }];

export async function seedNav() {
  for (const l of LINKS) {
    const [fund, pf] = await Promise.all([prisma.fund.findUnique({ where: { ref: l.fundRef } }), prisma.portfolio.findFirst({ where: { name: l.portfolioName } })]);
    if (!fund || !pf) {
      log(`${l.fundRef} -> ${l.portfolioName}: skipped (fund or portfolio not present)`);
      continue;
    }
    if (fund.portfolioId) {
      log(`${l.fundRef}: already linked`);
      continue;
    }
    await prisma.fund.update({ where: { id: fund.id }, data: { portfolioId: pf.id } });
    log(`${l.fundRef} -> ${pf.ref} ${pf.name}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedNav();
  } catch (err) {
    console.error('[seed:nav] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
