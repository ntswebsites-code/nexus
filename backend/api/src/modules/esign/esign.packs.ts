import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { FieldKind } from './esign.fields';

/**
 * Builds multi-part PDFs (cover + sections, each ending in signature boxes) and reports where every
 * signature box landed, as page fractions ready to store as `esign_fields`. Pure: no database, no config.
 */

const W = 595.28;
const H = 841.89;
const M = 56;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.43, 0.48);
const RULE = rgb(0.7, 0.73, 0.78);

const clean = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

export interface PackSection {
  title: string;
  rows?: [string, string][];
  paragraphs: string[];
  /** Roles that sign this section (keys of `roles`). Defaults to every role. */
  signedBy?: string[];
}

export interface PackRole {
  key: string;
  /** Printed above the box, e.g. "Authorised signatory - Jane Doe". */
  label: string;
}

export interface PackSlot {
  sectionIndex: number;
  roleKey: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackInput {
  heading: string;
  subtitle?: string;
  /** Key-value block on the cover page. */
  cover?: [string, string][];
  sections: PackSection[];
  roles: PackRole[];
  /** Show a cover page listing the parts (default true when there is more than one section). */
  cover_page?: boolean;
}

const BOX_W = 220;
const BOX_H = 36;
const DATE_W = 96;
const DATE_H = 18;
const ROLE_BLOCK = 64;

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of clean(text).split(' ')) {
    const probe = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(probe, size) > width && line) {
      out.push(line);
      line = word;
    } else line = probe;
  }
  if (line) out.push(line);
  return out;
}

export async function buildPack(input: PackInput): Promise<{ pdf: Buffer; slots: PackSlot[]; pageCount: number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const slots: PackSlot[] = [];
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 64;
  const header = (text: string) => page.drawText(clean(text), { x: M, y: H - 34, size: 8, font, color: MUTED });
  const fresh = (label: string) => {
    page = doc.addPage([W, H]);
    y = H - 64;
    header(label);
  };
  const ensure = (h: number, label: string) => {
    if (y - h < 60) fresh(label);
  };
  const text = (t: string, o: { f?: PDFFont; size?: number; x?: number; color?: ReturnType<typeof rgb>; label: string }) => {
    const f = o.f ?? font;
    const size = o.size ?? 10;
    const x = o.x ?? M;
    for (const l of wrap(f, t, size, W - x - M)) {
      ensure(size + 6, o.label);
      page.drawText(l, { x, y: y - size, size, font: f, color: o.color ?? INK });
      y -= size + 5;
    }
  };

  const showCover = input.cover_page ?? input.sections.length > 1;
  if (showCover) {
    header('Matanho Nexus');
    text('Matanho Nexus', { f: bold, size: 9, color: MUTED, label: input.heading });
    y -= 6;
    text(input.heading, { f: bold, size: 20, label: input.heading });
    if (input.subtitle) text(input.subtitle, { size: 10, color: MUTED, label: input.heading });
    y -= 12;
    for (const [k, v] of input.cover ?? []) {
      page.drawText(clean(k), { x: M, y: y - 9, size: 9, font: bold, color: MUTED });
      const lines = wrap(font, v, 10, W - 190 - M);
      for (const l of lines) {
        page.drawText(l, { x: 190, y: y - 10, size: 10, font, color: INK });
        y -= 15;
      }
      if (!lines.length) y -= 15;
    }
    y -= 14;
    text('Parts of this document', { f: bold, size: 11, label: input.heading });
    y -= 2;
    input.sections.forEach((s, i) => {
      const signers = (s.signedBy ?? input.roles.map((r) => r.key)).length;
      text(`Part ${i + 1}.  ${s.title}   (${signers} signature${signers === 1 ? '' : 's'} required)`, { size: 10, x: M + 8, label: input.heading });
    });
    y -= 10;
    text('Each part ends with the boxes where signatures are placed. Signing electronically has the same effect as a handwritten signature; the signing record, document hash and certificate of completion form part of this document.', { size: 8.5, color: MUTED, label: input.heading });
  }

  for (const [si, s] of input.sections.entries()) {
    const label = `${input.heading}  |  Part ${si + 1}: ${s.title}`;
    if (showCover || si > 0) fresh(label);
    else header(label);
    text(s.title, { f: bold, size: 16, label });
    y -= 8;
    for (const [k, v] of s.rows ?? []) {
      ensure(18, label);
      page.drawText(clean(k), { x: M, y: y - 9, size: 9, font: bold, color: MUTED });
      const lines = wrap(font, v, 10, W - 190 - M);
      for (const l of lines.length ? lines : ['-']) {
        ensure(15, label);
        page.drawText(l, { x: 190, y: y - 10, size: 10, font, color: INK });
        y -= 15;
      }
    }
    y -= 10;
    for (const p of s.paragraphs) {
      text(p, { label });
      y -= 6;
    }
    y -= 8;
    const signing = (s.signedBy ?? input.roles.map((r) => r.key)).map((k) => input.roles.find((r) => r.key === k)).filter((r): r is PackRole => !!r);
    for (const role of signing) {
      ensure(ROLE_BLOCK + 8, label);
      const top = y;
      page.drawText(clean(role.label), { x: M, y: top - 9, size: 8.5, font: bold, color: MUTED });
      const boxTop = top - 14;
      const boxBottom = boxTop - BOX_H;
      page.drawRectangle({ x: M, y: boxBottom, width: BOX_W, height: BOX_H, borderColor: RULE, borderWidth: 0.8 });
      page.drawText('Signature', { x: M + 3, y: boxBottom + 2, size: 5.5, font, color: MUTED });
      const dateTop = boxTop - (BOX_H - DATE_H);
      const dateBottom = dateTop - DATE_H;
      page.drawRectangle({ x: M + BOX_W + 14, y: dateBottom, width: DATE_W, height: DATE_H, borderColor: RULE, borderWidth: 0.8 });
      page.drawText('Date', { x: M + BOX_W + 17, y: dateBottom + 2, size: 5.5, font, color: MUTED });
      const pageIndex = doc.getPageCount();
      slots.push({ sectionIndex: si, roleKey: role.key, kind: 'SIGNATURE', page: pageIndex, x: M / W, y: (H - boxTop) / H, width: BOX_W / W, height: BOX_H / H });
      slots.push({ sectionIndex: si, roleKey: role.key, kind: 'DATE', page: pageIndex, x: (M + BOX_W + 14) / W, y: (H - dateTop) / H, width: DATE_W / W, height: DATE_H / H });
      y = boxBottom - 16;
    }
  }
  const pageCount = doc.getPageCount();
  doc.setTitle(clean(input.heading));
  doc.setProducer('Matanho Nexus eSign (pdf-lib)');
  return { pdf: Buffer.from(await doc.save()), slots, pageCount };
}

/** Appends `sheet` after the pages of `source`; slot pages shift by the source page count. Returns the merged PDF. */
export async function appendSheet(source: Buffer, sheet: { pdf: Buffer; slots: PackSlot[] }): Promise<{ pdf: Buffer; slots: PackSlot[]; pageCount: number }> {
  const base = await PDFDocument.load(source, { updateMetadata: false });
  const offset = base.getPageCount();
  const add = await PDFDocument.load(sheet.pdf);
  const copies = await base.copyPages(add, add.getPageIndices());
  for (const c of copies) base.addPage(c);
  return {
    pdf: Buffer.from(await base.save()),
    slots: sheet.slots.map((s) => ({ ...s, page: s.page + offset })),
    pageCount: base.getPageCount(),
  };
}
