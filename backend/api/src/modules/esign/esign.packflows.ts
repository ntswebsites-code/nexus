import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { readFileObject, storeFile } from '../../lib/storage';
import { createRequest, resolveSigners, type EsignActor, type FieldInput, type SignerInput } from './esign.service';
import { registerCompletionHook } from './esign.hooks';
import { isPdf } from './esign.logic';
import { appendSheet, buildPack, type PackRole, type PackSlot } from './esign.packs';
import { config } from '../../config';

/**
 * R4-4 signing flows built on positioned fields:
 *   COMMITMENT pack          subscription agreement + investor declarations + payment notice in ONE signed PDF
 *   TERM_SHEET_COUNTERSIGN   fund countersignature on a term sheet the company has already signed
 *   STAFF_APPROVAL           internal approval by one or more staff members (maker-checker: not the requester)
 */

const money = (v: Prisma.Decimal | number, ccy: string) => `${ccy} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : 'to be confirmed');

export interface PackFlowOptions {
  signerUserIds?: string[];
  countersignerUserId?: string;
  expiresInDays?: number;
  send?: boolean;
  reminderIntervalDays?: number;
  reminderMax?: number;
}

function fieldsFromSlots(slots: PackSlot[], emailByRole: Map<string, string>): FieldInput[] {
  return slots.map((s) => ({ signerEmail: emailByRole.get(s.roleKey)!, kind: s.kind, page: s.page, x: s.x, y: s.y, width: s.width, height: s.height, label: null }));
}

interface FiledDoc {
  name: string;
  pdf: Buffer;
  actor: EsignActor;
  relatedType: string;
  relatedId: string;
  relatedLabel: string;
  category: string;
  clientId?: string;
  fundId?: string;
  companyId?: string;
}

/** Files the generated PDF in the document store (legal, requires signature). */
async function fileGenerated(o: FiledDoc) {
  const stored = await storeFile({ name: `${o.name}.pdf`, mime: 'application/pdf', data: o.pdf, uploadedById: o.actor.userId });
  return prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'document');
    const doc = await tx.document.create({
      data: {
        ref,
        name: o.name.slice(0, 255),
        type: 'legal',
        label: 'Signature required',
        classification: o.companyId ? 'Restricted' : 'Client',
        status: 'Draft',
        clientId: o.clientId ?? null,
        fundId: o.fundId ?? null,
        companyId: o.companyId ?? null,
        relatedType: o.relatedType.slice(0, 32),
        relatedId: o.relatedId,
        relatedLabel: o.relatedLabel.slice(0, 160),
        requiresSignature: true,
        category: o.category,
        sourceType: 'GP_UPLOAD',
        year: new Date().getUTCFullYear(),
        documentDate: new Date(),
        ownerName: 'Investor Services',
        createdBy: o.actor.userId,
        makerId: o.actor.userId,
      },
    });
    await tx.documentVersion.create({ data: { documentId: doc.id, version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: o.actor.userId } });
    await writeAudit(tx, { actorId: o.actor.userId, actorRole: o.actor.role, portal: o.actor.portal, ip: o.actor.ip, requestId: o.actor.requestId ?? null }, { action: 'document.generated_for_signature', objectType: 'document', objectId: doc.id, after: { ref, relatedType: o.relatedType, relatedId: o.relatedId } });
    return doc;
  });
}

async function latestPdf(documentId: string | null | undefined): Promise<Buffer | null> {
  if (!documentId) return null;
  const v = await prisma.documentVersion.findFirst({ where: { documentId }, orderBy: { version: 'desc' } });
  if (!v) return null;
  try {
    const { data } = await readFileObject(v.fileId);
    return isPdf(data) ? data : null;
  } catch {
    return null;
  }
}

async function lpSigners(clientId: string, only?: string[]) {
  const links = await prisma.clientUser.findMany({ where: { clientId, revokedAt: null, status: { not: 'SUSPENDED' }, user: { isActive: true } }, select: { userId: true, lpRole: true, investorRole: true } });
  const role = (l: (typeof links)[number]) => l.lpRole ?? ({ admin: 'MANAGER', finance: 'SIGNATORY' } as Record<string, string>)[l.investorRole] ?? 'VIEWER';
  const eligible = links.filter((l) => role(l) === 'SIGNATORY' || role(l) === 'MANAGER');
  const chosen = only?.length ? eligible.filter((l) => only.includes(l.userId)) : eligible.some((l) => role(l) === 'SIGNATORY') ? eligible.filter((l) => role(l) === 'SIGNATORY') : eligible;
  if (!chosen.length) throw HttpError.badRequest('This investor has no authorised signatory with portal access');
  return chosen.map((l) => l.userId);
}

// ------------------------------------------------------------------ subscription / commitment pack

export async function requestCommitmentPack(actor: EsignActor, commitmentId: string, opts: PackFlowOptions = {}) {
  const c = await prisma.fundCommitment.findUnique({ where: { id: commitmentId }, include: { client: true, fund: true } });
  if (!c) throw HttpError.notFound('Commitment not found');
  if (c.status === 'CLOSED') throw HttpError.conflict('This commitment is closed', 'commitment_closed');
  const userIds = await lpSigners(c.clientId, opts.signerUserIds);
  const inputs: SignerInput[] = userIds.map((userId) => ({ userId, kind: 'LP', clientId: c.clientId, orderNo: 1 }));
  if (opts.countersignerUserId) inputs.push({ userId: opts.countersignerUserId, kind: 'STAFF', orderNo: 2, roleLabel: 'Matanho Nexus - countersignature' });
  const signingOrder = opts.countersignerUserId ? 'SEQUENTIAL' : 'PARALLEL';
  const resolved = await resolveSigners({ signers: inputs, signingOrder, clientId: c.clientId });

  const roles: PackRole[] = resolved.map((s) => ({ key: s.email, label: s.kind === 'STAFF' ? `Matanho Nexus - countersignature (${s.name})` : `Investor - ${s.name}${s.roleLabel ? ` (${s.roleLabel})` : ''}` }));
  const investorKeys = resolved.filter((s) => s.kind !== 'STAFF').map((s) => s.email);
  const everyone = resolved.map((s) => s.email);
  const pack = await buildPack({
    heading: 'Subscription and Commitment Pack',
    subtitle: `${c.client.name} - ${c.fund.name}`,
    cover: [
      ['Investor', c.client.name],
      ['Investor reference', c.client.ref],
      ['Fund', c.fund.name],
      ['Capital commitment', money(c.commitmentAmount, c.currency)],
    ],
    roles,
    sections: [
      {
        title: 'Subscription and Commitment Agreement',
        rows: [
          ['Investor', c.client.name],
          ['Fund', c.fund.name],
          ['Capital commitment', money(c.commitmentAmount, c.currency)],
          ['Effective date', day(c.effectiveDate)],
          ['Investor account', c.investorAccountRef ?? 'to be assigned'],
        ],
        paragraphs: [
          `The Investor named above irrevocably subscribes for an interest in ${c.fund.name} (the "Fund") and commits to contribute capital up to the amount shown, to be drawn by capital calls issued under the Fund's constitutional documents.`,
          'The Investor confirms that it has received and read the Fund offering documents and that the person signing is authorised to bind the Investor.',
        ],
        signedBy: everyone,
      },
      {
        title: 'Investor Declarations',
        paragraphs: [
          'The Investor declares that the investor, ownership and tax information held by Matanho Nexus is accurate and complete, and undertakes to notify Matanho Nexus promptly of any change.',
          'The Investor confirms that the capital committed is not derived from, and will not be used for, any unlawful activity, and that it will provide any information reasonably requested for anti-money laundering and sanctions screening.',
          'The Investor confirms its investor category and tax residency as recorded in its onboarding file and consents to reporting required by law.',
        ],
        signedBy: investorKeys,
      },
      {
        title: 'Payment Instructions and Notices',
        paragraphs: [
          'Capital call notices are issued through the investor portal. Payment instructions are stated in each notice and are confirmed by call-back to a number held on file; Matanho Nexus never changes payment instructions by e-mail alone.',
          'The Investor acknowledges that notices delivered through the investor portal and by e-mail to its authorised signatories are valid notice, and that it must pay by the due date stated in each capital call.',
        ],
        signedBy: investorKeys,
      },
    ],
  });
  const doc = await fileGenerated({ actor, name: `Subscription Pack - ${c.client.ref} - ${c.fund.shortName}`, pdf: pack.pdf, relatedType: 'COMMITMENT', relatedId: c.id, relatedLabel: `${c.fund.shortName} subscription pack`, category: 'LEGAL', clientId: c.clientId, fundId: c.fundId });
  return createRequest(actor, {
    title: `Subscription pack - ${c.client.name} - ${c.fund.shortName}`,
    message: `Please review and sign the subscription pack (agreement, declarations and payment notice) for ${c.fund.name}.`,
    documentId: doc.id,
    signingOrder,
    signers: inputs,
    fields: fieldsFromSlots(pack.slots, new Map(resolved.map((s) => [s.email, s.email]))),
    expiresInDays: opts.expiresInDays,
    reminderIntervalDays: opts.reminderIntervalDays,
    reminderMax: opts.reminderMax,
    subjectType: 'COMMITMENT',
    subjectId: c.id,
    clientId: c.clientId,
    send: opts.send,
  });
}

// ------------------------------------------------------------------ term sheet countersignature

export interface TermSheetFlowOptions {
  countersignerUserId: string;
  expiresInDays?: number;
  send?: boolean;
  reminderIntervalDays?: number;
  reminderMax?: number;
}

export async function requestTermSheetCountersign(actor: EsignActor, termSheetId: string, opts: TermSheetFlowOptions) {
  const ts = await prisma.termSheet.findFirst({ where: { OR: [{ id: termSheetId }, { ref: termSheetId }] }, include: { company: true } });
  if (!ts) throw HttpError.notFound('Term sheet not found');
  if (ts.status !== 'SIGNED_BY_COMPANY') throw HttpError.conflict('The company must have signed the term sheet and the fund not yet countersigned it', 'invalid_state');
  if (!opts.countersignerUserId) throw HttpError.badRequest('Choose the staff member who countersigns');
  // Segregation of duties (same rule as the term sheet service): the issuer / author cannot countersign.
  if (opts.countersignerUserId === ts.issuedById || opts.countersignerUserId === ts.createdById) {
    throw new HttpError(403, 'segregation_of_duties', 'A different person from the issuer or author must countersign this term sheet');
  }
  const inputs: SignerInput[] = [{ userId: opts.countersignerUserId, kind: 'STAFF', roleLabel: 'Fund - authorised countersignatory' }];
  const resolved = await resolveSigners({ signers: inputs, signingOrder: 'PARALLEL' });
  const signer = resolved[0]!;
  const roles: PackRole[] = [{ key: signer.email, label: `For the Fund - ${signer.name} (${signer.roleLabel ?? 'authorised countersignatory'})` }];
  const sheet = await buildPack({
    heading: `Term sheet countersignature ${ts.ref}`,
    cover_page: false,
    roles,
    sections: [
      {
        title: 'Fund countersignature',
        rows: [
          ['Term sheet', `${ts.ref} v${ts.versionNo} - ${ts.title}`],
          ['Company', ts.company.name],
          ['Investment amount', money(ts.investmentAmount, ts.currency)],
          ['Valuation', money(ts.valuation, ts.currency)],
          ['Equity', `${ts.equityPercentage.toString()}%`],
          ['Signed by the company', ts.signedAt ? ts.signedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'on record'],
        ],
        paragraphs: [
          `By signing below the Fund countersigns the term sheet ${ts.ref} as signed by ${ts.company.name}. The terms above are those on record at the time of signing; the company's own electronic signature record is part of the term sheet file.`,
          'Countersignature does not complete the transaction. Marking the term sheet executed is a separate step performed by a different member of staff.',
        ],
      },
    ],
  });
  const original = await latestPdf(ts.documentId);
  const merged = original ? await appendSheet(original, sheet) : sheet;
  const doc = await fileGenerated({ actor, name: `Term sheet countersignature - ${ts.ref}`, pdf: merged.pdf, relatedType: 'TERM_SHEET', relatedId: ts.id, relatedLabel: `${ts.ref} countersignature`, category: 'LEGAL', companyId: ts.companyId });
  return createRequest(actor, {
    title: `Countersign term sheet ${ts.ref} - ${ts.company.name}`,
    message: `Countersignature of ${ts.title} on behalf of the Fund.`,
    documentId: doc.id,
    signingOrder: 'PARALLEL',
    signers: inputs,
    fields: fieldsFromSlots(merged.slots, new Map([[signer.email, signer.email]])),
    expiresInDays: opts.expiresInDays ?? 7,
    reminderIntervalDays: opts.reminderIntervalDays,
    reminderMax: opts.reminderMax,
    subjectType: 'TERM_SHEET_COUNTERSIGN',
    subjectId: ts.id,
    companyId: ts.companyId,
    send: opts.send,
  });
}

registerCompletionHook('TERM_SHEET_COUNTERSIGN', async (tx, request, signers) => {
  const by = signers.find((s) => s.signedAt) ?? signers[0];
  const ts = await tx.termSheet.findUnique({ where: { id: request.subjectId ?? '' }, include: { company: true } });
  if (!ts) throw new HttpError(409, 'invalid_state', 'The term sheet no longer exists');
  if (by?.userId && (by.userId === ts.issuedById || by.userId === ts.createdById)) throw new HttpError(403, 'segregation_of_duties', 'A different person from the issuer or author must countersign this term sheet');
  const res = await tx.termSheet.updateMany({ where: { id: ts.id, status: 'SIGNED_BY_COMPANY' }, data: { status: 'COUNTERSIGNED', version: { increment: 1 } } });
  if (res.count !== 1) throw new HttpError(409, 'invalid_state', `Term sheet is no longer awaiting countersignature (${ts.status})`);
  await writeAudit(tx, { actorId: by?.userId ?? null, actorRole: 'E-signature', portal: 'admin' }, { action: 'term_sheet.countersigned', objectType: 'term_sheet', objectId: ts.id, before: { status: ts.status }, after: { status: 'COUNTERSIGNED', esign: request.ref, sealedSha256: request.sealedSha256 } });
  const links = await tx.companyUser.findMany({ where: { companyId: ts.companyId, status: 'active' }, select: { userId: true } });
  if (links.length) await enqueue(tx, 'notify.users', { userIds: links.map((l) => l.userId), type: 'term_sheets.countersigned', title: `Term sheet ${ts.ref} countersigned`, body: `${ts.title} has been countersigned by the fund.` });
});

// ------------------------------------------------------------------ staff approvals

export interface StaffApprovalInput {
  title: string;
  summary: string;
  /** Optional reference shown on the sheet and used to stop duplicate open approvals (e.g. POLICY-2026-04). */
  reference?: string;
  documentId?: string;
  fileId?: string;
  approverUserIds: string[];
  order?: 'SEQUENTIAL' | 'PARALLEL';
  expiresInDays?: number;
  send?: boolean;
  reminderIntervalDays?: number;
  reminderMax?: number;
}

export async function requestStaffApproval(actor: EsignActor, input: StaffApprovalInput) {
  if (!actor.userId) throw HttpError.badRequest('A signed-in staff member must raise the approval');
  const approvers = [...new Set(input.approverUserIds)];
  if (!approvers.length) throw HttpError.badRequest('Choose at least one approver');
  // Maker-checker: the person raising the approval cannot be one of the approvers.
  if (approvers.includes(actor.userId)) throw new HttpError(403, 'segregation_of_duties', 'You cannot approve your own request. Choose other approvers.');
  const order = input.order ?? 'SEQUENTIAL';
  const inputs: SignerInput[] = approvers.map((userId, i) => ({ userId, kind: 'STAFF', orderNo: i + 1, roleLabel: 'Approver' }));
  const resolved = await resolveSigners({ signers: inputs, signingOrder: order });
  const roles: PackRole[] = resolved.map((s, i) => ({ key: s.email, label: `Approver ${i + 1} - ${s.name}${s.roleLabel && s.roleLabel !== 'Approver' ? ` (${s.roleLabel})` : ''}` }));

  let source: Buffer | null = null;
  if (input.documentId || input.fileId) {
    if (input.documentId) {
      const d = await prisma.document.findFirst({ where: { OR: [{ id: input.documentId }, { ref: input.documentId }] }, select: { id: true } });
      if (!d) throw HttpError.badRequest('Document not found');
      source = await latestPdf(d.id);
    } else {
      const f = await prisma.fileObject.findUnique({ where: { id: input.fileId! }, select: { id: true, uploadedById: true } });
      if (!f || f.uploadedById !== actor.userId) throw HttpError.badRequest('File not found');
      source = (await readFileObject(f.id)).data;
    }
    if (!source || !isPdf(source)) throw HttpError.badRequest('The supporting document must be a PDF');
  }
  const sheet = await buildPack({
    heading: `Staff approval${input.reference ? ` ${input.reference}` : ''}`,
    cover_page: false,
    roles,
    sections: [
      {
        title: input.title.slice(0, 120),
        rows: [
          ['Requested by', actor.name ?? 'Matanho staff'],
          ...(input.reference ? ([['Reference', input.reference]] as [string, string][]) : []),
          ['Approvers', resolved.map((s) => s.name).join(', ')],
          ['Order', order === 'SEQUENTIAL' ? 'One after another' : 'Any order'],
        ],
        paragraphs: [input.summary.slice(0, 4000), 'By signing, each approver confirms that they reviewed the request and any attached documents and approve it. The requester cannot be an approver.'],
      },
    ],
  });
  const merged = source ? await appendSheet(source, sheet) : sheet;
  const subjectId = input.reference?.trim().slice(0, 64) || undefined;
  const doc = await fileGenerated({ actor, name: `Approval - ${input.title}`.slice(0, 200), pdf: merged.pdf, relatedType: 'STAFF_APPROVAL', relatedId: actor.userId, relatedLabel: input.title, category: 'GOVERNANCE' });
  return createRequest(actor, {
    title: `Approval: ${input.title}`.slice(0, 200),
    message: input.summary.slice(0, 1800),
    documentId: doc.id,
    signingOrder: order,
    signers: inputs,
    fields: fieldsFromSlots(merged.slots, new Map(resolved.map((s) => [s.email, s.email]))),
    expiresInDays: input.expiresInDays ?? 7,
    reminderIntervalDays: input.reminderIntervalDays ?? 1,
    reminderMax: input.reminderMax,
    subjectType: 'STAFF_APPROVAL',
    subjectId,
    send: input.send,
  });
}

registerCompletionHook('STAFF_APPROVAL', async (tx, request, signers) => {
  await writeAudit(tx, { actorId: null, actorRole: 'E-signature', portal: 'admin' }, { action: 'esign.staff_approval.approved', objectType: 'esign_request', objectId: request.id, after: { ref: request.ref, title: request.title, approvedBy: signers.map((s) => s.name), sealedSha256: request.sealedSha256 } });
  if (request.createdById) await enqueue(tx, 'notify.users', { userIds: [request.createdById], type: 'esign.approved', title: `Approved: ${request.title}`, body: `${request.ref} was approved by ${signers.map((s) => s.name).join(', ')}.`, link: `${config.portalUrls.admin}/ops/esign` });
});
