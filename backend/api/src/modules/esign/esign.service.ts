import { randomInt } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { Prisma } from '@prisma/client';
import type { PortalId } from '@matanho/shared';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { hmacHex, randomToken, safeEqualHex } from '../../lib/crypto';
import { readFileObject, storeFile } from '../../lib/storage';
import {
  CONSENT_VERSION,
  consentHash as makeConsentHash,
  consentText as makeConsentText,
  getESignAdapter,
  esignMode,
  stampPlaceholders,
  genesisHash,
  nextLink,
  sha256,
  signatureValueHash,
  type SealSigner,
  type SignatureMode,
} from '../../integrations/esign';
import {
  DEFAULT_EXPIRY_DAYS,
  MAX_REMINDERS,
  OPEN_REQUEST,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  PROOF_TTL_MS,
  REMINDER_AFTER_MS,
  TERMINAL_REQUEST,
  allSigned,
  dueSigners,
  isPdf,
  parseDrawnPng,
  type SignerKind,
} from './esign.logic';
import { runCompletionHooks } from './esign.hooks';
import { layoutCanonical, nextReminderAt, reminderDue, reminderPolicy, validateLayout, type FieldKind, MAX_REMINDER_CAP, MAX_REMINDER_INTERVAL_DAYS } from './esign.fields';

const GENESIS_EVENT = '0'.repeat(64);
const TX = { timeout: 45_000, maxWait: 10_000 } as const;

export interface EsignActor {
  userId: string | null;
  name: string | null;
  role: string | null;
  portal: PortalId | null;
  ip: string | null;
  userAgent: string | null;
  requestId?: string | null;
}

const auditCtx = (a: EsignActor): AuditContext => ({ actorId: a.userId, actorRole: a.role, portal: a.portal, ip: a.ip, requestId: a.requestId ?? null });
const ua = (a: EsignActor) => a.userAgent?.slice(0, 255) ?? null;

type Tx = Prisma.TransactionClient;
const requestInclude = { signers: { orderBy: [{ orderNo: 'asc' }, { createdAt: 'asc' }] }, fields: { orderBy: [{ page: 'asc' }, { y: 'asc' }, { x: 'asc' }] } } satisfies Prisma.EsignRequestInclude;
type RequestFull = Prisma.EsignRequestGetPayload<{ include: typeof requestInclude }>;
type SignerRow = RequestFull['signers'][number];

// ------------------------------------------------------------------ events

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
  );
}

function eventBody(e: { requestId: string; type: string; signerId: string | null; actorId: string | null; occurredAt: Date; ip: string | null; detail: unknown }) {
  return canonical({ ...e, occurredAt: e.occurredAt.toISOString(), detail: e.detail ?? null });
}

async function appendEvent(tx: Tx, requestId: string, type: string, actor: EsignActor, o: { signerId?: string | null; detail?: Record<string, unknown> } = {}) {
  const last = await tx.esignEvent.findFirst({ where: { requestId }, orderBy: { id: 'desc' }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS_EVENT;
  const occurredAt = new Date();
  const detail = o.detail ? (JSON.parse(canonical(o.detail)) as Prisma.InputJsonValue) : undefined;
  const hash = sha256(prevHash + eventBody({ requestId, type, signerId: o.signerId ?? null, actorId: actor.userId, occurredAt, ip: actor.ip?.slice(0, 45) ?? null, detail }));
  await tx.esignEvent.create({
    data: { requestId, signerId: o.signerId ?? null, type, actorId: actor.userId, ip: actor.ip?.slice(0, 45) ?? null, userAgent: ua(actor), detail, occurredAt, prevHash, hash },
  });
}

async function lockRequest(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM esign_requests WHERE id = ${id} FOR UPDATE`;
}

async function loadFull(tx: Tx | typeof prisma, id: string): Promise<RequestFull> {
  const r = await tx.esignRequest.findFirst({ where: { OR: [{ id }, { ref: id }] }, include: requestInclude });
  if (!r) throw HttpError.notFound('Signature request not found');
  return r;
}

// ------------------------------------------------------------------ links / mail

const mailLink = (kind: string, token: string | null) => {
  if (kind === 'EXTERNAL' && token) return `${config.portalUrls.onboarding}/sign/${token}`;
  if (kind === 'LP') return `${config.portalUrls.investor}/lp-portal/signatures`;
  if (kind === 'INVESTEE') return `${config.portalUrls.company}/esign`;
  return `${config.portalUrls.admin}/ops/esign`;
};

async function notifySigner(tx: Tx, req: RequestFull, signer: SignerRow, token: string | null, reason: 'REQUEST' | 'REMINDER') {
  const link = mailLink(signer.kind, token);
  const subject = reason === 'REMINDER' ? `Reminder: signature needed on ${req.title}` : `Signature requested: ${req.title}`;
  const body =
    `${reason === 'REMINDER' ? 'Reminder: ' : ''}${signer.name}, your signature is requested on "${req.title}" (${req.ref}).` +
    (req.message ? `\n\n${req.message}` : '') +
    (req.expiresAt ? `\n\nPlease sign before ${req.expiresAt.toISOString().slice(0, 10)}.` : '');
  if (signer.userId) {
    await enqueue(tx, 'notify.users', { userIds: [signer.userId], type: 'esign.request', title: subject, body, link, email: true });
  } else {
    await enqueue(tx, 'email.send', {
      to: signer.email,
      subject,
      text: `${body}\n\nOpen your personal signing link (it will ask you to confirm your e-mail address with a one-time code):\n${link}\n\nIf you did not expect this request, ignore this message.`,
    });
  }
  await tx.esignSigner.update({ where: { id: signer.id }, data: { notifiedAt: new Date() } });
}

async function issueToken(tx: Tx, signer: SignerRow, expiresAt: Date | null): Promise<string> {
  const token = randomToken(32);
  await tx.esignSigner.update({
    where: { id: signer.id },
    data: { tokenHash: sha256(token), tokenExpiresAt: expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000), otpHash: null, otpExpiresAt: null, otpAttempts: 0, identityVerifiedAt: null },
  });
  return token;
}

/** Moves the due group to PENDING and tells them. Idempotent for already-pending signers. */
async function activateDue(tx: Tx, requestId: string, actor: EsignActor) {
  const req = await loadFull(tx, requestId);
  for (const s of dueSigners(req.signers)) {
    if (s.status !== 'WAITING') continue;
    await tx.esignSigner.update({ where: { id: s.id }, data: { status: 'PENDING' } });
    const token = s.kind === 'EXTERNAL' ? await issueToken(tx, s, req.expiresAt) : null;
    await notifySigner(tx, req, { ...s, status: 'PENDING' }, token, 'REQUEST');
    await appendEvent(tx, req.id, 'SENT', actor, { signerId: s.id, detail: { to: s.email, kind: s.kind } });
  }
}

// ------------------------------------------------------------------ creation

export interface SignerInput {
  kind?: SignerKind;
  userId?: string;
  name?: string;
  email?: string;
  roleLabel?: string;
  orderNo?: number;
  /** Required context for LP / INVESTEE signers (membership check). */
  clientId?: string;
  companyId?: string;
}

export interface CreateRequestInput {
  title: string;
  message?: string;
  documentId?: string;
  fileId?: string;
  signingOrder?: 'SEQUENTIAL' | 'PARALLEL';
  signers: SignerInput[];
  expiresInDays?: number;
  subjectType?: string;
  subjectId?: string;
  clientId?: string;
  companyId?: string;
  send?: boolean;
  /** Positioned signature fields; signers are matched by (lower-cased) e-mail. Omit for the appended signature page only. */
  fields?: FieldInput[];
  reminderIntervalDays?: number;
  reminderMax?: number;
  bulkBatchId?: string;
}

export interface FieldInput {
  signerEmail: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
}

/** Validates inputs against the resolved signers and page count; returns rows ready to store. */
function layoutFor(fields: FieldInput[] | undefined, signers: { email: string }[], pageCount: number) {
  if (!fields?.length) return [];
  try {
    // `*` addresses "the only signer" (used by bulk templates, where each request has exactly one signer).
    const only = signers.length === 1 ? signers[0]!.email.toLowerCase() : null;
    return validateLayout(
      fields.map((f) => ({ ...f, signerKey: f.signerEmail.trim() === '*' && only ? only : f.signerEmail.trim().toLowerCase() })),
      pageCount,
      signers.map((s) => s.email.toLowerCase()),
    );
  } catch (e) {
    throw HttpError.badRequest((e as Error).message);
  }
}

const layoutHashOf = (rows: { signerKey: string; kind: string; page: number; x: number; y: number; width: number; height: number }[]) =>
  rows.length ? sha256(layoutCanonical(rows.map((r) => ({ ...r, signerEmail: r.signerKey })))) : null;

function cadence(input: { reminderIntervalDays?: number | null; reminderMax?: number | null }) {
  const iv = input.reminderIntervalDays;
  const mx = input.reminderMax;
  if (iv != null && (!Number.isInteger(iv) || iv < 1 || iv > MAX_REMINDER_INTERVAL_DAYS)) throw HttpError.badRequest(`Reminder interval must be 1 to ${MAX_REMINDER_INTERVAL_DAYS} days`);
  if (mx != null && (!Number.isInteger(mx) || mx < 0 || mx > MAX_REMINDER_CAP)) throw HttpError.badRequest(`Reminders per signer must be 0 to ${MAX_REMINDER_CAP}`);
  return { reminderIntervalDays: iv ?? null, reminderMax: mx ?? null };
}

interface ResolvedSigner {
  kind: SignerKind;
  userId: string | null;
  name: string;
  email: string;
  roleLabel: string | null;
  orderNo: number;
}

const LP_SIGN_ROLES = new Set(['SIGNATORY', 'MANAGER']);
const DERIVED_LP: Record<string, string> = { admin: 'MANAGER', finance: 'SIGNATORY', investment: 'VIEWER', auditor: 'VIEWER' };

export async function resolveSigners(input: Pick<CreateRequestInput, 'signers' | 'signingOrder' | 'clientId' | 'companyId'>): Promise<ResolvedSigner[]> {
  if (!input.signers.length) throw HttpError.badRequest('Add at least one signer');
  if (input.signers.length > 12) throw HttpError.badRequest('At most 12 signers per request');
  const out: ResolvedSigner[] = [];
  for (const [i, s] of input.signers.entries()) {
    let r: ResolvedSigner;
    if (s.userId) {
      const user = await prisma.user.findUnique({
        where: { id: s.userId },
        include: { roles: { include: { role: true } }, clientLinks: true, companyLinks: true },
      });
      if (!user || !user.isActive) throw HttpError.badRequest('Signer account not found or disabled');
      const kind: SignerKind = s.kind && s.kind !== 'EXTERNAL' ? s.kind : user.roles.some((x) => x.role.portal === 'admin') ? 'STAFF' : user.clientLinks.length ? 'LP' : user.companyLinks.length ? 'INVESTEE' : 'STAFF';
      let roleLabel = s.roleLabel ?? null;
      if (kind === 'STAFF') {
        if (!user.roles.some((x) => x.role.portal === 'admin')) throw HttpError.badRequest(`${user.email} is not a staff user`);
        roleLabel ??= user.roles.filter((x) => x.role.portal === 'admin').map((x) => x.role.label)[0] ?? 'Matanho Nexus staff';
      } else if (kind === 'LP') {
        const clientId = s.clientId ?? input.clientId;
        const link = user.clientLinks.find((c) => !c.revokedAt && c.status !== 'SUSPENDED' && (!clientId || c.clientId === clientId));
        const lpRole = link ? (link.lpRole ?? DERIVED_LP[link.investorRole] ?? 'VIEWER') : null;
        if (!link || !lpRole || !LP_SIGN_ROLES.has(lpRole)) throw HttpError.badRequest(`${user.email} is not an authorised signatory for this investor`);
        roleLabel ??= `Authorised signatory (${lpRole.toLowerCase()})`;
      } else {
        const companyId = s.companyId ?? input.companyId;
        const link = user.companyLinks.find((c) => c.status === 'active' && c.signingAuthority !== null && (!companyId || c.companyId === companyId));
        if (!link) throw HttpError.badRequest(`${user.email} holds no signing authority for this company`);
        roleLabel ??= link.title ?? 'Authorised signatory';
      }
      r = { kind, userId: user.id, name: user.name ?? user.email, email: user.email.toLowerCase(), roleLabel, orderNo: 1 };
    } else {
      const email = s.email?.trim().toLowerCase();
      const name = s.name?.trim();
      if (!email || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw HttpError.badRequest('External signers need a name and a valid e-mail address');
      r = { kind: 'EXTERNAL', userId: null, name: name.slice(0, 120), email: email.slice(0, 254), roleLabel: s.roleLabel?.slice(0, 160) ?? null, orderNo: 1 };
    }
    r.orderNo = input.signingOrder === 'SEQUENTIAL' ? (s.orderNo ?? i + 1) : 1;
    out.push(r);
  }
  const emails = new Set<string>();
  for (const r of out) {
    if (emails.has(r.email)) throw HttpError.conflict(`${r.email} appears twice`, 'duplicate_signer');
    emails.add(r.email);
  }
  if (input.signingOrder === 'SEQUENTIAL') {
    const ranks = [...new Set(out.map((s) => s.orderNo))].sort((a, b) => a - b);
    for (const s of out) s.orderNo = ranks.indexOf(s.orderNo) + 1;
  }
  return out;
}

async function loadPdfFile(fileId: string) {
  const { file, data } = await readFileObject(fileId);
  if (!isPdf(data)) throw HttpError.badRequest('Only PDF documents can be signed');
  let pages: number;
  try {
    pages = (await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false })).getPageCount();
  } catch {
    throw HttpError.badRequest('This PDF is encrypted or damaged and cannot be signed');
  }
  if (pages > 400) throw HttpError.badRequest('PDF has too many pages to sign');
  return { file, data, pages };
}

/** Page count + size of each page of a stored PDF (points). */
export async function pageSizes(data: Buffer): Promise<{ page: number; width: number; height: number }[]> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false });
  return doc.getPages().map((p, i) => ({ page: i + 1, width: Math.round(p.getWidth() * 100) / 100, height: Math.round(p.getHeight() * 100) / 100 }));
}

export async function createRequest(actor: EsignActor, input: CreateRequestInput, upload?: { name: string; data: Buffer }) {
  let fileId = input.fileId ?? null;
  let documentId: string | null = null;
  if (upload) {
    const stored = await storeFile({ name: upload.name, mime: 'application/pdf', data: upload.data, uploadedById: actor.userId });
    fileId = stored.id;
  } else if (input.documentId) {
    const doc = await prisma.document.findFirst({
      where: { OR: [{ id: input.documentId }, { ref: input.documentId }] },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!doc) throw HttpError.badRequest('Document not found');
    if (!doc.versions[0]) throw HttpError.badRequest('That document has no file yet');
    documentId = doc.id;
    fileId = doc.versions[0].fileId;
  }
  if (!fileId) throw HttpError.badRequest('Choose a document from the document store or upload a PDF');
  const { file, data, pages } = await loadPdfFile(fileId);
  const signers = await resolveSigners(input);
  const layout = layoutFor(input.fields, signers, pages);
  const layoutHash = layoutHashOf(layout);
  const cad = cadence(input);

  if (input.subjectType && input.subjectId) {
    const open = await prisma.esignRequest.findFirst({
      where: { subjectType: input.subjectType, subjectId: input.subjectId, status: { in: ['DRAFT', 'PENDING'] } },
      select: { ref: true },
    });
    if (open) throw HttpError.conflict(`Signature request ${open.ref} is already open for this item`, 'esign_already_open');
  }

  const days = Math.min(Math.max(input.expiresInDays ?? DEFAULT_EXPIRY_DAYS, 1), 90);
  const originalSha256 = sha256(data);
  const id = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'esign');
    const req = await tx.esignRequest.create({
      data: {
        ref,
        title: input.title.slice(0, 200),
        message: input.message?.slice(0, 2000) ?? null,
        documentId,
        fileId: file.id,
        originalSha256,
        status: 'DRAFT',
        signingOrder: input.signingOrder ?? 'PARALLEL',
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        clientId: input.clientId ?? null,
        companyId: input.companyId ?? null,
        chainHead: genesisHash(ref, originalSha256),
        expiresAt: new Date(Date.now() + days * 86_400_000),
        createdById: actor.userId,
        ...cad,
        bulkBatchId: input.bulkBatchId ?? null,
        signers: { create: signers.map((s) => ({ kind: s.kind, userId: s.userId, name: s.name, email: s.email, roleLabel: s.roleLabel, orderNo: s.orderNo })) },
      },
      include: { signers: true },
    });
    if (layout.length) {
      const idByEmail = new Map(req.signers.map((s) => [s.email.toLowerCase(), s.id]));
      await tx.esignField.createMany({ data: layout.map((f) => ({ requestId: req.id, signerId: idByEmail.get(f.signerKey)!, kind: f.kind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, label: f.label ?? null })) });
    }
    await appendEvent(tx, req.id, 'CREATED', actor, { detail: { fileSha256: originalSha256, signers: signers.length, order: req.signingOrder, ...(layoutHash ? { fields: layout.length, fieldsSha256: layoutHash } : {}) } });
    await writeAudit(tx, auditCtx(actor), { action: 'esign.request.created', objectType: 'esign_request', objectId: req.id, after: { ref, title: req.title, subjectType: req.subjectType, subjectId: req.subjectId, signers: signers.map((s) => s.email) } });
    if (input.send !== false) await startTx(tx, req.id, actor);
    return req.id;
  }, TX);
  return getRequestView(id);
}

async function startTx(tx: Tx, id: string, actor: EsignActor) {
  await lockRequest(tx, id);
  const req = await loadFull(tx, id);
  if (req.status !== 'DRAFT') throw HttpError.conflict('This request has already been sent', 'esign_not_draft');
  const span = req.expiresAt ? Math.max(req.expiresAt.getTime() - req.createdAt.getTime(), 86_400_000) : DEFAULT_EXPIRY_DAYS * 86_400_000;
  const now = new Date();
  await tx.esignRequest.update({ where: { id }, data: { status: 'PENDING', sentAt: now, expiresAt: new Date(now.getTime() + span), version: { increment: 1 } } });
  await writeAudit(tx, auditCtx(actor), { action: 'esign.request.sent', objectType: 'esign_request', objectId: id, after: { ref: req.ref } });
  await activateDue(tx, id, actor);
}

export async function sendRequest(actor: EsignActor, idOrRef: string) {
  const req = await loadFull(prisma, idOrRef);
  await prisma.$transaction((tx) => startTx(tx, req.id, actor), TX);
  return getRequestView(req.id);
}

/** Replaces the placed fields of a DRAFT request (fields are locked once the request is sent). Idempotent for the same layout. */
export async function setFields(actor: EsignActor, idOrRef: string, fields: FieldInput[]) {
  const found = await loadFull(prisma, idOrRef);
  const { pages } = await loadPdfFile(found.fileId);
  const layout = layoutFor(fields, found.signers, pages);
  const hash = layoutHashOf(layout);
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, found.id);
    const req = await loadFull(tx, found.id);
    if (req.status !== 'DRAFT') throw HttpError.conflict('Signature fields can only be changed before the request is sent', 'esign_fields_locked');
    const idByEmail = new Map(req.signers.map((s) => [s.email.toLowerCase(), s.id]));
    await tx.esignField.deleteMany({ where: { requestId: req.id } });
    if (layout.length) {
      await tx.esignField.createMany({ data: layout.map((f) => ({ requestId: req.id, signerId: idByEmail.get(f.signerKey)!, kind: f.kind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, label: f.label ?? null })) });
    }
    await tx.esignRequest.update({ where: { id: req.id }, data: { version: { increment: 1 } } });
    await appendEvent(tx, req.id, 'FIELDS_SET', actor, { detail: { fields: layout.length, fieldsSha256: hash } });
    await writeAudit(tx, auditCtx(actor), { action: 'esign.request.fields_set', objectType: 'esign_request', objectId: req.id, after: { ref: req.ref, fields: layout.length, fieldsSha256: hash } });
  }, TX);
  return getRequestView(found.id);
}

/** Changes the reminder cadence of a request that is still open. */
export async function setReminderCadence(actor: EsignActor, idOrRef: string, input: { reminderIntervalDays?: number | null; reminderMax?: number | null }) {
  const cad = cadence(input);
  const found = await loadFull(prisma, idOrRef);
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, found.id);
    const req = await loadFull(tx, found.id);
    if (!['DRAFT', 'PENDING'].includes(req.status)) throw HttpError.conflict('Reminders can only be changed on a draft or open request', 'esign_not_open');
    await tx.esignRequest.update({ where: { id: req.id }, data: { ...cad, version: { increment: 1 } } });
    await appendEvent(tx, req.id, 'CADENCE_CHANGED', actor, { detail: cad });
    await writeAudit(tx, auditCtx(actor), { action: 'esign.request.cadence_changed', objectType: 'esign_request', objectId: req.id, before: { reminderIntervalDays: req.reminderIntervalDays, reminderMax: req.reminderMax }, after: cad });
  }, TX);
  return getRequestView(found.id);
}

// ------------------------------------------------------------------ resend / void / expire

export async function resendRequest(actor: EsignActor, idOrRef: string, signerId?: string) {
  const found = await loadFull(prisma, idOrRef);
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, found.id);
    const req = await loadFull(tx, found.id);
    if (!OPEN_REQUEST.has(req.status)) throw HttpError.conflict('Only requests that are out for signature can be re-sent', 'esign_not_open');
    const targets = req.signers.filter((s) => s.status === 'PENDING' && (!signerId || s.id === signerId));
    if (!targets.length) throw HttpError.conflict('No signer is waiting to sign', 'esign_nobody_pending');
    for (const s of targets) {
      const token = s.kind === 'EXTERNAL' ? await issueToken(tx, s, req.expiresAt) : null;
      await notifySigner(tx, req, s, token, 'REMINDER');
      await tx.esignSigner.update({ where: { id: s.id }, data: { reminderCount: { increment: 1 } } });
      await appendEvent(tx, req.id, 'RESENT', actor, { signerId: s.id, detail: { to: s.email } });
    }
    await writeAudit(tx, auditCtx(actor), { action: 'esign.request.resent', objectType: 'esign_request', objectId: req.id, after: { signers: targets.map((t) => t.email) } });
  }, TX);
  return getRequestView(found.id);
}

async function closeSigners(tx: Tx, req: RequestFull, except?: string) {
  await tx.esignSigner.updateMany({
    where: { requestId: req.id, status: { in: ['WAITING', 'PENDING'] }, ...(except ? { id: { not: except } } : {}) },
    data: { status: 'VOIDED', tokenHash: null, otpHash: null, otpExpiresAt: null },
  });
}

export async function voidRequest(actor: EsignActor, idOrRef: string, reason: string) {
  const found = await loadFull(prisma, idOrRef);
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, found.id);
    const req = await loadFull(tx, found.id);
    if (req.status === 'COMPLETED') throw HttpError.conflict('A completed signature request is sealed and cannot be changed', 'esign_immutable');
    if (TERMINAL_REQUEST.has(req.status) && req.status !== 'DECLINED' && req.status !== 'EXPIRED') throw HttpError.conflict('This request is already closed', 'esign_closed');
    await closeSigners(tx, req);
    await tx.esignRequest.update({ where: { id: req.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason.slice(0, 500), version: { increment: 1 } } });
    await appendEvent(tx, req.id, 'VOIDED', actor, { detail: { reason } });
    await writeAudit(tx, auditCtx(actor), { action: 'esign.request.voided', objectType: 'esign_request', objectId: req.id, before: { status: req.status }, after: { status: 'VOIDED' }, reason });
    for (const s of req.signers.filter((x) => x.status === 'PENDING' || x.status === 'WAITING')) {
      const text = `The signature request "${req.title}" (${req.ref}) was withdrawn. Reason: ${reason}`;
      if (s.userId) await enqueue(tx, 'notify.users', { userIds: [s.userId], type: 'esign.voided', title: `Signature request withdrawn: ${req.title}`, body: text });
      else await enqueue(tx, 'email.send', { to: s.email, subject: `Signature request withdrawn: ${req.title}`, text });
    }
  }, TX);
  return getRequestView(found.id);
}

/** Worker hook: expires overdue requests and sends up to three reminders per signer. */
export async function scanEsign(): Promise<{ expired: number; reminded: number }> {
  const system: EsignActor = { userId: null, name: 'System', role: 'System', portal: null, ip: null, userAgent: 'worker' };
  const now = new Date();
  let expired = 0;
  let reminded = 0;
  const overdue = await prisma.esignRequest.findMany({ where: { status: 'PENDING', expiresAt: { lt: now } }, select: { id: true } });
  for (const { id } of overdue) {
    await prisma.$transaction(async (tx) => {
      await lockRequest(tx, id);
      const req = await loadFull(tx, id);
      if (req.status !== 'PENDING') return;
      await closeSigners(tx, req);
      await tx.esignRequest.update({ where: { id }, data: { status: 'EXPIRED', version: { increment: 1 } } });
      await appendEvent(tx, id, 'EXPIRED', system);
      await writeAudit(tx, auditCtx(system), { action: 'esign.request.expired', objectType: 'esign_request', objectId: id, after: { ref: req.ref } });
      if (req.createdById) await enqueue(tx, 'notify.users', { userIds: [req.createdById], type: 'esign.expired', title: `Signature request expired: ${req.title}`, body: `${req.ref} was not completed before its deadline.`, link: `${config.portalUrls.admin}/ops/esign` });
    }, TX);
    expired += 1;
  }
  // Per-request cadence (interval + cap); candidates are pre-filtered by the shortest interval and the global cap.
  const candidates = await prisma.esignSigner.findMany({
    where: { status: 'PENDING', reminderCount: { lt: MAX_REMINDER_CAP }, notifiedAt: { lt: new Date(now.getTime() - 86_400_000) }, request: { status: 'PENDING', expiresAt: { gt: now } } },
    select: { id: true, requestId: true, reminderCount: true, notifiedAt: true, request: { select: { reminderIntervalDays: true, reminderMax: true } } },
    take: 400,
  });
  const due = candidates.filter((c) => reminderDue(c, reminderPolicy(c.request), now)).slice(0, 100);
  for (const d of due) {
    await prisma.$transaction(async (tx) => {
      await lockRequest(tx, d.requestId);
      const req = await loadFull(tx, d.requestId);
      const s = req.signers.find((x) => x.id === d.id);
      if (!s || s.status !== 'PENDING' || req.status !== 'PENDING') return;
      if (!reminderDue(s, reminderPolicy(req), new Date())) return;
      const token = s.kind === 'EXTERNAL' ? await issueToken(tx, s, req.expiresAt) : null;
      await notifySigner(tx, req, s, token, 'REMINDER');
      await tx.esignSigner.update({ where: { id: s.id }, data: { reminderCount: { increment: 1 } } });
      await appendEvent(tx, req.id, 'REMINDED', system, { signerId: s.id });
    }, TX);
    reminded += 1;
  }
  return { expired, reminded };
}

// ------------------------------------------------------------------ signing

export interface SignPayload {
  mode: SignatureMode;
  typedName?: string;
  drawnPng?: string;
  consent: boolean;
}

export interface Identity {
  method: 'SESSION' | 'EMAIL_OTP';
  mfaAt?: Date | null;
}

function toSealSigner(s: SignerRow, ref: string): SealSigner {
  const docSha = s.docSha256 ?? '';
  let png: Buffer | null = null;
  if (s.signatureImage) {
    try {
      png = parseDrawnPng(s.signatureImage);
    } catch {
      png = null;
    }
  }
  return {
    signerId: s.id,
    name: s.name,
    email: s.email,
    roleLabel: s.roleLabel,
    kind: s.kind,
    identityMethod: s.identityMethod ?? 'SESSION',
    signatureMode: (s.signatureMode as SignatureMode) ?? 'TYPED',
    signatureText: s.signatureText,
    signaturePng: png,
    signatureHash: s.signatureHash ?? '',
    ip: s.ip,
    userAgent: s.userAgent,
    signedAt: s.signedAt ?? new Date(0),
    consentTextVersion: s.consentTextVersion ?? CONSENT_VERSION,
    consentText: makeConsentText(s.name, ref, docSha),
    consentHash: s.consentHash ?? '',
    docSha256: docSha,
    chainHash: s.chainHash ?? '',
  };
}

const bySignedAt = (a: SignerRow, b: SignerRow) => (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0) || a.createdAt.getTime() - b.createdAt.getTime();

function assertSignable(req: RequestFull, signer: SignerRow | undefined): asserts signer is SignerRow {
  if (req.status === 'COMPLETED') throw HttpError.conflict('This document is already fully signed and sealed', 'esign_immutable');
  if (req.status !== 'PENDING') throw HttpError.conflict(`This request is ${req.status.toLowerCase()}`, 'esign_not_open');
  if (req.expiresAt && req.expiresAt < new Date()) throw HttpError.conflict('This request has expired', 'esign_expired');
  if (!signer) throw HttpError.notFound('Signer not found on this request');
  if (signer.status === 'SIGNED') throw HttpError.conflict('You have already signed this document', 'esign_already_signed');
  if (signer.status !== 'PENDING') throw HttpError.conflict('It is not your turn to sign yet', 'esign_not_your_turn');
}

export async function signRequest(actor: EsignActor, requestId: string, signerId: string, identity: Identity, payload: SignPayload) {
  if (!payload.consent) throw HttpError.badRequest('You must accept the electronic signature consent');
  let png: Buffer | null = null;
  let typed: string | null = null;
  if (payload.mode === 'DRAWN') {
    try {
      png = parseDrawnPng(payload.drawnPng ?? '');
    } catch (e) {
      throw HttpError.badRequest((e as Error).message);
    }
  } else {
    typed = (payload.typedName ?? '').trim().slice(0, 160);
    if (typed.length < 2) throw HttpError.badRequest('Type your full name to sign');
  }
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const req = await loadFull(tx, requestId);
    const signer = req.signers.find((s) => s.id === signerId);
    assertSignable(req, signer);

    // The file must still be byte-identical to what the request was created with.
    const { data } = await readFileObject(req.fileId);
    if (sha256(data) !== req.originalSha256) throw HttpError.conflict('The document no longer matches its recorded hash', 'esign_document_tampered');

    const signedBefore = req.signers.filter((s) => s.status === 'SIGNED').sort(bySignedAt);
    const last = signedBefore[signedBefore.length - 1];
    let signedAt = new Date();
    if (last?.signedAt && signedAt <= last.signedAt) signedAt = new Date(last.signedAt.getTime() + 1);
    const text = makeConsentText(signer.name, req.ref, req.originalSha256);
    const consentHash = makeConsentHash(text, signer.name, signer.email, req.ref, req.originalSha256);
    const signatureHash = signatureValueHash(payload.mode, typed, png);
    const prev = last?.chainHash ?? genesisHash(req.ref, req.originalSha256);
    const chainHash = nextLink(prev, {
      signerId: signer.id,
      name: signer.name,
      email: signer.email,
      signedAt,
      identityMethod: identity.method,
      signatureMode: payload.mode,
      signatureHash,
      consentHash,
      docSha256: req.originalSha256,
      ip: actor.ip?.slice(0, 45) ?? null,
    });
    const updated = await tx.esignSigner.update({
      where: { id: signer.id },
      data: {
        status: 'SIGNED',
        signedAt,
        signatureMode: payload.mode,
        signatureText: typed,
        signatureImage: png ? payload.drawnPng : null,
        signatureHash,
        identityMethod: identity.method,
        identityVerifiedAt: signer.identityVerifiedAt ?? signedAt,
        mfaAt: identity.mfaAt ?? null,
        ip: actor.ip?.slice(0, 45) ?? null,
        userAgent: ua(actor),
        consentTextVersion: CONSENT_VERSION,
        consentHash,
        docSha256: req.originalSha256,
        chainHash,
        tokenHash: null,
        otpHash: null,
        otpExpiresAt: null,
      },
    });
    await tx.esignRequest.update({ where: { id: req.id }, data: { chainHead: chainHash, version: { increment: 1 } } });
    await appendEvent(tx, req.id, 'SIGNED', actor, { signerId: signer.id, detail: { mode: payload.mode, identity: identity.method, chainHash } });
    await writeAudit(tx, auditCtx(actor), { action: 'esign.signed', objectType: 'esign_request', objectId: req.id, after: { ref: req.ref, signer: signer.email, chainHash } });

    const signers = req.signers.map((s) => (s.id === signer.id ? updated : s));
    if (allSigned(signers)) {
      await completeTx(tx, req, signers, actor);
    } else {
      await activateDue(tx, req.id, actor);
      if (req.createdById) await enqueue(tx, 'notify.users', { userIds: [req.createdById], type: 'esign.signed', title: `${signer.name} signed ${req.title}`, body: `${req.ref}: ${signers.filter((s) => s.status === 'SIGNED').length} of ${signers.length} signatures collected.`, link: `${config.portalUrls.admin}/ops/esign` });
    }
  }, TX);
  return getRequestView(requestId);
}

async function completeTx(tx: Tx, req: RequestFull, signersIn: SignerRow[], actor: EsignActor) {
  const adapter = getESignAdapter();
  const signers = [...signersIn].sort(bySignedAt);
  const events = await tx.esignEvent.findMany({ where: { requestId: req.id }, orderBy: { id: 'asc' }, take: 300 });
  const nameById = new Map(signers.map((s) => [s.id, s.name]));
  const { data: original } = await readFileObject(req.fileId);
  const completedAt = new Date();
  const chainHead = signers[signers.length - 1]!.chainHash!;
  const sealed = await adapter.seal({
    ref: req.ref,
    title: req.title,
    subjectLabel: req.subjectType ? `${req.subjectType}${req.subjectId ? ` ${req.subjectId}` : ''}` : null,
    originalPdf: original,
    originalSha256: req.originalSha256,
    createdAt: req.createdAt,
    completedAt,
    chainHead,
    signers: signers.map((s) => toSealSigner(s, req.ref)),
    fields: req.fields.map((f) => ({ signerId: f.signerId, kind: f.kind as FieldKind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height })),
    fieldsSha256: layoutHashOf(req.fields.map((f) => ({ signerKey: req.signers.find((s) => s.id === f.signerId)?.email ?? '', kind: f.kind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }))),
    events: [
      ...events.map((e) => ({ at: e.occurredAt, type: e.type, who: e.signerId ? (nameById.get(e.signerId) ?? null) : null, ip: e.ip })),
      { at: completedAt, type: 'COMPLETED', who: null, ip: null },
    ],
    verifyUrl: `${config.portalUrls.onboarding}/sign/verify`,
  });
  const sealedFile = await storeFile({ name: `${req.ref}-signed.pdf`, mime: 'application/pdf', data: sealed.sealedPdf, uploadedById: actor.userId }, tx);
  const certFile = await storeFile({ name: `${req.ref}-certificate.pdf`, mime: 'application/pdf', data: sealed.certificatePdf, uploadedById: actor.userId }, tx);
  await tx.esignRequest.update({
    where: { id: req.id },
    data: { status: 'COMPLETED', completedAt, sealedFileId: sealedFile.id, sealedSha256: sealed.sealedSha256, certificateFileId: certFile.id, chainHead, version: { increment: 1 } },
  });
  await appendEvent(tx, req.id, 'COMPLETED', actor, { detail: { sealedSha256: sealed.sealedSha256, chainHead } });
  await writeAudit(tx, auditCtx(actor), { action: 'esign.completed', objectType: 'esign_request', objectId: req.id, after: { ref: req.ref, sealedSha256: sealed.sealedSha256, chainHead, signers: signers.map((s) => s.email) } });
  if (req.documentId) {
    const max = await tx.documentVersion.aggregate({ where: { documentId: req.documentId }, _max: { version: true } });
    await tx.documentVersion.create({ data: { documentId: req.documentId, version: (max._max.version ?? 0) + 1, fileId: sealedFile.id, sha256: sealed.sealedSha256, uploadedById: actor.userId } });
  }
  await runCompletionHooks(tx, { ...req, status: 'COMPLETED', completedAt, sealedFileId: sealedFile.id, sealedSha256: sealed.sealedSha256 }, signers.map((s) => ({ userId: s.userId, name: s.name, signedAt: s.signedAt })));
  const text = `"${req.title}" (${req.ref}) has been signed by all parties and sealed. SHA-256 of the sealed PDF: ${sealed.sealedSha256}`;
  const userIds = [...new Set([req.createdById, ...signers.map((s) => s.userId)].filter((x): x is string => !!x))];
  if (userIds.length) await enqueue(tx, 'notify.users', { userIds, type: 'esign.completed', title: `Fully signed: ${req.title}`, body: text, email: true });
  for (const s of signers.filter((x) => !x.userId)) await enqueue(tx, 'email.send', { to: s.email, subject: `Fully signed: ${req.title}`, text: `${text}\n\nYou can check any copy of the document at ${config.portalUrls.onboarding}/sign/verify` });
}

export async function declineRequest(actor: EsignActor, requestId: string, signerId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const req = await loadFull(tx, requestId);
    const signer = req.signers.find((s) => s.id === signerId);
    assertSignable(req, signer);
    await tx.esignSigner.update({ where: { id: signer.id }, data: { status: 'DECLINED', declinedAt: new Date(), declineReason: reason.slice(0, 500), ip: actor.ip?.slice(0, 45) ?? null, userAgent: ua(actor), tokenHash: null, otpHash: null, otpExpiresAt: null } });
    await closeSigners(tx, req, signer.id);
    await tx.esignRequest.update({ where: { id: req.id }, data: { status: 'DECLINED', declineReason: reason.slice(0, 500), version: { increment: 1 } } });
    await appendEvent(tx, req.id, 'DECLINED', actor, { signerId: signer.id, detail: { reason } });
    await writeAudit(tx, auditCtx(actor), { action: 'esign.declined', objectType: 'esign_request', objectId: req.id, after: { ref: req.ref, signer: signer.email }, reason });
    if (req.createdById) await enqueue(tx, 'notify.users', { userIds: [req.createdById], type: 'esign.declined', title: `${signer.name} declined to sign ${req.title}`, body: `${req.ref}: ${reason}`, link: `${config.portalUrls.admin}/ops/esign`, email: true });
  }, TX);
  return getRequestView(requestId);
}

// ------------------------------------------------------------------ external signers (token + e-mail OTP)

const otpHash = (signerId: string, code: string) => sha256(`otp:${hmacHex(signerId)}:${code}`);

export async function loadByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw HttpError.notFound('This signing link is not valid');
  const signer = await prisma.esignSigner.findUnique({ where: { tokenHash: sha256(token) } });
  if (!signer || (signer.tokenExpiresAt && signer.tokenExpiresAt < new Date())) throw HttpError.notFound('This signing link is not valid or has expired');
  const req = await loadFull(prisma, signer.requestId);
  const me = req.signers.find((s) => s.id === signer.id)!;
  return { req, signer: me };
}

export async function sendOtp(actor: EsignActor, token: string) {
  const { req, signer } = await loadByToken(token);
  assertSignable(req, signer);
  if (signer.otpExpiresAt && signer.otpExpiresAt.getTime() - Date.now() > OTP_TTL_MS - 60_000) throw new HttpError(429, 'otp_throttled', 'A code was sent a moment ago. Wait a minute before requesting another.');
  const code = String(randomInt(100000, 1000000));
  await prisma.$transaction(async (tx) => {
    await tx.esignSigner.update({ where: { id: signer.id }, data: { otpHash: otpHash(signer.id, code), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 } });
    await enqueue(tx, 'email.send', { to: signer.email, subject: `Your verification code for ${req.ref}`, text: `Your one-time code to open and sign "${req.title}" is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this message.` });
    await appendEvent(tx, req.id, 'OTP_SENT', actor, { signerId: signer.id });
  });
}

const proofFor = (signerId: string, exp: number) => `${exp}.${hmacHex(`esign-proof.${signerId}.${exp}`)}`;

export function verifyProof(signerId: string, proof: string | undefined | null): boolean {
  if (!proof) return false;
  const [expRaw, sig] = proof.split('.');
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp < Date.now() || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return safeEqualHex(hmacHex(`esign-proof.${signerId}.${exp}`), sig);
}

export async function verifyOtp(actor: EsignActor, token: string, code: string) {
  const { req, signer } = await loadByToken(token);
  assertSignable(req, signer);
  if (!signer.otpHash || !signer.otpExpiresAt || signer.otpExpiresAt < new Date()) throw HttpError.badRequest('Request a new code to continue');
  if (signer.otpAttempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'otp_locked', 'Too many attempts. Request a new code.');
  const ok = safeEqualHex(otpHash(signer.id, code.trim()), signer.otpHash);
  await prisma.$transaction(async (tx) => {
    if (!ok) {
      await tx.esignSigner.update({ where: { id: signer.id }, data: { otpAttempts: { increment: 1 } } });
      await appendEvent(tx, req.id, 'OTP_FAILED', actor, { signerId: signer.id });
    } else {
      await tx.esignSigner.update({ where: { id: signer.id }, data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0, identityVerifiedAt: new Date(), identityMethod: 'EMAIL_OTP' } });
      await appendEvent(tx, req.id, 'OTP_VERIFIED', actor, { signerId: signer.id });
    }
  });
  if (!ok) throw HttpError.badRequest('That code is not correct');
  return { proof: proofFor(signer.id, Date.now() + PROOF_TTL_MS) };
}

export async function recordViewed(actor: EsignActor, signer: SignerRow, requestId: string) {
  if (signer.viewedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.esignSigner.update({ where: { id: signer.id }, data: { viewedAt: new Date() } });
    await appendEvent(tx, requestId, 'VIEWED', actor, { signerId: signer.id });
  });
}

// ------------------------------------------------------------------ authenticated signers

export async function signerForUser(userId: string, idOrRef: string) {
  const req = await loadFull(prisma, idOrRef);
  const me = req.signers.find((s) => s.userId === userId);
  if (!me) throw HttpError.notFound('Signature request not found');
  return { req, signer: me };
}

export async function listForUser(userId: string, status?: string) {
  const rows = await prisma.esignRequest.findMany({
    where: { signers: { some: { userId } }, ...(status === 'pending' ? { status: 'PENDING' } : {}) },
    include: requestInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => {
    const me = r.signers.find((s) => s.userId === userId)!;
    return { ...signerSideView(r, me), actionable: r.status === 'PENDING' && me.status === 'PENDING' };
  });
}

export function signerSideView(r: RequestFull, me: SignerRow) {
  return {
    id: r.id,
    ref: r.ref,
    title: r.title,
    message: r.message,
    status: r.status,
    expiresAt: r.expiresAt,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    sealedSha256: r.sealedSha256,
    hasSealed: !!r.sealedFileId,
    me: { id: me.id, status: me.status, name: me.name, roleLabel: me.roleLabel, signedAt: me.signedAt },
    signers: r.signers.map((s) => ({ name: s.name, roleLabel: s.roleLabel, status: s.status, signedAt: s.signedAt, orderNo: s.orderNo })),
    myFields: r.fields.filter((f) => f.signerId === me.id).map((f) => ({ kind: f.kind, page: f.page, label: f.label })),
    consent: { version: CONSENT_VERSION, text: makeConsentText(me.name, r.ref, r.originalSha256) },
  };
}

/** Bytes the signer may see: sealed copy once completed, otherwise the original. */
export async function fileForSigner(req: RequestFull, variant: 'document' | 'certificate' = 'document', signer?: SignerRow) {
  const id = variant === 'certificate' ? req.certificateFileId : (req.sealedFileId ?? req.fileId);
  if (!id) throw HttpError.notFound('Not available yet');
  const out = await readFileObject(id);
  // While the request is open the signer sees their own boxes highlighted where the signature will be placed.
  const mine = signer && variant === 'document' && !req.sealedFileId && signer.status === 'PENDING' ? req.fields.filter((f) => f.signerId === signer.id) : [];
  if (!mine.length) return out;
  try {
    const doc = await PDFDocument.load(out.data, { updateMetadata: false });
    await stampPlaceholders(doc, mine.map((f) => ({ signerId: signer!.id, kind: f.kind as FieldKind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, label: 'you' })));
    return { ...out, data: Buffer.from(await doc.save()) };
  } catch {
    return out;
  }
}

// ------------------------------------------------------------------ staff views / verification

const signerView = (s: SignerRow) => ({
  id: s.id,
  orderNo: s.orderNo,
  kind: s.kind,
  userId: s.userId,
  name: s.name,
  email: s.email,
  roleLabel: s.roleLabel,
  status: s.status,
  identityMethod: s.identityMethod,
  notifiedAt: s.notifiedAt,
  reminderCount: s.reminderCount,
  fieldCount: 0,
  nextReminderAt: null as Date | null,
  viewedAt: s.viewedAt,
  signedAt: s.signedAt,
  declinedAt: s.declinedAt,
  declineReason: s.declineReason,
  signatureMode: s.signatureMode,
  ip: s.ip,
  chainHash: s.chainHash,
});

export function requestView(r: RequestFull) {
  const signed = r.signers.filter((s) => s.status === 'SIGNED').length;
  return {
    id: r.id,
    ref: r.ref,
    title: r.title,
    message: r.message,
    status: r.status,
    signingOrder: r.signingOrder,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    clientId: r.clientId,
    companyId: r.companyId,
    documentId: r.documentId,
    originalSha256: r.originalSha256,
    sealedSha256: r.sealedSha256,
    chainHead: r.chainHead,
    hasSealed: !!r.sealedFileId,
    hasCertificate: !!r.certificateFileId,
    expiresAt: r.expiresAt,
    sentAt: r.sentAt,
    completedAt: r.completedAt,
    voidedAt: r.voidedAt,
    voidReason: r.voidReason,
    declineReason: r.declineReason,
    createdAt: r.createdAt,
    createdById: r.createdById,
    progress: { signed, total: r.signers.length },
    reminder: { ...reminderPolicy(r), custom: r.reminderIntervalDays !== null || r.reminderMax !== null },
    bulkBatchId: r.bulkBatchId,
    fields: r.fields.map((f) => ({ id: f.id, signerId: f.signerId, kind: f.kind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, label: f.label })),
    signers: r.signers.map((s) => ({
      ...signerView(s),
      fieldCount: r.fields.filter((f) => f.signerId === s.id).length,
      nextReminderAt: r.status === 'PENDING' && s.status === 'PENDING' ? nextReminderAt(s, reminderPolicy(r)) : null,
    })),
  };
}

export async function getRequestView(id: string, withEvents = false) {
  const r = await loadFull(prisma, id);
  const base = requestView(r);
  if (!withEvents) return base;
  const events = await prisma.esignEvent.findMany({ where: { requestId: r.id }, orderBy: { id: 'asc' }, take: 500 });
  const names = new Map(r.signers.map((s) => [s.id, s.name]));
  return { ...base, events: events.map((e) => ({ id: e.id.toString(), type: e.type, at: e.occurredAt, who: e.signerId ? (names.get(e.signerId) ?? null) : null, ip: e.ip, detail: e.detail, hash: e.hash })) };
}

export async function listRequests(q: { status?: string; q?: string; subjectType?: string; subjectId?: string; take?: number }) {
  const rows = await prisma.esignRequest.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.q ? { OR: [{ ref: { contains: q.q } }, { title: { contains: q.q } }, { signers: { some: { OR: [{ name: { contains: q.q } }, { email: { contains: q.q } }] } } }] } : {}),
    },
    include: requestInclude,
    orderBy: { createdAt: 'desc' },
    take: Math.min(q.take ?? 200, 500),
  });
  const counts = await prisma.esignRequest.groupBy({ by: ['status'], _count: { _all: true } });
  return { data: rows.map(requestView), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
}

export async function requestFile(idOrRef: string, variant: 'original' | 'sealed' | 'certificate') {
  const r = await loadFull(prisma, idOrRef);
  const id = variant === 'original' ? r.fileId : variant === 'sealed' ? r.sealedFileId : r.certificateFileId;
  if (!id) throw HttpError.notFound(variant === 'original' ? 'Document missing' : 'Not available until every signer has signed');
  return { req: r, ...(await readFileObject(id)) };
}

export interface IntegrityCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Re-derives every hash from stored data. Used by staff and the public verifier. */
export async function integrityReport(idOrRef: string) {
  const r = await loadFull(prisma, idOrRef);
  const checks: IntegrityCheck[] = [];
  try {
    const { data } = await readFileObject(r.fileId);
    checks.push({ name: 'Original document hash', ok: sha256(data) === r.originalSha256 });
  } catch {
    checks.push({ name: 'Original document hash', ok: false, detail: 'file unreadable' });
  }
  const signed = r.signers.filter((s) => s.status === 'SIGNED').sort(bySignedAt);
  const chain = getESignAdapter().verifyChain(r.ref, r.originalSha256, signed.map((s) => toSealSigner(s, r.ref)), signed.length ? r.chainHead : null);
  checks.push({ name: 'Signature hash chain', ok: chain.ok, detail: chain.brokenAt === null ? undefined : `broken at signer ${chain.brokenAt + 1}` });
  const events = await prisma.esignEvent.findMany({ where: { requestId: r.id }, orderBy: { id: 'asc' } });
  let prev = GENESIS_EVENT;
  let evOk = true;
  for (const e of events) {
    const expect = sha256(prev + eventBody({ requestId: e.requestId, type: e.type, signerId: e.signerId, actorId: e.actorId, occurredAt: e.occurredAt, ip: e.ip, detail: e.detail }));
    if (e.prevHash !== prev || e.hash !== expect) {
      evOk = false;
      break;
    }
    prev = e.hash;
  }
  checks.push({ name: 'Audit event chain', ok: evOk });
  const layoutEvent = [...events].reverse().find((e) => e.type === 'FIELDS_SET') ?? events.find((e) => e.type === 'CREATED');
  const recordedLayout = ((layoutEvent?.detail ?? null) as { fieldsSha256?: string | null } | null)?.fieldsSha256 ?? null;
  if (r.fields.length || recordedLayout) {
    const current = layoutHashOf(r.fields.map((f) => ({ signerKey: r.signers.find((s) => s.id === f.signerId)?.email ?? '', kind: f.kind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height })));
    checks.push({ name: 'Signature field layout', ok: !!recordedLayout && current === recordedLayout, detail: recordedLayout ? undefined : 'layout was not recorded' });
  }
  if (r.status === 'COMPLETED' && r.sealedFileId && esignMode() === 'native') {
    try {
      const { data } = await readFileObject(r.sealedFileId);
      const kw = (await PDFDocument.load(data, { updateMetadata: false })).getKeywords() ?? '';
      const ok = kw.includes(`esign:${r.ref}`) && kw.includes(`orig:${r.originalSha256}`) && (!r.chainHead || kw.includes(`chain:${r.chainHead}`));
      checks.push({ name: 'Sealed PDF embeds reference, original hash and chain head', ok });
    } catch {
      checks.push({ name: 'Sealed PDF embeds reference, original hash and chain head', ok: false, detail: 'sealed file unreadable' });
    }
  }
  if (r.status === 'COMPLETED') {
    for (const [label, id, expected] of [
      ['Sealed PDF hash', r.sealedFileId, r.sealedSha256],
      ['Certificate file', r.certificateFileId, null],
    ] as const) {
      try {
        if (!id) throw new Error('missing');
        const { file, data } = await readFileObject(id);
        checks.push({ name: label, ok: sha256(data) === file.sha256 && (!expected || sha256(data) === expected) });
      } catch {
        checks.push({ name: label, ok: false, detail: 'file unreadable' });
      }
    }
  }
  return { ref: r.ref, status: r.status, ok: checks.every((c) => c.ok), checks, sealedSha256: r.sealedSha256, chainHead: r.chainHead };
}

/** Public verification by SHA-256 (hash typed in, or computed from an uploaded file). */
export async function verifyByHash(hash: string) {
  const h = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw HttpError.badRequest('Provide a 64-character SHA-256 hash');
  const sealed = await prisma.esignRequest.findFirst({ where: { sealedSha256: h }, include: requestInclude });
  const original = sealed ? null : await prisma.esignRequest.findFirst({ where: { originalSha256: h }, include: requestInclude });
  const r = sealed ?? original;
  if (!r) return { match: 'NONE' as const, sha256: h };
  const report = r.status === 'COMPLETED' ? await integrityReport(r.id) : null;
  return {
    match: sealed ? ('SEALED' as const) : ('ORIGINAL' as const),
    sha256: h,
    ref: r.ref,
    status: r.status,
    completedAt: r.completedAt,
    signers: r.status === 'COMPLETED' ? r.signers.map((s) => ({ name: s.name, roleLabel: s.roleLabel, signedAt: s.signedAt, identity: s.identityMethod === 'SESSION' ? 'Authenticated session' : s.identityMethod === 'EMAIL_OTP' ? 'E-mail one-time code' : null })) : undefined,
    chainIntact: report?.ok ?? null,
    checks: report ? report.checks.map((c) => ({ name: c.name, ok: c.ok })) : undefined,
    signaturesPlaced: r.status === 'COMPLETED' ? r.fields.length : undefined,
    sealedSha256: r.status === 'COMPLETED' ? r.sealedSha256 : undefined,
    originalSha256: r.originalSha256,
    note: sealed
      ? 'This is the sealed document exactly as completed.'
      : r.status === 'COMPLETED'
        ? 'This is the unsigned original; the sealed version was issued on completion.'
        : 'This is the original document of a request that is not completed.',
  };
}

// ------------------------------------------------------------------ pickers

export async function directory(kind: string, o: { q?: string; clientId?: string; companyId?: string }) {
  const q = o.q?.trim();
  const textMatch = q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {};
  if (kind === 'LP') {
    const links = await prisma.clientUser.findMany({
      where: { revokedAt: null, status: { not: 'SUSPENDED' }, ...(o.clientId ? { clientId: o.clientId } : {}), user: { isActive: true, ...textMatch } },
      include: { user: { select: { id: true, name: true, email: true } }, client: { select: { id: true, ref: true, name: true } } },
      take: 100,
    });
    return links
      .map((l) => ({ userId: l.user.id, name: l.user.name ?? l.user.email, email: l.user.email, kind: 'LP', clientId: l.clientId, org: l.client.name, role: l.lpRole ?? DERIVED_LP[l.investorRole] ?? 'VIEWER' }))
      .filter((l) => LP_SIGN_ROLES.has(l.role));
  }
  if (kind === 'INVESTEE') {
    const links = await prisma.companyUser.findMany({
      where: { status: 'active', ...(o.companyId ? { companyId: o.companyId } : {}), user: { isActive: true, ...textMatch } },
      include: { user: { select: { id: true, name: true, email: true } }, company: { select: { id: true, name: true } } },
      take: 100,
    });
    return links.filter((l) => l.signingAuthority !== null).map((l) => ({ userId: l.user.id, name: l.user.name ?? l.user.email, email: l.user.email, kind: 'INVESTEE', companyId: l.companyId, org: l.company.name, role: l.title ?? 'Authorised signatory' }));
  }
  const users = await prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } }, ...textMatch }, include: { roles: { include: { role: true } } }, take: 100, orderBy: { name: 'asc' } });
  return users.map((u) => ({ userId: u.id, name: u.name ?? u.email, email: u.email, kind: 'STAFF', org: 'Matanho', role: u.roles.filter((r) => r.role.portal === 'admin').map((r) => r.role.label).join(', ') }));
}

export async function pdfDocuments(q?: string) {
  const docs = await prisma.document.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { ref: { contains: q } }] } : {},
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const fileIds = docs.flatMap((d) => d.versions.map((v) => v.fileId));
  const files = fileIds.length ? await prisma.fileObject.findMany({ where: { id: { in: fileIds }, mime: 'application/pdf' }, select: { id: true } }) : [];
  const ok = new Set(files.map((f) => f.id));
  return docs.filter((d) => d.versions[0] && ok.has(d.versions[0].fileId)).map((d) => ({ id: d.id, ref: d.ref, name: d.name, type: d.type, status: d.status, version: d.versions[0]!.version }));
}
