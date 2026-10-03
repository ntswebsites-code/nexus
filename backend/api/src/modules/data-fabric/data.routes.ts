import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { storeFile } from '../../lib/storage';
import { uploadFiles } from '../../middleware/upload';
import { audit } from '../ops/ops.common';
import { MAX_REJECTED_STORED, evalFeedRule, feedCols, ingestCsv, validateSchema, type FeedSchema } from './data.feed';
import { CADENCES, CHECK_TYPES, DATASETS, DATASET_MAP, FEED_PREFIX, SEVERITIES, SOURCE_KINDS, ageDays, compile, validateRule, type ColType } from './data.engine';

/**
 * Data Fabric & Studio (SRD 5.A page `data`, permission `operations.view`). Admin-portal staff only, mounted at
 * `/api/v1/data`. `operations.view` reads; `data.manage` registers sources, runs ingestion profiling jobs, defines
 * data-quality rules, runs them over the live tables and works the exceptions list. Rules compile to parameterised
 * SQL over a whitelist of datasets (see data.engine.ts); nothing here accepts SQL or a table name from the client.
 */
export const dataRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('operations.view')];
const canManage = [...staff, requirePermission('operations.view', 'data.manage')];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();

async function names(ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = u.length ? await prisma.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => ((await prisma.$queryRawUnsafe<T[]>(sql, ...params))[0] as T);
const num = (v: unknown) => Number(v ?? 0);

// ================================================================ datasets

dataRoutes.get('/datasets', ...canView, async (_req, res) => {
  const out = [];
  for (const d of DATASETS) {
    const c = await one<{ n: bigint }>(`SELECT COUNT(*) AS n FROM \`${d.table}\` t ${d.base ? `WHERE ${d.base}` : ''}`);
    const m = await one<{ m: Date | null }>(`SELECT MAX(t.\`${d.freshCol}\`) AS m FROM \`${d.table}\` t ${d.base ? `WHERE ${d.base}` : ''}`);
    out.push({ key: d.key, label: d.label, table: d.table, columns: d.cols, relations: Object.keys(d.relations), freshnessColumn: d.freshCol, rows: num(c.n), latest: m.m ? new Date(m.m).toISOString() : null });
  }
  const feeds = await prisma.dataSource.findMany({ where: { kind: 'FILE_FEED', schemaSpec: { not: Prisma.AnyNull } }, orderBy: { key: 'asc' }, take: 100 });
  res.json({ feeds: feeds.map((f) => ({ dataset: `${FEED_PREFIX}${f.key}`, label: `${f.name} (file feed)`, sourceKey: f.key, columns: feedCols(f.schemaSpec as unknown as FeedSchema) })), data: out, checkTypes: CHECK_TYPES, severities: SEVERITIES, kinds: SOURCE_KINDS, cadences: CADENCES });
});

// ================================================================ sources

type SourceRow = Prisma.DataSourceGetPayload<object>;
async function sourceViews(rows: SourceRow[]) {
  const ids = rows.map((r) => r.id);
  const [rules, jobs] = await Promise.all([
    ids.length ? prisma.dataQualityRule.groupBy({ by: ['sourceId'], where: { sourceId: { in: ids } }, _count: { _all: true } }) : [],
    ids.length ? prisma.dataIngestionJob.findMany({ where: { sourceId: { in: ids } }, orderBy: { startedAt: 'desc' }, take: 500, select: { sourceId: true, status: true, ref: true, startedAt: true } }) : [],
  ]);
  const ruleN = new Map(rules.map((r) => [r.sourceId, r._count._all]));
  const last = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) if (!last.has(j.sourceId)) last.set(j.sourceId, j);
  return rows.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    kind: s.kind,
    dataset: s.dataset,
    system: s.system,
    owner: s.owner,
    cadence: s.cadence,
    description: s.description,
    schemaSpec: s.schemaSpec,
    status: s.status,
    lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
    lastRowCount: s.lastRowCount,
    rules: ruleN.get(s.id) ?? 0,
    lastJob: last.get(s.id) ? { ref: last.get(s.id)!.ref, status: last.get(s.id)!.status, at: last.get(s.id)!.startedAt.toISOString() } : null,
  }));
}
async function loadSource(id: string) {
  const s = await prisma.dataSource.findFirst({ where: UUID.test(id) ? { id } : { key: id } });
  if (!s) throw HttpError.notFound('Data source not found');
  return s;
}

dataRoutes.get('/sources', ...canView, async (_req, res) => {
  res.json({ data: await sourceViews(await prisma.dataSource.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }], take: 300 })) });
});

const sourceBody = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{2,39}$/, 'Use 3-40 characters: lower case letters, digits, . _ -'),
    name: z.string().trim().min(3).max(160),
    kind: z.enum(SOURCE_KINDS),
    dataset: z.string().trim().max(40).nullable().optional(),
    system: z.string().trim().min(2).max(80),
    owner: z.string().trim().min(2).max(120),
    cadence: z.enum(CADENCES).default('DAILY'),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const sourcePatch = z.object({ name: z.string().trim().min(3).max(160), owner: z.string().trim().min(2).max(120), cadence: z.enum(CADENCES), description: z.string().trim().max(500).nullable(), status: z.enum(['ACTIVE', 'PAUSED']) }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');

dataRoutes.post('/sources', ...canManage, validateBody(sourceBody), idempotent('data.source_create'), async (req, res) => {
  const b = req.body as z.infer<typeof sourceBody>;
  if (b.kind === 'TABLE' && !(b.dataset && DATASET_MAP.has(b.dataset))) throw HttpError.badRequest('Validation failed', [{ path: 'dataset', message: `A table source needs a dataset: ${DATASETS.map((d) => d.key).join(', ')}` }]);
  if (b.kind !== 'TABLE' && b.dataset) throw HttpError.badRequest('Validation failed', [{ path: 'dataset', message: 'Only a table source has a dataset' }]);
  if (await prisma.dataSource.findUnique({ where: { key: b.key }, select: { id: true } })) throw HttpError.conflict(`A source with key ${b.key} already exists`, 'duplicate_source');
  const row = await prisma.$transaction(async (tx) => {
    const s = await tx.dataSource.create({ data: { key: b.key, name: b.name, kind: b.kind, dataset: b.dataset ?? null, system: b.system, owner: b.owner, cadence: b.cadence, description: b.description ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'data.source_registered', objectType: 'data_source', objectId: s.id, after: { key: b.key, kind: b.kind, dataset: b.dataset ?? null, system: b.system, owner: b.owner } });
    return s;
  });
  res.status(201).json({ data: (await sourceViews([row]))[0] });
});

dataRoutes.patch('/sources/:id', ...canManage, validateBody(sourcePatch), idempotent('data-fabric.patch.sources_id', { required: false }), async (req, res) => {
  const s = await loadSource(param(req, 'id'));
  const b = req.body as z.infer<typeof sourcePatch>;
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.dataSource.update({ where: { id: s.id }, data: b });
    await writeAudit(tx, audit(req), { action: 'data.source_updated', objectType: 'data_source', objectId: s.id, before: { name: s.name, owner: s.owner, cadence: s.cadence, status: s.status }, after: { name: u.name, owner: u.owner, cadence: u.cadence, status: u.status } });
    return u;
  });
  res.json({ data: (await sourceViews([row]))[0] });
});

// ================================================================ ingestion jobs

type JobRow = Prisma.DataIngestionJobGetPayload<{ include: { source: true } }>;
async function jobViews(rows: JobRow[]) {
  const n = await names(rows.map((r) => r.triggeredBy));
  return rows.map((j) => ({ id: j.id, ref: j.ref, sourceId: j.sourceId, source: j.source.name, sourceKey: j.source.key, status: j.status, rowsRead: j.rowsRead, rowsRejected: j.rowsRejected, latestRecordAt: j.latestRecordAt?.toISOString() ?? null, note: j.note, error: j.error, triggeredBy: n.get(j.triggeredBy) ?? null, startedAt: j.startedAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null, fileName: j.fileName, fileSha256: j.fileSha256 }));
}

const jobsQuery = z.object({ sourceId: z.string().trim().max(36).optional(), status: z.enum(['SUCCEEDED', 'FAILED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
dataRoutes.get('/jobs', ...canView, validateQuery(jobsQuery), async (req, res) => {
  const f = query<z.infer<typeof jobsQuery>>(req);
  const where: Prisma.DataIngestionJobWhereInput = { ...(f.sourceId ? { sourceId: f.sourceId } : {}), ...(f.status ? { status: f.status } : {}) };
  const [rows, total] = await Promise.all([prisma.dataIngestionJob.findMany({ where, include: { source: true }, orderBy: { startedAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.dataIngestionJob.count({ where })]);
  res.json({ data: await jobViews(rows), total });
});

const ingestBody = z.object({ rowsRead: z.coerce.number().int().min(0).max(1_000_000_000).optional(), rowsRejected: z.coerce.number().int().min(0).max(1_000_000_000).optional(), status: z.enum(['SUCCEEDED', 'FAILED']).optional(), error: z.string().trim().max(500).optional(), note: z.string().trim().max(500).optional() }).strict();

/**
 * TABLE sources: profiles the live table (row count and newest record), which is what its freshness is judged on.
 * Other kinds (file feed, API, manual): the operator records the outcome of the feed run; row counts are required.
 */
dataRoutes.post('/sources/:id/ingest', ...canManage, validateBody(ingestBody), idempotent('data.ingest'), async (req, res) => {
  const s = await loadSource(param(req, 'id'));
  const b = req.body as z.infer<typeof ingestBody>;
  if (s.status === 'PAUSED') throw HttpError.conflict(`${s.name} is paused; resume it first`, 'source_paused');
  const startedAt = new Date();
  let rowsRead = 0;
  let rowsRejected = 0;
  let latest: Date | null = null;
  let status: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED';
  let error: string | null = null;
  if (s.kind === 'TABLE') {
    const ds = DATASET_MAP.get(s.dataset ?? '');
    if (!ds) {
      status = 'FAILED';
      error = `Dataset ${s.dataset} is not in the registry`;
    } else {
      const base = ds.base ? `WHERE ${ds.base}` : '';
      rowsRead = num((await one<{ n: bigint }>(`SELECT COUNT(*) AS n FROM \`${ds.table}\` t ${base}`)).n);
      const m = await one<{ m: Date | null }>(`SELECT MAX(t.\`${ds.freshCol}\`) AS m FROM \`${ds.table}\` t ${base}`);
      latest = m.m ? new Date(m.m) : null;
    }
  } else {
    if (b.status === 'FAILED') {
      status = 'FAILED';
      error = b.error ?? 'Feed run failed';
    } else if (b.rowsRead === undefined) throw HttpError.badRequest('Validation failed', [{ path: 'rowsRead', message: 'Enter the number of rows the feed delivered' }]);
    rowsRead = b.rowsRead ?? 0;
    rowsRejected = b.rowsRejected ?? 0;
    if (rowsRejected > rowsRead && status === 'SUCCEEDED') throw HttpError.badRequest('Validation failed', [{ path: 'rowsRejected', message: 'Rejected rows cannot exceed rows read' }]);
  }
  const job = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'dataJob');
    const j = await tx.dataIngestionJob.create({ data: { ref, sourceId: s.id, status, rowsRead, rowsRejected, latestRecordAt: latest, note: b.note ?? null, error, triggeredBy: req.user!.id, startedAt, finishedAt: new Date() }, include: { source: true } });
    await tx.dataSource.update({ where: { id: s.id }, data: status === 'SUCCEEDED' ? { lastSyncAt: j.finishedAt, lastRowCount: rowsRead, status: 'ACTIVE' } : { status: 'ERROR' } });
    await writeAudit(tx, audit(req), { action: status === 'SUCCEEDED' ? 'data.ingestion_succeeded' : 'data.ingestion_failed', objectType: 'data_source', objectId: s.id, after: { job: ref, rowsRead, rowsRejected, latestRecordAt: latest?.toISOString() ?? null, error } });
    return j;
  });
  res.status(201).json({ data: (await jobViews([job]))[0] });
});

// ================================================================ file feeds (column contract, CSV upload, staged rows)

const schemaBody = z.object({
  keyColumn: z.string().trim().min(1).max(40),
  columns: z.array(z.object({ name: z.string().trim().min(1).max(40), type: z.enum(['text', 'num', 'date']), required: z.boolean().default(false), unique: z.boolean().optional() }).strict()).min(1).max(40),
}).strict();

dataRoutes.put('/sources/:id/schema', ...canManage, validateBody(schemaBody), async (req, res) => {
  const s = await loadSource(param(req, 'id'));
  if (s.kind !== 'FILE_FEED') throw HttpError.badRequest('Validation failed', [{ path: 'kind', message: 'Only a file feed has a column contract' }]);
  const b = req.body as z.infer<typeof schemaBody>;
  const errs = validateSchema(b);
  if (errs.length) throw HttpError.badRequest('Validation failed', errs);
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.dataSource.update({ where: { id: s.id }, data: { schemaSpec: b as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, audit(req), { action: 'data.feed_schema_set', objectType: 'data_source', objectId: s.id, before: { schema: s.schemaSpec ?? null }, after: { schema: b } });
    return u;
  });
  res.json({ data: (await sourceViews([row]))[0] });
});

/** Loads a CSV into a file feed: typed, validated, staged; refused rows are kept with the reason. Replaces the previous staged load. */
dataRoutes.post('/sources/:id/upload', ...canManage, uploadFiles('file', 1), async (req, res) => {
  const s = await loadSource(param(req, 'id'));
  if (s.kind !== 'FILE_FEED') throw HttpError.badRequest('Only a file-feed source accepts an upload');
  if (s.status === 'PAUSED') throw HttpError.conflict(`${s.name} is paused; resume it first`, 'source_paused');
  if (!s.schemaSpec) throw HttpError.conflict('Define the column contract for this feed before uploading', 'schema_required');
  const file = req.file;
  if (!file) throw HttpError.badRequest('Attach a CSV file');
  const spec = s.schemaSpec as unknown as FeedSchema;
  const text = file.buffer.toString('utf8');
  const result = ingestCsv(text, spec);
  const startedAt = new Date();
  const status = result.headerError || (result.rowsRead > 0 && result.accepted.length === 0) ? 'FAILED' : 'SUCCEEDED';
  const error = result.headerError ?? (status === 'FAILED' ? `All ${result.rowsRead} rows were rejected` : null);
  const job = await prisma.$transaction(
    async (tx) => {
      const stored = await storeFile({ name: file.originalname, mime: file.mimetype === 'application/vnd.ms-excel' ? 'text/csv' : file.mimetype || 'text/csv', data: file.buffer, uploadedById: req.user!.id }, tx);
      if (status === 'SUCCEEDED' && (await tx.dataIngestionJob.findFirst({ where: { sourceId: s.id, status: 'SUCCEEDED', fileSha256: stored.sha256 }, orderBy: { startedAt: 'desc' }, select: { id: true } }))) {
        const latest = await tx.dataIngestionJob.findFirst({ where: { sourceId: s.id, status: 'SUCCEEDED' }, orderBy: { startedAt: 'desc' }, select: { fileSha256: true } });
        if (latest?.fileSha256 === stored.sha256) throw HttpError.conflict('This exact file was already loaded as the latest load', 'duplicate_file');
      }
      const ref = await nextRef(tx, 'dataJob');
      const j = await tx.dataIngestionJob.create({
        data: { ref, sourceId: s.id, status, rowsRead: result.rowsRead, rowsRejected: result.rejected.length, latestRecordAt: result.latestRecordAt, note: `${result.accepted.length} accepted from ${file.originalname}`.slice(0, 500), error, triggeredBy: req.user!.id, startedAt, finishedAt: new Date(), fileId: stored.id, fileName: stored.name, fileSha256: stored.sha256 },
        include: { source: true },
      });
      if (result.rejected.length) await tx.dataRejectedRow.createMany({ data: result.rejected.slice(0, MAX_REJECTED_STORED).map((r) => ({ jobId: j.id, rowNo: r.rowNo, reason: r.reason, raw: r.raw })) });
      if (status === 'SUCCEEDED') {
        await tx.dataStagedRecord.deleteMany({ where: { sourceId: s.id } });
        for (let i = 0; i < result.accepted.length; i += 1000) {
          await tx.dataStagedRecord.createMany({ data: result.accepted.slice(i, i + 1000).map((r) => ({ sourceId: s.id, jobId: j.id, rowNo: r.rowNo, recordKey: r.key, data: r.data as Prisma.InputJsonValue })) });
        }
        await tx.dataSource.update({ where: { id: s.id }, data: { lastSyncAt: j.finishedAt, lastRowCount: result.accepted.length, status: 'ACTIVE' } });
      } else await tx.dataSource.update({ where: { id: s.id }, data: { status: 'ERROR' } });
      await writeAudit(tx, audit(req), { action: status === 'SUCCEEDED' ? 'data.feed_loaded' : 'data.feed_load_failed', objectType: 'data_source', objectId: s.id, after: { job: ref, file: stored.name, sha256: stored.sha256, rowsRead: result.rowsRead, accepted: result.accepted.length, rejected: result.rejected.length, error } });
      return j;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  res.status(201).json({ data: { ...(await jobViews([job]))[0], accepted: result.accepted.length } });
});

const stagedQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
dataRoutes.get('/sources/:id/staged', ...canView, validateQuery(stagedQuery), async (req, res) => {
  const s = await loadSource(param(req, 'id'));
  const f = query<z.infer<typeof stagedQuery>>(req);
  const [rows, total] = await Promise.all([prisma.dataStagedRecord.findMany({ where: { sourceId: s.id }, orderBy: { rowNo: 'asc' }, take: f.limit, skip: f.offset }), prisma.dataStagedRecord.count({ where: { sourceId: s.id } })]);
  res.json({ data: rows.map((r) => ({ rowNo: r.rowNo, key: r.recordKey, values: r.data })), total, columns: (s.schemaSpec as unknown as FeedSchema | null)?.columns ?? [] });
});

dataRoutes.get('/jobs/:id/rejected', ...canView, async (req, res) => {
  const j = await prisma.dataIngestionJob.findFirst({ where: UUID.test(param(req, 'id')) ? { id: param(req, 'id') } : { ref: param(req, 'id') }, select: { id: true } });
  if (!j) throw HttpError.notFound('Job not found');
  const rows = await prisma.dataRejectedRow.findMany({ where: { jobId: j.id }, orderBy: { rowNo: 'asc' }, take: MAX_REJECTED_STORED });
  res.json({ data: rows.map((r) => ({ rowNo: r.rowNo, reason: r.reason, raw: r.raw })) });
});

/** The columns a rule dataset offers: feed columns for `feed:<key>`, else null (registry validation applies). */
export async function feedContext(dataset: string): Promise<{ cols: Record<string, ColType>; source: Prisma.DataSourceGetPayload<object> } | null> {
  if (!dataset.startsWith(FEED_PREFIX)) return null;
  const src = await prisma.dataSource.findUnique({ where: { key: dataset.slice(FEED_PREFIX.length) } });
  if (!src || src.kind !== 'FILE_FEED' || !src.schemaSpec) throw HttpError.badRequest('Validation failed', [{ path: 'dataset', message: 'Unknown file feed, or it has no column contract yet' }]);
  return { cols: feedCols(src.schemaSpec as unknown as FeedSchema), source: src };
}

// ================================================================ quality rules

type RuleRow = Prisma.DataQualityRuleGetPayload<{ include: { source: { select: { key: true; name: true } } } }>;
const ruleInclude = { source: { select: { key: true, name: true } } } as const;
async function ruleViews(rows: RuleRow[]) {
  const ids = rows.map((r) => r.id);
  const runs = ids.length ? await prisma.dataQualityRun.findMany({ where: { ruleId: { in: ids } }, orderBy: { ranAt: 'desc' }, take: 1000 }) : [];
  const open = ids.length ? await prisma.dataQualityException.groupBy({ by: ['ruleId'], where: { ruleId: { in: ids }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: { _all: true } }) : [];
  const last = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!last.has(r.ruleId)) last.set(r.ruleId, r);
  const openN = new Map(open.map((o) => [o.ruleId, o._count._all]));
  return rows.map((r) => {
    const l = last.get(r.id);
    return { id: r.id, key: r.key, name: r.name, sourceKey: r.source?.key ?? null, sourceName: r.source?.name ?? null, dataset: r.dataset, checkType: r.checkType, col: r.col, params: r.params, severity: r.severity, active: r.active, openExceptions: openN.get(r.id) ?? 0, lastRun: l ? { ref: l.ref, status: l.status, failures: l.failures, rowsChecked: l.rowsChecked, at: l.ranAt.toISOString() } : null };
  });
}
async function loadRule(id: string) {
  const r = await prisma.dataQualityRule.findFirst({ where: UUID.test(id) ? { id } : { key: id }, include: ruleInclude });
  if (!r) throw HttpError.notFound('Rule not found');
  return r;
}

const rulesQuery = z.object({ dataset: z.string().trim().max(40).optional(), active: z.enum(['true', 'false']).optional() });
dataRoutes.get('/rules', ...canView, validateQuery(rulesQuery), async (req, res) => {
  const f = query<z.infer<typeof rulesQuery>>(req);
  const rows = await prisma.dataQualityRule.findMany({ where: { ...(f.dataset ? { dataset: f.dataset } : {}), ...(f.active ? { active: f.active === 'true' } : {}) }, include: ruleInclude, orderBy: [{ dataset: 'asc' }, { key: 'asc' }], take: 500 });
  res.json({ data: await ruleViews(rows) });
});

const ruleBody = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{2,59}$/, 'Use 3-60 characters: lower case letters, digits, . _ -'),
    name: z.string().trim().min(3).max(200),
    dataset: z.string().trim().min(1).max(64),
    checkType: z.enum(CHECK_TYPES),
    col: z.string().trim().min(1).max(60),
    params: z.record(z.string(), z.unknown()).optional(),
    severity: z.enum(SEVERITIES).default('MEDIUM'),
    sourceKey: z.string().trim().max(40).nullable().optional(),
  })
  .strict();
const rulePatch = z.object({ name: z.string().trim().min(3).max(200), severity: z.enum(SEVERITIES), active: z.boolean(), params: z.record(z.string(), z.unknown()) }).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');

dataRoutes.post('/rules', ...canManage, validateBody(ruleBody), idempotent('data.rule_create'), async (req, res) => {
  const b = req.body as z.infer<typeof ruleBody>;
  const feed = await feedContext(b.dataset);
  const errs = validateRule(b, feed?.cols);
  if (errs.length) throw HttpError.badRequest('Validation failed', errs);
  if (await prisma.dataQualityRule.findUnique({ where: { key: b.key }, select: { id: true } })) throw HttpError.conflict(`A rule with key ${b.key} already exists`, 'duplicate_rule');
  const src = feed ? feed.source : b.sourceKey ? await prisma.dataSource.findUnique({ where: { key: b.sourceKey } }) : null;
  if (b.sourceKey && !src) throw HttpError.badRequest('Validation failed', [{ path: 'sourceKey', message: 'Unknown source' }]);
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.dataQualityRule.create({ data: { key: b.key, name: b.name, sourceId: src?.id ?? null, dataset: b.dataset, checkType: b.checkType, col: b.col, params: (b.params ?? Prisma.JsonNull) as Prisma.InputJsonValue, severity: b.severity, createdBy: req.user!.id }, include: ruleInclude });
    await writeAudit(tx, audit(req), { action: 'data.rule_created', objectType: 'dq_rule', objectId: r.id, after: { key: b.key, dataset: b.dataset, checkType: b.checkType, col: b.col, params: b.params ?? null, severity: b.severity } });
    return r;
  });
  res.status(201).json({ data: (await ruleViews([row]))[0] });
});

dataRoutes.patch('/rules/:id', ...canManage, validateBody(rulePatch), idempotent('data-fabric.patch.rules_id', { required: false }), async (req, res) => {
  const r = await loadRule(param(req, 'id'));
  const b = req.body as z.infer<typeof rulePatch>;
  if (b.params) {
    const errs = validateRule({ dataset: r.dataset, checkType: r.checkType, col: r.col, params: b.params }, (await feedContext(r.dataset))?.cols);
    if (errs.length) throw HttpError.badRequest('Validation failed', errs);
  }
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.dataQualityRule.update({ where: { id: r.id }, data: { ...(b.name ? { name: b.name } : {}), ...(b.severity ? { severity: b.severity } : {}), ...(b.active !== undefined ? { active: b.active } : {}), ...(b.params ? { params: b.params as Prisma.InputJsonValue } : {}) }, include: ruleInclude });
    await writeAudit(tx, audit(req), { action: 'data.rule_updated', objectType: 'dq_rule', objectId: r.id, before: { name: r.name, severity: r.severity, active: r.active, params: r.params }, after: { name: u.name, severity: u.severity, active: u.active, params: u.params } });
    return u;
  });
  res.json({ data: (await ruleViews([row]))[0] });
});

// ================================================================ rule runs

/** Executes one rule against the live table, records the run and reconciles the exceptions list. */
export interface RuleActor {
  userId: string;
  ctx: AuditContext;
}
const executeRule = (req: Request, rule: Prisma.DataQualityRuleGetPayload<object>) => executeRuleAs({ userId: req.user!.id, ctx: audit(req) }, rule);

/** Same run for a person (a request) or the scheduler (the rule's creator, system audit context). */
export async function executeRuleAs(actor: RuleActor, rule: Prisma.DataQualityRuleGetPayload<object>) {
  let status: 'PASS' | 'FAIL' | 'ERROR' = 'PASS';
  let rowsChecked = 0;
  let failures = 0;
  let summary: string | null = null;
  let found: { k: string; d: string }[] = [];
  try {
    const feed = await feedContext(rule.dataset);
    if (feed) {
      const rows = (await prisma.dataStagedRecord.findMany({ where: { sourceId: feed.source.id }, select: { recordKey: true, data: true }, take: 100_000 })).map((r) => ({ key: r.recordKey, data: r.data as Record<string, unknown> }));
      if (!rows.length) throw new Error('The feed has no staged rows; upload a file first');
      let refValues: Set<string> | null = null;
      if (rule.checkType === 'CROSS_TABLE') {
        const p = (rule.params ?? {}) as { refDataset: string; refCol: string };
        const ref = DATASET_MAP.get(p.refDataset);
        if (!ref || (!ref.cols[p.refCol] && p.refCol !== ref.keyCol)) throw new Error('Reference dataset or column is not in the registry');
        refValues = new Set((await prisma.$queryRawUnsafe<{ v: string }[]>(`SELECT DISTINCT CAST(t.\`${p.refCol}\` AS CHAR) AS v FROM \`${ref.table}\` t ${ref.base ? `WHERE ${ref.base}` : ''} LIMIT 500000`)).map((x) => x.v));
      }
      const out = evalFeedRule({ checkType: rule.checkType, col: rule.col, params: rule.params }, rows, feed.cols, refValues);
      rowsChecked = out.rowsChecked;
      failures = out.failures;
      found = out.found;
      status = failures ? 'FAIL' : 'PASS';
      summary = failures ? `${failures} failing of ${rowsChecked}` : `${rowsChecked} rows checked, no failures`;
    } else {
    const c = compile({ dataset: rule.dataset, checkType: rule.checkType, col: rule.col, params: rule.params });
    rowsChecked = num((await one<{ n: bigint }>(c.countSql)).n);
    if (c.freshness) {
      const m = (await one<{ m: Date | null }>(c.freshness.sql)).m;
      const age = m ? ageDays(new Date(m), new Date()) : null;
      if (age === null || age > c.freshness.maxAgeDays) {
        failures = 1;
        found = [{ k: rule.dataset, d: age === null ? `No ${rule.col} values at all` : `Newest ${rule.col} is ${age} days old (limit ${c.freshness.maxAgeDays})` }];
      }
    } else {
      failures = num((await one<{ n: bigint }>(c.failCountSql, c.params)).n);
      if (failures) found = await prisma.$queryRawUnsafe<{ k: string; d: string }[]>(c.failSql, ...c.params);
    }
    status = failures ? 'FAIL' : 'PASS';
    summary = failures ? `${failures} failing of ${rowsChecked}` : `${rowsChecked} rows checked, no failures`;
    }
  } catch (e) {
    status = 'ERROR';
    summary = (e instanceof Error ? e.message : String(e)).slice(0, 480);
  }
  return prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'dqRun');
    const run = await tx.dataQualityRun.create({ data: { ref, ruleId: rule.id, status, rowsChecked, failures, summary, ranBy: actor.userId } });
    if (status !== 'ERROR') {
      const existing = await tx.dataQualityException.findMany({ where: { ruleId: rule.id, status: { in: ['OPEN', 'ACKNOWLEDGED', 'WAIVED'] } }, select: { id: true, recordKey: true, status: true } });
      const failing = new Set(found.map((f) => f.k));
      const have = new Set(existing.map((e) => e.recordKey));
      // A record that now passes is resolved automatically (waived ones too, so a future failure is raised afresh).
      const cleared = existing.filter((e) => !failing.has(e.recordKey) && found.length < 200).map((e) => e.id);
      if (cleared.length) await tx.dataQualityException.updateMany({ where: { id: { in: cleared } }, data: { status: 'RESOLVED', resolution: `No longer failing at ${ref}`, resolvedBy: actor.userId, resolvedAt: new Date() } });
      const fresh = found.filter((f) => !have.has(f.k));
      if (fresh.length) await tx.dataQualityException.createMany({ data: fresh.map((f) => ({ runId: run.id, ruleId: rule.id, recordKey: f.k.slice(0, 80), detail: f.d.slice(0, 300) })) });
    }
    await writeAudit(tx, actor.ctx, { action: 'data.rule_run', objectType: 'dq_rule', objectId: rule.id, after: { run: ref, status, rowsChecked, failures } });
    return run;
  });
}

dataRoutes.post('/rules/:id/run', ...canManage, idempotent('data.rule_run', { required: false }), async (req, res) => {
  const rule = await loadRule(param(req, 'id'));
  const run = await executeRule(req, rule);
  res.status(201).json({ data: { ref: run.ref, status: run.status, rowsChecked: run.rowsChecked, failures: run.failures, summary: run.summary } });
});

dataRoutes.post('/runs/run-all', ...canManage, async (req, res) => {
  const rules = await prisma.dataQualityRule.findMany({ where: { active: true }, orderBy: { key: 'asc' }, take: 200 });
  const out = [];
  for (const r of rules) {
    const run = await executeRule(req, r);
    out.push({ rule: r.key, ref: run.ref, status: run.status, failures: run.failures });
  }
  res.status(201).json({ data: out, passed: out.filter((o) => o.status === 'PASS').length, failed: out.filter((o) => o.status === 'FAIL').length, errored: out.filter((o) => o.status === 'ERROR').length });
});

const runsQuery = z.object({ ruleId: z.string().trim().max(36).optional(), status: z.enum(['PASS', 'FAIL', 'ERROR']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
dataRoutes.get('/runs', ...canView, validateQuery(runsQuery), async (req, res) => {
  const f = query<z.infer<typeof runsQuery>>(req);
  const where: Prisma.DataQualityRunWhereInput = { ...(f.ruleId ? { ruleId: f.ruleId } : {}), ...(f.status ? { status: f.status } : {}) };
  const [rows, total] = await Promise.all([prisma.dataQualityRun.findMany({ where, include: { rule: { select: { key: true, name: true, dataset: true, severity: true } } }, orderBy: { ranAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.dataQualityRun.count({ where })]);
  const n = await names(rows.map((r) => r.ranBy));
  res.json({ data: rows.map((r) => ({ id: r.id, ref: r.ref, ruleKey: r.rule.key, ruleName: r.rule.name, dataset: r.rule.dataset, severity: r.rule.severity, status: r.status, rowsChecked: r.rowsChecked, failures: r.failures, summary: r.summary, ranBy: n.get(r.ranBy) ?? null, ranAt: r.ranAt.toISOString() })), total });
});

// ================================================================ exceptions

const excQuery = z.object({ status: z.string().trim().max(80).optional(), ruleId: z.string().trim().max(36).optional(), dataset: z.string().trim().max(40).optional(), severity: z.enum(SEVERITIES).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
dataRoutes.get('/exceptions', ...canView, validateQuery(excQuery), async (req, res) => {
  const f = query<z.infer<typeof excQuery>>(req);
  const statuses = f.status?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const ruleWhere: Prisma.DataQualityRuleWhereInput = { ...(f.dataset ? { dataset: f.dataset } : {}), ...(f.severity ? { severity: f.severity } : {}) };
  const where: Prisma.DataQualityExceptionWhereInput = { ...(statuses?.length ? { status: { in: statuses } } : {}), ...(f.ruleId ? { ruleId: f.ruleId } : {}), ...(Object.keys(ruleWhere).length ? { run: { rule: ruleWhere } } : {}) };
  const [rows, total] = await Promise.all([prisma.dataQualityException.findMany({ where, include: { run: { include: { rule: { select: { key: true, name: true, dataset: true, severity: true } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: f.limit, skip: f.offset }), prisma.dataQualityException.count({ where })]);
  const n = await names(rows.map((r) => r.resolvedBy));
  res.json({ data: rows.map((e) => ({ id: e.id, ruleKey: e.run.rule.key, ruleName: e.run.rule.name, dataset: e.run.rule.dataset, severity: e.run.rule.severity, run: e.run.ref, recordKey: e.recordKey, detail: e.detail, status: e.status, resolution: e.resolution, resolvedBy: e.resolvedBy ? n.get(e.resolvedBy) ?? null : null, resolvedAt: e.resolvedAt?.toISOString() ?? null, createdAt: e.createdAt.toISOString() })), total });
});

async function transition(req: Request, to: 'ACKNOWLEDGED' | 'RESOLVED' | 'WAIVED', from: string[], withReason: boolean) {
  const e = await prisma.dataQualityException.findUnique({ where: { id: param(req, 'id') } });
  if (!e) throw HttpError.notFound('Exception not found');
  if (!from.includes(e.status)) throw HttpError.conflict(`The exception is ${e.status}; it cannot be moved to ${to}`, 'invalid_state');
  const reason = withReason ? (req.body as z.infer<typeof reasonSchema>).reason : null;
  await prisma.$transaction(async (tx) => {
    const r = await tx.dataQualityException.updateMany({ where: { id: e.id, status: e.status }, data: { status: to, ...(reason ? { resolution: reason } : {}), ...(to !== 'ACKNOWLEDGED' ? { resolvedBy: req.user!.id, resolvedAt: new Date() } : {}) } });
    if (r.count !== 1) throw HttpError.conflict('This exception was changed by someone else. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), { action: `data.exception_${to.toLowerCase()}`, objectType: 'dq_exception', objectId: e.id, before: { status: e.status }, after: { status: to, recordKey: e.recordKey }, reason });
  });
  return { id: e.id, status: to };
}
dataRoutes.post('/exceptions/:id/acknowledge', ...canManage, idempotent('data-fabric.post.exceptions_id_acknowledge', { required: false }), async (req, res) => res.json({ data: await transition(req, 'ACKNOWLEDGED', ['OPEN'], false) }));
dataRoutes.post('/exceptions/:id/resolve', ...canManage, validateBody(reasonSchema), async (req, res) => res.json({ data: await transition(req, 'RESOLVED', ['OPEN', 'ACKNOWLEDGED'], true) }));
dataRoutes.post('/exceptions/:id/waive', ...canManage, validateBody(reasonSchema), async (req, res) => res.json({ data: await transition(req, 'WAIVED', ['OPEN', 'ACKNOWLEDGED'], true) }));

// ================================================================ summary

dataRoutes.get('/summary', ...canView, async (_req, res) => {
  const [sources, jobs24, failedJobs24, rules, openExc, runs] = await Promise.all([
    prisma.dataSource.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.dataIngestionJob.count({ where: { startedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.dataIngestionJob.count({ where: { startedAt: { gte: new Date(Date.now() - 86_400_000) }, status: 'FAILED' } }),
    prisma.dataQualityRule.findMany({ where: { active: true }, select: { id: true, dataset: true, severity: true } }),
    prisma.dataQualityException.findMany({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { run: { select: { rule: { select: { severity: true } } } } } }),
    prisma.dataQualityRun.findMany({ where: { ruleId: { in: (await prisma.dataQualityRule.findMany({ where: { active: true }, select: { id: true } })).map((r) => r.id) } }, orderBy: { ranAt: 'desc' }, select: { ruleId: true, status: true }, take: 2000 }),
  ]);
  const last = new Map<string, string>();
  for (const r of runs) if (!last.has(r.ruleId)) last.set(r.ruleId, r.status);
  const passing = [...last.values()].filter((s) => s === 'PASS').length;
  const bySeverity: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const e of openExc) bySeverity[e.run.rule.severity] = (bySeverity[e.run.rule.severity] ?? 0) + 1;
  res.json({ data: { sources: Object.fromEntries(sources.map((s) => [s.status, s._count._all])), jobsLast24h: jobs24, failedJobsLast24h: failedJobs24, activeRules: rules.length, rulesNeverRun: rules.length - last.size, rulesPassing: passing, rulesFailing: [...last.values()].filter((s) => s === 'FAIL').length, rulesErroring: [...last.values()].filter((s) => s === 'ERROR').length, openExceptions: openExc.length, openBySeverity: bySeverity } });
});
