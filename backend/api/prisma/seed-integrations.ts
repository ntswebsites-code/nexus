/**
 * Integrations demo data: one state row per adapter (no failure simulation) and, for an adapter with no logged call
 * yet, a baseline `health` call so /ops/integrations shows a last call. Idempotent.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-integrations.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { INTEGRATION_NAMES } from '../src/integrations/core/names';
import { hashRequest } from '../src/integrations/core/calls';

const log = (m: string) => console.log(`[seed:integrations] ${m}`);

export async function seedIntegrations() {
  let baselines = 0;
  for (const name of INTEGRATION_NAMES) {
    await prisma.integrationState.upsert({ where: { adapter: name }, update: {}, create: { adapter: name, failureMode: 'none', failuresRemaining: 0 } });
    if ((await prisma.integrationCall.count({ where: { adapter: name } })) === 0) {
      await prisma.integrationCall.create({
        data: { adapter: name, mode: 'fake', operation: 'health', requestHash: hashRequest([name, 'seed']), status: 'OK', durationMs: 1, request: { seed: true }, result: { ok: true }, correlationId: 'seed' },
      });
      baselines++;
    }
  }
  log(`${INTEGRATION_NAMES.length} adapter state row(s), ${baselines} baseline call(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedIntegrations();
  } catch (err) {
    console.error('[seed:integrations] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
