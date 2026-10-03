import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { LpDocument, LpDocumentsSummary, LpVaultDocument, LpVaultVerifyResult } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { enqueue } from '../../../lib/outbox';
import { sha256Hex } from '../../../lib/crypto';
import { readFileObject, signedDownloadUrl } from '../../../lib/storage';
import { LpError, day } from '../lp.http';
import type { LpContext } from '../lp.context';
import { fundNames, fundScopeWhere, lpAudit, str } from './common';

/** Nexus document `type` -> LP category code when `category` is not set (SRD 5B documents). */
const CATEGORY_BY_TYPE: Record<string, string> = {
  report: 'PERFORMANCE_REPORT',
  statement: 'QUARTERLY_STATEMENT',
  capital: 'CALL_NOTICE',
  legal: 'LEGAL',
  tax: 'TAX',
  company: 'GOVERNANCE',
};

const SOURCE_BY_CATEGORY: Record<string, string> = {
  CALL_NOTICE: 'CAPITAL_CALL',
  QUARTERLY_STATEMENT: 'STATEMENT',
  PERFORMANCE_REPORT: 'REPORT',
};

export const lpDocInclude = (ctx: LpContext) =>
  ({
    versions: { orderBy: { version: 'desc' }, take: 1 },
    publications: { where: { clientId: ctx.client.id, withdrawnAt: null } },
    signatureRequests: { where: { clientId: ctx.client.id, status: 'Pending' } },
  }) satisfies Prisma.DocumentInclude;

type DocRow = Prisma.DocumentGetPayload<{ include: ReturnType<typeof lpDocInclude> }>;

/** Published to this client, and either fund-less or in the member's fund scope. */
export function lpDocWhere(ctx: LpContext, fundId?: string): Prisma.DocumentWhereInput {
  return {
    status: 'Published',
    publications: { some: { clientId: ctx.client.id, withdrawnAt: null } },
    ...fundScopeWhere(ctx, fundId),
  };
}

export function docCategory(d: { category: string | null; type: string; name?: string; relatedType?: string | null }): string {
  if (d.category) return d.category;
  // Distribution notices are filed under the generic 'capital' type; they are not call notices.
  if (d.type === 'capital' && (/^distribution\b/i.test(d.name ?? '') || /^DISTRIBUTION/i.test(d.relatedType ?? ''))) return 'DISTRIBUTIONS';
  return CATEGORY_BY_TYPE[d.type] ?? 'MANUAL';
}

/** Fund-less documents carry a free-text label; hide those that name a fund outside the caller's scope. */
async function dropOutOfScopeLabelled<T extends { fundId: string | null; relatedLabel: string | null }>(ctx: LpContext, docs: T[]): Promise<T[]> {
  if (!docs.some((d) => !d.fundId && d.relatedLabel)) return docs;
  const outside = await prisma.fund.findMany({ where: { id: { notIn: ctx.fundIds } }, select: { name: true } });
  const names = new Set(outside.map((f) => f.name.toLowerCase()));
  return docs.filter((d) => d.fundId || !d.relatedLabel || !names.has(d.relatedLabel.toLowerCase()));
}

function publishedAt(d: DocRow): Date {
  return d.publications[0]?.publishedAt ?? d.approvedAt ?? d.createdAt;
}

async function filesFor(docs: DocRow[]) {
  const ids = docs.flatMap((d) => d.versions.map((v) => v.fileId));
  const files = ids.length ? await prisma.fileObject.findMany({ where: { id: { in: ids } }, select: { id: true, size: true, mime: true } }) : [];
  return new Map(files.map((f) => [f.id, f]));
}

function docView(d: DocRow, names: Map<string, string>, files: Map<string, { size: number; mime: string }>): LpDocument {
  const v = d.versions[0];
  const file = v ? files.get(v.fileId) : undefined;
  const needsSignature = d.signatureRequests.length > 0;
  return {
    id: d.id,
    name: d.name,
    fundId: d.fundId ?? '',
    fundName: d.fundId ? (names.get(d.fundId) ?? '') : (d.relatedLabel ?? 'All funds'),
    category: docCategory(d),
    period: d.period ?? (d.year ? String(d.year) : null),
    publishedDate: day(publishedAt(d)),
    version: `${v?.version ?? d.version}.0`,
    status: needsSignature ? 'REQUIRES_SIGNATURE' : 'PUBLISHED',
    accessScope: d.fundId ? 'INVESTOR_ACCOUNT' : 'INVESTOR_ORGANISATION',
    checksumSha256: v?.sha256 ?? '',
    permissions: ['VIEW', 'DOWNLOAD', ...(needsSignature ? ['SIGN'] : [])],
    ...(d.sourceType ? { sourceType: d.sourceType } : {}),
    ...(d.sourceRefId ? { sourceRefId: d.sourceRefId } : {}),
    ...(file ? { fileSizeBytes: file.size, mimeType: file.mime } : {}),
    // Page count is not stored (schema freeze). Null keeps the contract key without inventing a count.
    pageCount: null,
    history: [] as Array<{ user: string; action: string; at: string; ip: string }>,
  };
}

export async function listDocuments(ctx: LpContext, q: { fundId?: string; category?: string; q?: string }) {
  const search = q.q?.trim();
  const rows = await prisma.document.findMany({
    where: {
      AND: [
        lpDocWhere(ctx, q.fundId),
        ...(search ? [{ name: { contains: search } }] : []),
      ],
    },
    include: lpDocInclude(ctx),
  });
  let docs = await dropOutOfScopeLabelled(ctx, rows);
  if (q.category) {
    const cat = q.category.toUpperCase();
    docs = docs.filter((d) => docCategory(d) === cat);
  }
  docs.sort((a, b) => publishedAt(b).getTime() - publishedAt(a).getTime());
  const [names, files] = await Promise.all([fundNames(docs.map((d) => d.fundId)), filesFor(docs)]);
  return docs.map((d) => docView(d, names, files));
}

export async function documentsSummary(ctx: LpContext): Promise<LpDocumentsSummary> {
  const rows = await dropOutOfScopeLabelled(ctx, await prisma.document.findMany({ where: lpDocWhere(ctx), include: lpDocInclude(ctx) }));
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const byCategory = new Map<string, number>();
  for (const d of rows) byCategory.set(docCategory(d), (byCategory.get(docCategory(d)) ?? 0) + 1);
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const secureDownloadsYtd = await prisma.documentAccessLog.count({ where: { clientId: ctx.client.id, action: 'DOWNLOAD', at: { gte: yearStart } } });
  return {
    total: rows.length,
    byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    newThisWeek: rows.filter((d) => publishedAt(d).getTime() >= weekAgo).length,
    requiresSignature: rows.filter((d) => d.signatureRequests.length > 0).length,
    secureDownloadsYtd,
  };
}

/** The document by id (or DOC- ref) when visible to the caller, else 404 (IDOR guard). */
export async function findDocument(ctx: LpContext, idOrRef: string) {
  const d = await prisma.document.findFirst({
    where: { AND: [lpDocWhere(ctx), { OR: [{ id: idOrRef }, { ref: idOrRef }] }] },
    include: lpDocInclude(ctx),
  });
  if (!d) throw LpError.notFound('Document');
  return d;
}

async function logAccess(req: Request, ctx: LpContext, documentId: string, action: 'VIEW' | 'PREVIEW' | 'DOWNLOAD') {
  await prisma.documentAccessLog.create({
    data: { documentId, userId: ctx.userId, clientId: ctx.client.id, action, ip: req.ip?.slice(0, 45) ?? null, userAgent: req.get('user-agent')?.slice(0, 255) ?? null },
  });
  // Detail and preview record the same read together. skipDuplicates absorbs that race
  // without a duplicate-key error on the composite primary key.
  await prisma.documentRead.createMany({ data: [{ documentId, userId: ctx.userId }], skipDuplicates: true });
}

export async function documentDetail(req: Request, ctx: LpContext, id: string): Promise<LpDocument> {
  const d = await findDocument(ctx, id);
  await logAccess(req, ctx, d.id, 'VIEW');
  const [names, files, logs] = await Promise.all([
    fundNames([d.fundId]),
    filesFor([d]),
    prisma.documentAccessLog.findMany({ where: { documentId: d.id, clientId: ctx.client.id }, orderBy: { at: 'desc' }, take: 20 }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))] } },
    select: { id: true, name: true, email: true },
  });
  const who = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return {
    ...docView(d, names, files),
    history: logs.map((l) => ({ user: (l.userId && who.get(l.userId)) || 'Unknown', action: l.action, at: l.at.toISOString(), ip: l.ip ?? '' })),
  };
}

function safeFileName(name: string, mime: string) {
  const base = name.replace(/[^\w.\- ]+/g, '_').trim() || 'document';
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  const ext = mime === 'application/pdf' ? '.pdf' : mime.includes('sheet') ? '.xlsx' : mime.includes('word') ? '.docx' : mime.startsWith('image/') ? `.${mime.slice(6)}` : '.bin';
  return `${base}${ext}`;
}

/** Streams the latest version (entitlement already checked). `?format=url` answers a short-lived signed URL instead. */
export async function sendDocument(req: Request, res: Response, ctx: LpContext, id: string, mode: 'download' | 'preview', asUrl: (data: unknown) => void) {
  const d = await findDocument(ctx, id);
  const v = d.versions[0];
  if (!v) throw new LpError(404, 'LP_NOT_FOUND', 'File not available');
  const { file, data } = await readFileObject(v.fileId);
  if (mode === 'preview' && !(file.mime === 'application/pdf' || file.mime.startsWith('image/'))) {
    throw new LpError(415, 'LP_UNSUPPORTED_MEDIA', 'Preview is only available for PDF and image documents');
  }
  await logAccess(req, ctx, d.id, mode === 'download' ? 'DOWNLOAD' : 'PREVIEW');
  if (mode === 'download') {
    await prisma.$transaction((tx) =>
      writeAudit(tx, lpAudit(req), { action: 'document.downloaded', objectType: 'document', objectId: d.id, after: { version: v.version, sha256: v.sha256, via: 'lp-portal' } }),
    );
  }
  if (str(req.query.format) === 'url') {
    asUrl({ url: signedDownloadUrl(v.fileId), expiresIn: 300, name: d.name });
    return;
  }
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `${mode === 'download' ? 'attachment' : 'inline'}; filename="${safeFileName(d.name, file.mime)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-SHA256', v.sha256);
  res.status(200).send(data);
}

export async function listVault(ctx: LpContext, q: { fundId?: string; category?: string; search?: string }): Promise<LpVaultDocument[]> {
  const docs = await listDocuments(ctx, { fundId: q.fundId, category: q.category, q: q.search });
  return docs.map((d) => ({
    documentId: d.id,
    category: d.category,
    title: d.name,
    fundId: d.fundId,
    fundName: d.fundName,
    publishedAt: `${d.publishedDate}T00:00:00.000Z`,
    sourceType: d.sourceType ?? SOURCE_BY_CATEGORY[d.category] ?? d.category,
    sha256: d.checksumSha256,
  }));
}

/** Re-hashes the stored bytes against the hash recorded at upload. */
export async function verifyVault(ctx: LpContext, id: string): Promise<LpVaultVerifyResult & { reason?: string }> {
  const d = await findDocument(ctx, id);
  const v = d.versions[0];
  if (!v) return { documentId: d.id, verified: false, expectedSha256: '', actualSha256: '', reason: 'No file on record' };
  const { data } = await readFileObject(v.fileId);
  const actual = sha256Hex(data);
  return { documentId: d.id, verified: actual === v.sha256, expectedSha256: v.sha256, actualSha256: actual };
}

export const CONSENT_TEXT_VERSION = 'lp-esign-v1';
export const CONSENT_TEXT =
  'I confirm that I am authorised to sign on behalf of the investor named above, that I have read the document, and that my typed name below is my electronic signature.';

/**
 * E-signature (DEV-PLAN D6): typed name + authority + consent + step-up + document hash,
 * on the existing SignatureRequest/Signature tables so the staff document queue sees it.
 */
export async function signDocument(req: Request, ctx: LpContext, id: string, b: { name: string; authority: string; consentTextVersion?: string }) {
  const d = await findDocument(ctx, id);
  const request = d.signatureRequests[0];
  if (!request) throw new LpError(409, 'LP_VALIDATION', 'This document does not require a signature');
  const v = d.versions[0];
  if (!v) throw new LpError(409, 'LP_VALIDATION', 'The published file is missing - contact Client Services');
  const consentAt = new Date();
  const consentTextVersion = b.consentTextVersion ?? CONSENT_TEXT_VERSION;
  const consentHash = sha256Hex(JSON.stringify({ consentTextVersion, text: CONSENT_TEXT, docSha256: v.sha256, signer: ctx.userId, name: b.name, authority: b.authority }));
  const sig = await prisma.$transaction(async (tx) => {
    const s = await tx.signature.create({
      data: {
        requestId: request.id,
        signerUserId: ctx.userId,
        signerName: b.name,
        authority: b.authority,
        consentAt,
        mfaAt: req.authSession?.mfaVerifiedAt ?? null,
        docSha256: v.sha256,
        ip: req.ip?.slice(0, 45) ?? null,
        consentTextVersion,
        consentHash,
        userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
        sessionId: req.authSession?.id ?? null,
      },
    });
    await tx.signatureRequest.update({ where: { id: request.id }, data: { status: 'Signed' } });
    await writeAudit(tx, lpAudit(req), {
      action: 'document.signed',
      objectType: 'document',
      objectId: d.id,
      after: { signatureId: s.id, signer: b.name, authority: b.authority, sha256: v.sha256, version: v.version, mfaAt: s.mfaAt, consentTextVersion, consentHash, via: 'lp-portal' },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'clients.edit',
      type: 'document.signed',
      title: `Signed · ${d.name}`,
      body: `${b.name} (${b.authority}) signed for ${ctx.client.name}.`,
    });
    return s;
  });
  return { signatureId: sig.id, documentId: d.id, signedAt: sig.signedAt.toISOString(), docSha256: v.sha256, consentTextVersion, status: 'SIGNED' };
}
