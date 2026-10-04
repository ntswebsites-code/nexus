import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { sha256Hex } from '../../lib/crypto';
import { readFileObject, storeFile } from '../../lib/storage';
import { MAX_IMPORT_ROWS, parseTabular, safeCell, type Table } from '../../lib/tabular';
import { audit, seqRef } from '../ops/ops.common';

/**
 * The shared import service (build-plan S3). Every import kind goes through the same steps:
 *
 *   1. PREVIEW (the dry run): the file is parsed (CSV, XLSX or JSON), headers are mapped to the kind's columns, every
 *      row is validated against live data, and control totals are checked. Nothing but the batch record, the stored
 *      file and an audit event is written. The result lists every row error with its line number.
 *   2. COMMIT: the stored file is read again and re-validated against the data as it is now (a preview can go stale),
 *      then the valid rows are applied in one transaction. A file with row errors needs `skipInvalid`; a file with a
 *      file-level failure (missing column, control-total mismatch) can never be committed. One batch commits once,
 *      and a file already committed for the same kind is refused unless the caller allows the duplicate.
 */

export interface ColumnSpec {
  key: string;
  label: string;
  required?: boolean;
  /** Extra header spellings accepted (compared after lower-casing and dropping non-alphanumerics). */
  aliases?: string[];
  example?: string;
  hint?: string;
}

export interface MappedRow {
  line: number;
  cells: Record<string, string>;
}

export interface RowIssue {
  line: number;
  field?: string;
  message: string;
}

export interface ValidRow<T> {
  line: number;
  value: T;
  /** What the preview screen shows for this row. */
  display: Record<string, string>;
  warnings?: string[];
}

export interface ImportCtx {
  req: Request;
  userId: string;
  fields: Record<string, string>;
}

export interface Validation<T> {
  valid: ValidRow<T>[];
  errors: RowIssue[];
  /** Failures that make the whole file unusable (control totals, duplicate keys across the file). */
  fileErrors: string[];
  warnings: string[];
}

export interface ImportKind<T = unknown> {
  kind: string;
  title: string;
  /** Every listed permission is required to preview and to commit. */
  permissions: string[];
  /** Commit needs a fresh step-up confirmation (sensitive writes). */
  stepUp?: boolean;
  columns: ColumnSpec[];
  /** Column summed for the control total; when set the file must carry a count and a total. */
  controlTotalKey?: string;
  controlRequired?: boolean;
  /** Extra form fields the kind reads (documented for the screen). */
  fields?: { key: string; label: string; hint?: string }[];
  validate(rows: MappedRow[], ctx: ImportCtx): Promise<Validation<T>>;
  apply(tx: Prisma.TransactionClient, rows: ValidRow<T>[], ctx: ImportCtx, batch: { id: string; ref: string }): Promise<Record<string, unknown>>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------- cell parsers shared by the kinds

export const D = Prisma.Decimal;

/** Decimal text: optional thousands separators and a leading currency-free sign are tolerated. */
export function parseDecimal(raw: string | undefined, o: { scale?: number; positive?: boolean; nonNegative?: boolean; max?: string } = {}): { ok: true; value: Prisma.Decimal } | { ok: false; message: string } {
  const t = (raw ?? '').replace(/[\s,]/g, '');
  if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t)) return { ok: false, message: 'must be a number' };
  const v = new D(t);
  if (o.scale !== undefined && v.decimalPlaces() > o.scale) return { ok: false, message: `has more than ${o.scale} decimal places` };
  if (o.positive && !v.gt(0)) return { ok: false, message: 'must be greater than zero' };
  if (o.nonNegative && v.lt(0)) return { ok: false, message: 'must not be negative' };
  if (o.max && v.abs().gt(o.max)) return { ok: false, message: 'is too large' };
  return { ok: true, value: v };
}

/** ISO date (YYYY-MM-DD or YYYY/MM/DD) or an Excel date serial. Returns the ISO day. */
export function parseDay(raw: string | undefined): { ok: true; value: string } | { ok: false; message: string } {
  const t = (raw ?? '').trim();
  let iso: string | null = null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(t)) iso = t.replace(/\//g, '-');
  else if (/^\d{4}-\d{2}-\d{2}T/.test(t)) iso = t.slice(0, 10);
  else if (/^\d{5}(\.\d+)?$/.test(t)) iso = new Date(Math.round((Number(t) - 25569) * 86_400_000)).toISOString().slice(0, 10);
  if (!iso) return { ok: false, message: 'must be a date as YYYY-MM-DD' };
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { ok: false, message: 'is not a real date' };
  return { ok: true, value: iso };
}

export const toDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Collects row problems while a validator walks a row's fields. */
export class RowCheck {
  readonly issues: RowIssue[] = [];
  constructor(readonly line: number) {}
  fail(field: string, message: string) {
    this.issues.push({ line: this.line, field, message });
  }
  get ok() {
    return this.issues.length === 0;
  }
}

// ---------------------------------------------------------------- header mapping

interface Mapped {
  rows: MappedRow[];
  fileErrors: string[];
  warnings: string[];
  controlSupplied: { count: number | null; total: string | null } | null;
}

function mapRows(spec: ImportKind<never>, table: Table): Mapped {
  const fileErrors: string[] = [];
  const warnings: string[] = [];
  const byName = new Map<string, string>();
  for (const c of spec.columns) {
    byName.set(norm(c.key), c.key);
    byName.set(norm(c.label), c.key);
    for (const a of c.aliases ?? []) byName.set(norm(a), c.key);
  }
  const colOf: (string | null)[] = [];
  const seen = new Set<string>();
  for (const h of table.headers) {
    const key = byName.get(norm(h)) ?? null;
    if (key && seen.has(key)) fileErrors.push(`Column "${h}" appears twice`);
    if (key) seen.add(key);
    else if (h) warnings.push(`Column "${h}" is not used and was ignored`);
    colOf.push(key);
  }
  for (const c of spec.columns) if (c.required && !seen.has(c.key)) fileErrors.push(`Required column "${c.label}" is missing`);

  let controlSupplied: Mapped['controlSupplied'] = null;
  const rows: MappedRow[] = [];
  table.rows.forEach((cells, i) => {
    const line = i + 2;
    const first = (cells[0] ?? '').trim().toLowerCase();
    // Trailer row: "#CONTROL,<count>,<total>" carries the control totals inside the file.
    if (first === '#control' || first === '#total' || first === 'control totals') {
      controlSupplied = { count: /^\d+$/.test(cells[1] ?? '') ? Number(cells[1]) : null, total: (cells[2] ?? '').replace(/[\s,]/g, '') || null };
      return;
    }
    const out: Record<string, string> = {};
    cells.forEach((v, c) => {
      const key = colOf[c];
      if (key) out[key] = v;
    });
    if (Object.values(out).every((v) => !v)) return;
    rows.push({ line, cells: out });
  });
  return { rows, fileErrors, warnings, controlSupplied };
}

// ---------------------------------------------------------------- run

interface RunResult<T> {
  table: Table;
  mapped: Mapped;
  validation: Validation<T>;
  control: { suppliedCount: number | null; suppliedTotal: string | null; computedCount: number; computedTotal: string | null; match: boolean | null } | null;
  fileErrors: string[];
}

async function run<T>(spec: ImportKind<T>, data: Buffer, filename: string, mime: string | null, ctx: ImportCtx): Promise<RunResult<T>> {
  const table = parseTabular(data, filename, mime);
  const mapped = mapRows(spec as ImportKind<never>, table);
  const fileErrors = [...mapped.fileErrors];
  if (table.rows.length > MAX_IMPORT_ROWS) fileErrors.push(`More than ${MAX_IMPORT_ROWS} rows`);
  let validation: Validation<T> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  if (!mapped.fileErrors.length) {
    if (!mapped.rows.length) fileErrors.push('The file has no data rows');
    else validation = await spec.validate(mapped.rows, ctx);
  }
  fileErrors.push(...validation.fileErrors);

  let control: RunResult<T>['control'] = null;
  if (spec.controlTotalKey) {
    let total = new D(0);
    for (const r of mapped.rows) {
      const p = parseDecimal(r.cells[spec.controlTotalKey]);
      if (p.ok) total = total.add(p.value);
    }
    const supplied = mapped.controlSupplied ?? {
      count: /^\d+$/.test(ctx.fields.controlCount ?? '') ? Number(ctx.fields.controlCount) : null,
      total: ctx.fields.controlTotal ? ctx.fields.controlTotal.replace(/[\s,]/g, '') : null,
    };
    const have = supplied.count !== null || supplied.total !== null;
    control = {
      suppliedCount: supplied.count,
      suppliedTotal: supplied.total,
      computedCount: mapped.rows.length,
      computedTotal: total.toFixed(4),
      match: have ? (supplied.count === null || supplied.count === mapped.rows.length) && (supplied.total === null || /^-?\d+(\.\d+)?$/.test(supplied.total) && new D(supplied.total).eq(total)) : null,
    };
    if (!have && spec.controlRequired) fileErrors.push('Control totals are required: supply the record count and the total, or add a "#CONTROL,count,total" last row');
    if (have && control.match === false) {
      fileErrors.push(`Control totals do not match the file: supplied ${supplied.count ?? '-'} rows and ${supplied.total ?? '-'}, the file has ${mapped.rows.length} rows totalling ${total.toFixed(2)}`);
    }
    if (have && supplied.count !== null && supplied.total === null && spec.controlRequired) fileErrors.push('The control total amount is required as well as the record count');
    if (have && supplied.total !== null && supplied.count === null && spec.controlRequired) fileErrors.push('The control record count is required as well as the total amount');
  }
  return { table, mapped, validation, control, fileErrors };
}

export interface BatchView {
  id: string;
  ref: string;
  kind: string;
  filename: string;
  format: string;
  status: string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  fileErrors: string[];
  warnings: string[];
  errors: RowIssue[];
  errorsTruncated: boolean;
  preview: { line: number; ok: boolean; values: Record<string, string>; errors: string[]; warnings: string[] }[];
  control: unknown;
  duplicateOf: { ref: string; committedAt: string | null } | null;
  canCommit: boolean;
  result: unknown;
  createdAt: string;
  committedAt: string | null;
}

interface Stored {
  fileErrors: string[];
  warnings: string[];
  errors: RowIssue[];
  errorsTruncated: boolean;
  preview: BatchView['preview'];
  duplicateOf: BatchView['duplicateOf'];
}

const MAX_ERRORS = 200;
const MAX_PREVIEW = 50;
const j = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const mimeOf = (format: string) => (format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : format === 'json' ? 'text/plain' : 'text/csv');

export function batchView(b: Prisma.ImportBatchGetPayload<object>): BatchView {
  const s = (b.errorsJson ?? {}) as unknown as Partial<Stored>;
  return {
    id: b.id,
    ref: b.ref,
    kind: b.kind,
    filename: b.filename,
    format: b.format,
    status: b.status,
    rowCount: b.rowCount,
    validCount: b.validCount,
    errorCount: b.errorCount,
    fileErrors: s.fileErrors ?? [],
    warnings: s.warnings ?? [],
    errors: s.errors ?? [],
    errorsTruncated: s.errorsTruncated ?? false,
    preview: (b.previewJson as unknown as BatchView['preview']) ?? [],
    control: b.controlJson ?? null,
    duplicateOf: s.duplicateOf ?? null,
    canCommit: b.status === 'PREVIEWED' && !(s.fileErrors ?? []).length && b.validCount > 0 && !s.duplicateOf,
    result: b.resultJson ?? null,
    createdAt: b.createdAt.toISOString(),
    committedAt: b.committedAt?.toISOString() ?? null,
  };
}

/** The dry run: validates the file and records the batch, the stored file and an audit event. Writes no domain data. */
export async function previewImport<T>(spec: ImportKind<T>, req: Request, file: { buffer: Buffer; originalname: string; mimetype: string }, fields: Record<string, string>): Promise<BatchView> {
  const ctx: ImportCtx = { req, userId: req.user!.id, fields };
  const filename = (file.originalname || `${spec.kind}.csv`).slice(0, 200);
  const r = await run(spec, file.buffer, filename, file.mimetype, ctx);
  const sha = sha256Hex(file.buffer);
  const dup = await prisma.importBatch.findFirst({ where: { kind: spec.kind, sha256: sha, status: 'COMMITTED' }, orderBy: { committedAt: 'desc' } });
  const rejected = r.fileErrors.length > 0;
  const errorLines = new Map<number, string[]>();
  for (const e of r.validation.errors) errorLines.set(e.line, [...(errorLines.get(e.line) ?? []), `${e.field ? `${e.field}: ` : ''}${e.message}`]);
  const validByLine = new Map(r.validation.valid.map((v) => [v.line, v]));
  const preview: BatchView['preview'] = r.mapped.rows.slice(0, MAX_PREVIEW).map((m) => {
    const v = validByLine.get(m.line);
    return { line: m.line, ok: !!v, values: v ? v.display : Object.fromEntries(Object.entries(m.cells).map(([k, x]) => [k, safeCell(x)])), errors: errorLines.get(m.line) ?? [], warnings: v?.warnings ?? [] };
  });
  const errorRows = new Set(r.validation.errors.map((e) => e.line)).size;
  const stored: Stored = {
    fileErrors: r.fileErrors,
    warnings: [...r.mapped.warnings, ...r.validation.warnings],
    errors: r.validation.errors.slice(0, MAX_ERRORS),
    errorsTruncated: r.validation.errors.length > MAX_ERRORS,
    preview,
    duplicateOf: dup ? { ref: dup.ref, committedAt: dup.committedAt?.toISOString() ?? null } : null,
  };
  const batch = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'importBatch', 'IMB-', 6, 1);
    const stored$ = await storeFile({ name: filename, mime: mimeOf(r.table.format), data: file.buffer, uploadedById: req.user!.id, bucket: 'exports' }, tx);
    const b = await tx.importBatch.create({
      data: {
        ref,
        kind: spec.kind,
        filename,
        format: r.table.format,
        sha256: sha,
        fileId: stored$.id,
        status: rejected ? 'REJECTED' : 'PREVIEWED',
        rowCount: r.mapped.rows.length,
        validCount: r.validation.valid.length,
        errorCount: errorRows,
        controlJson: j({ ...(r.control ?? {}), fields }),
        errorsJson: j(stored),
        previewJson: j(preview),
        createdBy: req.user!.id,
      },
    });
    await writeAudit(tx, audit(req), {
      action: rejected ? 'import.rejected' : 'import.previewed',
      objectType: 'import_batch',
      objectId: b.id,
      after: { ref, kind: spec.kind, filename, sha256: sha, rows: b.rowCount, valid: b.validCount, errorRows, fileErrors: r.fileErrors, control: r.control },
    });
    return b;
  });
  return batchView(batch);
}

export interface CommitOptions {
  skipInvalid?: boolean;
  allowDuplicate?: boolean;
}

/** Re-validates the stored file against current data and applies the valid rows in one transaction. */
export async function commitImport<T>(spec: ImportKind<T>, req: Request, batchId: string, opts: CommitOptions): Promise<BatchView> {
  const existing = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!existing || existing.kind !== spec.kind) throw HttpError.notFound('Import batch not found');
  if (existing.status === 'COMMITTED') throw HttpError.conflict(`${existing.ref} was already committed`, 'import_already_committed');
  if (existing.status === 'REJECTED') throw HttpError.conflict(`${existing.ref} was rejected at preview (${((existing.errorsJson as unknown as Stored | null)?.fileErrors ?? []).join('; ') || 'file-level failure'}) and cannot be committed. Fix the file and upload it again.`, 'import_rejected');
  if (!existing.fileId) throw HttpError.conflict('The uploaded file is no longer available; upload it again', 'import_file_missing');
  if (!opts.allowDuplicate) {
    const dup = await prisma.importBatch.findFirst({ where: { kind: spec.kind, sha256: existing.sha256, status: 'COMMITTED' } });
    if (dup) throw HttpError.conflict(`This exact file was already committed as ${dup.ref}. Confirm to import it again.`, 'duplicate_import');
  }
  const { file, data } = await readFileObject(existing.fileId);
  // The form fields typed at preview (as-of date, control figures ...) are kept with the batch so the re-run checks the same ones.
  const ctx: ImportCtx = { req, userId: req.user!.id, fields: (existing.controlJson as { fields?: Record<string, string> } | null)?.fields ?? {} };
  const r = await run(spec, data, file.name, file.mime, ctx);
  if (r.fileErrors.length) throw HttpError.conflict(`The file no longer passes: ${r.fileErrors.join('; ')}`, 'import_file_invalid');
  const errorRows = new Set(r.validation.errors.map((e) => e.line)).size;
  if (errorRows && !opts.skipInvalid) throw HttpError.conflict(`${errorRows} row(s) have errors. Fix the file, or commit only the valid rows.`, 'import_has_errors');
  if (!r.validation.valid.length) throw HttpError.conflict('There are no valid rows to import', 'import_empty');

  const batch = await prisma.$transaction(async (tx) => {
    // Claim the batch first: only one commit can win, so a double click or a retry never applies the file twice.
    const claimed = await tx.importBatch.updateMany({ where: { id: existing.id, status: 'PREVIEWED' }, data: { status: 'COMMITTED', committedBy: req.user!.id, committedAt: new Date() } });
    if (claimed.count !== 1) throw HttpError.conflict(`${existing.ref} was already committed`, 'import_already_committed');
    const result = await spec.apply(tx, r.validation.valid, ctx, { id: existing.id, ref: existing.ref });
    const skipped = errorRows;
    const b = await tx.importBatch.update({ where: { id: existing.id }, data: { validCount: r.validation.valid.length, errorCount: errorRows, resultJson: j({ ...result, applied: r.validation.valid.length, skippedRows: skipped }) } });
    await writeAudit(tx, audit(req), {
      action: 'import.committed',
      objectType: 'import_batch',
      objectId: b.id,
      after: { ref: b.ref, kind: spec.kind, sha256: b.sha256, applied: r.validation.valid.length, skippedRows: skipped, skipInvalid: !!opts.skipInvalid, duplicateConfirmed: !!opts.allowDuplicate, ...result },
    });
    return b;
  });
  return batchView(batch);
}

/** A CSV header-and-example file for a kind, so users start from the right columns. */
export function templateCsv(spec: ImportKind): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [spec.columns.map((c) => q(c.label)).join(','), spec.columns.map((c) => q(c.example ?? '')).join(',')];
  return lines.join('\r\n') + '\r\n';
}
