import { prisma } from '../../lib/prisma';
import { setting } from '../../lib/settings';
import { enqueue } from '../../lib/outbox';
import type { AuditContext } from '../../lib/audit';
import { executeRuleAs } from './data.routes';

/**
 * Scheduled data-quality runs and exception escalation (worker, every few minutes). A rule with an enabled
 * `dq_schedules` row runs when `next_run_at` has passed, as the rule's creator under a System audit context. A run
 * that fails announces itself to the `data.manage` holders. Open exceptions are escalated when they are past their
 * due date, or unowned beyond `notify.dq_escalation_hours`; each further window raises the level (maximum 3).
 * Both parts are switched by the feature flag `feature.dq_scheduler`.
 */
export const DQ_CADENCES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type DqCadence = (typeof DQ_CADENCES)[number];

const SYSTEM: AuditContext = { actorId: null, actorRole: 'System', portal: null };
const HOUR = 3_600_000;

/** Next run time after `from` for a cadence (UTC; daily and longer cadences keep the time of day of `from`). */
export function nextDqRun(cadence: string, from: Date): Date {
  const d = new Date(from.getTime());
  switch (cadence) {
    case 'HOURLY':
      return new Date(d.getTime() + HOUR);
    case 'DAILY':
      return new Date(d.getTime() + 24 * HOUR);
    case 'WEEKLY':
      return new Date(d.getTime() + 7 * 24 * HOUR);
    case 'MONTHLY': {
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
      return d;
    }
    default:
      throw new Error(`Unknown cadence ${cadence}`);
  }
}

/** Runs every due schedule. `runBy` runs them as that person (the Run-due button) instead of the rule's creator. */
export async function runDueSchedules(opts: { runBy?: { userId: string; ctx: AuditContext }; now?: Date } = {}): Promise<{ ran: number; failed: number }> {
  const now = opts.now ?? new Date();
  const due = await prisma.dqSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 50 });
  let ran = 0;
  let failed = 0;
  for (const s of due) {
    const rule = await prisma.dataQualityRule.findUnique({ where: { id: s.ruleId } });
    // Claim the slot first so two workers never run the same rule for the same slot.
    const claimed = await prisma.dqSchedule.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt }, data: { nextRunAt: nextDqRun(s.cadence, now) } });
    if (claimed.count !== 1) continue;
    if (!rule || !rule.active) continue;
    const run = await executeRuleAs(opts.runBy ?? { userId: rule.createdBy, ctx: SYSTEM }, rule);
    ran++;
    await prisma.dqSchedule.update({ where: { id: s.id }, data: { lastRunAt: now, lastRunRef: run.ref, lastStatus: run.status } });
    if (run.status !== 'PASS') {
      failed++;
      await prisma.$transaction((tx) =>
        enqueue(tx, 'notify.permission', {
          permission: 'data.manage',
          type: 'data.quality',
          title: `Data-quality rule ${rule.key} ${run.status === 'FAIL' ? 'failed' : 'errored'} (${run.ref})`,
          body: run.summary ?? undefined,
          link: '/ops/data',
          email: rule.severity === 'HIGH',
        }),
      );
    }
  }
  return { ran, failed };
}

/** Escalates open exceptions that are overdue or unowned for too long. Returns how many were escalated. */
export async function escalateExceptions(now = new Date()): Promise<number> {
  const hours = await setting<number>('notify.dq_escalation_hours');
  const windowMs = hours * HOUR;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const open = await prisma.dataQualityException.findMany({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { id: true, ruleId: true, recordKey: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 2000 });
  if (!open.length) return 0;
  const work = new Map((await prisma.dqExceptionWork.findMany({ where: { exceptionId: { in: open.map((e) => e.id) } } })).map((w) => [w.exceptionId, w]));
  const rules = new Map((await prisma.dataQualityRule.findMany({ where: { id: { in: [...new Set(open.map((e) => e.ruleId))] } }, select: { id: true, key: true, severity: true } })).map((r) => [r.id, r]));
  let n = 0;
  for (const e of open) {
    const w = work.get(e.id);
    const level = w?.escalationLevel ?? 0;
    if (level >= 3) continue;
    const overdue = !!w?.dueOn && w.dueOn.getTime() < today.getTime();
    const staleUnowned = !w?.ownerId && !w?.dueOn && now.getTime() - e.createdAt.getTime() > windowMs;
    if (!overdue && !staleUnowned) continue;
    if (w?.escalatedAt && now.getTime() - w.escalatedAt.getTime() < windowMs) continue; // one raise per window
    const rule = rules.get(e.ruleId);
    const why = overdue ? `past its due date (${w!.dueOn!.toISOString().slice(0, 10)})` : `unowned for more than ${hours} hours`;
    await prisma.$transaction(async (tx) => {
      if (w) await tx.dqExceptionWork.update({ where: { id: w.id }, data: { escalationLevel: level + 1, escalatedAt: now } });
      else await tx.dqExceptionWork.create({ data: { exceptionId: e.id, escalationLevel: 1, escalatedAt: now, assignedBy: SYSTEM_USER_PLACEHOLDER } });
      const title = `Data-quality exception escalated (level ${level + 1}): ${rule?.key ?? ''} ${e.recordKey}`;
      await enqueue(tx, 'notify.permission', { permission: 'data.manage', type: 'data.quality', title, body: `The exception is ${why}.`, link: '/ops/data', email: level + 1 >= 2 || rule?.severity === 'HIGH' });
      if (w?.ownerId) await enqueue(tx, 'notify.users', { userIds: [w.ownerId], type: 'data.quality', title, body: `The exception is ${why}.`, link: '/ops/data', email: true });
    });
    n++;
  }
  return n;
}

/** Placeholder written to `assigned_by` for rows the system itself creates on escalation. */
export const SYSTEM_USER_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

/** Worker entry. */
export async function dqTick(): Promise<number> {
  if (!(await setting<boolean>('feature.dq_scheduler'))) return 0;
  const r = await runDueSchedules();
  const e = await escalateExceptions();
  return r.ran + e;
}
