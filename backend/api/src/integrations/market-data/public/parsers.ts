import { hararePartsOf, lastWeekdayOnOrBefore, sha256 } from '../../common';
import type { FxQuote, HistoryPoint, Quote } from '../types';
import { columnIndex, extractTables, parseNumber, type HtmlTable } from './html';
import { ER_API, ZSE_AFX } from './sources.config';

/** Parsers return what they could read plus per-row problems; they never throw on a bad row. */
export interface ParseProblem {
  ticker?: string;
  message: string;
  rawHash?: string;
  rawValue?: string;
}
export interface ParseResult<T> {
  items: T[];
  problems: ParseProblem[];
}

export class LayoutChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutChangedError';
  }
}

function findTable(tables: HtmlTable[], mustHave: readonly (readonly string[])[], attr?: string): HtmlTable | undefined {
  return tables.find((t) => (!attr || t.attrs.includes(attr)) && mustHave.every((aliases) => columnIndex(t.headers, aliases) >= 0));
}

/** The trading day the list page represents: its own timestamp in Harare time, rolled back over a weekend. */
export function pageTradingDay(html: string, fetchedAt: Date): { day: string; fromPage: boolean } {
  const m = ZSE_AFX.list.asOfPattern.exec(html);
  const ts = m?.[1] ? new Date(m[1]) : null;
  const base = ts && !Number.isNaN(ts.getTime()) ? ts : fetchedAt;
  return { day: lastWeekdayOnOrBefore(hararePartsOf(base).iso), fromPage: base === ts };
}

/** AFX list page: one row per ZSE counter -> Quote (ticker as `<SYMBOL>.ZW`). */
export function parseAfxList(html: string, url: string, fetchedAt: Date): ParseResult<Quote> {
  const cfg = ZSE_AFX.list;
  const table = findTable(extractTables(html), [cfg.columns.ticker!, cfg.columns.price!]);
  if (!table) throw new LayoutChangedError('ZSE_AFX list: no table with ticker and price columns (layout changed?)');
  const iT = columnIndex(table.headers, cfg.columns.ticker!);
  const iP = columnIndex(table.headers, cfg.columns.price!);
  const iV = columnIndex(table.headers, cfg.columns.volume!);
  if (iT < 0 || iP < 0) throw new LayoutChangedError('ZSE_AFX list: ticker or price column missing');
  const { day } = pageTradingDay(html, fetchedAt);
  const items: Quote[] = [];
  const problems: ParseProblem[] = [];
  for (const row of table.rows) {
    const symbol = (row.cells[iT] ?? '').toUpperCase();
    const raw = row.cells[iP] ?? '';
    const rawHash = sha256(row.html);
    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
      problems.push({ message: `Unrecognised ticker cell "${symbol.slice(0, 20)}"`, rawHash, rawValue: raw });
      continue;
    }
    const price = parseNumber(raw);
    if (price === null) {
      problems.push({ ticker: `${symbol}${ZSE_AFX.tickerSuffix}`, message: `Price cell is not numeric: "${raw.slice(0, 30)}"`, rawHash, rawValue: raw });
      continue;
    }
    const volume = iV >= 0 ? parseNumber(row.cells[iV] ?? '') : null;
    items.push({
      ticker: `${symbol}${ZSE_AFX.tickerSuffix}`,
      price,
      priceDate: day,
      currency: ZSE_AFX.currency,
      volume,
      rawValue: raw,
      source: ZSE_AFX.code,
      url,
      fetchedAt,
      rawHash,
    });
  }
  if (!items.length) throw new LayoutChangedError('ZSE_AFX list: table found but no valid rows (layout changed?)');
  return { items, problems };
}

/** AFX per-counter page: the `data-hist` table of daily closes, newest first. */
export function parseAfxHistory(html: string, url: string, fetchedAt: Date, ticker: string): ParseResult<HistoryPoint> {
  const cfg = ZSE_AFX.history;
  const table = findTable(extractTables(html), [cfg.columns.date!, cfg.columns.close!], cfg.tableAttr);
  if (!table) throw new LayoutChangedError('ZSE_AFX history: data-hist table not found (layout changed?)');
  const iD = columnIndex(table.headers, cfg.columns.date!);
  const iC = columnIndex(table.headers, cfg.columns.close!);
  const iV = columnIndex(table.headers, cfg.columns.volume!);
  if (iD < 0 || iC < 0) throw new LayoutChangedError('ZSE_AFX history: date or close column missing');
  const items: HistoryPoint[] = [];
  const problems: ParseProblem[] = [];
  for (const row of table.rows) {
    const date = row.cells[iD] ?? '';
    const rawHash = sha256(row.html);
    const close = parseNumber(row.cells[iC] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null) {
      problems.push({ ticker, message: `Unreadable history row (${date.slice(0, 12)} / ${(row.cells[iC] ?? '').slice(0, 20)})`, rawHash, rawValue: row.cells[iC] });
      continue;
    }
    items.push({ ticker, priceDate: date, close, volume: iV >= 0 ? parseNumber(row.cells[iV] ?? '') : null, source: ZSE_AFX.code, url, fetchedAt, rawHash });
  }
  if (!items.length) throw new LayoutChangedError('ZSE_AFX history: no valid rows');
  return { items, problems };
}

/** open.er-api.com USD-base JSON -> requested pairs as cross rates through USD. */
export function parseErApi(json: string, url: string, fetchedAt: Date, pairs: { from: string; to: string }[]): ParseResult<FxQuote> {
  let body: { result?: string; time_last_update_unix?: number; base_code?: string; rates?: Record<string, unknown> };
  try {
    body = JSON.parse(json);
  } catch {
    throw new LayoutChangedError('ER_API: response is not JSON');
  }
  if (body.result !== 'success' || !body.rates || body.base_code !== ER_API.baseCurrency || typeof body.time_last_update_unix !== 'number') {
    throw new LayoutChangedError('ER_API: unexpected response shape');
  }
  const rateDate = new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10);
  const items: FxQuote[] = [];
  const problems: ParseProblem[] = [];
  const rate = (ccy: string) => (typeof body.rates![ccy] === 'number' ? (body.rates![ccy] as number) : null);
  for (const p of pairs) {
    const a = rate(p.from);
    const b = rate(p.to);
    const label = `${p.from}/${p.to}`;
    if (a === null || b === null || a <= 0 || b <= 0) {
      problems.push({ ticker: label, message: `No rate for ${a === null || a <= 0 ? p.from : p.to}` });
      continue;
    }
    const plain = (b / a).toFixed(10).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    items.push({
      from: p.from,
      to: p.to,
      rate: plain,
      rateDate,
      rawValue: `${p.from}=${a};${p.to}=${b}`,
      source: ER_API.code,
      url,
      fetchedAt,
      rawHash: sha256(`${label}|${a}|${b}|${body.time_last_update_unix}`),
    });
  }
  return { items, problems };
}
