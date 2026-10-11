import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { in: ['test_custodian_approver@uat.matanho.test', 'local_admin@local.matanho.test', 'investee_101_approver@uat.matanho.test', 'custodian_approver@uat.matanho.test'] } },
    select: { email: true, isActive: true, roles: { select: { role: { select: { portal: true, key: true } } } } },
  });
  for (const u of users) console.log(`${u.email} active=${u.isActive} roles=[${u.roles.map((r) => `${r.role.portal}:${r.role.key}`).join(', ')}]`);
  const total = await prisma.user.count();
  console.log(`total users: ${total}`);
  const cp = await prisma.$queryRawUnsafe<{ email: string; role: string; status: string; ref: string }[]>(
    `SELECT u.email, cu.role, cu.status, cp.ref FROM counterparty_users cu JOIN users u ON u.id = cu.user_id JOIN counterparties cp ON cp.id = cu.counterparty_id`,
  );
  console.log('counterparty users:');
  for (const c of cp) console.log(`  ${c.email} -> ${c.ref} (${c.role}, ${c.status})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
