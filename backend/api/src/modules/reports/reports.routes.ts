import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { param, query } from '../../lib/http';
import { signedDownloadUrl } from '../../lib/storage';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { requireFeature } from '../../middleware/feature';
import { audit } from '../ops/ops.common';
import { FORMAT_META, FREQUENCIES, REPORT_FORMATS, REPORT_KEYS, ROLLING_WINDOWS, applyRolling, nextRunAfter, type Frequency, type ReportFormat, type ReportKey, type RollingWindow } from './reports.engine';
import { CATALOGUE, cleanRecipients, emailRun, ensureCatalogue, generateRun, normaliseParams, runDueSchedules, scheduleParams } from './reports.service';

/**
 * Reports & BI (SRD 5.A page `reports`, permission `reports.view`). Admin-portal staff only, mounted at `/api/v1/reports`.
 * `reports.create` generates reports and manages schedules; `reports.approve` (step-up MFA) distributes a generated
 * fund report to the LP portal, so the person who generates it is not the only control over what investors see.
 * Output is built from live data, stored as an encrypted file and hashed; downloads use short-lived signed links.
 */
export const reportsRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('reports.view')];
const canCreate = [...staff, requirePermission('reports.view', 'reports.create')];
const canDistribute = [...staff, requirePermission('reports.view', 'reports.approve')];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function names(ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = u.length ? await prisma.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

type RunRow = Prisma.ReportRunGetPayload<{ include: { definition: true } }>;
async function runViews(rows: RunRow[]) {
  const n = await names(rows.flatMap((r) => [r.requestedBy, r.distributedBy]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    report: r.definition.key,
    reportName: r.definition.name,
    title: r.title,
    format: r.format,
    status: r.status,
    params: r.params,
    rowCount: r.rowCount,
    sha256: r.sha256,
    error: r.error,
    scheduleId: r.scheduleId,
    requestedBy: n.get(r.requestedBy) ?? null,
    createdAt: r.createdAt.toISOString(),
    hasFile: !!r.fileId,
    distributedAt: r.distributedAt?.toISOString() ?? null,
    distributedBy: r.distributedBy ? n.get(r.distributedBy) ?? null : null,
    documentId: r.documentId,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    deliveryNote: r.deliveryNote,
  }));
}
async function loadRun(id: string) {
  const r = await prisma.reportRun.findFirst({ where: UUID.test(id) ? { id } : { ref: id }, include: { definition: true } });
  if (!r) throw HttpError.notFound('Report run not found');
  return r;
}

// ================================================================ catalogue and lookups

reportsRoutes.get('/catalogue', ...canView, async (_req, res) => {
  await ensureCatalogue();
  const defs = await prisma.reportDefinition.findMany({ orderBy: { name: 'asc' } });
  const counts = await prisma.reportRun.groupBy({ by: ['definitionId'], _count: { _all: true }, _max: { createdAt: true } });
  const by = new Map(counts.map((c) => [c.definitionId, c]));
  res.json({
    data: defs.map((d) => ({
      key: d.key,
      name: d.name,
      description: d.description,
      category: d.category,
      paramSpec: d.paramSpec,
      formats: d.formats,
      active: d.active,
      runs: by.get(d.id)?._count._all ?? 0,
      lastRunAt: by.get(d.id)?._max.createdAt?.toISOString() ?? null,
    })),
  });
});

reportsRoutes.get('/lookups', ...canView, async (_req, res) => {
  const [funds, portfolios] = await Promise.all([
    prisma.fund.findMany({ select: { id: true, ref: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
    prisma.portfolio.findMany({ select: { id: true, ref: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
  ]);
  res.json({ data: { funds, portfolios, formats: REPORT_FORMATS, frequencies: FREQUENCIES, rollingWindows: ROLLING_WINDOWS } });
});

// ================================================================ runs

const runBody = z.object({ key: z.enum(REPORT_KEYS), params: z.record(z.string(), z.unknown()).default({}), format: z.enum(REPORT_FORMATS).default('CSV') }).strict();

reportsRoutes.post('/runs', ...canCreate, validateBody(runBody), idempotent('reports.run_create'), async (req, res) => {
  const b = req.body as z.infer<typeof runBody>;
  await ensureCatalogue();
  const params = await normaliseParams(b.key, b.params);
  const run = await generateRun({ key: b.key, params, format: b.format, actorId: req.user!.id, audit: audit(req) });
  const full = await loadRun(run.id);
  res.status(run.status === 'COMPLETED' ? 201 : 500).json({ data: (await runViews([full]))[0] });
});

const listQuery = z.object({
  report: z.enum(REPORT_KEYS).optional(),
  status: z.enum(['COMPLETED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
reportsRoutes.get('/runs', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const where: Prisma.ReportRunWhereInput = { ...(f.report ? { definition: { key: f.report } } : {}), ...(f.status ? { status: f.status } : {}) };
  const [rows, total] = await Promise.all([prisma.reportRun.findMany({ where, include: { definition: true }, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.reportRun.count({ where })]);
  res.json({ data: await runViews(rows), total });
});

reportsRoutes.get('/runs/:id', ...canView, async (req, res) => {
  res.json({ data: (await runViews([await loadRun(param(req, 'id'))]))[0] });
});

reportsRoutes.get('/runs/:id/link', ...canView, async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  if (!r.fileId) throw HttpError.conflict(`${r.ref} has no output`, 'no_output');
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'reports.run_downloaded', objectType: 'report_run', objectId: r.id, after: { ref: r.ref } }));
  res.json({ data: { url: signedDownloadUrl(r.fileId, 120), expiresInSeconds: 120 } });
});

const emailBody = z.object({ recipients: z.array(z.string().trim().email()).min(1).max(10) }).strict();
/** Mails a link to a completed run (the recipients still sign in to download). */
reportsRoutes.post('/runs/:id/email', ...canCreate, validateBody(emailBody), idempotent('reports.run_email', { required: false }), async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  const rec = cleanRecipients((req.body as z.infer<typeof emailBody>).recipients);
  if (!rec.length) throw HttpError.badRequest('Validation failed', [{ path: 'recipients', message: 'Give at least one valid email address' }]);
  const note = await emailRun(r, rec);
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'reports.run_emailed', objectType: 'report_run', objectId: r.id, after: { ref: r.ref, recipients: rec, note } }));
  res.json({ data: { ...(await runViews([await loadRun(r.id)]))[0], note } });
});

/** Publishes a generated FACT_SHEET or NAV_PACK to the LP portal: a Documents row visible to every investor with an active commitment in the fund. */
reportsRoutes.post('/runs/:id/distribute', ...canDistribute, requireFeature('feature.report_distribution'), requireStepUp, idempotent('reports.run_distribute', { required: false }), async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  if (r.status !== 'COMPLETED' || !r.fileId || !r.sha256) throw HttpError.conflict(`${r.ref} has no output to distribute`, 'no_output');
  if (r.distributedAt) throw HttpError.conflict(`${r.ref} was already distributed`, 'already_distributed');
  const p = r.params as Record<string, string | undefined>;
  let fundId: string | null = null;
  if (r.definition.key === 'FACT_SHEET') fundId = p.fundId ?? null;
  else if (r.definition.key === 'NAV_PACK' && p.portfolioId) fundId = (await prisma.fund.findFirst({ where: { portfolioId: p.portfolioId }, select: { id: true } }))?.id ?? null;
  if (!fundId) throw HttpError.badRequest('Only fund fact sheets and NAV packs for a portfolio linked to a fund can be sent to the LP portal');
  const fund = await prisma.fund.findUnique({ where: { id: fundId } });
  if (!fund) throw HttpError.badRequest('The fund no longer exists');
  const commitments = await prisma.fundCommitment.findMany({ where: { fundId, status: 'ACTIVE' }, select: { clientId: true }, distinct: ['clientId'] });
  if (!commitments.length) throw HttpError.conflict('This fund has no investors with an active commitment', 'no_audience');
  const meta = FORMAT_META[r.format as ReportFormat];
  const now = new Date();
  const doc = await prisma.$transaction(async (tx) => {
    const claimed = await tx.reportRun.updateMany({ where: { id: r.id, distributedAt: null }, data: { distributedAt: now, distributedBy: req.user!.id } });
    if (claimed.count !== 1) throw HttpError.conflict(`${r.ref} was already distributed`, 'already_distributed');
    const ref = await nextRef(tx, 'document');
    const d = await tx.document.create({
      data: {
        ref,
        name: `${r.title}.${meta.ext}`.slice(0, 255),
        type: 'report',
        label: r.definition.name,
        classification: 'Client',
        status: 'Published',
        relatedType: 'report_run',
        relatedId: r.id,
        relatedLabel: r.ref,
        year: now.getUTCFullYear(),
        documentDate: now,
        category: 'PERFORMANCE_REPORT',
        fundId,
        period: `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`,
        sourceType: 'FUND_REPORT_SYNC',
        sourceRefId: r.id,
        makerId: r.requestedBy,
        checkerId: req.user!.id,
        approvedAt: now,
        createdBy: r.requestedBy,
      },
    });
    await tx.documentVersion.create({ data: { documentId: d.id, version: 1, fileId: r.fileId!, sha256: r.sha256!, uploadedById: r.requestedBy } });
    await tx.publication.createMany({ data: commitments.map((c) => ({ documentId: d.id, clientId: c.clientId, publishedById: req.user!.id })) });
    await tx.reportRun.update({ where: { id: r.id }, data: { documentId: d.id } });
    await writeAudit(tx, audit(req), { action: 'reports.run_distributed', objectType: 'report_run', objectId: r.id, after: { ref: r.ref, documentRef: d.ref, fund: fund.ref, investors: commitments.length } });
    return d;
  });
  res.json({ data: { ...(await runViews([await loadRun(r.id)]))[0], documentRef: doc.ref, investors: commitments.length } });
});

// ================================================================ schedules

const scheduleBody = z
  .object({
    key: z.enum(REPORT_KEYS),
    name: z.string().trim().min(3).max(160),
    params: z.record(z.string(), z.unknown()).default({}),
    format: z.enum(REPORT_FORMATS).default('CSV'),
    frequency: z.enum(FREQUENCIES),
    firstRunOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    rolling: z.enum(ROLLING_WINDOWS).nullable().optional(),
    recipients: z.array(z.string().trim().email()).max(10).optional(),
  })
  .strict();
const schedulePatch = z.object({ name: z.string().trim().min(3).max(160), frequency: z.enum(FREQUENCIES), format: z.enum(REPORT_FORMATS), active: z.boolean(), nextRunOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rolling: z.enum(ROLLING_WINDOWS).nullable(), recipients: z.array(z.string().trim().email()).max(10) }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');

type SchedRow = Prisma.ReportScheduleGetPayload<{ include: { definition: true } }>;
async function scheduleViews(rows: SchedRow[]) {
  const n = await names(rows.map((r) => r.createdBy));
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    report: s.definition.key,
    reportName: s.definition.name,
    params: s.params,
    format: s.format,
    frequency: s.frequency,
    nextRunOn: day(s.nextRunOn),
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    lastRunId: s.lastRunId,
    active: s.active,
    rolling: s.rolling,
    recipients: cleanRecipients(s.recipients),
    createdBy: n.get(s.createdBy) ?? null,
    createdAt: s.createdAt.toISOString(),
  }));
}

reportsRoutes.get('/schedules', ...canView, async (_req, res) => {
  const rows = await prisma.reportSchedule.findMany({ include: { definition: true }, orderBy: [{ active: 'desc' }, { nextRunOn: 'asc' }], take: 200 });
  res.json({ data: await scheduleViews(rows) });
});

reportsRoutes.post('/schedules', ...canCreate, validateBody(scheduleBody), idempotent('reports.schedule_create'), async (req, res) => {
  const b = req.body as z.infer<typeof scheduleBody>;
  await ensureCatalogue();
  const params = await normaliseParams(b.key, b.rolling ? applyRolling(b.key, b.params, b.rolling as RollingWindow, new Date()) : b.params);
  const def = await prisma.reportDefinition.findUniqueOrThrow({ where: { key: b.key } });
  const first = b.firstRunOn ? new Date(`${b.firstRunOn}T00:00:00.000Z`) : nextRunAfter(startOfDay(new Date()), 'DAILY');
  if (first < startOfDay(new Date())) throw HttpError.badRequest('Validation failed', [{ path: 'firstRunOn', message: 'The first run cannot be in the past' }]);
  const row = await prisma.$transaction(async (tx) => {
    const s = await tx.reportSchedule.create({ data: { definitionId: def.id, name: b.name, params: params as Prisma.InputJsonValue, format: b.format, frequency: b.frequency, nextRunOn: first, rolling: b.rolling ?? null, recipients: b.recipients?.length ? cleanRecipients(b.recipients) : Prisma.JsonNull, createdBy: req.user!.id }, include: { definition: true } });
    await writeAudit(tx, audit(req), { action: 'reports.schedule_created', objectType: 'report_schedule', objectId: s.id, after: { name: b.name, report: b.key, frequency: b.frequency, format: b.format, nextRunOn: day(first), rolling: b.rolling ?? null, recipients: b.recipients ?? [], params } });
    return s;
  });
  res.status(201).json({ data: (await scheduleViews([row]))[0] });
});

reportsRoutes.patch('/schedules/:id', ...canCreate, validateBody(schedulePatch), idempotent('reports.patch.schedules_id', { required: false }), async (req, res) => {
  const id = param(req, 'id');
  const cur = await prisma.reportSchedule.findUnique({ where: { id }, include: { definition: true } });
  if (!cur) throw HttpError.notFound('Schedule not found');
  const b = req.body as z.infer<typeof schedulePatch>;
  const data: Prisma.ReportScheduleUpdateInput = { ...(b.name ? { name: b.name } : {}), ...(b.frequency ? { frequency: b.frequency } : {}), ...(b.format ? { format: b.format } : {}), ...(b.active !== undefined ? { active: b.active } : {}), ...(b.nextRunOn ? { nextRunOn: new Date(`${b.nextRunOn}T00:00:00.000Z`) } : {}), ...(b.rolling !== undefined ? { rolling: b.rolling } : {}), ...(b.recipients ? { recipients: cleanRecipients(b.recipients) } : {}) };
  const row = await prisma.$transaction(async (tx) => {
    const s = await tx.reportSchedule.update({ where: { id }, data, include: { definition: true } });
    await writeAudit(tx, audit(req), { action: 'reports.schedule_updated', objectType: 'report_schedule', objectId: id, before: { name: cur.name, frequency: cur.frequency, format: cur.format, active: cur.active, nextRunOn: day(cur.nextRunOn), rolling: cur.rolling }, after: { name: s.name, frequency: s.frequency, format: s.format, active: s.active, nextRunOn: day(s.nextRunOn), rolling: s.rolling } });
    return s;
  });
  res.json({ data: (await scheduleViews([row]))[0] });
});

/** Runs one schedule now, as the caller; the schedule's next date is not moved. */
reportsRoutes.post('/schedules/:id/run-now', ...canCreate, idempotent('reports.schedule_run_now'), async (req, res) => {
  const s = await prisma.reportSchedule.findUnique({ where: { id: param(req, 'id') }, include: { definition: true } });
  if (!s) throw HttpError.notFound('Schedule not found');
  const run = await generateRun({ key: s.definition.key as ReportKey, params: await scheduleParams(s, new Date()), format: s.format as ReportFormat, actorId: req.user!.id, audit: audit(req), scheduleId: s.id });
  await prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: new Date(), lastRunId: run.id } });
  const rec = cleanRecipients(s.recipients);
  if (rec.length) await emailRun(run, rec).catch((e) => console.error('[reports] mail failed', e));
  res.status(201).json({ data: (await runViews([await loadRun(run.id)]))[0] });
});

/** Runs everything that is due (the worker calls the same function hourly). */
reportsRoutes.post('/schedules/run-due', ...canCreate, async (_req, res) => {
  res.json({ data: { ran: await runDueSchedules() } });
});

export const REPORT_CATALOGUE_KEYS = CATALOGUE.map((c) => c.key);
export type { Frequency };
