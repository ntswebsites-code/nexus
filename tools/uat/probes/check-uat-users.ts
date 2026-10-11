import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, isActive: true, name: true, passwordHash: true },
    orderBy: { email: 'asc' },
  });
  console.log(`users: ${users.length}`);
  for (const u of users) {
    console.log(`${u.id} | ${u.email} | active=${u.isActive} | hash=${u.passwordHash ? 'yes' : 'NO'}`);
  }
  const roles = await prisma.role.findMany({ select: { portal: true, key: true } });
  console.log(`\nroles: ${roles.length}`);
  const counts: Record<string, number> = {};
  for (const r of roles) counts[r.portal] = (counts[r.portal] ?? 0) + 1;
  console.log(Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
