import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { expectVersion, param, query } from '../../lib/http';
import { signedDownloadUrl, storeFile } from '../../lib/storage';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { uploadFiles } from '../../middleware/upload';
import { assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { getRegulatorFilingAdapter } from '../../integrations/regulator-filing';
import { FILING_STATUSES, TEMPLATES, canMove, daysToDue, dueDateFor, effectiveStatus, isoDay, lastClosedPeriod, payloadCsv, payloadHash, periodContaining, startOfDay, type Payload } from './reg.engine';
import { buildPayload } from './reg.service';

/**
 * Regulatory Reporting (SRD 5.A page `regulatory`, permission `reports.view`). Admin-portal staff only, mounted at
 * `/api/v1/regulatory`. A filing moves DRAFT -> IN_REVIEW -> APPROVED -> SUBMITTED (or RETURNED to the preparer).
 * `reports.create` prepares: populates the figures from live data, attaches evidence and sends for review.
 * `reports.approve` (step-up MFA, never the preparer) approves or returns; `reports.submit` (step-up MFA, never the
 * preparer) records the submission. The payload is hashed when sent for review and the hash is re-checked at approval
 * and at submission, so figures cannot change after review.
 */
export const regulatoryRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('reports.view')];
const canPrepare = [...staff, requirePermission('reports.view', 'reports.create')];
const canApprove = [...staff, requirePermission('reports.view', 'reports.approve')];
const canSubmit = [...staff, requirePermission('reports.view', 'reports.submit')];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
const sod = (m: string) => HttpError.forbidden(m, 'sod_violation');

async function names(ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = u.length ? await prisma.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

export async function ensureTemplates() {
  for (const t of TEMPLATES) {
    await prisma.regTemplate.upsert({
      where: { key: t.key },
      update: { regulator: t.regulator, formCode: t.formCode, name: t.name, description: t.description, frequency: t.frequency, dueAfterDays: t.dueAfterDays },
      create: t,
    });
  }
}

type Filing = Prisma.RegFilingGetPayload<{ include: { template: true; evidence: true } }>;
const include = { template: true, evidence: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.RegFilingInclude;

async function load(id: string): Promise<Filing> {
  const f = await prisma.regFiling.findFirst({ where: UUID.test(id) ? { id } : { ref: id }, include });
  if (!f) throw HttpError.notFound('Filing not found');
  return f;
}

function summary(f: Filing, n: Map<string, string>, today: Date) {
  return {
    id: f.id,
    ref: f.ref,
    templateKey: f.template.key,
    template: f.template.name,
    regulator: f.template.regulator,
    formCode: f.template.formCode,
    periodStart: isoDay(f.periodStart),
    periodEnd: isoDay(f.periodEnd),
    dueDate: isoDay(f.dueDate),
    daysToDue: daysToDue(f.dueDate, today),
    status: f.status,
    effectiveStatus: effectiveStatus(f, today),
    populated: !!f.payload,
    populatedAt: f.populatedAt?.toISOString() ?? null,
    evidenceCount: f.evidence.length,
    maker: f.makerId ? n.get(f.makerId) ?? null : null,
    approvedBy: f.approvedBy ? n.get(f.approvedBy) ?? null : null,
    submittedBy: f.submittedBy ? n.get(f.submittedBy) ?? null : null,
    submittedAt: f.submittedAt?.toISOString() ?? null,
    submissionRef: f.submissionRef,
    version: f.version,
  };
}
async function summaries(rows: Filing[]) {
  const n = await names(rows.flatMap((r) => [r.makerId, r.approvedBy, r.submittedBy]));
  const today = startOfDay(new Date());
  return rows.map((f) => summary(f, n, today));
}

async function detail(f: Filing, user: { id: string; permissions: string[] }) {
  const [base] = await summaries([f]);
  const events = await prisma.auditEvent.findMany({ where: { objectType: 'reg_filing', objectId: f.id }, orderBy: { id: 'asc' }, take: 100 });
  const n = await names([...f.evidence.map((e) => e.uploadedBy), ...events.map((e) => e.actorId), f.reviewedBy]);
  const has = (p: string) => user.permissions.includes(p);
  const editable = canMove('edit', f.status);
  return {
    ...base,
    notes: f.notes,
    returnReason: f.returnReason,
    payload: f.payload,
    payloadSha256: f.payloadSha256,
    evidence: f.evidence.map((e) => ({ id: e.id, name: e.name, description: e.description, sha256: e.sha256, uploadedBy: n.get(e.uploadedBy) ?? null, createdAt: e.createdAt.toISOString() })),
    timeline: events.map((e) => ({ at: e.occurredAt.toISOString(), action: e.action, actor: e.actorId ? n.get(e.actorId) ?? null : null, reason: e.reason })),
    actions: {
      populate: editable && has('reports.create'),
      attachEvidence: editable && has('reports.create'),
      submitForReview: canMove('submitReview', f.status) && has('reports.create'),
      approve: canMove('approve', f.status) && has('reports.approve') && f.makerId !== user.id,
      return: canMove('return', f.status) && has('reports.approve'),
      submit: canMove('submit', f.status) && has('reports.submit') && f.makerId !== user.id,
      waive: canMove('waive', f.status) && has('reports.approve'),
    },
  };
}

// ================================================================ templates and calendar

regulatoryRoutes.get('/templates', ...canView, async (_req, res) => {
  await ensureTemplates();
  const rows = await prisma.regTemplate.findMany({ orderBy: [{ regulator: 'asc' }, { key: 'asc' }] });
  res.json({ data: rows.map((t) => ({ key: t.key, regulator: t.regulator, formCode: t.formCode, name: t.name, description: t.description, frequency: t.frequency, dueAfterDays: t.dueAfterDays, active: t.active })) });
});

/** Filing calendar: every filing ordered by due date with derived OVERDUE, plus counts. */
regulatoryRoutes.get('/calendar', ...canView, async (_req, res) => {
  await ensureTemplates();
  const today = startOfDay(new Date());
  const rows = await prisma.regFiling.findMany({ include, orderBy: [{ dueDate: 'asc' }, { ref: 'asc' }], take: 300 });
  const views = await summaries(rows);
  const open = views.filter((v) => !['SUBMITTED', 'WAIVED'].includes(v.status));
  res.json({
    data: views,
    counts: {
      open: open.length,
      overdue: views.filter((v) => v.effectiveStatus === 'OVERDUE').length,
      dueIn14Days: open.filter((v) => v.daysToDue >= 0 && v.daysToDue <= 14).length,
      inReview: views.filter((v) => v.status === 'IN_REVIEW').length,
      awaitingSubmission: views.filter((v) => v.status === 'APPROVED').length,
      submitted: views.filter((v) => v.status === 'SUBMITTED').length,
    },
    today: isoDay(today),
  });
});

/** Opens a DRAFT filing for the last closed period of every active template that does not already have one. Idempotent. */
regulatoryRoutes.post('/calendar/generate', ...canPrepare, idempotent('regulatory.post.calendar_generate', { required: false }), async (req, res) => {
  await ensureTemplates();
  const today = startOfDay(new Date());
  const templates = await prisma.regTemplate.findMany({ where: { active: true } });
  const created = await prisma.$transaction(async (tx) => {
    const out: string[] = [];
    for (const t of templates) {
      for (const per of [lastClosedPeriod(t.frequency as 'MONTHLY', today), periodContaining(t.frequency as 'MONTHLY', today)]) {
        if (await tx.regFiling.findUnique({ where: { templateId_periodEnd: { templateId: t.id, periodEnd: per.end } }, select: { id: true } })) continue;
        const ref = await nextRef(tx, 'regFiling');
        const f = await tx.regFiling.create({ data: { ref, templateId: t.id, periodStart: per.start, periodEnd: per.end, dueDate: dueDateFor(per.end, t.dueAfterDays), makerId: req.user!.id } });
        await writeAudit(tx, audit(req), { action: 'regulatory.filing_opened', objectType: 'reg_filing', objectId: f.id, after: { ref, template: t.key, periodEnd: isoDay(per.end), dueDate: isoDay(f.dueDate) } });
        out.push(ref);
      }
    }
    return out;
  });
  res.status(201).json({ data: { created, count: created.length } });
});

// ================================================================ filings

const listQuery = z.object({
  status: z.string().trim().max(80).optional(),
  template: z.string().trim().max(32).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
regulatoryRoutes.get('/filings', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const today = startOfDay(new Date());
  const statuses = f.status?.split(',').map((s) => s.trim().toUpperCase()).filter((s) => (FILING_STATUSES as readonly string[]).includes(s));
  const where: Prisma.RegFilingWhereInput = {
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...(f.template ? { template: { key: f.template } } : {}),
    ...(f.overdue === 'true' ? { status: { in: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETURNED'] }, dueDate: { lt: today } } : {}),
  };
  const [rows, total] = await Promise.all([prisma.regFiling.findMany({ where, include, orderBy: [{ dueDate: 'desc' }, { ref: 'desc' }], take: f.limit, skip: f.offset }), prisma.regFiling.count({ where })]);
  res.json({ data: await summaries(rows), total });
});

regulatoryRoutes.get('/filings/:id', ...canView, async (req, res) => {
  res.json({ data: await detail(await load(param(req, 'id')), req.user!) });
});

const createBody = z.object({ templateKey: z.string().trim().min(1).max(32), periodEnd: dateStr.optional(), notes: z.string().trim().max(1000).optional() }).strict();
regulatoryRoutes.post('/filings', ...canPrepare, validateBody(createBody), idempotent('regulatory.filing_create'), async (req, res) => {
  const b = req.body as z.infer<typeof createBody>;
  await ensureTemplates();
  const t = await prisma.regTemplate.findUnique({ where: { key: b.templateKey } });
  if (!t || !t.active) throw HttpError.badRequest('Validation failed', [{ path: 'templateKey', message: 'Unknown template' }]);
  const today = startOfDay(new Date());
  const per = b.periodEnd ? periodContaining(t.frequency as 'MONTHLY', toDate(b.periodEnd)) : lastClosedPeriod(t.frequency as 'MONTHLY', today);
  if (per.start.getTime() > today.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'periodEnd', message: 'That period has not started' }]);
  if (await prisma.regFiling.findUnique({ where: { templateId_periodEnd: { templateId: t.id, periodEnd: per.end } }, select: { id: true } })) {
    throw HttpError.conflict(`A ${t.name} filing for the period ending ${isoDay(per.end)} already exists`, 'duplicate_filing');
  }
  const payload = await buildPayload(t.key, per.start, per.end);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'regFiling');
    const f = await tx.regFiling.create({
      data: { ref, templateId: t.id, periodStart: per.start, periodEnd: per.end, dueDate: dueDateFor(per.end, t.dueAfterDays), payload: payload as unknown as Prisma.InputJsonValue, populatedAt: new Date(), notes: b.notes ?? null, makerId: req.user!.id },
      include,
    });
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_created', objectType: 'reg_filing', objectId: f.id, after: { ref, template: t.key, periodStart: isoDay(per.start), periodEnd: isoDay(per.end), figures: payload.figures } });
    return f;
  });
  res.status(201).json({ data: await detail(row, req.user!) });
});

/** Rebuilds the figures from live data. The caller becomes the preparer, so they cannot approve or submit it. */
regulatoryRoutes.post('/filings/:id/populate', ...canPrepare, async (req, res) => {
  const f = await load(param(req, 'id'));
  expectVersion(req, f.version);
  if (!canMove('edit', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; figures can only be rebuilt while DRAFT or RETURNED`, 'invalid_state');
  const payload = await buildPayload(f.template.key, f.periodStart, f.periodEnd);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.regFiling.updateMany({ where: { id: f.id, status: f.status, version: f.version }, data: { payload: payload as unknown as Prisma.InputJsonValue, populatedAt: new Date(), payloadSha256: null, makerId: req.user!.id, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_populated', objectType: 'reg_filing', objectId: f.id, after: { figures: payload.figures } });
  });
  res.json({ data: await detail(await load(f.id), req.user!) });
});

const patchBody = z.object({ notes: z.string().trim().max(1000) }).strict();
regulatoryRoutes.patch('/filings/:id', ...canPrepare, validateBody(patchBody), idempotent('regulatory.patch.filings_id', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  if (!canMove('edit', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status} and cannot be edited`, 'invalid_state');
  const notes = (req.body as z.infer<typeof patchBody>).notes;
  await prisma.$transaction(async (tx) => {
    await tx.regFiling.update({ where: { id: f.id }, data: { notes } });
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_notes_updated', objectType: 'reg_filing', objectId: f.id, before: { notes: f.notes }, after: { notes } });
  });
  res.json({ data: await detail(await load(f.id), req.user!) });
});

// ---------------------------------------------------------------- evidence

regulatoryRoutes.post('/filings/:id/evidence', ...canPrepare, uploadFiles('file', 1), idempotent('regulatory.post.filings_id_evidence', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  if (!canMove('edit', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; evidence can only be attached while DRAFT or RETURNED`, 'invalid_state');
  const file = req.file;
  if (!file) throw HttpError.badRequest('Attach a file');
  const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 300) : null;
  const row = await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: req.user!.id }, tx);
    const e = await tx.regEvidence.create({ data: { filingId: f.id, fileId: stored.id, name: stored.name, description: description || null, sha256: stored.sha256, uploadedBy: req.user!.id } });
    // Evidence changes invalidate a previous review hash only before review, which cannot be the case here (DRAFT or RETURNED).
    await writeAudit(tx, audit(req), { action: 'regulatory.evidence_attached', objectType: 'reg_filing', objectId: f.id, after: { evidenceId: e.id, name: e.name, sha256: e.sha256 } });
    return e;
  });
  res.status(201).json({ data: { id: row.id, name: row.name, sha256: row.sha256 } });
});

regulatoryRoutes.delete('/filings/:id/evidence/:eid', ...canPrepare, idempotent('regulatory.delete.filings_id_evidence_eid', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  if (!canMove('edit', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; evidence can only be removed while DRAFT or RETURNED`, 'invalid_state');
  const e = f.evidence.find((x) => x.id === param(req, 'eid'));
  if (!e) throw HttpError.notFound('Evidence not found');
  await prisma.$transaction(async (tx) => {
    await tx.regEvidence.delete({ where: { id: e.id } });
    await writeAudit(tx, audit(req), { action: 'regulatory.evidence_removed', objectType: 'reg_filing', objectId: f.id, before: { evidenceId: e.id, name: e.name, sha256: e.sha256 } });
  });
  res.json({ data: { removed: true } });
});

regulatoryRoutes.get('/filings/:id/evidence/:eid/link', ...canView, async (req, res) => {
  const f = await load(param(req, 'id'));
  const e = f.evidence.find((x) => x.id === param(req, 'eid'));
  if (!e) throw HttpError.notFound('Evidence not found');
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'regulatory.evidence_downloaded', objectType: 'reg_filing', objectId: f.id, after: { evidenceId: e.id } }));
  res.json({ data: { url: signedDownloadUrl(e.fileId, 120), expiresInSeconds: 120 } });
});

/** The payload as CSV text for the regulator's upload portal. */
regulatoryRoutes.get('/filings/:id/export', ...canView, async (req, res) => {
  const f = await load(param(req, 'id'));
  if (!f.payload) throw HttpError.conflict(`${f.ref} has no figures yet`, 'no_payload');
  res.json({ data: { filename: `${f.ref}-${f.template.key.toLowerCase()}-${isoDay(f.periodEnd)}.csv`, csv: payloadCsv(f.payload as unknown as Payload), sha256: f.payloadSha256 } });
});

// ---------------------------------------------------------------- workflow

regulatoryRoutes.post('/filings/:id/submit-review', ...canPrepare, idempotent('regulatory.filing_review', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  expectVersion(req, f.version);
  if (!canMove('submitReview', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; only a DRAFT or RETURNED filing can be sent for review`, 'invalid_state');
  if (f.makerId && f.makerId !== req.user!.id) throw sod('Only the preparer can send this filing for review; rebuild the figures to take it over');
  if (!f.payload) throw HttpError.conflict('Populate the figures before sending for review', 'no_payload');
  if (!f.evidence.length) throw HttpError.conflict('Attach at least one piece of evidence before sending for review', 'evidence_required');
  const hash = payloadHash(f.payload);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.regFiling.updateMany({ where: { id: f.id, status: f.status, version: f.version }, data: { status: 'IN_REVIEW', payloadSha256: hash, makerId: req.user!.id, returnReason: null, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_sent_for_review', objectType: 'reg_filing', objectId: f.id, before: { status: f.status }, after: { status: 'IN_REVIEW', payloadSha256: hash, evidence: f.evidence.length } });
    await notifyPermission(tx, 'reports.approve', { type: 'regulatory.review', title: `${f.ref} is ready for review`, body: `${f.template.name}, period ending ${isoDay(f.periodEnd)}, due ${isoDay(f.dueDate)}.`, link: `/ops/regulatory?filing=${f.id}` });
  });
  res.json({ data: await detail(await load(f.id), req.user!) });
});

function assertIntact(f: Filing) {
  if (!f.payload || !f.payloadSha256 || payloadHash(f.payload) !== f.payloadSha256) {
    throw new HttpError(409, 'payload_changed', `${f.ref}: the figures no longer match what was sent for review. Return it and re-submit.`);
  }
}

regulatoryRoutes.post('/filings/:id/approve', ...canApprove, requireStepUp, idempotent('regulatory.filing_approve', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  expectVersion(req, f.version);
  if (!canMove('approve', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; it must be IN_REVIEW to approve`, 'invalid_state');
  if (f.makerId === req.user!.id) throw sod('The preparer cannot approve their own filing (maker-checker)');
  assertIntact(f);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.regFiling.updateMany({ where: { id: f.id, status: 'IN_REVIEW', version: f.version }, data: { status: 'APPROVED', reviewedBy: req.user!.id, reviewedAt: now, approvedBy: req.user!.id, approvedAt: now, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_approved', objectType: 'reg_filing', objectId: f.id, before: { status: 'IN_REVIEW' }, after: { status: 'APPROVED', payloadSha256: f.payloadSha256 } });
    await notifyPermission(tx, 'reports.submit', { type: 'regulatory.approved', title: `${f.ref} is approved and ready to submit`, body: `${f.template.name}, due ${isoDay(f.dueDate)}.`, link: `/ops/regulatory?filing=${f.id}` });
  });
  res.json({ data: await detail(await load(f.id), req.user!) });
});

regulatoryRoutes.post('/filings/:id/return', ...canApprove, validateBody(reasonSchema), idempotent('regulatory.post.filings_id_return', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  expectVersion(req, f.version);
  if (!canMove('return', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; only IN_REVIEW or APPROVED filings can be returned`, 'invalid_state');
  if (f.makerId === req.user!.id) throw sod('You prepared this filing; withdraw it by editing instead of returning it');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.regFiling.updateMany({ where: { id: f.id, status: f.status, version: f.version }, data: { status: 'RETURNED', returnReason: reason, payloadSha256: null, approvedBy: null, approvedAt: null, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_returned', objectType: 'reg_filing', objectId: f.id, before: { status: f.status }, after: { status: 'RETURNED' }, reason });
  });
  res.json({ data: await detail(await load(f.id), req.user!) });
});

const submitBody = z.object({ submissionRef: z.string().trim().min(3, 'Enter the regulator reference (3+ characters)').max(80) }).strict();
regulatoryRoutes.post('/filings/:id/submit', ...canSubmit, requireStepUp, validateBody(submitBody), idempotent('regulatory.filing_submit', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  expectVersion(req, f.version);
  if (!canMove('submit', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; it must be APPROVED to submit`, 'invalid_state');
  if (f.makerId === req.user!.id) throw sod('The preparer cannot submit their own filing');
  assertIntact(f);
  const { submissionRef } = req.body as z.infer<typeof submitBody>;
  // Electronic submission through the regulator-filing adapter (fake: acknowledges and keeps the receipt; live: not configured -> 503, filing stays APPROVED).
  const receipt = await getRegulatorFilingAdapter().submit({ regulator: f.template.regulator, formCode: f.template.formCode, filingRef: f.ref, payloadSha256: f.payloadSha256 ?? '' });
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.regFiling.updateMany({ where: { id: f.id, status: 'APPROVED', version: f.version }, data: { status: 'SUBMITTED', submittedBy: req.user!.id, submittedAt: new Date(), submissionRef, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_submitted', objectType: 'reg_filing', objectId: f.id, before: { status: 'APPROVED' }, after: { status: 'SUBMITTED', submissionRef, payloadSha256: f.payloadSha256, adapterReceipt: receipt.receiptRef } });
  });
  res.json({ data: await detail(await load(f.id), req.user!) });
});

regulatoryRoutes.post('/filings/:id/waive', ...canApprove, validateBody(reasonSchema), idempotent('regulatory.post.filings_id_waive', { required: false }), async (req, res) => {
  const f = await load(param(req, 'id'));
  expectVersion(req, f.version);
  if (!canMove('waive', f.status)) throw HttpError.conflict(`${f.ref} is ${f.status}; only DRAFT or RETURNED filings can be waived`, 'invalid_state');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.regFiling.updateMany({ where: { id: f.id, status: f.status, version: f.version }, data: { status: 'WAIVED', returnReason: reason, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'regulatory.filing_waived', objectType: 'reg_filing', objectId: f.id, before: { status: f.status }, after: { status: 'WAIVED' }, reason });
  });
  res.json({ data: await detail(await load(f.id), req.user!) });
});
