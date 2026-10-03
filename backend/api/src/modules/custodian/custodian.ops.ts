import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { enqueue, type NotifyPermissionPayload } from '../../lib/outbox';
import { storeFile } from '../../lib/storage';
import { ctx, param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { requirePermission } from '../../middleware/requireAuth';
import { validateBody } from '../../middleware/validate';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { parseCsvRows } from '../cash/cash.engine';
import { cp, executionView, nextCustodianRef, type CounterpartyContext } from './custodian.service';
import { recordExecutionEvent } from './custodian.events';
import { amendSchema, cancelSchema, decimalString, executionSchema, type ExecutionInput } from './custodian.schemas';

/**
 * Counterparty execution operations beyond single entry (GAP-018):
 *  - bulk CSV upload with declared control totals (count, quantity, notional), all-or-nothing;
 *  - amend / cancel of an execution that staff have not matched yet, with a mandatory reason;
 *  - status history for executions and day-end packages as the counterparty may see it.
 * Mounted by `custodian.routes.ts` after authentication and counterparty resolution.
 */
export const custodianOpsRoutes = Router();

const Dec = Prisma.Decimal;
const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'custodian');
const MAX_BULK_ROWS = 1000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Header aliases (after lower-casing and dropping non-letters) -> execution field. */
const HEADER_ALIASES: Record<string, keyof ExecutionInput> = {
  traderef: 'tradeRef',
  tradereference: 'tradeRef',
  reference: 'tradeRef',
  executionat: 'executionAt',
  executiontime: 'executionAt',
  datetime: 'executionAt',
  accountref: 'accountRef',
  account: 'accountRef',
  portfolio: 'accountRef',
  ticker: 'ticker',
  symbol: 'ticker',
  security: 'ticker',
  isin: 'isin',
  side: 'side',
  quantity: 'quantity',
  qty: 'quantity',
  price: 'price',
  executionprice: 'price',
  currency: 'currency',
  ccy: 'currency',
  settlementdate: 'settlementDate',
  settlement: 'settlementDate',
  settle: 'settlementDate',
  broker: 'broker',
  note: 'note',
};
const REQUIRED_COLUMNS: (keyof ExecutionInput)[] = ['tradeRef', 'executionAt', 'accountRef', 'ticker', 'side', 'quantity', 'price', 'currency'];

interface RowError {
  row: number;
  field?: string;
  message: string;
}

function requireAccount(c: CounterpartyContext, accountRef: string) {
  return c.accounts.includes(accountRef) ? null : `Account ${accountRef} is not serviced by your organisation`;
}

/** Semantic checks shared by bulk rows and amendments. */
function checkTiming(e: Pick<ExecutionInput, 'executionAt' | 'settlementDate' | 'tradeRef'>, now: number): string | null {
  const at = new Date(e.executionAt);
  if (at.getTime() > now + 5 * 60_000) return `Execution time of ${e.tradeRef} is in the future`;
  if (e.settlementDate && e.settlementDate < at.toISOString().slice(0, 10)) return `Settlement date of ${e.tradeRef} is before the trade date`;
  return null;
}

/** An Approved / Accepted day-end package freezes the executions for its account and statement date. */
async function assertNotFrozen(counterpartyId: string, accountRef: string, executionAt: Date) {
  const start = new Date(`${day(executionAt)}T00:00:00.000Z`);
  const frozen = await prisma.counterpartyDayEndPackage.findFirst({
    where: { counterpartyId, accountRef, statementDate: start, status: { in: ['Approved', 'Accepted'] } },
    select: { ref: true, status: true },
  });
  if (frozen) {
    throw HttpError.conflict(
      `Day-end package ${frozen.ref} (${frozen.status.toLowerCase()}) covers this account and date; supersede the package before changing its executions`,
      'execution_locked',
    );
  }
}

async function loadExecution(id: string, counterpartyId: string) {
  const row = await prisma.counterpartyExecution.findFirst({ where: { id, counterpartyId } });
  if (!row) throw HttpError.notFound('Execution not found');
  return row;
}

function assertChangeable(row: { status: string; cancelledAt: Date | null; ref: string }) {
  if (row.cancelledAt) throw HttpError.conflict(`${row.ref} is already cancelled`, 'invalid_transition');
  if (!['Received', 'Exception', 'Queried'].includes(row.status)) {
    throw HttpError.conflict(
      row.status === 'Matched' ? `${row.ref} has been matched by Matanho and can no longer be changed; ask operations to reopen it` : `${row.ref} is ${row.status.toLowerCase()} and cannot be changed`,
      'execution_locked',
    );
  }
}

// ------------------------------------------------------------------ bulk upload

const bulkFields = z.object({
  declaredCount: z.coerce.number().int().min(0).max(MAX_BULK_ROWS).optional().or(z.literal('').transform(() => undefined)),
  declaredQuantity: decimalString(18, 8).optional().or(z.literal('').transform(() => undefined)),
  declaredNotional: decimalString(20, 2).optional().or(z.literal('').transform(() => undefined)),
  dryRun: z.enum(['true', 'false', '1', '0']).optional(),
});

/**
 * Parses and validates a CSV. Returns normalised rows plus per-row errors (row numbers count the header as row 1).
 * Exported for the flow script.
 */
export function parseExecutionCsv(text: string, c: Pick<CounterpartyContext, 'accounts'>, now = Date.now()) {
  const table = parseCsvRows(text);
  const errors: RowError[] = [];
  if (table.length < 2) return { rows: [] as ExecutionInput[], errors: [{ row: 1, message: 'The file needs a header row and at least one execution' }] as RowError[], fatal: true, total: 0 };
  if (table.length - 1 > MAX_BULK_ROWS) return { rows: [] as ExecutionInput[], errors: [{ row: 1, message: `A file may hold at most ${MAX_BULK_ROWS} executions` }] as RowError[], fatal: true, total: 0 };
  const header = table[0]!.map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[^a-z]/g, '')] ?? null);
  const missing = REQUIRED_COLUMNS.filter((f) => !header.includes(f));
  if (missing.length) return { rows: [] as ExecutionInput[], errors: [{ row: 1, message: `Missing column(s): ${missing.join(', ')}` }] as RowError[], fatal: true, total: 0 };

  const rows: ExecutionInput[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const raw: Record<string, string> = {};
    header.forEach((f, idx) => {
      if (f) raw[f] = (cells[idx] ?? '').trim();
    });
    if (raw.side) raw.side = raw.side.toUpperCase();
    if (raw.currency) raw.currency = raw.currency.toUpperCase();
    const parsed = executionSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push({ row, field: String(issue.path[0] ?? ''), message: issue.message });
      return;
    }
    const e = parsed.data;
    const before = errors.length;
    const scope = requireAccount({ accounts: c.accounts } as CounterpartyContext, e.accountRef);
    if (scope) errors.push({ row, field: 'accountRef', message: scope });
    const timing = checkTiming(e, now);
    if (timing) errors.push({ row, message: timing });
    const first = seen.get(e.tradeRef);
    if (first) errors.push({ row, field: 'tradeRef', message: `Trade reference ${e.tradeRef} repeats row ${first}` });
    else seen.set(e.tradeRef, row);
    if (errors.length === before) rows.push(e);
  });
  return { rows, errors, fatal: false, total: table.length - 1 };
}

custodianOpsRoutes.post(
  '/executions/bulk',
  requirePermission('custodian.executions.submit'),
  uploadFiles('file', 1),
  idempotent('custodian.executions.bulk'),
  validateBody(bulkFields),
  async (req, res) => {
    const c = cp(res);
    const f = req.body as z.infer<typeof bulkFields>;
    const dryRun = f.dryRun === 'true' || f.dryRun === '1';
    const [file] = uploadedFiles(req);
    if (!file) throw HttpError.badRequest('Attach the executions CSV file');
    if (!/\.csv$/i.test(file.originalname) && !/csv|text\/plain/.test(file.mimetype)) throw HttpError.badRequest('The file must be a CSV');

    const { rows, errors, total } = parseExecutionCsv(file.buffer.toString('utf8'), c);
    const rowCount = total;
    const currencies = new Set(rows.map((r) => r.currency));
    if (f.declaredNotional !== undefined && currencies.size > 1) {
      errors.push({ row: 1, message: 'A declared notional needs a file in a single currency' });
    }
    const actualQuantity = rows.reduce((a, r) => a.plus(r.quantity), new Dec(0));
    const actualNotional = rows.reduce((a, r) => a.plus(new Dec(r.quantity).times(r.price)), new Dec(0)).toDecimalPlaces(2);

    // Control totals are checked only when the file itself parsed cleanly (otherwise the sums are partial).
    const control: Record<string, { declared: string; actual: string; matches: boolean }> = {};
    if (!errors.length) {
      if (f.declaredCount !== undefined) control.count = { declared: String(f.declaredCount), actual: String(rows.length), matches: f.declaredCount === rows.length };
      if (f.declaredQuantity !== undefined) {
        control.quantity = { declared: new Dec(f.declaredQuantity).toFixed(8), actual: actualQuantity.toFixed(8), matches: actualQuantity.equals(f.declaredQuantity) };
      }
      if (f.declaredNotional !== undefined) {
        const tol = new Dec(rows.length).times('0.01');
        control.notional = { declared: new Dec(f.declaredNotional).toFixed(2), actual: actualNotional.toFixed(2), matches: actualNotional.minus(f.declaredNotional).abs().lessThanOrEqualTo(tol) };
      }
    }
    const declared = Object.keys(control).length > 0 || f.declaredCount !== undefined || f.declaredQuantity !== undefined || f.declaredNotional !== undefined;
    const controlOk = Object.values(control).every((x) => x.matches);

    const rejectedBase = {
      counterpartyId: c.id,
      fileName: file.originalname.slice(0, 255),
      rowCount,
      declaredCount: f.declaredCount ?? null,
      declaredQuantity: f.declaredQuantity ?? null,
      declaredNotional: f.declaredNotional ?? null,
      actualQuantity,
      actualNotional,
      submittedById: req.user!.id,
    };

    if (errors.length || !controlOk) {
      const body = {
        valid: false,
        rowCount,
        errors: errors.slice(0, 200),
        control,
        totals: { count: rows.length, quantity: actualQuantity.toFixed(8), notional: actualNotional.toFixed(2) },
      };
      if (dryRun) return res.status(422).json({ error: { code: errors.length ? 'invalid_rows' : 'control_total_mismatch', message: errors.length ? 'The file has invalid rows' : 'Declared control totals do not match the file', details: body } });
      const stored = await storeFile({ name: file.originalname, mime: file.mimetype === 'text/csv' ? 'text/csv' : 'text/plain', data: file.buffer, uploadedById: req.user!.id });
      await prisma.$transaction(async (tx) => {
        const batch = await tx.custodianExecutionBatch.create({
          data: {
            ...rejectedBase,
            ref: await nextCustodianRef(tx, 'custodianBatch'),
            fileId: stored.id,
            acceptedCount: 0,
            duplicateCount: 0,
            rejectedCount: rowCount,
            controlStatus: !declared ? 'NONE' : controlOk ? 'OK' : 'MISMATCH',
            status: 'Rejected',
            errors: body.errors as unknown as Prisma.InputJsonValue,
          },
        });
        await writeAudit(tx, audit(req), {
          action: 'custodian.execution.bulk_rejected',
          objectType: 'custodian_execution_batch',
          objectId: batch.id,
          after: { ref: batch.ref, counterparty: c.ref, file: stored.name, sha256: stored.sha256, errors: errors.length, control },
        });
      });
      throw new HttpError(422, errors.length ? 'invalid_rows' : 'control_total_mismatch', errors.length ? 'The file has invalid rows; nothing was stored' : 'Declared control totals do not match the file; nothing was stored', body);
    }

    const existing = await prisma.counterpartyExecution.findMany({
      where: { counterpartyId: c.id, tradeRef: { in: rows.map((r) => r.tradeRef) } },
      select: { id: true, ref: true, tradeRef: true, status: true },
    });
    const dupes = new Set(existing.map((e) => e.tradeRef));
    const fresh = rows.filter((r) => !dupes.has(r.tradeRef));
    if (dryRun) {
      return res.json({ valid: true, rowCount: rows.length, newCount: fresh.length, duplicates: existing, control, totals: { count: rows.length, quantity: actualQuantity.toFixed(8), notional: actualNotional.toFixed(2) } });
    }
    if (!fresh.length) throw new HttpError(409, 'duplicate_trade_ref', 'Every trade reference in the file was already submitted', { duplicates: existing });

    const stored = await storeFile({ name: file.originalname, mime: file.mimetype === 'text/csv' ? 'text/csv' : 'text/plain', data: file.buffer, uploadedById: req.user!.id });
    const result = await prisma
      .$transaction(async (tx) => {
        const batch = await tx.custodianExecutionBatch.create({
          data: {
            ...rejectedBase,
            ref: await nextCustodianRef(tx, 'custodianBatch'),
            fileId: stored.id,
            acceptedCount: fresh.length,
            duplicateCount: existing.length,
            rejectedCount: 0,
            controlStatus: declared ? 'OK' : 'NONE',
            status: 'Accepted',
          },
        });
        const created = [];
        for (const e of fresh) {
          const row = await tx.counterpartyExecution.create({
            data: {
              ref: await nextCustodianRef(tx, 'custodianExecution'),
              counterpartyId: c.id,
              tradeRef: e.tradeRef,
              executionAt: new Date(e.executionAt),
              accountRef: e.accountRef,
              ticker: e.ticker,
              isin: e.isin ?? null,
              side: e.side,
              quantity: e.quantity,
              price: e.price,
              currency: e.currency,
              settlementDate: e.settlementDate ? new Date(`${e.settlementDate}T00:00:00Z`) : null,
              broker: e.broker || null,
              note: e.note || null,
              submittedById: req.user!.id,
              batchId: batch.id,
            },
          });
          await recordExecutionEvent(tx, { executionId: row.id, counterpartyId: c.id, action: 'submitted', fromStatus: null, toStatus: 'Received', reason: `Bulk upload ${batch.ref}`, actorId: req.user!.id });
          created.push(row);
        }
        await writeAudit(tx, audit(req), {
          action: 'custodian.execution.bulk_submitted',
          objectType: 'custodian_execution_batch',
          objectId: batch.id,
          after: { ref: batch.ref, counterparty: c.ref, file: stored.name, sha256: stored.sha256, accepted: fresh.length, duplicates: existing.length, control },
        });
        await enqueue(tx, 'notify.permission', {
          permission: 'custodian.review',
          type: 'custodian.execution.submitted',
          title: `${c.name}: ${created.length} executions received (bulk ${batch.ref})`,
          body: created.map((x) => x.tradeRef).slice(0, 10).join(', '),
          link: '/ops/custodian',
        } satisfies NotifyPermissionPayload);
        return { batch, created };
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw HttpError.conflict('A trade reference in this file was submitted at the same time', 'duplicate_trade_ref');
        }
        throw err;
      });
    res.status(201).json({ batch: batchView(result.batch), created: result.created.map(executionView), duplicates: existing, control });
  },
);

function batchView(b: {
  id: string;
  ref: string;
  fileName: string;
  rowCount: number;
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  declaredCount: number | null;
  declaredQuantity: Prisma.Decimal | null;
  declaredNotional: Prisma.Decimal | null;
  actualQuantity: Prisma.Decimal;
  actualNotional: Prisma.Decimal;
  controlStatus: string;
  status: string;
  errors: Prisma.JsonValue | null;
  submittedAt: Date;
}) {
  return {
    id: b.id,
    ref: b.ref,
    fileName: b.fileName,
    rowCount: b.rowCount,
    acceptedCount: b.acceptedCount,
    duplicateCount: b.duplicateCount,
    rejectedCount: b.rejectedCount,
    declared: { count: b.declaredCount, quantity: b.declaredQuantity?.toFixed(8) ?? null, notional: b.declaredNotional?.toFixed(2) ?? null },
    actual: { quantity: b.actualQuantity.toFixed(8), notional: b.actualNotional.toFixed(2) },
    controlStatus: b.controlStatus,
    status: b.status,
    errors: b.errors,
    submittedAt: b.submittedAt.toISOString(),
  };
}

custodianOpsRoutes.get('/executions-batches', async (_req, res) => {
  const c = cp(res);
  const rows = await prisma.custodianExecutionBatch.findMany({ where: { counterpartyId: c.id }, orderBy: { submittedAt: 'desc' }, take: 50 });
  res.json({ items: rows.map(batchView) });
});

// ------------------------------------------------------------------ amend / cancel

custodianOpsRoutes.patch(
  '/executions/:id',
  requirePermission('custodian.executions.submit'),
  idempotent('custodian.executions.amend'),
  validateBody(amendSchema),
  async (req, res) => {
    const c = cp(res);
    const { reason, ...patch } = req.body as z.infer<typeof amendSchema>;
    const row = await loadExecution(param(req, 'id'), c.id);
    assertChangeable(row);
    await assertNotFrozen(c.id, row.accountRef, row.executionAt);

    const next = {
      executionAt: patch.executionAt ?? row.executionAt.toISOString(),
      accountRef: patch.accountRef ?? row.accountRef,
      ticker: patch.ticker ?? row.ticker,
      isin: patch.isin !== undefined ? patch.isin ?? null : row.isin,
      side: patch.side ?? row.side,
      quantity: patch.quantity ?? row.quantity.toString(),
      price: patch.price ?? row.price.toString(),
      currency: patch.currency ?? row.currency,
      settlementDate: patch.settlementDate !== undefined ? patch.settlementDate ?? null : row.settlementDate ? day(row.settlementDate) : null,
      broker: patch.broker !== undefined ? patch.broker || null : row.broker,
      note: patch.note !== undefined ? patch.note || null : row.note,
    };
    const scope = requireAccount(c, next.accountRef);
    if (scope) throw HttpError.forbidden(scope, 'account_out_of_scope');
    const timing = checkTiming({ tradeRef: row.tradeRef, executionAt: next.executionAt, settlementDate: next.settlementDate ?? undefined }, Date.now());
    if (timing) throw HttpError.badRequest(timing);
    if (next.accountRef !== row.accountRef) await assertNotFrozen(c.id, next.accountRef, new Date(next.executionAt));

    const before = executionView(row);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const cmp: [string, unknown, unknown][] = [
      ['executionAt', row.executionAt.getTime(), new Date(next.executionAt).getTime()],
      ['accountRef', row.accountRef, next.accountRef],
      ['ticker', row.ticker, next.ticker],
      ['isin', row.isin, next.isin],
      ['side', row.side, next.side],
      ['quantity', new Dec(row.quantity).toString(), new Dec(next.quantity).toString()],
      ['price', new Dec(row.price).toString(), new Dec(next.price).toString()],
      ['currency', row.currency, next.currency],
      ['settlementDate', row.settlementDate ? day(row.settlementDate) : null, next.settlementDate],
      ['broker', row.broker, next.broker],
      ['note', row.note, next.note],
    ];
    for (const [k, a, b] of cmp) {
      if (a !== b) changes[k] = { from: (before as Record<string, unknown>)[k] ?? a, to: k === 'executionAt' ? new Date(next.executionAt).toISOString() : b };
    }
    if (!Object.keys(changes).length) throw HttpError.badRequest('Nothing to amend: the values are the same as on file');

    const updated = await prisma.$transaction(async (tx) => {
      const n = await tx.counterpartyExecution.updateMany({
        where: { id: row.id, status: row.status, cancelledAt: null },
        data: {
          executionAt: new Date(next.executionAt),
          accountRef: next.accountRef,
          ticker: next.ticker,
          isin: next.isin,
          side: next.side,
          quantity: next.quantity,
          price: next.price,
          currency: next.currency,
          settlementDate: next.settlementDate ? new Date(`${next.settlementDate}T00:00:00Z`) : null,
          broker: next.broker,
          note: next.note,
          // An amended execution goes back into the matching queue.
          status: 'Received',
          amendCount: { increment: 1 },
          amendedAt: new Date(),
        },
      });
      if (!n.count) throw HttpError.conflict('This execution changed; reload and try again', 'invalid_transition');
      await recordExecutionEvent(tx, { executionId: row.id, counterpartyId: c.id, action: 'amended', fromStatus: row.status, toStatus: 'Received', reason, changes: changes as unknown as Prisma.InputJsonValue, actorId: req.user!.id });
      await writeAudit(tx, audit(req), {
        action: 'custodian.execution.amended',
        objectType: 'custodian_execution',
        objectId: row.id,
        before: { status: row.status, ref: row.ref },
        after: { status: 'Received', ref: row.ref, tradeRef: row.tradeRef, changes },
        reason,
      });
      await enqueue(tx, 'notify.permission', {
        permission: 'custodian.review',
        type: 'custodian.execution.amended',
        title: `${c.name}: execution ${row.tradeRef} amended`,
        body: reason,
        link: '/ops/custodian',
      } satisfies NotifyPermissionPayload);
      return tx.counterpartyExecution.findUniqueOrThrow({ where: { id: row.id } });
    });
    res.json({ execution: executionView(updated), changes });
  },
);

custodianOpsRoutes.post(
  '/executions/:id/cancel',
  requirePermission('custodian.executions.submit'),
  idempotent('custodian.executions.cancel'),
  validateBody(cancelSchema),
  async (req, res) => {
    const c = cp(res);
    const { reason } = req.body as z.infer<typeof cancelSchema>;
    const row = await loadExecution(param(req, 'id'), c.id);
    assertChangeable(row);
    await assertNotFrozen(c.id, row.accountRef, row.executionAt);
    const updated = await prisma.$transaction(async (tx) => {
      const n = await tx.counterpartyExecution.updateMany({
        where: { id: row.id, status: row.status, cancelledAt: null },
        data: { status: 'Superseded', cancelledAt: new Date(), supersedeReason: reason.slice(0, 255) },
      });
      if (!n.count) throw HttpError.conflict('This execution changed; reload and try again', 'invalid_transition');
      await recordExecutionEvent(tx, { executionId: row.id, counterpartyId: c.id, action: 'cancelled', fromStatus: row.status, toStatus: 'Cancelled', reason, actorId: req.user!.id });
      await writeAudit(tx, audit(req), {
        action: 'custodian.execution.cancelled',
        objectType: 'custodian_execution',
        objectId: row.id,
        before: { status: row.status, ref: row.ref },
        after: { status: 'Cancelled', ref: row.ref, tradeRef: row.tradeRef },
        reason,
      });
      await enqueue(tx, 'notify.permission', {
        permission: 'custodian.review',
        type: 'custodian.execution.cancelled',
        title: `${c.name}: execution ${row.tradeRef} cancelled`,
        body: reason,
        link: '/ops/custodian',
      } satisfies NotifyPermissionPayload);
      return tx.counterpartyExecution.findUniqueOrThrow({ where: { id: row.id } });
    });
    res.json({ execution: executionView(updated) });
  },
);

// ------------------------------------------------------------------ status history

function eventView(e: { id: string; executionId: string; action: string; fromStatus: string | null; toStatus: string; reason: string | null; changes: Prisma.JsonValue | null; actorType: string; at: Date }) {
  return { id: e.id, executionId: e.executionId, action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, reason: e.reason, changes: e.changes, by: e.actorType === 'COUNTERPARTY' ? 'Your organisation' : 'Matanho', at: e.at.toISOString() };
}

custodianOpsRoutes.get('/executions/:id/history', async (req, res) => {
  const c = cp(res);
  const row = await loadExecution(param(req, 'id'), c.id);
  const events = await prisma.custodianExecutionEvent.findMany({ where: { executionId: row.id, counterpartyId: c.id }, orderBy: { at: 'asc' } });
  res.json({ execution: executionView(row), events: events.map(eventView) });
});

/** Recent status history across all executions, newest first (the counterparty-side status history screen). */
custodianOpsRoutes.get('/history', async (req, res) => {
  const c = cp(res);
  const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const events = await prisma.custodianExecutionEvent.findMany({ where: { counterpartyId: c.id }, orderBy: { at: 'desc' }, take });
  const execs = await prisma.counterpartyExecution.findMany({
    where: { id: { in: [...new Set(events.map((e) => e.executionId))] } },
    select: { id: true, ref: true, tradeRef: true },
  });
  const byId = new Map(execs.map((e) => [e.id, e]));
  res.json({ items: events.map((e) => ({ ...eventView(e), ref: byId.get(e.executionId)?.ref ?? null, tradeRef: byId.get(e.executionId)?.tradeRef ?? null })) });
});

/** Day-end package timeline from the audit trail (no staff identifiers are returned). */
custodianOpsRoutes.get('/day-end/:id/history', async (req, res) => {
  const c = cp(res);
  const pkg = await prisma.counterpartyDayEndPackage.findFirst({ where: { id: param(req, 'id'), counterpartyId: c.id }, select: { id: true, ref: true } });
  if (!pkg) throw HttpError.notFound('Day-end package not found');
  const rows = await prisma.auditEvent.findMany({
    where: { objectType: 'custodian_day_end', objectId: pkg.id, action: { startsWith: 'custodian.dayend.' } },
    orderBy: { id: 'asc' },
    select: { action: true, after: true, reason: true, occurredAt: true, actorId: true },
  });
  const mine = new Set((await prisma.counterpartyUser.findMany({ where: { counterpartyId: c.id }, select: { userId: true } })).map((u) => u.userId));
  res.json({
    package: { id: pkg.id, ref: pkg.ref },
    events: rows.map((r) => ({
      action: r.action.replace('custodian.dayend.', ''),
      status: ((r.after ?? {}) as Record<string, unknown>).status ?? null,
      reason: r.reason,
      by: r.actorId && mine.has(r.actorId) ? 'Your organisation' : 'Matanho',
      at: r.occurredAt.toISOString(),
    })),
  });
});
