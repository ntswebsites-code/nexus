import { z } from 'zod';
import { config } from '../../../config';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import { enqueue } from '../../../lib/outbox';
import { queueInvesteeMail } from '../remainders/mail';
import { isWatermarkable, watermarkFile } from '../remainders/watermark';
import { readFileObject } from '../../../lib/storage';
import type { InvesteeContext } from '../investee.context';
import { isoDay, newToken, refs, requireSigner, sha256, type Tx } from './store';

const NOW = () => new Date();
const DAY_MS = 86_400_000;

async function companyDocument(companyId: string, documentId: string) {
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId }, select: { id: true, name: true, ref: true } });
  if (!doc) throw HttpError.notFound('Document not found in this workspace');
  const version = await prisma.documentVersion.findFirst({ where: { documentId }, orderBy: { version: 'desc' }, select: { fileId: true, sha256: true } });
  if (!version) throw HttpError.badRequest('This document has no stored file');
  return { doc, version };
}

// ---------------------------------------------------------------- signature requests

export const signRequestSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string().trim().min(3).max(200).optional(),
  message: z.string().trim().max(1000).optional(),
  signers: z.array(z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email().max(254) })).min(1).max(8),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});
export const voidSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const publicSignSchema = z.object({
  action: z.enum(['SIGN', 'DECLINE']),
  name: z.string().trim().min(2).max(120).optional(),
  consent: z.boolean().optional(),
  reason: z.string().trim().max(300).optional(),
});

// INO-014: recipients land on a portal page (document, recipient, expiry, watermark notice) instead of a raw API download.
const shareLandingUrl = (token: string) => `${config.portalUrls.company}/sign/share/${encodeURIComponent(token)}`;
const signLink = (token: string) => `${config.portalUrls.company}/sign/${encodeURIComponent(token)}`;

async function queueSignerMail(tx: Tx, a: { companyId: string; requestId: string; signerId: string; to: string; name: string; company: string; title: string; token: string; expiresAt: Date; message?: string | null; reminder?: number }) {
  // Goes to the email adapter through the worker; the delivery is recorded in investee_mail_log (one mail per signer and reminder number).
  await queueInvesteeMail(tx, {
    companyId: a.companyId,
    kind: a.reminder ? 'SIGN_REMINDER' : 'SIGN_REQUEST',
    subjectType: 'investee_sign_request',
    subjectId: a.requestId,
    dedupeKey: `sign:${a.signerId}:${a.reminder ?? 0}`,
    to: a.to,
    subject: `${a.reminder ? 'Reminder: ' : ''}${a.company} asks you to sign "${a.title}"`,
    text:
      `Hello ${a.name},

${a.company} has asked you to review and sign "${a.title}".
` +
      (a.message ? `
${a.message}
` : '') +
      `
Open the document and sign here (valid until ${isoDay(a.expiresAt)}):
${signLink(a.token)}

` +
      `If you were not expecting this, you can ignore this email.`,
  });
}

type RequestRow = Awaited<ReturnType<typeof loadRequests>>[number];
async function loadRequests(companyId: string, where: object = {}) {
  const rows = await prisma.investeeSignRequest.findMany({ where: { companyId, ...where }, orderBy: { createdAt: 'desc' }, take: 100, include: { signers: true } });
  const expired = rows.filter((r) => r.status === 'PENDING' && r.expiresAt < NOW());
  if (expired.length) {
    await prisma.investeeSignRequest.updateMany({ where: { id: { in: expired.map((r) => r.id) }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    for (const r of expired) r.status = 'EXPIRED';
  }
  return rows;
}

function requestView(r: RequestRow) {
  return {
    id: r.id,
    ref: r.ref,
    documentId: r.documentId,
    title: r.title,
    message: r.message,
    status: r.status,
    docSha256: r.docSha256,
    expiresAt: r.expiresAt.toISOString(),
    createdBy: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
    reminderCount: r.reminderCount,
    remindedAt: r.remindedAt?.toISOString() ?? null,
    signers: r.signers.map((s) => ({ id: s.id, name: s.name, email: s.email, status: s.status, signedName: s.signedName, signedAt: s.signedAt?.toISOString() ?? null, evidenceSha: s.evidenceSha })),
  };
}

export async function companySignRequests(companyId: string) {
  return (await loadRequests(companyId)).map(requestView);
}

export async function createSignRequest(c: InvesteeContext, name: string, body: z.infer<typeof signRequestSchema>, audit: AuditContext) {
  requireSigner(c, 'send documents for signature');
  const { doc, version } = await companyDocument(c.company.id, body.documentId);
  const emails = body.signers.map((s) => s.email);
  if (new Set(emails).size !== emails.length) throw HttpError.badRequest('Each signer needs a different e-mail address');
  const expiresAt = new Date(Date.now() + (body.expiresInDays ?? 14) * DAY_MS);
  const created = await prisma.$transaction(async (tx) => {
    const tokens = body.signers.map(() => newToken());
    const req = await tx.investeeSignRequest.create({
      data: {
        ref: await refs.signRequest(tx),
        companyId: c.company.id,
        documentId: doc.id,
        title: (body.title ?? doc.name).slice(0, 200),
        message: body.message ?? null,
        docSha256: version.sha256,
        expiresAt,
        createdById: c.userId,
        createdByName: name.slice(0, 120),
        signers: { create: body.signers.map((s, i) => ({ name: s.name, email: s.email, tokenHash: sha256(tokens[i]!) })) },
      },
      include: { signers: true },
    });
    for (let i = 0; i < body.signers.length; i++) {
      const signer = req.signers.find((x) => x.email === body.signers[i]!.email)!;
      await queueSignerMail(tx, { companyId: c.company.id, requestId: req.id, signerId: signer.id, to: body.signers[i]!.email, name: body.signers[i]!.name, company: c.company.name, title: req.title, token: tokens[i]!, expiresAt, message: body.message });
    }
    await writeAudit(tx, audit, { action: 'company.signature.requested', objectType: 'investee_sign_request', objectId: req.id, after: { ref: req.ref, documentId: doc.id, signers: emails.length, docSha256: version.sha256 } });
    return req;
  });
  return requestView(created);
}

export async function remindSignRequest(c: InvesteeContext, id: string, audit: AuditContext) {
  requireSigner(c, 'remind signers');
  const req = (await loadRequests(c.company.id, { id }))[0];
  if (!req) throw HttpError.notFound('Signature request not found');
  if (req.status !== 'PENDING') throw HttpError.conflict(`A ${req.status} request cannot be reminded`, 'invalid_state');
  if (req.reminderCount >= 5) throw HttpError.conflict('The reminder limit for this request is reached', 'reminder_limit');
  if (req.remindedAt && Date.now() - req.remindedAt.getTime() < 3_600_000) throw HttpError.conflict('A reminder was sent less than an hour ago', 'too_soon');
  const pending = req.signers.filter((s) => s.status === 'PENDING');
  await prisma.$transaction(async (tx) => {
    for (const s of pending) {
      // The earlier link is replaced: only the hash is stored, so a reminder carries a fresh token.
      const token = newToken();
      await tx.investeeSigner.update({ where: { id: s.id }, data: { tokenHash: sha256(token) } });
      await queueSignerMail(tx, { companyId: c.company.id, requestId: req.id, signerId: s.id, to: s.email, name: s.name, company: c.company.name, title: req.title, token, expiresAt: req.expiresAt, message: req.message, reminder: req.reminderCount + 1 });
    }
    await tx.investeeSignRequest.update({ where: { id: req.id }, data: { remindedAt: new Date(), reminderCount: { increment: 1 } } });
    await writeAudit(tx, audit, { action: 'company.signature.reminded', objectType: 'investee_sign_request', objectId: req.id, after: { signers: pending.length } });
  });
  return requestView((await loadRequests(c.company.id, { id }))[0]!);
}

export async function voidSignRequest(c: InvesteeContext, id: string, body: z.infer<typeof voidSchema>, audit: AuditContext) {
  requireSigner(c, 'void a signature request');
  await prisma.$transaction(async (tx) => {
    const req = await tx.investeeSignRequest.findFirst({ where: { id, companyId: c.company.id } });
    if (!req) throw HttpError.notFound('Signature request not found');
    const claim = await tx.investeeSignRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: body.reason } });
    if (claim.count === 0) throw HttpError.conflict(`A ${req.status} request cannot be voided`, 'invalid_state');
    // Invalidate every outstanding link.
    for (const s of await tx.investeeSigner.findMany({ where: { requestId: req.id, status: 'PENDING' } })) {
      await tx.investeeSigner.update({ where: { id: s.id }, data: { tokenHash: sha256(newToken()) } });
    }
    await writeAudit(tx, audit, { action: 'company.signature.voided', objectType: 'investee_sign_request', objectId: req.id, before: { status: req.status }, after: { reason: body.reason } });
  });
  return requestView((await loadRequests(c.company.id, { id }))[0]!);
}

async function signerByToken(token: string) {
  const signer = await prisma.investeeSigner.findUnique({ where: { tokenHash: sha256(token) }, include: { request: true } });
  if (!signer) throw HttpError.notFound('This signing link is not valid');
  const req = signer.request;
  const status = req.status === 'PENDING' && req.expiresAt < NOW() ? 'EXPIRED' : req.status;
  return { signer, req, status };
}

export async function publicSignInfo(token: string) {
  const { signer, req, status } = await signerByToken(token);
  const company = await prisma.portfolioCompany.findUnique({ where: { id: req.companyId }, select: { name: true } });
  const doc = await prisma.document.findUnique({ where: { id: req.documentId }, select: { name: true } });
  return {
    title: req.title,
    message: req.message,
    company: company?.name ?? '',
    documentName: doc?.name ?? '',
    docSha256: req.docSha256,
    signerName: signer.name,
    signerStatus: signer.status,
    requestStatus: status,
    expiresAt: req.expiresAt.toISOString(),
    consentText: `I have read "${req.title}" and I agree to sign it electronically. My typed name is my signature.`,
  };
}

export async function publicSignDocument(token: string) {
  const { req, status } = await signerByToken(token);
  if (status !== 'PENDING') throw HttpError.conflict(`This request is ${status.toLowerCase()}`, 'invalid_state');
  const v = await prisma.documentVersion.findFirst({ where: { documentId: req.documentId }, orderBy: { version: 'desc' } });
  if (!v) throw HttpError.notFound('Document not found');
  const { file, data } = await readFileObject(v.fileId);
  if (sha256(data) !== req.docSha256) throw HttpError.conflict('The document changed after the request was sent', 'document_changed');
  return { file, data };
}

export async function publicSign(token: string, body: z.infer<typeof publicSignSchema>, ip: string | null) {
  const { signer, req, status } = await signerByToken(token);
  if (status !== 'PENDING') throw HttpError.conflict(`This request is ${status.toLowerCase()}`, 'invalid_state');
  if (signer.status !== 'PENDING') throw HttpError.conflict('You have already responded to this request', 'invalid_state');
  const audit: AuditContext = { actorId: null, actorRole: `signer:${signer.email}`, portal: 'company', ip, requestId: null };
  if (body.action === 'SIGN') {
    if (!body.consent) throw HttpError.badRequest('Confirm that you agree to sign electronically');
    if (!body.name) throw HttpError.badRequest('Type your full name to sign', [{ path: 'name', message: 'Type your full name' }]);
    // INO-012: the typed name is the signature, so it must be the person the request was sent to.
    const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm(body.name) !== norm(signer.name)) {
      throw HttpError.badRequest(`The name must match the person this request was sent to (${signer.name})`, [{ path: 'name', message: `Type your name exactly as invited: ${signer.name}` }]);
    }
    const when = new Date();
    const evidence = sha256([req.docSha256, signer.email, body.name, when.toISOString()].join('|'));
    await prisma.$transaction(async (tx) => {
      const claim = await tx.investeeSigner.updateMany({ where: { id: signer.id, status: 'PENDING' }, data: { status: 'SIGNED', signedName: body.name, signedAt: when, signedIp: ip?.slice(0, 64) ?? null, evidenceSha: evidence } });
      if (claim.count === 0) throw HttpError.conflict('You have already responded to this request', 'invalid_state');
      const left = await tx.investeeSigner.count({ where: { requestId: req.id, status: { not: 'SIGNED' } } });
      if (left === 0) {
        await tx.investeeSignRequest.update({ where: { id: req.id }, data: { status: 'COMPLETED', completedAt: when } });
        await enqueue(tx, 'notify.users', { userIds: [req.createdById], type: 'investee.signature_completed', title: `${req.ref} is fully signed`, body: req.title, link: '/signatures' });
      }
      await writeAudit(tx, audit, { action: 'company.signature.signed', objectType: 'investee_sign_request', objectId: req.id, after: { signer: signer.email, evidenceSha: evidence } });
    });
    return { status: (await prisma.investeeSignRequest.findUniqueOrThrow({ where: { id: req.id } })).status, evidenceSha: evidence };
  }
  await prisma.$transaction(async (tx) => {
    await tx.investeeSigner.update({ where: { id: signer.id }, data: { status: 'DECLINED' } });
    await tx.investeeSignRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: `Declined by ${signer.name}${body.reason ? `: ${body.reason}` : ''}`.slice(0, 300) } });
    await enqueue(tx, 'notify.users', { userIds: [req.createdById], type: 'investee.signature_declined', title: `${req.ref} was declined`, body: `${signer.name} declined to sign ${req.title}`, link: '/signatures' });
    await writeAudit(tx, audit, { action: 'company.signature.declined', objectType: 'investee_sign_request', objectId: req.id, after: { signer: signer.email } });
  });
  return { status: 'VOIDED', evidenceSha: null };
}

// ---------------------------------------------------------------- share links

export const shareLinkSchema = z.object({
  documentId: z.string().uuid(),
  recipient: z.string().trim().min(2).max(160),
  /** When given, the link is e-mailed to this address through the email adapter. */
  recipientEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  expiresInDays: z.number().int().min(1).max(7).optional(),
});

type LinkRow = Awaited<ReturnType<typeof prisma.investeeShareLink.findMany>>[number];
const linkView = (l: LinkRow, docName: string) => ({
  id: l.id,
  documentId: l.documentId,
  documentName: docName,
  recipient: l.recipient,
  expiresAt: l.expiresAt.toISOString(),
  revokedAt: l.revokedAt?.toISOString() ?? null,
  status: l.revokedAt ? 'REVOKED' : l.expiresAt < NOW() ? 'EXPIRED' : 'ACTIVE',
  accessCount: l.accessCount,
  lastAccessAt: l.lastAccess?.toISOString() ?? null,
  createdAt: l.createdAt.toISOString(),
});

export async function listShareLinks(companyId: string) {
  const rows = await prisma.investeeShareLink.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const docs = await prisma.document.findMany({ where: { companyId, id: { in: rows.map((r) => r.documentId) } }, select: { id: true, name: true } });
  const names = new Map(docs.map((d) => [d.id, d.name]));
  return rows.map((r) => linkView(r, names.get(r.documentId) ?? ''));
}

/** The raw link is returned once and never stored; only its hash is kept. */
export async function createShareLink(c: InvesteeContext, body: z.infer<typeof shareLinkSchema>, audit: AuditContext) {
  const { doc, version } = await companyDocument(c.company.id, body.documentId);
  const stored = await prisma.fileObject.findUnique({ where: { id: version.fileId }, select: { mime: true } });
  if (!stored || !isWatermarkable(stored.mime)) throw new HttpError(415, 'not_watermarkable', 'Only PDF, image and text files can be shared by link, because every copy is watermarked');
  const token = newToken();
  const row = await prisma.$transaction(async (tx) => {
    const l = await tx.investeeShareLink.create({
      data: { companyId: c.company.id, documentId: doc.id, tokenHash: sha256(token), recipient: body.recipient, expiresAt: new Date(Date.now() + (body.expiresInDays ?? 7) * DAY_MS), createdBy: c.userId },
    });
    if (body.recipientEmail) {
      await queueInvesteeMail(tx, {
        companyId: c.company.id,
        kind: 'SHARE_LINK',
        subjectType: 'investee_share_link',
        subjectId: l.id,
        dedupeKey: `share:${l.id}:0`,
        to: body.recipientEmail,
        subject: `${c.company.name} shared "${doc.name}" with you`,
        text: `Hello,

${c.company.name} has shared "${doc.name}" with you. The copy you download is watermarked with your name and the link expires on ${isoDay(l.expiresAt)}.

Download it here:
${shareLandingUrl(token)}

If you were not expecting this, you can ignore this email.`,
      });
    }
    await writeAudit(tx, audit, { action: 'company.share_link.created', objectType: 'investee_share_link', objectId: l.id, after: { documentId: doc.id, recipient: body.recipient, emailed: !!body.recipientEmail, expiresAt: l.expiresAt.toISOString() } });
    return l;
  });
  return { emailed: !!body.recipientEmail, ...linkView(row, doc.name), url: shareLandingUrl(token), fileUrl: `${config.publicApiUrl}/api/v1/investee-public/share/${encodeURIComponent(token)}/file`, previewUrl: `${config.publicApiUrl}/api/v1/investee-public/share/${encodeURIComponent(token)}` };
}

export async function revokeShareLink(c: InvesteeContext, id: string, audit: AuditContext) {
  await prisma.$transaction(async (tx) => {
    const l = await tx.investeeShareLink.findFirst({ where: { id, companyId: c.company.id } });
    if (!l) throw HttpError.notFound('Share link not found');
    if (l.revokedAt) return;
    await tx.investeeShareLink.update({ where: { id: l.id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, audit, { action: 'company.share_link.revoked', objectType: 'investee_share_link', objectId: l.id, after: { documentId: l.documentId } });
  });
  return listShareLinks(c.company.id);
}

async function activeLink(token: string) {
  const link = await prisma.investeeShareLink.findUnique({ where: { tokenHash: sha256(token) } });
  if (!link || link.revokedAt || link.expiresAt < NOW()) throw new HttpError(410, 'link_expired', 'This link has expired or was withdrawn');
  return link;
}

export async function publicShareInfo(token: string) {
  const link = await activeLink(token);
  const [doc, company] = await Promise.all([prisma.document.findUnique({ where: { id: link.documentId }, select: { name: true } }), prisma.portfolioCompany.findUnique({ where: { id: link.companyId }, select: { name: true } })]);
  return { documentName: doc?.name ?? '', company: company?.name ?? '', recipient: link.recipient, expiresAt: link.expiresAt.toISOString() };
}

/** Serves the file and counts the access. PDFs, images and text carry a watermark naming the recipient; other formats are refused. */
export async function publicShareFile(token: string) {
  const link = await activeLink(token);
  const v = await prisma.documentVersion.findFirst({ where: { documentId: link.documentId }, orderBy: { version: 'desc' } });
  if (!v) throw HttpError.notFound('Document not found');
  const { file, data } = await readFileObject(v.fileId);
  const company = await prisma.portfolioCompany.findUnique({ where: { id: link.companyId }, select: { name: true } });
  const mark = `Shared with ${link.recipient} by ${company?.name ?? 'the company'} on ${isoDay(NOW())}. Link expires ${isoDay(link.expiresAt)}. Do not forward.`;
  const marked = await watermarkFile({ mime: file.mime, name: file.name }, data, mark, `Confidential - ${link.recipient}`);
  await prisma.investeeShareLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastAccess: NOW() } });
  return { file: { ...file, mime: marked.mime, name: marked.name }, data: marked.data, watermark: mark };
}
