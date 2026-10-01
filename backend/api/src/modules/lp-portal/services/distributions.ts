import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import type { LpDistribution } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { ctx } from '../../../lib/http';
import { readFileObject } from '../../../lib/storage';
import { assertFund, type LpContext } from '../lp.context';
import { LpError } from '../lp.http';
import { ZERO, money } from '../../ops/ops.common';
import { TYPE_LABEL, distributionNoticePdf } from '../../ops/distributions.service';
import { fmtMoney, renderPdf, type PdfLine } from '../../ops/pdf';
import { VISIBLE_CALL_STATUSES } from './capital';

const include = {
  distribution: { include: { fund: { select: { id: true, name: true, currency: true } } } },
} satisfies Prisma.DistributionAllocationInclude;
type Row = Prisma.DistributionAllocationGetPayload<{ include: typeof include }>;

/** Own client, funds in scope, issued distributions only (BR-153). */
export function lpDistributionScope(lp: LpContext, fundId?: string): Prisma.DistributionAllocationWhereInput {
  if (fundId) assertFund(lp, fundId);
  return {
    clientId: lp.client.id,
    status: { not: 'CANCELLED' },
    distribution: { fundId: { in: fundId ? [fundId] : lp.fundIds }, issuedAt: { not: null }, status: { in: VISIBLE_CALL_STATUSES } },
  };
}

async function banksFor(lp: LpContext) {
  const banks = await prisma.bankInstruction.findMany({ where: { clientId: lp.client.id } });
  return new Map(banks.map((b) => [b.id, b]));
}

function item(r: Row, banks: Map<string, { masked: string; fundId: string | null; status: string; isDefault: boolean }>, fallback: (fundId: string) => string | null): LpDistribution {
  const d = r.distribution;
  const bank = r.destinationBankAccountId ? banks.get(r.destinationBankAccountId) : undefined;
  return {
    id: r.id,
    reference: d.ref,
    fundId: d.fundId,
    fundName: d.fund.name,
    paymentDate: (r.paidAt ?? d.distributionDate).toISOString().slice(0, 10),
    type: TYPE_LABEL[d.type] ?? d.type,
    currencyCode: d.currency,
    gross: money(r.grossShare.gt(0) ? r.grossShare : r.shareAmount),
    adjustments: money(r.adjustments),
    netPaid: money(r.shareAmount),
    status: r.status,
    destinationBankMasked: bank?.masked ?? fallback(d.fundId),
    documentId: r.documentId,
  };
}

async function mapper(lp: LpContext) {
  const banks = await banksFor(lp);
  const active = [...banks.values()].filter((b) => b.status === 'Active');
  const fallback = (fundId: string) =>
    (active.find((b) => b.fundId === fundId) ?? active.find((b) => !b.fundId && b.isDefault) ?? active.find((b) => !b.fundId))?.masked ?? null;
  return (r: Row) => item(r, banks, fallback);
}

export async function listDistributions(lp: LpContext, q: { fundId?: string; from?: string; to?: string }) {
  const rows = await prisma.distributionAllocation.findMany({
    where: lpDistributionScope(lp, q.fundId),
    include,
    orderBy: [{ distribution: { distributionDate: 'desc' } }, { createdAt: 'desc' }],
  });
  const map = await mapper(lp);
  return rows
    .map(map)
    .filter((i) => (!q.from || i.paymentDate >= q.from) && (!q.to || i.paymentDate <= q.to));
}

async function findRow(lp: LpContext, id: string) {
  const r = await prisma.distributionAllocation.findFirst({ where: { id, ...lpDistributionScope(lp) }, include });
  if (!r) throw new LpError(404, 'LP_NOT_FOUND', 'Distribution not found');
  return r;
}

export async function getDistribution(lp: LpContext, id: string) {
  return (await mapper(lp))(await findRow(lp, id));
}

export async function distributionFile(req: Request, lp: LpContext, id: string) {
  const r = await findRow(lp, id);
  const doc = r.documentId
    ? await prisma.document.findFirst({
        where: { id: r.documentId, clientId: lp.client.id, status: 'Published' },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      })
    : null;
  let data: Buffer;
  if (doc?.versions[0]) {
    data = (await readFileObject(doc.versions[0].fileId)).data;
  } else {
    const view = (await mapper(lp))(r);
    data = distributionNoticePdf(r.distribution, r, view.destinationBankMasked);
  }
  await prisma.$transaction(async (tx) => {
    if (doc) await tx.documentAccessLog.create({ data: { documentId: doc.id, userId: lp.userId, clientId: lp.client.id, action: 'DOWNLOAD', ip: req.ip ?? null } });
    await writeAudit(tx, ctx(req, 'investor'), { action: 'lp.distribution.downloaded', objectType: 'distribution_allocation', objectId: r.id, after: { documentId: doc?.id ?? null } });
  });
  return { name: `distribution-${r.distribution.ref}.pdf`, data };
}

export async function statementFile(req: Request, lp: LpContext, q: { fundId?: string; asOfDate?: string }) {
  const asOf = q.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(q.asOfDate) ? q.asOfDate : new Date().toISOString().slice(0, 10);
  const items = (await listDistributions(lp, { fundId: q.fundId })).filter((i) => i.paymentDate <= asOf);
  const byCurrency = new Map<string, typeof ZERO>();
  for (const i of items) byCurrency.set(i.currencyCode, (byCurrency.get(i.currencyCode) ?? ZERO).add(i.netPaid));
  const lines: PdfLine[] = [
    { text: lp.client.name, bold: true, size: 12 },
    { text: `As of ${asOf}${q.fundId ? '' : ' - all funds'}`, gap: 22 },
    { text: 'Date        Reference   Fund / type                                     Gross            Net   Status', bold: true, size: 8 },
    ...items.slice(0, 40).map((i) => ({
      text: `${i.paymentDate}  ${i.reference.padEnd(10)}  ${`${i.fundName} / ${i.type}`.slice(0, 44).padEnd(44)}  ${i.gross.padStart(13)}  ${i.netPaid.padStart(13)}  ${i.status}`,
      size: 8,
    })),
    { text: ' ', gap: 10 },
    ...[...byCurrency.entries()].map(([cur, total]) => ({ text: `Total net distributions: ${fmtMoney(money(total), cur)}`, bold: true })),
  ];
  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx(req, 'investor'), { action: 'lp.distribution.statement_downloaded', objectType: 'client', objectId: lp.client.id, after: { fundId: q.fundId ?? null, asOf, rows: items.length } }),
  );
  return { name: `distribution-statement-${asOf}.pdf`, data: renderPdf('DISTRIBUTION STATEMENT', lines) };
}
