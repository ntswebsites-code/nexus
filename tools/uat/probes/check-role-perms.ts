import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  for (const key of ['compliance', 'system_admin', 'operations']) {
    const portal = key === 'compliance' || key === 'system_admin' || key === 'operations' ? 'admin' : 'investor'; const r = await prisma.role.findUnique({ where: { portal_key: { portal, key } }, include: { permissions: { select: { permission: true } } } });
    console.log(`investor:${key}:`, (r?.permissions ?? []).map((x) => x.permission).sort().join(', '));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());


