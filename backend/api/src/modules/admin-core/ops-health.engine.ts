/**
 * Worker / outbox health rules (R4-1, GAP-023). Pure functions with no database access so they can be tested offline.
 * The evaluator in `ops-health.ts` feeds them a snapshot and turns the result into `ops_alerts` rows.
 */

export const HEARTBEAT_STALE_MS = 90_000;
export const BACKLOG_WARN_MS = 5 * 60_000;
export const BACKLOG_CRIT_MS = 30 * 60_000;
export const BACKLOG_CRIT_COUNT = 500;
/** A scheduled job is stale when its planned next run is overdue by this long. */
export const JOB_OVERDUE_MS = 2 * 60 * 60_000;

export interface HealthSnapshot {
  now: Date;
  /** Heartbeat rows (last beat per worker instance). */
  workers: { instanceId: string; lastBeatAt: Date }[];
  outbox: {
    /** Unpublished events still within the retry budget. */
    pending: number;
    oldestPendingAt: Date | null;
    /** Unpublished events that exhausted their attempts (dead letters). */
    dead: number;
  };
  /** Scheduled job leases: `lockedUntil` is the planned next run once a job has finished. */
  jobs: { name: string; lastRunAt: Date | null; lockedUntil: Date }[];
}

export type AlertSeverity = 'WARNING' | 'CRITICAL';

export interface Condition {
  key: string;
  source: 'worker' | 'outbox' | 'job';
  severity: AlertSeverity;
  title: string;
  detail: string;
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

export function liveWorkers(s: HealthSnapshot) {
  return s.workers.filter((w) => s.now.getTime() - w.lastBeatAt.getTime() <= HEARTBEAT_STALE_MS);
}

/** Every unhealthy condition in the snapshot. An empty list means healthy. */
export function evaluateHealth(s: HealthSnapshot): Condition[] {
  const out: Condition[] = [];
  const live = liveWorkers(s);
  const oldestAge = s.outbox.oldestPendingAt ? s.now.getTime() - s.outbox.oldestPendingAt.getTime() : 0;

  if (live.length === 0) {
    const lastBeat = s.workers.reduce<Date | null>((m, w) => (!m || w.lastBeatAt > m ? w.lastBeatAt : m), null);
    out.push({
      key: 'worker.down',
      source: 'worker',
      severity: s.outbox.pending > 0 || lastBeat ? 'CRITICAL' : 'WARNING',
      title: 'No worker is running',
      detail: lastBeat ? `Last heartbeat ${minutes(s.now.getTime() - lastBeat.getTime())} min ago. Notifications, emails and scheduled jobs are not being processed.` : 'No worker has reported in. Notifications, emails and scheduled jobs are not being processed.',
    });
  }

  if (s.outbox.pending > 0 && (oldestAge > BACKLOG_WARN_MS || s.outbox.pending >= BACKLOG_CRIT_COUNT)) {
    out.push({
      key: 'outbox.backlog',
      source: 'outbox',
      severity: oldestAge > BACKLOG_CRIT_MS || s.outbox.pending >= BACKLOG_CRIT_COUNT ? 'CRITICAL' : 'WARNING',
      title: 'Outbox backlog',
      detail: `${s.outbox.pending} event${s.outbox.pending === 1 ? '' : 's'} waiting; the oldest has waited ${minutes(oldestAge)} min.`,
    });
  }

  if (s.outbox.dead > 0) {
    out.push({
      key: 'outbox.dead',
      source: 'outbox',
      severity: 'CRITICAL',
      title: 'Outbox dead letters',
      detail: `${s.outbox.dead} event${s.outbox.dead === 1 ? '' : 's'} failed every retry and need operator action (retry or discard).`,
    });
  }

  for (const j of s.jobs) {
    if (!j.lastRunAt) continue;
    const overdue = s.now.getTime() - j.lockedUntil.getTime();
    if (overdue > JOB_OVERDUE_MS) {
      out.push({
        key: `job.stale:${j.name}`.slice(0, 100),
        source: 'job',
        severity: 'WARNING',
        title: `Scheduled job ${j.name} is overdue`,
        detail: `Last ran ${j.lastRunAt.toISOString()}; its next run is ${minutes(overdue)} min late.`,
      });
    }
  }
  return out;
}

export type AlertAction = 'open' | 'update' | 'resolve' | 'none';

/** What to do with the stored alert for a key, given whether the condition holds now. */
export function alertAction(existing: { status: string } | null, active: boolean): AlertAction {
  if (active) return !existing || existing.status === 'RESOLVED' ? 'open' : 'update';
  return existing && existing.status !== 'RESOLVED' ? 'resolve' : 'none';
}
