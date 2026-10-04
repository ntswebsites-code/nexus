import { hostname } from 'node:os';
import { prisma } from '../../lib/prisma';
import { enqueue } from '../../lib/outbox';
import { MAX_ATTEMPTS } from '../../lib/outboxClaim';
import { alertAction, evaluateHealth, liveWorkers, type HealthSnapshot } from './ops-health.engine';

/** Permission whose holders are told about operational alerts. */
export const ALERT_PERMISSION = 'admin.settings';

export async function loadSnapshot(now = new Date()): Promise<HealthSnapshot> {
  const [workers, pending, oldest, dead, jobs] = await Promise.all([
    prisma.workerHeartbeat.findMany({ select: { instanceId: true, lastBeatAt: true } }),
    prisma.outboxEvent.count({ where: { publishedAt: null, attempts: { lt: MAX_ATTEMPTS } } }),
    prisma.outboxEvent.findFirst({ where: { publishedAt: null, attempts: { lt: MAX_ATTEMPTS } }, orderBy: { id: 'asc' }, select: { createdAt: true } }),
    prisma.outboxEvent.count({ where: { publishedAt: null, attempts: { gte: MAX_ATTEMPTS } } }),
    prisma.jobLock.findMany({ select: { name: true, lastRunAt: true, lockedUntil: true } }),
  ]);
  return { now, workers, outbox: { pending, oldestPendingAt: oldest?.createdAt ?? null, dead }, jobs };
}

/** NFR-OPS-007: queue depth and age of the outbox/worker, shared by /health, /internal/metrics and /ops. */
export async function queueMetrics(now = new Date()) {
  const snap = await loadSnapshot(now);
  return {
    pending: snap.outbox.pending,
    oldestPendingSeconds: snap.outbox.oldestPendingAt ? Math.max(0, Math.round((now.getTime() - snap.outbox.oldestPendingAt.getTime()) / 1000)) : 0,
    dead: snap.outbox.dead,
    liveWorkers: liveWorkers(snap).length,
  };
}

/**
 * Evaluates health and reconciles `ops_alerts`: opens an alert for each new condition (and tells holders of
 * `admin.settings` once), refreshes ones still active, resolves ones that cleared. Safe to run from the worker and
 * from the API at the same time: rows are keyed by `alert_key`.
 */
export async function syncAlerts(now = new Date()) {
  const snapshot = await loadSnapshot(now);
  const conditions = evaluateHealth(snapshot);
  const active = new Map(conditions.map((c) => [c.key, c]));
  const existing = await prisma.opsAlert.findMany({ where: { OR: [{ status: { not: 'RESOLVED' } }, { alertKey: { in: [...active.keys()] } }] } });
  const byKey = new Map(existing.map((a) => [a.alertKey, a]));
  let opened = 0;
  let resolved = 0;

  for (const c of conditions) {
    const row = byKey.get(c.key) ?? null;
    const action = alertAction(row, true);
    if (action === 'open') {
      await prisma.$transaction(async (tx) => {
        const data = { source: c.source, severity: c.severity, title: c.title.slice(0, 200), detail: c.detail.slice(0, 500), status: 'OPEN', lastSeenAt: now, resolvedAt: null, ackedBy: null, ackedAt: null, ackNote: null, notifiedAt: now };
        if (row) await tx.opsAlert.update({ where: { id: row.id }, data: { ...data, occurrences: { increment: 1 }, firstSeenAt: now, version: { increment: 1 } } });
        else await tx.opsAlert.create({ data: { alertKey: c.key, firstSeenAt: now, ...data } });
        await enqueue(tx, 'notify.permission', { permission: ALERT_PERMISSION, type: 'ops.alert', title: `${c.severity === 'CRITICAL' ? 'Critical: ' : ''}${c.title}`, body: c.detail, link: '/ops/health', email: c.severity === 'CRITICAL' });
      });
      opened++;
    } else if (action === 'update' && row) {
      await prisma.opsAlert.update({ where: { id: row.id }, data: { lastSeenAt: now, severity: c.severity, detail: c.detail.slice(0, 500), title: c.title.slice(0, 200) } });
    }
  }
  for (const row of existing) {
    if (alertAction(row, active.has(row.alertKey)) === 'resolve') {
      await prisma.opsAlert.update({ where: { id: row.id }, data: { status: 'RESOLVED', resolvedAt: now, version: { increment: 1 } } });
      resolved++;
    }
  }
  return { conditions: conditions.length, opened, resolved };
}

const STARTED_AT = new Date();
let hostLabel: string | null = null;
let lastBeatWrite = 0;
const BEAT_EVERY_MS = 10_000;

/** Called by the worker after every tick. Cheap upsert; never throws into the worker loop. */
export async function recordHeartbeat(instanceId: string, tick: { ms: number; handled: number; error?: string | null }) {
  // The worker polls every two seconds; one write every ten is plenty against a 90 second staleness limit.
  if (Date.now() - lastBeatWrite < BEAT_EVERY_MS && !tick.error) return;
  lastBeatWrite = Date.now();
  hostLabel ??= hostname().slice(0, 120);
  const now = new Date();
  try {
    await prisma.workerHeartbeat.upsert({
      where: { instanceId },
      create: { instanceId, host: hostLabel, startedAt: STARTED_AT, lastBeatAt: now, lastTickMs: tick.ms, ticks: 1, lastHandled: tick.handled, lastError: tick.error?.slice(0, 500) ?? null },
      update: { lastBeatAt: now, lastTickMs: tick.ms, ticks: { increment: 1 }, lastHandled: tick.handled, lastError: tick.error?.slice(0, 500) ?? null },
    });
  } catch (error) {
    console.error('[worker] heartbeat failed', error);
  }
}

/** Removes heartbeat rows of workers that stopped more than a day ago. */
export async function pruneHeartbeats() {
  const r = await prisma.workerHeartbeat.deleteMany({ where: { lastBeatAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } });
  return r.count;
}
