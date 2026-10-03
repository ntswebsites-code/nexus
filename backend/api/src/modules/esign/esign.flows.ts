import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { storeFile } from '../../lib/storage';
import { createRequest, resolveSigners, type EsignActor, type SignerInput } from './esign.service';
import { registerCompletionHook } from './esign.hooks';

/**
 * Concrete signing flows built on the generic "request signature on document X for subject Y" API:
 *   COMMITMENT                  LP subscription / commitment agreement -> commitment becomes ACTIVE
 *   CAPITAL_CALL_ALLOCATION     LP capital call acknowledgement        -> allocation acknowledged_at / by
 * Each generates the PDF, files it in the document store and opens the request with the right signatories.
 */

const clean = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const money = (v: Prisma.Decimal | number, ccy: string) => `${ccy} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : 'to be confirmed');

async function simplePdf(title: string, rows: [string, string][], paragraphs: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  let y = 790;
  const line = (text: string, o: { f?: typeof font; size?: number; x?: number } = {}) => {
    const f = o.f ?? font;
    const size = o.size ?? 10;
    const x = o.x ?? 56;
    const words = clean(text).split(' ');
    let cur = '';
    const flush = () => {
      if (y < 70) {
        page = doc.addPage([595.28, 841.89]);
        y = 790;
      }
      page.drawText(cur, { x, y, size, font: f, color: rgb(0.1, 0.12, 0.16) });
      y -= size + 5;
      cur = '';
    };
    for (const w of words) {
      const probe = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(probe, size) > 595.28 - x - 56 && cur) {
        flush();
        cur = w;
      } else cur = probe;
    }
    if (cur) flush();
  };
  line('Matanho Nexus', { f: bold, size: 9 });
  y -= 6;
  line(title, { f: bold, size: 18 });
  y -= 10;
  for (const [k, v] of rows) {
    page.drawText(clean(k), { x: 56, y, size: 9, font: bold, color: rgb(0.4, 0.43, 0.48) });
    line(v, { x: 190, size: 10 });
  }
  y -= 12;
  for (const p of paragraphs) {
    line(p);
    y -= 6;
  }
  return Buffer.from(await doc.save());
}

/** Files the generated PDF as a document in the store (legal, requires signature). */
async function fileDocument(actor: EsignActor, o: { name: string; pdf: Buffer; clientId: string; fundId: string; relatedType: string; relatedId: string; relatedLabel: string; category: string }) {
  const stored = await storeFile({ name: `${o.name}.pdf`, mime: 'application/pdf', data: o.pdf, uploadedById: actor.userId });
  return prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'document');
    const doc = await tx.document.create({
      data: {
        ref,
        name: o.name,
        type: 'legal',
        label: 'Signature required',
        classification: 'Client',
        status: 'Draft',
        clientId: o.clientId,
        fundId: o.fundId,
        relatedType: o.relatedType,
        relatedId: o.relatedId,
        relatedLabel: o.relatedLabel,
        requiresSignature: true,
        category: o.category,
        sourceType: 'GP_UPLOAD',
        year: new Date().getUTCFullYear(),
        documentDate: new Date(),
        ownerName: 'Investor Services',
        createdBy: actor.userId,
        makerId: actor.userId,
      },
    });
    await tx.documentVersion.create({ data: { documentId: doc.id, version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: actor.userId } });
    await writeAudit(tx, { actorId: actor.userId, actorRole: actor.role, portal: actor.portal, ip: actor.ip, requestId: actor.requestId ?? null }, { action: 'document.generated_for_signature', objectType: 'document', objectId: doc.id, after: { ref, relatedType: o.relatedType, relatedId: o.relatedId } });
    return doc;
  });
}

async function lpSignatoryUserIds(clientId: string, only?: string[]): Promise<string[]> {
  const links = await prisma.clientUser.findMany({ where: { clientId, revokedAt: null, status: { not: 'SUSPENDED' }, user: { isActive: true } }, select: { userId: true, lpRole: true, investorRole: true } });
  const role = (l: (typeof links)[number]) => l.lpRole ?? ({ admin: 'MANAGER', finance: 'SIGNATORY' } as Record<string, string>)[l.investorRole] ?? 'VIEWER';
  const eligible = links.filter((l) => role(l) === 'SIGNATORY' || role(l) === 'MANAGER');
  const chosen = only?.length ? eligible.filter((l) => only.includes(l.userId)) : eligible.some((l) => role(l) === 'SIGNATORY') ? eligible.filter((l) => role(l) === 'SIGNATORY') : eligible;
  if (!chosen.length) throw HttpError.badRequest('This investor has no authorised signatory with portal access');
  return chosen.map((l) => l.userId);
}

export interface FlowOptions {
  signerUserIds?: string[];
  /** Matanho staff user who counter-signs after the investor (sequential order). */
  countersignerUserId?: string;
  expiresInDays?: number;
  send?: boolean;
}

export async function requestCommitmentSignature(actor: EsignActor, commitmentId: string, opts: FlowOptions = {}) {
  const c = await prisma.fundCommitment.findUnique({ where: { id: commitmentId }, include: { client: true, fund: true } });
  if (!c) throw HttpError.notFound('Commitment not found');
  if (c.status === 'CLOSED') throw HttpError.conflict('This commitment is closed', 'commitment_closed');
  const userIds = await lpSignatoryUserIds(c.clientId, opts.signerUserIds);
  const signers: SignerInput[] = userIds.map((userId) => ({ userId, kind: 'LP', clientId: c.clientId, orderNo: 1 }));
  if (opts.countersignerUserId) signers.push({ userId: opts.countersignerUserId, kind: 'STAFF', orderNo: 2, roleLabel: 'Matanho Nexus - countersignature' });
  const signingOrder = opts.countersignerUserId ? 'SEQUENTIAL' : 'PARALLEL';
  await resolveSigners({ signers, signingOrder, clientId: c.clientId });

  const pdf = await simplePdf(
    'Subscription and Commitment Agreement',
    [
      ['Investor', c.client.name],
      ['Investor reference', c.client.ref],
      ['Fund', c.fund.name],
      ['Capital commitment', money(c.commitmentAmount, c.currency)],
      ['Effective date', day(c.effectiveDate)],
      ['Investor account', c.investorAccountRef ?? 'to be assigned'],
    ],
    [
      `The Investor named above irrevocably subscribes for an interest in ${c.fund.name} (the "Fund") and commits to contribute capital up to the amount shown, to be drawn by capital calls issued under the Fund's constitutional documents.`,
      'The Investor confirms that it has received and read the Fund offering documents, that the investor information held by Matanho is accurate and complete, and that the person signing is authorised to bind the Investor.',
      'This agreement is governed by the terms of the Fund offering documents. Electronic signature has the same effect as a handwritten signature; the signing record, document hash and certificate of completion form part of this agreement.',
    ],
  );
  const doc = await fileDocument(actor, { name: `Subscription Agreement - ${c.client.ref} - ${c.fund.shortName}`, pdf, clientId: c.clientId, fundId: c.fundId, relatedType: 'COMMITMENT', relatedId: c.id, relatedLabel: `${c.fund.shortName} commitment`, category: 'LEGAL' });
  return createRequest(actor, {
    title: `Subscription agreement - ${c.client.name} - ${c.fund.shortName}`,
    message: `Please review and sign the subscription and commitment agreement for ${c.fund.name}.`,
    documentId: doc.id,
    signingOrder,
    signers,
    expiresInDays: opts.expiresInDays,
    subjectType: 'COMMITMENT',
    subjectId: c.id,
    clientId: c.clientId,
    send: opts.send,
  });
}

export async function requestCapitalCallAckSignature(actor: EsignActor, allocationId: string, opts: FlowOptions = {}) {
  const a = await prisma.capitalCallAllocation.findUnique({ where: { id: allocationId }, include: { call: { include: { fund: true } }, client: true } });
  if (!a) throw HttpError.notFound('Capital call allocation not found');
  if (a.acknowledgedAt) throw HttpError.conflict('This capital call is already acknowledged', 'already_acknowledged');
  if (!a.call.issuedAt || ['DRAFT', 'CANCELLED', 'PENDING_APPROVAL', 'APPROVED'].includes(a.call.status)) throw HttpError.conflict('The call has not been issued to investors', 'call_not_issued');
  const userIds = (await lpSignatoryUserIds(a.clientId, opts.signerUserIds)).slice(0, opts.signerUserIds?.length ? undefined : 1);
  const signers: SignerInput[] = userIds.map((userId) => ({ userId, kind: 'LP', clientId: a.clientId }));
  await resolveSigners({ signers, signingOrder: 'PARALLEL', clientId: a.clientId });

  const pdf = await simplePdf(
    'Capital Call Acknowledgement',
    [
      ['Investor', a.client.name],
      ['Fund', a.call.fund.name],
      ['Capital call', `${a.call.ref} (call no. ${a.call.callNo})`],
      ['Amount called', money(a.callAmount, a.call.currency)],
      ['Due date', day(a.call.dueDate)],
      ['Total commitment', money(a.totalCommitmentSnapshot, a.call.currency)],
      ['Uncalled before this call', money(a.uncalledBeforeSnapshot, a.call.currency)],
    ],
    [
      `The Investor acknowledges receipt of the capital call notice ${a.call.ref} issued by ${a.call.fund.name} and the amount and due date stated above.`,
      'Acknowledgement records receipt only. It does not change the amount called, the due date or the payment status, and it is not a confirmation of payment.',
    ],
  );
  const doc = await fileDocument(actor, { name: `Capital Call Acknowledgement - ${a.call.ref} - ${a.client.ref}`, pdf, clientId: a.clientId, fundId: a.call.fundId, relatedType: 'CAPITAL_CALL', relatedId: a.id, relatedLabel: `${a.call.ref} acknowledgement`, category: 'CALL_NOTICE' });
  return createRequest(actor, {
    title: `Capital call acknowledgement - ${a.call.ref} - ${a.client.name}`,
    message: `Please acknowledge capital call ${a.call.ref} for ${a.call.fund.shortName}; payment is due ${day(a.call.dueDate)}.`,
    documentId: doc.id,
    signingOrder: 'PARALLEL',
    signers,
    expiresInDays: opts.expiresInDays ?? Math.max(3, Math.ceil((a.call.dueDate.getTime() - Date.now()) / 86_400_000)),
    subjectType: 'CAPITAL_CALL_ALLOCATION',
    subjectId: a.id,
    clientId: a.clientId,
    send: opts.send,
  });
}

registerCompletionHook('COMMITMENT', async (tx, request, signers) => {
  const c = await tx.fundCommitment.findUnique({ where: { id: request.subjectId ?? '' } });
  if (!c || c.status !== 'PENDING') return;
  await tx.fundCommitment.update({ where: { id: c.id }, data: { status: 'ACTIVE', effectiveDate: c.effectiveDate ?? new Date(new Date().toISOString().slice(0, 10)), version: { increment: 1 } } });
  await writeAudit(tx, { actorId: null, actorRole: 'E-signature', portal: null }, { action: 'esign.commitment.executed', objectType: 'fund_commitment', objectId: c.id, before: { status: c.status }, after: { status: 'ACTIVE', esign: request.ref, signedBy: signers.map((s) => s.name) } });
});

registerCompletionHook('CAPITAL_CALL_ALLOCATION', async (tx, request, signers) => {
  const first = signers.find((s) => s.signedAt) ?? signers[0];
  const updated = await tx.capitalCallAllocation.updateMany({
    where: { id: request.subjectId ?? '', acknowledgedAt: null },
    data: { acknowledgedAt: first?.signedAt ?? new Date(), acknowledgedById: first?.userId ?? null, version: { increment: 1 } },
  });
  if (updated.count) {
    await writeAudit(tx, { actorId: first?.userId ?? null, actorRole: 'E-signature', portal: 'investor' }, { action: 'esign.capital_call.acknowledged', objectType: 'capital_call_allocation', objectId: request.subjectId ?? '', after: { esign: request.ref, acknowledgedBy: first?.name } });
  }
});
