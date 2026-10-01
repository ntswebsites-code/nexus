import { Router } from 'express';
import { z } from 'zod';
import { emailSchema } from '@matanho/shared';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { actorName, ctx, param } from '../../lib/http';
import { signedDownloadUrl, storeFile } from '../../lib/storage';
import { validateBody } from '../../middleware/validate';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { requireAuth, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { createInvitation } from '../identity/invitations';
import {
  INVESTOR_ROLE_LABELS,
  SCOPE_LABELS,
  SIGNING_ROLES,
  bankInstructionView,
  capitalView,
  documentView,
  fileSizes,
  investorContext,
  latestPublishedSnapshot,
  portalUsersView,
  publishedCapitalWhere,
  publishedDocInclude,
  publishedDocWhere,
  requestInclude,
  requestView,
  requireInvestorPermission,
  scopedSnapshot,
  threadInclude,
  threadView,
  type InvestorContext,
} from './investor.service';

/** `/api/v1/investor` - the investor portal's scoped API (SRD 8.2). */
export const investorRoutes = Router();
investorRoutes.use(requireAuth, requirePortalAccess('investor'));

const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'investor');
const SLA_HOURS: Record<string, number> = { Normal: 48, 'Time sensitive': 8 };

// ---------------------------------------------------------------- reads

async function documentsFor(ic: InvestorContext) {
  const docs = await prisma.document.findMany({
    where: publishedDocWhere(ic.client.id),
    include: publishedDocInclude(ic.client.id, ic.userId),
    orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
  });
  const sizes = await fileSizes(docs);
  return docs.map((d) => documentView(d, sizes));
}

async function capitalFor(ic: InvestorContext) {
  const rows = await prisma.capitalEvent.findMany({
    where: publishedCapitalWhere(ic.client.id),
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(capitalView);
}

async function requestsFor(ic: InvestorContext) {
  const rows = await prisma.serviceRequest.findMany({
    where: { clientId: ic.client.id },
    include: requestInclude,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(requestView);
}

async function threadsFor(ic: InvestorContext) {
  const rows = await prisma.messageThread.findMany({
    where: { clientId: ic.client.id },
    include: threadInclude(ic.userId),
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((t) => threadView(t, 'investor'));
}

/**
 * Everything the investor portal renders, in the prototype's data shapes.
 * Sections the member's role cannot see are returned empty.
 */
investorRoutes.get('/bootstrap', async (req, res) => {
  const ic = await investorContext(req);
  const can = (p: string) => ic.permissions.has(p);
  const [snapshot, documents, capital, requests, threads, users, bank, memberships] = await Promise.all([
    latestPublishedSnapshot(ic.client.id),
    can('documents.view') ? documentsFor(ic) : [],
    can('capital.view') ? capitalFor(ic) : [],
    can('requests.view') ? requestsFor(ic) : [],
    can('messages.view') ? threadsFor(ic) : [],
    portalUsersView(ic.client.id),
    prisma.bankInstruction.findFirst({ where: { clientId: ic.client.id, status: 'Active' }, orderBy: { version: 'desc' } }),
    prisma.clientUser.findMany({ where: { userId: ic.userId }, include: { client: { select: { ref: true, name: true } } } }),
  ]);
  const snap = scopedSnapshot(snapshot, ic.scope);
  res.json({
    client: { id: ic.client.ref, name: ic.client.name, baseCurrency: ic.client.baseCurrency },
    relationships: memberships.map((m) => ({ id: m.client.ref, name: m.client.name })),
    role: ic.role,
    roleLabel: INVESTOR_ROLE_LABELS[ic.role] ?? ic.role,
    scope: ic.scope,
    scopeLabel: SCOPE_LABELS[ic.scope] ?? ic.scope,
    permissions: [...ic.permissions],
    canSign: SIGNING_ROLES.has(ic.role),
    snapshot: snap && { id: snap.id, valuationDate: snap.valuationDate, reportingCurrency: snap.reportingCurrency, allocation: snap.allocation },
    fx: snap?.fx ?? null,
    metrics: snap?.metrics ?? null,
    activity: snap?.activity ?? null,
    perfSets: snap?.perfSets ?? null,
    benchSets: snap?.benchSets ?? null,
    investments: snap?.investments ?? [],
    holdings: can('holdings.view') ? (snap?.holdings ?? []) : [],
    transactions: can('holdings.view') ? (snap?.transactions ?? []) : [],
    capitalActivity: capital,
    documents,
    requests,
    threads,
    portalUsers: users,
    bankInstruction: can('capital.view') || ic.role === 'admin' ? bankInstructionView(bank) : null,
  });
});

investorRoutes.get('/overview', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'overview.view');
  const snap = scopedSnapshot(await latestPublishedSnapshot(ic.client.id), ic.scope);
  res.json({ valuationDate: snap?.valuationDate ?? null, metrics: snap?.metrics ?? null, activity: snap?.activity ?? null });
});

investorRoutes.get('/investments', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'investments.view');
  const snap = scopedSnapshot(await latestPublishedSnapshot(ic.client.id), ic.scope);
  res.json({ data: snap?.investments ?? [] });
});

investorRoutes.get('/performance', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'performance.view');
  const snap = scopedSnapshot(await latestPublishedSnapshot(ic.client.id), ic.scope);
  res.json({ sets: snap?.perfSets ?? {}, bench: snap?.benchSets ?? {}, allocation: snap?.allocation ?? [] });
});

investorRoutes.get('/holdings', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'holdings.view');
  const snap = scopedSnapshot(await latestPublishedSnapshot(ic.client.id), ic.scope);
  res.json({ data: snap?.holdings ?? [], transactions: snap?.transactions ?? [] });
});

investorRoutes.get('/capital-events', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'capital.view');
  res.json({ data: await capitalFor(ic) });
});

investorRoutes.get('/documents', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'documents.view');
  res.json({ data: await documentsFor(ic) });
});

investorRoutes.get('/requests', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'requests.view');
  res.json({ data: await requestsFor(ic) });
});

investorRoutes.get('/threads', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'messages.view');
  res.json({ data: await threadsFor(ic) });
});

investorRoutes.get('/users', async (req, res) => {
  const ic = await investorContext(req);
  res.json({ data: await portalUsersView(ic.client.id) });
});

investorRoutes.get('/bank-instructions', async (req, res) => {
  const ic = await investorContext(req);
  if (!ic.permissions.has('capital.view') && ic.role !== 'admin') {
    throw HttpError.forbidden('Your portal role does not include bank instructions', 'permission_denied');
  }
  const bank = await prisma.bankInstruction.findFirst({ where: { clientId: ic.client.id, status: 'Active' }, orderBy: { version: 'desc' } });
  res.json({ instruction: bankInstructionView(bank) });
});

// ---------------------------------------------------------------- capital: funding evidence

investorRoutes.post('/capital-events/:ref/funding-evidence', uploadFiles('file'), async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'capital.view');
  if (ic.role !== 'admin' && ic.role !== 'finance') {
    throw HttpError.forbidden('Only Investor Admin or Finance / Treasury users can submit funding evidence', 'permission_denied');
  }
  const file = uploadedFiles(req)[0];
  if (!file) throw HttpError.badRequest('Attach proof of payment before submitting');
  if (String(req.body?.confirm) !== 'true') throw HttpError.badRequest('Confirm the payment instructions used');
  const event = await prisma.capitalEvent.findFirst({ where: { ...publishedCapitalWhere(ic.client.id), ref: param(req, 'ref') } });
  if (!event) throw HttpError.notFound('Capital notice not found');
  if (event.type !== 'Capital call' && event.type !== 'Contribution') throw HttpError.badRequest('Funding evidence applies to capital calls and contributions');
  if (!['Due', 'Expected', 'Processing'].includes(event.status)) {
    throw HttpError.conflict(`This notice is already ${event.status.toLowerCase()}`, 'invalid_state');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: ic.userId }, tx);
    await tx.fundingEvidence.create({ data: { capitalEventId: event.id, fileId: stored.id, confirmedById: ic.userId } });
    const row = await tx.capitalEvent.update({
      where: { id: event.id },
      data: { status: 'Processing', evidenceName: file.originalname.slice(0, 255), version: { increment: 1 } },
    });
    await writeAudit(tx, audit(req), {
      action: 'capital.funding_evidence.submitted',
      objectType: 'capital_event',
      objectId: event.id,
      before: { status: event.status },
      after: { status: 'Processing', file: stored.name, sha256: stored.sha256 },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'cash.approve',
      type: 'capital.funding_evidence',
      title: `Funding evidence received · ${event.ref}`,
      body: `${ic.client.name} uploaded proof of payment for ${event.investmentName}. Match it to the cash ledger.`,
      link: '/?page=capital',
    });
    return row;
  });
  res.json({ capital: capitalView(updated) });
});

// ---------------------------------------------------------------- documents

async function publishedDocument(ic: InvestorContext, ref: string) {
  const doc = await prisma.document.findFirst({
    where: { ...publishedDocWhere(ic.client.id), ref },
    include: publishedDocInclude(ic.client.id, ic.userId),
  });
  if (!doc) throw HttpError.notFound('Document not found');
  return doc;
}

async function markRead(documentId: string, userId: string) {
  await prisma.documentRead.createMany({ data: [{ documentId, userId }], skipDuplicates: true });
}

investorRoutes.post('/documents/:ref/read', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'documents.view');
  const doc = await publishedDocument(ic, param(req, 'ref'));
  await markRead(doc.id, ic.userId);
  res.json({ ok: true });
});

/** Entitlement-checked, short-lived download link (SRD 8.2 / 10.3). */
investorRoutes.get('/documents/:ref/download-url', async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'documents.view');
  const doc = await publishedDocument(ic, param(req, 'ref'));
  const version = doc.versions[0];
  if (!version) throw HttpError.notFound('No published file is attached to this document yet');
  await markRead(doc.id, ic.userId);
  await prisma.$transaction((tx) =>
    writeAudit(tx, audit(req), { action: 'document.downloaded', objectType: 'document', objectId: doc.id, after: { version: version.version } }),
  );
  res.json({ url: signedDownloadUrl(version.fileId), expiresIn: 300, name: doc.name });
});

const signSchema = z.object({
  name: z.string().trim().min(1).max(120),
  authority: z.string().trim().min(1).max(160),
  consent: z.literal(true),
});

/** E-signature: records identity, MFA/session evidence, timestamp, document hash and authority. */
investorRoutes.post('/documents/:ref/sign', requireStepUp, validateBody(signSchema), async (req, res) => {
  const ic = await investorContext(req);
  if (!SIGNING_ROLES.has(ic.role)) {
    throw HttpError.forbidden('Only an authorised signatory (Investor Admin or Finance / Treasury) can sign', 'permission_denied');
  }
  const doc = await publishedDocument(ic, param(req, 'ref'));
  const request = doc.signatureRequests[0];
  if (!request) throw HttpError.conflict('This document does not require a signature', 'invalid_state');
  const version = doc.versions[0];
  if (!version) throw HttpError.conflict('The published file is missing - contact Client Services', 'invalid_state');
  const b = req.body as z.infer<typeof signSchema>;
  await prisma.$transaction(async (tx) => {
    const sig = await tx.signature.create({
      data: {
        requestId: request.id,
        signerUserId: ic.userId,
        signerName: b.name,
        authority: b.authority,
        consentAt: new Date(),
        mfaAt: req.authSession?.mfaVerifiedAt ?? null,
        docSha256: version.sha256,
        ip: req.ip ?? null,
      },
    });
    await tx.signatureRequest.update({ where: { id: request.id }, data: { status: 'Signed' } });
    await writeAudit(tx, audit(req), {
      action: 'document.signed',
      objectType: 'document',
      objectId: doc.id,
      after: { signatureId: sig.id, signer: b.name, authority: b.authority, sha256: version.sha256, version: version.version, mfaAt: sig.mfaAt },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'clients.edit',
      type: 'document.signed',
      title: `Signed · ${doc.name}`,
      body: `${b.name} (${b.authority}) signed for ${ic.client.name}.`,
    });
  });
  await markRead(doc.id, ic.userId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- service requests

const REQUEST_TYPES = [
  'Statement / report',
  'Contribution / funding instruction',
  'Withdrawal enquiry',
  'Profile update',
  'Mandate / investment query',
  'Complaint / service issue',
  'Other',
] as const;

const requestSchema = z.object({
  type: z.enum(REQUEST_TYPES),
  priority: z.enum(['Normal', 'Time sensitive']).default('Normal'),
  detail: z.string().trim().min(1, 'Explain what you need before submitting').max(4000),
  title: z.string().trim().max(200).optional(),
});

async function createRequest(req: Parameters<typeof ctx>[0], ic: InvestorContext, b: z.infer<typeof requestSchema>, file?: Express.Multer.File) {
  return prisma.$transaction(async (tx) => {
    const stored = file
      ? await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: ic.userId }, tx)
      : null;
    const ref = await nextRef(tx, 'request');
    const row = await tx.serviceRequest.create({
      data: {
        ref,
        clientId: ic.client.id,
        type: b.type,
        priority: b.priority,
        title: b.title || b.type,
        detail: b.detail,
        status: 'Open',
        ownerName: 'Unassigned',
        progress: 10,
        slaDueAt: new Date(Date.now() + (SLA_HOURS[b.priority] ?? 48) * 3_600_000),
        fileId: stored?.id ?? null,
        openedById: ic.userId,
        events: { create: { title: 'Submitted', detail: 'Request received through investor portal', actorId: ic.userId } },
      },
      include: requestInclude,
    });
    await writeAudit(tx, audit(req), {
      action: 'service_request.created',
      objectType: 'service_request',
      objectId: row.id,
      after: { ref, type: b.type, priority: b.priority, file: stored?.name },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'clients.edit',
      type: 'service_request.created',
      title: `${ref} · ${b.type}`,
      body: `${ic.client.name}: ${b.detail.slice(0, 180)}`,
      link: '/?page=clients',
    });
    return row;
  });
}

investorRoutes.post('/requests', uploadFiles('file'), async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'requests.view');
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid request', parsed.error.issues);
  const row = await createRequest(req, ic, parsed.data, uploadedFiles(req)[0]);
  res.status(201).json({ request: requestView(row) });
});

/** Profile / bank-detail changes never edit master data directly - they open a controlled request. */
investorRoutes.post('/profile-change-requests', validateBody(z.object({ detail: z.string().trim().min(1).max(4000), field: z.string().trim().max(80).optional() })), async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'profile.view');
  const { detail, field } = req.body as { detail: string; field?: string };
  const row = await createRequest(req, ic, { type: 'Profile update', priority: 'Normal', detail, title: field ? `Profile update · ${field}` : undefined });
  res.status(201).json({ request: requestView(row) });
});

investorRoutes.post('/requests/:ref/reply', validateBody(z.object({ text: z.string().trim().min(1).max(4000) })), async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'requests.view');
  const r = await prisma.serviceRequest.findFirst({ where: { clientId: ic.client.id, ref: param(req, 'ref') } });
  if (!r) throw HttpError.notFound('Request not found');
  const row = await prisma.$transaction(async (tx) => {
    await tx.serviceRequestEvent.create({ data: { requestId: r.id, title: 'Client response', detail: req.body.text, actorId: ic.userId } });
    const updated = await tx.serviceRequest.update({
      where: { id: r.id },
      data: { ...(r.status === 'Waiting on you' ? { status: 'In progress' } : {}), version: { increment: 1 } },
      include: requestInclude,
    });
    await writeAudit(tx, audit(req), { action: 'service_request.client_reply', objectType: 'service_request', objectId: r.id });
    return updated;
  });
  res.json({ request: requestView(row) });
});

// ---------------------------------------------------------------- messages

investorRoutes.post('/threads', validateBody(z.object({ title: z.string().trim().min(1).max(200).default('New investor message'), text: z.string().trim().max(4000).optional() })), async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'messages.view');
  const { title, text } = req.body as { title: string; text?: string };
  const thread = await prisma.$transaction(async (tx) => {
    const t = await tx.messageThread.create({
      data: {
        clientId: ic.client.id,
        title,
        ownerName: 'Client Services',
        ownerRole: 'Client Services',
        ...(text ? { messages: { create: { authorId: ic.userId, authorName: actorName(req), fromClient: true, body: text } } } : {}),
      },
      include: threadInclude(ic.userId),
    });
    await writeAudit(tx, audit(req), { action: 'message_thread.created', objectType: 'message_thread', objectId: t.id, after: { title } });
    return t;
  });
  res.status(201).json({ thread: threadView(thread, 'investor') });
});

investorRoutes.post('/threads/:id/messages', validateBody(z.object({ text: z.string().trim().min(1).max(4000) })), async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'messages.view');
  const t = await prisma.messageThread.findFirst({ where: { id: param(req, 'id'), clientId: ic.client.id } });
  if (!t) throw HttpError.notFound('Conversation not found');
  const thread = await prisma.$transaction(async (tx) => {
    await tx.message.create({ data: { threadId: t.id, authorId: ic.userId, authorName: actorName(req), fromClient: true, body: req.body.text } });
    await tx.messageRead.upsert({
      where: { threadId_userId: { threadId: t.id, userId: ic.userId } },
      create: { threadId: t.id, userId: ic.userId },
      update: { readAt: new Date() },
    });
    await tx.messageThread.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
    await enqueue(tx, 'notify.permission', {
      permission: 'clients.edit',
      type: 'message.received',
      title: `Secure message · ${ic.client.name}`,
      body: `${t.title}: ${String(req.body.text).slice(0, 180)}`,
    });
    return tx.messageThread.findUniqueOrThrow({ where: { id: t.id }, include: threadInclude(ic.userId) });
  });
  res.json({ thread: threadView(thread, 'investor') });
});

investorRoutes.post('/threads/:id/read', async (req, res) => {
  const ic = await investorContext(req);
  const t = await prisma.messageThread.findFirst({ where: { id: param(req, 'id'), clientId: ic.client.id }, select: { id: true } });
  if (!t) throw HttpError.notFound('Conversation not found');
  await prisma.messageRead.upsert({
    where: { threadId_userId: { threadId: t.id, userId: ic.userId } },
    create: { threadId: t.id, userId: ic.userId },
    update: { readAt: new Date() },
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- portal users

const ROLE_BY_LABEL: Record<string, string> = Object.fromEntries(Object.entries(INVESTOR_ROLE_LABELS).map(([k, v]) => [v, k]));
const SCOPE_BY_LABEL: Record<string, string> = Object.fromEntries(Object.entries(SCOPE_LABELS).map(([k, v]) => [v, k]));

const inviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  role: z.string().trim().transform((v) => ROLE_BY_LABEL[v] ?? v).pipe(z.enum(['admin', 'investment', 'finance', 'auditor'])),
  scope: z.string().trim().default('all').transform((v) => SCOPE_BY_LABEL[v] ?? v).pipe(z.enum(['all', 'managed', 'private', 'documents'])),
});

investorRoutes.post('/users/invite', validateBody(inviteSchema), async (req, res) => {
  const ic = await investorContext(req);
  requireInvestorPermission(ic, 'users.invite');
  const b = req.body as z.infer<typeof inviteSchema>;
  const existing = await prisma.clientUser.findFirst({ where: { clientId: ic.client.id, user: { email: b.email } } });
  if (existing) throw HttpError.conflict('This person already has access to the relationship', 'already_member');
  await prisma.$transaction(async (tx) => {
    const { invitation } = await createInvitation(tx, {
      email: b.email,
      name: b.name,
      portal: 'investor',
      roleKeys: [b.role],
      clientId: ic.client.id,
      scope: b.scope,
      invitedById: ic.userId,
      context: `the Matanho investor portal for ${ic.client.name}`,
    });
    await writeAudit(tx, audit(req), {
      action: 'investor_user.invited',
      objectType: 'client',
      objectId: ic.client.id,
      after: { invitationId: invitation.id, email: b.email, role: b.role, scope: b.scope },
    });
  });
  res.status(201).json({ data: await portalUsersView(ic.client.id) });
});
