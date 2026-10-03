/**
 * Wiring demo data: builds today's Operations Control runbook from the live state (recon breaks, pending journals, NAV
 * runs, corporate actions, close blockers) and adds two manual operating-day tasks, one depending on the other.
 * Idempotent: generated tasks are unique per source and manual demo tasks are keyed by a fixed source ref.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-wiring.ts   (standalone; run after the other seeds)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { generateRunbook } from '../src/modules/wiring/control.service';
import { ensureTask } from '../src/modules/wiring/tasks';

const log = (m: string) => console.log(`[seed:wiring] ${m}`);

export async function seedWiring() {
  const r = await generateRunbook();
  const day = new Date().toISOString().slice(0, 10);
  const at = (h: number) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00.000Z`);
  const tasks = await prisma.$transaction(async (tx) => {
    const a = await ensureTask(tx, { area: 'CASH', title: 'Confirm custodian cash statement received', detail: 'Bank statement for the operating account is imported and staged.', dueAt: at(9), sourceRef: `SEED:CASH-STATEMENT:${day}`, link: '/ops/cash' });
    const b = await ensureTask(tx, { area: 'REPORTING', title: 'Publish daily operations pack', detail: 'Send once the statement is in and breaks are triaged.', dueAt: at(16), sourceRef: `SEED:OPS-PACK:${day}`, link: '/ops/reporting' });
    if (!b.task.dependsOnId) await tx.opsTask.update({ where: { id: b.task.id }, data: { dependsOnId: a.task.id } });
    return [a.created, b.created].filter(Boolean).length;
  });
  log(`${r.created} generated task(s), ${tasks} demo task(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedWiring();
  } catch (err) {
    console.error('[seed:wiring] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
