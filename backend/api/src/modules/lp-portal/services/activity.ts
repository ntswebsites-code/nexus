import { Prisma } from '@prisma/client';
import type { LpAccountActivityEntry, LpLedgerDocument, LpLedgerEntryDetail } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { day } from '../lp.http';
import type { LpContext } from '../lp.context';
import { LpError } from '../lp.http';
import { VISIBLE_CALL_STATUSES, VISIBLE_DISTRIBUTION_STATUSES, callStatus, fundMap } from './common';
import { lpDocWhere } from './documents';
import { fixed } from './positions';
import { presentationCurrencyOf, stampEntries } from './fx';

export interface ActivityFilter {
  fundId?: string;
  from?: string;
  to?: string;
  currency?: string;
  sortBy?: ActivitySort;
  sortDirection?: 'asc' | 'desc';
}

export const ACTIVITY_SORTS = ['transactionDate', 'amount', 'status', 'fundName', 'entryType'] as const;
export type ActivitySort = (typeof ACTIVITY_SORTS)[number];

const structure = (operatingModel: string) => (operatingModel === 'OPEN_ENDED' ? 'Open-End' : 'Closed-End');
const model = (operatingModel: string) => (operatingModel === 'OPEN_ENDED' ? 'OPEN_ENDED' : 'PRIVATE_CAPITAL') as 'OPEN_ENDED' | 'PRIVATE_CAPITAL';

/** Read-time ledger: issued calls, receipts, distributions, payouts and dealing requests in scope. */
export async function ledgerEntries(ctx: LpContext, f: ActivityFilter): Promise<LpAccountActivityEntry[]> {
  const fundIds = f.fundId ? [f.fundId] : ctx.fundIds;
  if (!fundIds.length) return [];
  const [funds, allocs, dists, dealing] = await Promise.all([
    fundMap(ctx),
    prisma.capitalCallAllocation.findMany({
      where: { clientId: ctx.client.id, call: { fundId: { in: fundIds }, status: { in: VISIBLE_CALL_STATUSES }, issuedAt: { not: null } } },
      include: { call: true, payments: true },
    }),
    prisma.distributionAllocation.findMany({
      where: { clientId: ctx.client.id, distribution: { fundId: { in: fundIds }, status: { in: VISIBLE_DISTRIBUTION_STATUSES } } },
      include: { distribution: true },
    }),
    prisma.lpDealingRequest.findMany({ where: { clientId: ctx.client.id, fundId: { in: fundIds } } }),
  ]);
  const fundBits = (fundId: string) => {
    const fund = funds.get(fundId);
    return { fundId, fundName: fund?.name ?? '', operatingModel: model(fund?.operatingModel ?? ''), structure: structure(fund?.operatingModel ?? '') };
  };
  const out: LpAccountActivityEntry[] = [];
  for (const a of allocs) {
    const pct = a.call.callPercent ? `${a.call.callPercent.toFixed(2)}%` : null;
    out.push({
      entryId: a.id,
      entryType: 'CAPITAL_CALL',
      ...fundBits(a.call.fundId),
      transactionDate: day(a.call.transactionDate ?? a.call.issuedAt ?? a.call.dueDate),
      amount: fixed(a.callAmount),
      currency: a.call.currency,
      description: pct ? `Capital call #${a.call.callNo} — ${pct}` : `Capital call #${a.call.callNo}`,
      status: callStatus(a, a.call.dueDate),
    });
    for (const p of a.payments) {
      out.push({
        entryId: p.id,
        entryType: 'CAPITAL_CALL_PAYMENT',
        ...fundBits(a.call.fundId),
        transactionDate: day(p.recordedAt),
        amount: fixed(p.amount),
        currency: a.call.currency,
        description: `Capital call #${a.call.callNo} payment received`,
        status: 'POSTED',
      });
    }
  }
  for (const a of dists) {
    out.push({
      entryId: a.id,
      entryType: 'DISTRIBUTION',
      ...fundBits(a.distribution.fundId),
      transactionDate: day(a.distribution.distributionDate),
      amount: fixed(a.shareAmount.neg()),
      currency: a.distribution.currency,
      description: `Distribution ${a.distribution.ref} declared (${a.distribution.type.replace(/_/g, ' ').toLowerCase()})`,
      status: a.status,
    });
    if (a.paidAt && a.amountPaid.gt(0)) {
      out.push({
        entryId: `${a.id}:paid`,
        entryType: 'DISTRIBUTION_PAYMENT',
        ...fundBits(a.distribution.fundId),
        transactionDate: day(a.paidAt),
        amount: fixed(a.amountPaid.neg()),
        currency: a.distribution.currency,
        description: `Distribution ${a.distribution.ref} payout`,
        status: 'POSTED',
      });
    }
  }
  for (const d of dealing) {
    out.push({
      entryId: d.id,
      entryType: d.requestType,
      ...fundBits(d.fundId),
      transactionDate: day(d.createdAt),
      amount: d.amount ? fixed(d.requestType === 'REDEMPTION' ? d.amount.neg() : d.amount) : '0.00',
      currency: d.currency,
      description: `${d.requestType === 'SUBSCRIPTION' ? 'Subscription' : 'Redemption'} request ${d.ref}`,
      status: d.status,
    });
  }
  const dir = f.sortDirection === 'asc' ? 1 : -1;
  const key = f.sortBy ?? 'transactionDate';
  const cmp = (a: LpAccountActivityEntry, b: LpAccountActivityEntry) => {
    if (key === 'amount') return Number(a.amount) - Number(b.amount);
    if (key === 'status') return a.status.localeCompare(b.status);
    if (key === 'fundName') return a.fundName.localeCompare(b.fundName);
    if (key === 'entryType') return a.entryType.localeCompare(b.entryType);
    return a.transactionDate.localeCompare(b.transactionDate);
  };
  return out
    .filter((e) => (!f.from || e.transactionDate >= f.from) && (!f.to || e.transactionDate <= f.to) && (!f.currency || e.currency === f.currency.toUpperCase()))
    .sort((a, b) => dir * cmp(a, b) || b.transactionDate.localeCompare(a.transactionDate) || a.entryId.localeCompare(b.entryId));
}

/**
 * Adds the original amount's conversion at the stamped transaction-date rate (BR-152, BR-171). The original
 * amount and currency are never changed; a missing rate gives `reportingAmount: null` and a note.
 */
export async function withFx(ctx: LpContext, entries: LpAccountActivityEntry[]): Promise<LpAccountActivityEntry[]> {
  const target = await presentationCurrencyOf(ctx);
  const stamps = await stampEntries(
    ctx,
    target,
    entries.map((e) => ({ entryId: e.entryId, entryType: e.entryType, currency: e.currency, txnDate: e.transactionDate })),
  );
  return entries.map((e) => {
    const st = stamps.get(e.entryId);
    if (!st) {
      return { ...e, reportingAmount: null, reportingCurrency: e.currency, fxRate: null, fxRateDate: null, fxNote: `FX rate unavailable for ${e.currency}/${target}; original currency shown.` };
    }
    const amount = new Prisma.Decimal(e.amount).mul(st.rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
    return { ...e, reportingAmount: amount, reportingCurrency: target, fxRate: st.rate, fxRateDate: st.rateDate, fxNote: null };
  });
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${v.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : v);

export const ACTIVITY_EXPORT_HEADER = ['entryId', 'transactionDate', 'entryType', 'fundName', 'description', 'amount', 'currency', 'status', 'reportingAmount', 'reportingCurrency', 'fxRate', 'fxRateDate'];
export const activityExportRow = (e: LpAccountActivityEntry) => [e.entryId, e.transactionDate, e.entryType, e.fundName, e.description, e.amount, e.currency, e.status, e.reportingAmount ?? '', e.reportingCurrency ?? '', e.fxRate ?? '', e.fxRateDate ?? ''];

/** CSV with formula-injection guard (leading = + - @ are quoted and prefixed). */
export function toCsv(entries: LpAccountActivityEntry[]): string {
  const header = ACTIVITY_EXPORT_HEADER;
  const lines = entries.map((e) =>
    activityExportRow(e).map((v) => csvCell(String(v ?? ''))).join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}

async function relatedDocs(ctx: LpContext, ids: (string | null | undefined)[]): Promise<LpLedgerDocument[]> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return [];
  const docs = await prisma.document.findMany({
    where: { AND: [lpDocWhere(ctx), { OR: [{ id: { in: unique } }, { sourceRefId: { in: unique } }] }] },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 }, publications: { where: { clientId: ctx.client.id } } },
    take: 11,
  });
  const files = await prisma.fileObject.findMany({ where: { id: { in: docs.flatMap((d) => d.versions.map((v) => v.fileId)) } }, select: { id: true, size: true } });
  const size = new Map(files.map((f) => [f.id, f.size]));
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    publishedDate: day(d.publications[0]?.publishedAt ?? d.createdAt),
    ...(d.versions[0] ? { size: size.get(d.versions[0].fileId) } : {}),
  }));
}

/** Entry detail by allocation / payment id; client- and fund-scoped (stricter than the reference). */
export async function ledgerEntry(ctx: LpContext, entryId: string): Promise<LpLedgerEntryDetail> {
  const callScope = { fundId: { in: ctx.fundIds }, status: { in: VISIBLE_CALL_STATUSES }, issuedAt: { not: null } };
  const alloc = await prisma.capitalCallAllocation.findFirst({
    where: { id: entryId, clientId: ctx.client.id, call: callScope },
    include: { call: true, payments: { orderBy: { recordedAt: 'asc' } } },
  });
  if (alloc) {
    return {
      entryId,
      entryType: 'CAPITAL_CALL',
      allocation: { id: alloc.id, clientId: alloc.clientId, currentCallAmount: fixed(alloc.callAmount), amountPaid: fixed(alloc.amountPaid), status: callStatus(alloc, alloc.call.dueDate) },
      payments: alloc.payments.map((p) => ({ id: p.id, amount: fixed(p.amount), recordedAt: p.recordedAt.toISOString(), bankReference: p.bankReference })),
      callNoticeDocumentId: alloc.call.noticeDocumentId,
      documents: await relatedDocs(ctx, [alloc.call.noticeDocumentId, alloc.call.id, alloc.id]),
    };
  }
  const payment = await prisma.capitalCallPayment.findFirst({
    where: { id: entryId, allocation: { clientId: ctx.client.id, call: callScope } },
    include: { allocation: { include: { call: true } } },
  });
  if (payment) {
    return {
      entryId,
      entryType: 'CAPITAL_CALL_PAYMENT',
      allocation: {
        id: payment.allocation.id,
        clientId: payment.allocation.clientId,
        currentCallAmount: fixed(payment.allocation.callAmount),
        amountPaid: fixed(payment.allocation.amountPaid),
        status: callStatus(payment.allocation, payment.allocation.call.dueDate),
      },
      payments: [{ id: payment.id, amount: fixed(payment.amount), recordedAt: payment.recordedAt.toISOString(), bankReference: payment.bankReference }],
      callNoticeDocumentId: payment.allocation.call.noticeDocumentId,
      documents: await relatedDocs(ctx, [payment.allocation.call.noticeDocumentId]),
    };
  }
  const distId = entryId.endsWith(':paid') ? entryId.slice(0, -5) : entryId;
  const dist = await prisma.distributionAllocation.findFirst({
    where: { id: distId, clientId: ctx.client.id, distribution: { fundId: { in: ctx.fundIds }, status: { in: VISIBLE_DISTRIBUTION_STATUSES } } },
    include: { distribution: true },
  });
  if (dist) {
    return {
      entryId,
      entryType: entryId.endsWith(':paid') ? 'DISTRIBUTION_PAYMENT' : 'DISTRIBUTION',
      allocation: { id: dist.id, clientId: dist.clientId, currentCallAmount: fixed(dist.shareAmount), amountPaid: fixed(dist.amountPaid), status: dist.status },
      payments: dist.paidAt ? [{ id: `${dist.id}:paid`, amount: fixed(dist.amountPaid), recordedAt: dist.paidAt.toISOString(), bankReference: null }] : [],
      callNoticeDocumentId: null,
      documents: await relatedDocs(ctx, [dist.documentId, dist.distributionId]),
    };
  }
  const deal = await prisma.lpDealingRequest.findFirst({
    where: { id: entryId, clientId: ctx.client.id, fundId: { in: ctx.fundIds } },
  });
  if (deal) {
    return {
      entryId,
      entryType: deal.requestType,
      payments: deal.amount ? [{ id: deal.id, amount: fixed(deal.amount), recordedAt: deal.createdAt.toISOString(), bankReference: null }] : [],
      callNoticeDocumentId: null,
      documents: [],
    };
  }
  throw new LpError(404, 'LP_NOT_FOUND', 'Ledger entry not found');
}
