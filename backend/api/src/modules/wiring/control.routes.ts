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
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { assertUpdated, audit } from '../ops/ops.common';
import { dashboardToday, generateRunbook, operationsStatus } from './control.service';
import { endOfDay, taskViews, TASK_AREAS, TASK_STATUSES, type TaskRow } from './tasks';

/**
 * Operations Control (SRD 5.A.16 `operations`, `operations.view`) at `/api/v1/operations`, and the Command Centre
 * (5.A.1 `command`, `dashboard.view`) at `/api/v1/dashboard`. Admin-portal staff only.
 * Status and KPIs are aggregated live from recon, cash, NAV, accounting, corporate actions and orders. Runbook tasks
 * are persisted: created by staff or generated from live conditions (idempotent per source), with owner, dependency,
 * blocked reason and an audit trail for every change. `operations.view` holders work the runbook.
 */
export const operationsRoutes = Router();
export const dashboardRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canOps = [...staff, requirePermission('operations.view')];
const canDash = [...staff, requirePermission('dashboard.view')];

const when = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z?)?$/, 'Use YYYY-MM-DD or YYYY-MM-DDTHH:MM')
  .transform((v) => new Date(v.length === 10 ? `${v}T17:00:00.000Z` : v.endsWith('Z') ? v.replace(' ', 'T') : `${v.replace(' ', 'T')}Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
const noteSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();

const createBody = z
  .object({
    area: z.enum(TASK_AREAS),
    title: z.string().trim().min(3).max(200),
    detail: z.string().trim().max(1000).nullable().optional(),
    dueAt: when,
    ownerId: z.string().trim().max(36).nullable().optional(),
    dependsOnId: z.string().trim().max(36).nullable().optional(),
    link: z.string().trim().max(300).regex(/^\/ops\//, 'Link must be an /ops/ path').nullable().optional(),
  })
  .strict();
const patchBody = z
  .object({ title: z.string().trim().min(3).max(200), detail: z.string().trim().max(1000).nullable(), dueAt: when, ownerId: z.string().trim().max(36).nullable(), dependsOnId: z.string().trim().max(36).nullable() })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
const listQuery = z.object({
  filter: z.enum(['all', 'due', 'blocked', 'scheduled', 'done']).default('all'),
  area: z.enum(TASK_AREAS).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

async function loadTask(id: string): Promise<TaskRow> {
  const t = await prisma.opsTask.findFirst({ where: { OR: [{ id }, { ref: id.toUpperCase() }] } });
  if (!t) throw HttpError.notFound('Task not found');
  return t;
}
async function checkRefs(b: { ownerId?: string | null; dependsOnId?: string | null }, selfId?: string) {
  if (b.ownerId && !(await prisma.user.findUnique({ where: { id: b.ownerId }, select: { id: true } }))) throw HttpError.badRequest('Validation failed', [{ path: 'ownerId', message: 'Unknown user' }]);
  if (b.dependsOnId) {
    if (b.dependsOnId === selfId) throw HttpError.badRequest('Validation failed', [{ path: 'dependsOnId', message: 'A task cannot depend on itself' }]);
    if (!(await prisma.opsTask.findUnique({ where: { id: b.dependsOnId }, select: { id: true } }))) throw HttpError.badRequest('Validation failed', [{ path: 'dependsOnId', message: 'Unknown task' }]);
  }
}
const one = async (t: TaskRow) => (await taskViews([t]))[0]!;

operationsRoutes.get('/status', ...canOps, async (_req, res) => {
  res.json({ data: await operationsStatus() });
});

operationsRoutes.get('/tasks', ...canOps, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const eod = endOfDay();
  const where: Prisma.OpsTaskWhereInput = { ...(f.area ? { area: f.area } : {}) };
  const live = { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } };
  if (f.filter === 'due') Object.assign(where, live, { dueAt: { lte: eod } });
  else if (f.filter === 'scheduled') Object.assign(where, { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { gt: eod } });
  else if (f.filter === 'blocked') Object.assign(where, { status: 'BLOCKED' });
  else if (f.filter === 'done') Object.assign(where, { status: { in: ['DONE', 'CANCELLED'] } });
  else Object.assign(where, { OR: [live, { status: { in: ['DONE', 'CANCELLED'] }, updatedAt: { gte: new Date(Date.now() - 86_400_000) } }] });
  const rows = await prisma.opsTask.findMany({ where, orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }], take: f.limit });
  const views = await taskViews(rows);
  const counts = { due: 0, blocked: 0, scheduled: 0, done: 0 };
  for (const v of views) {
    if (v.state === 'DUE') counts.due++;
    else if (v.state === 'BLOCKED') counts.blocked++;
    else if (v.state === 'SCHEDULED') counts.scheduled++;
    else counts.done++;
  }
  if (f.format === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['ref,area,title,due,state,owner,depends_on,detail', ...views.map((v) => [v.ref, v.area, v.title, v.dueAt, v.state, v.ownerName, v.dependsOn?.ref, v.detail].map(esc).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="runbook.csv"');
    res.send(csv);
    return;
  }
  res.json({ data: views, total: views.length, summary: counts });
});

operationsRoutes.post('/tasks/generate', ...canOps, async (req, res) => {
  const r = await generateRunbook();
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'operations.runbook_refreshed', objectType: 'ops_runbook', objectId: new Date().toISOString().slice(0, 10), after: { ...r } }));
  res.json({ data: r });
});

operationsRoutes.post('/tasks', ...canOps, validateBody(createBody), idempotent('operations.task_create'), async (req, res) => {
  const b = req.body as z.infer<typeof createBody>;
  await checkRefs(b);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'opsTask');
    const t = await tx.opsTask.create({ data: { ref, area: b.area, title: b.title, detail: b.detail ?? null, dueAt: b.dueAt, ownerId: b.ownerId ?? null, dependsOnId: b.dependsOnId ?? null, link: b.link ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'operations.task_created', objectType: 'ops_task', objectId: t.id, after: { ref, area: b.area, title: b.title, dueAt: b.dueAt.toISOString(), ownerId: b.ownerId ?? null } });
    return t;
  });
  res.status(201).json({ data: await one(row) });
});

operationsRoutes.get('/tasks/:id', ...canOps, async (req, res) => {
  res.json({ data: await one(await loadTask(param(req, 'id'))) });
});

operationsRoutes.patch('/tasks/:id', ...canOps, validateBody(patchBody), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  if (['DONE', 'CANCELLED'].includes(t.status)) throw HttpError.conflict(`${t.ref} is ${t.status}; reopen it to edit`, 'invalid_state');
  const b = req.body as z.infer<typeof patchBody>;
  await checkRefs(b, t.id);
  const row = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.opsTask.updateMany({ where: { id: t.id, version: t.version, status: { notIn: ['DONE', 'CANCELLED'] } }, data: { ...b, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'operations.task_updated', objectType: 'ops_task', objectId: t.id, before: { title: t.title, dueAt: t.dueAt.toISOString(), ownerId: t.ownerId, dependsOnId: t.dependsOnId }, after: { ...b, dueAt: b.dueAt?.toISOString() } });
    return tx.opsTask.findUniqueOrThrow({ where: { id: t.id } });
  });
  res.json({ data: await one(row) });
});

/** One guarded status change plus its audit event. */
async function transition(req: import('express').Request, t: TaskRow, from: string[], to: (typeof TASK_STATUSES)[number], extra: Prisma.OpsTaskUncheckedUpdateManyInput, action: string, reason?: string) {
  if (!from.includes(t.status)) throw HttpError.conflict(`${t.ref} is ${t.status}; it cannot move to ${to}`, 'invalid_state');
  return prisma.$transaction(async (tx) => {
    assertUpdated((await tx.opsTask.updateMany({ where: { id: t.id, status: t.status, version: t.version }, data: { status: to, ...extra, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action, objectType: 'ops_task', objectId: t.id, before: { status: t.status }, after: { status: to, ref: t.ref }, reason: reason ?? null });
    return tx.opsTask.findUniqueOrThrow({ where: { id: t.id } });
  });
}

operationsRoutes.post('/tasks/:id/start', ...canOps, validateBody(noteSchema), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  res.json({ data: await one(await transition(req, t, ['OPEN', 'BLOCKED'], 'IN_PROGRESS', { blockedReason: null, ownerId: t.ownerId ?? req.user!.id }, 'operations.task_started')) });
});
operationsRoutes.post('/tasks/:id/complete', ...canOps, validateBody(noteSchema), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  if (t.dependsOnId) {
    const dep = await prisma.opsTask.findUnique({ where: { id: t.dependsOnId } });
    if (dep && !['DONE', 'CANCELLED'].includes(dep.status)) throw HttpError.conflict(`${t.ref} depends on ${dep.ref}, which is ${dep.status}`, 'dependency_open');
  }
  res.json({ data: await one(await transition(req, t, ['OPEN', 'IN_PROGRESS', 'BLOCKED'], 'DONE', { completedBy: req.user!.id, completedAt: new Date() }, 'operations.task_completed', (req.body as z.infer<typeof noteSchema>).note)) });
});
operationsRoutes.post('/tasks/:id/block', ...canOps, validateBody(reasonSchema), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  res.json({ data: await one(await transition(req, t, ['OPEN', 'IN_PROGRESS'], 'BLOCKED', { blockedReason: reason }, 'operations.task_blocked', reason)) });
});
operationsRoutes.post('/tasks/:id/reopen', ...canOps, validateBody(reasonSchema), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  res.json({ data: await one(await transition(req, t, ['DONE', 'CANCELLED'], 'OPEN', { completedBy: null, completedAt: null, blockedReason: null }, 'operations.task_reopened', reason)) });
});
operationsRoutes.post('/tasks/:id/cancel', ...canOps, validateBody(reasonSchema), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  res.json({ data: await one(await transition(req, t, ['OPEN', 'IN_PROGRESS', 'BLOCKED'], 'CANCELLED', {}, 'operations.task_cancelled', reason)) });
});

dashboardRoutes.get('/today', ...canDash, async (req, res) => {
  res.json({ data: await dashboardToday(req.user!.permissions) });
});
