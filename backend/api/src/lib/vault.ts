import { enforcedRetention } from './retention-schedule';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { actorName } from './http';
import { writeAudit } from './audit';
import { nextRef } from './refs';
import { storeFile } from './storage';
import { ctx } from './http';

/**
 * Stores an uploaded file in the document vault as a version-1 Document linked to a business record
 * (portfolio evidence, issuer filings). Runs inside the caller's transaction so the record and the vault entry
 * commit or roll back together. The document stays a Draft with Internal classification: it is never visible to
 * investors until someone takes it through the normal documents review and publish flow.
 */
export interface VaultInput {
  file: { originalname: string; mimetype: string; buffer: Buffer };
  name: string;
  /** Document type (vault folder), e.g. research, compliance. */
  type: string;
  label?: string | null;
  relatedType: string;
  relatedId: string;
  relatedLabel: string;
  sourceType: string;
  documentDate?: Date | null;
  retentionYears?: number;
  classification?: 'Internal' | 'Restricted';
}

export async function vaultDocument(tx: Prisma.TransactionClient, req: Request, o: VaultInput) {
  const stored = await storeFile({ name: o.file.originalname, mime: o.file.mimetype, data: o.file.buffer, uploadedById: req.user!.id }, tx);
  const ref = await nextRef(tx, 'document');
  const doc = await tx.document.create({
    data: {
      ref,
      name: o.name.slice(0, 255),
      type: o.type,
      label: o.label ?? null,
      classification: o.classification ?? 'Internal',
      status: 'Draft',
      ownerName: actorName(req),
      relatedType: o.relatedType,
      relatedId: o.relatedId,
      relatedLabel: o.relatedLabel.slice(0, 160),
      documentDate: o.documentDate ?? null,
      year: (o.documentDate ?? new Date()).getUTCFullYear(),
      retentionYears: await enforcedRetention(o.type, o.classification ?? 'Internal', o.retentionYears ?? 7, tx),
      sourceType: o.sourceType.slice(0, 32),
      sourceRefId: o.relatedId,
      makerId: req.user!.id,
      createdBy: req.user!.id,
      versions: { create: { version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: req.user!.id } },
    },
  });
  await writeAudit(tx, ctx(req, 'admin'), { action: 'document.created', objectType: 'document', objectId: doc.id, after: { ref, name: doc.name, type: o.type, related: `${o.relatedType}:${o.relatedId}`, sha256: stored.sha256, source: o.sourceType } });
  return { document: doc, file: stored };
}
