import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { LpCapitalCall, LpCapitalCallDetail, LpCapitalCallDocument, LpCapitalCallSummary } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { ctx } from '../../../lib/http';
import { nextRef } from '../../../lib/refs';
import { readFileObject, storeFile } from '../../../lib/storage';
import { assertFund, type LpContext } from '../lp.context';
import { LpError } from '../lp.http';
import { D, ZERO, money, notifyPermission, readWire } from '../../ops/ops.common';
import { callNoLabel, callNoticeLines, callReference, type CallRow } from '../../ops/capital.service';
import { renderPdf } from '../../ops/pdf';

/** Header statuses an LP may see (BR-153: issued, never draft or cancelled). */
export const VISIBLE_CALL_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];
export const DUE_SOON_DAYS = 7;

const allocInclude = {
  call: { include: { fund: { select: { id: true, ref: true, name: true, currency: true } } } },
  client: { select: { id: true, ref: true, name: true } },
  commitment: { select: { id: true, investorAccountRef: true, commitmentAmount: true } },
  payments: { orderBy: { recordedAt: 'asc' } },
} satisfies Prisma.CapitalCallAllocationInclude;
type AllocRow = Prisma.CapitalCallAllocationGetPayload<{ include: typeof allocInclude }>;

/** Every LP read goes through this scope: own client, funds in scope, issued calls only. */
export function lpAllocationScope(lp: LpContext, fundId?: string): Prisma.CapitalCallAllocationWhereInput {
  if (fundId) assertFund(lp, fundId);
  return {
    clientId: lp.client.id,
    status: { not: 'CANCELLED' },
    call: { fundId: { in: fundId ? [fundId] : lp.fundIds }, issuedAt: { not: null }, status: { in: VISIBLE_CALL_STATUSES } },
  };
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

/** BR-156 order: CANCELLED, PAID, PARTIALLY_PAID, OVERDUE, ACKNOWLEDGED, ISSUED. */
export function portalCallStatus(a: { status: string; callAmount: Prisma.Decimal; amountPaid: Prisma.Decimal; acknowledgedAt: Date | null; call: { status: string; dueDate: Date } }): string {
  if (a.call.status === 'CANCELLED' || a.status === 'CANCELLED') return 'CANCELLED';
  if (a.callAmount.gt(0) && a.amountPaid.gte(a.callAmount)) return 'PAID';
  if (a.amountPaid.gt(0)) return 'PARTIALLY_PAID';
  if (iso(a.call.dueDate) < todayIso()) return 'OVERDUE';
  if (a.acknowledgedAt) return 'ACKNOWLEDGED';
  return 'ISSUED';
}

function summaryItem(a: AllocRow): LpCapitalCall {
  return {
    id: a.id,
    callNo: a.call.callNo,
    fundId: a.call.fundId,
    fundName: a.call.fund.name,
    issueDate: iso(a.call.issuedAt ?? a.call.transactionDate),
    dueDate: iso(a.call.dueDate),
    currencyCode: a.call.currency,
    amount: money(a.callAmount),
    paid: money(a.amountPaid),
    outstanding: money(D.max(ZERO, a.callAmount.sub(a.amountPaid))),
    status: portalCallStatus(a),
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
  };
}

function detailItem(a: AllocRow): LpCapitalCallDetail {
  const w = readWire(a.call.wireJson);
  const reference = callReference(a.call.wireJson, a.call.callNo, a.commitment.investorAccountRef, a.client.ref);
  const lastPayment = a.payments[a.payments.length - 1]?.recordedAt ?? null;
  const firstPayment = a.payments[0]?.recordedAt ?? null;
  const fullyPaid = a.callAmount.gt(0) && a.amountPaid.gte(a.callAmount);
  const raw = [
    `Beneficiary: ${w?.accountName || a.call.fund.name}`,
    `Bank: ${w?.bank || '(see fund administrator)'}`,
    ...(w?.abaRouting ? [`ABA/Routing: ${w.abaRouting}`] : []),
    ...(w?.swift ? [`SWIFT: ${w.swift}`] : []),
    `Account: ${w?.accountNumberMasked ?? '••••'}`,
    `Reference: ${reference}`,
    `Currency: ${a.call.currency}`,
    `Amount due: ${money(a.callAmount)}`,
  ].join('\n');
  return {
    ...summaryItem(a),
    wiring: {
      bankName: w?.bank ?? '',
      accountName: w?.accountName ?? '',
      accountNumber: null,
      accountNumberMasked: w?.accountNumberMasked ?? '••••',
      abaRouting: w?.abaRouting ?? w?.swift ?? '',
      reference,
      raw: a.call.wireText ?? raw,
    },
    timeline: [
      { code: 'ISSUED', at: a.call.issuedAt?.toISOString() ?? null, completed: true },
      { code: 'ACKNOWLEDGED', at: a.acknowledgedAt?.toISOString() ?? null, completed: !!a.acknowledgedAt },
      { code: 'PAYMENT_RECEIVED', at: firstPayment?.toISOString() ?? null, completed: a.amountPaid.gt(0) },
      { code: 'ALLOCATED', at: fullyPaid ? (lastPayment?.toISOString() ?? null) : null, completed: fullyPaid },
    ],
  };
}

async function findAllocation(lp: LpContext, id: string, db: Prisma.TransactionClient = prisma): Promise<AllocRow> {
  const a = await db.capitalCallAllocation.findFirst({ where: { id, ...lpAllocationScope(lp) }, include: allocInclude });
  if (!a) throw new LpError(404, 'LP_NOT_FOUND', 'Capital call not found');
  return a;
}

export async function listCalls(lp: LpContext, q: { fundId?: string; status?: string; page: number; pageSize: number }) {
  const rows = await prisma.capitalCallAllocation.findMany({
    where: lpAllocationScope(lp, q.fundId),
    include: allocInclude,
    orderBy: [{ call: { dueDate: 'desc' } }, { createdAt: 'desc' }],
  });
  let items = rows.map(summaryItem);
  if (q.status) items = items.filter((i) => i.status === q.status!.toUpperCase());
  return items;
}

export async function getCall(lp: LpContext, id: string) {
  return detailItem(await findAllocation(lp, id));
}

export async function callSummary(lp: LpContext, fundId?: string): Promise<LpCapitalCallSummary> {
  const rows = await prisma.capitalCallAllocation.findMany({ where: lpAllocationScope(lp, fundId), include: allocInclude });
  const items = rows.map(summaryItem);
  const sum = (xs: LpCapitalCall[], k: 'outstanding' | 'paid' | 'amount') => xs.reduce((s, x) => s.add(x[k]), ZERO);
  const open = items.filter((i) => ['ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status));
  const today = todayIso();
  const horizon = new Date(Date.now() + DUE_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const dueSoon = open.filter((i) => i.dueDate >= today && i.dueDate <= horizon);
  const year = String(new Date().getUTCFullYear());
  const paidYtd = rows
    .flatMap((r) => r.payments)
    .filter((p) => p.recordedAt.toISOString().startsWith(year))
    .reduce((s, p) => s.add(p.amount), ZERO);

  const distWhere: Prisma.DistributionAllocationWhereInput = {
    clientId: lp.client.id,
    status: { not: 'CANCELLED' },
    distribution: { fundId: { in: fundId ? [fundId] : lp.fundIds }, issuedAt: { not: null }, status: { in: VISIBLE_CALL_STATUSES } },
  };
  const dists = await prisma.distributionAllocation.findMany({ where: distWhere, select: { amountPaid: true, shareAmount: true, status: true } });
  const pendingDists = dists.filter((d) => d.status !== 'PAID');

  let currencyCode = lp.client.baseCurrency;
  if (fundId) {
    const f = await prisma.fund.findUnique({ where: { id: fundId }, select: { currency: true } });
    currencyCode = f?.currency ?? currencyCode;
  } else {
    const currencies = new Set(rows.map((r) => r.call.currency));
    if (currencies.size === 1) currencyCode = [...currencies][0]!;
  }
  return {
    openCount: open.length,
    outstanding: money(sum(open, 'outstanding')),
    overdue: money(sum(open.filter((i) => i.status === 'OVERDUE'), 'outstanding')),
    paidYtd: money(paidYtd),
    currencyCode,
    paidCallCount: items.filter((i) => i.status === 'PAID').length,
    dueSoonCount: dueSoon.length,
    dueSoonAmount: money(sum(dueSoon, 'outstanding')),
    totalDistributions: money(dists.reduce((s, d) => s.add(d.amountPaid), ZERO)),
    upcomingDistributionNotices: { count: pendingDists.length, amount: money(pendingDists.reduce((s, d) => s.add(d.shareAmount.sub(d.amountPaid)), ZERO)) },
  };
}

const LP_CATEGORY_LABEL: Record<string, string> = { CALL_NOTICE: 'Capital Calls', DISTRIBUTIONS: 'Distributions' };

async function callDocuments(lp: LpContext, a: AllocRow) {
  return prisma.document.findMany({
    where: {
      clientId: lp.client.id,
      status: 'Published',
      OR: [
        { sourceType: 'CAPITAL_CALL_ALLOCATION', sourceRefId: a.id },
        { sourceType: 'CAPITAL_CALL', sourceRefId: a.callId },
      ],
      publications: { some: { clientId: lp.client.id, withdrawnAt: null } },
    },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listCallDocuments(lp: LpContext, id: string): Promise<LpCapitalCallDocument[]> {
  const a = await findAllocation(lp, id);
  const docs = await callDocuments(lp, a);
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    category: LP_CATEGORY_LABEL[d.category ?? ''] ?? d.category ?? 'Capital Calls',
    publishedDate: iso(d.approvedAt ?? d.createdAt),
    checksumSha256: d.versions[0]?.sha256 ?? '',
    status: d.requiresSignature ? 'REQUIRES_SIGNATURE' : 'PUBLISHED',
  }));
}

/** The published notice PDF for this LP (generated on the fly only if none was stored). */
export async function noticeFile(req: Request, lp: LpContext, id: string): Promise<{ name: string; data: Buffer; mime: string }> {
  const a = await findAllocation(lp, id);
  const docs = await callDocuments(lp, a);
  const notice = docs.find((d) => d.category === 'CALL_NOTICE' && d.versions[0]);
  let out: { name: string; data: Buffer; mime: string };
  if (notice) {
    const { file, data } = await readFileObject(notice.versions[0]!.fileId);
    out = { name: `capital-call-${a.call.callNo}-notice.pdf`, data, mime: file.mime };
  } else {
    const row = { ...a.call, allocations: [a] } as unknown as CallRow;
    out = { name: `capital-call-${a.call.callNo}-notice.pdf`, data: renderPdf('CAPITAL CALL NOTICE', callNoticeLines(row, row.allocations[0]!)), mime: 'application/pdf' };
  }
  await prisma.$transaction(async (tx) => {
    if (notice) await tx.documentAccessLog.create({ data: { documentId: notice.id, userId: lp.userId, clientId: lp.client.id, action: 'DOWNLOAD', ip: req.ip ?? null } });
    await writeAudit(tx, ctx(req, 'investor'), {
      action: 'lp.capital_call.notice_downloaded',
      objectType: 'capital_call_allocation',
      objectId: a.id,
      after: { documentId: notice?.id ?? null },
    });
  });
  return out;
}

/** BR-154: records who/when; never changes paid or the allocation status. */
export async function acknowledge(req: Request, lp: LpContext, id: string) {
  const a = await findAllocation(lp, id);
  if (a.acknowledgedAt) throw new LpError(409, 'LP_CALL_ALREADY_ACKNOWLEDGED', 'Already acknowledged');
  const acknowledgedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.capitalCallAllocation.updateMany({
      where: { id: a.id, acknowledgedAt: null },
      data: { acknowledgedAt, acknowledgedById: lp.userId },
    });
    if (updated.count !== 1) throw new LpError(409, 'LP_CALL_ALREADY_ACKNOWLEDGED', 'Already acknowledged');
    await writeAudit(tx, ctx(req, 'investor'), {
      action: 'lp.capital_call.acknowledged',
      objectType: 'capital_call_allocation',
      objectId: a.id,
      after: { acknowledgedAt: acknowledgedAt.toISOString(), callRef: a.call.ref, client: a.client.ref },
    });
  });
  return { acknowledgedAt: acknowledgedAt.toISOString() };
}

/** BR-155: evidence only (file + SHA-256 + claimed amount); staff matching changes `paid`. */
export async function uploadPaymentConfirmation(req: Request, lp: LpContext, id: string, file: Express.Multer.File | undefined, body: { amountClaimed?: string; notes?: string }) {
  if (!file) throw LpError.validation('file is required', { file: 'Attach the payment confirmation' });
  const a = await findAllocation(lp, id);
  const outstanding = D.max(ZERO, a.callAmount.sub(a.amountPaid));
  const amountClaimed = body.amountClaimed ? new D(body.amountClaimed) : outstanding;
  const result = await prisma.$transaction(
    async (tx) => {
      const stored = await storeFile({ name: file.originalname || 'payment-confirmation', mime: file.mimetype, data: file.buffer, uploadedById: lp.userId }, tx);
      const previous = await tx.fundingEvidence.findFirst({ where: { allocationId: a.id }, select: { capitalEventId: true } });
      let capitalEventId = previous?.capitalEventId;
      if (!capitalEventId) {
        const ev = await tx.capitalEvent.create({
          data: {
            ref: await nextRef(tx, 'capital'),
            clientId: lp.client.id,
            investmentName: a.call.fund.name.slice(0, 160),
            type: 'Capital call',
            amount: a.callAmount,
            currency: a.call.currency,
            dueDate: a.call.dueDate,
            status: 'Processing',
            purpose: `${callNoLabel(a.call.callNo)} (${a.call.ref})`,
            publishedAt: a.call.issuedAt,
            makerId: a.call.makerId,
            checkerId: a.call.checkerId,
            approvedAt: a.call.approvedAt,
          },
        });
        capitalEventId = ev.id;
      }
      const evidence = await tx.fundingEvidence.create({
        data: {
          capitalEventId,
          fileId: stored.id,
          confirmedById: lp.userId,
          allocationId: a.id,
          amountClaimed,
          notes: body.notes ?? null,
          sha256: stored.sha256,
        },
      });
      await writeAudit(tx, ctx(req, 'investor'), {
        action: 'lp.capital_call.payment_confirmation_uploaded',
        objectType: 'capital_call_allocation',
        objectId: a.id,
        after: { evidenceId: evidence.id, fileId: stored.id, sha256: stored.sha256, amountClaimed: money(amountClaimed), callRef: a.call.ref },
      });
      await notifyPermission(tx, 'capital.settle', {
        type: 'capital_call.payment_confirmation',
        title: `Payment confirmation · ${a.client.name} · ${a.call.ref}`,
        body: `${money(amountClaimed)} ${a.call.currency} claimed; match it to the bank receipt.`,
      });
      return { evidence, stored };
    },
    { timeout: 20_000 },
  );
  return {
    id: result.evidence.id,
    fileName: result.stored.name,
    sha256: result.stored.sha256,
    amountClaimed: money(amountClaimed),
    uploadedAt: result.evidence.confirmedAt.toISOString(),
  };
}
