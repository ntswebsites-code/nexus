import { PDFDocument } from 'pdf-lib';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { readFileObject } from '../../lib/storage';
import { stampPlaceholders, type PlaceholderField } from '../../integrations/esign';
import { isPdf } from './esign.logic';
import { validateLayout, type FieldKind } from './esign.fields';
import { pageSizes } from './esign.service';

/**
 * PDF source helpers for the field editor: page sizes, a single page rendered as its own one-page PDF (a
 * backdrop for the editor) and a placement preview with labelled boxes stamped on the real pages.
 * No raster library is needed: the browser's own PDF viewer draws the single-page backdrop.
 */

export interface PdfSource {
  documentId?: string;
  fileId?: string;
  requestId?: string;
}

/** Resolves the source to a stored file id the staff user is allowed to read. */
export async function resolveSourceFile(userId: string | null, src: PdfSource): Promise<string> {
  if (src.requestId) {
    const r = await prisma.esignRequest.findFirst({ where: { OR: [{ id: src.requestId }, { ref: src.requestId }] }, select: { fileId: true } });
    if (!r) throw HttpError.notFound('Signature request not found');
    return r.fileId;
  }
  if (src.documentId) {
    const doc = await prisma.document.findFirst({ where: { OR: [{ id: src.documentId }, { ref: src.documentId }] }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!doc?.versions[0]) throw HttpError.badRequest('Document not found or it has no file yet');
    return doc.versions[0].fileId;
  }
  if (src.fileId) {
    const file = await prisma.fileObject.findUnique({ where: { id: src.fileId }, select: { id: true, uploadedById: true } });
    if (!file) throw HttpError.notFound('File not found');
    // Only files the caller uploaded, or files already attached to the document store / a signature request.
    if (file.uploadedById !== userId) {
      const attached = (await prisma.documentVersion.count({ where: { fileId: file.id } })) + (await prisma.esignRequest.count({ where: { fileId: file.id } }));
      if (!attached) throw HttpError.forbidden('You cannot read this file');
    }
    return file.id;
  }
  throw HttpError.badRequest('Provide documentId, fileId or requestId');
}

async function loadPdf(fileId: string): Promise<Buffer> {
  const { file, data } = await readFileObject(fileId);
  if (file.mime !== 'application/pdf' && !isPdf(data)) throw HttpError.badRequest('Only PDF documents can be signed');
  return data;
}

export async function sourcePages(userId: string | null, src: PdfSource) {
  const data = await loadPdf(await resolveSourceFile(userId, src));
  try {
    return await pageSizes(data);
  } catch {
    throw HttpError.badRequest('This PDF is encrypted or damaged and cannot be signed');
  }
}

/** One page as a stand-alone PDF. */
export async function sourcePagePdf(userId: string | null, src: PdfSource, page: number): Promise<Buffer> {
  const data = await loadPdf(await resolveSourceFile(userId, src));
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  if (!Number.isInteger(page) || page < 1 || page > doc.getPageCount()) throw HttpError.notFound('Page not found');
  const out = await PDFDocument.create();
  const [copy] = await out.copyPages(doc, [page - 1]);
  out.addPage(copy!);
  return Buffer.from(await out.save());
}

export interface PreviewField {
  signerKey: string;
  label: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The real PDF with labelled placeholder boxes where each field will be stamped. Nothing is stored. */
export async function previewPlacement(userId: string | null, src: PdfSource, fields: PreviewField[]): Promise<Buffer> {
  const data = await loadPdf(await resolveSourceFile(userId, src));
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  let rows: PreviewField[];
  try {
    rows = validateLayout(fields, doc.getPageCount(), [...new Set(fields.map((f) => f.signerKey))]);
  } catch (e) {
    throw HttpError.badRequest((e as Error).message);
  }
  const placeholders: PlaceholderField[] = rows.map((f) => ({ signerId: f.signerKey, kind: f.kind, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, label: f.label }));
  await stampPlaceholders(doc, placeholders);
  return Buffer.from(await doc.save());
}
