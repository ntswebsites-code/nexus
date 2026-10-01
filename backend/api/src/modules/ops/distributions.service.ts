import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { proRata } from './allocation';
import { publishClientPdf } from './notice-docs';
import { fmtMoney, renderPdf } from './pdf';
import { D, ZERO, isoDay, money, notifyClientMembers, type Dec } from './ops.common';

export const DISTRIBUTION_TYPES = ['RETURN_OF_CAPITAL', 'REALISATION_PROCEEDS', 'DIVIDEND', 'INTEREST', 'INCOME', 'OTHER'] as const;

export const TYPE_LABEL: Record<string, string> = {
  RETURN_OF_CAPITAL: 'Return of Capital',
  REALISATION_PROCEEDS: 'Exit Proceeds',
  EXIT_PROCEEDS: 'Exit Proceeds',
  DIVIDEND: 'Dividend',
  INTEREST: 'Interest',
  INCOME: 'Income',
  OTHER: 'Other',
};

export const distInclude = {
  fund: { select: { id: true, ref: true, name: true, currency: true, operatingModel: true } },
  allocations: {
    include: { client: { select: { id: true, ref: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.DistributionInclude;
export type DistRow = Prisma.DistributionGetPayload<{ include: typeof distInclude }>;

export async function loadDistribution(id: string, db: Prisma.TransactionClient = prisma): Promise<DistRow> {
  const d = await db.distribution.findFirst({ where: { OR: [{ id }, { ref: id }] }, include: distInclude });
  if (!d) throw HttpError.notFound('Distribution not found');
  return d;
}

export interface PlannedDistAllocation {
  clientId: string;
  commitmentId: string;
  lpLegalName: string;
  commitment: Dec;
  paidIn: Dec;
  grossShare: Dec;
  shareAmount: Dec;
}

/**
 * PRO_RATA by paid-in capital (by commitment while nothing is paid in; by units for open-ended
 * funds). Gross and net are split separately (remainder to the largest) and adjustments are
 * the difference, so every column adds up to the header exactly.
 */
export async function planDistribution(
  fund: { id: string; operatingModel: string },
  gross: Dec,
  net: Dec,
  method: 'PRO_RATA' | 'EXPLICIT',
  explicit: { clientId: string; amount: string; grossShare?: string }[] | undefined,
  db: Prisma.TransactionClient = prisma,
): Promise<PlannedDistAllocation[]> {
  const commitments = await db.fundCommitment.findMany({
    where: { fundId: fund.id, status: { in: ['ACTIVE', 'PENDING', 'CLOSED'] } },
    include: { client: { select: { id: true, ref: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const paid = await db.capitalCallAllocation.groupBy({
    by: ['commitmentId'],
    where: { commitmentId: { in: commitments.map((c) => c.id) }, status: { not: 'CANCELLED' } },
    _sum: { amountPaid: true },
  });
  const paidBy = new Map(paid.map((p) => [p.commitmentId, p._sum.amountPaid ?? ZERO]));
  const units = new Map<string, Dec>();
  if (fund.operatingModel === 'OPEN_ENDED') {
    const holdings = await db.lpHolding.findMany({ where: { fundId: fund.id, isActive: true } });
    for (const h of holdings) units.set(h.clientId, (units.get(h.clientId) ?? ZERO).add(h.units));
  }
  const rows = commitments.map((c) => ({ c, paidIn: paidBy.get(c.id) ?? ZERO }));

  if (method === 'EXPLICIT') {
    if (!explicit?.length) throw HttpError.badRequest('Give at least one allocation for an explicit distribution');
    const seen = new Set<string>();
    const out = explicit.map((a) => {
      const r = rows.find((x) => x.c.clientId === a.clientId || x.c.client.ref === a.clientId);
      if (!r) throw HttpError.badRequest(`Client ${a.clientId} has no commitment to this fund`);
      if (seen.has(r.c.clientId)) throw HttpError.badRequest(`Client ${a.clientId} is allocated twice`);
      seen.add(r.c.clientId);
      const shareAmount = new D(a.amount);
      const grossShare = a.grossShare ? new D(a.grossShare) : shareAmount;
      if (grossShare.lt(shareAmount)) throw HttpError.badRequest(`Gross share for ${r.c.client.name} is below its net share`);
      return { r, grossShare, shareAmount };
    });
    const sumNet = out.reduce((s, x) => s.add(x.shareAmount), ZERO);
    if (!sumNet.eq(net)) throw HttpError.badRequest(`Allocations add up to ${money(sumNet)}, not the net to LPs ${money(net)}`);
    return out.map(({ r, grossShare, shareAmount }) => ({
      clientId: r.c.clientId,
      commitmentId: r.c.id,
      lpLegalName: r.c.client.name,
      commitment: r.c.commitmentAmount,
      paidIn: r.paidIn,
      grossShare,
      shareAmount,
    }));
  }

  const totalPaid = rows.reduce((s, r) => s.add(r.paidIn), ZERO);
  const weightOf = (r: (typeof rows)[number]) =>
    fund.operatingModel === 'OPEN_ENDED' ? (units.get(r.c.clientId) ?? ZERO) : totalPaid.gt(0) ? r.paidIn : r.c.commitmentAmount;
  const parts = rows.map((r) => ({ key: r, weight: weightOf(r) }));
  const netShares = proRata(net, parts);
  const grossShares = new Map(proRata(gross, parts).map((s) => [s.key.c.id, s.amount]));
  if (!netShares.length) throw HttpError.badRequest('No investor is eligible for this distribution');
  return netShares.map((s) => ({
    clientId: s.key.c.clientId,
    commitmentId: s.key.c.id,
    lpLegalName: s.key.c.client.name,
    commitment: s.key.c.commitmentAmount,
    paidIn: s.key.paidIn,
    grossShare: grossShares.get(s.key.c.id) ?? s.amount,
    shareAmount: s.amount,
  }));
}

export function staffDistributionView(d: DistRow) {
  const live = d.allocations.filter((a) => a.status !== 'CANCELLED');
  const paid = live.reduce((s, a) => s.add(a.amountPaid), ZERO);
  return {
    id: d.id,
    ref: d.ref,
    fundId: d.fundId,
    fundRef: d.fund.ref,
    fundName: d.fund.name,
    distributionDate: isoDay(d.distributionDate),
    type: d.type,
    typeLabel: TYPE_LABEL[d.type] ?? d.type,
    currency: d.currency,
    grossAmount: money(d.grossAmount),
    carryAmount: money(d.carryAmount),
    adjustmentsAmount: money(d.adjustmentsAmount),
    netToLps: money(d.netToLps),
    paid: money(paid),
    outstanding: money(D.max(ZERO, d.netToLps.sub(paid))),
    status: d.status,
    notes: d.notes,
    makerId: d.makerId,
    checkerId: d.checkerId,
    issuedAt: d.issuedAt,
    version: d.version,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    allocations: d.allocations.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      clientRef: a.client.ref,
      clientName: a.client.name,
      lpLegalName: a.lpLegalNameSnapshot,
      commitmentId: a.commitmentId,
      commitment: money(a.commitmentSnapshot),
      paidIn: money(a.paidInSnapshot),
      grossShare: money(a.grossShare),
      adjustments: money(a.adjustments),
      shareAmount: money(a.shareAmount),
      amountPaid: money(a.amountPaid),
      outstanding: money(D.max(ZERO, a.shareAmount.sub(a.amountPaid))),
      status: a.status,
      paidAt: a.paidAt,
      documentId: a.documentId,
      destinationBankAccountId: a.destinationBankAccountId,
      version: a.version,
    })),
  };
}

export function distributionNoticePdf(d: { ref: string; type: string; currency: string; distributionDate: Date; fund: { name: string } }, a: {
  lpLegalNameSnapshot: string;
  grossShare: Dec;
  adjustments: Dec;
  shareAmount: Dec;
  amountPaid: Dec;
  status: string;
}, bankMasked: string | null) {
  const cur = d.currency;
  return renderPdf('DISTRIBUTION NOTICE', [
    { text: d.fund.name, bold: true, size: 12 },
    { text: `Reference: ${d.ref}`, gap: 22 },
    { text: `Investor: ${a.lpLegalNameSnapshot}` },
    { text: `Payment date: ${isoDay(d.distributionDate)}` },
    { text: `Type: ${TYPE_LABEL[d.type] ?? d.type}`, gap: 22 },
    { text: `Gross: ${fmtMoney(money(a.grossShare), cur)}` },
    { text: `Adjustments: ${fmtMoney(money(a.adjustments), cur)}` },
    { text: `Net payable: ${fmtMoney(money(a.shareAmount), cur)}`, bold: true },
    { text: `Paid to date: ${fmtMoney(money(a.amountPaid), cur)}  (${a.status})`, gap: 22 },
    { text: `Destination account: ${bankMasked ?? 'account on file'}` },
  ]);
}

/** Default destination: the client's active bank instruction for the fund, else its fund-agnostic default. */
export async function destinationAccount(db: Prisma.TransactionClient, clientId: string, fundId: string) {
  return db.bankInstruction.findFirst({
    where: { clientId, status: 'Active', OR: [{ fundId }, { fundId: null }] },
    orderBy: [{ fundId: 'desc' }, { isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function issueDistributionArtefacts(tx: Prisma.TransactionClient, d: DistRow, actorId: string) {
  for (const a of d.allocations) {
    if (a.status === 'CANCELLED') continue;
    const bank = a.destinationBankAccountId
      ? await tx.bankInstruction.findFirst({ where: { id: a.destinationBankAccountId, clientId: a.clientId } })
      : await destinationAccount(tx, a.clientId, d.fundId);
    const { document } = await publishClientPdf(tx, {
      name: `${d.ref} Distribution Notice`,
      category: 'DISTRIBUTIONS',
      type: 'statement',
      clientId: a.clientId,
      fundId: d.fundId,
      sourceType: 'DISTRIBUTION_ALLOCATION',
      sourceRefId: a.id,
      relatedType: 'distribution',
      relatedId: d.id,
      relatedLabel: `${d.fund.name} ${d.ref}`,
      pdf: distributionNoticePdf(d, a, bank?.masked ?? null),
      fileName: `${d.ref}-${a.client.ref}-notice.pdf`,
      actorId,
      checkerId: d.checkerId,
      documentDate: new Date(),
    });
    await tx.distributionAllocation.update({
      where: { id: a.id },
      data: { documentId: document.id, destinationBankAccountId: a.destinationBankAccountId ?? bank?.id ?? null, version: { increment: 1 } },
    });
    await notifyClientMembers(tx, a.clientId, {
      type: 'distribution.issued',
      title: `Distribution ${d.ref} · ${d.fund.name}`,
      body: `${fmtMoney(money(a.shareAmount), d.currency)} payable on ${isoDay(d.distributionDate)}.`,
      link: `/distributions/${a.id}`,
      email: true,
    });
  }
}
