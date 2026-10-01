/** Minimal single-page PDF writer (Helvetica, wrapped lines) for generated term sheets and certificates. */
export function simplePdf(title: string, lines: string[]): Buffer {
  const esc = (t: string) => t.replace(/[^\x20-\x7e]/g, '-').replace(/([()\\])/g, '\\$1');
  const wrapped = lines.flatMap((l) => wrap(l, 92));
  const body = wrapped.slice(0, 44);
  if (wrapped.length > body.length) body.push('[continued in the record held by Matanho Nexus]');
  const text = [
    'BT /F1 16 Tf 56 780 Td (' + esc(title) + ') Tj ET',
    ...body.map((l, i) => `BT /F1 10 Tf 56 ${750 - i * 15} Td (${esc(l)}) Tj ET`),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(/\s+/)) {
    if ((current + ' ' + word).trim().length > width) {
      if (current) out.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    } else current = (current + ' ' + word).trim();
  }
  if (current) out.push(current);
  return out;
}
