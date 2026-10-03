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
import { requireAnyPermission, requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { BINDING_PURPOSES, REVIEW_MONTHS, addMonths, openDueReviews } from './mg.usage';

/**
 * Model Governance (SRD 5.A page `model-governance`, permission `risk.view`). Admin-portal staff only, mounted at
 * `/api/v1/model-governance`. `risk.manage` registers models and drafts versions; `model.approve` validates and
 * approves. A version moves DRAFT -> SUBMITTED -> VALIDATED -> APPROVED (or REJECTED); the author, the validator and
 * the approver must be three different people, approval needs step-up MFA, and only an APPROVED version can be used:
 * the usage log refuses a model without one.
 */
export const modelRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('risk.view')];
const canAuthor = [...staff, requirePermission('risk.view', 'risk.manage')];
const canValidate = [...staff, requirePermission('risk.view', 'model.approve')];
const canLogUsage = [...staff, requirePermission('risk.view'), requireAnyPermission('risk.manage', 'portfolio.manage', 'valuation.release', 'model.approve')];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_TYPES = ['PRICING', 'RISK', 'CREDIT', 'SCORING', 'FORECAST', 'OTHER'] as const;
const OUTCOMES = ['PASS', 'PASS_WITH_FINDINGS', 'FAIL'] as const;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
const sod = (m: string) => HttpError.forbidden(m, 'sod_violation');
const IN_FLIGHT = ['DRAFT', 'SUBMITTED', 'VALIDATED'];

async function names(ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = u.length ? await prisma.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

type ModelRow = Prisma.GovModelGetPayload<{ include: { versions: true } }>;
const modelInclude = { versions: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.GovModelInclude;
async function loadModel(id: string): Promise<ModelRow> {
  const m = await prisma.govModel.findFirst({ where: UUID.test(id) ? { id } : { ref: id }, include: modelInclude });
  if (!m) throw HttpError.notFound('Model not found');
  return m;
}
async function loadVersion(id: string) {
  const v = await prisma.govModelVersion.findUnique({ where: { id }, include: { model: true, validations: { orderBy: { createdAt: 'asc' } } } });
  if (!v) throw HttpError.notFound('Model version not found');
  return v;
}

async function modelViews(rows: ModelRow[]) {
  const today = startOfDay(new Date());
  const usage = rows.length ? await prisma.govModelUsage.groupBy({ by: ['modelId'], where: { modelId: { in: rows.map((r) => r.id) } }, _count: { _all: true }, _max: { usedAt: true } }) : [];
  const u = new Map(usage.map((x) => [x.modelId, x]));
  return rows.map((m) => {
    const cur = m.versions.find((v) => v.id === m.currentVersionId);
    const inflight = m.versions.find((v) => IN_FLIGHT.includes(v.status));
    return {
      id: m.id,
      ref: m.ref,
      name: m.name,
      purpose: m.purpose,
      modelType: m.modelType,
      tier: m.tier,
      ownerName: m.ownerName,
      status: m.status,
      currentVersion: cur?.version ?? null,
      inFlightVersion: inflight ? { id: inflight.id, version: inflight.version, status: inflight.status } : null,
      nextReviewOn: day(m.nextReviewOn),
      reviewOverdue: !!m.nextReviewOn && m.status === 'APPROVED' && m.nextReviewOn.getTime() < today.getTime(),
      usageCount: u.get(m.id)?._count._all ?? 0,
      lastUsedAt: u.get(m.id)?._max.usedAt?.toISOString() ?? null,
      versions: m.versions.length,
    };
  });
}

// ================================================================ models

const listQuery = z.object({
  status: z.string().trim().max(80).optional(),
  modelType: z.enum(MODEL_TYPES).optional(),
  tier: z.coerce.number().int().min(1).max(3).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
modelRoutes.get('/models', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const statuses = f.status?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const where: Prisma.GovModelWhereInput = {
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...(f.modelType ? { modelType: f.modelType } : {}),
    ...(f.tier ? { tier: f.tier } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q } }, { ref: { contains: f.q } }, { ownerName: { contains: f.q } }] } : {}),
  };
  const [rows, total] = await Promise.all([prisma.govModel.findMany({ where, include: modelInclude, orderBy: { ref: 'asc' }, take: f.limit, skip: f.offset }), prisma.govModel.count({ where })]);
  res.json({ data: await modelViews(rows), total });
});

modelRoutes.get('/models/:id', ...canView, async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  const [view] = await modelViews([m]);
  const vids = m.versions.map((v) => v.id);
  const validations = vids.length ? await prisma.govModelValidation.findMany({ where: { versionId: { in: vids } }, orderBy: { createdAt: 'asc' } }) : [];
  const events = await prisma.auditEvent.findMany({ where: { objectType: 'gov_model', objectId: m.id }, orderBy: { id: 'asc' }, take: 200 });
  const n = await names([...m.versions.flatMap((v) => [v.authorId, v.approvedBy]), ...validations.map((v) => v.validatorId), ...events.map((e) => e.actorId), m.createdBy]);
  const me = req.user!;
  const has = (p: string) => me.permissions.includes(p);
  res.json({
    data: {
      ...view,
      createdBy: n.get(m.createdBy) ?? null,
      versionList: m.versions
        .map((v) => {
          const vals = validations.filter((x) => x.versionId === v.id);
          const lastVal = vals[vals.length - 1];
          return {
            id: v.id,
            version: v.version,
            status: v.status,
            changeNote: v.changeNote,
            documentation: v.documentation,
            author: n.get(v.authorId) ?? null,
            submittedAt: v.submittedAt?.toISOString() ?? null,
            approvedBy: v.approvedBy ? n.get(v.approvedBy) ?? null : null,
            approvedAt: v.approvedAt?.toISOString() ?? null,
            decisionNote: v.decisionNote,
            isCurrent: v.id === m.currentVersionId,
            validations: vals.map((x) => ({ id: x.id, validator: n.get(x.validatorId) ?? null, outcome: x.outcome, scope: x.scope, findings: x.findings, evidenceRef: x.evidenceRef, performedOn: day(x.performedOn) })),
            actions: {
              submit: v.status === 'DRAFT' && v.authorId === me.id,
              validate: ['SUBMITTED', 'VALIDATED'].includes(v.status) && has('model.approve') && v.authorId !== me.id,
              approve: v.status === 'VALIDATED' && has('model.approve') && v.authorId !== me.id && lastVal?.validatorId !== me.id,
              reject: ['SUBMITTED', 'VALIDATED'].includes(v.status) && has('model.approve') && v.authorId !== me.id,
            },
          };
        })
        .reverse(),
      timeline: events.map((e) => ({ at: e.occurredAt.toISOString(), action: e.action, actor: e.actorId ? n.get(e.actorId) ?? null : null, reason: e.reason })),
    },
  });
});

const modelBody = z
  .object({
    name: z.string().trim().min(3).max(160),
    purpose: z.string().trim().min(10, 'Describe what the model is used for (10+ characters)').max(600),
    modelType: z.enum(MODEL_TYPES),
    tier: z.coerce.number().int().min(1).max(3).default(2),
    ownerName: z.string().trim().min(2).max(120),
    nextReviewOn: dateStr.optional(),
    changeNote: z.string().trim().min(3).max(1000).default('Initial version'),
    documentation: z.string().trim().max(300).optional(),
  })
  .strict();

modelRoutes.post('/models', ...canAuthor, validateBody(modelBody), idempotent('model.create'), async (req, res) => {
  const b = req.body as z.infer<typeof modelBody>;
  if (await prisma.govModel.findFirst({ where: { name: b.name }, select: { id: true } })) throw HttpError.conflict(`A model named "${b.name}" is already registered`, 'duplicate_model');
  const id = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'govModel');
    const m = await tx.govModel.create({ data: { ref, name: b.name, purpose: b.purpose, modelType: b.modelType, tier: b.tier, ownerName: b.ownerName, nextReviewOn: b.nextReviewOn ? toDate(b.nextReviewOn) : null, createdBy: req.user!.id } });
    await tx.govModelVersion.create({ data: { modelId: m.id, version: '1.0', changeNote: b.changeNote, documentation: b.documentation ?? null, authorId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'model.registered', objectType: 'gov_model', objectId: m.id, after: { ref, name: b.name, modelType: b.modelType, tier: b.tier, ownerName: b.ownerName } });
    return m.id;
  });
  const m = await loadModel(id);
  res.status(201).json({ data: (await modelViews([m]))[0] });
});

const modelPatch = z.object({ purpose: z.string().trim().min(10).max(600), ownerName: z.string().trim().min(2).max(120), tier: z.coerce.number().int().min(1).max(3), nextReviewOn: dateStr }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');
modelRoutes.patch('/models/:id', ...canAuthor, validateBody(modelPatch), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  if (m.status === 'RETIRED') throw HttpError.conflict(`${m.ref} is retired and cannot be edited`, 'invalid_state');
  const b = req.body as z.infer<typeof modelPatch>;
  await prisma.$transaction(async (tx) => {
    await tx.govModel.update({ where: { id: m.id }, data: { ...(b.purpose ? { purpose: b.purpose } : {}), ...(b.ownerName ? { ownerName: b.ownerName } : {}), ...(b.tier ? { tier: b.tier } : {}), ...(b.nextReviewOn ? { nextReviewOn: toDate(b.nextReviewOn) } : {}) } });
    await writeAudit(tx, audit(req), { action: 'model.updated', objectType: 'gov_model', objectId: m.id, before: { purpose: m.purpose, ownerName: m.ownerName, tier: m.tier, nextReviewOn: day(m.nextReviewOn) }, after: b });
  });
  res.json({ data: (await modelViews([await loadModel(m.id)]))[0] });
});

modelRoutes.post('/models/:id/retire', ...canValidate, requireStepUp, validateBody(reasonSchema), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  if (m.status === 'RETIRED') throw HttpError.conflict(`${m.ref} is already retired`, 'invalid_state');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.govModel.updateMany({ where: { id: m.id, status: m.status }, data: { status: 'RETIRED', currentVersionId: null } })).count);
    await tx.govModelVersion.updateMany({ where: { modelId: m.id, status: { in: ['DRAFT', 'SUBMITTED', 'VALIDATED', 'APPROVED'] } }, data: { status: 'RETIRED' } });
    await writeAudit(tx, audit(req), { action: 'model.retired', objectType: 'gov_model', objectId: m.id, before: { status: m.status }, after: { status: 'RETIRED' }, reason });
  });
  res.json({ data: (await modelViews([await loadModel(m.id)]))[0] });
});

// ================================================================ versions

const versionBody = z.object({ version: z.string().trim().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/, 'Use a short version label such as 1.1 or 2.0-rc1'), changeNote: z.string().trim().min(3).max(1000), documentation: z.string().trim().max(300).optional() }).strict();
modelRoutes.post('/models/:id/versions', ...canAuthor, validateBody(versionBody), idempotent('model.version_create'), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  if (m.status === 'RETIRED') throw HttpError.conflict(`${m.ref} is retired`, 'invalid_state');
  const b = req.body as z.infer<typeof versionBody>;
  if (m.versions.some((v) => v.version === b.version)) throw HttpError.conflict(`Version ${b.version} already exists`, 'duplicate_version');
  const open = m.versions.find((v) => IN_FLIGHT.includes(v.status));
  if (open) throw HttpError.conflict(`Version ${open.version} is still ${open.status}; finish or reject it before drafting another`, 'version_in_flight');
  const v = await prisma.$transaction(async (tx) => {
    const row = await tx.govModelVersion.create({ data: { modelId: m.id, version: b.version, changeNote: b.changeNote, documentation: b.documentation ?? null, authorId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'model.version_drafted', objectType: 'gov_model', objectId: m.id, after: { version: b.version, changeNote: b.changeNote } });
    return row;
  });
  res.status(201).json({ data: { id: v.id, version: v.version, status: v.status } });
});

modelRoutes.post('/versions/:vid/submit', ...canAuthor, async (req, res) => {
  const v = await loadVersion(param(req, 'vid'));
  if (v.status !== 'DRAFT') throw HttpError.conflict(`Version ${v.version} is ${v.status}; only a DRAFT can be submitted for validation`, 'invalid_state');
  if (v.authorId !== req.user!.id) throw sod('Only the author can submit this version');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.govModelVersion.updateMany({ where: { id: v.id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedAt: new Date() } })).count);
    if (v.model.status === 'DRAFT') await tx.govModel.update({ where: { id: v.modelId }, data: { status: 'IN_VALIDATION' } });
    await writeAudit(tx, audit(req), { action: 'model.version_submitted', objectType: 'gov_model', objectId: v.modelId, before: { version: v.version, status: 'DRAFT' }, after: { version: v.version, status: 'SUBMITTED' } });
    await notifyPermission(tx, 'model.approve', { type: 'model.validation', title: `${v.model.ref} v${v.version} awaits validation`, body: `${v.model.name}: ${v.changeNote.slice(0, 120)}`, link: `/ops/model-governance?model=${v.modelId}` });
  });
  res.json({ data: { id: v.id, status: 'SUBMITTED' } });
});

const validationBody = z
  .object({ outcome: z.enum(OUTCOMES), scope: z.string().trim().min(5, 'Describe what was tested (5+ characters)').max(300), findings: z.string().trim().max(2000).optional(), evidenceRef: z.string().trim().max(200).optional(), performedOn: dateStr.optional() })
  .strict()
  .refine((b) => b.outcome === 'PASS' || (b.findings && b.findings.length >= 5), { path: ['findings'], message: 'Record the findings (5+ characters) unless the outcome is PASS' });

modelRoutes.post('/versions/:vid/validations', ...canValidate, validateBody(validationBody), idempotent('model.validation_record'), async (req, res) => {
  const v = await loadVersion(param(req, 'vid'));
  if (!['SUBMITTED', 'VALIDATED'].includes(v.status)) throw HttpError.conflict(`Version ${v.version} is ${v.status}; only a submitted version can be validated`, 'invalid_state');
  if (v.authorId === req.user!.id) throw sod('The author cannot validate their own model version');
  const b = req.body as z.infer<typeof validationBody>;
  const performedOn = b.performedOn ? toDate(b.performedOn) : startOfDay(new Date());
  if (performedOn.getTime() > startOfDay(new Date()).getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'performedOn', message: 'The validation date cannot be in the future' }]);
  const next = b.outcome === 'FAIL' ? 'REJECTED' : 'VALIDATED';
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.govModelValidation.create({ data: { versionId: v.id, validatorId: req.user!.id, outcome: b.outcome, scope: b.scope, findings: b.findings ?? null, evidenceRef: b.evidenceRef ?? null, performedOn } });
    assertUpdated((await tx.govModelVersion.updateMany({ where: { id: v.id, status: v.status }, data: { status: next, ...(next === 'REJECTED' ? { decisionNote: `Failed validation: ${(b.findings ?? '').slice(0, 450)}` } : {}) } })).count);
    if (next === 'REJECTED' && v.model.status === 'IN_VALIDATION') await tx.govModel.update({ where: { id: v.modelId }, data: { status: 'DRAFT' } });
    await writeAudit(tx, audit(req), { action: 'model.validation_recorded', objectType: 'gov_model', objectId: v.modelId, before: { version: v.version, status: v.status }, after: { version: v.version, status: next, outcome: b.outcome, scope: b.scope } });
    return r;
  });
  res.status(201).json({ data: { id: row.id, outcome: row.outcome, versionStatus: next } });
});

modelRoutes.post('/versions/:vid/approve', ...canValidate, requireStepUp, idempotent('model.version_approve', { required: false }), async (req, res) => {
  const v = await loadVersion(param(req, 'vid'));
  if (v.status !== 'VALIDATED') throw HttpError.conflict(`Version ${v.version} is ${v.status}; it must be VALIDATED before approval`, 'invalid_state');
  if (v.authorId === req.user!.id) throw sod('The author cannot approve their own model version');
  const last = v.validations[v.validations.length - 1];
  if (!last || last.outcome === 'FAIL') throw HttpError.conflict('There is no passing validation on record', 'not_validated');
  if (last.validatorId === req.user!.id) throw sod('The validator cannot also approve; a third person approves (maker-checker)');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.govModelVersion.updateMany({ where: { id: v.id, status: 'VALIDATED' }, data: { status: 'APPROVED', approvedBy: req.user!.id, approvedAt: now } })).count);
    await tx.govModelVersion.updateMany({ where: { modelId: v.modelId, status: 'APPROVED', id: { not: v.id } }, data: { status: 'RETIRED', decisionNote: `Superseded by ${v.version}` } });
    const review = v.model.nextReviewOn ?? new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
    await tx.govModel.update({ where: { id: v.modelId }, data: { status: 'APPROVED', currentVersionId: v.id, nextReviewOn: review.getTime() < now.getTime() ? new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())) : review } });
    await writeAudit(tx, audit(req), { action: 'model.version_approved', objectType: 'gov_model', objectId: v.modelId, before: { version: v.version, status: 'VALIDATED' }, after: { version: v.version, status: 'APPROVED', validatedBy: last.validatorId } });
  });
  res.json({ data: (await modelViews([await loadModel(v.modelId)]))[0] });
});

modelRoutes.post('/versions/:vid/reject', ...canValidate, validateBody(reasonSchema), async (req, res) => {
  const v = await loadVersion(param(req, 'vid'));
  if (!['SUBMITTED', 'VALIDATED'].includes(v.status)) throw HttpError.conflict(`Version ${v.version} is ${v.status}; it cannot be rejected`, 'invalid_state');
  if (v.authorId === req.user!.id) throw sod('The author cannot reject their own version; discard it by drafting a new one');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.govModelVersion.updateMany({ where: { id: v.id, status: v.status }, data: { status: 'REJECTED', decisionNote: reason } })).count);
    if (v.model.status === 'IN_VALIDATION') await tx.govModel.update({ where: { id: v.modelId }, data: { status: 'DRAFT' } });
    await writeAudit(tx, audit(req), { action: 'model.version_rejected', objectType: 'gov_model', objectId: v.modelId, before: { version: v.version, status: v.status }, after: { version: v.version, status: 'REJECTED' }, reason });
  });
  res.json({ data: { id: v.id, status: 'REJECTED' } });
});

// ================================================================ usage log

const usageBody = z.object({ context: z.string().trim().min(3).max(200), objectRef: z.string().trim().max(60).optional(), note: z.string().trim().max(500).optional(), versionId: z.string().trim().max(36).optional() }).strict();
modelRoutes.post('/models/:id/usage', ...canLogUsage, validateBody(usageBody), idempotent('model.usage_log', { required: false }), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  const b = req.body as z.infer<typeof usageBody>;
  if (m.status !== 'APPROVED' || !m.currentVersionId) throw HttpError.conflict(`${m.ref} has no approved version (status ${m.status}); it cannot be used`, 'model_not_approved');
  const versionId = b.versionId ?? m.currentVersionId;
  const v = m.versions.find((x) => x.id === versionId);
  if (!v) throw HttpError.badRequest('Validation failed', [{ path: 'versionId', message: 'Unknown version of this model' }]);
  if (v.status !== 'APPROVED') throw HttpError.conflict(`Version ${v.version} is ${v.status}; only an approved version can be used`, 'version_not_approved');
  const overdue = !!m.nextReviewOn && m.nextReviewOn.getTime() < startOfDay(new Date()).getTime();
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.govModelUsage.create({ data: { modelId: m.id, versionId, context: b.context, objectRef: b.objectRef ?? null, note: b.note ?? null, usedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'model.used', objectType: 'gov_model', objectId: m.id, after: { version: v.version, context: b.context, objectRef: b.objectRef ?? null } });
    return u;
  });
  res.status(201).json({ data: { id: row.id, version: v.version, usedAt: row.usedAt.toISOString() }, ...(overdue ? { warning: `The periodic review of ${m.ref} was due on ${day(m.nextReviewOn)}` } : {}) });
});

const usageQuery = z.object({ modelId: z.string().trim().max(36).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
modelRoutes.get('/usage', ...canView, validateQuery(usageQuery), async (req, res) => {
  const f = query<z.infer<typeof usageQuery>>(req);
  const where: Prisma.GovModelUsageWhereInput = f.modelId ? { modelId: f.modelId } : {};
  const [rows, total] = await Promise.all([prisma.govModelUsage.findMany({ where, include: { model: { select: { ref: true, name: true, versions: { select: { id: true, version: true } } } } }, orderBy: { usedAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.govModelUsage.count({ where })]);
  const n = await names(rows.map((r) => r.usedBy));
  res.json({ data: rows.map((u) => ({ id: u.id, modelId: u.modelId, modelRef: u.model.ref, modelName: u.model.name, version: u.model.versions.find((x) => x.id === u.versionId)?.version ?? null, context: u.context, objectRef: u.objectRef, note: u.note, usedBy: n.get(u.usedBy) ?? null, usedAt: u.usedAt.toISOString() })), total });
});

// ================================================================ summary

modelRoutes.get('/summary', ...canView, async (_req, res) => {
  const today = startOfDay(new Date());
  const [byStatus, byTier, overdue, awaiting, uses30] = await Promise.all([
    prisma.govModel.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.govModel.groupBy({ by: ['tier'], where: { status: { not: 'RETIRED' } }, _count: { _all: true } }),
    prisma.govModel.count({ where: { status: 'APPROVED', nextReviewOn: { lt: today } } }),
    prisma.govModelVersion.groupBy({ by: ['status'], where: { status: { in: ['SUBMITTED', 'VALIDATED'] } }, _count: { _all: true } }),
    prisma.govModelUsage.count({ where: { usedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  res.json({ data: { byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])), byTier: Object.fromEntries(byTier.map((s) => [`tier${s.tier}`, s._count._all])), reviewsOverdue: overdue, awaitingValidation: awaiting.find((a) => a.status === 'SUBMITTED')?._count._all ?? 0, awaitingApproval: awaiting.find((a) => a.status === 'VALIDATED')?._count._all ?? 0, usesLast30Days: uses30 } });
});

// ================================================================ periodic reviews (OPEN -> SUBMITTED -> COMPLETED)

const REVIEW_OUTCOMES = ['CONFIRMED', 'CHANGES_REQUIRED', 'RETIRE'] as const;
type ReviewRow = Prisma.GovModelReviewGetPayload<object>;
async function reviewViews(rows: ReviewRow[]) {
  const [models, n] = await Promise.all([
    prisma.govModel.findMany({ where: { id: { in: rows.map((r) => r.modelId) } }, select: { id: true, ref: true, name: true, tier: true, status: true } }),
    names(rows.flatMap((r) => [r.openedBy, r.reviewerId, r.approverId])),
  ]);
  const m = new Map(models.map((x) => [x.id, x]));
  const today = startOfDay(new Date());
  return rows.map((r) => ({
    id: r.id,
    modelId: r.modelId,
    modelRef: m.get(r.modelId)?.ref ?? null,
    modelName: m.get(r.modelId)?.name ?? null,
    tier: m.get(r.modelId)?.tier ?? null,
    status: r.status,
    dueOn: day(r.dueOn),
    overdue: ['OPEN', 'SUBMITTED'].includes(r.status) && r.dueOn.getTime() < today.getTime(),
    openedBy: n.get(r.openedBy) ?? null,
    openedAt: r.openedAt.toISOString(),
    reviewer: r.reviewerId ? n.get(r.reviewerId) ?? null : null,
    outcome: r.outcome,
    findings: r.findings,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    approver: r.approverId ? n.get(r.approverId) ?? null : null,
    decisionNote: r.decisionNote,
    nextReviewOn: day(r.nextReviewOn),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
}
async function loadReview(id: string) {
  const r = await prisma.govModelReview.findUnique({ where: { id } });
  if (!r) throw HttpError.notFound('Review not found');
  return r;
}

const reviewsQuery = z.object({ status: z.string().trim().max(60).optional(), modelId: z.string().trim().max(36).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
modelRoutes.get('/reviews', ...canView, validateQuery(reviewsQuery), async (req, res) => {
  const f = query<z.infer<typeof reviewsQuery>>(req);
  const statuses = f.status?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rows = await prisma.govModelReview.findMany({ where: { ...(statuses?.length ? { status: { in: statuses } } : {}), ...(f.modelId ? { modelId: f.modelId } : {}) }, orderBy: [{ status: 'asc' }, { dueOn: 'asc' }], take: f.limit });
  res.json({ data: await reviewViews(rows) });
});

/** Opens reviews for every approved model due within 30 days that has none open. */
modelRoutes.post('/reviews/sweep', ...canAuthor, async (req, res) => {
  const opened = await openDueReviews(req.user!.id);
  if (opened) await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'model.reviews_opened', objectType: 'gov_model', objectId: 'register', after: { opened } }));
  res.json({ data: { opened } });
});

const reviewStart = z.object({ dueOn: dateStr.optional() }).strict();
modelRoutes.post('/models/:id/reviews', ...canAuthor, validateBody(reviewStart), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  if (m.status !== 'APPROVED') throw HttpError.conflict(`${m.ref} is ${m.status}; only an approved model has a periodic review`, 'invalid_state');
  if (await prisma.govModelReview.findFirst({ where: { modelId: m.id, status: { in: ['OPEN', 'SUBMITTED'] } }, select: { id: true } })) throw HttpError.conflict('A review is already open for this model', 'review_open');
  const b = req.body as z.infer<typeof reviewStart>;
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.govModelReview.create({ data: { modelId: m.id, dueOn: b.dueOn ? toDate(b.dueOn) : m.nextReviewOn ?? startOfDay(new Date()), openedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'model.review_opened', objectType: 'gov_model', objectId: m.id, after: { reviewId: r.id, dueOn: day(r.dueOn) } });
    await notifyPermission(tx, 'model.approve', { type: 'model.review', title: `${m.ref} periodic review opened`, body: m.name, link: `/ops/model-governance?model=${m.id}` });
    return r;
  });
  res.status(201).json({ data: (await reviewViews([row]))[0] });
});

const reviewSubmit = z
  .object({ outcome: z.enum(REVIEW_OUTCOMES), findings: z.string().trim().max(2000).optional(), nextReviewOn: dateStr.optional() })
  .strict()
  .refine((b) => b.outcome === 'CONFIRMED' || (b.findings && b.findings.length >= 5), { path: ['findings'], message: 'Record the findings (5+ characters) unless the outcome is CONFIRMED' });
/** The reviewer records the outcome. The author or approver of the current version cannot review their own model. */
modelRoutes.post('/reviews/:id/submit', ...canValidate, validateBody(reviewSubmit), async (req, res) => {
  const r = await loadReview(param(req, 'id'));
  if (r.status !== 'OPEN') throw HttpError.conflict(`The review is ${r.status}; only an OPEN review can be submitted`, 'invalid_state');
  const m = await loadModel(r.modelId);
  const cur = m.versions.find((v) => v.id === m.currentVersionId);
  if (cur && (cur.authorId === req.user!.id || cur.approvedBy === req.user!.id)) throw sod('The author or approver of the current version cannot review it');
  const b = req.body as z.infer<typeof reviewSubmit>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.govModelReview.updateMany({ where: { id: r.id, status: 'OPEN' }, data: { status: 'SUBMITTED', reviewerId: req.user!.id, outcome: b.outcome, findings: b.findings ?? null, nextReviewOn: b.nextReviewOn ? toDate(b.nextReviewOn) : null, submittedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'model.review_submitted', objectType: 'gov_model', objectId: m.id, after: { reviewId: r.id, outcome: b.outcome } });
    await notifyPermission(tx, 'model.approve', { type: 'model.review', title: `${m.ref} review awaits approval (${b.outcome.toLowerCase().replace(/_/g, ' ')})`, link: `/ops/model-governance?model=${m.id}` });
  });
  res.json({ data: (await reviewViews([await loadReview(r.id)]))[0] });
});

const decideBody = z.object({ note: z.string().trim().min(5, 'Give a note (5+ characters)').max(500) }).strict();
/** A different person approves the review (step-up). The outcome is applied: confirm moves the next review date out, retire retires the model. */
modelRoutes.post('/reviews/:id/approve', ...canValidate, requireStepUp, validateBody(decideBody), async (req, res) => {
  const r = await loadReview(param(req, 'id'));
  if (r.status !== 'SUBMITTED' || !r.outcome) throw HttpError.conflict(`The review is ${r.status}; it must be SUBMITTED to approve`, 'invalid_state');
  if (r.reviewerId === req.user!.id) throw sod('The reviewer cannot approve their own review');
  const m = await loadModel(r.modelId);
  const now = new Date();
  const months = REVIEW_MONTHS[m.tier] ?? 12;
  const next = r.nextReviewOn ?? (r.outcome === 'CHANGES_REQUIRED' ? addMonths(now, 1) : addMonths(now, months));
  const note = (req.body as z.infer<typeof decideBody>).note;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.govModelReview.updateMany({ where: { id: r.id, status: 'SUBMITTED' }, data: { status: 'COMPLETED', approverId: req.user!.id, decisionNote: note, completedAt: now, nextReviewOn: r.outcome === 'RETIRE' ? null : next } })).count);
    if (r.outcome === 'RETIRE') {
      await tx.govModel.update({ where: { id: m.id }, data: { status: 'RETIRED', currentVersionId: null } });
      await tx.govModelVersion.updateMany({ where: { modelId: m.id, status: { in: ['DRAFT', 'SUBMITTED', 'VALIDATED', 'APPROVED'] } }, data: { status: 'RETIRED' } });
      await tx.govModelBinding.deleteMany({ where: { modelId: m.id } });
    } else await tx.govModel.update({ where: { id: m.id }, data: { nextReviewOn: next } });
    await writeAudit(tx, audit(req), { action: 'model.review_approved', objectType: 'gov_model', objectId: m.id, before: { nextReviewOn: day(m.nextReviewOn), status: m.status }, after: { reviewId: r.id, outcome: r.outcome, nextReviewOn: r.outcome === 'RETIRE' ? null : day(next), status: r.outcome === 'RETIRE' ? 'RETIRED' : m.status }, reason: note });
  });
  res.json({ data: (await reviewViews([await loadReview(r.id)]))[0] });
});

/** Sends a submitted review back to be redone. */
modelRoutes.post('/reviews/:id/return', ...canValidate, validateBody(decideBody), async (req, res) => {
  const r = await loadReview(param(req, 'id'));
  if (r.status !== 'SUBMITTED') throw HttpError.conflict(`The review is ${r.status}; only a SUBMITTED review can be returned`, 'invalid_state');
  if (r.reviewerId === req.user!.id) throw sod('The reviewer cannot return their own review');
  const note = (req.body as z.infer<typeof decideBody>).note;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.govModelReview.updateMany({ where: { id: r.id, status: 'SUBMITTED' }, data: { status: 'OPEN', reviewerId: null, outcome: null, findings: null, submittedAt: null, decisionNote: note } })).count);
    await writeAudit(tx, audit(req), { action: 'model.review_returned', objectType: 'gov_model', objectId: r.modelId, after: { reviewId: r.id }, reason: note });
  });
  res.json({ data: (await reviewViews([await loadReview(r.id)]))[0] });
});

// ================================================================ bindings: which approved model a calculation uses

modelRoutes.get('/bindings', ...canView, async (_req, res) => {
  const rows = await prisma.govModelBinding.findMany();
  const models = await prisma.govModel.findMany({ where: { id: { in: rows.map((r) => r.modelId) } }, select: { id: true, ref: true, name: true, status: true, nextReviewOn: true } });
  const m = new Map(models.map((x) => [x.id, x]));
  const since = new Date(Date.now() - 30 * 86_400_000);
  const uses = await prisma.govModelUsage.groupBy({ by: ['modelId'], where: { usedAt: { gte: since }, note: { startsWith: 'Automatic' } }, _count: { _all: true } });
  const u = new Map(uses.map((x) => [x.modelId, x._count._all]));
  res.json({
    data: BINDING_PURPOSES.map((purpose) => {
      const b = rows.find((r) => r.purpose === purpose);
      const model = b ? m.get(b.modelId) : null;
      return { purpose, modelId: b?.modelId ?? null, modelRef: model?.ref ?? null, modelName: model?.name ?? null, modelStatus: model?.status ?? null, nextReviewOn: day(model?.nextReviewOn), enforce: b?.enforce ?? false, automaticUses30d: b ? u.get(b.modelId) ?? 0 : 0 };
    }),
    purposes: BINDING_PURPOSES,
  });
});

const bindingBody = z.object({ modelId: z.string().trim().min(1).max(36), enforce: z.boolean().default(false) }).strict();
modelRoutes.put('/bindings/:purpose', ...canValidate, requireStepUp, validateBody(bindingBody), async (req, res) => {
  const purpose = param(req, 'purpose');
  if (!(BINDING_PURPOSES as readonly string[]).includes(purpose)) throw HttpError.badRequest('Unknown purpose');
  const b = req.body as z.infer<typeof bindingBody>;
  const m = await loadModel(b.modelId);
  if (m.status !== 'APPROVED') throw HttpError.conflict(`${m.ref} is ${m.status}; only an approved model can be bound`, 'model_not_approved');
  const prev = await prisma.govModelBinding.findUnique({ where: { purpose } });
  await prisma.$transaction(async (tx) => {
    await tx.govModelBinding.upsert({ where: { purpose }, create: { purpose, modelId: m.id, enforce: b.enforce, updatedBy: req.user!.id }, update: { modelId: m.id, enforce: b.enforce, updatedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'model.binding_set', objectType: 'gov_model', objectId: m.id, before: prev ? { modelId: prev.modelId, enforce: prev.enforce } : null, after: { purpose, modelId: m.id, enforce: b.enforce } });
  });
  res.json({ data: { purpose, modelId: m.id, modelRef: m.ref, enforce: b.enforce } });
});

modelRoutes.delete('/bindings/:purpose', ...canValidate, requireStepUp, async (req, res) => {
  const purpose = param(req, 'purpose');
  const prev = await prisma.govModelBinding.findUnique({ where: { purpose } });
  if (!prev) throw HttpError.notFound('No binding for that purpose');
  await prisma.$transaction(async (tx) => {
    await tx.govModelBinding.delete({ where: { purpose } });
    await writeAudit(tx, audit(req), { action: 'model.binding_removed', objectType: 'gov_model', objectId: prev.modelId, before: { purpose, modelId: prev.modelId, enforce: prev.enforce } });
  });
  res.json({ data: { removed: true } });
});
