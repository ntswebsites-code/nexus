import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { enqueue } from '../../lib/outbox';
import { sha256Hex } from '../../lib/crypto';
import { readFileObject, storeFile } from '../../lib/storage';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { uploadFiles } from '../../middleware/upload';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, seqRef } from '../ops/ops.common';
import { accountRefs } from '../custodian/custodian.service';
import { CANDIDATE_KINDS, CAUSES, FAMILIES, FAMILY_LABEL, OPEN_STATUSES, scoreCandidate, type Family } from './recon.engine';
import { dayStart, isoDay, reconGate, resolveTolerances, signoffScopeKey, todayIso } from './recon.service';
import { recordCounterpartImport, newBatchRef, type ImportSource } from './recon.imports';
import { looksLikeMt535, parseMt535 } from './recon.swift';
import { getCustodianFeedAdapter } from '../../integrations/custodian-feed';
import { IntegrationNotConfiguredError } from '../../integrations/common';

/**
 * Reconciliation depth (GAP-006), mounted by `recon.routes.ts` under `/api/v1/recon`:
 *  - effective-dated tolerance configuration per family (BR-067),
 *  - custodian position and corporate-action feeds with a source-receipt registry (hash, version, stored original),
 *  - evidence files on breaks, queries to the source, escalations, explicit reopen (voids a covering sign-off),
 *  - the close gate read by NAV release and the runbook.
 * Same rules as the core file: `operations.view` reads, `recon.manage` works, `recon.signoff` (with step-up) configures
 * tolerances and reopens; every write audits in its transaction.
 */
export const reconExtRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('operations.view')];
const canManage = [...staff, requirePermission('operations.view', 'recon.manage')];
const canSignoff = [...staff, requirePermission('operations.view', 'recon.signoff')];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const familySchema = z.string().transform((v) => v.trim().toUpperCase().replace('-', '_')).pipe(z.enum(FAMILIES));
const id36 = z.string().trim().min(1).max(36);
const uuidLike = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const MAX_ROWS = 5000;
const MAX_EVIDENCE = 20;

function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw HttpError.badRequest('Validation failed', r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  return r.data;
}

async function userNames(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map<string, string>();
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}
async function counterpartyOf(v: string | null | undefined) {
  if (!v) return null;
  const c = await prisma.counterparty.findFirst({ where: uuidLike(v) ? { id: v } : { ref: v } });
  if (!c) throw HttpError.badRequest('Validation failed', [{ path: 'counterpartyId', message: 'Unknown counterparty' }]);
  return c;
}
async function activeStaff(userId: string, path: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, isActive: true, roles: { some: { role: { portal: 'admin' } } } }, select: { id: true } });
  if (!u) throw HttpError.badRequest('Validation failed', [{ path, message: 'Unknown, inactive or non-staff user' }]);
}
async function loadBreak(idOrRef: string) {
  const b = await prisma.reconBreak.findFirst({ where: uuidLike(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!b) throw HttpError.notFound('Break not found');
  return b;
}
type BreakRow = Awaited<ReturnType<typeof loadBreak>>;

async function transition(req: Request, b: BreakRow, to: string, opts: { action: string; note?: string | null; data?: Prisma.ReconBreakUncheckedUpdateManyInput; after?: object; detail?: Prisma.InputJsonValue; extra?: (tx: Prisma.TransactionClient) => Promise<void> }) {
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.reconBreak.updateMany({ where: { id: b.id, version: b.version, status: b.status }, data: { ...(opts.data ?? {}), status: to, version: { increment: 1 } } })).count);
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action: opts.action, fromStatus: b.status, toStatus: to, actorId: req.user!.id, note: opts.note ?? null, detail: opts.detail } });
    await writeAudit(tx, audit(req), {
      action: `recon.break_${opts.action}`,
      objectType: 'recon_break',
      objectId: b.id,
      before: { status: b.status, ref: b.ref },
      after: { status: to, ref: b.ref, family: b.family, severity: b.severity, ...(opts.after ?? {}) },
      reason: opts.note ?? null,
    });
    if (opts.extra) await opts.extra(tx);
  });
}
/** An event and audit entry that do not change the break's status. */
async function annotate(req: Request, b: BreakRow, action: string, note: string | null, after: object, extra?: (tx: Prisma.TransactionClient) => Promise<void>, detail?: Prisma.InputJsonValue) {
  await prisma.$transaction(async (tx) => {
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action, fromStatus: b.status, toStatus: b.status, actorId: req.user!.id, note, detail } });
    await writeAudit(tx, audit(req), { action: `recon.break_${action}`, objectType: 'recon_break', objectId: b.id, before: { status: b.status, ref: b.ref }, after: { ref: b.ref, family: b.family, ...after }, reason: note });
    if (extra) await extra(tx);
  });
}

const isOpen = (b: BreakRow) => (['NEW', 'ASSIGNED', 'INVESTIGATING'] as string[]).includes(b.status);
const isLive = (b: BreakRow) => isOpen(b) || b.status === 'PENDING_CHECKER';

// ================================================================ tolerances (BR-067)

const num = (max: number, dp: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^\\d+(\\.\\d{1,${dp}})?$`).test(v) && Number(v) <= max, `Enter a number from 0 to ${max}`);
const tolBody = z
  .object({
    family: familySchema,
    counterpartyId: id36.nullish(),
    effectiveFrom: dateStr,
    price: num(1000, 6).optional(),
    cash: num(1_000_000, 2).optional(),
    holdingsPct: num(100, 4).optional(),
    positionQty: num(1_000_000_000, 8).optional(),
    settleDays: z.coerce.number().int().min(0).max(30).optional(),
    caCash: num(1_000_000, 2).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => ['price', 'cash', 'holdingsPct', 'positionQty', 'settleDays', 'caCash'].some((k) => (b as Record<string, unknown>)[k] !== undefined), 'Set at least one tolerance value');

const tolView = (r: Prisma.ReconToleranceGetPayload<object>, names: Map<string, string>, cps: Map<string, string>, today: string) => ({
  id: r.id,
  family: r.family,
  familyLabel: FAMILY_LABEL[r.family as Family] ?? r.family,
  scope: r.scope,
  counterparty: r.counterpartyId ? { id: r.counterpartyId, name: cps.get(r.counterpartyId) ?? r.counterpartyId } : null,
  effectiveFrom: isoDay(r.effectiveFrom),
  status: isoDay(r.effectiveFrom) > today ? 'FUTURE' : 'ACTIVE_OR_SUPERSEDED',
  price: r.price?.toString() ?? null,
  cash: r.cash?.toString() ?? null,
  holdingsPct: r.holdingsPct?.toString() ?? null,
  positionQty: r.positionQty?.toString() ?? null,
  settleDays: r.settleDays,
  caCash: r.caCash?.toString() ?? null,
  note: r.note,
  createdBy: r.createdBy,
  createdByName: names.get(r.createdBy) ?? null,
  createdAt: iso(r.createdAt),
});

reconExtRoutes.get('/tolerances', ...canView, validateQuery(z.object({ family: familySchema.optional() })), async (req, res) => {
  const q = query<{ family?: Family }>(req);
  const rows = await prisma.reconTolerance.findMany({ where: q.family ? { family: q.family } : {}, orderBy: [{ family: 'asc' }, { effectiveFrom: 'desc' }], take: 500 });
  const names = await userNames(rows.map((r) => r.createdBy));
  const cpRows = await prisma.counterparty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.counterpartyId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const cps = new Map(cpRows.map((c) => [c.id, c.name]));
  const today = todayIso();
  res.json({ data: rows.map((r) => tolView(r, names, cps, today)) });
});

reconExtRoutes.get('/tolerances/effective', ...canView, validateQuery(z.object({ family: familySchema, asOf: dateStr.optional(), counterpartyId: z.string().optional() })), async (req, res) => {
  const q = query<{ family: Family; asOf?: string; counterpartyId?: string }>(req);
  const cp = await counterpartyOf(q.counterpartyId);
  const eff = await resolveTolerances(q.family, cp?.id ?? null, q.asOf ?? todayIso());
  res.json({ data: { family: q.family, asOfDate: q.asOf ?? todayIso(), counterpartyId: cp?.id ?? null, tolerances: eff.tolerances, sources: eff.sources } });
});

reconExtRoutes.post('/tolerances', ...canSignoff, requireStepUp, validateBody(tolBody), idempotent('recon.tolerance', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof tolBody>;
  if (b.effectiveFrom < todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'effectiveFrom', message: 'A tolerance change takes effect today or later; earlier runs keep the values they were run with' }]);
  const cp = await counterpartyOf(b.counterpartyId);
  const scope = cp?.id ?? '*';
  try {
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.reconTolerance.create({
        data: {
          family: b.family,
          scope,
          counterpartyId: cp?.id ?? null,
          effectiveFrom: dayStart(b.effectiveFrom),
          price: b.price ?? null,
          cash: b.cash ?? null,
          holdingsPct: b.holdingsPct ?? null,
          positionQty: b.positionQty ?? null,
          settleDays: b.settleDays ?? null,
          caCash: b.caCash ?? null,
          note: b.note ?? null,
          createdBy: req.user!.id,
        },
      });
      await writeAudit(tx, audit(req), {
        action: 'recon.tolerance_set',
        objectType: 'recon_tolerance',
        objectId: r.id,
        after: { family: b.family, scope: cp?.ref ?? '*', effectiveFrom: b.effectiveFrom, price: b.price ?? null, cash: b.cash ?? null, holdingsPct: b.holdingsPct ?? null, positionQty: b.positionQty ?? null, settleDays: b.settleDays ?? null, caCash: b.caCash ?? null },
        reason: b.note ?? null,
      });
      return r;
    });
    res.status(201).json({ data: tolView(row, new Map([[req.user!.id, req.user!.email]]), new Map(cp ? [[cp.id, cp.name]] : []), todayIso()) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw HttpError.conflict('A tolerance row already exists for this family, scope and date', 'tolerance_exists');
    throw err;
  }
});

reconExtRoutes.delete('/tolerances/:id', ...canSignoff, requireStepUp, async (req, res) => {
  const r = await prisma.reconTolerance.findUnique({ where: { id: param(req, 'id') } });
  if (!r) throw HttpError.notFound('Tolerance not found');
  if (isoDay(r.effectiveFrom) <= todayIso()) throw HttpError.conflict('Only a tolerance that has not taken effect yet can be withdrawn', 'tolerance_in_force');
  await prisma.$transaction(async (tx) => {
    await tx.reconTolerance.delete({ where: { id: r.id } });
    await writeAudit(tx, audit(req), { action: 'recon.tolerance_withdrawn', objectType: 'recon_tolerance', objectId: r.id, before: { family: r.family, scope: r.scope, effectiveFrom: isoDay(r.effectiveFrom) } });
  });
  res.json({ data: { id: r.id, deleted: true } });
});

// ================================================================ custodian feeds

/** Minimal CSV reader: quoted fields, commas, CRLF. Returns rows of trimmed cells; blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim());
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const posRow = z.object({ ticker: z.string().trim().min(1).max(32), isin: z.string().trim().max(12).nullish(), quantity: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d{1,8})?$/.test(v.trim()), 'Quantity must be a non-negative number') }).strict();
const caRow = z
  .object({
    ticker: z.string().trim().min(1).max(32),
    caType: z.string().trim().max(20).nullish(),
    exDate: dateStr,
    payDate: dateStr,
    quantity: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d{1,6})?$/.test(v.trim()), 'Quantity must be a non-negative number'),
    cashAmount: z.union([z.string(), z.number()]).transform(String).refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v.trim()), 'Cash amount must be a number'),
    currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
    externalRef: z.string().trim().max(64).nullish(),
  })
  .strict();
const feedHead = z.object({ counterpartyId: id36, accountRef: z.string().trim().min(1).max(64), asOfDate: dateStr, note: z.string().trim().max(500).optional() });

const csvToObjects = (text: string, cols: string[]): Record<string, string>[] => {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const first = rows[0]!.map((c) => c.toLowerCase().replace(/[\s-]+/g, '_'));
  const alias: Record<string, string> = { ticker: 'ticker', symbol: 'ticker', isin: 'isin', quantity: 'quantity', qty: 'quantity', ex_date: 'exDate', exdate: 'exDate', pay_date: 'payDate', paydate: 'payDate', cash_amount: 'cashAmount', cash: 'cashAmount', amount: 'cashAmount', currency: 'currency', type: 'caType', ca_type: 'caType', external_ref: 'externalRef', ref: 'externalRef' };
  const hasHeader = first.some((c) => alias[c] === 'ticker');
  const keys = hasHeader ? first.map((c) => alias[c] ?? c) : cols;
  return (hasHeader ? rows.slice(1) : rows).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
};

/** The feed's original bytes: the uploaded file, else a CSV rendering of the JSON rows. */
function feedBytes(req: Request, rows: Record<string, unknown>[], cols: string[]): { data: Buffer; name: string } {
  const f = req.file;
  if (f) return { data: f.buffer, name: f.originalname || 'feed.csv' };
  const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return { data: Buffer.from([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'), 'utf8'), name: 'feed.csv' };
}

async function guardFeed(familyKey: Family, date: string, cpId: string) {
  if (date > todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'asOfDate', message: 'The date cannot be in the future' }]);
  const signed = await prisma.reconSignoff.findFirst({ where: { family: familyKey, asOfDate: dayStart(date), counterpartyId: { in: [cpId] } } });
  const signedAll = await prisma.reconSignoff.findFirst({ where: { family: familyKey, asOfDate: dayStart(date), counterpartyId: null } });
  if (signed || signedAll) throw HttpError.conflict('This family and date is signed off; reopen a break (which voids the sign-off) before replacing the source', 'signed_off');
}

interface ReceiveOpts {
  feed: 'POSITIONS' | 'CORP_ACTIONS';
  family: Family;
  head: z.infer<typeof feedHead>;
  cpId: string;
  cpRef: string;
  rows: Record<string, unknown>[];
  cols: string[];
  write: (tx: Prisma.TransactionClient, batchRef: string) => Promise<void>;
  /** Channel (FR-REC-017): a staff upload or a connector pull; both run this same pipeline. */
  source?: ImportSource;
  connector?: string | null;
  format?: string;
  /** Original bytes when they are not the request's uploaded file. */
  bytes?: { data: Buffer; name: string; mime?: string };
}

/** The shared pipeline: store the original, load the rows, upsert the receipt, record the counterpart_imports batch, audit. */
async function receive(req: Request, opts: ReceiveOpts) {
  const bytes = opts.bytes ?? feedBytes(req, opts.rows, opts.cols);
  const source = opts.source ?? 'MANUAL';
  return prisma.$transaction(async (tx) => {
    const batchRef = await newBatchRef(tx);
    const file = await storeFile({ name: bytes.name, mime: opts.bytes?.mime ?? 'text/csv', data: bytes.data, uploadedById: req.user!.id }, tx);
    await opts.write(tx, batchRef);
    const where = { counterpartyId_accountRef_asOfDate_feed: { counterpartyId: opts.cpId, accountRef: opts.head.accountRef, asOfDate: dayStart(opts.head.asOfDate), feed: opts.feed } };
    const before = await tx.reconSourceReceipt.findUnique({ where });
    const receipt = await tx.reconSourceReceipt.upsert({
      where,
      update: { rowCount: opts.rows.length, sha256: file.sha256, fileId: file.id, version: { increment: 1 }, note: opts.head.note ?? null, receivedBy: req.user!.id, receivedAt: new Date() },
      create: { counterpartyId: opts.cpId, accountRef: opts.head.accountRef, asOfDate: dayStart(opts.head.asOfDate), feed: opts.feed, rowCount: opts.rows.length, sha256: file.sha256, fileId: file.id, note: opts.head.note ?? null, receivedBy: req.user!.id },
    });
    const batch = await recordCounterpartImport(tx, {
      ref: batchRef,
      source,
      connector: opts.connector ?? null,
      feed: opts.feed,
      counterpartyId: opts.cpId,
      accountRef: opts.head.accountRef,
      asOfDate: dayStart(opts.head.asOfDate),
      filename: bytes.name,
      format: opts.format ?? (req.file ? 'CSV' : 'JSON'),
      recordCount: opts.rows.length,
      sha256: file.sha256,
      fileId: file.id,
      receiptId: receipt.id,
      note: opts.head.note ?? null,
      createdBy: req.user!.id,
    });
    await writeAudit(tx, audit(req), {
      action: opts.feed === 'POSITIONS' ? 'recon.custody_positions_received' : 'recon.custody_ca_received',
      objectType: 'recon_source_receipt',
      objectId: receipt.id,
      before: before ? { rowCount: before.rowCount, sha256: before.sha256, version: before.version } : null,
      after: { counterparty: opts.cpRef, accountRef: opts.head.accountRef, asOfDate: opts.head.asOfDate, rows: opts.rows.length, sha256: file.sha256, version: receipt.version, batchRef, fileName: bytes.name, source, connector: opts.connector ?? null, importId: batch.id },
    });
    return { receipt, batchRef, replaced: !!before, importId: batch.id };
  });
}

const receiptView = (r: Prisma.ReconSourceReceiptGetPayload<object>, cp?: { ref: string; name: string }, who?: string) => ({
  id: r.id,
  counterparty: cp ? { id: r.counterpartyId, ref: cp.ref, name: cp.name } : { id: r.counterpartyId },
  accountRef: r.accountRef,
  asOfDate: isoDay(r.asOfDate),
  feed: r.feed,
  rowCount: r.rowCount,
  sha256: r.sha256,
  fileId: r.fileId,
  version: r.version,
  note: r.note,
  receivedByName: who ?? null,
  receivedAt: iso(r.receivedAt),
});

async function feedPrelude(req: Request, cols: string[], feed: 'POSITIONS' | 'CORP_ACTIONS' = 'POSITIONS') {
  const head = parseWith(feedHead, { counterpartyId: req.body?.counterpartyId, accountRef: req.body?.accountRef, asOfDate: req.body?.asOfDate, note: req.body?.note || undefined });
  const cp = await counterpartyOf(head.counterpartyId);
  const known = accountRefs(cp!.accounts);
  if (known.length && !known.includes(head.accountRef)) throw HttpError.badRequest('Validation failed', [{ path: 'accountRef', message: `Not one of ${cp!.name}'s accounts (${known.join(', ')})` }]);
  let raw: unknown[] = [];
  let format = 'CSV';
  const text = req.file ? req.file.buffer.toString('utf8') : typeof req.body?.csv === 'string' ? req.body.csv : typeof req.body?.content === 'string' ? req.body.content : null;
  if (text !== null && feed === 'POSITIONS' && looksLikeMt535(text)) {
    format = 'MT535';
    const mt = parseMt535(text);
    const problems = [...mt.errors];
    if (mt.accountRef && mt.accountRef !== head.accountRef) problems.push(`The statement is for safekeeping account ${mt.accountRef}, not ${head.accountRef}`);
    if (mt.asOfDate && mt.asOfDate !== head.asOfDate) problems.push(`The statement is dated ${mt.asOfDate}, not ${head.asOfDate}`);
    const missing = mt.rows.filter((r) => !r.ticker && r.isin);
    const secs = missing.length ? await prisma.security.findMany({ where: { isin: { in: missing.map((r) => r.isin!) } }, select: { isin: true, ticker: true } }) : [];
    const byIsin = new Map(secs.map((x) => [x.isin, x.ticker]));
    raw = mt.rows.map((r) => {
      const ticker = r.ticker ?? byIsin.get(r.isin!) ?? null;
      if (!ticker) problems.push(`ISIN ${r.isin} is not a known security and the statement gives no ticker`);
      return { ticker: ticker ?? '', isin: r.isin ?? null, quantity: r.quantity };
    });
    if (problems.length) throw HttpError.badRequest('The MT535 statement could not be read', problems.slice(0, 50).map((message) => ({ path: 'content', message })));
  } else if (text !== null && (req.file || typeof req.body?.csv === 'string' || typeof req.body?.content === 'string')) raw = csvToObjects(text, cols);
  else if (Array.isArray(req.body?.rows)) {
    raw = req.body.rows;
    format = 'JSON';
  } else throw HttpError.badRequest('Validation failed', [{ path: 'rows', message: 'Send a CSV or MT535 file, a csv string or a rows array' }]);
  if (raw.length > MAX_ROWS) throw HttpError.badRequest('Validation failed', [{ path: 'rows', message: `At most ${MAX_ROWS} rows per file` }]);
  return { head, cp: cp!, raw, format };
}

type PosInput = z.infer<typeof posRow>;
/** Validates a positions file (no duplicate security) and loads it through the shared receive pipeline. */
async function receivePositions(req: Request, o: { head: z.infer<typeof feedHead>; cp: { id: string; ref: string }; rows: PosInput[]; source: ImportSource; connector?: string | null; format: string; bytes?: ReceiveOpts['bytes'] }) {
  const seen = new Set<string>();
  for (const r of o.rows) {
    const k = r.ticker.trim().toUpperCase();
    if (seen.has(k)) throw HttpError.badRequest('Validation failed', [{ path: 'rows', message: `Duplicate security ${k} in the file` }]);
    seen.add(k);
  }
  await guardFeed('POSITIONS_VS_CUSTODY', o.head.asOfDate, o.cp.id);
  return receive(req, {
    feed: 'POSITIONS',
    family: 'POSITIONS_VS_CUSTODY',
    head: o.head,
    cpId: o.cp.id,
    cpRef: o.cp.ref,
    rows: o.rows as unknown as Record<string, unknown>[],
    cols: ['ticker', 'quantity', 'isin'],
    source: o.source,
    connector: o.connector ?? null,
    format: o.format,
    bytes: o.bytes,
    write: async (tx, batchRef) => {
      await tx.reconCustodyPosition.deleteMany({ where: { counterpartyId: o.cp.id, accountRef: o.head.accountRef, asOfDate: dayStart(o.head.asOfDate) } });
      if (o.rows.length) await tx.reconCustodyPosition.createMany({ data: o.rows.map((r) => ({ counterpartyId: o.cp.id, accountRef: o.head.accountRef, asOfDate: dayStart(o.head.asOfDate), ticker: r.ticker.trim().toUpperCase(), isin: r.isin?.trim() || null, quantity: r.quantity, batchRef, createdBy: req.user!.id })) });
    },
  });
}

reconExtRoutes.post('/custody-positions', ...canManage, uploadFiles('file'), idempotent('recon.feed.positions', { required: false }), async (req, res) => {
  const { head, cp, raw, format } = await feedPrelude(req, ['ticker', 'quantity', 'isin']);
  const rows = parseWith(z.array(posRow).max(MAX_ROWS), raw);
  const out = await receivePositions(req, { head, cp, rows, source: 'MANUAL', format });
  res.status(out.replaced ? 200 : 201).json({ data: receiptView(out.receipt, cp, req.user!.email), batchRef: out.batchRef, importId: out.importId, rows: rows.length, replaced: out.replaced });
});

/**
 * Connector route (FR-REC-017): pull the account's holdings for the date from the configured custodian-feed adapter
 * (file-drop, fake, or live which answers 503 until credentials exist) and load them through the same pipeline a manual
 * upload uses, so the batch carries source CONNECTOR with the adapter name.
 */
const connectorBody = z.object({ counterpartyId: id36, accountRef: z.string().trim().min(1).max(64), asOfDate: dateStr, note: z.string().trim().max(500).optional() }).strict();
reconExtRoutes.post('/connector-imports', ...canManage, validateBody(connectorBody), idempotent('recon.connector_import', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof connectorBody>;
  const cp = (await counterpartyOf(b.counterpartyId))!;
  const known = accountRefs(cp.accounts);
  if (known.length && !known.includes(b.accountRef)) throw HttpError.badRequest('Validation failed', [{ path: 'accountRef', message: `Not one of ${cp.name}'s accounts (${known.join(', ')})` }]);
  const head = { counterpartyId: cp.id, accountRef: b.accountRef, asOfDate: b.asOfDate, note: b.note };
  let holdings: { ticker: string; isin?: string | null; quantity: string }[];
  let connector: string;
  try {
    const adapter = getCustodianFeedAdapter();
    connector = adapter.name;
    const statements = await adapter.listStatements({ counterpartyId: cp.id, accountRef: b.accountRef, from: b.asOfDate, to: b.asOfDate, limit: 5 });
    const st = statements.find((x) => x.accountRef === b.accountRef && x.statementDate === b.asOfDate);
    if (!st) throw new HttpError(404, 'no_statement', `The ${connector} connector has no statement for ${b.accountRef} on ${b.asOfDate}`);
    holdings = await adapter.fetchHoldings(st.id);
  } catch (e) {
    if (e instanceof IntegrationNotConfiguredError) throw new HttpError(503, e.code, e.message, { requiredEnv: e.requiredEnv });
    throw e;
  }
  const rows = parseWith(
    z.array(posRow).max(MAX_ROWS),
    holdings.filter((h) => Number(h.quantity) > 0).map((h) => ({ ticker: h.ticker, isin: h.isin ?? null, quantity: String(h.quantity) })),
  );
  const out = await receivePositions(req, {
    head,
    cp,
    rows,
    source: 'CONNECTOR',
    connector,
    format: 'CSV',
    bytes: { ...feedBytes(req, rows as unknown as Record<string, unknown>[], ['ticker', 'quantity', 'isin']), name: `connector-${connector}-${b.accountRef}-${b.asOfDate}.csv` },
  });
  res.status(out.replaced ? 200 : 201).json({ data: receiptView(out.receipt, cp, req.user!.email), batchRef: out.batchRef, importId: out.importId, connector, rows: rows.length, replaced: out.replaced });
});

const importsQuery = z.object({ asOf: dateStr.optional(), counterpartyId: z.string().optional(), accountRef: z.string().optional(), feed: z.enum(['POSITIONS', 'CORP_ACTIONS', 'STATEMENT']).optional(), source: z.enum(['MANUAL', 'CONNECTOR']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
reconExtRoutes.get('/counterpart-imports', ...canView, validateQuery(importsQuery), async (req, res) => {
  const q = query<z.infer<typeof importsQuery>>(req);
  const cp = await counterpartyOf(q.counterpartyId);
  const rows = await prisma.reconCounterpartImport.findMany({
    where: { ...(q.asOf ? { asOfDate: dayStart(q.asOf) } : {}), ...(cp ? { counterpartyId: cp.id } : {}), ...(q.accountRef ? { accountRef: q.accountRef } : {}), ...(q.feed ? { feed: q.feed } : {}), ...(q.source ? { source: q.source } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    take: q.limit,
  });
  const cps = await prisma.counterparty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.counterpartyId))] } }, select: { id: true, ref: true, name: true } });
  const cpBy = new Map(cps.map((c) => [c.id, c]));
  const names = await userNames(rows.map((r) => r.createdBy));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      source: r.source,
      connector: r.connector,
      feed: r.feed,
      counterparty: cpBy.get(r.counterpartyId) ?? { id: r.counterpartyId },
      accountRef: r.accountRef,
      asOfDate: isoDay(r.asOfDate),
      filename: r.filename,
      format: r.format,
      recordCount: r.recordCount,
      sha256: r.sha256,
      status: r.status,
      note: r.note,
      createdByName: names.get(r.createdBy) ?? null,
      createdAt: iso(r.createdAt),
    })),
  });
});

reconExtRoutes.post('/custody-ca-notices', ...canManage, uploadFiles('file'), idempotent('recon.feed.ca', { required: false }), async (req, res) => {
  const { head, cp, raw, format } = await feedPrelude(req, ['ticker', 'exDate', 'payDate', 'quantity', 'cashAmount', 'currency', 'caType', 'externalRef'], 'CORP_ACTIONS');
  const rows = parseWith(z.array(caRow).max(MAX_ROWS), raw);
  for (const r of rows) {
    if (r.payDate !== head.asOfDate) throw HttpError.badRequest('Validation failed', [{ path: 'rows', message: `Every notice must pay on ${head.asOfDate} (the file date); ${r.ticker} pays ${r.payDate}` }]);
    if (r.exDate > r.payDate) throw HttpError.badRequest('Validation failed', [{ path: 'rows', message: `${r.ticker}: ex date is after the pay date` }]);
  }
  await guardFeed('CORP_ACTIONS', head.asOfDate, cp.id);
  const out = await receive(req, {
    feed: 'CORP_ACTIONS',
    family: 'CORP_ACTIONS',
    head,
    cpId: cp.id,
    cpRef: cp.ref,
    rows: rows as unknown as Record<string, unknown>[],
    cols: ['ticker', 'exDate', 'payDate', 'quantity', 'cashAmount', 'currency', 'caType', 'externalRef'],
    format,
    write: async (tx, batchRef) => {
      await tx.reconCustodyCaNotice.deleteMany({ where: { counterpartyId: cp.id, accountRef: head.accountRef, payDate: dayStart(head.asOfDate) } });
      if (rows.length)
        await tx.reconCustodyCaNotice.createMany({
          data: rows.map((r) => ({ counterpartyId: cp.id, accountRef: head.accountRef, ticker: r.ticker.trim().toUpperCase(), caType: r.caType?.trim() || null, exDate: dayStart(r.exDate), payDate: dayStart(r.payDate), quantity: r.quantity, cashAmount: r.cashAmount, currency: r.currency, externalRef: r.externalRef?.trim() || null, batchRef, createdBy: req.user!.id })),
        });
    },
  });
  res.status(out.replaced ? 200 : 201).json({ data: receiptView(out.receipt, cp, req.user!.email), batchRef: out.batchRef, importId: out.importId, rows: rows.length, replaced: out.replaced });
});

const feedQuery = z.object({ asOf: dateStr.optional(), counterpartyId: z.string().optional(), accountRef: z.string().optional() });

reconExtRoutes.get('/feeds', ...canView, validateQuery(feedQuery), async (req, res) => {
  const q = query<z.infer<typeof feedQuery>>(req);
  const cp = await counterpartyOf(q.counterpartyId);
  const rows = await prisma.reconSourceReceipt.findMany({
    where: { ...(q.asOf ? { asOfDate: dayStart(q.asOf) } : {}), ...(cp ? { counterpartyId: cp.id } : {}), ...(q.accountRef ? { accountRef: q.accountRef } : {}) },
    orderBy: [{ asOfDate: 'desc' }, { receivedAt: 'desc' }],
    take: 200,
  });
  const cps = await prisma.counterparty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.counterpartyId))] } }, select: { id: true, ref: true, name: true } });
  const cpBy = new Map(cps.map((c) => [c.id, c]));
  const names = await userNames(rows.map((r) => r.receivedBy));
  res.json({ data: rows.map((r) => receiptView(r, cpBy.get(r.counterpartyId), names.get(r.receivedBy))) });
});

reconExtRoutes.get('/custody-positions', ...canView, validateQuery(feedQuery), async (req, res) => {
  const q = query<z.infer<typeof feedQuery>>(req);
  const cp = await counterpartyOf(q.counterpartyId);
  const rows = await prisma.reconCustodyPosition.findMany({
    where: { ...(q.asOf ? { asOfDate: dayStart(q.asOf) } : {}), ...(cp ? { counterpartyId: cp.id } : {}), ...(q.accountRef ? { accountRef: q.accountRef } : {}) },
    orderBy: [{ asOfDate: 'desc' }, { accountRef: 'asc' }, { ticker: 'asc' }],
    take: 1000,
  });
  res.json({ data: rows.map((r) => ({ id: r.id, counterpartyId: r.counterpartyId, accountRef: r.accountRef, asOfDate: isoDay(r.asOfDate), ticker: r.ticker, isin: r.isin, quantity: r.quantity.toString(), batchRef: r.batchRef })) });
});

reconExtRoutes.get('/custody-ca-notices', ...canView, validateQuery(feedQuery), async (req, res) => {
  const q = query<z.infer<typeof feedQuery>>(req);
  const cp = await counterpartyOf(q.counterpartyId);
  const rows = await prisma.reconCustodyCaNotice.findMany({
    where: { ...(q.asOf ? { payDate: dayStart(q.asOf) } : {}), ...(cp ? { counterpartyId: cp.id } : {}), ...(q.accountRef ? { accountRef: q.accountRef } : {}) },
    orderBy: [{ payDate: 'desc' }, { accountRef: 'asc' }, { ticker: 'asc' }],
    take: 1000,
  });
  res.json({ data: rows.map((r) => ({ id: r.id, counterpartyId: r.counterpartyId, accountRef: r.accountRef, ticker: r.ticker, caType: r.caType, exDate: isoDay(r.exDate), payDate: isoDay(r.payDate), quantity: r.quantity.toString(), cashAmount: r.cashAmount.toString(), currency: r.currency, externalRef: r.externalRef, batchRef: r.batchRef })) });
});

// ================================================================ evidence

reconExtRoutes.post('/breaks/:id/evidence', ...canManage, uploadFiles('file'), idempotent('recon.evidence', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (!isLive(b)) throw HttpError.conflict(`Break ${b.ref} is ${b.status}; evidence can only be attached while it is being worked`, 'invalid_transition');
  if (!req.file) throw HttpError.badRequest('Validation failed', [{ path: 'file', message: 'Attach a file' }]);
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;
  if ((await prisma.reconBreakEvidence.count({ where: { breakId: b.id } })) >= MAX_EVIDENCE) throw HttpError.conflict(`At most ${MAX_EVIDENCE} evidence files per break`, 'evidence_limit');
  const file = req.file;
  const row = await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname || 'evidence', mime: file.mimetype, data: file.buffer, uploadedById: req.user!.id }, tx);
    const e = await tx.reconBreakEvidence.create({ data: { breakId: b.id, fileId: stored.id, name: stored.name, mime: stored.mime, size: stored.size, sha256: stored.sha256, note, uploadedBy: req.user!.id } });
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action: 'evidence_attached', fromStatus: b.status, toStatus: b.status, actorId: req.user!.id, note: stored.name, detail: { sha256: stored.sha256, size: stored.size } } });
    await writeAudit(tx, audit(req), { action: 'recon.evidence_attached', objectType: 'recon_break', objectId: b.id, after: { ref: b.ref, evidenceId: e.id, name: stored.name, sha256: stored.sha256, size: stored.size } });
    return e;
  });
  res.status(201).json({ data: { id: row.id, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256, note: row.note, uploadedByName: req.user!.email, createdAt: iso(row.createdAt) } });
});

async function evidenceViews(breakId: string) {
  const rows = await prisma.reconBreakEvidence.findMany({ where: { breakId }, orderBy: { createdAt: 'asc' } });
  const names = await userNames(rows.map((r) => r.uploadedBy));
  return rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, sha256: r.sha256, note: r.note, uploadedByName: names.get(r.uploadedBy) ?? null, createdAt: iso(r.createdAt) }));
}

async function actionViews(breakId: string) {
  const rows = await prisma.reconBreakAction.findMany({ where: { breakId }, orderBy: { raisedAt: 'asc' } });
  const names = await userNames(rows.flatMap((r) => [r.raisedBy, r.toUserId, r.respondedBy]));
  const cpIds = [...new Set(rows.map((r) => r.counterpartyId).filter((x): x is string => !!x))];
  const cps = cpIds.length ? await prisma.counterparty.findMany({ where: { id: { in: cpIds } }, select: { id: true, ref: true, name: true } }) : [];
  const cpBy = new Map(cps.map((c) => [c.id, c]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    kind: r.kind,
    status: r.status,
    subject: r.subject,
    body: r.body,
    level: r.level,
    counterparty: r.counterpartyId ? cpBy.get(r.counterpartyId) ?? null : null,
    toUserId: r.toUserId,
    toUserName: r.toUserId ? names.get(r.toUserId) ?? null : null,
    raisedByName: names.get(r.raisedBy) ?? null,
    raisedAt: iso(r.raisedAt),
    respondedByName: r.respondedBy ? names.get(r.respondedBy) ?? null : null,
    respondedAt: iso(r.respondedAt),
    response: r.response,
  }));
}

reconExtRoutes.get('/breaks/:id/evidence', ...canView, async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  res.json({ data: await evidenceViews(b.id) });
});
reconExtRoutes.get('/breaks/:id/actions', ...canView, async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  res.json({ data: await actionViews(b.id) });
});
reconExtRoutes.get('/breaks/:id/extras', ...canView, async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  res.json({ data: { evidence: await evidenceViews(b.id), actions: await actionViews(b.id) } });
});

reconExtRoutes.get('/evidence/:evidenceId/download', ...canView, async (req, res) => {
  const e = await prisma.reconBreakEvidence.findUnique({ where: { id: param(req, 'evidenceId') } });
  if (!e) throw HttpError.notFound('Evidence not found');
  const { file, data } = await readFileObject(e.fileId);
  if (sha256Hex(data) !== e.sha256) throw HttpError.conflict('The stored file no longer matches its recorded hash', 'integrity_failed');
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'recon.evidence_downloaded', objectType: 'recon_break', objectId: e.breakId, after: { evidenceId: e.id, name: e.name } }));
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${e.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.send(data);
});

// ================================================================ query the source, escalate

const querySchema = z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(5, 'Say what you are asking').max(2000), counterpartyId: id36.nullish() }).strict();
const respondSchema = z.object({ response: z.string().trim().min(3).max(2000) }).strict();
const escalateSchema = z.object({ toUserId: id36, level: z.coerce.number().int().min(1).max(3).default(1), reason: z.string().trim().min(5, 'Give a reason').max(2000), version: z.number().int().optional() }).strict();
const closeActionSchema = z.object({ note: z.string().trim().max(1000).optional() }).strict();

/** The custodian trade reference of a TRADES break, so the execution can be flagged Queried. */
const tradeRefOf = (b: BreakRow) => {
  const ext = b.externalValue as Record<string, unknown> | null;
  return b.family === 'TRADES' && ext && typeof ext.tradeRef === 'string' ? ext.tradeRef : null;
};

reconExtRoutes.post('/breaks/:id/query', ...canManage, validateBody(querySchema), idempotent('recon.query', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  expectVersion(req, b.version);
  if (!isLive(b)) throw HttpError.conflict(`Break ${b.ref} is ${b.status}; it cannot be queried`, 'invalid_transition');
  const body = req.body as z.infer<typeof querySchema>;
  const cp = (await counterpartyOf(body.counterpartyId)) ?? (b.counterpartyId ? await counterpartyOf(b.counterpartyId) : null);
  if (!cp) throw HttpError.badRequest('Validation failed', [{ path: 'counterpartyId', message: 'This break has no counterparty; choose who to query' }]);
  const tradeRef = tradeRefOf(b);
  const action = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'reconQuery', 'QRY-', 5, 1);
    const a = await tx.reconBreakAction.create({ data: { ref, breakId: b.id, kind: 'QUERY', counterpartyId: cp.id, subject: body.subject, body: body.body, raisedBy: req.user!.id } });
    if (b.status === 'NEW' || b.status === 'ASSIGNED') {
      assertUpdated((await tx.reconBreak.updateMany({ where: { id: b.id, version: b.version, status: b.status }, data: { status: 'INVESTIGATING', ownerUserId: b.ownerUserId ?? req.user!.id, version: { increment: 1 } } })).count);
    }
    if (tradeRef) await tx.counterpartyExecution.updateMany({ where: { counterpartyId: cp.id, tradeRef, status: { in: ['Received', 'Matched', 'Exception'] } }, data: { status: 'Queried' } });
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action: 'queried', fromStatus: b.status, toStatus: b.status === 'NEW' || b.status === 'ASSIGNED' ? 'INVESTIGATING' : b.status, actorId: req.user!.id, note: `${ref} to ${cp.name}: ${body.subject}`, detail: { actionId: a.id, counterpartyId: cp.id } } });
    await writeAudit(tx, audit(req), { action: 'recon.break_queried', objectType: 'recon_break', objectId: b.id, before: { status: b.status }, after: { ref: b.ref, queryRef: ref, counterparty: cp.ref, subject: body.subject, executionFlagged: !!tradeRef } });
    return a;
  });
  res.status(201).json({ data: (await actionViews(b.id)).find((x) => x.id === action.id) });
});

reconExtRoutes.post('/breaks/:id/actions/:actionId/respond', ...canManage, validateBody(respondSchema), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  const a = await prisma.reconBreakAction.findFirst({ where: { id: param(req, 'actionId'), breakId: b.id } });
  if (!a) throw HttpError.notFound('Query not found');
  if (a.kind !== 'QUERY' || a.status !== 'OPEN') throw HttpError.conflict(`${a.ref} is ${a.status}; only an open query can be answered`, 'invalid_transition');
  const { response } = req.body as z.infer<typeof respondSchema>;
  const tradeRef = tradeRefOf(b);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.reconBreakAction.updateMany({ where: { id: a.id, status: 'OPEN' }, data: { status: 'ANSWERED', response, respondedBy: req.user!.id, respondedAt: new Date() } })).count);
    if (tradeRef && a.counterpartyId) await tx.counterpartyExecution.updateMany({ where: { counterpartyId: a.counterpartyId, tradeRef, status: 'Queried' }, data: { status: 'Exception' } });
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action: 'query_answered', fromStatus: b.status, toStatus: b.status, actorId: req.user!.id, note: `${a.ref}: ${response}`.slice(0, 2000) } });
    await writeAudit(tx, audit(req), { action: 'recon.query_answered', objectType: 'recon_break', objectId: b.id, after: { ref: b.ref, queryRef: a.ref }, reason: response });
  });
  res.json({ data: (await actionViews(b.id)).find((x) => x.id === a.id) });
});

reconExtRoutes.post('/breaks/:id/escalate', ...canManage, validateBody(escalateSchema), idempotent('recon.escalate', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (!isLive(b)) throw HttpError.conflict(`Break ${b.ref} is ${b.status}; it cannot be escalated`, 'invalid_transition');
  if (req.body.version !== undefined) expectVersion(req, b.version);
  const body = req.body as z.infer<typeof escalateSchema>;
  await activeStaff(body.toUserId, 'toUserId');
  const action = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'reconEscalation', 'ESC-', 5, 1);
    const a = await tx.reconBreakAction.create({ data: { ref, breakId: b.id, kind: 'ESCALATION', subject: `Escalation level ${body.level}`, body: body.reason, level: body.level, toUserId: body.toUserId, raisedBy: req.user!.id } });
    assertUpdated((await tx.reconBreak.updateMany({ where: { id: b.id, version: b.version, status: b.status }, data: { ownerUserId: body.toUserId, version: { increment: 1 } } })).count);
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action: 'escalated', fromStatus: b.status, toStatus: b.status, actorId: req.user!.id, note: `${ref} level ${body.level}: ${body.reason}`.slice(0, 2000), detail: { actionId: a.id, toUserId: body.toUserId, level: body.level } } });
    await writeAudit(tx, audit(req), { action: 'recon.break_escalated', objectType: 'recon_break', objectId: b.id, before: { ownerUserId: b.ownerUserId }, after: { ref: b.ref, escalationRef: ref, level: body.level, toUserId: body.toUserId }, reason: body.reason });
    if (body.toUserId !== req.user!.id) await enqueue(tx, 'notify.users', { userIds: [body.toUserId], type: 'recon.break_escalated', title: `Reconciliation break ${b.ref} escalated to you (level ${body.level})`, body: body.reason, link: `/ops/reconciliation?break=${b.id}` });
    return a;
  });
  res.status(201).json({ data: (await actionViews(b.id)).find((x) => x.id === action.id) });
});

reconExtRoutes.post('/breaks/:id/actions/:actionId/close', ...canManage, validateBody(closeActionSchema), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  const a = await prisma.reconBreakAction.findFirst({ where: { id: param(req, 'actionId'), breakId: b.id } });
  if (!a) throw HttpError.notFound('Action not found');
  const closable = (a.kind === 'ESCALATION' && a.status === 'OPEN') || (a.kind === 'QUERY' && a.status === 'ANSWERED');
  if (!closable) throw HttpError.conflict(`${a.ref} is ${a.status}; it cannot be closed`, 'invalid_transition');
  const { note } = req.body as z.infer<typeof closeActionSchema>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.reconBreakAction.updateMany({ where: { id: a.id, status: a.status }, data: { status: 'CLOSED', respondedBy: a.respondedBy ?? req.user!.id, respondedAt: a.respondedAt ?? new Date(), response: a.response ?? note ?? null } })).count);
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action: 'action_closed', fromStatus: b.status, toStatus: b.status, actorId: req.user!.id, note: `${a.ref}${note ? `: ${note}` : ''}` } });
    await writeAudit(tx, audit(req), { action: 'recon.action_closed', objectType: 'recon_break', objectId: b.id, after: { ref: b.ref, actionRef: a.ref, kind: a.kind }, reason: note ?? null });
  });
  res.json({ data: (await actionViews(b.id)).find((x) => x.id === a.id) });
});

reconExtRoutes.get('/actions', ...canView, validateQuery(z.object({ kind: z.enum(['QUERY', 'ESCALATION']).optional(), status: z.string().optional(), mine: z.enum(['1', 'true']).optional() })), async (req, res) => {
  const q = query<{ kind?: string; status?: string; mine?: string }>(req);
  const statuses = (q.status ?? 'OPEN,ANSWERED').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rows = await prisma.reconBreakAction.findMany({ where: { ...(q.kind ? { kind: q.kind } : {}), status: { in: statuses }, ...(q.mine ? { OR: [{ toUserId: req.user!.id }, { raisedBy: req.user!.id }] } : {}) }, orderBy: { raisedAt: 'desc' }, take: 200 });
  const brs = await prisma.reconBreak.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.breakId))] } }, select: { id: true, ref: true, label: true, severity: true } });
  const brBy = new Map(brs.map((x) => [x.id, x]));
  const names = await userNames(rows.flatMap((r) => [r.raisedBy, r.toUserId]));
  res.json({ data: rows.map((r) => ({ id: r.id, ref: r.ref, kind: r.kind, status: r.status, subject: r.subject, level: r.level, break: brBy.get(r.breakId) ?? null, toUserName: r.toUserId ? names.get(r.toUserId) ?? null : null, raisedByName: names.get(r.raisedBy) ?? null, raisedAt: iso(r.raisedAt) })) });
});

// ================================================================ reopen

const reopenSchema = z.object({ reason: z.string().trim().min(10, 'Explain why in at least 10 characters').max(1000), revokeSignoff: z.boolean().optional(), version: z.number().int().optional() }).strict();

reconExtRoutes.post('/breaks/:id/reopen', ...canSignoff, requireStepUp, validateBody(reopenSchema), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (b.status !== 'MATCHED' && b.status !== 'CLOSED') throw HttpError.conflict(`Break ${b.ref} is ${b.status}; only a matched or closed break can be reopened`, 'invalid_transition');
  expectVersion(req, b.version);
  const body = req.body as z.infer<typeof reopenSchema>;
  const run = await prisma.reconRun.findUniqueOrThrow({ where: { id: b.runId }, select: { asOfDate: true } });
  const covering = await prisma.reconSignoff.findMany({ where: { family: b.family, asOfDate: run.asOfDate, counterpartyId: { in: b.counterpartyId ? [b.counterpartyId] : [] } } });
  const all = await prisma.reconSignoff.findMany({ where: { family: b.family, asOfDate: run.asOfDate, counterpartyId: null } });
  const signoffs = [...covering, ...all];
  if (signoffs.length && !body.revokeSignoff) {
    throw new HttpError(409, 'signed_off', 'The day is signed off for this family. Reopening voids the sign-off; resend with revokeSignoff set to confirm.', { signoffs: signoffs.map((s) => ({ id: s.id, signedAt: s.signedAt.toISOString(), signedBy: s.signedBy })) });
  }
  await transition(req, b, 'NEW', {
    action: 'reopened_by_user',
    note: body.reason,
    data: { closedAt: null, resolvedAt: null, checkerId: null, makerId: null },
    after: { voidedSignoffs: signoffs.map((s) => s.id) },
    detail: { previousStatus: b.status, voidedSignoffs: signoffs.length },
    extra: async (tx) => {
      for (const s of signoffs) {
        await tx.reconSignoffVoid.create({ data: { originalId: s.id, scopeKey: s.scopeKey, family: s.family, asOfDate: s.asOfDate, counterpartyId: s.counterpartyId, signedBy: s.signedBy, signedAt: s.signedAt, note: s.note, summary: (s.summary ?? undefined) as Prisma.InputJsonValue | undefined, voidedBy: req.user!.id, reason: body.reason, breakId: b.id } });
        await tx.reconSignoff.delete({ where: { id: s.id } });
        await writeAudit(tx, audit(req), { action: 'recon.signoff_voided', objectType: 'recon_signoff', objectId: s.id, before: { scopeKey: s.scopeKey, signedBy: s.signedBy, signedAt: s.signedAt.toISOString() }, after: { voidedBy: req.user!.id, breakRef: b.ref }, reason: body.reason });
      }
      await enqueue(tx, 'notify.permission', { permission: 'recon.manage', type: 'recon.break_reopened', title: `Reconciliation break ${b.ref} was reopened`, body: body.reason, link: `/ops/reconciliation?break=${b.id}` });
    },
  });
  const fresh = await prisma.reconBreak.findUniqueOrThrow({ where: { id: b.id } });
  res.json({ data: { id: fresh.id, ref: fresh.ref, status: fresh.status, version: fresh.version, voidedSignoffs: signoffs.length } });
});

// ================================================================ close gate

reconExtRoutes.get('/gate', ...canView, validateQuery(z.object({ portfolioId: z.string().optional(), asOf: dateStr.optional() })), async (req, res) => {
  const q = query<{ portfolioId?: string; asOf?: string }>(req);
  const pf = q.portfolioId ? await prisma.portfolio.findFirst({ where: uuidLike(q.portfolioId) ? { id: q.portfolioId } : { ref: q.portfolioId }, select: { id: true } }) : null;
  if (q.portfolioId && !pf) throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  const g = await reconGate({ portfolioId: pf?.id ?? null, asOfDate: q.asOf ?? null });
  res.json({ data: g });
});

export { signoffScopeKey, OPEN_STATUSES };

// ================================================================ candidate matches (FR-REC-006)

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const sideOf = (b: BreakRow) => {
  const v = (b.internalValue ?? b.externalValue) as Record<string, unknown> | null;
  if (!v || typeof v.ticker !== 'string' || typeof v.side !== 'string') return null;
  try {
    return { ticker: v.ticker, side: v.side, quantity: new D(String(v.quantity)) as Dec, price: v.price !== undefined && v.price !== null ? (new D(String(v.price)) as Dec) : null };
  } catch {
    return null;
  }
};

/** Open breaks on the other side of the same trade reconciliation that could be the same trade, best score first. */
async function candidatesFor(b: BreakRow) {
  const want = CANDIDATE_KINDS[b.kind];
  const mine = sideOf(b);
  if (b.family !== 'TRADES' || !want || !mine) return [];
  const run = await prisma.reconRun.findUnique({ where: { id: b.runId }, select: { asOfDate: true } });
  if (!run) return [];
  const others = await prisma.reconBreak.findMany({
    where: { family: 'TRADES', kind: want, id: { not: b.id }, status: { in: ['NEW', 'ASSIGNED', 'INVESTIGATING'] }, ...(b.portfolioId ? { portfolioId: b.portfolioId } : {}), run: { asOfDate: run.asOfDate } },
    take: 200,
  });
  const out = [];
  for (const o of others) {
    const theirs = sideOf(o);
    const sc = theirs ? scoreCandidate(mine, theirs) : null;
    if (sc) out.push({ id: o.id, ref: o.ref, kind: o.kind, label: o.label, severity: o.severity, status: o.status, score: sc.score, reasons: sc.reasons, internalValue: o.internalValue, externalValue: o.externalValue });
  }
  return out.sort((x, y) => y.score - x.score || x.ref.localeCompare(y.ref)).slice(0, 10);
}

reconExtRoutes.get('/breaks/:id/candidates', ...canView, async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  res.json({ data: isOpen(b) ? await candidatesFor(b) : [] });
});

const acceptSchema = z
  .object({ candidateBreakId: id36, cause: z.enum(CAUSES), rationale: z.string().trim().min(10, 'Explain why these are the same trade (10+ characters)').max(2000), version: z.number().int().optional() })
  .strict();

/**
 * Accept candidate match (maker): the break and its counterpart are the same trade, so both go to the checker with the
 * candidate recorded as the evidence. The independent checker approves each as usual (maker is never the checker).
 */
reconExtRoutes.post('/breaks/:id/accept-candidate', ...canManage, validateBody(acceptSchema), idempotent('recon.accept_candidate', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (!isOpen(b)) throw HttpError.conflict(`Break ${b.ref} is ${b.status}; a candidate can only be accepted while it is open`, 'invalid_transition');
  expectVersion(req, b.version);
  const body = req.body as z.infer<typeof acceptSchema>;
  const cands = await candidatesFor(b);
  const cand = cands.find((c) => c.id === body.candidateBreakId);
  if (!cand) throw HttpError.badRequest('Validation failed', [{ path: 'candidateBreakId', message: 'That break is not an open candidate for this one' }]);
  const peer = await loadBreak(cand.id);
  const accepted = { breakId: peer.id, ref: peer.ref, kind: peer.kind, score: cand.score, reasons: cand.reasons } as unknown as Prisma.InputJsonValue;
  const acceptedBack = { breakId: b.id, ref: b.ref, kind: b.kind, score: cand.score, reasons: cand.reasons } as unknown as Prisma.InputJsonValue;
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const [x, other, json] of [[b, peer, accepted], [peer, b, acceptedBack]] as const) {
      assertUpdated(
        (
          await tx.reconBreak.updateMany({
            where: { id: x.id, version: x.version, status: x.status },
            data: { status: 'PENDING_CHECKER', cause: body.cause, resolutionNote: body.rationale, evidenceRef: `Candidate match ${other.ref}`.slice(0, 255), acceptedCandidate: json, makerId: req.user!.id, resolvedAt: now, checkerId: null, version: { increment: 1 } },
          })
        ).count,
      );
      await tx.reconBreakEvent.create({
        data: { breakId: x.id, action: x === b ? 'candidate_accepted' : 'candidate_accepted_peer', fromStatus: x.status, toStatus: 'PENDING_CHECKER', actorId: req.user!.id, note: body.rationale, detail: { candidate: other.ref, score: cand.score, reasons: cand.reasons } },
      });
      await writeAudit(tx, audit(req), { action: 'recon.break_candidate_accepted', objectType: 'recon_break', objectId: x.id, before: { status: x.status, ref: x.ref }, after: { status: 'PENDING_CHECKER', ref: x.ref, candidate: other.ref, score: cand.score, cause: body.cause }, reason: body.rationale });
    }
    await enqueue(tx, 'notify.permission', { permission: 'recon.signoff', type: 'recon.break_pending_checker', title: `Breaks ${b.ref} and ${peer.ref} are ready for your approval`, body: `Candidate match accepted: ${b.label}`, link: `/ops/reconciliation?break=${b.id}` });
  });
  res.json({ data: { ref: b.ref, status: 'PENDING_CHECKER', candidate: { ref: peer.ref, status: 'PENDING_CHECKER', score: cand.score } } });
});
