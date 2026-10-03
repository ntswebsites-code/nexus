/**
 * Investee workspace demo data for the first three active portfolio companies: share classes with a 1x preference,
 * an opening register, one issuance waiting for a checker (made by the system, so any approver can decide it), a
 * board meeting with an open action, and three months of revenue forecast. Also moves any old settings JSON into the
 * tables (ensureWorkspace). Idempotent: each block is skipped when the company already has that data.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-investee-workspace.ts
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { SYSTEM_ACTOR_ID } from '../src/lib/system';
import { D, day, ensureWorkspace, getOrCreateClass, getOrCreateHolder, parseDay, refs } from '../src/modules/investee-portal/workspace/store';

const log = (m: string) => console.log(`[seed:investee-workspace] ${m}`);

export async function seedInvesteeWorkspace() {
  const companies = await prisma.portfolioCompany.findMany({ where: { status: { in: ['Active', 'Approved'] } }, orderBy: { ref: 'asc' }, take: 3 });
  let touched = 0;
  for (const company of companies) {
    await ensureWorkspace(company.id);
    await prisma.$transaction(async (tx) => {
      const cap = await tx.investeeCapTx.count({ where: { companyId: company.id } });
      if (!cap) {
        const ordinary = await getOrCreateClass(tx, company.id, 'Ordinary');
        const preferred = await getOrCreateClass(tx, company.id, 'Preferred');
        const founders = await getOrCreateHolder(tx, company.id, 'Founders and management');
        const fund = await getOrCreateHolder(tx, company.id, 'Matanho fund');
        const base = {
          companyId: company.id,
          status: 'APPROVED',
          currency: company.reportingCurrency,
          effectiveDate: parseDay(day(new Date(Date.now() - 180 * 86400000))),
          makerId: SYSTEM_ACTOR_ID,
          makerName: 'System',
          decidedAt: new Date(),
          decisionNote: 'Seed baseline',
        };
        await tx.investeeCapTx.create({ data: { ...base, ref: await refs.capTx(tx), kind: 'OPENING', holderId: founders.id, classId: ordinary.id, shares: new D(8_000_000), note: 'Opening balance' } });
        await tx.investeeCapTx.create({ data: { ...base, ref: await refs.capTx(tx), kind: 'ISSUANCE', holderId: fund.id, classId: preferred.id, shares: new D(2_000_000), pricePerShare: new D('1.000000'), consideration: new D(2_000_000), note: 'Seed round (certificate not issued for the seed baseline)' } });
        await tx.investeeCapTx.create({
          data: { companyId: company.id, ref: await refs.capTx(tx), kind: 'ISSUANCE', holderId: (await getOrCreateHolder(tx, company.id, 'Employee option pool')).id, classId: (await getOrCreateClass(tx, company.id, 'Options')).id, shares: new D(500_000), consideration: new D(0), currency: company.reportingCurrency, effectiveDate: parseDay(day()), note: 'Option pool top-up, awaiting a second approver', makerId: SYSTEM_ACTOR_ID, makerName: 'System' },
        });
        touched++;
      }
      if (!(await tx.investeeBoardMeeting.count({ where: { companyId: company.id } }))) {
        const at = new Date(Date.now() + 21 * 86400000);
        at.setUTCHours(9, 0, 0, 0);
        const m = await tx.investeeBoardMeeting.create({ data: { ref: await refs.meeting(tx), companyId: company.id, title: 'Quarterly board meeting', meetingAt: at, location: 'Head office / video', agenda: '1. Minutes\n2. Management accounts\n3. Budget\n4. Reserved matters', createdBy: SYSTEM_ACTOR_ID } });
        await tx.investeeBoardAction.create({ data: { companyId: company.id, meetingId: m.id, title: 'Circulate the revised budget to investors', ownerName: 'Finance lead', dueOn: parseDay(day(new Date(Date.now() + 14 * 86400000))) } });
        touched++;
      }
      if (!(await tx.investeeForecastCell.count({ where: { companyId: company.id } }))) {
        for (let i = 0; i < 3; i++) {
          const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + i, 1));
          const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          await tx.investeeForecastCell.create({ data: { companyId: company.id, period, metric: 'revenue', value: new D(100_000 + i * 12_000) } });
        }
        touched++;
      }
    });
  }
  log(`${companies.length} company(ies) checked, ${touched} block(s) seeded`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedInvesteeWorkspace();
  } catch (err) {
    console.error('[seed:investee-workspace] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
