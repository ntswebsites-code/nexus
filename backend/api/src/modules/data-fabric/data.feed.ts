/**
 * File-feed ingestion engine (pure parts). A FILE_FEED source carries a column contract (`schemaSpec`); an uploaded CSV is
 * parsed, every row is typed and validated against the contract, accepted rows are staged and refused rows are kept with
 * the reason. Quality rules for a feed (`feed:<source key>` datasets) are evaluated over the staged rows here.
 */
import { COMPARE_OPS, EXCEPTION_LIMIT, ageDays, type ColType } from './data.engine';

export interface FeedColumn {
  name: string;
  type: ColType;
  required: boolean;
  unique?: boolean;
}
export interface FeedSchema {
  columns: FeedColumn[];
  keyColumn: string;
}
export const MAX_FEED_ROWS = 100_000;
export const MAX_REJECTED_STORED = 1000;
const NAME = /^[a-z][a-z0-9_]{0,39}$/;

export function validateSchema(spec: unknown): { path: string; message: string }[] {
  const errs: { path: string; message: string }[] = [];
  const s = spec as Partial<FeedSchema> | null;
  if (!s || !Array.isArray(s.columns) || s.columns.length === 0) return [{ path: 'columns', message: 'Define at least one column' }];
  if (s.columns.length > 40) errs.push({ path: 'columns', message: 'At most 40 columns' });
  const seen = new Set<string>();
  s.columns.forEach((c, i) => {
    if (!c || typeof c.name !== 'string' || !NAME.test(c.name)) errs.push({ path: `columns.${i}.name`, message: 'Use lower case letters, digits and _, starting with a letter (max 40)' });
    else if (seen.has(c.name)) errs.push({ path: `columns.${i}.name`, message: `Duplicate column ${c.name}` });
    else seen.add(c.name);
    if (!c || !['text', 'num', 'date'].includes(c.type)) errs.push({ path: `columns.${i}.type`, message: 'Type must be text, num or date' });
  });
  if (!s.keyColumn || !seen.has(s.keyColumn)) errs.push({ path: 'keyColumn', message: 'The key column must be one of the columns' });
  return errs;
}

export const feedCols = (spec: FeedSchema): Record<string, ColType> => Object.fromEntries(spec.columns.map((c) => [c.name, c.type]));

/** RFC 4180 style CSV parser (quotes, doubled quotes, CRLF). Returns rows of raw strings; blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

export interface StagedRow {
  rowNo: number;
  key: string;
  data: Record<string, string | number | null>;
}
export interface RejectedRow {
  rowNo: number;
  reason: string;
  raw: string;
}
export interface FeedResult {
  accepted: StagedRow[];
  rejected: RejectedRow[];
  rowsRead: number;
  headerError?: string;
  latestRecordAt: Date | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function typed(v: string, c: FeedColumn): { ok: true; value: string | number | null } | { ok: false; reason: string } {
  const t = v.trim();
  if (t === '') return c.required ? { ok: false, reason: `${c.name} is required` } : { ok: true, value: null };
  if (c.type === 'num') {
    const n = Number(t.replace(/,/g, ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: `${c.name} "${t.slice(0, 30)}" is not a number` };
  }
  if (c.type === 'date') {
    const d = t.length >= 10 ? t.slice(0, 10) : t;
    return ISO_DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? { ok: true, value: d } : { ok: false, reason: `${c.name} "${t.slice(0, 30)}" is not a date (use YYYY-MM-DD)` };
  }
  return { ok: true, value: t.slice(0, 500) };
}

/** Parses and validates a CSV against the contract. Header names are matched case-insensitively; extra columns are ignored. */
export function ingestCsv(text: string, spec: FeedSchema): FeedResult {
  const rows = parseCsv(text);
  const empty = { accepted: [], rejected: [], rowsRead: 0, latestRecordAt: null };
  if (!rows.length) return { ...empty, headerError: 'The file is empty' };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    if (!idx.has(h)) idx.set(h, i);
  });
  const missing = spec.columns.filter((c) => !idx.has(c.name)).map((c) => c.name);
  if (missing.length) return { ...empty, headerError: `Missing column(s): ${missing.join(', ')}` };
  const body = rows.slice(1);
  if (body.length > MAX_FEED_ROWS) return { ...empty, rowsRead: body.length, headerError: `The file has ${body.length} rows; the limit is ${MAX_FEED_ROWS}` };
  const accepted: StagedRow[] = [];
  const rejected: RejectedRow[] = [];
  const seenKeys = new Set<string>();
  const uniq = spec.columns.filter((c) => c.unique && c.name !== spec.keyColumn);
  const seenUniq = new Map<string, Set<string>>(uniq.map((c) => [c.name, new Set()]));
  let latest: string | null = null;
  const dateCol = spec.columns.find((c) => c.type === 'date');
  body.forEach((raw, n) => {
    const rowNo = n + 2;
    const data: Record<string, string | number | null> = {};
    let reason: string | null = null;
    for (const c of spec.columns) {
      const r = typed(raw[idx.get(c.name)!] ?? '', c);
      if (!r.ok) {
        reason = r.reason;
        break;
      }
      data[c.name] = r.value;
    }
    if (!reason) {
      const key = String(data[spec.keyColumn] ?? '');
      if (!key) reason = `Key column ${spec.keyColumn} is empty`;
      else if (seenKeys.has(key)) reason = `Duplicate key ${key.slice(0, 40)} in this file`;
      else {
        for (const c of uniq) {
          const v = data[c.name];
          if (v === null || v === undefined) continue;
          const set = seenUniq.get(c.name)!;
          if (set.has(String(v))) {
            reason = `Duplicate ${c.name} ${String(v).slice(0, 40)}`;
            break;
          }
        }
      }
      if (!reason) {
        seenKeys.add(key);
        for (const c of uniq) if (data[c.name] !== null) seenUniq.get(c.name)!.add(String(data[c.name]));
        accepted.push({ rowNo, key: key.slice(0, 80), data });
        if (dateCol && typeof data[dateCol.name] === 'string' && (!latest || (data[dateCol.name] as string) > latest)) latest = data[dateCol.name] as string;
        return;
      }
    }
    rejected.push({ rowNo, reason: reason!.slice(0, 300), raw: raw.join(',').slice(0, 1000) });
  });
  return { accepted, rejected, rowsRead: body.length, latestRecordAt: latest ? new Date(`${latest}T00:00:00.000Z`) : null };
}

// ---------------------------------------------------------------- rules over staged rows

export interface FeedRecord {
  key: string;
  data: Record<string, unknown>;
}
export interface FeedRuleOutcome {
  rowsChecked: number;
  failures: number;
  found: { k: string; d: string }[];
}
export interface FeedRuleSpec {
  checkType: string;
  col: string;
  params: unknown;
}

const isNull = (v: unknown) => v === null || v === undefined || v === '';

/** `refValues` is required for CROSS_TABLE (the distinct values of the reference column). */
export function evalFeedRule(rule: FeedRuleSpec, rows: FeedRecord[], types: Record<string, ColType>, refValues: Set<string> | null, now = new Date()): FeedRuleOutcome {
  const p = (rule.params ?? {}) as Record<string, unknown>;
  const found: { k: string; d: string }[] = [];
  let failures = 0;
  const fail = (k: string, d: string) => {
    failures++;
    if (found.length < EXCEPTION_LIMIT) found.push({ k: k.slice(0, 80), d: d.slice(0, 300) });
  };
  switch (rule.checkType) {
    case 'NOT_NULL':
      for (const r of rows) if (isNull(r.data[rule.col])) fail(r.key, `Missing ${rule.col}`);
      break;
    case 'UNIQUE': {
      const groups = new Map<string, number>();
      for (const r of rows) if (!isNull(r.data[rule.col])) groups.set(String(r.data[rule.col]), (groups.get(String(r.data[rule.col])) ?? 0) + 1);
      for (const [v, n] of groups) if (n > 1) fail(v, `Value appears ${n} times`);
      break;
    }
    case 'COMPOSITE_UQ': {
      const cols = rule.col.split(',').map((c) => c.trim());
      const groups = new Map<string, number>();
      for (const r of rows) {
        if (cols.some((c) => isNull(r.data[c]))) continue;
        const k = cols.map((c) => String(r.data[c])).join(' | ');
        groups.set(k, (groups.get(k) ?? 0) + 1);
      }
      for (const [v, n] of groups) if (n > 1) fail(v, `Combination appears ${n} times`);
      break;
    }
    case 'RANGE': {
      const min = isNull(p.min) ? null : Number(p.min);
      const max = isNull(p.max) ? null : Number(p.max);
      for (const r of rows) {
        const v = r.data[rule.col];
        if (isNull(v)) continue;
        const n = Number(v);
        if ((min !== null && n < min) || (max !== null && n > max)) fail(r.key, `${rule.col} = ${n} outside ${min ?? '-inf'}..${max ?? 'inf'}`);
      }
      break;
    }
    case 'FRESHNESS': {
      let latest: string | null = null;
      for (const r of rows) {
        const v = r.data[rule.col];
        if (typeof v === 'string' && (!latest || v > latest)) latest = v;
      }
      const age = latest ? ageDays(new Date(`${latest}T00:00:00Z`), now) : null;
      const limit = Number(p.maxAgeDays);
      if (age === null || age > limit) fail('feed', age === null ? `No ${rule.col} values at all` : `Newest ${rule.col} is ${age} days old (limit ${limit})`);
      break;
    }
    case 'CROSS_TABLE':
      if (!refValues) throw new Error('Reference values were not loaded');
      for (const r of rows) {
        const v = r.data[rule.col];
        if (!isNull(v) && !refValues.has(String(v))) fail(r.key, `${rule.col} ${String(v)} not found in ${String(p.refDataset)}.${String(p.refCol)}`);
      }
      break;
    case 'COL_COMPARE': {
      const other = String(p.other);
      const isDate = types[rule.col] === 'date';
      for (const r of rows) {
        const a = r.data[rule.col];
        const b = r.data[other];
        if (isNull(a) || isNull(b)) continue;
        const x = isDate ? String(a) : Number(a);
        const y = isDate ? String(b) : Number(b);
        const ok = { lt: x < y, lte: x <= y, gt: x > y, gte: x >= y, eq: x === y, ne: x !== y }[String(p.op) as keyof typeof COMPARE_OPS];
        if (!ok) fail(r.key, `${rule.col} = ${String(a)} is not ${String(p.op)} ${other} = ${String(b)}`);
      }
      break;
    }
    default:
      throw new Error(`Check type ${rule.checkType} is not supported for file feeds (ORPHAN needs a registry table)`);
  }
  return { rowsChecked: rows.length, failures, found };
}
