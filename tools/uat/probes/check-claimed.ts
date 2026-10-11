import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function serialize(obj: unknown): unknown {
  if (typeof obj === 'bigint') return obj.toString();
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(serialize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = serialize(v);
  return out;
}

async function check() {
  // Check claimed events
  const events = await prisma.outboxEvent.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 20
  });
  for (const e of events) {
    console.log(`ID: ${e.id}, Type: ${e.type}, ClaimedBy: ${e.claimedBy ?? 'none'}, Attempts: ${e.attempts}, NextAttempt: ${e.nextAttemptAt?.toISOString() ?? 'none'}`);
  }
  
  await prisma.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });