import { dayFromIso, isoDay } from '../common';
import type { ContractNoteLine, FixExecutionReport, ParsedContractNote } from './types';

/**
 * Pure parsers for the broker feeds (no database, no config): contract notes (CSV or JSON) and FIX 4.x ExecutionReports.
 *
 * Contract-note CSV (header row required, any order, case and spaces/dashes ignored):
 *   trade_ref (or execution_id)            required, unique per broker
 *   order_ref (or client_order_id)         our order reference, e.g. ORD-00012
 *   broker_order_ref (or order_id)         the broker's reference, optional
 *   ticker (or symbol)  side  quantity (or qty)  price  trade_date (or date)   required
 *   fees (or commission)  executed_at      optional (executed_at defaults to the trade date, 08:00Z)
 * At least one of order_ref / broker_order_ref is required. JSON: `{ "trades": [ {tradeRef, orderRef, brokerOrderRef, ticker,
 * side, quantity, price, fees, tradeDate, executedAt} ] }` or the bare array. Any structural problem rejects the whole
 * file (FeedParseError lists the first problems); business mismatches are the matcher's job, not the parser's.
 */

export class FeedParseError extends Error {
  readonly code = 'feed_rejected';
  constructor(message: string, readonly problems: string[] = []) {
    super(message);
    this.name = 'FeedParseError';
  }
}

const MAX_LINES = 5000;
const QTY = /^\d+(\.\d{1,6})?$/;
const FEE = /^\d+(\.\d{1,4})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
const ALIASES: Record<string, keyof RawLine> = {
  trade_ref: 'tradeRef', traderef: 'tradeRef', execution_id: 'tradeRef', exec_id: 'tradeRef',
  order_ref: 'orderRef', orderref: 'orderRef', client_order_id: 'orderRef', cl_ord_id: 'orderRef',
  broker_order_ref: 'brokerOrderRef', brokerorderref: 'brokerOrderRef', order_id: 'brokerOrderRef',
  ticker: 'ticker', symbol: 'ticker', security: 'ticker',
  side: 'side',
  quantity: 'quantity', qty: 'quantity',
  price: 'price', avg_price: 'price',
  fees: 'fees', commission: 'fees', charges: 'fees',
  trade_date: 'tradeDate', tradedate: 'tradeDate', date: 'tradeDate',
  executed_at: 'executedAt', executedat: 'executedAt', time: 'executedAt',
};
interface RawLine {
  tradeRef?: string;
  orderRef?: string;
  brokerOrderRef?: string;
  ticker?: string;
  side?: string;
  quantity?: string;
  price?: string;
  fees?: string;
  tradeDate?: string;
  executedAt?: string;
}

function sideOf(v: string | undefined): 'BUY' | 'SELL' | null {
  const s = (v ?? '').trim().toUpperCase();
  if (s === 'BUY' || s === 'B' || s === '1') return 'BUY';
  if (s === 'SELL' || s === 'S' || s === '2') return 'SELL';
  return null;
}

function validate(raw: RawLine, where: string, problems: string[]): ContractNoteLine | null {
  const before = problems.length;
  const p = (m: string) => problems.push(`${where}: ${m}`);
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
  const tradeRef = s(raw.tradeRef);
  if (!tradeRef) p('trade_ref is required');
  else if (tradeRef.length > 100) p('trade_ref is longer than 100 characters');
  const orderRef = s(raw.orderRef).toUpperCase();
  const brokerOrderRef = s(raw.brokerOrderRef);
  if (!orderRef && !brokerOrderRef) p('order_ref or broker_order_ref is required');
  if (orderRef.length > 32) p('order_ref is longer than 32 characters');
  if (brokerOrderRef.length > 64) p('broker_order_ref is longer than 64 characters');
  const ticker = s(raw.ticker).toUpperCase();
  if (!ticker) p('ticker is required');
  else if (ticker.length > 32) p('ticker is longer than 32 characters');
  const side = sideOf(raw.side);
  if (!side) p('side must be BUY or SELL');
  const quantity = s(raw.quantity).replace(/,/g, '');
  if (!QTY.test(quantity) || Number(quantity) <= 0) p('quantity must be a positive number (up to 6 decimals)');
  const price = s(raw.price).replace(/,/g, '');
  if (!QTY.test(price) || Number(price) <= 0) p('price must be a positive number (up to 6 decimals)');
  const fees = s(raw.fees).replace(/,/g, '') || '0';
  if (!FEE.test(fees)) p('fees must be a non-negative number (up to 4 decimals)');
  const tradeDate = s(raw.tradeDate).slice(0, 10);
  if (!DAY.test(tradeDate) || Number.isNaN(dayFromIso(tradeDate).getTime())) p('trade_date must be YYYY-MM-DD');
  let executedAt = `${tradeDate}T08:00:00.000Z`;
  if (s(raw.executedAt)) {
    const t = new Date(s(raw.executedAt));
    if (Number.isNaN(t.getTime())) p('executed_at is not a valid date-time');
    else executedAt = t.toISOString();
  }
  if (problems.length > before) return null;
  return { tradeRef, orderRef: orderRef || undefined, brokerOrderRef: brokerOrderRef || undefined, ticker, side: side!, quantity, price, fees, tradeDate, executedAt };
}

export function parseContractNoteText(content: string, format?: 'CSV' | 'JSON'): ParsedContractNote {
  const trimmed = content.trim();
  if (!trimmed) throw new FeedParseError('The contract note is empty');
  const fmt: 'CSV' | 'JSON' = format ?? (trimmed.startsWith('{') || trimmed.startsWith('[') ? 'JSON' : 'CSV');
  const raws: { raw: RawLine; where: string }[] = [];
  const problems: string[] = [];
  if (fmt === 'JSON') {
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch (e) {
      throw new FeedParseError(`Not valid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
    }
    const arr = Array.isArray(doc) ? doc : doc && typeof doc === 'object' && Array.isArray((doc as { trades?: unknown }).trades) ? (doc as { trades: unknown[] }).trades : null;
    if (!arr) throw new FeedParseError('JSON must be an array of trades or an object with a "trades" array');
    arr.forEach((t, i) => {
      if (!t || typeof t !== 'object') return void problems.push(`trade ${i + 1}: not an object`);
      const raw: RawLine = {};
      for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
        const key = ALIASES[norm(k)] ?? ALIASES[k.toLowerCase()];
        if (key && (typeof v === 'string' || typeof v === 'number')) raw[key] = String(v);
      }
      raws.push({ raw, where: `trade ${i + 1}` });
    });
  } else {
    const rows = splitCsv(trimmed);
    if (rows.length < 2) throw new FeedParseError('The CSV needs a header row and at least one trade');
    const cols = rows[0]!.map((h) => ALIASES[norm(h)]);
    for (const need of ['tradeRef', 'ticker', 'side', 'quantity', 'price', 'tradeDate'] as const) {
      if (!cols.includes(need)) throw new FeedParseError(`The CSV header has no column for ${need}`, [`Missing column: ${need}`]);
    }
    rows.slice(1).forEach((r, i) => {
      const raw: RawLine = {};
      cols.forEach((key, c) => {
        if (key && r[c] !== undefined) raw[key] = r[c]!;
      });
      raws.push({ raw, where: `row ${i + 2}` });
    });
  }
  if (raws.length === 0 && problems.length === 0) throw new FeedParseError('The contract note has no trades');
  if (raws.length > MAX_LINES) throw new FeedParseError(`At most ${MAX_LINES} trades per file`);
  const lines: ContractNoteLine[] = [];
  const seen = new Set<string>();
  for (const { raw, where } of raws) {
    const l = validate(raw, where, problems);
    if (!l) continue;
    if (seen.has(l.tradeRef)) problems.push(`${where}: trade_ref ${l.tradeRef} appears twice in this file`);
    seen.add(l.tradeRef);
    lines.push(l);
  }
  if (problems.length) throw new FeedParseError(`Contract note rejected: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}`, problems.slice(0, 20));
  return { format: fmt, lines };
}

// ------------------------------------------------------------------ FIX

const SOH = '\u0001';

export function fixChecksum(bodyUpToChecksum: string): string {
  let sum = 0;
  for (const b of Buffer.from(bodyUpToChecksum, 'latin1')) sum = (sum + b) % 256;
  return String(sum).padStart(3, '0');
}

/** Builds a FIX 4.4 ExecutionReport (35=8) with BodyLength and CheckSum; used by the fake sender and the tests. */
export function buildFixExecutionReport(f: { execId: string; clOrdId?: string; orderId?: string; symbol: string; side: 'BUY' | 'SELL'; lastQty: string; lastPx: string; time: Date; execType?: 'F' | '0' | '4' | '8'; commission?: string; sender?: string; target?: string }): string {
  const ts = f.time.toISOString().replace(/-/g, '').replace('T', '-').replace('Z', '');
  const body: [number, string][] = [
    [35, '8'], [49, f.sender ?? 'BROKER'], [56, f.target ?? 'MATANHO'], [34, '1'], [52, ts],
    [37, f.orderId ?? 'NONE'], [11, f.clOrdId ?? ''], [17, f.execId], [150, f.execType ?? 'F'], [39, f.execType === '8' ? '8' : f.execType === '4' ? '4' : '2'],
    [55, f.symbol], [54, f.side === 'BUY' ? '1' : '2'], [32, f.lastQty], [31, f.lastPx], [60, ts],
  ];
  if (f.commission) body.push([12, f.commission]);
  const inner = body.filter(([, v]) => v !== '').map(([t, v]) => `${t}=${v}${SOH}`).join('');
  const head = `8=FIX.4.4${SOH}9=${inner.length}${SOH}`;
  const pre = head + inner;
  return `${pre}10=${fixChecksum(pre)}${SOH}`;
}

function fixTime(v: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(v ?? '');
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${(m[7] ?? '0').padEnd(3, '0')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parses one FIX message (SOH or `|` delimited). Only ExecutionReports (35=8) are accepted; non-trade reports come back as execType OTHER. */
export function parseFixMessage(raw: string): FixExecutionReport {
  const text = raw.trim();
  if (!text) throw new FeedParseError('Empty FIX message');
  const delim = text.includes(SOH) ? SOH : '|';
  const parts = text.split(delim).filter((x) => x !== '');
  const tags = new Map<string, string>();
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i <= 0) throw new FeedParseError(`Malformed FIX field "${p.slice(0, 20)}"`);
    if (!tags.has(p.slice(0, i))) tags.set(p.slice(0, i), p.slice(i + 1));
  }
  if (tags.get('35') !== '8') throw new FeedParseError(`Not an ExecutionReport (35=${tags.get('35') ?? 'missing'})`);
  const given = tags.get('10');
  if (given !== undefined) {
    const at = text.lastIndexOf(`${delim}10=`);
    const pre = text.slice(0, at + 1).split(delim).join(SOH);
    if (fixChecksum(pre) !== given) throw new FeedParseError('FIX checksum (tag 10) does not match');
  }
  const execId = tags.get('17') ?? '';
  if (!execId) throw new FeedParseError('ExecutionReport has no ExecID (tag 17)');
  const execType = ['F', '1', '2'].includes(tags.get('150') ?? '') ? 'TRADE' : 'OTHER';
  const side = sideOf(tags.get('54'));
  const base = { execId, clOrdId: tags.get('11') || undefined, orderId: tags.get('37') && tags.get('37') !== 'NONE' ? tags.get('37') : undefined, symbol: (tags.get('55') ?? '').toUpperCase(), raw: text.slice(0, 1000) };
  if (execType === 'OTHER') return { ...base, execType, side: side ?? 'BUY', lastQty: '0', lastPx: '0', transactTime: new Date(0).toISOString(), commission: '0' };
  const problems: string[] = [];
  if (!base.symbol) problems.push('Symbol (55) is required');
  if (!side) problems.push('Side (54) must be 1 or 2');
  const qty = tags.get('32') ?? '';
  const px = tags.get('31') ?? '';
  if (!QTY.test(qty) || Number(qty) <= 0) problems.push('LastQty (32) must be a positive number');
  if (!QTY.test(px) || Number(px) <= 0) problems.push('LastPx (31) must be a positive number');
  const t = fixTime(tags.get('60') ?? tags.get('52'));
  if (!t) problems.push('TransactTime (60) is not a valid UTC timestamp');
  const commission = tags.get('12') ?? '0';
  if (!FEE.test(commission)) problems.push('Commission (12) must be a non-negative number');
  if (!base.clOrdId && !base.orderId) problems.push('ClOrdID (11) or OrderID (37) is required');
  if (problems.length) throw new FeedParseError(`FIX ExecutionReport ${execId} rejected: ${problems[0]}`, problems);
  return { ...base, execType, side: side!, lastQty: qty, lastPx: px, transactTime: t!, commission };
}

export const tradeDateOf = (iso: string) => isoDay(new Date(iso));
