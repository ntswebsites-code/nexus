import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const secs = await prisma.security.findMany({ select: { symbol: true, logoUrl: true, imageUrl: true } });
  for (const s of secs) console.log(`${s.symbol || '-'} logo=${(s.logoUrl || 'none').slice(0, 70)} image=${(s.imageUrl || 'none').slice(0, 50)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
