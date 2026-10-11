import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const bs = await prisma.broker.findMany({ where: { status: 'Active' }, select: { id: true, name: true, email: true } });
  console.log(JSON.stringify(bs, null, 1));
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
