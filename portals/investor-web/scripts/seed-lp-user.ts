/**
 * Dev helper: creates (or refreshes) one LP user with a client, a fund and a commitment, so the
 * portal can be signed into against a local API. Disposable databases only.
 *
 *   cd backend/api
 *   $env:DATABASE_URL='mysql://.../nexus_ws5'; $env:E2E_CONFIRM='throwaway-db'
 *   $env:LP_SEED_EMAIL='lp.demo@example.test'; $env:LP_SEED_PASSWORD='<choose one>'
 *   npx tsx ../../portals/investor-web/scripts/seed-lp-user.ts
 */
import { prisma } from '../../../backend/api/src/lib/prisma';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const email = process.env.LP_SEED_EMAIL ?? 'lp.demo@example.test';
const password = process.env.LP_SEED_PASSWORD;
if (!password || password.length < 10) {
  console.error('Set LP_SEED_PASSWORD (10+ characters).');
  process.exit(2);
}

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const passwordHash = await bcrypt.hash(password!, 10);
  const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'investor', key: 'admin' } } });

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true },
    create: { email, name: 'Lara Demo', passwordHash },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  const client = await prisma.client.upsert({
    where: { ref: 'WS5-LP-A' },
    update: { portalEnabled: true },
    create: { ref: 'WS5-LP-A', name: 'Kariba Pension Fund', type: 'Pension fund', email, portalEnabled: true },
  });
  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: client.id, userId: user.id } },
    update: { status: 'ACTIVE', revokedAt: null, investorRole: 'admin' },
    create: { clientId: client.id, userId: user.id, investorRole: 'admin' },
  });

  const fund = await prisma.fund.upsert({
    where: { ref: 'WS5-F1' },
    update: {},
    create: {
      ref: 'WS5-F1',
      name: 'Matanho Live Test Fund I',
      shortName: 'Live Test I',
      currency: 'USD',
      asOfDate: new Date('2026-06-30'),
      valuationStatus: 'FINAL',
    },
  });
  await prisma.fundCommitment.upsert({
    where: { clientId_fundId: { clientId: client.id, fundId: fund.id } },
    update: {},
    create: { clientId: client.id, fundId: fund.id, commitmentAmount: '2500000.00', investorAccountRef: 'KPF-001' },
  });

  console.log(`LP user ready: ${email} -> client ${client.ref} (${client.name}), fund ${fund.ref}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
