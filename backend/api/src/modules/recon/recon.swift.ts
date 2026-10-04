import { Prisma } from '@prisma/client';

/**
 * SWIFT MT535 (statement of holdings) reader for the custody position feed (FR-CASH-017, FR-REC-017). Pure function.
 * Reads one statement: `:98A::STAT//YYYYMMDD` (date), `:97A::SAFE//account`, and per `:16R:FIN` block the `:35B:`
 * instrument (`ISIN XX...` then an optional `/CC/TICKER` line) with the aggregate balance `:93B::AGGR//UNIT/1000,`.
 * Quantities use the SWIFT decimal comma. Anything unreadable is reported; nothing is guessed.
 */
export interface Mt535Row {
  isin: string | null;
  ticker: string | null;
  quantity: string;
}
export interface Mt535 {
  rows: Mt535Row[];
  accountRef: string | null;
  asOfDate: string | null;
  errors: string[];
}

export const looksLikeMt535 = (text: string) => /:16R:(GENL|FIN)/.test(text) && /:35B:/.test(text);

export function parseMt535(text: string): Mt535 {
  const errors: string[] = [];
  const body = text.replace(/\r/g, '').replace(/^[\s\S]*?(?=:\d{2}[A-Z]?:)/, ''); // drop any {1:..}{2:..} header
  // Join continuation lines onto their field.
  const fields: { tag: string; value: string }[] = [];
  for (const line of body.split('\n')) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (m) fields.push({ tag: m[1]!, value: m[2]! });
    else if (fields.length && line.trim() !== '' && !line.startsWith('-}')) fields[fields.length - 1]!.value += '\n' + line;
  }
  let accountRef: string | null = null;
  let asOfDate: string | null = null;
  const rows: Mt535Row[] = [];
  let cur: { isin: string | null; ticker: string | null; quantity: string | null; at: number } | null = null;
  const close = () => {
    if (!cur) return;
    if (cur.quantity === null) errors.push(`Instrument ${cur.ticker ?? cur.isin ?? '#' + cur.at} has no :93B: aggregate balance`);
    else if (!cur.isin && !cur.ticker) errors.push(`Instrument #${cur.at} has neither an ISIN nor a ticker`);
    else rows.push({ isin: cur.isin, ticker: cur.ticker, quantity: cur.quantity });
    cur = null;
  };
  let n = 0;
  for (const f of fields) {
    if (f.tag === '98A' || f.tag === '98C') {
      const m = /^:STAT\/\/(\d{4})(\d{2})(\d{2})/.exec(f.value);
      if (m) asOfDate = `${m[1]}-${m[2]}-${m[3]}`;
    } else if (f.tag === '97A') {
      const m = /^:SAFE\/\/(.+)$/.exec(f.value.trim());
      if (m) accountRef = m[1]!.trim();
    } else if (f.tag === '35B') {
      close();
      n += 1;
      const lines = f.value.split('\n').map((x) => x.trim()).filter(Boolean);
      const first = lines[0] ?? '';
      const isinM = /^ISIN\s+([A-Z]{2}[A-Z0-9]{9}\d)$/.exec(first);
      let ticker: string | null = null;
      for (const l of lines.slice(first ? 1 : 0)) {
        const t = /^\/[A-Z]{2}\/([A-Z0-9.\-]{1,32})$/.exec(l);
        if (t) ticker = t[1]!;
      }
      if (!isinM && !/^[A-Z0-9.\-]{1,32}$/.test(first)) errors.push(`Instrument #${n}: ":35B:" must start with "ISIN <code>" or a ticker`);
      cur = { isin: isinM ? isinM[1]! : null, ticker: ticker ?? (!isinM && /^[A-Z0-9.\-]{1,32}$/.test(first) ? first : null), quantity: null, at: n };
    } else if (f.tag === '93B' && cur) {
      const m = /^:(AGGR|ELIG)\/\/UNIT\/(N?)(\d+(?:,\d*)?)$/.exec(f.value.trim());
      if (!m) errors.push(`Instrument ${cur.ticker ?? cur.isin ?? '#' + cur.at}: unreadable balance "${f.value.trim()}"`);
      else if (m[1] === 'AGGR') {
        const q = m[3]!.replace(',', '.').replace(/\.$/, '');
        cur.quantity = m[2] === 'N' ? '0' : q;
        if (m[2] === 'N' && q !== '0') errors.push(`Instrument ${cur.ticker ?? cur.isin}: a negative balance is not accepted in a holdings feed`);
        else if (!/^\d+(\.\d{1,8})?$/.test(cur.quantity)) errors.push(`Instrument ${cur.ticker ?? cur.isin}: quantity "${q}" must have at most 8 decimals`);
      }
    }
  }
  close();
  if (!n) errors.push('No :35B: instrument lines found; this does not look like an MT535 holdings statement');
  const seen = new Set<string>();
  for (const r of rows) {
    const k = r.ticker ?? r.isin!;
    if (seen.has(k)) errors.push(`Duplicate instrument ${k} in the statement`);
    seen.add(k);
  }
  return { rows, accountRef, asOfDate, errors };
}

/** Render rows as the MT535 the parser reads (used by the fake connector and the tests). */
export function renderMt535(input: { accountRef: string; asOfDate: string; rows: { ticker: string; isin?: string | null; quantity: string }[] }): string {
  const d = input.asOfDate.replace(/-/g, '');
  const out = [':16R:GENL', `:20C::SEME//MT535${d}`, ':23G:NEWM', `:98A::STAT//${d}`, `:97A::SAFE//${input.accountRef}`, ':16S:GENL', ':16R:FIN'];
  for (const r of input.rows) {
    out.push(`:35B:${r.isin ? `ISIN ${r.isin}` : r.ticker}`);
    if (r.isin) out.push(`/XX/${r.ticker}`);
    out.push(`:93B::AGGR//UNIT/${new Prisma.Decimal(r.quantity).toFixed().replace('.', ',')}${r.quantity.includes('.') ? '' : ','}`);
  }
  out.push(':16S:FIN');
  return out.join('\n');
}
