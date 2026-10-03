import { Router } from 'express';
import type { LpNotificationItem, LpRealtimeInfo, LpSession, LpSessionFund } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { lp, requireLp, type LpContext } from '../lp.context';
import { dec, day, lpOk } from '../lp.http';
import { fundScopeWhere } from '../services/common';
import { visibleNoticeWhere } from '../services/notices';
import { applyPendingColleagueScope } from '../services/organisation';

export { visibleNoticeWhere };

async function unreadCounts(ctx: LpContext): Promise<LpSession['unreadCounts']> {
  const [requests, threads, notices, notifications] = await Promise.all([
    prisma.serviceRequest.count({
      where: { clientId: ctx.client.id, status: 'Waiting on you', ...fundScopeWhere(ctx) },
    }),
    prisma.messageThread.findMany({
      where: { clientId: ctx.client.id, ...fundScopeWhere(ctx) },
      select: {
        reads: { where: { userId: ctx.userId }, select: { readAt: true } },
        messages: { where: { fromClient: false }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    }),
    prisma.lpNotice.count({
      where: { ...visibleNoticeWhere(ctx), receipts: { none: { userId: ctx.userId, openedAt: { not: null } } } },
    }),
    prisma.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ]);
  const messages = threads.filter((t) => {
    const last = t.messages[0]?.createdAt;
    const read = t.reads[0]?.readAt;
    return last && (!read || last > read);
  }).length;
  return { requests, messages, notices, notifications };
}

export async function buildSession(ctx: LpContext): Promise<LpSession> {
  const commitments = await prisma.fundCommitment.findMany({
    where: { clientId: ctx.client.id, fundId: { in: ctx.fundIds } },
    include: { fund: true },
    orderBy: { fund: { name: 'asc' } },
  });
  const funds: LpSessionFund[] = commitments.map(({ fund, ...c }) => ({
    fundId: fund.id,
    publicReference: fund.publicReference ?? fund.ref,
    fundName: fund.name,
    shortName: fund.shortName,
    operatingModel: fund.operatingModel === 'OPEN_ENDED' ? 'OPEN_ENDED' : 'PRIVATE_CAPITAL',
    currencyCode: fund.currency,
    shareClass: fund.defaultShareClass,
    asOfDate: day(fund.asOfDate),
    valuationStatus: fund.valuationStatus,
    investorAccountReference: c.investorAccountRef ?? ctx.client.ref,
    commitmentAmount: dec(c.commitmentAmount),
  }));
  const latest = funds.map((f) => f.asOfDate).filter(Boolean).sort().at(-1) ?? '';
  return {
    client: {
      id: ctx.client.id,
      legalName: ctx.client.name,
      email: ctx.client.email ?? '',
      investorId: ctx.client.ref,
      displayName: ctx.client.name,
    },
    lpRole: ctx.lpRole,
    presentationCurrency: ctx.client.baseCurrency,
    defaultAsOfDate: latest,
    defaultValuationStatus: funds.find((f) => f.asOfDate === latest)?.valuationStatus ?? 'FINAL',
    funds,
    unreadCounts: await unreadCounts(ctx),
  };
}

/** Domain `session` (+ realtime and notifications). */
export const lpSessionRoutes = Router();

/** Mounted first among the LP sub-routers, so it runs before every LP handler. */
lpSessionRoutes.use(applyPendingColleagueScope);

lpSessionRoutes.get('/session', async (req, res) => {
  lpOk(req, res, await buildSession(lp(req)));
});
/**
 * Polling contract that stands in for push (GAP-017). `GET /realtime?since=<cursor>` returns the change events
 * derived from this user's notifications created after the cursor, plus the next cursor and the interval to wait.
 * The first call (no cursor) returns no changes and a starting cursor. A cursor older than a day is treated as a
 * first call (the screens reload their data on start anyway).
 */
const REALTIME_EVENTS = ['lp_notification', 'lp_notice_updated', 'lp_request_created', 'lp_request_updated', 'lp_request_message', 'lp_thread_message'];
const REALTIME_MAX_AGE_MS = 24 * 3_600_000;

export function realtimeEventsFor(type: string): string[] {
  const out = ['lp_notification'];
  if (type.startsWith('notice')) out.push('lp_notice_updated');
  if (type === 'service_request.created') out.push('lp_request_created');
  else if (type.startsWith('service_request')) out.push('lp_request_updated');
  if (type.startsWith('message')) out.push('lp_thread_message', 'lp_request_message');
  return out;
}

lpSessionRoutes.get('/realtime', async (req, res) => {
  const ctx = lp(req);
  const now = new Date();
  const raw = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
  const since = raw && !Number.isNaN(raw.getTime()) && raw.getTime() > now.getTime() - REALTIME_MAX_AGE_MS && raw.getTime() <= now.getTime() + 60_000 ? raw : null;
  const rows = since ? await prisma.notification.findMany({ where: { userId: ctx.userId, createdAt: { gt: since } }, orderBy: { createdAt: 'asc' }, take: 100 }) : [];
  const changes = rows.flatMap((n) =>
    realtimeEventsFor(n.type).map((event) => ({ id: `${n.id}:${event}`, event, at: n.createdAt.toISOString(), payload: { notificationId: n.id, type: n.type, link: n.link } })),
  );
  const cursor = (rows.length ? rows[rows.length - 1]!.createdAt : (since ?? now)).toISOString();
  const info: LpRealtimeInfo = { enabled: true, transport: 'polling', pollingIntervalMs: 15000, events: REALTIME_EVENTS, cursor, changes };
  lpOk(req, res, info);
});

function notificationHref(type: string, link: string | null): string {
  if (link?.startsWith('/lp-portal/')) return link;
  if (type.startsWith('notice')) return '/lp-portal/notices';
  if (type.startsWith('distribution')) return '/lp-portal/capital-activity?tab=distributions';
  if (type.startsWith('capital')) return '/lp-portal/capital-activity?tab=calls';
  if (type.startsWith('service_request') || type.startsWith('message')) return '/lp-portal/requests';
  if (type.startsWith('document')) return '/lp-portal/documents';
  if (type.startsWith('dealing')) return '/lp-portal/dealing';
  return '/lp-portal/dashboard';
}

lpSessionRoutes.get('/notifications', requireLp('lp.portal.view_notifications'), async (req, res) => {
  const ctx = lp(req);
  const raw = Number.parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Math.min(50, Math.max(1, Number.isNaN(raw) ? 10 : raw));
  const rows = await prisma.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: 'desc' }, take: limit });
  const items: LpNotificationItem[] = rows.map((n) => ({
    id: n.id,
    title: n.title,
    href: notificationHref(n.type, n.link),
    // Seed stores `fund:<name>` in body; real notices without that prefix have no fund label.
    fundName: n.body?.startsWith('fund:') ? n.body.slice(5) : '',
    createdAt: n.createdAt.toISOString(),
    type: n.type,
    read: !!n.readAt,
  }));
  lpOk(req, res, { items });
});
