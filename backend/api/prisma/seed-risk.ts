/**
 * Risk demo data: the three preset scenarios (liquidity, equity, FX), and, when two distinct staff users exist,
 * one ACTIVE and one DRAFT limit plus one manual case so the Risk screens are not empty.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-risk.ts      (standalone; run seed-portfolio first)
 *   also called by seed-demo.ts and seed-uat.ts
 *
 * Idempotent: scenarios are matched by name, limits and the case by a "[seed]" description marker.
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';
import { PRESETS } from '../src/modules/risk/risk.engine';

const log = (m: string) => console.log(`[seed:risk] ${m}`);
const MARK = '[seed] ';

export async function seedRisk() {
  for (const p of PRESETS) {
    await prisma.riskScenario.upsert({
      where: { name: p.name },
      update: {},
      create: { name: p.name, shocks: p.shocks as unknown as Prisma.InputJsonValue, preset: p.key },
    });
  }
  log(`${PRESETS.length} preset scenarios`);

  const staff = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } },
    orderBy: { createdAt: 'asc' },
    take: 2,
    select: { id: true },
  });
  const bgf = await prisma.portfolio.findFirst({ where: { name: 'Balanced Growth Fund' }, select: { id: true } });
  if (staff.length < 1) {
    log('no staff users yet: limits and case skipped');
    return;
  }
  const [maker, other] = [staff[0]!, staff[1]];

  if (other && !(await prisma.riskLimit.findFirst({ where: { description: { startsWith: `${MARK}Firm single-name` } } }))) {
    await prisma.$transaction(async (tx) => {
      await tx.riskLimit.create({
        data: {
          ref: await nextRef(tx, 'riskLimit'),
          metric: 'SINGLE_NAME_PCT',
          scopeType: 'FIRM',
          threshold: new Prisma.Decimal(15),
          breachAction: 'ESCALATE',
          description: `${MARK}Firm single-name limit: no security above 15% of any portfolio`,
          ownerUserId: maker.id,
          makerId: maker.id,
          checkerId: other.id,
          status: 'ACTIVE',
          approvedAt: new Date(),
        },
      });
    });
  }
  if (!(await prisma.riskLimit.findFirst({ where: { description: { startsWith: `${MARK}Top-5` } } }))) {
    await prisma.$transaction(async (tx) => {
      await tx.riskLimit.create({
        data: {
          ref: await nextRef(tx, 'riskLimit'),
          metric: 'TOP5_PCT',
          scopeType: bgf ? 'PORTFOLIO' : 'FIRM',
          scopeId: bgf?.id ?? null,
          threshold: new Prisma.Decimal(60),
          breachAction: 'ALERT',
          description: `${MARK}Top-5 concentration draft, awaiting submission`,
          ownerUserId: maker.id,
          makerId: maker.id,
          status: 'DRAFT',
        },
      });
    });
  }
  if (!(await prisma.riskCase.findFirst({ where: { description: { startsWith: `${MARK}Quarterly` } } }))) {
    await prisma.$transaction(async (tx) => {
      await tx.riskCase.create({
        data: {
          ref: await nextRef(tx, 'riskCase'),
          type: 'MANUAL',
          description: `${MARK}Quarterly concentration review of Balanced Growth Fund`,
          severity: 'LOW',
          ownerUserId: maker.id,
          portfolioId: bgf?.id ?? null,
          createdBy: maker.id,
        },
      });
    });
  }
  log('limits and case ensured');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedRisk();
  } catch (err) {
    console.error('[seed:risk] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
