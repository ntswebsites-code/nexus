/**
 * Enforcement demo data (R4-9): lineage between the registry datasets, daily/weekly schedules on the quality rules,
 * and model bindings for the risk limit monitor and VaR when an approved model exists. Idempotent; run after
 * seed-reports (rules and models come from there). Settings need no seed: defaults come from the registry.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-enforcement.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';

const log = (m: string) => console.log(`[seed:enforcement] ${m}`);

const EDGES: [string, string, string, string][] = [
  ['securities', 'security_prices', 'FEEDS', 'Prices are keyed to the securities master'],
  ['securities', 'portfolio_positions', 'FEEDS', 'Positions hold securities from the master'],
  ['security_prices', 'portfolio_positions', 'FEEDS', 'Positions are valued from the latest price'],
  ['fx_rates', 'portfolio_positions', 'FEEDS', 'Base-currency value converts at the FX rate'],
  ['portfolio_positions', 'nav_runs', 'DERIVES', 'A NAV run values the positions of a portfolio'],
  ['portfolio_cash', 'nav_runs', 'DERIVES', 'A NAV run adds the cash balance'],
  ['nav_runs', 'funds', 'DERIVES', 'A released NAV updates the fund unit price'],
  ['orders', 'portfolio_positions', 'DERIVES', 'Order fills change positions'],
  ['cash_journals', 'portfolio_cash', 'DERIVES', 'Posted journals move cash'],
  ['clients', 'orders', 'VALIDATES', 'Orders are placed for onboarded clients'],
];

export async function seedEnforcement() {
  const admin = await prisma.user.findFirst({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!admin) {
    log('no staff user yet: skipped');
    return;
  }
  let made = 0;
  for (const [from, to, kind, description] of EDGES) {
    await prisma.dataLineageEdge.upsert({ where: { fromDataset_toDataset_kind: { fromDataset: from, toDataset: to, kind } }, create: { fromDataset: from, toDataset: to, kind, description, createdBy: admin.id }, update: {} });
    made++;
  }
  log(`${made} lineage edges`);

  const rules = await prisma.dataQualityRule.findMany({ where: { active: true }, orderBy: { key: 'asc' }, take: 40 });
  let scheduled = 0;
  for (const [i, r] of rules.entries()) {
    if (await prisma.dqSchedule.findUnique({ where: { ruleId: r.id } })) continue;
    const cadence = r.severity === 'HIGH' ? 'DAILY' : i % 2 === 0 ? 'DAILY' : 'WEEKLY';
    await prisma.dqSchedule.create({ data: { ruleId: r.id, cadence, enabled: true, nextRunAt: new Date(Date.now() + (i + 1) * 60_000), createdBy: r.createdBy } });
    scheduled++;
  }
  log(`${scheduled} rule schedules (first runs within the hour)`);

  const approved = await prisma.govModel.findFirst({ where: { status: 'APPROVED' }, orderBy: { ref: 'asc' }, select: { id: true, ref: true } });
  if (approved) {
    for (const purpose of ['RISK_LIMIT', 'RISK_VAR']) {
      if (await prisma.govModelBinding.findUnique({ where: { purpose } })) continue;
      await prisma.govModelBinding.create({ data: { purpose, modelId: approved.id, enforce: false, updatedBy: admin.id } });
      log(`bound ${purpose} to ${approved.ref} (not enforced)`);
    }
  } else log('no approved model: bindings not seeded');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedEnforcement()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
