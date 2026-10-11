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
  // Check the outbox event status
  const outbox = await prisma.outboxEvent.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  console.log('Latest outbox event:', JSON.stringify(serialize(outbox), null, 2));

  // Check integration calls
  const calls = await prisma.integrationCall.findMany({
    where: { adapter: 'email' },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Recent email integration calls:', JSON.stringify(calls, null, 2));

  // Check integration inbox
  const inbox = await prisma.integrationInbox.findMany({
    where: { adapter: 'email' },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Recent email inbox:', JSON.stringify(inbox, null, 2));

  await prisma.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });