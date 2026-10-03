import { prisma } from '../../lib/prisma';
import { enqueue } from '../../lib/outbox';
import { setting } from '../../lib/settings';
import { acquireJob, finishJob, releaseJob } from '../../lib/jobs';

const HARARE_OFFSET_MS = 2 * 3_600_000;
const harare = (d = new Date()) => new Date(d.getTime() + HARARE_OFFSET_MS);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Sends the daily (and, on Mondays, weekly) digest emails: one email per user per period. The (user, period) primary
 * key in `notification_digest_logs` is claimed in the same transaction that queues the email, so a restarted or second
 * worker can never send a user two digests. Runs once the Harare hour reaches the `notify.digest_hour` setting.
 */
export async function runDigests(now = new Date()): Promise<number> {
  if (!(await setting<boolean>('notify.email_enabled'))) return 0;
  const hour = await setting<number>('notify.digest_hour');
  const local = harare(now);
  if (local.getUTCHours() < hour) return 0;
  if (!(await acquireJob('notify.digest', 5 * 60_000))) return 0;
  try {
    let sent = 0;
    const kinds: { status: 'DIGEST_DAILY' | 'DIGEST_WEEKLY'; period: string; label: string }[] = [{ status: 'DIGEST_DAILY', period: ymd(local), label: 'daily' }];
    if (local.getUTCDay() === 1) kinds.push({ status: 'DIGEST_WEEKLY', period: isoWeek(local), label: 'weekly' });
    for (const kind of kinds) {
      const users = await prisma.notification.findMany({ where: { emailStatus: kind.status }, distinct: ['userId'], select: { userId: true } });
      for (const { userId } of users) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isActive: true, name: true } });
        const items = await prisma.notification.findMany({ where: { userId, emailStatus: kind.status }, orderBy: { createdAt: 'asc' }, take: 200 });
        if (!items.length) continue;
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.notificationDigestLog.createMany({ data: [{ userId, period: kind.period, itemCount: items.length }], skipDuplicates: true });
          if (claimed.count === 0) {
            // A digest for this period already went out; fold these late items into the next period.
            return;
          }
          if (user?.isActive) {
            const lines = items.map((n) => `- ${n.title}${n.body ? `: ${n.body}` : ''}`);
            await enqueue(tx, 'email.send', {
              to: user.email,
              subject: `Matanho Nexus ${kind.label} digest: ${items.length} notification${items.length === 1 ? '' : 's'}`,
              text: `Hello${user.name ? ` ${user.name}` : ''},\n\nYour ${kind.label} summary:\n\n${lines.join('\n')}\n\nOpen the console to act on these. You can change how often you hear from us in your notification settings.`,
            });
          }
          await tx.notification.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { emailStatus: 'DIGESTED' } });
          sent += 1;
        });
      }
    }
    await finishJob('notify.digest', { sent, period: ymd(local) }, 10 * 60_000);
    return sent;
  } catch (error) {
    await releaseJob('notify.digest');
    throw error;
  }
}
