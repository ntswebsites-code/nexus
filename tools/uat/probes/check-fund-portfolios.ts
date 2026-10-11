import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const funds = await prisma.fund.findMany({ select: { ref: true, name: true, portfolioId: true } });
  const ports = await prisma.portfolio.findMany({ select: { ref: true, name: true } });
  const byId = new Map(ports.map((p) => [p.id, p.ref]));
  for (const f of funds) console.log(`${f.ref} ${f.name} -> portfolio ${byId.get(f.portfolioId) ?? f.portfolioId}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
