import { config } from './config';
import { prisma } from './lib/prisma';
import { sendMail } from './lib/mailer';
import type { EmailPayload, NotifyPermissionPayload, NotifyUsersPayload } from './lib/outbox';
import { runScreening } from './modules/kyc/screening';
import { scanReportingReminders } from './modules/company/reminders';
import { runDueSchedules } from './modules/reports';

/**
 * Outbox worker (SRD 10.2 "worker/scheduler"). Polls `outbox_events`, runs the
 * handler for each event and marks it published. Failed events are retried with
 * back-off up to MAX_ATTEMPTS, then left with `last_error` for operations.
 */
const POLL_MS = 2000;
const BATCH = 25;
const MAX_ATTEMPTS = 8;

async function notifyUsers(p: NotifyUsersPayload) {
  if (!p.userIds.length) return;
  const users = await prisma.user.findMany({
    where: { id: { in: p.userIds }, isActive: true },
    select: { id: true, email: true },
  });
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: p.type, title: p.title, body: p.body ?? null, link: p.link ?? null })),
  });
  if (p.email) {
    for (const u of users) {
      await sendMail(u.email, p.title, `${p.body ?? p.title}${p.link ? `\n\n${p.link}` : ''}`);
    }
  }
}

async function notifyPermission(p: NotifyPermissionPayload) {
  const users = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: p.permission } } } } } },
    select: { id: true },
  });
  await notifyUsers({ ...p, userIds: users.map((u) => u.id) });
}

const handlers: Record<string, (payload: unknown) => Promise<void>> = {
  'notify.users': (p) => notifyUsers(p as NotifyUsersPayload),
  'notify.permission': (p) => notifyPermission(p as NotifyPermissionPayload),
  'email.send': async (p) => {
    const e = p as EmailPayload;
    await sendMail(e.to, e.subject, e.text);
  },
  'kyc.screening.requested': (p) => runScreening((p as { caseId: string }).caseId),
};

let lastReminderScan = 0;
let lastReportScan = 0;

async function tick() {
  if (Date.now() - lastReportScan > 60 * 60 * 1000) {
    lastReportScan = Date.now();
    try {
      const ran = await runDueSchedules();
      if (ran) console.log(`[worker] scheduled reports generated: ${ran}`);
    } catch (error) {
      console.error('[worker] scheduled report run failed', error);
      lastReportScan = 0;
    }
  }
  if (Date.now() - lastReminderScan > 60 * 60 * 1000) {
    lastReminderScan = Date.now();
    try {
      const sent = await scanReportingReminders();
      if (sent) console.log(`[worker] reporting reminders queued: ${sent}`);
    } catch (error) {
      console.error('[worker] reporting reminder scan failed', error);
      lastReminderScan = 0;
    }
  }
  const events = await prisma.outboxEvent.findMany({
    where: { publishedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { id: 'asc' },
    take: BATCH,
  });
  for (const event of events) {
    // Exponential back-off: skip until 2^attempts seconds after creation have passed.
    if (event.attempts > 0 && Date.now() - event.createdAt.getTime() < 2 ** event.attempts * 1000) continue;
    const handler = handlers[event.type];
    try {
      if (!handler) throw new Error(`No handler for ${event.type}`);
      await handler(event.payload);
      await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[worker] event ${event.id} (${event.type}) failed: ${message}`);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError: message.slice(0, 2000) },
      });
    }
  }
  return events.length;
}

let stopping = false;

async function main() {
  console.log(`[worker] Matanho Nexus worker started (${config.nodeEnv}); SMTP ${config.smtp ? 'on' : 'console'}`);
  while (!stopping) {
    let handled = 0;
    try {
      handled = await tick();
    } catch (error) {
      console.error('[worker] poll failed', error);
    }
    if (handled < BATCH) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await prisma.$disconnect();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, stopping`);
    stopping = true;
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

void main();
