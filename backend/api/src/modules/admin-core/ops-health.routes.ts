import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { expectVersion, param, query } from '../../lib/http';
import { MAX_ATTEMPTS } from '../../lib/outboxClaim';
import { validateBody, validateQuery } from '../../middleware/validate';
import { pageEnvelope, sqlPage } from '../../middleware/paginate';
import { requirePermission } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import { HEARTBEAT_STALE_MS, liveWorkers } from './ops-health.engine';
import { loadSnapshot, syncAlerts } from './ops-health';

/**
 * `/api/v1/admin-core/ops-health` (GAP-023): is the worker alive, is the outbox draining, are scheduled jobs on time.
 * Alerts are rows in `ops_alerts`, raised by the worker every minute and by this API when a screen is opened (so a dead
 * worker still produces an alert). Holders of `admin.settings` can see and act; mutations are audited and idempotent.
 */
export const opsHealthRoutes = Router();
const HEALTH = requirePermission('admin.settings');

let lastSync = 0;
const SYNC_EVERY_MS = 30_000;

const alertView = (a: Awaited<ReturnType<typeof prisma.opsAlert.findFirstOrThrow>>) => ({
  id: a.id,
  key: a.alertKey,
  source: a.source,
  severity: a.severity,
  title: a.title,
  detail: a.detail,
  status: a.status,
  occurrences: a.occurrences,
  firstSeenAt: a.firstSeenAt.toISOString(),
  lastSeenAt: a.lastSeenAt.toISOString(),
  resolvedAt: a.resolvedAt?.toISOString() ?? null,
  ackedBy: a.ackedBy,
  ackedAt: a.ackedAt?.toISOString() ?? null,
  ackNote: a.ackNote,
  version: a.version,
});

opsHealthRoutes.get('/', HEALTH, async (_req, res) => {
  if (Date.now() - lastSync > SYNC_EVERY_MS) {
    lastSync = Date.now();
    await syncAlerts().catch(() => {
      lastSync = 0;
    });
  }
  const now = new Date();
  const [snap, heartbeats, alerts, byType, jobs] = await Promise.all([
    loadSnapshot(now),
    prisma.workerHeartbeat.findMany({ orderBy: { lastBeatAt: 'desc' }, take: 20 }),
    prisma.opsAlert.findMany({ where: { status: { not: 'RESOLVED' } }, orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }], take: 50 }),
    prisma.outboxEvent.groupBy({ by: ['type'], where: { publishedAt: null }, _count: { _all: true }, orderBy: { _count: { type: 'desc' } }, take: 20 }),
    prisma.jobLock.findMany({ orderBy: { name: 'asc' } }),
  ]);
  const live = liveWorkers(snap);
  const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;
  res.json({
    status: critical ? 'CRITICAL' : alerts.length ? 'WARNING' : 'OK',
    checkedAt: now.toISOString(),
    heartbeatStaleSeconds: HEARTBEAT_STALE_MS / 1000,
    workers: heartbeats.map((h) => ({
      instanceId: h.instanceId,
      host: h.host,
      live: now.getTime() - h.lastBeatAt.getTime() <= HEARTBEAT_STALE_MS,
      startedAt: h.startedAt.toISOString(),
      lastBeatAt: h.lastBeatAt.toISOString(),
      lastTickMs: h.lastTickMs,
      ticks: h.ticks,
      lastHandled: h.lastHandled,
      lastError: h.lastError,
    })),
    liveWorkers: live.length,
    outbox: {
      pending: snap.outbox.pending,
      oldestPendingAt: snap.outbox.oldestPendingAt?.toISOString() ?? null,
      oldestPendingSeconds: snap.outbox.oldestPendingAt ? Math.round((now.getTime() - snap.outbox.oldestPendingAt.getTime()) / 1000) : 0,
      dead: snap.outbox.dead,
      maxAttempts: MAX_ATTEMPTS,
      byType: byType.map((b) => ({ type: b.type, count: b._count._all })),
    },
    jobs: jobs.map((j) => ({ name: j.name, lastRunAt: j.lastRunAt?.toISOString() ?? null, nextRunAt: j.lockedUntil.toISOString(), lastResult: j.lastResult })),
    alerts: alerts.map(alertView),
  });
});

/** Re-evaluates now (for the "Check now" button). */
opsHealthRoutes.post('/evaluate', HEALTH, idempotent('ops_health.evaluate', { required: false }), async (_req, res) => {
  lastSync = Date.now();
  res.json({ data: await syncAlerts() });
});

const alertsQuery = z.object({ status: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

opsHealthRoutes.get('/alerts', HEALTH, validateQuery(alertsQuery), async (req, res) => {
  const q = query<z.infer<typeof alertsQuery>>(req);
  const statuses = q.status?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const where = statuses?.length ? { status: { in: statuses } } : {};
  const pg = sqlPage(req, q.limit);
  const [rows, total] = await Promise.all([
    prisma.opsAlert.findMany({ where, orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.opsAlert.count({ where }),
  ]);
  res.json(pageEnvelope(pg, rows.map(alertView), total));
});

const ackBody = z.object({ note: z.string().trim().min(3).max(500), version: z.number().int().optional() });

opsHealthRoutes.post('/alerts/:id/ack', HEALTH, idempotent('ops_alert.ack'), validateBody(ackBody), async (req, res) => {
  const id = param(req, 'id');
  const a = await prisma.opsAlert.findUnique({ where: { id } });
  if (!a) throw HttpError.notFound('Alert not found');
  expectVersion(req, a.version);
  if (a.status !== 'OPEN') throw HttpError.conflict(`The alert is ${a.status}; only an OPEN alert can be acknowledged`, 'invalid_state');
  const note = (req.body as z.infer<typeof ackBody>).note;
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.opsAlert.updateMany({ where: { id, status: 'OPEN', version: a.version }, data: { status: 'ACKNOWLEDGED', ackedBy: req.user!.id, ackedAt: new Date(), ackNote: note, version: { increment: 1 } } });
    if (c.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), { action: 'ops_alert.acknowledged', objectType: 'ops_alert', objectId: id, before: { status: 'OPEN' }, after: { status: 'ACKNOWLEDGED', key: a.alertKey }, reason: note });
    return tx.opsAlert.findUniqueOrThrow({ where: { id } });
  });
  res.json({ data: alertView(row) });
});

const deadQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

opsHealthRoutes.get('/outbox/dead', HEALTH, validateQuery(deadQuery), async (req, res) => {
  const q = query<z.infer<typeof deadQuery>>(req);
  const pg = sqlPage(req, q.limit);
  const where = { publishedAt: null, attempts: { gte: MAX_ATTEMPTS } };
  const [rows, total] = await Promise.all([
    prisma.outboxEvent.findMany({ where, orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.outboxEvent.count({ where }),
  ]);
  res.json(pageEnvelope(pg, rows.map((e) => ({ id: e.id.toString(), type: e.type, attempts: e.attempts, lastError: e.lastError, createdAt: e.createdAt.toISOString() })), total));
});

const BIGINT = /^\d{1,18}$/;
const eventId = (req: Parameters<typeof param>[0]) => {
  const raw = param(req, 'id');
  if (!BIGINT.test(raw)) throw HttpError.notFound('Event not found');
  return BigInt(raw);
};

/** Puts a dead-lettered event back in the queue with a fresh retry budget. */
opsHealthRoutes.post('/outbox/:id/retry', HEALTH, idempotent('outbox.retry'), async (req, res) => {
  const id = eventId(req);
  const e = await prisma.outboxEvent.findUnique({ where: { id } });
  if (!e) throw HttpError.notFound('Event not found');
  await prisma.$transaction(async (tx) => {
    const c = await tx.outboxEvent.updateMany({ where: { id, publishedAt: null, attempts: { gte: MAX_ATTEMPTS } }, data: { attempts: 0, nextAttemptAt: null, claimedBy: null, claimedAt: null } });
    if (c.count !== 1) throw HttpError.conflict('The event is no longer a dead letter', 'invalid_state');
    await writeAudit(tx, audit(req), { action: 'outbox.retried', objectType: 'outbox_event', objectId: id.toString(), before: { attempts: e.attempts, lastError: e.lastError }, after: { attempts: 0, type: e.type } });
  });
  res.json({ data: { id: id.toString(), status: 'QUEUED' } });
});

/** Retires a dead letter without running it. The row is kept (marked) so the audit trail stays whole. */
opsHealthRoutes.post('/outbox/:id/discard', HEALTH, idempotent('outbox.discard'), validateBody(z.object({ note: z.string().trim().min(3).max(300) })), async (req, res) => {
  const id = eventId(req);
  const e = await prisma.outboxEvent.findUnique({ where: { id } });
  if (!e) throw HttpError.notFound('Event not found');
  const note = (req.body as { note: string }).note;
  await prisma.$transaction(async (tx) => {
    const c = await tx.outboxEvent.updateMany({
      where: { id, publishedAt: null, attempts: { gte: MAX_ATTEMPTS } },
      data: { publishedAt: new Date(), claimedBy: null, claimedAt: null, lastError: `DISCARDED: ${note}`.slice(0, 2000) },
    });
    if (c.count !== 1) throw HttpError.conflict('The event is no longer a dead letter', 'invalid_state');
    await writeAudit(tx, audit(req), { action: 'outbox.discarded', objectType: 'outbox_event', objectId: id.toString(), before: { attempts: e.attempts, lastError: e.lastError, type: e.type }, after: { discarded: true }, reason: note });
  });
  res.json({ data: { id: id.toString(), status: 'DISCARDED' } });
});
