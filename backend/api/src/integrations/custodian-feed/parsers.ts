import type { FeedHolding, FeedTransaction, ParsedStatement } from './types';

/**
 * Statement parsers for the file-drop adapter: CSV, MT940-like and JSON. Pure functions, strict: any unreadable row
 * fails the whole file (listing the first problems) so a half-read statement is never imported.
 *
 * CSV (header row, case-insensitive, `#` lines ignored):
 *   record_type,account,statement_date,currency,ticker,isin,side,quantity,price,market_value,trade_ref,execution_at,settlement_date,amount
 *   BALANCE: closing cash in `amount`.   HOLDING: ticker, quantity, price, market_value.   TRADE: ticker, side, quantity, price, trade_ref, execution_at.
 *
 * MT940-like (SWIFT tags, one block per `:20:`):
 *   :25: account   :62F: C|D + YYMMDD + CCY + amount (comma decimal) = closing booked balance (date = statement date)
 *   :61: statement line (ignored for securities)   :86: `TRD/<ref>/<BUY|SELL>/<ticker>/<qty>/<price>/<execAt ISO>[/<settle YYYY-MM-DD>]` = trade
 *   :93: `<ticker>/<isin or ->/<qty>/<price>/<market value>` = holding (house extension; MT535 proper is a later adapter)
 *
 * JSON: one statement object, an array, or `{ "statements": [...] }` with
 *   { accountRef, statementDate, currency, closingCash, holdings: [{ticker,isin,quantity,price,marketValue}], transactions: [{tradeRef,executionAt,ticker,side,quantity,price,currency,settlementDate}] }
 */

export class StatementParseError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'StatementParseError';
  }
}

const MAX_ROWS = 5000;
const DEC = /^-?\d{1,16}(\.\d{1,8})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function detectFormat(content: string): 'CSV' | 'MT940' | 'JSON' {
  const t = content.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'JSON';
  if (/^:(20|25|60F|62F):/m.test(t)) return 'MT940';
  return 'CSV';
}

export function parseStatements(content: string, format?: 'CSV' | 'MT940' | 'JSON'): ParsedStatement[] {
  const text = content.replace(/^﻿/, '');
  if (!text.trim()) throw new StatementParseError('The file is empty');
  const f = format ?? detectFormat(text);
  const out = f === 'JSON' ? parseJson(text) : f === 'MT940' ? parseMt940(text) : parseCsv(text);
  if (!out.length) throw new StatementParseError('No statements found in the file');
  return out;
}

// ---------------------------------------------------------------- field checks

class Problems {
  list: string[] = [];
  add(where: string, msg: string) {
    if (this.list.length < 25) this.list.push(`${where}: ${msg}`);
  }
  throwIfAny(what: string) {
    if (this.list.length) throw new StatementParseError(`${what}: ${this.list.slice(0, 5).join('; ')}${this.list.length > 5 ? ` (+${this.list.length - 5} more)` : ''}`, this.list);
  }
}

function dec(p: Problems, where: string, name: string, v: unknown, opts: { required?: boolean; positive?: boolean } = {}): string | null {
  const s = v === undefined || v === null ? '' : String(v).trim().replace(/,/g, '');
  if (!s) {
    if (opts.required) p.add(where, `${name} is required`);
    return null;
  }
  if (!DEC.test(s)) {
    p.add(where, `${name} "${s.slice(0, 24)}" is not a number`);
    return null;
  }
  if (opts.positive && Number(s) <= 0) {
    p.add(where, `${name} must be greater than zero`);
    return null;
  }
  return s;
}

function date(p: Problems, where: string, name: string, v: unknown, required = true): string | null {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) {
    if (required) p.add(where, `${name} is required`);
    return null;
  }
  if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    p.add(where, `${name} "${s.slice(0, 20)}" must be YYYY-MM-DD`);
    return null;
  }
  return s;
}

function ts(p: Problems, where: string, v: unknown, fallbackDate: string): string | null {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) return `${fallbackDate}T00:00:00.000Z`;
  const d = new Date(DATE.test(s) ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) {
    p.add(where, `execution time "${s.slice(0, 30)}" is not a valid ISO timestamp`);
    return null;
  }
  return d.toISOString();
}

function str(p: Problems, where: string, name: string, v: unknown, max: number, required = true): string | null {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) {
    if (required) p.add(where, `${name} is required`);
    return null;
  }
  if (s.length > max) {
    p.add(where, `${name} is longer than ${max} characters`);
    return null;
  }
  return s;
}

function ccy(p: Problems, where: string, v: unknown, required = true): string | null {
  const s = str(p, where, 'currency', v, 3, required);
  if (s && !/^[A-Za-z]{3}$/.test(s)) {
    p.add(where, `currency "${s}" must be a 3-letter code`);
    return null;
  }
  return s ? s.toUpperCase() : null;
}

function side(p: Problems, where: string, v: unknown): 'BUY' | 'SELL' | null {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'BUY' || s === 'B') return 'BUY';
  if (s === 'SELL' || s === 'S') return 'SELL';
  p.add(where, `side "${s.slice(0, 10)}" must be BUY or SELL`);
  return null;
}

interface Draft {
  accountRef: string;
  statementDate: string;
  currency: string | null;
  closingCash: string | null;
  holdings: FeedHolding[];
  transactions: FeedTransaction[];
}

function finish(format: ParsedStatement['format'], drafts: Draft[]): ParsedStatement[] {
  return drafts.map((d) => {
    const warnings: string[] = [];
    if (d.closingCash === null) warnings.push('No closing cash balance in the file: no day-end package was created');
    if (!d.holdings.length) warnings.push('No holdings lines in the file');
    return { format, ...d, warnings };
  });
}

// ---------------------------------------------------------------- CSV

/** RFC-4180 style line splitter (quotes, doubled quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const CSV_ALIASES: Record<string, string[]> = {
  type: ['record_type', 'type', 'record'],
  account: ['account', 'account_ref', 'accountref'],
  date: ['statement_date', 'date', 'as_of'],
  currency: ['currency', 'ccy'],
  ticker: ['ticker', 'symbol', 'security'],
  isin: ['isin'],
  side: ['side', 'buy_sell'],
  quantity: ['quantity', 'qty'],
  price: ['price'],
  mv: ['market_value', 'marketvalue', 'value'],
  ref: ['trade_ref', 'traderef', 'reference'],
  at: ['execution_at', 'executed_at', 'trade_time'],
  settle: ['settlement_date', 'settle_date'],
  amount: ['amount', 'balance', 'closing_cash'],
};

function parseCsv(text: string): ParsedStatement[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new StatementParseError('CSV needs a header row and at least one record');
  if (lines.length > MAX_ROWS + 1) throw new StatementParseError(`CSV has more than ${MAX_ROWS} rows`);
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const idx: Record<string, number> = {};
  for (const [k, aliases] of Object.entries(CSV_ALIASES)) idx[k] = header.findIndex((h) => aliases.includes(h));
  for (const need of ['type', 'account', 'date']) if (idx[need]! < 0) throw new StatementParseError(`CSV header must include ${CSV_ALIASES[need]![0]}`);

  const p = new Problems();
  const groups = new Map<string, Draft>();
  lines.slice(1).forEach((line, n) => {
    const where = `row ${n + 2}`;
    const c = splitCsvLine(line);
    const get = (k: string) => (idx[k]! >= 0 ? (c[idx[k]!] ?? '') : '');
    const type = get('type').toUpperCase();
    const account = str(p, where, 'account', get('account'), 64);
    const sdate = date(p, where, 'statement_date', get('date'));
    if (!account || !sdate) return;
    const key = `${account}|${sdate}`;
    const g = groups.get(key) ?? { accountRef: account, statementDate: sdate, currency: null, closingCash: null, holdings: [], transactions: [] };
    groups.set(key, g);
    const cur = ccy(p, where, get('currency'), type !== 'TRADE' ? true : false) ?? g.currency;
    if (type === 'BALANCE') {
      g.currency = cur ?? g.currency;
      g.closingCash = dec(p, where, 'amount', get('amount'), { required: true });
    } else if (type === 'HOLDING') {
      const ticker = str(p, where, 'ticker', get('ticker'), 32);
      const quantity = dec(p, where, 'quantity', get('quantity'), { required: true });
      const price = dec(p, where, 'price', get('price'), { positive: true });
      let mv = dec(p, where, 'market_value', get('mv'));
      if (mv === null && quantity !== null && price !== null) mv = (Number(quantity) * Number(price)).toFixed(2);
      if (ticker && quantity !== null && cur) g.holdings.push({ accountRef: account, statementDate: sdate, ticker, isin: str(p, where, 'isin', get('isin'), 12, false), quantity, price, marketValue: mv, currency: cur });
    } else if (type === 'TRADE') {
      const ticker = str(p, where, 'ticker', get('ticker'), 32);
      const tradeRef = str(p, where, 'trade_ref', get('ref'), 64);
      const sd = side(p, where, get('side'));
      const quantity = dec(p, where, 'quantity', get('quantity'), { required: true, positive: true });
      const price = dec(p, where, 'price', get('price'), { required: true, positive: true });
      const at = ts(p, where, get('at'), sdate);
      const tc = cur ?? g.currency;
      if (!tc) p.add(where, 'currency is required');
      if (ticker && tradeRef && sd && quantity && price && at && tc) {
        g.transactions.push({ tradeRef, executionAt: at, accountRef: account, ticker, isin: str(p, where, 'isin', get('isin'), 12, false), side: sd, quantity, price, currency: tc, settlementDate: date(p, where, 'settlement_date', get('settle'), false) });
      }
    } else p.add(where, `record_type "${type.slice(0, 12)}" must be BALANCE, HOLDING or TRADE`);
  });
  p.throwIfAny('CSV rejected');
  return finish('CSV', [...groups.values()]);
}

// ---------------------------------------------------------------- MT940-like

const yymmdd = (s: string) => `${Number(s.slice(0, 2)) >= 70 ? '19' : '20'}${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;

function parseMt940(text: string): ParsedStatement[] {
  // Join continuation lines (those not starting with ':') onto the previous tag.
  const tags: { tag: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim() === '-' || line.startsWith('{') || line.startsWith('-}')) continue;
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (m) tags.push({ tag: m[1]!, value: m[2]! });
    else if (tags.length) tags[tags.length - 1]!.value += line.trim();
  }
  const p = new Problems();
  const blocks: Draft[] = [];
  let cur: Draft | null = null;
  let pending61 = false;
  for (const { tag, value } of tags) {
    const where = `:${tag}:`;
    if (tag === '20') {
      cur = { accountRef: '', statementDate: '', currency: null, closingCash: null, holdings: [], transactions: [] };
      blocks.push(cur);
      continue;
    }
    if (!cur) {
      cur = { accountRef: '', statementDate: '', currency: null, closingCash: null, holdings: [], transactions: [] };
      blocks.push(cur);
    }
    if (tag === '25') cur.accountRef = str(p, where, 'account', value.split('/').pop(), 64) ?? '';
    else if (tag === '62F' || tag === '62M') {
      const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)$/.exec(value.trim());
      if (!m) p.add(where, `closing balance "${value.slice(0, 30)}" is not C|D YYMMDD CCY amount`);
      else {
        const amount = dec(p, where, 'amount', m[4]!.replace(',', '.'), { required: true });
        cur.currency = m[3]!;
        cur.statementDate = yymmdd(m[2]!);
        if (amount !== null) cur.closingCash = m[1] === 'D' ? `-${amount}` : amount;
      }
    } else if (tag === '61') pending61 = true;
    else if (tag === '86') {
      if (value.startsWith('TRD/')) {
        const f = value.split('/');
        const sd = side(p, where, f[2]);
        const ticker = str(p, where, 'ticker', f[3], 32);
        const quantity = dec(p, where, 'quantity', f[4], { required: true, positive: true });
        const price = dec(p, where, 'price', f[5], { required: true, positive: true });
        const tradeRef = str(p, where, 'trade ref', f[1], 64);
        const at = ts(p, where, f[6], cur.statementDate || '1970-01-01');
        if (sd && ticker && quantity && price && tradeRef && at) {
          cur.transactions.push({ tradeRef, executionAt: at, accountRef: cur.accountRef, ticker, side: sd, quantity, price, currency: cur.currency ?? '', settlementDate: f[7] ? date(p, where, 'settlement date', f[7], false) : null });
        }
      }
      pending61 = false;
    } else if (tag === '93') {
      const f = value.split('/');
      const ticker = str(p, where, 'ticker', f[0], 32);
      const quantity = dec(p, where, 'quantity', f[2], { required: true });
      const price = dec(p, where, 'price', f[3], { positive: true });
      const mv = dec(p, where, 'market value', f[4]);
      if (ticker && quantity !== null) cur.holdings.push({ accountRef: cur.accountRef, statementDate: cur.statementDate, ticker, isin: f[1] && f[1] !== '-' ? f[1] : null, quantity, price, marketValue: mv ?? (price ? (Number(quantity) * Number(price)).toFixed(2) : null), currency: cur.currency ?? '' });
    }
  }
  void pending61;
  if (blocks.length > 50) p.add('file', 'more than 50 statements in one file');
  for (const [i, b] of blocks.entries()) {
    const where = `statement ${i + 1}`;
    if (!b.accountRef) p.add(where, ':25: account is required');
    if (!b.statementDate) p.add(where, ':62F: closing balance (with the statement date) is required');
    if (!b.currency) p.add(where, 'currency missing');
    for (const h of b.holdings) {
      h.accountRef = b.accountRef;
      h.statementDate = b.statementDate;
      h.currency = b.currency ?? '';
    }
    for (const t of b.transactions) {
      t.accountRef = b.accountRef;
      t.currency = b.currency ?? '';
      if (t.executionAt.startsWith('1970')) p.add(where, `trade ${t.tradeRef} needs an execution timestamp or a :62F: date before it`);
    }
  }
  p.throwIfAny('MT940 rejected');
  return finish('MT940', blocks);
}

// ---------------------------------------------------------------- JSON

function parseJson(text: string): ParsedStatement[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new StatementParseError(`JSON is not valid: ${e instanceof Error ? e.message : String(e)}`);
  }
  const list: unknown[] = Array.isArray(root) ? root : root && typeof root === 'object' && Array.isArray((root as { statements?: unknown[] }).statements) ? (root as { statements: unknown[] }).statements : [root];
  if (list.length > 50) throw new StatementParseError('More than 50 statements in one file');
  const p = new Problems();
  const drafts: Draft[] = [];
  list.forEach((raw, i) => {
    const where = `statement ${i + 1}`;
    if (!raw || typeof raw !== 'object') return p.add(where, 'must be an object');
    const o = raw as Record<string, unknown>;
    const accountRef = str(p, where, 'accountRef', o.accountRef ?? o.account, 64);
    const statementDate = date(p, where, 'statementDate', o.statementDate ?? o.date);
    const currency = ccy(p, where, o.currency, false);
    const closingCash = dec(p, where, 'closingCash', o.closingCash);
    if (!accountRef || !statementDate) return;
    const holdingsIn = Array.isArray(o.holdings) ? o.holdings : [];
    const txIn = Array.isArray(o.transactions) ? o.transactions : [];
    if (holdingsIn.length > MAX_ROWS || txIn.length > MAX_ROWS) return p.add(where, `more than ${MAX_ROWS} lines`);
    const d: Draft = { accountRef, statementDate, currency, closingCash, holdings: [], transactions: [] };
    holdingsIn.forEach((h: Record<string, unknown>, n) => {
      const w = `${where} holding ${n + 1}`;
      const ticker = str(p, w, 'ticker', h.ticker, 32);
      const quantity = dec(p, w, 'quantity', h.quantity, { required: true });
      const price = dec(p, w, 'price', h.price, { positive: true });
      let mv = dec(p, w, 'marketValue', h.marketValue);
      if (mv === null && quantity !== null && price !== null) mv = (Number(quantity) * Number(price)).toFixed(2);
      const c = ccy(p, w, h.currency ?? currency, true);
      if (ticker && quantity !== null && c) d.holdings.push({ accountRef, statementDate, ticker, isin: str(p, w, 'isin', h.isin, 12, false), quantity, price, marketValue: mv, currency: c });
    });
    txIn.forEach((t: Record<string, unknown>, n) => {
      const w = `${where} transaction ${n + 1}`;
      const ticker = str(p, w, 'ticker', t.ticker, 32);
      const tradeRef = str(p, w, 'tradeRef', t.tradeRef, 64);
      const sd = side(p, w, t.side);
      const quantity = dec(p, w, 'quantity', t.quantity, { required: true, positive: true });
      const price = dec(p, w, 'price', t.price, { required: true, positive: true });
      const at = ts(p, w, t.executionAt, statementDate);
      const c = ccy(p, w, t.currency ?? currency, true);
      if (ticker && tradeRef && sd && quantity && price && at && c) {
        d.transactions.push({ tradeRef, executionAt: at, accountRef, ticker, isin: str(p, w, 'isin', t.isin, 12, false), side: sd, quantity, price, currency: c, settlementDate: date(p, w, 'settlementDate', t.settlementDate, false), note: str(p, w, 'note', t.note, 255, false) });
      }
    });
    drafts.push(d);
  });
  p.throwIfAny('JSON rejected');
  return finish('JSON', drafts);
}

// ---------------------------------------------------------------- serialisers (templates, fake feed, round-trip tests)

export function renderStatement(s: Pick<ParsedStatement, 'accountRef' | 'statementDate' | 'currency' | 'closingCash' | 'holdings' | 'transactions'>, format: 'CSV' | 'MT940' | 'JSON'): string {
  const cur = s.currency ?? 'USD';
  if (format === 'JSON') return JSON.stringify({ accountRef: s.accountRef, statementDate: s.statementDate, currency: cur, closingCash: s.closingCash, holdings: s.holdings.map(({ ticker, isin, quantity, price, marketValue }) => ({ ticker, isin, quantity, price, marketValue })), transactions: s.transactions.map(({ tradeRef, executionAt, ticker, side, quantity, price, currency, settlementDate }) => ({ tradeRef, executionAt, ticker, side, quantity, price, currency, settlementDate })) }, null, 2);
  if (format === 'MT940') {
    const ymd = s.statementDate.replace(/-/g, '').slice(2);
    const cash = s.closingCash ?? '0';
    const lines = [':20:NEXUS' + ymd, `:25:${s.accountRef}`, ':28C:1/1'];
    for (const t of s.transactions) {
      lines.push(`:61:${ymd}${ymd.slice(2)}${t.side === 'BUY' ? 'D' : 'C'}${(Number(t.quantity) * Number(t.price)).toFixed(2).replace('.', ',')}NTRF${t.tradeRef}`);
      lines.push(`:86:TRD/${t.tradeRef}/${t.side}/${t.ticker}/${t.quantity}/${t.price}/${t.executionAt}${t.settlementDate ? `/${t.settlementDate}` : ''}`);
    }
    lines.push(`:62F:${cash.startsWith('-') ? 'D' : 'C'}${ymd}${cur}${cash.replace('-', '').replace('.', ',')}`);
    for (const h of s.holdings) lines.push(`:93:${h.ticker}/${h.isin ?? '-'}/${h.quantity}/${h.price ?? ''}/${h.marketValue ?? ''}`);
    return lines.join('\n') + '\n';
  }
  const rows = ['record_type,account,statement_date,currency,ticker,isin,side,quantity,price,market_value,trade_ref,execution_at,settlement_date,amount'];
  rows.push(`BALANCE,${s.accountRef},${s.statementDate},${cur},,,,,,,,,,${s.closingCash ?? ''}`);
  for (const h of s.holdings) rows.push(`HOLDING,${s.accountRef},${s.statementDate},${h.currency},${h.ticker},${h.isin ?? ''},,${h.quantity},${h.price ?? ''},${h.marketValue ?? ''},,,,`);
  for (const t of s.transactions) rows.push(`TRADE,${s.accountRef},${s.statementDate},${t.currency},${t.ticker},${t.isin ?? ''},${t.side},${t.quantity},${t.price},,${t.tradeRef},${t.executionAt},${t.settlementDate ?? ''},`);
  return rows.join('\n') + '\n';
}
