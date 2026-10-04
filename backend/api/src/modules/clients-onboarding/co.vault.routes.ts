import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { fmtSize } from '../../lib/format';

import { param, query } from '../../lib/http';
import { signedDownloadUrl, storeFile } from '../../lib/storage';
import { nextRef } from '../../lib/refs';
import { uploadFiles } from '../../middleware/upload';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAnyPermission, requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, audit, notifyPermission } from '../ops/ops.common';
import { CLASSIFICATIONS, documentChangeProblem, retentionState } from './co.engine';
import { userNames } from './co.service';
import { scheduleMinimum } from '../../lib/retention-schedule';

/** Exact bytes below 1 KB (the shared formatter rounds 22 bytes up to "1 KB"). */
const sizeLabel = (n: number | null | undefined) => (n && n < 1000 ? `${n} B` : fmtSize(n));

/** Document Vault (page `vault`): register over the document store with classification, retention, holds, versions and access log. */
export const coVaultRoutes = Router();

async function findDoc(refOrId: string) {
  const d = await prisma.document.findFirst({ where: { OR: [{ ref: refOrId }, { id: refOrId }] } });
  if (!d) throw HttpError.notFound('Document not found');
  return d;
}

async function holdsOf(ids: string[]) {
  const rows = ids.length ? await prisma.documentHold.findMany({ where: { documentId: { in: ids }, releasedAt: null } }) : [];
  return new Map(rows.map((h) => [h.documentId, h]));
}

type Doc = Prisma.DocumentGetPayload<object>;

async function registerRows(docs: Doc[]) {
  const ids = docs.map((d) => d.id);
  const [holds, clients, funds, versions, pending] = await Promise.all([
    holdsOf(ids),
    prisma.client.findMany({ where: { id: { in: docs.map((d) => d.clientId).filter(Boolean) as string[] } }, select: { id: true, ref: true, name: true } }),
    prisma.fund.findMany({ where: { id: { in: docs.map((d) => d.fundId).filter(Boolean) as string[] } }, select: { id: true, ref: true, name: true } }),
    prisma.documentVersion.groupBy({ by: ['documentId'], where: { documentId: { in: ids } }, _count: true }),
    prisma.documentChange.groupBy({ by: ['documentId'], where: { documentId: { in: ids }, status: 'PENDING' }, _count: true }),
  ]);
  const cl = new Map(clients.map((c) => [c.id, c]));
  const fd = new Map(funds.map((f) => [f.id, f]));
  const vc = new Map(versions.map((v) => [v.documentId, v._count]));
  const pc = new Map(pending.map((v) => [v.documentId, v._count]));
  return docs.map((d) => {
    const held = holds.has(d.id);
    const ret = retentionState(d.documentDate ?? d.createdAt, d.retentionYears, held);
    return {
      id: d.ref,
      uuid: d.id,
      name: d.name,
      type: d.type,
      classification: d.classification,
      status: d.status,
      owner: d.ownerName,
      client: d.clientId ? (cl.get(d.clientId)?.name ?? null) : null,
      clientRef: d.clientId ? (cl.get(d.clientId)?.ref ?? null) : null,
      fund: d.fundId ? (fd.get(d.fundId)?.name ?? null) : null,
      fundRef: d.fundId ? (fd.get(d.fundId)?.ref ?? null) : null,
      date: d.documentDate ?? d.createdAt,
      versions: vc.get(d.id) ?? 0,
      retentionYears: d.retentionYears,
      retainUntil: ret.retainUntil,
      retention: ret.state,
      held,
      pendingChanges: pc.get(d.id) ?? 0,
    };
  });
}

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.string().trim().max(32).optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  status: z.string().trim().max(24).optional(),
  client: z.string().trim().max(40).optional(),
  fund: z.string().trim().max(40).optional(),
  retention: z.enum(['Held', 'Disposal eligible', 'Due within 90 days', 'Retained']).optional(),
});

coVaultRoutes.get('/vault/documents', requirePermission('documents.view'), validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const client = f.client ? await prisma.client.findFirst({ where: { OR: [{ ref: f.client }, { id: f.client }] }, select: { id: true } }) : null;
  const fund = f.fund ? await prisma.fund.findFirst({ where: { OR: [{ ref: f.fund }, { id: f.fund }] }, select: { id: true } }) : null;
  if ((f.client && !client) || (f.fund && !fund)) return res.json({ data: [], total: 0 });
  const docs = await prisma.document.findMany({
    where: {
      ...(f.type ? { type: f.type } : {}),
      ...(f.classification ? { classification: f.classification } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(client ? { clientId: client.id } : {}),
      ...(fund ? { fundId: fund.id } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q } }, { ref: { contains: f.q } }, { relatedLabel: { contains: f.q } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  let data = await registerRows(docs);
  if (f.retention) data = data.filter((d) => d.retention === f.retention);
  res.json({ data, total: data.length });
});

coVaultRoutes.get('/vault/summary', requirePermission('documents.view'), async (_req, res) => {
  const docs = await prisma.document.findMany({ select: { id: true, createdAt: true, documentDate: true, retentionYears: true, classification: true, type: true, status: true }, take: 5000 });
  const holds = await holdsOf(docs.map((d) => d.id));
  const byClass: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const ret: Record<string, number> = {};
  for (const d of docs) {
    byClass[d.classification] = (byClass[d.classification] ?? 0) + 1;
    byType[d.type] = (byType[d.type] ?? 0) + 1;
    const s = retentionState(d.documentDate ?? d.createdAt, d.retentionYears, holds.has(d.id)).state;
    ret[s] = (ret[s] ?? 0) + 1;
  }
  const [pendingChanges, reads] = await Promise.all([
    prisma.documentChange.count({ where: { status: 'PENDING' } }),
    prisma.documentAccessLog.count({ where: { at: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
  ]);
  res.json({ total: docs.length, byClassification: byClass, byType, retention: ret, held: holds.size, pendingChanges, accessLast7Days: reads });
});

coVaultRoutes.get('/vault/documents/:id', requirePermission('documents.view'), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  const [row] = await registerRows([d]);
  const [versions, holds, changes, log, pubs] = await Promise.all([
    prisma.documentVersion.findMany({ where: { documentId: d.id }, orderBy: { version: 'desc' } }),
    prisma.documentHold.findMany({ where: { documentId: d.id }, orderBy: { placedAt: 'desc' } }),
    prisma.documentChange.findMany({ where: { documentId: d.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.documentAccessLog.findMany({ where: { documentId: d.id }, orderBy: { at: 'desc' }, take: 100 }),
    prisma.publication.findMany({ where: { documentId: d.id, withdrawnAt: null }, select: { clientId: true, publishedAt: true } }),
  ]);
  const files = await prisma.fileObject.findMany({ where: { id: { in: versions.map((v) => v.fileId) } }, select: { id: true, name: true, size: true, mime: true, scanStatus: true } });
  const fm = new Map(files.map((f) => [f.id, f]));
  const names = await userNames([...versions.map((v) => v.uploadedById), ...holds.flatMap((h) => [h.placedBy, h.releasedBy]), ...changes.flatMap((c) => [c.makerId, c.checkerId]), ...log.map((l) => l.userId)]);
  const pubClients = await prisma.client.findMany({ where: { id: { in: pubs.map((p) => p.clientId) } }, select: { id: true, ref: true, name: true } });
  const pc = new Map(pubClients.map((c) => [c.id, c]));
  res.json({
    document: { ...row, makerId: d.makerId, label: d.label, relatedLabel: d.relatedLabel, period: d.period, year: d.year, requiresSignature: d.requiresSignature, sourceType: d.sourceType, createdAt: d.createdAt },
    versions: versions.map((v) => ({ version: v.version, sha256: v.sha256, file: fm.get(v.fileId)?.name ?? null, size: sizeLabel(fm.get(v.fileId)?.size), mime: fm.get(v.fileId)?.mime ?? null, scan: fm.get(v.fileId)?.scanStatus ?? null, by: v.uploadedById ? (names.get(v.uploadedById) ?? null) : null, at: v.createdAt })),
    holds: holds.map((h) => ({ id: h.id, reason: h.reason, placedBy: names.get(h.placedBy) ?? null, placedById: h.placedBy, placedAt: h.placedAt, releasedBy: h.releasedBy ? (names.get(h.releasedBy) ?? null) : null, releasedAt: h.releasedAt, releaseNote: h.releaseNote })),
    changes: changes.map((c) => ({ id: c.id, kind: c.kind, from: c.fromValue, to: c.toValue, reason: c.reason, status: c.status, maker: names.get(c.makerId) ?? null, makerId: c.makerId, checker: c.checkerId ? (names.get(c.checkerId) ?? null) : null, decisionNote: c.decisionNote, at: c.createdAt, decidedAt: c.decidedAt })),
    published: pubs.map((p) => ({ client: pc.get(p.clientId)?.name ?? null, clientRef: pc.get(p.clientId)?.ref ?? null, at: p.publishedAt })),
    accessLog: log.map((l) => ({ id: String(l.id), action: l.action, by: l.userId ? (names.get(l.userId) ?? null) : null, at: l.at, ip: l.ip })),
  });
});

/** Signed download; every download is written to the access log and the audit trail. */
coVaultRoutes.get('/vault/documents/:id/download-url', requirePermission('documents.view'), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  const versions = await prisma.documentVersion.findMany({ where: { documentId: d.id }, orderBy: { version: 'desc' } });
  const wanted = Number(req.query.version) || versions[0]?.version;
  const v = versions.find((x) => x.version === wanted);
  if (!v) throw HttpError.notFound('No file for that version');
  if (d.status === 'Disposed') throw new HttpError(410, 'disposed', 'This document was disposed at the end of its retention period');
  if (d.classification === 'Restricted' && !req.user!.permissions.includes('audit.view') && d.makerId !== req.user!.id) {
    throw HttpError.forbidden('Restricted document', 'permission_denied');
  }
  await prisma.$transaction(async (tx) => {
    await tx.documentAccessLog.create({ data: { documentId: d.id, userId: req.user!.id, action: 'download', ip: req.ip ?? null, userAgent: (req.get('user-agent') ?? '').slice(0, 255) || null } });
    await writeAudit(tx, audit(req), { action: 'document.downloaded', objectType: 'document', objectId: d.id, after: { version: v.version } });
  });
  res.json({ url: signedDownloadUrl(v.fileId), expiresIn: 300 });
});

coVaultRoutes.get('/vault/access-log', requireAnyPermission('audit.view', 'documents.approve'), validateQuery(z.object({ document: z.string().trim().max(40).optional(), action: z.string().trim().max(16).optional() })), async (req, res) => {
  const f = query<{ document?: string; action?: string }>(req);
  const doc = f.document ? await findDoc(f.document) : null;
  const rows = await prisma.documentAccessLog.findMany({ where: { ...(doc ? { documentId: doc.id } : {}), ...(f.action ? { action: f.action } : {}) }, orderBy: { at: 'desc' }, take: 300 });
  const [docs, names] = await Promise.all([
    prisma.document.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.documentId))] } }, select: { id: true, ref: true, name: true } }),
    userNames(rows.map((r) => r.userId)),
  ]);
  const dm = new Map(docs.map((d) => [d.id, d]));
  res.json({ data: rows.map((r) => ({ id: String(r.id), document: dm.get(r.documentId)?.ref ?? null, name: dm.get(r.documentId)?.name ?? null, action: r.action, by: r.userId ? (names.get(r.userId) ?? 'Investor user') : null, at: r.at, ip: r.ip })) });
});

const linkSchema = z.object({ clientId: z.string().trim().max(40).nullable().optional(), fundId: z.string().trim().max(40).nullable().optional(), relatedLabel: z.string().trim().max(160).optional() }).strict();

coVaultRoutes.post('/vault/documents/:id/link', requirePermission('documents.edit'), validateBody(linkSchema), idempotent('clients-onboarding.post.vault_documents_id_link', { required: false }), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  const b = req.body as z.infer<typeof linkSchema>;
  const client = b.clientId ? await prisma.client.findFirst({ where: { OR: [{ ref: b.clientId }, { id: b.clientId }], archivedAt: null }, select: { id: true, ref: true } }) : null;
  const fund = b.fundId ? await prisma.fund.findFirst({ where: { OR: [{ ref: b.fundId }, { id: b.fundId }] }, select: { id: true, ref: true } }) : null;
  if (b.clientId && !client) throw HttpError.badRequest('Validation failed', [{ path: 'clientId', message: 'Unknown client' }]);
  if (b.fundId && !fund) throw HttpError.badRequest('Validation failed', [{ path: 'fundId', message: 'Unknown fund' }]);
  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: d.id },
      data: {
        ...(b.clientId !== undefined ? { clientId: client?.id ?? null } : {}),
        ...(b.fundId !== undefined ? { fundId: fund?.id ?? null } : {}),
        ...(b.relatedLabel !== undefined ? { relatedLabel: b.relatedLabel || null } : {}),
        updatedBy: req.user!.id,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, audit(req), { action: 'document.linked', objectType: 'document', objectId: d.id, before: { clientId: d.clientId, fundId: d.fundId }, after: { clientId: client?.id ?? (b.clientId === undefined ? d.clientId : null), fundId: fund?.id ?? (b.fundId === undefined ? d.fundId : null) } });
  });
  const [row] = await registerRows([await findDoc(d.id)]);
  res.json({ document: row });
});

// ------------------------------------------------------------ maker-checker changes

const changeSchema = z.object({ kind: z.enum(['CLASSIFICATION', 'RETENTION', 'DISPOSAL']), to: z.union([z.string().trim().min(1).max(32), z.number().int()]).transform(String), reason: z.string().trim().min(5).max(500) }).strict();

coVaultRoutes.post('/vault/documents/:id/changes', requirePermission('documents.edit'), validateBody(changeSchema), idempotent('co.doc_change', { required: false }), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  const b = req.body as z.infer<typeof changeSchema>;
  const from = b.kind === 'CLASSIFICATION' ? d.classification : b.kind === 'DISPOSAL' ? d.status : String(d.retentionYears);
  const held = !!(await prisma.documentHold.findFirst({ where: { documentId: d.id, releasedAt: null }, select: { id: true } }));
  const problem = documentChangeProblem(b.kind, from, b.to, held);
  if (problem) throw HttpError.badRequest('Validation failed', [{ path: 'to', message: problem }]);
  if (b.kind === 'RETENTION') {
    const min = await scheduleMinimum(d.type, d.classification);
    if (Number(b.to) < min) throw HttpError.badRequest('Validation failed', [{ path: 'to', message: `The retention schedule requires at least ${min} years for this document type and classification` }]);
  }
  if (b.kind === 'DISPOSAL' && retentionState(d.documentDate ?? d.createdAt, d.retentionYears, false).state !== 'Disposal eligible') throw HttpError.badRequest('Validation failed', [{ path: 'to', message: 'The retention period has not ended; only a disposal-eligible document can be disposed' }]);
  if (await prisma.documentChange.findFirst({ where: { documentId: d.id, kind: b.kind, status: 'PENDING' }, select: { id: true } })) {
    throw HttpError.conflict(`A ${b.kind.toLowerCase()} change is already awaiting approval for this document`, 'change_pending');
  }
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.documentChange.create({ data: { documentId: d.id, kind: b.kind, fromValue: from, toValue: b.to, reason: b.reason, makerId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'document.change_proposed', objectType: 'document', objectId: d.id, after: { changeId: c.id, kind: b.kind, from, to: b.to }, reason: b.reason });
    await notifyPermission(tx, 'documents.approve', { type: 'document.change.pending', title: `${d.ref}: ${b.kind.toLowerCase()} change awaits approval`, body: `${from} to ${b.to}`, link: '/ops/vault' });
    return c;
  });
  res.status(201).json({ change: { id: row.id, kind: row.kind, from, to: b.to, status: row.status } });
});

coVaultRoutes.get('/vault/changes', requirePermission('documents.view'), validateQuery(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') })), async (req, res) => {
  const f = query<{ status: string }>(req);
  const rows = await prisma.documentChange.findMany({ where: { status: f.status }, orderBy: { createdAt: 'desc' }, take: 200 });
  const [docs, names] = await Promise.all([
    prisma.document.findMany({ where: { id: { in: rows.map((r) => r.documentId) } }, select: { id: true, ref: true, name: true } }),
    userNames(rows.flatMap((r) => [r.makerId, r.checkerId])),
  ]);
  const dm = new Map(docs.map((d) => [d.id, d]));
  res.json({ data: rows.map((c) => ({ id: c.id, document: dm.get(c.documentId)?.ref ?? null, name: dm.get(c.documentId)?.name ?? null, kind: c.kind, from: c.fromValue, to: c.toValue, reason: c.reason, status: c.status, maker: names.get(c.makerId) ?? null, makerId: c.makerId, checker: c.checkerId ? (names.get(c.checkerId) ?? null) : null, at: c.createdAt })) });
});

const decideSchema = z.object({ note: z.string().trim().min(5).max(500) }).strict();

async function decideChange(req: Request, approve: boolean) {
  const c = await prisma.documentChange.findUnique({ where: { id: param(req, 'id') } });
  if (!c) throw HttpError.notFound('Change not found');
  if (c.status !== 'PENDING') throw HttpError.conflict(`The change is ${c.status}; it cannot be decided`, 'invalid_state');
  assertSegregation(req.user!.id, c.makerId);
  const d = await findDoc(c.documentId);
  if (approve) {
    const held = !!(await prisma.documentHold.findFirst({ where: { documentId: d.id, releasedAt: null }, select: { id: true } }));
    const current = c.kind === 'CLASSIFICATION' ? d.classification : c.kind === 'DISPOSAL' ? d.status : String(d.retentionYears);
    const problem = documentChangeProblem(c.kind, current, c.toValue, held);
    if (problem) throw HttpError.conflict(problem, 'invalid_state');
    if (c.kind === 'DISPOSAL' && retentionState(d.documentDate ?? d.createdAt, d.retentionYears, false).state !== 'Disposal eligible') throw HttpError.conflict('The document is no longer disposal eligible', 'invalid_state');
  }
  await prisma.$transaction(async (tx) => {
    const n = await tx.documentChange.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', checkerId: req.user!.id, decisionNote: req.body.note, decidedAt: new Date() } });
    if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    if (approve) {
      if (c.kind === 'DISPOSAL') {
        // Disposal retires the record: it is withdrawn from every investor and can no longer be downloaded. The audit trail and version hashes remain.
        await tx.document.update({ where: { id: d.id }, data: { status: 'Disposed', updatedBy: req.user!.id, version: { increment: 1 } } });
        await tx.publication.updateMany({ where: { documentId: d.id, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
        await tx.documentAccessLog.create({ data: { documentId: d.id, userId: req.user!.id, action: 'dispose', ip: req.ip ?? null, userAgent: (req.get('user-agent') ?? '').slice(0, 255) || null } });
      } else await tx.document.update({ where: { id: d.id }, data: { ...(c.kind === 'CLASSIFICATION' ? { classification: c.toValue } : { retentionYears: Number(c.toValue) }), updatedBy: req.user!.id, version: { increment: 1 } } });
    }
    await writeAudit(tx, audit(req), { action: approve ? 'document.change_approved' : 'document.change_rejected', objectType: 'document', objectId: d.id, before: { [c.kind.toLowerCase()]: c.fromValue }, after: { [c.kind.toLowerCase()]: approve ? c.toValue : c.fromValue, changeId: c.id }, reason: req.body.note });
  });
  return d.ref;
}

coVaultRoutes.post('/vault/changes/:id/approve', requirePermission('documents.approve'), validateBody(decideSchema), requireStepUp, idempotent('clients-onboarding.post.vault_changes_id_approve', { required: false }), async (req, res) => {
  res.json({ ok: true, document: await decideChange(req, true) });
});
coVaultRoutes.post('/vault/changes/:id/reject', requirePermission('documents.approve'), validateBody(decideSchema), idempotent('clients-onboarding.post.vault_changes_id_reject', { required: false }), async (req, res) => {
  res.json({ ok: true, document: await decideChange(req, false) });
});

// ------------------------------------------------------------ legal holds

coVaultRoutes.post('/vault/documents/:id/hold', requirePermission('documents.edit'), validateBody(z.object({ reason: z.string().trim().min(5).max(500) }).strict()), idempotent('co.doc_hold', { required: false }), async (req, res) => {
  const d = await findDoc(param(req, 'id'));
  if (await prisma.documentHold.findFirst({ where: { documentId: d.id, releasedAt: null }, select: { id: true } })) throw HttpError.conflict('The document is already on legal hold', 'already_held');
  const h = await prisma.$transaction(async (tx) => {
    const row = await tx.documentHold.create({ data: { documentId: d.id, reason: req.body.reason, placedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'document.hold_placed', objectType: 'document', objectId: d.id, after: { holdId: row.id }, reason: req.body.reason });
    return row;
  });
  res.status(201).json({ hold: { id: h.id, placedAt: h.placedAt } });
});

/** Releasing a hold is the checker step: a different person from whoever placed it, with step-up. */
coVaultRoutes.post('/vault/holds/:id/release', requirePermission('documents.approve'), validateBody(z.object({ note: z.string().trim().min(5).max(500) }).strict()), requireStepUp, idempotent('clients-onboarding.post.vault_holds_id_release', { required: false }), async (req, res) => {
  const h = await prisma.documentHold.findUnique({ where: { id: param(req, 'id') } });
  if (!h) throw HttpError.notFound('Hold not found');
  if (h.releasedAt) throw HttpError.conflict('The hold was already released', 'invalid_state');
  assertSegregation(req.user!.id, h.placedBy);
  await prisma.$transaction(async (tx) => {
    const n = await tx.documentHold.updateMany({ where: { id: h.id, releasedAt: null }, data: { releasedAt: new Date(), releasedBy: req.user!.id, releaseNote: req.body.note } });
    if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), { action: 'document.hold_released', objectType: 'document', objectId: h.documentId, after: { holdId: h.id }, reason: req.body.note });
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------ private-markets valuation evidence files

/** Valuation evidence rows (private-markets marks) with the vault document that holds the file, if any. */
coVaultRoutes.get('/vault/pm-evidence', requirePermission('documents.view'), async (_req, res) => {
  const rows = await prisma.pmEvidence.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { mark: { include: { commitment: { include: { fund: { select: { ref: true, name: true } } } } } } } });
  const docs = await prisma.document.findMany({ where: { id: { in: rows.map((r) => r.documentId).filter(Boolean) as string[] } }, select: { id: true, ref: true, name: true, status: true } });
  const dm = new Map(docs.map((d) => [d.id, d]));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      note: r.note,
      reference: r.reference,
      mark: r.mark.ref,
      markStatus: r.mark.status,
      asOf: r.mark.asOf,
      commitment: r.mark.commitment.ref,
      fund: r.mark.commitment.fund.name,
      document: r.documentId ? { id: dm.get(r.documentId)?.ref ?? null, name: dm.get(r.documentId)?.name ?? null, status: dm.get(r.documentId)?.status ?? null } : null,
      createdAt: r.createdAt,
    })),
  });
});

/** Attaches the evidence file: a vault document (new, or a new version when one is already linked) so the file is classified, retained and access-logged. */
coVaultRoutes.post('/vault/pm-evidence/:id/file', requirePermission('documents.edit'), uploadFiles('file', 1), async (req, res) => {
  const ev = await prisma.pmEvidence.findUnique({ where: { id: param(req, 'id') }, include: { mark: { include: { commitment: { include: { fund: { select: { ref: true, name: true } } } } } } } });
  if (!ev) throw HttpError.notFound('Evidence not found');
  const file = req.file;
  if (!file) throw HttpError.badRequest('Attach the evidence file');
  const ref = await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: req.user!.id }, tx);
    let doc = ev.documentId ? await tx.document.findUnique({ where: { id: ev.documentId } }) : null;
    if (doc) {
      const last = await tx.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { version: 'desc' } });
      await tx.documentVersion.create({ data: { documentId: doc.id, version: (last?.version ?? 0) + 1, fileId: stored.id, sha256: stored.sha256, uploadedById: req.user!.id } });
      await tx.document.update({ where: { id: doc.id }, data: { updatedBy: req.user!.id, version: { increment: 1 } } });
    } else {
      const dref = await nextRef(tx, 'document');
      doc = await tx.document.create({
        data: {
          ref: dref,
          name: `${ev.title}`.slice(0, 255),
          type: 'valuations',
          label: `Valuation evidence ${ev.mark.ref}`,
          classification: 'Internal',
          // Controlled by the mark's own maker-checker, and never shown to investors (Internal), so it is filed as approved.
          status: 'Approved',
          ownerName: req.user!.name ?? null,
          relatedType: 'pm_evidence',
          relatedId: ev.id,
          relatedLabel: `${ev.mark.commitment.fund.name} ${ev.mark.ref}`.slice(0, 160),
          documentDate: ev.mark.asOf,
          year: ev.mark.asOf.getUTCFullYear(),
          makerId: req.user!.id,
          approvedAt: new Date(),
          createdBy: req.user!.id,
          versions: { create: { version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: req.user!.id } },
        },
      });
    }
    await tx.pmEvidence.update({ where: { id: ev.id }, data: { documentId: doc.id, reference: doc.ref } });
    await writeAudit(tx, audit(req), { action: 'private.evidence_file_attached', objectType: 'pm_evidence', objectId: ev.id, after: { document: doc.ref, mark: ev.mark.ref, sha256: stored.sha256 } });
    return doc.ref;
  });
  res.status(201).json({ evidence: { id: ev.id, document: ref } });
});
