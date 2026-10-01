import { Router } from 'express';
import type { LpNotificationItem, LpRealtimeInfo, LpSession, LpSessionFund } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { lp, requireLp, type LpContext } from '../lp.context';
import { dec, day, lpOk } from '../lp.http';
import { fundScopeWhere } from '../services/common';
import { visibleNoticeWhere } from '../services/notices';

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

lpSessionRoutes.get('/session', async (req, res) => {
  lpOk(req, res, await buildSession(lp(req)));
});
/** No push transport yet: the portal polls (decision noted in the WS1 report). */
lpSessionRoutes.get('/realtime', (req, res) => {
  const info: LpRealtimeInfo = { enabled: false, pollingIntervalMs: 30000, events: [] };
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
    createdAt: n.createdAt.toISOString(),
    type: n.type,
    read: !!n.readAt,
  }));
  lpOk(req, res, { items });
});
