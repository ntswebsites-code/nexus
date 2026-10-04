import { inflateRawSync } from 'node:zlib';
import type { Response } from 'express';
import { HttpError } from './errors';
import { workbook } from './xlsx';

/**
 * Tabular files for the import and export framework (S3). No spreadsheet library: CSV is parsed here, XLSX is read with
 * node:zlib (a workbook is a ZIP of XML parts) and written by `lib/xlsx.ts`. JSON (an array of flat objects) is accepted
 * for imports so one validator serves every format. Every parser returns the same `{ headers, rows }` shape.
 */
export type TabularFormat = 'csv' | 'xlsx' | 'json';

export interface Table {
  format: TabularFormat;
  headers: string[];
  /** Data rows, cell text trimmed; a row's index + 2 is its line number in the source (header = line 1). */
  rows: string[][];
}

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_COLS = 60;
const MAX_INFLATED = 32 * 1024 * 1024;

export function detectFormat(filename: string, mime?: string | null, head?: Buffer): TabularFormat {
  const name = filename.toLowerCase();
  if (name.endsWith('.xlsx') || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (name.endsWith('.json') || mime === 'application/json') return 'json';
  if (head && head.length >= 4 && head.readUInt32LE(0) === 0x04034b50) return 'xlsx';
  return 'csv';
}

// ---------------------------------------------------------------- CSV

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF, a UTF-8 BOM, and a `,` `;` or tab delimiter. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '') || touched) out.push(row);
    row = [];
    touched = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      touched = true;
    } else if (ch === delim) {
      touched = true;
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (quoted) throw HttpError.badRequest('The file has an unterminated quoted field');
  if (cell !== '' || row.length) endRow();
  return out.filter((r) => r.some((c) => c !== ''));
}

// ---------------------------------------------------------------- XLSX (read)

interface ZipEntry {
  name: string;
  method: number;
  csize: number;
  size: number;
  offset: number;
}

function zipEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw HttpError.badRequest('The file is not a valid XLSX workbook');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw HttpError.badRequest('The file is not a valid XLSX workbook');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    out.push({
      name: buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf: Buffer, e: ZipEntry): string {
  if (e.size > MAX_INFLATED) throw HttpError.badRequest('The workbook is too large to import');
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw.toString('utf8');
  if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_INFLATED }).toString('utf8');
  throw HttpError.badRequest('The workbook uses an unsupported compression method');
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1]!)).join('');

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** First worksheet of an XLSX file as rows of text (shared and inline strings, numbers, booleans). */
export function parseXlsx(buf: Buffer): string[][] {
  const entries = zipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const shared: string[] = [];
  const ss = byName.get('xl/sharedStrings.xml');
  if (ss) for (const m of zipRead(buf, ss).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = byName.get('xl/workbook.xml');
  const rels = byName.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(zipRead(buf, wb))?.[1];
    if (rid) {
      for (const m of zipRead(buf, rels).matchAll(/<Relationship\b[^>]*>/g)) {
        if (new RegExp(`\\bId="${rid}"`).test(m[0])) {
          const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
          if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        }
      }
    }
  }
  const sheet = byName.get(sheetPath) ?? entries.filter((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!sheet) throw HttpError.badRequest('The workbook has no worksheet');
  const xml = zipRead(buf, sheet);
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '';
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (t === 's') value = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') value = textOf(body);
      else if (t === 'b') value = v === '1' ? 'true' : 'false';
      else if (v !== undefined) value = unxml(v);
      const idx = ref ? colIndex(ref) : cells.length;
      if (idx >= MAX_IMPORT_COLS) continue;
      while (cells.length < idx) cells.push('');
      cells[idx] = value.trim();
    }
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------- entry point

/** Parses an uploaded CSV, XLSX or JSON file into headers and data rows. Bad files are 400s with a plain message. */
export function parseTabular(data: Buffer, filename: string, mime?: string | null): Table {
  if (!data.length) throw HttpError.badRequest('The file is empty');
  const format = detectFormat(filename, mime, data);
  let grid: string[][];
  if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString('utf8').replace(/^﻿/, ''));
    } catch {
      throw HttpError.badRequest('The file is not valid JSON');
    }
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.values(parsed as Record<string, unknown>).find(Array.isArray) : null;
    if (!Array.isArray(list) || !list.length) throw HttpError.badRequest('JSON files must hold an array of records');
    const keys: string[] = [];
    for (const r of list) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw HttpError.badRequest('JSON records must be flat objects');
      for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    }
    grid = [keys, ...list.map((r) => keys.map((k) => { const v = (r as Record<string, unknown>)[k]; return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).trim(); }))];
  } else if (format === 'xlsx') {
    try {
      grid = parseXlsx(data);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw HttpError.badRequest('The file could not be read as an XLSX workbook');
    }
  } else {
    grid = parseCsv(data.toString('utf8'));
  }
  if (grid.length < 1) throw HttpError.badRequest('The file has no header row');
  const headers = grid[0]!.map((h) => h.trim());
  if (headers.length > MAX_IMPORT_COLS) throw HttpError.badRequest(`The file has more than ${MAX_IMPORT_COLS} columns`);
  const rows = grid.slice(1);
  if (rows.length > MAX_IMPORT_ROWS) throw HttpError.badRequest(`The file has more than ${MAX_IMPORT_ROWS} rows; split it`);
  return { format, headers, rows };
}

// ---------------------------------------------------------------- export

/** A cell that would be read as a formula by a spreadsheet is prefixed so it stays text. */
export const safeCell = (v: unknown) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t;
};
const csvCell = (v: unknown) => `"${safeCell(v).replace(/"/g, '""')}"`;

export function toCsv(head: string[], rows: unknown[][]): string {
  return [head.map((h) => csvCell(h)).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export type ExportFormat = 'csv' | 'xlsx';

/** Sends a table as a CSV or XLSX download. XLSX cells are inline strings, so formulas never execute. */
export function sendTable(res: Response, format: ExportFormat, name: string, head: string[], rows: unknown[][], sheet = name) {
  const file = name.replace(/[^\w.-]+/g, '-');
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file}.xlsx"`);
    res.send(workbook(sheet, [head, ...rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))))]));
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}.csv"`);
  res.send('﻿' + toCsv(head, rows));
}
