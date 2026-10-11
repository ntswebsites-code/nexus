import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cp = await prisma.counterparty.findUnique({ where: { ref: 'CP-001' } });
  console.log('CP-001 accounts:', JSON.stringify(cp?.accounts));
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
