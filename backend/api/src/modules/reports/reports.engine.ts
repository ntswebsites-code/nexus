/**
 * Reports & BI engine (SRD 5.A page `reports`): pure rendering and scheduling helpers. No I/O.
 * A report is built once into `ReportData` (title, header facts, sections of rows) and rendered to CSV, JSON or
 * print-ready HTML from that single structure, so every format shows the same numbers.
 */

export type Cell = string | number | null;
export interface ReportSection {
  heading: string;
  columns: string[];
  rows: Cell[][];
}
export interface ReportData {
  title: string;
  meta: [string, string][];
  sections: ReportSection[];
  notes?: string[];
}

export const REPORT_KEYS = ['FACT_SHEET', 'HOLDINGS', 'TRANSACTIONS', 'NAV_PACK', 'CASH'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const REPORT_FORMATS = ['CSV', 'JSON', 'HTML'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FORMAT_META: Record<ReportFormat, { mime: string; ext: string }> = {
  CSV: { mime: 'text/csv', ext: 'csv' },
  // JSON and HTML are stored as opaque downloads so a browser never renders them from the API origin.
  JSON: { mime: 'application/octet-stream', ext: 'json' },
  HTML: { mime: 'application/octet-stream', ext: 'html' },
};

/** Spreadsheet formula injection guard: text cells that start with a formula character are prefixed with a quote. */
function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(d: ReportData): string {
  const out: string[] = [];
  out.push(csvCell(d.title));
  for (const [k, v] of d.meta) out.push(`${csvCell(k)},${csvCell(v)}`);
  for (const s of d.sections) {
    out.push('');
    out.push(csvCell(s.heading));
    out.push(s.columns.map(csvCell).join(','));
    for (const r of s.rows) out.push(r.map(csvCell).join(','));
  }
  for (const n of d.notes ?? []) {
    out.push('');
    out.push(csvCell(`Note: ${n}`));
  }
  return `${out.join('\r\n')}\r\n`;
}

const esc = (v: Cell) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const NUMERIC = /^-?\d[\d,]*(\.\d+)?%?$/;

export function toHtml(d: ReportData, generatedAt: Date): string {
  const sections = d.sections
    .map(
      (s) =>
        `<h2>${esc(s.heading)}</h2>` +
        (s.rows.length
          ? `<table><thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows
              .map((r) => `<tr>${r.map((c) => `<td${typeof c === 'number' || (typeof c === 'string' && NUMERIC.test(c)) ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`)
              .join('')}</tbody></table>`
          : '<p class="empty">No rows.</p>'),
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title><style>
@page{size:A4;margin:16mm}body{font:12px/1.45 Helvetica,Arial,sans-serif;color:#1b1f24;margin:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #c9d1d9;padding-bottom:3px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:8px 0}dt{color:#57606a}dd{margin:0}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e1e4e8;padding:4px 6px;text-align:left}th{background:#f6f8fa;font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}.empty,.foot{color:#57606a}tr{page-break-inside:avoid}
</style></head><body><h1>${esc(d.title)}</h1><dl>${d.meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${sections}${(d.notes ?? []).map((n) => `<p class="foot">${esc(n)}</p>`).join('')}<p class="foot">Generated ${esc(generatedAt.toISOString())} from live data. Print this page to save it as a PDF.</p></body></html>`;
}

export function render(d: ReportData, format: ReportFormat, generatedAt: Date): string {
  if (format === 'CSV') return toCsv(d);
  if (format === 'HTML') return toHtml(d, generatedAt);
  return JSON.stringify({ generatedAt: generatedAt.toISOString(), ...d }, null, 2);
}

export const rowCount = (d: ReportData) => d.sections.reduce((n, s) => n + s.rows.length, 0);

/** Next due date after `from` for a schedule frequency (UTC calendar days; month ends are clamped). */
export function nextRunAfter(from: Date, f: Frequency): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (f === 'DAILY') d.setUTCDate(d.getUTCDate() + 1);
  else if (f === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
  else {
    const months = f === 'MONTHLY' ? 1 : 3;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}

export const safeName = (s: string) => s.replace(/[^\w.\-]+/g, '_').slice(0, 80);
