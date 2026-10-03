/**
 * Minimal one-page text PDF (Helvetica, A4) for call and distribution notices. No dependency:
 * the day-one slice needs a real PDF artefact with a stable hash, not typography.
 */
export function ascii(text: string): string {
  return text
    .replace(/[•·]/g, '*')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e]/g, '?');
}

export function esc(text: string): string {
  return ascii(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gap?: number;
}

export function renderPdf(title: string, lines: PdfLine[]): Buffer {
  const ops: string[] = ['BT'];
  let y = 800;
  const all: PdfLine[] = [{ text: title, size: 16, bold: true, gap: 26 }, ...lines];
  for (const l of all) {
    if (y < 40) break;
    const size = l.size ?? 10;
    ops.push(`/${l.bold ? 'F2' : 'F1'} ${size} Tf`, `1 0 0 1 50 ${y} Tm`, `(${esc(l.text)}) Tj`);
    y -= l.gap ?? size + 5;
  }
  ops.push('ET');
  const stream = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
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

/** "1,234,567.89" for notices. */
export function fmtMoney(value: string, currency: string): string {
  const [int, frac = '00'] = value.split('.');
  return `${currency} ${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac.padEnd(2, '0').slice(0, 2)}`;
}
