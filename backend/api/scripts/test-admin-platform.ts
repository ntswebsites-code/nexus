/**
 * R4-1 checks: admin platform remainders.
 *
 *  - Pure: newer approve codes in the SoD list, health rules (worker down, backlog, dead letters, late jobs), alert
 *    lifecycle, SQL paging helper.
 *  - Database (throwaway only): alert sync opens / refreshes / resolves exactly once per condition and notifies once,
 *    heartbeat upsert, dead-letter retry and discard keep the row.
 *
 *   npx tsx scripts/test-admin-platform.ts                                   (pure only)
 *   E2E_CONFIRM=throwaway-db npx tsx --env-file-if-exists=../../.env scripts/test-admin-platform.ts
 */
import { MONETARY, PRIVILEGED_PERMISSIONS, SOD_RULES, sodHits } from '../src/modules/admin-core/admin-core.engine';
import { alertAction, evaluateHealth, liveWorkers, type HealthSnapshot } from '../src/modules/admin-core/ops-health.engine';
import { sqlPage } from '../src/middleware/paginate';

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
};

const now = new Date('2026-11-01T10:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const snap = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  now,
  workers: [{ instanceId: 'w1', lastBeatAt: ago(5_000) }],
  outbox: { pending: 0, oldestPendingAt: null, dead: 0 },
  jobs: [],
  ...over,
});

function pure() {
  console.log('\nSeparation of duties: newer approve codes');
  for (const p of ['dealing.approve', 'recon.signoff', 'term_sheets.approve', 'onboarding.approve', 'documents.approve', 'notices.publish']) {
    check(`${p} is blocklisted and privileged`, MONETARY.includes(p) && PRIVILEGED_PERMISSIONS.has(p));
    check(`admin.rbac + ${p} conflicts`, sodHits(['admin.rbac', p]).length >= 1);
  }
  for (const p of ['performance.lock', 'capital.approve', 'distributions.approve', 'cash.close', 'accounting.close']) check(`admin.rbac + ${p} conflicts`, sodHits(['admin.rbac', p]).length >= 1);
  check('term sheet maker and approver conflict', sodHits(['term_sheets.create', 'term_sheets.approve']).some((h) => h.rule === 'term-sheets-maker-checker'));
  check('rule ids stay unique', new Set(SOD_RULES.map((r) => r.id)).size === SOD_RULES.length);

  console.log('\nHealth rules');
  check('healthy snapshot has no conditions', evaluateHealth(snap()).length === 0);
  check('a fresh heartbeat counts as live', liveWorkers(snap()).length === 1);
  const down = evaluateHealth(snap({ workers: [{ instanceId: 'w1', lastBeatAt: ago(10 * MIN) }] }));
  check('stale heartbeat raises worker.down (critical)', down.some((c) => c.key === 'worker.down' && c.severity === 'CRITICAL'), down);
  const never = evaluateHealth(snap({ workers: [] }));
  check('no heartbeat and an empty outbox is only a warning', never.some((c) => c.key === 'worker.down' && c.severity === 'WARNING'));
  check('no heartbeat with waiting events is critical', evaluateHealth(snap({ workers: [], outbox: { pending: 3, oldestPendingAt: ago(MIN), dead: 0 } })).some((c) => c.key === 'worker.down' && c.severity === 'CRITICAL'));
  check('a young backlog is not an alert', !evaluateHealth(snap({ outbox: { pending: 20, oldestPendingAt: ago(2 * MIN), dead: 0 } })).some((c) => c.key === 'outbox.backlog'));
  check('an old backlog warns', evaluateHealth(snap({ outbox: { pending: 20, oldestPendingAt: ago(10 * MIN), dead: 0 } })).some((c) => c.key === 'outbox.backlog' && c.severity === 'WARNING'));
  check('a very old backlog is critical', evaluateHealth(snap({ outbox: { pending: 20, oldestPendingAt: ago(45 * MIN), dead: 0 } })).some((c) => c.key === 'outbox.backlog' && c.severity === 'CRITICAL'));
  check('a huge backlog is critical at once', evaluateHealth(snap({ outbox: { pending: 900, oldestPendingAt: ago(1 * MIN), dead: 0 } })).some((c) => c.key === 'outbox.backlog' && c.severity === 'CRITICAL'));
  check('dead letters are critical', evaluateHealth(snap({ outbox: { pending: 0, oldestPendingAt: null, dead: 2 } })).some((c) => c.key === 'outbox.dead' && c.severity === 'CRITICAL'));
  const late = evaluateHealth(snap({ jobs: [{ name: 'reports.schedules', lastRunAt: ago(5 * 60 * MIN), lockedUntil: ago(3 * 60 * MIN) }, { name: 'company.reminders', lastRunAt: ago(30 * MIN), lockedUntil: new Date(now.getTime() + 30 * MIN) }] }));
  check('only the overdue job is flagged', late.length === 1 && late[0]!.key === 'job.stale:reports.schedules', late);
  check('alert keys fit the 100-char column', evaluateHealth(snap({ jobs: [{ name: 'x'.repeat(90), lastRunAt: ago(9 * 60 * MIN), lockedUntil: ago(8 * 60 * MIN) }] }))[0]!.key.length <= 100);

  console.log('\nAlert lifecycle');
  check('new condition opens', alertAction(null, true) === 'open');
  check('returning condition reopens a resolved alert', alertAction({ status: 'RESOLVED' }, true) === 'open');
  check('ongoing condition only refreshes', alertAction({ status: 'OPEN' }, true) === 'update' && alertAction({ status: 'ACKNOWLEDGED' }, true) === 'update');
  check('cleared condition resolves open and acknowledged alerts', alertAction({ status: 'OPEN' }, false) === 'resolve' && alertAction({ status: 'ACKNOWLEDGED' }, false) === 'resolve');
  check('nothing to do when resolved and clear', alertAction({ status: 'RESOLVED' }, false) === 'none' && alertAction(null, false) === 'none');

  console.log('\nSQL paging helper');
  const req = (q: Record<string, string>) => ({ query: q }) as never;
  const none = sqlPage(req({}), 100);
  check('no paging parameters keeps the handler limit', !none.paged && none.skip === 0 && none.take === 100);
  const p3 = sqlPage(req({ page: '3', pageSize: '25' }), 100);
  check('page 3 of 25 skips 50', p3.paged && p3.skip === 50 && p3.take === 25 && p3.page === 3);
  check('pageSize is capped', sqlPage(req({ page: '1', pageSize: '9999' }), 100).take === 200);
  check('junk values fall back safely', sqlPage(req({ page: '-4', pageSize: 'abc' }), 100).skip === 0);
}

async function db() {
  const { prisma } = await import('../src/lib/prisma');
  const { syncAlerts, recordHeartbeat } = await import('../src/modules/admin-core/ops-health');
  const tag = `r41-${Date.now().toString(36)}`;
  const instance = `test-${tag}`;
  const eventIds: bigint[] = [];
  console.log('\nDatabase flow');
  try {
    await prisma.workerHeartbeat.deleteMany({});
    await prisma.opsAlert.deleteMany({ where: { alertKey: { in: ['worker.down', 'outbox.dead', 'outbox.backlog'] } } });
    const first = await syncAlerts();
    const down = await prisma.opsAlert.findUnique({ where: { alertKey: 'worker.down' } });
    check('no worker: worker.down opens', first.opened >= 1 && down?.status === 'OPEN', first);
    const notifiedBefore = await prisma.outboxEvent.count({ where: { type: 'notify.permission', payload: { path: '$.type', equals: 'ops.alert' } } });
    await syncAlerts();
    const notifiedAfter = await prisma.outboxEvent.count({ where: { type: 'notify.permission', payload: { path: '$.type', equals: 'ops.alert' } } });
    check('a second sync does not notify again', notifiedAfter === notifiedBefore, { notifiedBefore, notifiedAfter });

    await recordHeartbeat(instance, { ms: 12, handled: 0 });
    const resolved = await syncAlerts();
    check('a heartbeat resolves worker.down', (await prisma.opsAlert.findUnique({ where: { alertKey: 'worker.down' } }))?.status === 'RESOLVED' && resolved.resolved >= 1, resolved);

    const dead = await prisma.outboxEvent.create({ data: { type: 'test.noop', payload: { tag }, attempts: 8, lastError: 'boom' } });
    eventIds.push(dead.id);
    await syncAlerts();
    check('a dead letter opens outbox.dead', (await prisma.opsAlert.findUnique({ where: { alertKey: 'outbox.dead' } }))?.status === 'OPEN');
    await prisma.outboxEvent.updateMany({ where: { id: dead.id }, data: { attempts: 0 } });
    await prisma.outboxEvent.updateMany({ where: { id: dead.id }, data: { publishedAt: new Date(), lastError: 'DISCARDED: test' } });
    await syncAlerts();
    check('clearing the dead letter resolves the alert; the row is kept', (await prisma.opsAlert.findUnique({ where: { alertKey: 'outbox.dead' } }))?.status === 'RESOLVED' && (await prisma.outboxEvent.count({ where: { id: dead.id } })) === 1);
  } finally {
    await prisma.workerHeartbeat.deleteMany({ where: { instanceId: instance } });
    if (eventIds.length) await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.$disconnect();
  }
}

async function main() {
  pure();
  if (process.env.E2E_CONFIRM === 'throwaway-db') await db();
  else console.log('\n(database flow skipped: set E2E_CONFIRM=throwaway-db)');
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

void main();
