import { prisma } from '../../lib/prisma';
import { setting } from '../../lib/settings';
import { acquireJob, finishJob, releaseJob } from '../../lib/jobs';

/**
 * Scheduled retention purge (SRD 7.13). Reads the admin-core retention settings and removes only operational
 * residue that is safe to delete. Never touches `audit_events` (append-only hash chain) or client documents: audit
 * retention is reported as a floor date, and documents past their retention window are listed as eligible for a
 * human-approved disposal rather than deleted.
 */
export interface PurgeResult {
  dryRun: boolean;
  sessionsDeleted: number;
  passwordResetsDeleted: number;
  invitationsDeleted: number;
  idempotencyKeysDeleted: number;
  outboxEventsDeleted: number;
  notificationsDeleted: number;
  digestLogsDeleted: number;
  auditRetentionYears: number;
  auditFloor: string;
  documentsEligibleForDisposal: number;
  dqExceptionsDeleted: number;
  /** Periods applied (settings read at run time). */
  applied: { sessionDays: number; notificationDays: number; outboxDays: number; idempotencyDays: number; dqExceptionDays: number };
}

const day = 86_400_000;

/** Closed (resolved or waived) data-quality exceptions past the retention window, with their work rows. */
async function purgeDqExceptions(cut: Date, dryRun: boolean): Promise<number> {
  const where = { status: { in: ['RESOLVED', 'WAIVED', 'SUPERSEDED'] }, createdAt: { lt: cut }, OR: [{ resolvedAt: null }, { resolvedAt: { lt: cut } }] };
  if (dryRun) return prisma.dataQualityException.count({ where });
  const ids = (await prisma.dataQualityException.findMany({ where, select: { id: true }, take: 5000 })).map((e) => e.id);
  if (!ids.length) return 0;
  await prisma.dqExceptionWork.deleteMany({ where: { exceptionId: { in: ids } } });
  return (await prisma.dataQualityException.deleteMany({ where: { id: { in: ids } } })).count;
}

export async function runRetentionPurge(opts: { dryRun?: boolean; triggeredBy?: string } = {}): Promise<PurgeResult> {
  const dryRun = !!opts.dryRun;
  const [sessionDays, docYears, auditYears, notificationDays, outboxDays, idempotencyDays, dqExceptionDays] = await Promise.all([
    setting<number>('retention.session_days'),
    setting<number>('retention.documents_years'),
    setting<number>('retention.audit_years'),
    setting<number>('retention.notifications_days'),
    setting<number>('retention.outbox_days'),
    setting<number>('retention.idempotency_days'),
    setting<number>('retention.dq_exceptions_days'),
  ]);
  const run = await prisma.purgeRun.create({ data: { dryRun, triggeredBy: opts.triggeredBy ?? 'worker' } });
  const now = Date.now();
  const sessionCut = new Date(now - sessionDays * day);
  const monthAgo = new Date(now - 30 * day);
  const outboxCut = new Date(now - outboxDays * day);
  const idemCut = new Date(now - idempotencyDays * day);
  const noticeCut = new Date(now - notificationDays * day);
  const dqCut = new Date(now - dqExceptionDays * day);
  const docCut = new Date(now - docYears * 365 * day);

  const count = async <T>(del: () => Promise<{ count: number }>, cnt: () => Promise<number>): Promise<number> => (dryRun ? cnt() : (await del()).count);

  const result: PurgeResult = {
    dryRun,
    sessionsDeleted: await count(
      () => prisma.session.deleteMany({ where: { expiresAt: { lt: sessionCut } } }),
      () => prisma.session.count({ where: { expiresAt: { lt: sessionCut } } }),
    ),
    passwordResetsDeleted: await count(
      () => prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: monthAgo } } }),
      () => prisma.passwordReset.count({ where: { expiresAt: { lt: monthAgo } } }),
    ),
    invitationsDeleted: await count(
      () => prisma.invitation.deleteMany({ where: { expiresAt: { lt: sessionCut }, acceptedAt: null } }),
      () => prisma.invitation.count({ where: { expiresAt: { lt: sessionCut }, acceptedAt: null } }),
    ),
    idempotencyKeysDeleted: await count(
      () => prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: idemCut } } }),
      () => prisma.idempotencyKey.count({ where: { expiresAt: { lt: idemCut } } }),
    ),
    outboxEventsDeleted: await count(
      () => prisma.outboxEvent.deleteMany({ where: { publishedAt: { lt: outboxCut } } }),
      () => prisma.outboxEvent.count({ where: { publishedAt: { lt: outboxCut } } }),
    ),
    notificationsDeleted: await count(
      () => prisma.notification.deleteMany({ where: { readAt: { lt: noticeCut } } }),
      () => prisma.notification.count({ where: { readAt: { lt: noticeCut } } }),
    ),
    digestLogsDeleted: await count(
      () => prisma.notificationDigestLog.deleteMany({ where: { sentAt: { lt: noticeCut } } }),
      () => prisma.notificationDigestLog.count({ where: { sentAt: { lt: noticeCut } } }),
    ),
    dqExceptionsDeleted: await purgeDqExceptions(dqCut, dryRun),
    applied: { sessionDays, notificationDays, outboxDays, idempotencyDays, dqExceptionDays },
    auditRetentionYears: auditYears,
    auditFloor: new Date(now - auditYears * 365 * day).toISOString().slice(0, 10),
    documentsEligibleForDisposal: await prisma.document.count({ where: { status: 'Superseded', updatedAt: { lt: docCut } } }),
  };
  await prisma.purgeRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), result: result as never } });
  return result;
}

/** Worker entry: at most one execution per 24 hours across all workers. */
export async function runScheduledPurge(): Promise<PurgeResult | null> {
  if (!(await acquireJob('retention.purge', 10 * 60_000))) return null;
  try {
    const r = await runRetentionPurge();
    await finishJob('retention.purge', r, day);
    return r;
  } catch (error) {
    await releaseJob('retention.purge');
    throw error;
  }
}
