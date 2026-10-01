import type { Prisma } from '@prisma/client';
import { nextRef } from '../../lib/refs';
import { storeFile } from '../../lib/storage';

export interface ClientPdfDocument {
  name: string;
  /** LP category code, e.g. CALL_NOTICE | DISTRIBUTIONS. */
  category: string;
  type: 'capital' | 'statement';
  clientId: string;
  fundId: string;
  sourceType: string;
  sourceRefId: string;
  relatedType: string;
  relatedId: string;
  relatedLabel: string;
  pdf: Buffer;
  fileName: string;
  actorId: string;
  checkerId: string | null;
  documentDate: Date;
}

/**
 * Stores a generated PDF as an approved, published client document (version 1 + publication),
 * so it shows in the LP document centre as well as on the call or distribution.
 */
export async function publishClientPdf(tx: Prisma.TransactionClient, d: ClientPdfDocument) {
  const file = await storeFile({ name: d.fileName, mime: 'application/pdf', data: d.pdf, uploadedById: d.actorId }, tx);
  const ref = await nextRef(tx, 'document');
  const now = new Date();
  const doc = await tx.document.create({
    data: {
      ref,
      name: d.name,
      type: d.type,
      label: d.category === 'CALL_NOTICE' ? 'Capital call notice' : 'Distribution notice',
      classification: 'Client',
      status: 'Published',
      relatedType: d.relatedType,
      relatedId: d.relatedId,
      relatedLabel: d.relatedLabel,
      clientId: d.clientId,
      year: d.documentDate.getUTCFullYear(),
      documentDate: d.documentDate,
      category: d.category,
      fundId: d.fundId,
      sourceType: d.sourceType,
      sourceRefId: d.sourceRefId,
      makerId: d.actorId,
      checkerId: d.checkerId,
      approvedAt: now,
      createdBy: d.actorId,
    },
  });
  await tx.documentVersion.create({ data: { documentId: doc.id, version: 1, fileId: file.id, sha256: file.sha256, uploadedById: d.actorId } });
  await tx.publication.create({ data: { documentId: doc.id, clientId: d.clientId, publishedById: d.actorId } });
  return { document: doc, file };
}
