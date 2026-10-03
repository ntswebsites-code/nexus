import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { signedDownloadUrl } from '../../lib/storage';
import { proRata } from './allocation';
import { publishClientPdf } from './notice-docs';
import { fmtMoney, renderPdf, type PdfLine } from './pdf';
import { D, ZERO, isoDay, money, notifyClientMembers, readWire, seqRef, wireView, type Dec } from './ops.common';

export const callInclude = {
  fund: { select: { id: true, ref: true, name: true, currency: true } },
  allocations: {
    include: {
      client: { select: { id: true, ref: true, name: true } },
      commitment: { select: { id: true, investorAccountRef: true, commitmentAmount: true } },
      payments: { orderBy: { recordedAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.CapitalCallInclude;
export type CallRow = Prisma.CapitalCallGetPayload<{ include: typeof callInclude }>;

export async function loadCall(id: string, db: Prisma.TransactionClient = prisma): Promise<CallRow> {
  const c = await db.capitalCall.findFirst({ where: { OR: [{ id }, { ref: id }] }, include: callInclude });
  if (!c) throw HttpError.notFound('Capital call not found');
  return c;
}

export const callNoLabel = (callNo: number) => `CC-${String(callNo).padStart(3, '0')}`;

/** Payment reference an LP quotes on its wire. */
export function callReference(wireJson: unknown, callNo: number, accountRef: string | null | undefined, clientRef: string) {
  const w = readWire(wireJson);
  const base = `${accountRef || clientRef} / ${callNoLabel(callNo)}`;
  return w?.reference ? `${w.reference} / ${base}` : base;
}

/** Eligible commitments and what each has left to call (commitment − non-cancelled prior calls). */
export async function commitmentPositions(fundId: string, db: Prisma.TransactionClient = prisma) {
  const commitments = await db.fundCommitment.findMany({
    where: { fundId, status: { in: ['ACTIVE', 'PENDING'] } },
    include: { client: { select: { id: true, ref: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const called = await db.capitalCallAllocation.groupBy({
    by: ['commitmentId'],
    where: { commitmentId: { in: commitments.map((c) => c.id) }, status: { not: 'CANCELLED' }, call: { status: { not: 'CANCELLED' } } },
    _sum: { callAmount: true },
  });
  const calledBy = new Map(called.map((c) => [c.commitmentId, c._sum.callAmount ?? ZERO]));
  return commitments.map((c) => {
    const prior = calledBy.get(c.id) ?? ZERO;
    return { commitment: c, called: prior, uncalled: c.commitmentAmount.sub(prior) };
  });
}

export interface PlannedAllocation {
  clientId: string;
  commitmentId: string;
  lpLegalName: string;
  commitmentAmount: Dec;
  uncalledBefore: Dec;
  amount: Dec;
}

/** PRO_RATA by commitment (remainder to the largest); each share capped at the LP's unfunded commitment. */
export async function planCallAllocations(
  fundId: string,
  total: Dec,
  method: 'PRO_RATA' | 'EXPLICIT',
  explicit: { clientId: string; amount: string }[] | undefined,
  db: Prisma.TransactionClient = prisma,
): Promise<PlannedAllocation[]> {
  const positions = (await commitmentPositions(fundId, db)).filter((p) => p.uncalled.gt(0));
  let shares: { key: (typeof positions)[number]; amount: Dec }[];
  if (method === 'EXPLICIT') {
    if (!explicit?.length) throw HttpError.badRequest('Give at least one allocation for an explicit call');
    const seen = new Set<string>();
    shares = explicit.map((a) => {
      const p = positions.find((x) => x.commitment.clientId === a.clientId || x.commitment.client.ref === a.clientId);
      if (!p) throw HttpError.badRequest(`Client ${a.clientId} has no open commitment to this fund`);
      if (seen.has(p.commitment.clientId)) throw HttpError.badRequest(`Client ${a.clientId} is allocated twice`);
      seen.add(p.commitment.clientId);
      return { key: p, amount: new D(a.amount) };
    });
    const sum = shares.reduce((s, x) => s.add(x.amount), ZERO);
    if (!sum.eq(total)) throw HttpError.badRequest(`Allocations add up to ${money(sum)}, not the call total ${money(total)}`);
  } else {
    shares = proRata(
      total,
      positions.map((p) => ({ key: p, weight: p.commitment.commitmentAmount })),
    );
    if (!shares.length) throw HttpError.badRequest('No investor has an open, unfunded commitment to this fund');
  }
  for (const s of shares) {
    if (s.amount.lte(0)) throw HttpError.badRequest(`Allocation for ${s.key.commitment.client.name} must be positive`);
    if (s.amount.gt(s.key.uncalled)) {
      throw HttpError.badRequest(`${s.key.commitment.client.name}: ${money(s.amount)} exceeds the unfunded commitment of ${money(s.key.uncalled)}`);
    }
  }
  return shares.map((s) => ({
    clientId: s.key.commitment.clientId,
    commitmentId: s.key.commitment.id,
    lpLegalName: s.key.commitment.client.name,
    commitmentAmount: s.key.commitment.commitmentAmount,
    uncalledBefore: s.key.uncalled,
    amount: s.amount,
  }));
}

export async function staffCallView(c: CallRow) {
  const userIds = [c.makerId, c.checkerId, ...c.allocations.flatMap((a) => a.payments.map((p) => p.recordedById))].filter((x): x is string => !!x);
  const people = userIds.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = (id: string | null | undefined) => {
    if (!id) return null;
    const u = people.find((x) => x.id === id);
    return u ? (u.name ?? u.email) : null;
  };
  // Allocation method is not stored; infer it: equal call/commitment ratios across LPs mean pro rata.
  const liveAllocs = c.allocations.filter((a) => a.status !== 'CANCELLED' && a.totalCommitmentSnapshot.gt(0));
  const ratios = new Set(liveAllocs.map((a) => a.callAmount.div(a.totalCommitmentSnapshot).toDecimalPlaces(4).toString()));
  const allocationMethod = liveAllocs.length === 0 ? null : ratios.size <= 1 ? 'PRO_RATA' : 'EXPLICIT';
  const allocIds = c.allocations.map((a) => a.id);
  const evidence = allocIds.length
    ? await prisma.fundingEvidence.findMany({ where: { allocationId: { in: allocIds } }, orderBy: { confirmedAt: 'asc' } })
    : [];
  const files = evidence.length ? await prisma.fileObject.findMany({ where: { id: { in: evidence.map((e) => e.fileId) } }, select: { id: true, name: true, size: true } }) : [];
  const fileBy = new Map(files.map((f) => [f.id, f]));
  const total = (k: 'callAmount' | 'amountPaid') => c.allocations.filter((a) => a.status !== 'CANCELLED').reduce((s, a) => s.add(a[k]), ZERO);
  const allocated = total('callAmount');
  const paid = total('amountPaid');
  return {
    id: c.id,
    ref: c.ref,
    fundId: c.fundId,
    fundRef: c.fund.ref,
    fundName: c.fund.name,
    callNo: c.callNo,
    callLabel: callNoLabel(c.callNo),
    callPercent: c.callPercent?.toString() ?? null,
    totalAmount: money(c.totalAmount),
    currency: c.currency,
    callDate: isoDay(c.transactionDate),
    dueDate: isoDay(c.dueDate),
    purpose: c.purpose,
    wire: wireView(c.wireJson),
    status: c.status,
    makerId: c.makerId,
    makerName: nameOf(c.makerId),
    checkerId: c.checkerId,
    checkerName: nameOf(c.checkerId),
    allocationMethod,
    amountPaid: money(paid),
    approvedAt: c.approvedAt,
    issuedAt: c.issuedAt,
    cancelledAt: c.cancelledAt,
    cancelReason: c.cancelReason,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    totals: { allocated: money(allocated), paid: money(paid), outstanding: money(D.max(ZERO, allocated.sub(paid))) },
    allocations: c.allocations.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      clientRef: a.client.ref,
      clientName: a.client.name,
      lpLegalName: a.lpLegalNameSnapshot,
      commitmentId: a.commitmentId,
      investorAccountRef: a.commitment.investorAccountRef,
      totalCommitment: money(a.totalCommitmentSnapshot),
      totalCommitmentSnapshot: money(a.totalCommitmentSnapshot),
      uncalledBefore: money(a.uncalledBeforeSnapshot),
      uncalledBeforeSnapshot: money(a.uncalledBeforeSnapshot),
      callAmount: money(a.callAmount),
      amountPaid: money(a.amountPaid),
      outstanding: money(D.max(ZERO, a.callAmount.sub(a.amountPaid))),
      status: a.status,
      acknowledgedAt: a.acknowledgedAt,
      version: a.version,
      payments: a.payments.map((p) => ({
        id: p.id,
        allocationId: a.id,
        amount: money(p.amount),
        paidAt: p.recordedAt,
        recordedAt: p.recordedAt,
        reference: p.bankReference,
        bankReference: p.bankReference,
        recordedById: p.recordedById,
        recordedByName: nameOf(p.recordedById),
        evidenceId: p.confirmationId,
      })),
      evidence: evidence
        .filter((e) => e.allocationId === a.id)
        .map((e) => ({
          id: e.id,
          fileId: e.fileId,
          fileName: fileBy.get(e.fileId)?.name ?? null,
          size: fileBy.get(e.fileId)?.size ?? null,
          sha256: e.sha256,
          amountClaimed: e.amountClaimed ? money(e.amountClaimed) : null,
          notes: e.notes,
          uploadedAt: e.confirmedAt,
          uploadedById: e.confirmedById,
          matchedAt: e.matchedAt,
          matchedById: e.matchedById,
          downloadUrl: signedDownloadUrl(e.fileId),
        })),
    })),
  };
}

export function callNoticeLines(c: CallRow, a: CallRow['allocations'][number]): PdfLine[] {
  const w = readWire(c.wireJson);
  const ref = callReference(c.wireJson, c.callNo, a.commitment.investorAccountRef, a.client.ref);
  const cur = c.currency;
  return [
    { text: c.fund.name, bold: true, size: 12 },
    { text: `${callNoLabel(c.callNo)}  (${c.ref})`, gap: 22 },
    { text: `Investor: ${a.lpLegalNameSnapshot}` },
    { text: `Investor account: ${a.commitment.investorAccountRef ?? a.client.ref}`, gap: 22 },
    { text: `Issue date: ${isoDay(c.issuedAt ?? new Date())}` },
    { text: `Due date: ${isoDay(c.dueDate)}`, gap: 22 },
    { text: `Total commitment: ${fmtMoney(money(a.totalCommitmentSnapshot), cur)}` },
    { text: `Unfunded before this call: ${fmtMoney(money(a.uncalledBeforeSnapshot), cur)}` },
    { text: `Amount due under this call: ${fmtMoney(money(a.callAmount), cur)}`, bold: true, gap: 22 },
    { text: `Purpose: ${(c.purpose ?? 'Capital call').slice(0, 110)}`, gap: 22 },
    { text: 'Wiring instructions', bold: true },
    { text: `Beneficiary: ${w?.accountName || c.fund.name}` },
    { text: `Bank: ${w?.bank || '(see fund administrator)'}` },
    ...(w?.abaRouting ? [{ text: `ABA/Routing: ${w.abaRouting}` }] : []),
    ...(w?.swift ? [{ text: `SWIFT: ${w.swift}` }] : []),
    { text: `Account: ${w?.accountNumberMasked ?? '****'}` },
    { text: `Reference: ${ref}`, gap: 26 },
    { text: 'Acknowledging this notice does not record payment. Payment is confirmed once received and matched.', size: 8 },
  ];
}

/** Issue: one PDF notice per LP (published document), an LP notice and notifications. */
export async function issueCallArtefacts(tx: Prisma.TransactionClient, c: CallRow, actorId: string) {
  for (const a of c.allocations) {
    if (a.status === 'CANCELLED') continue;
    const pdf = renderPdf('CAPITAL CALL NOTICE', callNoticeLines(c, a));
    // Use the canonical call reference (what the Capital calls list shows) so notice titles match it.
    const label = c.ref;
    await publishClientPdf(tx, {
      name: `${label} Capital Call Notice`,
      category: 'CALL_NOTICE',
      type: 'capital',
      clientId: a.clientId,
      fundId: c.fundId,
      sourceType: 'CAPITAL_CALL_ALLOCATION',
      sourceRefId: a.id,
      relatedType: 'capital_call',
      relatedId: c.id,
      relatedLabel: `${c.fund.name} ${label}`,
      pdf,
      fileName: `${c.ref}-${a.client.ref}-notice.pdf`,
      actorId,
      checkerId: c.checkerId,
      documentDate: new Date(),
    });
    const due = isoDay(c.dueDate);
    await tx.lpNotice.create({
      data: {
        ref: await seqRef(tx, 'lp_notice_capital', 'CCN-', 5),
        title: `${label} capital call issued · ${c.fund.name}`,
        body: `Dear Investor,\n\n${label} has been issued for ${fmtMoney(money(a.callAmount), c.currency)} with a due date of ${due}.\n\nPlease acknowledge this notice and arrange payment using the wiring instructions on the call notice.\n\nReference: ${callReference(c.wireJson, c.callNo, a.commitment.investorAccountRef, a.client.ref)}`,
        category: 'CAPITAL_CALL',
        targetType: 'ORG',
        fundId: c.fundId,
        clientId: a.clientId,
        requiresAcknowledgement: true,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedById: actorId,
        approvedById: c.checkerId,
        createdById: c.makerId,
      },
    });
    await notifyClientMembers(tx, a.clientId, {
      type: 'capital_call.issued',
      title: `Capital call ${label} · ${c.fund.name}`,
      body: `${fmtMoney(money(a.callAmount), c.currency)} due ${due}.`,
      link: `/capital-calls/${a.id}`,
      email: true,
    });
  }
}

/** Header status from its allocations once issued. */
export function rollUpStatus(allocs: { status: string; amountPaid: Dec }[]): 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' {
  const live = allocs.filter((a) => a.status !== 'CANCELLED');
  if (live.length && live.every((a) => a.status === 'PAID')) return 'PAID';
  if (live.some((a) => a.amountPaid.gt(0))) return 'PARTIALLY_PAID';
  return 'ISSUED';
}
