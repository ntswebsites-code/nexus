/**
 * Minimal tolerant HTML table reader (no dependencies). Handles omitted closing tags (`<tr><td>a<td>b`), attributes
 * without quotes and entities, which is how several free price pages are written.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ndash: '-', mdash: '-' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export interface HtmlRow {
  /** Cell text, tags stripped. */
  cells: string[];
  /** Raw HTML of the row (hashed for provenance). */
  html: string;
  isHeader: boolean;
}

export interface HtmlTable {
  /** Raw attribute string of the <table> tag. */
  attrs: string;
  headers: string[];
  rows: HtmlRow[];
}

export function extractTables(html: string): HtmlTable[] {
  const out: HtmlTable[] = [];
  const tableRe = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  for (let m = tableRe.exec(html); m; m = tableRe.exec(html)) {
    const inner = (m[2] ?? '').replace(/<\/?(thead|tbody|tfoot)\b[^>]*>/gi, '');
    const chunks = inner.split(/<tr\b[^>]*>/i).slice(1);
    const rows: HtmlRow[] = [];
    for (const chunk of chunks) {
      const cells: string[] = [];
      let isHeader = false;
      const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)(?=<(?:td|th)\b|<\/tr>|$)/gi;
      for (let c = cellRe.exec(chunk); c; c = cellRe.exec(chunk)) {
        if (c[1]!.toLowerCase() === 'th') isHeader = true;
        cells.push(stripTags(c[2] ?? ''));
      }
      if (cells.length) rows.push({ cells, html: chunk.replace(/\s+/g, ' ').trim(), isHeader });
    }
    const headerRow = rows.find((r) => r.isHeader);
    out.push({ attrs: m[1] ?? '', headers: (headerRow?.cells ?? []).map((h) => h.toLowerCase()), rows: rows.filter((r) => !r.isHeader) });
  }
  return out;
}

/** Index of the first header matching any alias (exact, then substring); -1 when absent. */
export function columnIndex(headers: string[], aliases: readonly string[]): number {
  for (const a of aliases) {
    const i = headers.findIndex((h) => h === a);
    if (i >= 0) return i;
  }
  for (const a of aliases) {
    const i = headers.findIndex((h) => h.includes(a));
    if (i >= 0) return i;
  }
  return -1;
}

/** Parses "1,234.50", "+0.43", "(2.5)" style numbers; null if the cell is not numeric. */
export function parseNumber(text: string): string | null {
  const t = text.replace(/[\s,]/g, '').replace(/^\+/, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return t;
}
