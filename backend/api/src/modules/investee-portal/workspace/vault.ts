import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import { signedDownloadUrl, storeFile } from '../../../lib/storage';
import type { InvesteeContext } from '../investee.context';

const PREVIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/(plain|csv))/i;

/** INO-021: the bytes must match the declared type; executables are refused whatever they are called. */
export function assertFileContentMatches(file: { originalname: string; mimetype: string; buffer: Buffer }) {
  const b = file.buffer;
  const starts = (sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
  const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
  const mime = file.mimetype.toLowerCase();
  if (starts([0x4d, 0x5a]) || starts([0x7f, 0x45, 0x4c, 0x46]) || starts([0x23, 0x21]) || starts([0xca, 0xfe, 0xba, 0xbe])) {
    throw HttpError.badRequest('This file looks like a program, not a document, and was not stored', [{ path: 'file', message: 'Executable content is not accepted' }]);
  }
  const bad = (what: string) =>
    HttpError.badRequest(`The file content is not a valid ${what}; it does not match its name or type`, [{ path: 'file', message: `Not a valid ${what}` }]);
  if ((ext === 'pdf' || mime === 'application/pdf') && !b.subarray(0, 1024).includes('%PDF-')) throw bad('PDF');
  if ((ext === 'png' || mime === 'image/png') && !starts([0x89, 0x50, 0x4e, 0x47])) throw bad('PNG image');
  if ((ext === 'jpg' || ext === 'jpeg' || mime === 'image/jpeg') && !starts([0xff, 0xd8, 0xff])) throw bad('JPEG image');
  if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext) && !starts([0x50, 0x4b])) throw bad('Office document');
  if (['csv', 'txt'].includes(ext) && b.subarray(0, 4096).includes(0)) throw bad('text file');
}

export const vaultWithdrawSchema = z.object({ reason: z.string().trim().min(3).max(500) });

async function companyDoc(companyId: string, docId: string, { allowWithdrawn = false } = {}) {
  const d = await prisma.document.findFirst({
    where: {
      id: docId,
      companyId,
      ...(allowWithdrawn ? {} : { status: { notIn: ['Withdrawn', 'Disposed'] } }),
    },
  });
  if (!d) throw HttpError.notFound('Document not found');
  return d;
}

/** Version history for one vault document (INO-021). */
export async function vaultVersions(c: InvesteeContext, docId: string) {
  const d = await companyDoc(c.company.id, docId);
  const versions = await prisma.documentVersion.findMany({ where: { documentId: d.id }, orderBy: { version: 'desc' } });
  const files = await prisma.fileObject.findMany({ where: { id: { in: versions.map((v) => v.fileId) } } });
  const fm = new Map(files.map((f) => [f.id, f]));
  const latest = versions[0]?.version ?? 0;
  return {
    id: d.id,
    ref: d.ref,
    name: d.name,
    version: latest,
    versions: versions.map((v) => ({
      version: v.version,
      fileName: fm.get(v.fileId)?.name ?? d.name,
      size: fm.get(v.fileId)?.size ?? null,
      mime: fm.get(v.fileId)?.mime ?? 'application/octet-stream',
      sha256: v.sha256,
      uploadedById: v.uploadedById,
      uploadedAt: v.createdAt.toISOString(),
    })),
  };
}

/** Signed download or inline preview URL for a vault document version (CMP-038). */
export async function vaultDownloadUrl(
  c: InvesteeContext,
  docId: string,
  opts: { version?: number; inline?: boolean },
  audit: AuditContext,
) {
  const d = await companyDoc(c.company.id, docId);
  const versions = await prisma.documentVersion.findMany({ where: { documentId: d.id }, orderBy: { version: 'desc' } });
  if (opts.version !== undefined) {
    if (!Number.isInteger(opts.version) || opts.version < 1) {
      throw HttpError.badRequest('Validation failed', [{ path: 'version', message: 'Invalid version number' }]);
    }
  }
  const wanted = opts.version ?? versions[0]?.version;
  const v = versions.find((x) => x.version === wanted);
  if (!v) throw HttpError.notFound('No file for that version');
  const file = await prisma.fileObject.findUnique({ where: { id: v.fileId } });
  const inline = !!opts.inline && !!file && PREVIEWABLE.test(file.mime);
  const url = `${signedDownloadUrl(v.fileId, 300)}${inline ? '&inline=1' : ''}`;
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, audit, {
      action: inline ? 'company.vault.previewed' : 'company.vault.downloaded',
      objectType: 'document',
      objectId: d.id,
      after: { version: v.version },
    });
  });
  return { url, expiresIn: 300, name: file?.name ?? d.name, version: v.version, inline };
}

/** Upload a new version of an existing vault document. */
export async function addVaultVersion(
  c: InvesteeContext,
  docId: string,
  file: { originalname: string; mimetype: string; buffer: Buffer },
  audit: AuditContext,
) {
  assertFileContentMatches(file);
  const d = await companyDoc(c.company.id, docId);
  await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: c.userId }, tx);
    const latest = await tx.documentVersion.findFirst({ where: { documentId: d.id }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = (latest?.version ?? 0) + 1;
    await tx.documentVersion.create({
      data: { documentId: d.id, version, fileId: stored.id, sha256: stored.sha256, uploadedById: c.userId },
    });
    await tx.document.update({ where: { id: d.id }, data: { updatedAt: new Date(), updatedBy: c.userId } });
    await writeAudit(tx, audit, { action: 'company.vault.version_added', objectType: 'document', objectId: d.id, after: { version } });
  });
  return vaultVersions(c, docId);
}

/** Withdraw a document from the company workspace without erasing it (D-15). */
export async function withdrawVaultDocument(c: InvesteeContext, docId: string, reason: string, audit: AuditContext) {
  const d = await companyDoc(c.company.id, docId, { allowWithdrawn: true });
  if (d.status === 'Withdrawn') throw HttpError.notFound('Document not found');
  const held = await prisma.documentHold.findFirst({ where: { documentId: d.id, releasedAt: null }, select: { id: true } });
  if (held) throw HttpError.conflict('This document is on legal hold and cannot be withdrawn', 'legal_hold');
  const packed = await prisma.investeeBoardPackItem.findFirst({
    where: { documentId: d.id, meeting: { companyId: c.company.id, packStatus: 'PUBLISHED' } },
    select: { id: true },
  });
  if (packed) throw HttpError.conflict('This document is in a published board pack and cannot be withdrawn', 'in_published_pack');
  await prisma.$transaction(async (tx) => {
    const claim = await tx.document.updateMany({
      where: { id: d.id, status: { notIn: ['Withdrawn', 'Disposed'] } },
      data: { status: 'Withdrawn', updatedBy: c.userId },
    });
    if (claim.count !== 1) throw HttpError.notFound('Document not found');
    await writeAudit(tx, audit, { action: 'company.vault.withdrawn', objectType: 'document', objectId: d.id, after: { reason } });
  });
  return { id: d.id, status: 'Withdrawn' };
}
