import type { Prisma } from '@prisma/client';
import { config } from './config';
import { prisma } from './lib/prisma';
import { sendMail } from './lib/mailer';
import { enqueue } from './lib/outbox';
import { claimEvents } from './lib/outboxClaim';
import { INSTANCE_ID, acquireJob, finishJob, releaseJob } from './lib/jobs';
import { routeNotifications } from './modules/notifications/delivery';
import { runDigests } from './modules/notifications/digest';
import { runScheduledPurge } from './modules/admin-core/retention';
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
  if (!users.length) return;
  // Preferences, digest choice and platform switches decide the channel per recipient (GAP-008).
  const routes = await routeNotifications(
    users.map((u) => u.id),
    p.type,
    !!p.email,
  );
  await prisma.$transaction(async (tx) => {
    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const u of users) {
      const r = routes.get(u.id)!;
      const emailStatus = r.email === 'now' ? 'SENT' : r.email === 'daily' ? 'DIGEST_DAILY' : r.email === 'weekly' ? 'DIGEST_WEEKLY' : p.email ? 'SUPPRESSED' : null;
      const digested = r.email === 'daily' || r.email === 'weekly';
      // A digested item whose bell is muted is stored already-read so it is available to the digest but never shows as unread.
      if (r.inApp || digested) {
        rows.push({ userId: u.id, type: p.type, title: p.title, body: p.body ?? null, link: p.link ?? null, emailStatus, readAt: r.inApp ? null : new Date() });
      }
      if (r.email === 'now') {
        // Email goes through its own outbox event so a mail failure retries the email, not the notification.
        await enqueue(tx, 'email.send', { to: u.email, subject: p.title, text: `${p.body ?? p.title}${p.link ? `

${p.link}` : ''}` });
      }
    }
    if (rows.length) await tx.notification.createMany({ data: rows });
  });
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

const HOUR = 60 * 60 * 1000;
/** Runs a scheduled job at most once per `everyMs` across every worker (job_locks row is the lease). */
async function scheduled(name: string, everyMs: number, run: () => Promise<number | void>) {
  if (!(await acquireJob(name, 5 * 60_000))) return;
  try {
    const n = await run();
    await finishJob(name, { handled: n ?? 0 }, everyMs);
    if (n) console.log(`[worker] ${name}: ${n}`);
  } catch (error) {
    console.error(`[worker] ${name} failed`, error);
    await releaseJob(name);
  }
}

async function tick() {
  await scheduled('reports.schedules', HOUR, () => runDueSchedules());
  await scheduled('company.reminders', HOUR, () => scanReportingReminders());
  try {
    const purged = await runScheduledPurge(); // self-locking: once per day across workers
    if (purged) console.log(`[worker] retention purge: ${JSON.stringify(purged)}`);
  } catch (error) {
    console.error('[worker] retention purge failed', error);
  }
  try {
    const sent = await runDigests();
    if (sent) console.log(`[worker] digests queued: ${sent}`);
  } catch (error) {
    console.error('[worker] digest run failed', error);
  }
  const events = await claimEvents(INSTANCE_ID, BATCH);
  for (const event of events) {
    const handler = handlers[event.type];
    try {
      if (!handler) throw new Error(`No handler for ${event.type}`);
      await handler(event.payload);
      await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date(), claimedBy: null, claimedAt: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[worker] event ${event.id} (${event.type}) failed: ${message}`);
      // Exponential back-off: the next claim is 2^attempts seconds away.
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError: message.slice(0, 2000), claimedBy: null, claimedAt: null, nextAttemptAt: new Date(Date.now() + 2 ** (event.attempts + 1) * 1000) },
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
  // Hand back any claim this instance still holds so another worker can take the events at once.
  await prisma.outboxEvent.updateMany({ where: { publishedAt: null, claimedBy: INSTANCE_ID }, data: { claimedBy: null, claimedAt: null } }).catch(() => undefined);
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
