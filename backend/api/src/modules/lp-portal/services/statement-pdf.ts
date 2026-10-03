/**
 * Styled investor statement PDF (GAP-017): header band, KPI tiles, summary table and a per-fund table
 * with shaded rows, multi-page with footers. No dependency; raw PDF drawing operators with the two
 * standard Helvetica faces. Figures come from the stored job, so a later download matches the result.
 */
const W = 595;
const H = 842;
const M = 42;
const NAVY: [number, number, number] = [0.059, 0.165, 0.29];
const INK: [number, number, number] = [0.063, 0.129, 0.227];
const MUTED: [number, number, number] = [0.365, 0.408, 0.467];
const BAND: [number, number, number] = [0.953, 0.965, 0.98];
const RULE: [number, number, number] = [0.835, 0.863, 0.906];

function ascii(text: string): string {
  return text
    .replace(/[•·]/g, '*')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e]/g, '?');
}
const esc = (t: string) => ascii(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const col = (c: [number, number, number]) => `${c[0]} ${c[1]} ${c[2]}`;
/** Helvetica averages about half an em per glyph; good enough for right alignment and truncation. */
const textWidth = (t: string, size: number, bold = false) => ascii(t).length * size * (bold ? 0.56 : 0.52);
const fit = (t: string, width: number, size: number, bold = false) => {
  let s = ascii(t);
  while (s.length > 1 && textWidth(s, size, bold) > width) s = s.slice(0, -2) + '.';
  return s;
};

class Page {
  ops: string[] = [];
  rect(x: number, y: number, w: number, h: number, fill: [number, number, number]) {
    this.ops.push(`${col(fill)} rg ${x} ${y} ${w} ${h} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke = RULE, width = 0.6) {
    this.ops.push(`${col(stroke)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  text(t: string, x: number, y: number, size = 10, opts: { bold?: boolean; color?: [number, number, number]; align?: 'left' | 'right' } = {}) {
    const w = textWidth(t, size, opts.bold);
    const px = opts.align === 'right' ? x - w : x;
    this.ops.push(`BT /${opts.bold ? 'F2' : 'F1'} ${size} Tf ${col(opts.color ?? INK)} rg 1 0 0 1 ${px.toFixed(1)} ${y} Tm (${esc(t)}) Tj ET`);
  }
}

export interface StatementData {
  clientName: string;
  title: string;
  subtitle: string;
  currency: string;
  kpis: { label: string; value: string }[];
  summary: { label: string; value: string }[];
  table: { heading: string; columns: { label: string; align?: 'left' | 'right'; width: number }[]; rows: string[][] };
  footnote: string;
}

export function renderStatementPdf(d: StatementData): Buffer {
  const pages: Page[] = [];
  let p = new Page();
  pages.push(p);
  let y = H - M;

  // Header band.
  p.rect(0, H - 96, W, 96, NAVY);
  p.text('matanho', M, H - 44, 22, { bold: true, color: [1, 1, 1] });
  p.text(d.title.toUpperCase(), W - M, H - 38, 11, { bold: true, color: [1, 1, 1], align: 'right' });
  p.text(d.subtitle, W - M, H - 54, 8.5, { color: [0.82, 0.87, 0.94], align: 'right' });
  p.text(d.clientName, M, H - 70, 10, { color: [0.82, 0.87, 0.94] });
  y = H - 96 - 28;

  // KPI tiles.
  if (d.kpis.length) {
    const gap = 8;
    const tw = (W - 2 * M - gap * (d.kpis.length - 1)) / d.kpis.length;
    d.kpis.forEach((k, i) => {
      const x = M + i * (tw + gap);
      p.rect(x, y - 44, tw, 50, BAND);
      p.rect(x, y - 44, 3, 50, NAVY);
      p.text(k.label.toUpperCase(), x + 12, y - 8, 7.5, { color: MUTED, bold: true });
      p.text(k.value, x + 12, y - 30, 15, { bold: true });
    });
    y -= 70;
  }

  // Summary table.
  p.text('SUMMARY', M, y, 9, { bold: true, color: MUTED });
  y -= 8;
  p.line(M, y, W - M, y);
  y -= 16;
  d.summary.forEach((r, i) => {
    if (i % 2 === 0) p.rect(M, y - 5, W - 2 * M, 18, BAND);
    p.text(r.label, M + 8, y, 10);
    p.text(r.value, W - M - 8, y, 10, { bold: true, align: 'right' });
    y -= 18;
  });
  y -= 14;

  // Detail table, paginated.
  const drawHead = (pg: Page, top: number) => {
    pg.text(d.table.heading.toUpperCase(), M, top, 9, { bold: true, color: MUTED });
    pg.rect(M, top - 24, W - 2 * M, 18, NAVY);
    let x = M + 8;
    for (const c of d.table.columns) {
      pg.text(c.label, c.align === 'right' ? x + c.width - 8 : x, top - 18, 8, { bold: true, color: [1, 1, 1], align: c.align === 'right' ? 'right' : 'left' });
      x += c.width;
    }
    return top - 24 - 6;
  };
  y = drawHead(p, y);
  d.table.rows.forEach((row, i) => {
    if (y < 90) {
      p = new Page();
      pages.push(p);
      y = drawHead(p, H - M - 8) - 0;
    }
    if (i % 2 === 1) p.rect(M, y - 6, W - 2 * M, 18, BAND);
    let x = M + 8;
    d.table.columns.forEach((c, ci) => {
      const cell = fit(row[ci] ?? '', c.width - 12, 9);
      p.text(cell, c.align === 'right' ? x + c.width - 8 : x, y, 9, { align: c.align === 'right' ? 'right' : 'left' });
      x += c.width;
    });
    y -= 18;
  });
  if (!d.table.rows.length) p.text('No fund positions in this period.', M + 8, y, 9, { color: MUTED });
  y -= 16;
  if (y > 60) p.text(d.footnote, M, y, 8, { color: MUTED });
  else {
    p = new Page();
    pages.push(p);
    p.text(d.footnote, M, H - M, 8, { color: MUTED });
  }

  pages.forEach((pg, i) => {
    pg.line(M, 44, W - M, 44);
    pg.text(`Matanho Asset Management  |  ${ascii(d.clientName)}`, M, 30, 7.5, { color: MUTED });
    pg.text(`Page ${i + 1} of ${pages.length}`, W - M, 30, 7.5, { color: MUTED, align: 'right' });
  });

  // Object layout: 1 catalog, 2 pages, 3 F1, 4 F2, then (page, content) pairs.
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const kids: string[] = [];
  pages.forEach((pg) => {
    const pageNo = objects.length + 1;
    const contentNo = pageNo + 1;
    kids.push(`${pageNo} 0 R`);
    const stream = pg.ops.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

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
