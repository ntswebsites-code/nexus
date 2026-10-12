import { PrismaClient } from '@prisma/client';
import { config } from '../config';

export const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
  log: config.isProduction ? ['error'] : ['warn', 'error'],
  transactionOptions: { timeout: 15_000, maxWait: 10_000 },
});

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
