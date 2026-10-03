import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { enqueue } from '../../lib/outbox';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import { DATASETS, DATASET_MAP, FEED_PREFIX, SEVERITIES } from './data.engine';
import { DQ_CADENCES, nextDqRun, runDueSchedules } from './data.schedule';

/**
 * Data Fabric enforcement (R4-9), mounted with the data routes under `/api/v1/data`: quality-rule schedules, the
 * exception work queue (owner, due date, escalation) and dataset lineage. `operations.view` reads, `data.manage` writes.
 */
export const dataEnforceRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('operations.view')];
const canManage = [...staff, requirePermission('operations.view', 'data.manage')];
const id36 = z.string().trim().min(1).max(36);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function names(ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = u.length ? await prisma.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

/** Active staff who can own an exception. */
dataEnforceRoutes.get('/staff', ...canView, async (_req, res) => {
  const rows = await prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' }, take: 300 });
  res.json({ data: rows.map((u) => ({ id: u.id, name: u.name || u.email })) });
});

// ================================================================ schedules

dataEnforceRoutes.get('/schedules', ...canView, async (_req, res) => {
  const rows = await prisma.dqSchedule.findMany({ orderBy: { nextRunAt: 'asc' }, take: 500 });
  const rules = new Map((await prisma.dataQualityRule.findMany({ where: { id: { in: rows.map((r) => r.ruleId) } }, select: { id: true, key: true, name: true, dataset: true, severity: true, active: true } })).map((r) => [r.id, r]));
  res.json({
    data: rows.map((s) => {
      const r = rules.get(s.ruleId);
      return { id: s.id, ruleId: s.ruleId, ruleKey: r?.key ?? null, ruleName: r?.name ?? null, dataset: r?.dataset ?? null, severity: r?.severity ?? null, ruleActive: r?.active ?? false, cadence: s.cadence, enabled: s.enabled, nextRunAt: iso(s.nextRunAt), lastRunAt: iso(s.lastRunAt), lastRunRef: s.lastRunRef, lastStatus: s.lastStatus, due: s.enabled && s.nextRunAt.getTime() <= Date.now() };
    }),
    cadences: DQ_CADENCES,
  });
});

const scheduleBody = z.object({ cadence: z.enum(DQ_CADENCES), enabled: z.boolean().default(true), firstRunAt: z.string().datetime().optional() }).strict();
dataEnforceRoutes.put('/rules/:id/schedule', ...canManage, validateBody(scheduleBody), idempotent('data.schedule_set', { required: false }), async (req, res) => {
  const rule = await prisma.dataQualityRule.findUnique({ where: { id: param(req, 'id') } });
  if (!rule) throw HttpError.notFound('Rule not found');
  const b = req.body as z.infer<typeof scheduleBody>;
  const first = b.firstRunAt ? new Date(b.firstRunAt) : nextDqRun(b.cadence, new Date());
  const prev = await prisma.dqSchedule.findUnique({ where: { ruleId: rule.id } });
  const row = await prisma.$transaction(async (tx) => {
    const s = await tx.dqSchedule.upsert({
      where: { ruleId: rule.id },
      create: { ruleId: rule.id, cadence: b.cadence, enabled: b.enabled, nextRunAt: first, createdBy: req.user!.id },
      update: { cadence: b.cadence, enabled: b.enabled, ...(prev && prev.cadence === b.cadence && !b.firstRunAt ? {} : { nextRunAt: first }) },
    });
    await writeAudit(tx, audit(req), { action: 'data.schedule_set', objectType: 'dq_rule', objectId: rule.id, before: prev ? { cadence: prev.cadence, enabled: prev.enabled } : null, after: { cadence: s.cadence, enabled: s.enabled, nextRunAt: s.nextRunAt.toISOString() } });
    return s;
  });
  res.json({ data: { id: row.id, ruleId: rule.id, cadence: row.cadence, enabled: row.enabled, nextRunAt: row.nextRunAt.toISOString() } });
});

dataEnforceRoutes.delete('/rules/:id/schedule', ...canManage, async (req, res) => {
  const s = await prisma.dqSchedule.findUnique({ where: { ruleId: param(req, 'id') } });
  if (!s) throw HttpError.notFound('That rule has no schedule');
  await prisma.$transaction(async (tx) => {
    await tx.dqSchedule.delete({ where: { id: s.id } });
    await writeAudit(tx, audit(req), { action: 'data.schedule_removed', objectType: 'dq_rule', objectId: s.ruleId, before: { cadence: s.cadence, enabled: s.enabled } });
  });
  res.json({ data: { removed: true } });
});

dataEnforceRoutes.post('/schedules/run-due', ...canManage, async (req, res) => {
  const r = await runDueSchedules({ runBy: { userId: req.user!.id, ctx: audit(req) } });
  res.json({ data: r });
});

// ================================================================ exception work queue

const queueQuery = z.object({ mine: z.enum(['0', '1']).optional(), overdue: z.enum(['0', '1']).optional(), unowned: z.enum(['0', '1']).optional(), severity: z.enum(SEVERITIES).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
dataEnforceRoutes.get('/exception-queue', ...canView, validateQuery(queueQuery), async (req, res) => {
  const f = query<z.infer<typeof queueQuery>>(req);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const workWhere: Prisma.DqExceptionWorkWhereInput = {};
  if (f.mine === '1') workWhere.ownerId = req.user!.id;
  if (f.overdue === '1') workWhere.dueOn = { lt: today };
  const hasWork = Object.keys(workWhere).length > 0;
  let ids: string[] | undefined;
  if (hasWork) ids = (await prisma.dqExceptionWork.findMany({ where: workWhere, select: { exceptionId: true }, take: 5000 })).map((w) => w.exceptionId);
  let where: Prisma.DataQualityExceptionWhereInput = { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, ...(ids ? { id: { in: ids } } : {}), ...(f.severity ? { run: { rule: { severity: f.severity } } } : {}) };
  if (f.unowned === '1') {
    const owned = (await prisma.dqExceptionWork.findMany({ where: { ownerId: { not: null } }, select: { exceptionId: true }, take: 5000 })).map((w) => w.exceptionId);
    where = { ...where, id: { ...(ids ? { in: ids } : {}), notIn: owned } };
  }
  const rows = await prisma.dataQualityException.findMany({ where, include: { run: { include: { rule: { select: { key: true, name: true, dataset: true, severity: true } } } } }, orderBy: [{ createdAt: 'asc' }], take: f.limit });
  const work = new Map((await prisma.dqExceptionWork.findMany({ where: { exceptionId: { in: rows.map((r) => r.id) } } })).map((w) => [w.exceptionId, w]));
  const n = await names([...work.values()].map((w) => w.ownerId));
  res.json({
    data: rows.map((e) => {
      const w = work.get(e.id);
      return { id: e.id, ruleKey: e.run.rule.key, ruleName: e.run.rule.name, dataset: e.run.rule.dataset, severity: e.run.rule.severity, recordKey: e.recordKey, detail: e.detail, status: e.status, createdAt: e.createdAt.toISOString(), ownerId: w?.ownerId ?? null, owner: w?.ownerId ? n.get(w.ownerId) ?? null : null, dueOn: day(w?.dueOn), overdue: !!w?.dueOn && w.dueOn.getTime() < today.getTime(), escalationLevel: w?.escalationLevel ?? 0, escalatedAt: iso(w?.escalatedAt), note: w?.note ?? null };
    }),
  });
});

const assignBody = z.object({ ownerId: id36, dueOn: dateStr.optional(), note: z.string().trim().max(500).optional() }).strict();
dataEnforceRoutes.post('/exceptions/:id/assign', ...canManage, validateBody(assignBody), idempotent('data.exception_assign', { required: false }), async (req, res) => {
  const e = await prisma.dataQualityException.findUnique({ where: { id: param(req, 'id') }, include: { run: { include: { rule: { select: { key: true } } } } } });
  if (!e) throw HttpError.notFound('Exception not found');
  if (!['OPEN', 'ACKNOWLEDGED'].includes(e.status)) throw HttpError.conflict(`The exception is ${e.status}; it cannot be assigned`, 'invalid_state');
  const b = req.body as z.infer<typeof assignBody>;
  const owner = await prisma.user.findFirst({ where: { id: b.ownerId, isActive: true, roles: { some: { role: { portal: 'admin' } } } }, select: { id: true, name: true, email: true } });
  if (!owner) throw HttpError.badRequest('Validation failed', [{ path: 'ownerId', message: 'Choose an active staff user' }]);
  const due = b.dueOn ? toDate(b.dueOn) : null;
  if (due && due.getTime() < toDate(new Date().toISOString().slice(0, 10)).getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'dueOn', message: 'The due date cannot be in the past' }]);
  const prev = await prisma.dqExceptionWork.findUnique({ where: { exceptionId: e.id } });
  await prisma.$transaction(async (tx) => {
    await tx.dqExceptionWork.upsert({
      where: { exceptionId: e.id },
      create: { exceptionId: e.id, ownerId: owner.id, dueOn: due, note: b.note ?? null, assignedBy: req.user!.id },
      update: { ownerId: owner.id, dueOn: due, note: b.note ?? null, assignedBy: req.user!.id, ...(prev?.ownerId !== owner.id ? { escalationLevel: 0, escalatedAt: null } : {}) },
    });
    await writeAudit(tx, audit(req), { action: 'data.exception_assigned', objectType: 'dq_exception', objectId: e.id, before: prev ? { ownerId: prev.ownerId, dueOn: day(prev.dueOn) } : null, after: { ownerId: owner.id, dueOn: day(due), recordKey: e.recordKey } });
    if (owner.id !== req.user!.id) await enqueue(tx, 'notify.users', { userIds: [owner.id], type: 'data.quality', title: `Data-quality exception assigned: ${e.run.rule.key} ${e.recordKey}`, body: b.note ?? e.detail, link: '/ops/data', email: true });
  });
  res.json({ data: { id: e.id, ownerId: owner.id, owner: owner.name || owner.email, dueOn: day(due) } });
});

// ================================================================ lineage

const FEED_RE = /^feed:[A-Za-z0-9_.-]{1,58}$/;
async function assertDataset(key: string, path: string) {
  if (DATASET_MAP.has(key)) return;
  if (FEED_RE.test(key) && (await prisma.dataSource.findUnique({ where: { key: key.slice(FEED_PREFIX.length) }, select: { id: true } }))) return;
  throw HttpError.badRequest('Validation failed', [{ path, message: `Unknown dataset; use a registry key (${DATASETS.map((d) => d.key).join(', ')}) or feed:<source key>` }]);
}

type Edge = { from: string; to: string };
function reach(edges: Edge[], start: string, dir: 'down' | 'up'): string[] {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      const [a, b] = dir === 'down' ? [e.from, e.to] : [e.to, e.from];
      if (a === cur && !seen.has(b) && b !== start) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  return [...seen].sort();
}

/** Graph: every registry dataset plus the datasets named by an edge, with live quality state, and the edges. */
dataEnforceRoutes.get('/lineage', ...canView, async (_req, res) => {
  const [edges, rules, exc, runs] = await Promise.all([
    prisma.dataLineageEdge.findMany({ orderBy: [{ fromDataset: 'asc' }, { toDataset: 'asc' }] }),
    prisma.dataQualityRule.findMany({ where: { active: true }, select: { id: true, dataset: true } }),
    prisma.dataQualityException.findMany({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { ruleId: true } }),
    prisma.dataQualityRun.findMany({ orderBy: { ranAt: 'desc' }, select: { ruleId: true, status: true }, take: 3000 }),
  ]);
  const ruleDs = new Map(rules.map((r) => [r.id, r.dataset]));
  const last = new Map<string, string>();
  for (const r of runs) if (!last.has(r.ruleId)) last.set(r.ruleId, r.status);
  const keys = new Set<string>([...DATASETS.map((d) => d.key), ...edges.flatMap((e) => [e.fromDataset, e.toDataset])]);
  const stat = (k: string) => {
    const mine = rules.filter((r) => r.dataset === k);
    return {
      rules: mine.length,
      failing: mine.filter((r) => last.get(r.id) === 'FAIL' || last.get(r.id) === 'ERROR').length,
      openExceptions: exc.filter((e) => ruleDs.get(e.ruleId) === k).length,
    };
  };
  const g = edges.map((e) => ({ from: e.fromDataset, to: e.toDataset }));
  res.json({
    data: {
      nodes: [...keys].sort().map((k) => ({ key: k, label: DATASET_MAP.get(k)?.label ?? k, feed: k.startsWith(FEED_PREFIX), ...stat(k), downstream: reach(g, k, 'down').length, upstream: reach(g, k, 'up').length })),
      edges: edges.map((e) => ({ id: e.id, from: e.fromDataset, to: e.toDataset, kind: e.kind, description: e.description })),
    },
  });
});

/** Everything upstream and downstream of one dataset, with the open exceptions that could explain a problem upstream. */
dataEnforceRoutes.get('/lineage/impact', ...canView, validateQuery(z.object({ dataset: z.string().trim().min(1).max(64) })), async (req, res) => {
  const ds = query<{ dataset: string }>(req).dataset;
  await assertDataset(ds, 'dataset');
  const g = (await prisma.dataLineageEdge.findMany()).map((e) => ({ from: e.fromDataset, to: e.toDataset }));
  const upstream = reach(g, ds, 'up');
  const downstream = reach(g, ds, 'down');
  const rules = await prisma.dataQualityRule.findMany({ where: { dataset: { in: upstream } }, select: { id: true, dataset: true } });
  const open = rules.length ? await prisma.dataQualityException.groupBy({ by: ['ruleId'], where: { ruleId: { in: rules.map((r) => r.id) }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: { _all: true } }) : [];
  const byDs = new Map<string, number>();
  for (const o of open) {
    const d = rules.find((r) => r.id === o.ruleId)!.dataset;
    byDs.set(d, (byDs.get(d) ?? 0) + o._count._all);
  }
  res.json({ data: { dataset: ds, upstream, downstream, upstreamOpenExceptions: [...byDs].map(([dataset, openExceptions]) => ({ dataset, openExceptions })) } });
});

const edgeBody = z.object({ fromDataset: z.string().trim().min(1).max(64), toDataset: z.string().trim().min(1).max(64), kind: z.enum(['FEEDS', 'DERIVES', 'VALIDATES']), description: z.string().trim().max(300).optional() }).strict();
dataEnforceRoutes.post('/lineage', ...canManage, validateBody(edgeBody), idempotent('data.lineage_add', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof edgeBody>;
  await assertDataset(b.fromDataset, 'fromDataset');
  await assertDataset(b.toDataset, 'toDataset');
  if (b.fromDataset === b.toDataset) throw HttpError.badRequest('Validation failed', [{ path: 'toDataset', message: 'A dataset cannot feed itself' }]);
  const existing = await prisma.dataLineageEdge.findUnique({ where: { fromDataset_toDataset_kind: { fromDataset: b.fromDataset, toDataset: b.toDataset, kind: b.kind } } });
  if (existing) return void res.json({ data: { id: existing.id, created: false } });
  const g = (await prisma.dataLineageEdge.findMany()).map((e) => ({ from: e.fromDataset, to: e.toDataset }));
  if (reach(g, b.toDataset, 'down').includes(b.fromDataset)) throw HttpError.conflict(`${b.toDataset} already feeds ${b.fromDataset}; that edge would create a loop`, 'lineage_cycle');
  const row = await prisma.$transaction(async (tx) => {
    const e = await tx.dataLineageEdge.create({ data: { fromDataset: b.fromDataset, toDataset: b.toDataset, kind: b.kind, description: b.description ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'data.lineage_added', objectType: 'data_lineage', objectId: e.id, after: { from: b.fromDataset, to: b.toDataset, kind: b.kind } });
    return e;
  });
  res.status(201).json({ data: { id: row.id, created: true } });
});

dataEnforceRoutes.delete('/lineage/:id', ...canManage, async (req, res) => {
  const e = await prisma.dataLineageEdge.findUnique({ where: { id: param(req, 'id') } });
  if (!e) throw HttpError.notFound('Lineage edge not found');
  await prisma.$transaction(async (tx) => {
    await tx.dataLineageEdge.delete({ where: { id: e.id } });
    await writeAudit(tx, audit(req), { action: 'data.lineage_removed', objectType: 'data_lineage', objectId: e.id, before: { from: e.fromDataset, to: e.toDataset, kind: e.kind } });
  });
  res.json({ data: { removed: true } });
});
