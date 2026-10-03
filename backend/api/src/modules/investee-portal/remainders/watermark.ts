import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { HttpError } from '../../../lib/errors';

const WATERMARKABLE = /^(application\/pdf|text\/.+|image\/(png|jpeg))$/;
const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');

export function isWatermarkable(mime: string) {
  return WATERMARKABLE.test(mime.toLowerCase());
}

/** Draws a diagonal mark across each page and the full text at the foot. */
async function markPdf(doc: PDFDocument, mark: string, short: string) {
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(14, Math.min(40, (width * 0.9) / Math.max(short.length * 0.7, 1)));
    const w = font.widthOfTextAtSize(short, size);
    page.drawText(short, { x: width / 2 - (w / 2) * Math.cos(Math.PI / 4), y: height / 2 - (w / 2) * Math.sin(Math.PI / 4), size, font, rotate: degrees(45), color: rgb(0.55, 0.57, 0.62), opacity: 0.22 });
    let line = mark;
    while (small.widthOfTextAtSize(line, 7) > width - 40 && line.length > 10) line = `${line.slice(0, -4)}...`;
    page.drawText(line, { x: 20, y: 12, size: 7, font: small, color: rgb(0.35, 0.37, 0.42) });
  }
}

/**
 * Returns the file with a visible watermark naming the recipient: PDFs on every page, images placed on a one-page PDF,
 * text with a header and footer. Other formats cannot be marked and are refused (415).
 */
export async function watermarkFile(file: { mime: string; name: string }, data: Buffer, mark: string, short: string): Promise<{ data: Buffer; mime: string; name: string }> {
  const mime = file.mime.toLowerCase();
  const m = clean(mark);
  const s = clean(short).toUpperCase();
  if (mime === 'application/pdf') {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(data, { updateMetadata: false });
    } catch {
      throw new HttpError(415, 'not_watermarkable', 'This PDF is encrypted or damaged and cannot be shared');
    }
    await markPdf(doc, m, s);
    return { data: Buffer.from(await doc.save()), mime, name: file.name };
  }
  if (mime === 'image/png' || mime === 'image/jpeg') {
    const doc = await PDFDocument.create();
    const img = mime === 'image/png' ? await doc.embedPng(data) : await doc.embedJpg(data);
    const scale = Math.min(1, 520 / img.width, 740 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const page = doc.addPage([w + 60, h + 80]);
    page.drawImage(img, { x: 30, y: 40, width: w, height: h });
    await markPdf(doc, m, s);
    return { data: Buffer.from(await doc.save()), mime: 'application/pdf', name: `${file.name.replace(/\.[A-Za-z0-9]+$/, '')}.pdf` };
  }
  if (mime.startsWith('text/')) {
    const rule = '-'.repeat(Math.min(m.length, 80));
    return { data: Buffer.from(`${m}\n${rule}\n${data.toString('utf8')}\n${rule}\n${m}\n`, 'utf8'), mime, name: file.name };
  }
  throw new HttpError(415, 'not_watermarkable', 'Only PDF, image and text files can be shared by link');
}
