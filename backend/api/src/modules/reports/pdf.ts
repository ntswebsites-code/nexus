import { esc } from '../ops/pdf';
import type { ReportData } from './reports.engine';

/**
 * Multi-page PDF for a report (A4 landscape, Helvetica, no dependency). Reuses the escaping primitives of the notice
 * PDF in `ops/pdf.ts`. Every section is a table with a repeating header row; wide cells are truncated with `..` and
 * the page footer carries the page number and generation time. The same `ReportData` feeds CSV, JSON and HTML, so the
 * figures are identical across formats.
 */

const W = 842;
const H = 595;
const M = 36;
const LINE = 11;
const NUMERIC = /^-?\d[\d,]*(\.\d+)?%?$/;

/** Approximate Helvetica advance width in points (average glyph ~0.5em; digits 0.556em). */
const textWidth = (s: string, size: number) => s.length * size * 0.52;
const clip = (s: string, maxChars: number) => (s.length <= maxChars ? s : `${s.slice(0, Math.max(1, maxChars - 2))}..`);

class Doc {
  pages: string[][] = [];
  private cur: string[] = [];
  y = H - M;
  constructor(private title: string, private stamp: string) {
    this.newPage(true);
  }
  private font(bold: boolean, size: number) {
    return `/${bold ? 'F2' : 'F1'} ${size} Tf`;
  }
  text(x: number, y: number, s: string, size = 8, bold = false) {
    this.cur.push('BT', this.font(bold, size), `1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm`, `(${esc(s)}) Tj`, 'ET');
  }
  rule(y: number, x1 = M, x2 = W - M, grey = 0.8) {
    this.cur.push(`${grey} G`, `${x1} ${y.toFixed(1)} m ${x2} ${y.toFixed(1)} l S`);
  }
  fill(x: number, y: number, w: number, h: number, grey: number) {
    this.cur.push(`${grey} g`, `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`, '0 g');
  }
  newPage(first = false) {
    if (!first) this.pages.push(this.cur);
    this.cur = [];
    this.y = H - M;
    this.text(M, H - 22, this.title, 8, true);
    this.rule(H - 27);
    this.y = H - M - 12;
  }
  need(h: number) {
    if (this.y - h < M + 14) this.newPage();
  }
  finish(): string[][] {
    this.pages.push(this.cur);
    const total = this.pages.length;
    return this.pages.map((p, i) => [...p, `BT /F1 7 Tf 1 0 0 1 ${M} 18 Tm (${esc(`Page ${i + 1} of ${total}  |  ${this.stamp}`)}) Tj ET`]);
  }
}

function layout(columns: string[], rows: (string | number | null)[][], width: number, size: number) {
  const sample = rows.slice(0, 200);
  const want = columns.map((c, i) => Math.min(38, Math.max(c.length, ...sample.map((r) => String(r[i] ?? '').length), 3)));
  const sum = want.reduce((a, b) => a + b, 0);
  const pts = want.map((w) => (w / sum) * width);
  return pts.map((p, i) => ({ w: p, chars: Math.max(3, Math.floor(p / (size * 0.52)) - 1), numeric: sample.length > 0 && sample.every((r) => r[i] === null || r[i] === undefined || r[i] === '' || typeof r[i] === 'number' || NUMERIC.test(String(r[i]))) && i >= 0 }));
}

export function renderReportPdf(d: ReportData, generatedAt: Date): Buffer {
  const stamp = `Generated ${generatedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC from live data`;
  const doc = new Doc(d.title, stamp);
  const width = W - 2 * M;

  doc.text(M, doc.y, d.title, 16, true);
  doc.y -= 20;
  for (const [k, v] of d.meta) {
    doc.need(LINE);
    doc.text(M, doc.y, k, 8, true);
    doc.text(M + 130, doc.y, clip(v, 120), 8);
    doc.y -= LINE;
  }
  doc.y -= 6;

  for (const s of d.sections) {
    doc.need(40);
    doc.text(M, doc.y, s.heading, 11, true);
    doc.y -= 6;
    doc.rule(doc.y, M, W - M, 0.6);
    doc.y -= 12;
    if (!s.rows.length) {
      doc.text(M, doc.y, 'No rows.', 8);
      doc.y -= 16;
      continue;
    }
    const size = s.columns.length > 9 ? 6.5 : 7.5;
    const cols = layout(s.columns, s.rows, width, size);
    const header = () => {
      doc.need(LINE * 2);
      doc.fill(M, doc.y - 3, width, LINE + 1, 0.93);
      let x = M;
      s.columns.forEach((c, i) => {
        const t = clip(c, cols[i]!.chars);
        doc.text(cols[i]!.numeric ? x + cols[i]!.w - 3 - textWidth(t, size) : x + 2, doc.y, t, size, true);
        x += cols[i]!.w;
      });
      doc.y -= LINE + 2;
    };
    header();
    for (const r of s.rows) {
      if (doc.y - LINE < M + 14) {
        doc.newPage();
        header();
      }
      let x = M;
      r.forEach((c, i) => {
        const t = clip(String(c ?? ''), cols[i]!.chars);
        doc.text(cols[i]!.numeric ? x + cols[i]!.w - 3 - textWidth(t, size) : x + 2, doc.y, t, size);
        x += cols[i]!.w;
      });
      doc.y -= LINE;
    }
    doc.y -= 10;
  }
  for (const n of d.notes ?? []) {
    doc.need(LINE * 2);
    doc.text(M, doc.y, clip(`Note: ${n}`, 190), 7.5);
    doc.y -= LINE;
  }

  const pages = doc.finish();
  // Object layout: 1 catalog, 2 pages, 3 F1, 4 F2, then (page, content) pairs.
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const kids: number[] = [];
  for (const p of pages) {
    const stream = p.join('\n');
    const pageNo = objects.length + 1;
    const contentNo = pageNo + 1;
    kids.push(pageNo);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
