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
  // Check job locks
  const locks = await prisma.jobLock.findMany();
  console.log('Job locks:', JSON.stringify(serialize(locks), null, 2));
  
  await prisma.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });