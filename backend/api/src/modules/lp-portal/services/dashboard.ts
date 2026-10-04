import { Prisma } from '@prisma/client';
import type { LpDashboardAction, LpDashboardData, LpRecentActivity } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { day } from '../lp.http';
import { assertFund, type LpContext } from '../lp.context';
import { VISIBLE_CALL_STATUSES, VISIBLE_DISTRIBUTION_STATUSES, callStatus, fundNames, fundScopeWhere } from './common';
import { lpDocWhere } from './documents';
import { visibleNoticeWhere } from './notices';
import { presentPositions } from './fx';
import { consolidate, fixed, latestAsOf, loadPositions, navHistory, portfolioCompanyCount } from './positions';

const ZERO = new Prisma.Decimal(0);
const maxZero = (v: Prisma.Decimal) => (v.lt(0) ? ZERO : v);

export async function getDashboard(ctx: LpContext, fundId?: string): Promise<LpDashboardData> {
  assertFund(ctx, fundId);
  const raw = await loadPositions(ctx, fundId);
  const { positions, fx, rates } = await presentPositions(ctx, raw);
  const c = consolidate(positions);
  const { asOfDate, valuationStatus } = latestAsOf(positions);
  const pcFunds = positions.filter((p) => !p.isOpenEnded).map((p) => p.fund.id);
  const oe = positions.find((p) => p.isOpenEnded && p.holding);
  const data: LpDashboardData = {
    asOfDate,
    valuationStatus,
    presentationCurrency: fx.presentationCurrency,
    reportingCurrency: fx.reportingCurrency,
    fx,
    kpis: {
      totalCommitment: fixed(c.committed),
      paidIn: fixed(c.paidIn),
      called: fixed(c.called),
      outstandingCalled: fixed(maxZero(c.called.sub(c.paidIn))),
      unfunded: fixed(maxZero(c.committed.sub(c.called))),
      currentNav: fixed(c.nav),
      distributions: fixed(c.distributions),
      netIrr: c.netIrr as string,
      tvpi: c.tvpi ?? '0.0000',
      dpi: c.dpi ?? '0.0000',
      rvpi: c.rvpi ?? '0.0000',
      investmentCount: positions.length,
      portfolioCompanyCount: await portfolioCompanyCount(pcFunds),
    },
    openEndedSummary: oe?.holding
      ? {
          accountValue: fixed(oe.holding.accountValue),
          unitsHeld: oe.holding.units.toFixed(6),
          navPerUnit: oe.holding.navPerUnit.toFixed(8),
          ytdReturn: oe.ytdReturn as string,
        }
      : null,
    openEndedHistory: {
      points: oe ? navHistory(oe.fund).map((pt) => ({ ...pt, navPerUnit: new Prisma.Decimal(pt.navPerUnit).mul(rates.get(oe.fund.id) ?? 1).toFixed(8) })) : [],
    },
  };
  return data;
}

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export async function getActions(ctx: LpContext): Promise<LpDashboardAction[]> {
  const [allocs, notices, dealing, signatures, awaiting] = await Promise.all([
    prisma.capitalCallAllocation.findMany({
      where: { clientId: ctx.client.id, call: { fundId: { in: ctx.fundIds }, status: { in: VISIBLE_CALL_STATUSES }, issuedAt: { not: null } } },
      include: { call: true },
      orderBy: { call: { dueDate: 'asc' } },
      take: 50,
    }),
    prisma.lpNotice.findMany({
      where: { AND: [visibleNoticeWhere(ctx), { requiresAcknowledgement: true }, { receipts: { none: { userId: ctx.userId, acknowledgedAt: { not: null } } } }] },
      orderBy: { publishedAt: 'desc' },
      take: 30,
    }),
    prisma.lpDealingRequest.findMany({
      where: { clientId: ctx.client.id, fundId: { in: ctx.fundIds }, status: 'AWAITING_FUNDS' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.signatureRequest.findMany({
      where: { clientId: ctx.client.id, status: 'Pending', document: lpDocWhere(ctx) },
      include: { document: { select: { id: true, name: true, fundId: true } } },
      take: 20,
    }),
    prisma.serviceRequest.findMany({
      where: { clientId: ctx.client.id, status: 'Waiting on you', ...fundScopeWhere(ctx) },
      take: 20,
    }),
  ]);
  const names = await fundNames([
    ...allocs.map((a) => a.call.fundId),
    ...notices.map((n) => n.fundId),
    ...dealing.map((d) => d.fundId),
    ...signatures.map((s) => s.document.fundId),
    ...awaiting.map((r) => r.fundId),
  ]);
  const items: LpDashboardAction[] = [];
  for (const a of allocs) {
    const status = callStatus(a, a.call.dueDate);
    if (!['ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_PAID', 'OVERDUE'].includes(status)) continue;
    const outstanding = maxZero(a.callAmount.sub(a.amountPaid));
    items.push({
      id: `act_cc_${a.id}`,
      type: 'CAPITAL_CALL',
      label: 'Capital Call Due',
      severity: status === 'OVERDUE' ? 'HIGH' : 'MEDIUM',
      title: `Capital Call #${a.call.callNo} due ${day(a.call.dueDate)}`,
      fundId: a.call.fundId,
      fundName: names.get(a.call.fundId),
      amount: fixed(outstanding),
      relatedRecordId: a.id,
      href: '/lp-portal/capital-activity?tab=calls',
      dueDate: day(a.call.dueDate),
    });
  }
  if (ctx.client.dealingHold || ctx.client.kycStatus === 'Review due') {
    items.push({
      id: `act_kyc_${ctx.client.id}`,
      type: 'KYC_UPDATE',
      label: 'Compliance',
      severity: 'HIGH',
      title: ctx.client.holdReason || 'KYC / compliance update required',
      fundId: '',
      relatedRecordId: ctx.client.id,
      href: '/lp-portal/settings',
      dueDate: null,
    });
  }
  for (const n of notices) {
    items.push({
      id: `act_notice_${n.id}`,
      type: 'NOTICE_REQUIRES_ACK',
      label: 'Notice',
      severity: 'MEDIUM',
      title: n.title,
      fundId: n.fundId ?? '',
      fundName: n.fundId ? names.get(n.fundId) : undefined,
      relatedRecordId: n.id,
      href: `/lp-portal/notices?id=${n.id}`,
      dueDate: n.expiresAt ? day(n.expiresAt) : null,
    });
  }
  for (const s of signatures) {
    items.push({
      id: `act_sign_${s.id}`,
      type: 'DOCUMENT_SIGNATURE',
      label: 'Signature',
      severity: 'MEDIUM',
      title: `Signature required · ${s.document.name}`,
      fundId: s.document.fundId ?? '',
      fundName: s.document.fundId ? names.get(s.document.fundId) : undefined,
      relatedRecordId: s.document.id,
      href: `/lp-portal/documents?id=${s.document.id}`,
      dueDate: s.dueDate ? day(s.dueDate) : null,
    });
  }
  for (const r of awaiting) {
    items.push({
      id: `act_req_${r.id}`,
      type: 'REQUEST_AWAITING_INVESTOR',
      label: 'Request',
      severity: 'MEDIUM',
      title: `${r.ref} needs your response`,
      fundId: r.fundId ?? '',
      fundName: r.fundId ? names.get(r.fundId) : undefined,
      relatedRecordId: r.ref,
      href: `/lp-portal/requests?ref=${r.ref}`,
      dueDate: null,
    });
  }
  for (const d of dealing) {
    const sub = d.requestType === 'SUBSCRIPTION';
    items.push({
      id: `act_deal_${d.id}`,
      type: sub ? 'SUBSCRIPTION_AWAITING_FUNDS' : 'REDEMPTION_UNDER_REVIEW',
      label: sub ? 'Subscription' : 'Redemption',
      severity: d.status === 'AWAITING_FUNDS' ? 'MEDIUM' : 'LOW',
      title: `${sub ? 'Subscription' : 'Redemption'} ${d.status.replace(/_/g, ' ').toLowerCase()}`,
      fundId: d.fundId,
      fundName: names.get(d.fundId),
      ...(d.amount ? { amount: fixed(d.amount) } : {}),
      relatedRecordId: d.id,
      href: '/lp-portal/subscriptions-redemptions',
      dueDate: d.requestedDealingDate ? day(d.requestedDealingDate) : null,
    });
  }
  return items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

export async function getRecentActivity(ctx: LpContext, limit: number): Promise<LpRecentActivity[]> {
  const [allocs, dists, dealing, docs, notices] = await Promise.all([
    prisma.capitalCallAllocation.findMany({
      where: { clientId: ctx.client.id, call: { fundId: { in: ctx.fundIds }, status: { in: VISIBLE_CALL_STATUSES }, issuedAt: { not: null } } },
      include: { call: true },
      orderBy: { call: { issuedAt: 'desc' } },
      take: limit,
    }),
    prisma.distributionAllocation.findMany({
      where: { clientId: ctx.client.id, distribution: { fundId: { in: ctx.fundIds }, status: { in: VISIBLE_DISTRIBUTION_STATUSES } } },
      include: { distribution: true },
      orderBy: { distribution: { distributionDate: 'desc' } },
      take: limit,
    }),
    prisma.lpDealingRequest.findMany({ where: { clientId: ctx.client.id, fundId: { in: ctx.fundIds } }, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.document.findMany({
      where: lpDocWhere(ctx),
      include: { publications: { where: { clientId: ctx.client.id } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.lpNotice.findMany({ where: visibleNoticeWhere(ctx), orderBy: { publishedAt: 'desc' }, take: limit }),
  ]);
  const items: LpRecentActivity[] = [
    ...allocs.map((a) => ({
      id: `actv_cc_${a.id}`,
      type: 'CAPITAL_CALL',
      title: `Capital Call #${a.call.callNo}`,
      fundId: a.call.fundId,
      amount: fixed(a.callAmount),
      status: callStatus(a, a.call.dueDate),
      at: (a.call.issuedAt ?? a.createdAt).toISOString(),
    })),
    ...dists.map((a) => ({
      id: `actv_dist_${a.id}`,
      type: 'DISTRIBUTION',
      title: `Distribution ${a.distribution.ref}`,
      fundId: a.distribution.fundId,
      amount: fixed(a.shareAmount),
      status: a.status,
      at: (a.paidAt ?? a.distribution.issuedAt ?? a.distribution.distributionDate).toISOString(),
    })),
    ...dealing.map((d) => ({
      id: `actv_deal_${d.id}`,
      type: d.requestType,
      title: `${d.requestType === 'SUBSCRIPTION' ? 'Subscription' : 'Redemption'} ${d.ref}`,
      fundId: d.fundId,
      amount: d.amount ? fixed(d.amount) : (null as unknown as string),
      status: d.status,
      at: d.createdAt.toISOString(),
    })),
    ...docs.map((d) => ({
      id: `actv_doc_${d.id}`,
      type: 'DOCUMENT',
      title: d.name,
      fundId: d.fundId ?? '',
      amount: null as unknown as string,
      status: 'PUBLISHED',
      at: (d.publications[0]?.publishedAt ?? d.createdAt).toISOString(),
    })),
    ...notices.map((n) => ({
      id: `actv_notice_${n.id}`,
      type: 'NOTICE',
      title: n.title,
      fundId: n.fundId ?? '',
      amount: null as unknown as string,
      status: n.status,
      at: (n.publishedAt ?? n.createdAt).toISOString(),
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
