import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { policy } from '../../lib/policy';
import { actorName, ctx, expectVersion, param } from '../../lib/http';
import { fmtDate, fmtSize } from '../../lib/format';
import { signedDownloadUrl, storeFile } from '../../lib/storage';
import { validateBody } from '../../middleware/validate';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';

/** `/api/v1/documents` - staff document lifecycle: draft → review → approved → published (SRD 8.1 / 9.4). */
export const documentsRoutes = Router();
documentsRoutes.use(requireAuth, requirePortalAccess('admin'));

const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'admin');

/** Investor-facing types plus the admin vault's folders. */
const DOC_TYPES = ['report', 'statement', 'capital', 'legal', 'tax', 'kyc', 'company', 'research', 'ic', 'clients', 'compliance', 'valuations', 'other'] as const;
/** Admin vault folder for each document type. */
const VAULT_FOLDER: Record<string, string> = { report: 'clients', statement: 'clients', capital: 'clients', tax: 'clients', kyc: 'compliance', company: 'valuations', other: 'research' };
const ACCESS_LABEL: Record<string, string> = { Public: 'Public', Client: 'Client + Investment', Internal: 'Investment team', Restricted: 'Compliance only' };

const staffInclude = {
  versions: { orderBy: { version: 'desc' } },
  publications: { where: { withdrawnAt: null } },
  signatureRequests: { include: { signatures: true } },
} satisfies Prisma.DocumentInclude;
type StaffDoc = Prisma.DocumentGetPayload<{ include: typeof staffInclude }>;

async function staffView(d: StaffDoc) {
  const fileIds = d.versions.map((v) => v.fileId);
  const files = fileIds.length ? await prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true, size: true } }) : [];
  const byId = new Map(files.map((f) => [f.id, f]));
  const clientIds = [...new Set([d.clientId, ...d.publications.map((p) => p.clientId)].filter(Boolean) as string[])];
  const clients = clientIds.length ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, ref: true, name: true } }) : [];
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const latest = d.versions[0];
  return {
    id: d.ref,
    uuid: d.id,
    name: d.name,
    type: d.type,
    folder: VAULT_FOLDER[d.type] ?? d.type,
    label: d.label ?? d.type,
    classification: d.classification,
    access: ACCESS_LABEL[d.classification] ?? d.classification,
    format: (latest ? (byId.get(latest.fileId)?.name.split('.').pop() ?? 'FILE') : 'FILE').toUpperCase().slice(0, 5),
    status: d.status,
    owner: d.ownerName ?? 'Client Services',
    related: d.relatedLabel ?? '—',
    client: d.clientId ? (clientById.get(d.clientId)?.name ?? null) : null,
    clientId: d.clientId ? (clientById.get(d.clientId)?.ref ?? null) : null,
    date: fmtDate(d.documentDate ?? d.createdAt),
    year: d.year,
    requiresSignature: d.requiresSignature,
    retentionYears: d.retentionYears,
    currentVersion: latest?.version ?? 0,
    size: fmtSize(latest ? byId.get(latest.fileId)?.size : null),
    fileName: latest ? (byId.get(latest.fileId)?.name ?? null) : null,
    versions: d.versions.map((v) => ({ version: v.version, sha256: v.sha256, file: byId.get(v.fileId)?.name ?? null, at: v.createdAt })),
    publications: d.publications.map((p) => ({ clientId: clientById.get(p.clientId)?.ref, client: clientById.get(p.clientId)?.name, publishedAt: p.publishedAt })),
    signatures: d.signatureRequests.map((s) => ({
      clientId: clientById.get(s.clientId)?.ref,
      status: s.status,
      signedBy: s.signatures.map((x) => ({ name: x.signerName, authority: x.authority, at: x.signedAt })),
    })),
    makerId: d.makerId,
    checkerId: d.checkerId,
    approvedAt: d.approvedAt,
    version: d.version,
  };
}

async function findDoc(refOrId: string) {
  const d = await prisma.document.findFirst({ where: { OR: [{ ref: refOrId }, { id: refOrId }] }, include: staffInclude });
  if (!d) throw HttpError.notFound('Document not found');
  return d;
}

async function clientByRef(ref: string | undefined | null) {
  if (!ref) return null;
  const c = await prisma.client.findFirst({ where: { OR: [{ ref }, { id: ref }], archivedAt: null }, select: { id: true, ref: true, name: true } });
  if (!c) throw HttpError.badRequest(`Unknown client ${ref}`);
  return c;
}

documentsRoutes.get('/', requirePermission('documents.view'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const client = await clientByRef(typeof req.query.clientId === 'string' ? req.query.clientId : undefined);
  const rows = await prisma.document.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(client ? { OR: [{ clientId: client.id }, { publications: { some: { clientId: client.id } } }] } : {}),
      ...(q ? { AND: [{ OR: [{ name: { contains: q } }, { ref: { contains: q } }, { relatedLabel: { contains: q } }] }] } : {}),
    },
    include: staffInclude,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ data: await Promise.all(rows.map(staffView)), total: rows.length });
});

documentsRoutes.get('/:id', requirePermission('documents.view'), async (req, res) => {
  res.json({ document: await staffView(await findDoc(param(req, 'id'))) });
});

const metaSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(DOC_TYPES).default('other'),
  label: z.string().trim().max(120).optional(),
  classification: z.enum(['Public', 'Client', 'Internal', 'Restricted']).default('Client'),
  clientId: z.string().trim().max(40).optional(),
  relatedLabel: z.string().trim().max(160).optional(),
  documentDate: z.coerce.date().optional(),
  requiresSignature: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true').default(false),
  retentionYears: z.coerce.number().int().min(1).max(50).default(7),
});

documentsRoutes.post('/', requirePermission('documents.edit'), uploadFiles('file'), async (req, res) => {
  const parsed = metaSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid document', parsed.error.issues);
  const b = parsed.data;
  const file = uploadedFiles(req)[0];
  if (!file) throw HttpError.badRequest('Attach the document file');
  const client = await clientByRef(b.clientId);
  const id = await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: req.user!.id }, tx);
    const ref = await nextRef(tx, 'document');
    const doc = await tx.document.create({
      data: {
        ref,
        name: b.name,
        type: b.type,
        label: b.label ?? null,
        classification: b.classification,
        status: 'Draft',
        ownerName: actorName(req),
        clientId: client?.id ?? null,
        relatedLabel: b.relatedLabel ?? client?.name ?? null,
        relatedType: client ? 'client' : null,
        relatedId: client?.id ?? null,
        documentDate: b.documentDate ?? null,
        year: (b.documentDate ?? new Date()).getFullYear(),
        requiresSignature: b.requiresSignature,
        retentionYears: b.retentionYears,
        makerId: req.user!.id,
        createdBy: req.user!.id,
        versions: { create: { version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: req.user!.id } },
      },
    });
    await writeAudit(tx, audit(req), { action: 'document.created', objectType: 'document', objectId: doc.id, after: { ref, ...b, sha256: stored.sha256 } });
    return doc.id;
  });
  res.status(201).json({ document: await staffView(await findDoc(id)) });
});

documentsRoutes.post('/:id/versions', requirePermission('documents.edit'), uploadFiles('file'), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  const file = uploadedFiles(req)[0];
  if (!file) throw HttpError.badRequest('Attach the new version');
  if (d.status === 'Superseded') throw HttpError.conflict('This document has been superseded', 'invalid_state');
  const next = (d.versions[0]?.version ?? 0) + 1;
  await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: req.user!.id }, tx);
    await tx.documentVersion.create({ data: { documentId: d.id, version: next, fileId: stored.id, sha256: stored.sha256, uploadedById: req.user!.id } });
    // A new version of a published document must be re-approved before investors see it.
    await tx.document.update({
      where: { id: d.id },
      data: { status: 'Draft', makerId: req.user!.id, checkerId: null, approvedAt: null, updatedBy: req.user!.id, version: { increment: 1 } },
    });
    if (d.status === 'Published') {
      await tx.publication.updateMany({ where: { documentId: d.id, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
    }
    await writeAudit(tx, audit(req), {
      action: 'document.version_added',
      objectType: 'document',
      objectId: d.id,
      before: { status: d.status, version: next - 1 },
      after: { status: 'Draft', version: next, sha256: stored.sha256 },
    });
  });
  res.json({ document: await staffView(await findDoc(d.id)) });
});

async function transition(
  req: Parameters<typeof ctx>[0],
  d: StaffDoc,
  to: string,
  data: Prisma.DocumentUpdateInput,
  extra: { action: string; reason?: string },
) {
  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: d.id }, data: { ...data, status: to, updatedBy: req.user!.id, version: { increment: 1 } } });
    await writeAudit(tx, audit(req), {
      action: extra.action,
      objectType: 'document',
      objectId: d.id,
      before: { status: d.status },
      after: { status: to },
      reason: extra.reason,
    });
  });
}

documentsRoutes.post('/:id/submit', requirePermission('documents.edit'), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  expectVersion(req, d.version);
  if (d.status !== 'Draft') throw HttpError.conflict(`Only drafts can be submitted (currently ${d.status})`, 'invalid_state');
  await transition(req, d, 'In review', { makerId: req.user!.id }, { action: 'document.submitted' });
  await prisma.$transaction((tx) =>
    enqueue(tx, 'notify.permission', { permission: 'documents.edit', type: 'document.review', title: `Review requested · ${d.name}`, body: `${actorName(req)} submitted ${d.ref} for approval.` }),
  );
  res.json({ document: await staffView(await findDoc(d.id)) });
});

documentsRoutes.post('/:id/approve', requirePermission('documents.edit'), requireStepUp, async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  expectVersion(req, d.version);
  if (d.status !== 'In review') throw HttpError.conflict(`Only documents in review can be approved (currently ${d.status})`, 'invalid_state');
  if ((await policy('document_approval')) && d.makerId === req.user!.id) {
    throw HttpError.forbidden('Maker-checker: a different person must approve this document', 'sod_violation');
  }
  await transition(req, d, 'Approved', { checkerId: req.user!.id, approvedAt: new Date() }, { action: 'document.approved' });
  res.json({ document: await staffView(await findDoc(d.id)) });
});

documentsRoutes.post('/:id/return', requirePermission('documents.edit'), validateBody(z.object({ reason: z.string().trim().min(3).max(1000) })), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  if (d.status !== 'In review' && d.status !== 'Approved') throw HttpError.conflict(`Cannot return a ${d.status} document`, 'invalid_state');
  await transition(req, d, 'Draft', { checkerId: null, approvedAt: null }, { action: 'document.returned', reason: req.body.reason });
  res.json({ document: await staffView(await findDoc(d.id)) });
});

const publishSchema = z.object({
  clientIds: z.array(z.string().min(1)).max(500).optional(),
  signatureDueDate: z.coerce.date().optional(),
});

/** Publishes an approved client document to one or more client relationships. */
documentsRoutes.post('/:id/publish', requirePermission('documents.edit'), validateBody(publishSchema), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  if (d.status !== 'Approved' && d.status !== 'Published') {
    throw HttpError.conflict('Only approved documents can be published', 'invalid_state');
  }
  if (d.classification !== 'Client' && d.classification !== 'Public') {
    throw HttpError.conflict(`${d.classification} documents cannot be published to investors`, 'invalid_state');
  }
  if (!d.versions[0]) throw HttpError.conflict('Attach a file before publishing', 'invalid_state');
  const { clientIds, signatureDueDate } = req.body as z.infer<typeof publishSchema>;
  const refs = clientIds?.length ? clientIds : d.clientId ? [d.clientId] : [];
  if (!refs.length) throw HttpError.badRequest('Choose at least one client to publish to');
  const clients = await Promise.all(refs.map((r) => clientByRef(r)));
  await prisma.$transaction(async (tx) => {
    for (const c of clients) {
      if (!c) continue;
      await tx.publication.upsert({
        where: { documentId_clientId: { documentId: d.id, clientId: c.id } },
        create: { documentId: d.id, clientId: c.id, publishedById: req.user!.id },
        update: { withdrawnAt: null, publishedAt: new Date(), publishedById: req.user!.id },
      });
      if (d.requiresSignature) {
        const open = await tx.signatureRequest.findFirst({ where: { documentId: d.id, clientId: c.id, status: 'Pending' } });
        if (!open) {
          await tx.signatureRequest.create({ data: { documentId: d.id, clientId: c.id, requestedById: req.user!.id, dueDate: signatureDueDate ?? null } });
        }
      }
      const members = await tx.clientUser.findMany({ where: { clientId: c.id }, select: { userId: true } });
      if (members.length) {
        await enqueue(tx, 'notify.users', {
          userIds: members.map((m) => m.userId),
          type: 'document.published',
          title: d.requiresSignature ? `Signature required · ${d.name}` : `New document · ${d.name}`,
          body: `${d.label ?? 'Document'} published to your investor portal.`,
          link: '/?page=documents',
          email: true,
        });
      }
    }
    await tx.document.update({ where: { id: d.id }, data: { status: 'Published', updatedBy: req.user!.id, version: { increment: 1 } } });
    await writeAudit(tx, audit(req), {
      action: 'document.published',
      objectType: 'document',
      objectId: d.id,
      before: { status: d.status },
      after: { status: 'Published', clients: clients.map((c) => c?.ref), version: d.versions[0]!.version },
    });
  });
  res.json({ document: await staffView(await findDoc(d.id)) });
});

documentsRoutes.post('/:id/withdraw', requirePermission('documents.edit'), validateBody(z.object({ clientId: z.string().optional(), reason: z.string().trim().min(3).max(1000) })), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  const client = await clientByRef(req.body.clientId);
  await prisma.$transaction(async (tx) => {
    await tx.publication.updateMany({ where: { documentId: d.id, withdrawnAt: null, ...(client ? { clientId: client.id } : {}) }, data: { withdrawnAt: new Date() } });
    await tx.signatureRequest.updateMany({ where: { documentId: d.id, status: 'Pending', ...(client ? { clientId: client.id } : {}) }, data: { status: 'Cancelled' } });
    const remaining = await tx.publication.count({ where: { documentId: d.id, withdrawnAt: null } });
    if (!remaining) await tx.document.update({ where: { id: d.id }, data: { status: 'Approved', version: { increment: 1 } } });
    await writeAudit(tx, audit(req), { action: 'document.withdrawn', objectType: 'document', objectId: d.id, after: { client: client?.ref ?? 'all' }, reason: req.body.reason });
  });
  res.json({ document: await staffView(await findDoc(d.id)) });
});

documentsRoutes.get('/:id/download-url', requirePermission('documents.view'), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  const wanted = Number(req.query.version) || d.versions[0]?.version;
  const v = d.versions.find((x) => x.version === wanted);
  if (!v) throw HttpError.notFound('No file for that version');
  if (d.classification === 'Restricted' && !req.user!.permissions.includes('audit.view') && d.makerId !== req.user!.id) {
    throw HttpError.forbidden('Restricted document', 'permission_denied');
  }
  await prisma.$transaction((tx) =>
    writeAudit(tx, audit(req), { action: 'document.downloaded', objectType: 'document', objectId: d.id, after: { version: v.version } }),
  );
  res.json({ url: signedDownloadUrl(v.fileId), expiresIn: 300 });
});
