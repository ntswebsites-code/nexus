import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT id, user_id, expires_at, last_used_at, created_at FROM sessions ORDER BY created_at DESC LIMIT 5',
  );
  console.log(JSON.stringify(rows, null, 1));
  const policies = await prisma.policy.findMany({ where: { key: { contains: 'session' } }, select: { key: true, value: true } });
  console.log('session policies:', JSON.stringify(policies));
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
