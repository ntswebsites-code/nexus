import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import type { SealField, SealSigner } from './types';

/**
 * Stamping of positioned fields onto the original pages. Coordinates are fractions of the page with the
 * origin at the top-left; pdf-lib's origin is bottom-left, so y is flipped here. Rotated pages are stamped
 * in unrotated page space (the box still lands where the editor showed it for upright pages).
 */

const clean = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const INK = rgb(0.05, 0.1, 0.45);
const MUTED = rgb(0.4, 0.43, 0.48);

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-zÀ-ɏ' -]/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function fitSize(font: PDFFont, text: string, maxW: number, maxH: number, start: number): number {
  let size = Math.min(start, maxH);
  while (size > 5 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.5;
  return size;
}

export interface StampFonts {
  regular: PDFFont;
  bold: PDFFont;
  script: PDFFont;
}

export async function stampFonts(doc: PDFDocument): Promise<StampFonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    script: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
}

/** Draws every signed field at its position. Fields whose page is out of range are skipped (validated earlier). */
export async function stampSignedFields(doc: PDFDocument, fonts: StampFonts, fields: SealField[], signers: SealSigner[]): Promise<number> {
  const pages = doc.getPages();
  const byId = new Map(signers.map((s) => [s.signerId, s]));
  let stamped = 0;
  for (const f of fields) {
    const s = byId.get(f.signerId);
    const page = pages[f.page - 1];
    if (!s || !page) continue;
    const { width: pw, height: ph } = page.getSize();
    const w = f.width * pw;
    const h = f.height * ph;
    const x = f.x * pw;
    const y = ph - (f.y + f.height) * ph;
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.97, 0.98, 1), borderColor: rgb(0.75, 0.8, 0.92), borderWidth: 0.5, opacity: 0.85 });
    if (f.kind === 'SIGNATURE') {
      let drawn = false;
      if (s.signatureMode === 'DRAWN' && s.signaturePng) {
        try {
          const img = await doc.embedPng(s.signaturePng);
          const scale = Math.min((w - 6) / img.width, (h - 9) / img.height);
          page.drawImage(img, { x: x + 3, y: y + 8, width: img.width * scale, height: img.height * scale });
          drawn = true;
        } catch {
          drawn = false;
        }
      }
      if (!drawn) {
        const t = clean(s.signatureText || s.name).slice(0, 40);
        const size = fitSize(fonts.script, t, w - 8, h - 10, 22);
        page.drawText(t, { x: x + 4, y: y + 9 + Math.max(0, (h - 10 - size) / 2), size, font: fonts.script, color: INK });
      }
      page.drawText(clean(`Signed by ${s.name} ${s.signedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`), { x: x + 3, y: y + 2, size: 4.5, font: fonts.regular, color: MUTED, maxWidth: w - 6 });
    } else {
      const text = f.kind === 'INITIALS' ? initials(s.name) : f.kind === 'DATE' ? s.signedAt.toISOString().slice(0, 10) : s.name;
      const font = f.kind === 'INITIALS' ? fonts.script : fonts.regular;
      const t = clean(text);
      const size = fitSize(font, t, w - 6, h - 3, f.kind === 'INITIALS' ? 16 : 10);
      page.drawText(t, { x: x + 3, y: y + (h - size) / 2 + size * 0.15, size, font, color: f.kind === 'INITIALS' ? INK : rgb(0.1, 0.12, 0.16) });
    }
    stamped += 1;
  }
  return stamped;
}

export interface PlaceholderField extends SealField {
  label: string;
}

/** Draws labelled dashed boxes (no signatures) so staff can see where each field will land on the real PDF. */
export async function stampPlaceholders(doc: PDFDocument, fields: PlaceholderField[]): Promise<void> {
  const fonts = await stampFonts(doc);
  const pages = doc.getPages();
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const w = f.width * pw;
    const h = f.height * ph;
    const x = f.x * pw;
    const y = ph - (f.y + f.height) * ph;
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 0.95, 0.7), opacity: 0.45, borderColor: rgb(0.8, 0.5, 0), borderWidth: 0.8, borderDashArray: [3, 2] });
    const t = clean(`${f.kind === 'SIGNATURE' ? 'Sign' : f.kind.charAt(0) + f.kind.slice(1).toLowerCase()}: ${f.label}`);
    const size = fitSize(fonts.bold, t, w - 4, h - 2, 8);
    page.drawText(t, { x: x + 2, y: y + (h - size) / 2 + size * 0.15, size, font: fonts.bold, color: rgb(0.5, 0.3, 0) });
  }
}
