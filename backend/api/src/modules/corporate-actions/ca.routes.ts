import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { CA_STATUSES, CA_TYPES, ELECTION_OPTIONS, dateErrors, needsRate, needsRatio, normaliseOption, type CaType } from './ca.engine';
import { postCorporateActionJournals, reverseCorporateActionJournals } from '../wiring/autojournals';
import { applyEntitlements, auditStage, calculateEntitlements, clientEntitlements, entitlementsForClient, reverseApplied, eventDetail, eventViews, isoDay, electionOpen, loadEvent, repriceFor, startOfDay, type EventRow } from './ca.service';

/**
 * Corporate Actions (SRD 5.A.19 page `corporate-actions`, permission `operations.view`). Admin-portal staff only.
 * ANNOUNCED -> CONFIRMED -> PROCESSED, or CANCELLED before processing. `operations.view` creates, edits, confirms,
 * calculates entitlements, records elections and cancels; processing needs `corporate_actions.process` + step-up MFA
 * and the processor must differ from the creator (maker-checker). Mounted at `/api/v1/corporate-actions`.
 */
export const corporateActionsRoutes = Router();

const D = Prisma.Decimal;
const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('operations.view')];
const canWrite = [...staff, requirePermission('operations.view'), requirePermission('corporate_actions.manage')];
const canProcess = [...staff, requirePermission('operations.view'), requirePermission('corporate_actions.process')];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const dec = (max: number, label: string) =>
  z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v))
    .refine((v) => new RegExp(`^\\d+(\\.\\d{1,${max}})?$`).test(v), `${label}: enter a non-negative number (up to ${max} decimals)`)
    .transform((v) => new D(v));

const fields = {
  securityId: z.string().trim().min(1).max(36),
  type: z.enum(CA_TYPES),
  exDate: dateStr,
  recordDate: dateStr,
  payDate: dateStr,
  electionDeadline: dateStr.nullable(),
  rate: dec(8, 'Rate').nullable(),
  ratioNew: dec(6, 'Ratio (new)').nullable(),
  ratioOld: dec(6, 'Ratio (old)').nullable(),
  withholdingPct: dec(4, 'Withholding tax').refine((v) => v.lte(100), 'Withholding tax is a percent, 0 to 100'),
  targetSecurityId: z.string().trim().max(36).nullable(),
  defaultOption: z.string().trim().max(12).nullable(),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  description: z.string().trim().max(1000).nullable(),
  cashInLieu: z.boolean(),
  cilPrice: dec(8, 'Cash-in-lieu price').nullable(),
};

const createSchema = z
  .object({ securityId: fields.securityId, type: fields.type, exDate: fields.exDate, recordDate: fields.recordDate, payDate: fields.payDate })
  .extend({
    electionDeadline: fields.electionDeadline.optional(),
    rate: fields.rate.optional(),
    ratioNew: fields.ratioNew.optional(),
    ratioOld: fields.ratioOld.optional(),
    withholdingPct: fields.withholdingPct.optional(),
    targetSecurityId: fields.targetSecurityId.optional(),
    defaultOption: fields.defaultOption.optional(),
    currency: fields.currency.optional(),
    description: fields.description.optional(),
    cashInLieu: fields.cashInLieu.optional(),
    cilPrice: fields.cilPrice.optional(),
  })
  .strict();

const patchSchema = z
  .object({
    exDate: fields.exDate,
    recordDate: fields.recordDate,
    payDate: fields.payDate,
    electionDeadline: fields.electionDeadline,
    rate: fields.rate,
    ratioNew: fields.ratioNew,
    ratioOld: fields.ratioOld,
    withholdingPct: fields.withholdingPct,
    targetSecurityId: fields.targetSecurityId,
    defaultOption: fields.defaultOption,
    description: fields.description,
    cashInLieu: fields.cashInLieu,
    cilPrice: fields.cilPrice,
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

const electionSchema = z.object({ portfolioId: z.string().trim().min(1).max(36), option: z.string().trim().min(1).max(12) }).strict();
const cancelSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(1000) }).strict();

const listQuery = z.object({
  securityId: z.string().trim().max(36).optional(),
  type: z.string().trim().max(120).optional(),
  status: z.string().trim().max(120).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const upcomingQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(60) });

async function resolveSecurity(v: string, path: string) {
  const s = await prisma.security.findFirst({ where: UUID.test(v) ? { id: v } : { ticker: v.toUpperCase() } });
  if (!s) throw HttpError.badRequest('Validation failed', [{ path, message: 'Unknown security' }]);
  return s;
}

type Merged = {
  type: string;
  exDate: Date;
  recordDate: Date;
  payDate: Date;
  electionDeadline: Date | null;
  rate: Prisma.Decimal | null;
  ratioNew: Prisma.Decimal | null;
  ratioOld: Prisma.Decimal | null;
  targetSecurityId: string | null;
  defaultOption: string | null;
  cashInLieu: boolean;
  cilPrice: Prisma.Decimal | null;
};

/** Cross-field rules for the whole event, as 400 details. */
function assertValid(m: Merged, securityId: string) {
  const errs = dateErrors(m.type, m);
  if (needsRate(m.type) && !(m.rate && m.rate.gt(0))) errs.push({ path: 'rate', message: m.type === 'RIGHTS_ISSUE' ? 'The subscription price per share is required' : 'The cash per share is required' });
  if (m.type === 'MERGER' && !m.rate) errs.push({ path: 'rate', message: 'Enter the cash per share (0 if none)' });
  if (needsRatio(m.type) && !(m.ratioNew && m.ratioNew.gt(0) && m.ratioOld && m.ratioOld.gt(0))) errs.push({ path: 'ratioNew', message: 'Both sides of the ratio (new : old) must be above zero' });
  if (m.type === 'MERGER') {
    if (!m.targetSecurityId) errs.push({ path: 'targetSecurityId', message: 'The acquirer security is required for a merger' });
    else if (m.targetSecurityId === securityId) errs.push({ path: 'targetSecurityId', message: 'The acquirer must be a different security' });
  }
  if (m.cashInLieu && !(m.cilPrice && m.cilPrice.gt(0))) errs.push({ path: 'cilPrice', message: 'Enter the cash-in-lieu price per share' });
  if (m.cashInLieu && !['STOCK_SPLIT', 'BONUS_ISSUE', 'SCRIP_DIVIDEND', 'RIGHTS_ISSUE', 'MERGER'].includes(m.type)) errs.push({ path: 'cashInLieu', message: 'A cash dividend has no fractions of shares' });
  const opts = ELECTION_OPTIONS[m.type as CaType];
  if (m.defaultOption && (!opts || !opts.includes(m.defaultOption))) errs.push({ path: 'defaultOption', message: opts ? `Use ${opts.join(' or ')}` : 'This action has no election' });
  if (errs.length) throw HttpError.badRequest('Validation failed', errs);
}

async function respond(res: import('express').Response, req: import('express').Request, id: string, status = 200) {
  res.status(status).json({ data: await eventDetail(await loadEvent(id), req.user!) });
}

function assertOpen(e: EventRow, action: string) {
  if (e.status === 'PROCESSED' || e.status === 'CANCELLED' || e.status === 'REVERSED') throw new HttpError(409, 'event_immutable', `${e.ref} is ${e.status} and cannot be ${action}.`);
}

// ================================================================ list and read

corporateActionsRoutes.get('/events', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const where: Prisma.CorpActionEventWhereInput = {};
  if (f.securityId) where.securityId = UUID.test(f.securityId) ? f.securityId : ((await prisma.security.findUnique({ where: { ticker: f.securityId.toUpperCase() }, select: { id: true } }))?.id ?? '0');
  if (f.type) where.type = { in: f.type.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) };
  if (f.status) where.status = { in: f.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) };
  if (f.from || f.to) where.exDate = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  if (f.q) where.OR = [{ ref: { contains: f.q.toUpperCase() } }, { ticker: { contains: f.q } }];
  const [total, rows, grouped] = await Promise.all([
    prisma.corpActionEvent.count({ where }),
    prisma.corpActionEvent.findMany({ where, orderBy: [{ exDate: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.corpActionEvent.groupBy({ by: ['status'], where, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const upcoming = await prisma.corpActionEvent.count({ where: { status: { in: ['ANNOUNCED', 'CONFIRMED'] }, exDate: { gte: startOfDay(new Date()) } } });
  res.json({ data: await eventViews(rows), total, summary: { byStatus, upcoming, awaitingConfirmation: byStatus.ANNOUNCED ?? 0, awaitingProcessing: byStatus.CONFIRMED ?? 0, processed: byStatus.PROCESSED ?? 0 } });
});

/** Events whose ex-date, record date, pay date or election deadline falls in the next `days` days, not yet processed. */
corporateActionsRoutes.get('/upcoming', ...canView, validateQuery(upcomingQuery), async (req, res) => {
  const { days } = query<z.infer<typeof upcomingQuery>>(req);
  const from = startOfDay(new Date());
  const to = new Date(from.getTime() + days * 24 * 3600 * 1000);
  const rows = await prisma.corpActionEvent.findMany({
    where: {
      status: { in: ['ANNOUNCED', 'CONFIRMED'] },
      OR: [{ exDate: { gte: from, lte: to } }, { recordDate: { gte: from, lte: to } }, { payDate: { gte: from, lte: to } }, { electionDeadline: { gte: from, lte: to } }],
    },
    orderBy: [{ exDate: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });
  res.json({ data: await eventViews(rows), from: isoDay(from), to: isoDay(to) });
});

corporateActionsRoutes.get('/events/:id', ...canView, async (req, res) => {
  await respond(res, req, param(req, 'id'));
});

// ================================================================ create / edit

corporateActionsRoutes.post('/events', ...canWrite, validateBody(createSchema), idempotent('corp_action.create'), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const sec = await resolveSecurity(b.securityId, 'securityId');
  const target = b.targetSecurityId ? await resolveSecurity(b.targetSecurityId, 'targetSecurityId') : null;
  const m: Merged = {
    type: b.type,
    exDate: toDate(b.exDate),
    recordDate: toDate(b.recordDate),
    payDate: toDate(b.payDate),
    electionDeadline: b.electionDeadline ? toDate(b.electionDeadline) : null,
    rate: b.rate ?? null,
    ratioNew: b.ratioNew ?? null,
    ratioOld: b.ratioOld ?? null,
    targetSecurityId: target?.id ?? null,
    defaultOption: b.defaultOption ?? null,
    cashInLieu: b.cashInLieu ?? false,
    cilPrice: b.cilPrice ?? null,
  };
  assertValid(m, sec.id);
  const currency = b.currency ?? sec.currency;
  const created = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'corpAction');
    const row = await tx.corpActionEvent.create({
      data: {
        ref,
        securityId: sec.id,
        ticker: sec.ticker,
        securityName: sec.name,
        type: m.type,
        currency,
        exDate: m.exDate,
        recordDate: m.recordDate,
        payDate: m.payDate,
        electionDeadline: m.electionDeadline,
        rate: m.rate,
        ratioNew: m.ratioNew,
        ratioOld: m.ratioOld,
        withholdingPct: b.withholdingPct ?? new D(0),
        targetSecurityId: target?.id ?? null,
        targetTicker: target?.ticker ?? null,
        defaultOption: m.defaultOption ?? ELECTION_OPTIONS[m.type as CaType]?.[0] ?? null,
        cashInLieu: m.cashInLieu,
        cilPrice: m.cashInLieu ? m.cilPrice : null,
        description: b.description ?? null,
        makerId: req.user!.id,
      },
    });
    await writeAudit(tx, audit(req), {
      action: 'corp_action.created',
      objectType: 'corp_action',
      objectId: row.id,
      after: { ref, ticker: sec.ticker, type: m.type, exDate: b.exDate, recordDate: b.recordDate, payDate: b.payDate, rate: m.rate?.toString() ?? null, ratio: m.ratioNew ? `${m.ratioNew}:${m.ratioOld}` : null },
    });
    return row;
  });
  await respond(res, req, created.id, 201);
});

corporateActionsRoutes.patch('/events/:id', ...canWrite, validateBody(patchSchema), idempotent('corporate-actions.patch.events_id', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  assertOpen(e, 'edited');
  if (e.status !== 'ANNOUNCED') throw HttpError.conflict(`${e.ref} is ${e.status}; only an ANNOUNCED action can be edited`, 'invalid_state');
  const b = req.body as z.infer<typeof patchSchema>;
  const target = b.targetSecurityId ? await resolveSecurity(b.targetSecurityId, 'targetSecurityId') : null;
  const m: Merged = {
    type: e.type,
    exDate: b.exDate ? toDate(b.exDate) : e.exDate,
    recordDate: b.recordDate ? toDate(b.recordDate) : e.recordDate,
    payDate: b.payDate ? toDate(b.payDate) : e.payDate,
    electionDeadline: b.electionDeadline !== undefined ? (b.electionDeadline ? toDate(b.electionDeadline) : null) : e.electionDeadline,
    rate: b.rate !== undefined ? b.rate : e.rate,
    ratioNew: b.ratioNew !== undefined ? b.ratioNew : e.ratioNew,
    ratioOld: b.ratioOld !== undefined ? b.ratioOld : e.ratioOld,
    targetSecurityId: b.targetSecurityId !== undefined ? (target?.id ?? null) : e.targetSecurityId,
    defaultOption: b.defaultOption !== undefined ? b.defaultOption : e.defaultOption,
    cashInLieu: b.cashInLieu !== undefined ? b.cashInLieu : e.cashInLieu,
    cilPrice: b.cilPrice !== undefined ? b.cilPrice : e.cilPrice,
  };
  assertValid(m, e.securityId);
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (
        await tx.corpActionEvent.updateMany({
          where: { id: e.id, status: 'ANNOUNCED' },
          data: {
            exDate: m.exDate,
            recordDate: m.recordDate,
            payDate: m.payDate,
            electionDeadline: m.electionDeadline,
            rate: m.rate,
            ratioNew: m.ratioNew,
            ratioOld: m.ratioOld,
            ...(b.withholdingPct !== undefined ? { withholdingPct: b.withholdingPct } : {}),
            targetSecurityId: m.targetSecurityId,
            ...(b.targetSecurityId !== undefined ? { targetTicker: target?.ticker ?? null } : {}),
            defaultOption: m.defaultOption,
            cashInLieu: m.cashInLieu,
            cilPrice: m.cashInLieu ? m.cilPrice : null,
            ...(b.description !== undefined ? { description: b.description } : {}),
            // entitlements depend on these terms: force a recalculation
            entitlementsAt: null,
          },
        })
      ).count,
    );
    await tx.corpActionEntitlement.deleteMany({ where: { eventId: e.id } });
    await auditStage(tx, req, e);
    await writeAudit(tx, audit(req), {
      action: 'corp_action.updated',
      objectType: 'corp_action',
      objectId: e.id,
      before: { exDate: isoDay(e.exDate), recordDate: isoDay(e.recordDate), payDate: isoDay(e.payDate), rate: e.rate?.toString() ?? null, ratio: e.ratioNew ? `${e.ratioNew}:${e.ratioOld}` : null },
      after: { exDate: isoDay(m.exDate), recordDate: isoDay(m.recordDate), payDate: isoDay(m.payDate), rate: m.rate?.toString() ?? null, ratio: m.ratioNew ? `${m.ratioNew}:${m.ratioOld}` : null },
    });
  });
  await respond(res, req, e.id);
});

// ================================================================ lifecycle

corporateActionsRoutes.post('/events/:id/confirm', ...canWrite, idempotent('corp_action.confirm', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  assertOpen(e, 'confirmed');
  if (e.status !== 'ANNOUNCED') throw HttpError.conflict(`${e.ref} is ${e.status}; it must be ANNOUNCED to confirm`, 'invalid_state');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.corpActionEvent.updateMany({ where: { id: e.id, status: 'ANNOUNCED' }, data: { status: 'CONFIRMED', confirmedBy: req.user!.id, confirmedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'corp_action.confirmed', objectType: 'corp_action', objectId: e.id, before: { status: 'ANNOUNCED' }, after: { status: 'CONFIRMED', ref: e.ref, confirmedBy: req.user!.id } });
    await notifyPermission(tx, 'corporate_actions.process', {
      type: 'corp_action.confirmed',
      title: `${e.ref} ${e.ticker} is confirmed`,
      body: `Ex-date ${isoDay(e.exDate)}, pay date ${isoDay(e.payDate)}. Calculate entitlements and process it.`,
      link: `/ops/corporate-actions/${e.id}`,
    });
  });
  await respond(res, req, e.id);
});

corporateActionsRoutes.post('/events/:id/entitlements/calculate', ...canWrite, idempotent('corp_action.calculate', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  assertOpen(e, 'recalculated');
  await calculateEntitlements(req, e);
  await respond(res, req, e.id);
});

corporateActionsRoutes.put('/events/:id/elections', ...canWrite, validateBody(electionSchema), idempotent('corporate-actions.put.events_id_elections', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  assertOpen(e, 'changed');
  if (e.instructedAt) throw HttpError.conflict(`${e.ref} has been instructed to the custodian; elections are closed`, 'election_closed');
  const opts = ELECTION_OPTIONS[e.type as CaType];
  if (!opts) throw HttpError.conflict(`${e.ref} is a ${e.type.toLowerCase().replace(/_/g, ' ')}; it has no election`, 'no_election');
  if (!electionOpen(e)) throw HttpError.conflict(`The election deadline ${isoDay(e.electionDeadline)} has passed`, 'election_closed');
  const b = req.body as z.infer<typeof electionSchema>;
  const option = b.option.toUpperCase();
  if (!opts.includes(option)) throw HttpError.badRequest('Validation failed', [{ path: 'option', message: `Use ${opts.join(' or ')}` }]);
  const pid = UUID.test(b.portfolioId) ? b.portfolioId : ((await prisma.portfolio.findUnique({ where: { ref: b.portfolioId }, select: { id: true } }))?.id ?? '0');
  const ent = await prisma.corpActionEntitlement.findUnique({ where: { eventId_portfolioId: { eventId: e.id, portfolioId: pid } } });
  if (!ent) throw HttpError.notFound('That portfolio has no entitlement on this action. Calculate the entitlements first.');
  const re = repriceFor(e, ent.quantity, normaliseOption(e.type, option, null));
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.corpActionEntitlement.updateMany({ where: { id: ent.id, status: 'PENDING' }, data: { ...re, elected: true, electedBy: req.user!.id, electedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), {
      action: 'corp_action.election_recorded',
      objectType: 'corp_action',
      objectId: e.id,
      before: { portfolioId: pid, option: ent.option, elected: ent.elected },
      after: { portfolioId: pid, option, cash: re.cashAmount.toFixed(4), sharesDelta: re.sharesDelta.toString() },
    });
  });
  await respond(res, req, e.id);
});

corporateActionsRoutes.post('/events/:id/process', ...canProcess, requireStepUp, idempotent('corp_action.process', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  assertOpen(e, 'processed again');
  if (e.status !== 'CONFIRMED') throw HttpError.conflict(`${e.ref} is ${e.status}; it must be CONFIRMED to process`, 'invalid_state');
  if (e.makerId === req.user!.id) throw HttpError.forbidden('The creator cannot process the same corporate action (maker-checker)', 'segregation_of_duties');
  if (!e.entitlementsAt) throw HttpError.conflict('Calculate the entitlements before processing', 'entitlements_required');
  const out = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.corpActionEvent.updateMany({ where: { id: e.id, status: 'CONFIRMED' }, data: { status: 'PROCESSED', processedBy: req.user!.id, processedAt: new Date() } })).count);
    const fresh = await tx.corpActionEvent.findUniqueOrThrow({ where: { id: e.id } });
    const summary = await applyEntitlements(tx, fresh);
    if (summary.applied === 0) throw HttpError.conflict('No portfolio holds this security at the record date; nothing to process', 'no_entitlements');
    await tx.corpActionEvent.update({ where: { id: e.id }, data: { detail: summary as unknown as Prisma.InputJsonValue } });
    // Cash legs book to Accounting and the cash ledger as PENDING_APPROVAL journals made by the system actor (idempotent per action and portfolio).
    const appliedRows = await tx.corpActionEntitlement.findMany({ where: { eventId: e.id, status: 'APPLIED' }, select: { portfolioId: true, grossAmount: true, taxAmount: true, cashAmount: true, cashInLieu: true, detail: true } });
    const applied = appliedRows.map((a) => ({ portfolioId: a.portfolioId, grossAmount: a.grossAmount, taxAmount: a.taxAmount, cashAmount: a.cashAmount, cashInLieu: a.cashInLieu, cilCost: new D(((a.detail ?? {}) as { cilCost?: string }).cilCost ?? 0) }));
    const journals = await postCorporateActionJournals(tx, fresh, applied);
    await auditStage(tx, req, e);
    await writeAudit(tx, audit(req), { action: 'corp_action.processed', objectType: 'corp_action', objectId: e.id, before: { status: 'CONFIRMED' }, after: { status: 'PROCESSED', ref: e.ref, creatorId: e.makerId, processedBy: req.user!.id, ...summary, journals: journals.map((j) => ({ portfolioId: j.portfolioId, accounting: j.accounting.ref ?? j.accounting.skipped, cash: j.cash?.ref ?? j.cash?.skipped ?? null })) } });
    return { summary, journals };
  });
  const detail = await eventDetail(await loadEvent(e.id), req.user!);
  res.json({ data: { ...detail, applied: out.summary, journals: out.journals.map((j) => ({ portfolioId: j.portfolioId, accountingJournal: j.accounting.ref ?? null, accountingSkipped: j.accounting.skipped ?? null, cashJournal: j.cash?.ref ?? null, cashSkipped: j.cash?.skipped ?? null })) } });
});

/** FR-OPS-015: instructions go to the custodian once entitlements are projected and the action is confirmed; elections and entitlements are frozen from here. */
corporateActionsRoutes.post('/events/:id/instruct', ...canWrite, idempotent('corp_action.instruct', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  assertOpen(e, 'instructed');
  if (e.instructedAt) throw HttpError.conflict(`${e.ref} is already instructed`, 'already_instructed');
  if (e.status !== 'CONFIRMED') throw HttpError.conflict(`${e.ref} is ${e.status}; it must be CONFIRMED to instruct`, 'invalid_state');
  if (!e.entitlementsAt) throw HttpError.conflict('Calculate the entitlements before instructing', 'entitlements_required');
  if ((await prisma.corpActionEntitlement.count({ where: { eventId: e.id } })) === 0) throw HttpError.conflict('No portfolio holds this security at the record date; nothing to instruct', 'no_entitlements');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.corpActionEvent.updateMany({ where: { id: e.id, status: 'CONFIRMED', instructedAt: null }, data: { instructedBy: req.user!.id, instructedAt: new Date() } })).count);
    await auditStage(tx, req, e);
    await writeAudit(tx, audit(req), { action: 'corp_action.instructed', objectType: 'corp_action', objectId: e.id, after: { ref: e.ref, instructedBy: req.user!.id } });
    await notifyPermission(tx, 'corporate_actions.process', { type: 'corp_action.instructed', title: `${e.ref} ${e.ticker} is instructed`, body: 'Instructions are sent. It is ready to process.', link: `/ops/corporate-actions/${e.id}` });
  });
  await respond(res, req, e.id);
});

/** FR-OPS-015: a PROCESSED action is Reconciled once the custodian's position and cash match the booked entitlements. */
corporateActionsRoutes.post('/events/:id/reconcile', ...canWrite, idempotent('corp_action.reconcile', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  if (e.reconciledAt) throw HttpError.conflict(`${e.ref} is already reconciled`, 'already_reconciled');
  if (e.status !== 'PROCESSED') throw HttpError.conflict(`${e.ref} is ${e.status}; only a PROCESSED action can be reconciled`, 'invalid_state');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.corpActionEvent.updateMany({ where: { id: e.id, status: 'PROCESSED', reconciledAt: null }, data: { reconciledBy: req.user!.id, reconciledAt: new Date() } })).count);
    await auditStage(tx, req, e);
    await writeAudit(tx, audit(req), { action: 'corp_action.reconciled', objectType: 'corp_action', objectId: e.id, after: { ref: e.ref, reconciledBy: req.user!.id } });
  });
  await respond(res, req, e.id);
});

const reverseSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(1000) }).strict();

/**
 * Reversal by adjustment (never edits history): positions, cost and cash are put back with new append-by-date rows dated
 * today, pending journals are discarded and posted ones get an inverse pending journal. Needs the process permission,
 * step-up MFA, and a different person from the one who processed it.
 */
corporateActionsRoutes.post('/events/:id/reverse', ...canProcess, requireStepUp, validateBody(reverseSchema), idempotent('corp_action.reverse', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  if (e.status === 'REVERSED') throw HttpError.conflict(`${e.ref} is already reversed`, 'already_reversed');
  if (e.status !== 'PROCESSED') throw HttpError.conflict(`${e.ref} is ${e.status}; only a PROCESSED action can be reversed`, 'invalid_state');
  if (e.processedBy === req.user!.id) throw HttpError.forbidden('The person who processed this action cannot reverse it (maker-checker)', 'segregation_of_duties');
  const b = req.body as z.infer<typeof reverseSchema>;
  const out = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.corpActionEvent.updateMany({ where: { id: e.id, status: 'PROCESSED' }, data: { status: 'REVERSED', reversedBy: req.user!.id, reversedAt: new Date(), reverseReason: b.reason } })).count);
    const summary = await reverseApplied(tx, e);
    const journals = await reverseCorporateActionJournals(tx, e, summary.portfolios, b.reason, startOfDay(new Date()));
    await auditStage(tx, req, e);
    await writeAudit(tx, audit(req), { action: 'corp_action.reversed', objectType: 'corp_action', objectId: e.id, before: { status: 'PROCESSED' }, after: { status: 'REVERSED', ref: e.ref, processedBy: e.processedBy, reversedBy: req.user!.id, ...summary, journals }, reason: b.reason });
    await notifyPermission(tx, 'operations.view', { type: 'corp_action.reversed', title: `${e.ref} ${e.ticker} was reversed`, body: b.reason.slice(0, 200), link: `/ops/corporate-actions/${e.id}` });
    return { summary, journals };
  });
  const detail = await eventDetail(await loadEvent(e.id), req.user!);
  res.json({ data: { ...detail, reversal: out } });
});

/** Entitlements rolled up per client (portfolio.client_id). */
corporateActionsRoutes.get('/events/:id/clients', ...canView, async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  res.json({ data: await clientEntitlements(e.id) });
});

/** Everything one client is entitled to across their portfolios. */
corporateActionsRoutes.get('/clients/:clientId/entitlements', ...canView, async (req, res) => {
  const id = param(req, 'clientId');
  const c = await prisma.client.findFirst({ where: UUID.test(id) ? { id } : { ref: id.toUpperCase() }, select: { id: true, ref: true, name: true } });
  if (!c) throw HttpError.notFound('Client not found');
  res.json({ data: { client: c, entitlements: await entitlementsForClient(c.id) } });
});

corporateActionsRoutes.post('/events/:id/cancel', ...canWrite, validateBody(cancelSchema), idempotent('corp_action.cancel', { required: false }), async (req, res) => {
  const e = await loadEvent(param(req, 'id'));
  assertOpen(e, 'cancelled');
  const b = req.body as z.infer<typeof cancelSchema>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.corpActionEvent.updateMany({ where: { id: e.id, status: e.status }, data: { status: 'CANCELLED', cancelledBy: req.user!.id, cancelledAt: new Date(), cancelReason: b.reason } })).count);
    await auditStage(tx, req, e);
    await writeAudit(tx, audit(req), { action: 'corp_action.cancelled', objectType: 'corp_action', objectId: e.id, before: { status: e.status }, after: { status: 'CANCELLED', ref: e.ref }, reason: b.reason });
  });
  await respond(res, req, e.id);
});

void CA_STATUSES;
