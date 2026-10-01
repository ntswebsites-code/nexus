import { Router } from 'express';
import type { LpSession, LpSessionFund } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { lp, type LpContext } from '../lp.context';
import { dec, day, lpOk, lpStubItems, lpStubNotLive } from '../lp.http';

/** Published, unexpired notices addressed to this member (ALL, their funds, their client, or them). */
export function visibleNoticeWhere(ctx: LpContext) {
  const now = new Date();
  return {
    status: 'PUBLISHED',
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    AND: [
      {
        OR: [
          { targetType: 'ALL' },
          { targetType: 'FUND', fundId: { in: ctx.fundIds } },
          { targetType: 'ORG', clientId: ctx.client.id },
          { targetType: 'USER', userId: ctx.userId },
        ],
      },
    ],
  };
}

async function unreadCounts(ctx: LpContext): Promise<LpSession['unreadCounts']> {
  const [requests, threads, notices, notifications] = await Promise.all([
    prisma.serviceRequest.count({
      where: { clientId: ctx.client.id, OR: [{ lpStatus: 'AWAITING_INVESTOR' }, { lpStatus: null, status: 'Waiting on you' }] },
    }),
    prisma.messageThread.findMany({
      where: { clientId: ctx.client.id },
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
lpSessionRoutes.get('/realtime', lpStubNotLive);
lpSessionRoutes.get('/notifications', lpStubItems);
