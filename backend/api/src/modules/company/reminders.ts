import { prisma } from '../../lib/prisma';
import { enqueue } from '../../lib/outbox';

/** BR-255: one in-app and email reminder at each of these offsets before the due date. */
export const REMINDER_DAYS = [14, 7, 3, 1] as const;

function utcDay(d: Date) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function daysUntilDue(now: Date, due: Date) {
  return Math.round((utcDay(due) - utcDay(now)) / 86_400_000);
}

/**
 * Notifies each active company user when an open or returned pack is 14, 7, 3 or 1 day from due.
 * A setting row per period and offset makes a second scan a no-op.
 */
export async function scanReportingReminders(now = new Date()): Promise<number> {
  const periods = await prisma.reportingPeriod.findMany({
    where: { status: { in: ['open', 'returned'] } },
    include: { company: { select: { name: true } } },
  });
  let sent = 0;
  for (const period of periods) {
    const days = daysUntilDue(now, period.dueDate);
    if (!REMINDER_DAYS.includes(days as (typeof REMINDER_DAYS)[number])) continue;
    const key = `reporting.reminder.${days}`;
    const already = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: period.id, key } } });
    if (already) continue;
    const users = await prisma.companyUser.findMany({
      where: { companyId: period.companyId, status: 'active' },
      select: { userId: true },
    });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.setting.create({
          data: { ownerId: period.id, key, value: { sentAt: now.toISOString(), days } },
        });
        if (!users.length) return;
        const due = period.dueDate.toISOString().slice(0, 10);
        await enqueue(tx, 'notify.users', {
          userIds: users.map((u) => u.userId),
          type: 'reporting.reminder',
          title: `Reporting due in ${days} day${days === 1 ? '' : 's'}`,
          body: `${period.company.name} · ${period.label} is due on ${due}.`,
          link: '/reports',
          email: true,
        });
      });
      sent += 1;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2002') throw error;
    }
  }
  return sent;
}
