import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { enqueue, type NotifyPermissionPayload, type NotifyUsersPayload } from '../../lib/outbox';
import { storeFile } from '../../lib/storage';
import { ctx, param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { validateBody } from '../../middleware/validate';
import { CURRENCIES, decimalString, executionSchema, isoDay } from './custodian.schemas';
import { recordExecutionEvent } from './custodian.events';
import { custodianOpsRoutes } from './custodian.ops';
import { custodianNativeRoutes } from './custodian.native';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import {
  counterpartyContext,
  cp,
  dayEndView,
  executionView,
  filesById,
  latestReviews,
  nextCustodianRef,
  packageHash,
  tradeControlFor,
  totalsMismatch,
} from './custodian.service';

/** `/api/v1/custodian` - counterparty (custodian) executions and day-end packages (SRD 5E). Owned by WS4. */
export const custodianRoutes = Router();

custodianRoutes.use(requireAuth, requirePortalAccess('custodian'));
custodianRoutes.get('/health', (_req, res) => {
  res.json({ domain: 'custodian', live: true });
});
custodianRoutes.use(counterpartyContext);

const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'custodian');

/** Counterparty users with the approver role, for in-counterparty notifications. */
async function approverIds(counterpartyId: string, except: string) {
  const rows = await prisma.counterpartyUser.findMany({
    where: { counterpartyId, status: 'active', role: 'approver', userId: { not: except } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Staff review outcome as the counterparty sees it (no staff identifiers). */
function counterpartyReview(r: { decision: string; note: string | null; at: string } | undefined) {
  return r ? { decision: r.decision, note: r.note, at: r.at } : null;
}

function requireAccount(accounts: string[], accountRef: string) {
  if (!accounts.includes(accountRef)) {
    throw HttpError.forbidden(`Account ${accountRef} is not serviced by your organisation`, 'account_out_of_scope');
  }
}

// ------------------------------------------------------------------ me

custodianRoutes.get('/me', (req, res) => {
  const c = cp(res);
  const u = req.user!;
  res.json({
    user: { id: u.id, name: u.name, email: u.email },
    role: c.role,
    permissions: u.permissions.filter((p) => p.startsWith('custodian.')),
    counterparty: { id: c.id, ref: c.ref, name: c.name, type: c.type, accounts: c.accounts },
  });
});

// ------------------------------------------------------------------ executions

const batchSchema = z.object({ executions: z.array(executionSchema).min(1).max(200) });

custodianRoutes.get('/executions', async (req, res) => {
  const c = cp(res);
  const accountRef = typeof req.query.accountRef === 'string' ? req.query.accountRef : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await prisma.counterpartyExecution.findMany({
    where: { counterpartyId: c.id, ...(accountRef ? { accountRef } : {}), ...(status ? { status } : {}) },
    orderBy: { submittedAt: 'desc' },
    take: 200,
  });
  res.json({ items: rows.map(executionView) });
});

custodianRoutes.get('/executions/:id', async (req, res) => {
  const c = cp(res);
  const row = await prisma.counterpartyExecution.findFirst({ where: { id: param(req, 'id'), counterpartyId: c.id } });
  if (!row) throw HttpError.notFound('Execution not found');
  res.json({ execution: executionView(row) });
});

/**
 * FR-REC-012: batch execution submission. Idempotent by key; deduplicated on trade reference
 * per counterparty: references already on file are reported in `duplicates` and not stored
 * again. Nothing new in the batch -> 409 `duplicate_trade_ref`.
 */
custodianRoutes.post(
  '/executions',
  requirePermission('custodian.executions.submit'),
  idempotent('custodian.executions'),
  validateBody(batchSchema),
  async (req, res) => {
    const c = cp(res);
    const { executions } = req.body as z.infer<typeof batchSchema>;
    const seen = new Set<string>();
    const now = Date.now();
    executions.forEach((e, i) => {
      if (seen.has(e.tradeRef)) throw HttpError.badRequest(`Trade reference ${e.tradeRef} appears twice in this batch`, { index: i });
      seen.add(e.tradeRef);
      requireAccount(c.accounts, e.accountRef);
      const at = new Date(e.executionAt);
      if (at.getTime() > now + 5 * 60_000) throw HttpError.badRequest(`Execution time of ${e.tradeRef} is in the future`, { index: i });
      if (e.settlementDate && e.settlementDate < at.toISOString().slice(0, 10)) {
        throw HttpError.badRequest(`Settlement date of ${e.tradeRef} is before the trade date`, { index: i });
      }
    });

    const result = await prisma
      .$transaction(async (tx) => {
        const existing = await tx.counterpartyExecution.findMany({
          where: { counterpartyId: c.id, tradeRef: { in: [...seen] } },
          select: { id: true, ref: true, tradeRef: true, status: true },
        });
        const dupes = new Set(existing.map((e) => e.tradeRef));
        const created = [];
        for (const e of executions.filter((x) => !dupes.has(x.tradeRef))) {
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
            },
          });
          await writeAudit(tx, audit(req), {
            action: 'custodian.execution.submitted',
            objectType: 'custodian_execution',
            objectId: row.id,
            after: { ref: row.ref, counterparty: c.ref, tradeRef: row.tradeRef, accountRef: row.accountRef, side: row.side, quantity: e.quantity, price: e.price },
          });
          await recordExecutionEvent(tx, { executionId: row.id, counterpartyId: c.id, action: 'submitted', fromStatus: null, toStatus: 'Received', actorId: req.user!.id });
          created.push(row);
        }
        if (created.length) {
          await enqueue(tx, 'notify.permission', {
            permission: 'custodian.review',
            type: 'custodian.execution.submitted',
            title: `${c.name}: ${created.length} execution${created.length === 1 ? '' : 's'} received`,
            body: created.map((x) => x.tradeRef).slice(0, 10).join(', '),
            link: '/#reconciliation',
          } satisfies NotifyPermissionPayload);
        }
        return { created, duplicates: existing };
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw HttpError.conflict('A trade reference in this batch was submitted at the same time', 'duplicate_trade_ref');
        }
        throw err;
      });

    if (!result.created.length) {
      throw new HttpError(409, 'duplicate_trade_ref', 'Trade reference already submitted', { duplicates: result.duplicates });
    }
    res.status(201).json({ created: result.created.map(executionView), duplicates: result.duplicates });
  },
);

// ------------------------------------------------------------------ day-end packages

const dayEndSchema = z
  .object({
    statementDate: isoDay,
    accountRef: z.string().trim().min(1).max(64),
    currency: z.enum(CURRENCIES),
    closingCash: decimalString(18, 2),
    holdingsMv: decimalString(18, 2).refine((v) => Number(v) >= 0, 'Holdings market value cannot be negative'),
    tradeCount: z.coerce.number().int().min(0).max(100_000),
    /** Optional control totals (quantity and notional of the day's executions, in the package currency). */
    tradeQuantity: decimalString(16, 8).refine((v) => Number(v) >= 0, 'Quantity cannot be negative').optional().or(z.literal('').transform(() => undefined)),
    tradeNotional: decimalString(18, 2).refine((v) => Number(v) >= 0, 'Notional cannot be negative').optional().or(z.literal('').transform(() => undefined)),
    note: z.string().trim().max(2000).optional(),
    supersedesId: z.string().trim().max(36).optional().or(z.literal('').transform(() => undefined)),
    supersedeReason: z.string().trim().max(255).optional(),
  })
  .refine((v) => !v.supersedesId || !!v.supersedeReason, { message: 'Give a reason for superseding the earlier package', path: ['supersedeReason'] });

const ACTIVE = { notIn: ['Draft', 'Superseded', 'Rejected'] };

async function loadPackage(id: string, counterpartyId: string) {
  const pkg = await prisma.counterpartyDayEndPackage.findFirst({ where: { id, counterpartyId } });
  if (!pkg) throw HttpError.notFound('Day-end package not found');
  return pkg;
}

custodianRoutes.get('/day-end', async (_req, res) => {
  const c = cp(res);
  const rows = await prisma.counterpartyDayEndPackage.findMany({ where: { counterpartyId: c.id }, orderBy: { submittedAt: 'desc' }, take: 200 });
  const files = await filesById(rows.map((r) => r.fileId));
  res.json({ items: rows.map((r) => dayEndView(r, r.fileId ? files.get(r.fileId) : null)) });
});

custodianRoutes.get('/day-end/:id', async (req, res) => {
  const c = cp(res);
  const pkg = await loadPackage(param(req, 'id'), c.id);
  const files = await filesById([pkg.fileId]);
  res.json({
    package: dayEndView(pkg, pkg.fileId ? files.get(pkg.fileId) : null),
    controls: await tradeControlFor(pkg),
    review: counterpartyReview((await latestReviews([pkg.id])).get(pkg.id)),
  });
});

/** Creates a Draft package with the official file (stored encrypted, SHA-256 computed server-side). */
custodianRoutes.post(
  '/day-end',
  requirePermission('custodian.dayend.submit'),
  uploadFiles('file', 1),
  idempotent('custodian.dayend.create'),
  validateBody(dayEndSchema),
  async (req, res) => {
    const c = cp(res);
    const b = req.body as z.infer<typeof dayEndSchema>;
    requireAccount(c.accounts, b.accountRef);
    const statementDate = new Date(`${b.statementDate}T00:00:00Z`);
    // Harare is UTC+2: allow today's local date while UTC is still on the previous day.
    if (statementDate.getTime() > Date.now() + 2 * 3_600_000) throw HttpError.badRequest('Statement date cannot be in the future');
    const [file] = uploadedFiles(req);
    if (!file) throw HttpError.badRequest('Attach the official day-end file');
    if (b.supersedesId) {
      const prior = await prisma.counterpartyDayEndPackage.findFirst({ where: { id: b.supersedesId, counterpartyId: c.id } });
      if (!prior) throw HttpError.notFound('The package to supersede was not found');
      if (prior.accountRef !== b.accountRef || prior.currency !== b.currency || prior.statementDate.getTime() !== statementDate.getTime()) {
        throw HttpError.badRequest('A package can only supersede one for the same account, statement date and currency');
      }
      if (!['Received', 'Approved', 'Accepted'].includes(prior.status)) {
        throw HttpError.conflict(`A ${prior.status.toLowerCase()} package cannot be superseded`, 'invalid_transition');
      }
    } else {
      const active = await prisma.counterpartyDayEndPackage.findFirst({
        where: { counterpartyId: c.id, accountRef: b.accountRef, currency: b.currency, statementDate, status: ACTIVE },
        select: { ref: true },
      });
      if (active) throw HttpError.conflict(`Package ${active.ref} already covers this account, date and currency; supersede it with a reason`, 'package_exists');
    }

    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: req.user!.id });
    const pkg = await prisma.$transaction(async (tx) => {
      const row = await tx.counterpartyDayEndPackage.create({
        data: {
          ref: await nextCustodianRef(tx, 'custodianDayEnd'),
          counterpartyId: c.id,
          accountRef: b.accountRef,
          statementDate,
          currency: b.currency,
          closingCash: b.closingCash,
          holdingsMv: b.holdingsMv,
          tradeCount: b.tradeCount,
          tradeQuantity: b.tradeQuantity ?? null,
          tradeNotional: b.tradeNotional ?? null,
          fileId: stored.id,
          note: b.note || null,
          status: 'Draft',
          supersedesId: b.supersedesId ?? null,
          supersedeReason: b.supersedesId ? b.supersedeReason! : null,
          submittedById: req.user!.id,
        },
      });
      await writeAudit(tx, audit(req), {
        action: 'custodian.dayend.created',
        objectType: 'custodian_day_end',
        objectId: row.id,
        after: { ref: row.ref, counterparty: c.ref, accountRef: row.accountRef, statementDate: b.statementDate, file: { name: stored.name, size: stored.size, sha256: stored.sha256 } },
      });
      return row;
    });
    // BR-194 early warning: another Draft for the same key will fail on submit with package_exists once one is active.
    const otherDrafts = await prisma.counterpartyDayEndPackage.findMany({
      where: { counterpartyId: c.id, accountRef: b.accountRef, currency: b.currency, statementDate, status: 'Draft', id: { not: pkg.id } },
      select: { ref: true },
    });
    const warnings = otherDrafts.map((d) => `Draft ${d.ref} already exists for this account, date and currency`);
    res.status(201).json({ package: dayEndView(pkg, stored), warnings });
  },
);

/** Draft -> Received. The server computes and fixes the package hash; only the preparer submits. */
custodianRoutes.post('/day-end/:id/submit', requirePermission('custodian.dayend.submit'), idempotent('custodian.dayend.submit', { required: false }), async (req, res) => {
  const c = cp(res);
  const pkg = await loadPackage(param(req, 'id'), c.id);
  if (pkg.status !== 'Draft') throw HttpError.conflict(`This package is already ${pkg.status.toLowerCase()}`, 'invalid_transition');
  if (pkg.submittedById !== req.user!.id) throw HttpError.forbidden('Only the user who prepared this package can submit it', 'not_preparer');
  if (!pkg.supersedesId) {
    const active = await prisma.counterpartyDayEndPackage.findFirst({
      where: { counterpartyId: c.id, accountRef: pkg.accountRef, currency: pkg.currency, statementDate: pkg.statementDate, status: ACTIVE, id: { not: pkg.id } },
      select: { ref: true },
    });
    if (active) throw HttpError.conflict(`Package ${active.ref} already covers this account, date and currency; supersede it with a reason`, 'package_exists');
  }
  const sha256 = await packageHash(pkg, c.ref);
  const controls = await tradeControlFor(pkg);
  const mismatch = totalsMismatch(controls);
  if (mismatch) {
    throw HttpError.conflict(
      `Declared control totals do not match the executions received (${mismatch}). Amend the executions or supersede this package.`,
      'control_total_mismatch',
    );
  }
  const approvers = await approverIds(c.id, req.user!.id);
  const updated = await prisma.$transaction(async (tx) => {
    const n = await tx.counterpartyDayEndPackage.updateMany({ where: { id: pkg.id, status: 'Draft' }, data: { status: 'Received', sha256, submittedAt: new Date() } });
    if (!n.count) throw HttpError.conflict('This package changed; reload and try again', 'invalid_transition');
    if (pkg.supersedesId) {
      const prior = await tx.counterpartyDayEndPackage.updateMany({
        where: { id: pkg.supersedesId, counterpartyId: c.id, status: { in: ['Received', 'Approved', 'Accepted'] } },
        data: { status: 'Superseded' },
      });
      if (!prior.count) throw HttpError.conflict('The package to supersede is no longer active', 'invalid_transition');
      await writeAudit(tx, audit(req), {
        action: 'custodian.dayend.superseded',
        objectType: 'custodian_day_end',
        objectId: pkg.supersedesId,
        after: { status: 'Superseded', supersededBy: pkg.ref },
        reason: pkg.supersedeReason,
      });
    }
    await writeAudit(tx, audit(req), {
      action: 'custodian.dayend.submitted',
      objectType: 'custodian_day_end',
      objectId: pkg.id,
      before: { status: 'Draft' },
      after: { status: 'Received', ref: pkg.ref, sha256, controls },
    });
    if (approvers.length) {
      await enqueue(tx, 'notify.users', {
        userIds: approvers,
        type: 'custodian.dayend.submitted',
        title: `Day-end package ${pkg.ref} awaits your approval`,
        body: `${pkg.accountRef} · ${pkg.statementDate.toISOString().slice(0, 10)} · ${pkg.currency}`,
      } satisfies NotifyUsersPayload);
    }
    return tx.counterpartyDayEndPackage.findUniqueOrThrow({ where: { id: pkg.id } });
  });
  const files = await filesById([updated.fileId]);
  res.json({ package: dayEndView(updated, updated.fileId ? files.get(updated.fileId) : null), controls });
});

/** Received -> Approved by a counterparty approver who did not submit it (Q-165). */
custodianRoutes.post('/day-end/:id/approve', requirePermission('custodian.dayend.approve'), idempotent('custodian.dayend.approve', { required: false }), async (req, res) => {
  const c = cp(res);
  const pkg = await loadPackage(param(req, 'id'), c.id);
  if (pkg.status !== 'Received') throw HttpError.conflict(`Only submitted packages can be approved (this one is ${pkg.status.toLowerCase()})`, 'invalid_transition');
  if (pkg.submittedById === req.user!.id) {
    throw HttpError.forbidden('The submitter of a day-end package cannot approve it', 'segregation_of_duties');
  }
  const sha256 = await packageHash(pkg, c.ref);
  if (sha256 !== pkg.sha256) throw HttpError.conflict('The package no longer matches its submitted fingerprint', 'integrity_mismatch');
  const updated = await prisma.$transaction(async (tx) => {
    const n = await tx.counterpartyDayEndPackage.updateMany({
      where: { id: pkg.id, status: 'Received' },
      data: { status: 'Approved', approvedById: req.user!.id, approvedAt: new Date() },
    });
    if (!n.count) throw HttpError.conflict('This package changed; reload and try again', 'invalid_transition');
    await writeAudit(tx, audit(req), {
      action: 'custodian.dayend.approved',
      objectType: 'custodian_day_end',
      objectId: pkg.id,
      before: { status: 'Received' },
      after: { status: 'Approved', ref: pkg.ref, sha256 },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'custodian.review',
      type: 'custodian.dayend.approved',
      title: `${c.name}: day-end package ${pkg.ref} ready for reconciliation`,
      body: `${pkg.accountRef} · ${pkg.statementDate.toISOString().slice(0, 10)} · ${pkg.currency}`,
      link: '/#reconciliation',
    } satisfies NotifyPermissionPayload);
    return tx.counterpartyDayEndPackage.findUniqueOrThrow({ where: { id: pkg.id } });
  });
  const files = await filesById([updated.fileId]);
  res.json({ package: dayEndView(updated, updated.fileId ? files.get(updated.fileId) : null) });
});

// ------------------------------------------------------------------ status panel

/** 5.E.3 target: this counterparty's submissions with manager status, newest first. */
custodianRoutes.get('/submissions', async (_req, res) => {
  const c = cp(res);
  const [executions, dayEnds, executionCount, dayEndCount] = await Promise.all([
    prisma.counterpartyExecution.findMany({ where: { counterpartyId: c.id }, orderBy: { submittedAt: 'desc' }, take: 50 }),
    prisma.counterpartyDayEndPackage.findMany({ where: { counterpartyId: c.id }, orderBy: { submittedAt: 'desc' }, take: 50 }),
    prisma.counterpartyExecution.count({ where: { counterpartyId: c.id } }),
    prisma.counterpartyDayEndPackage.count({ where: { counterpartyId: c.id } }),
  ]);
  const files = await filesById(dayEnds.map((d) => d.fileId));
  const reviews = await latestReviews(dayEnds.map((d) => d.id));
  res.json({
    counts: { executions: executionCount, dayEnds: dayEndCount, awaitingApproval: dayEnds.filter((d) => d.status === 'Received').length },
    executions: executions.map(executionView),
    dayEnds: dayEnds.map((d) => ({ ...dayEndView(d, d.fileId ? files.get(d.fileId) : null), review: counterpartyReview(reviews.get(d.id)) })),
  });
});

// Bulk CSV upload, amend / cancel and status history (WP-7).
custodianRoutes.use(custodianOpsRoutes);

// Native portal support: dashboard, control totals, statements and holdings, users and roles (R4-7).
custodianRoutes.use(custodianNativeRoutes);
