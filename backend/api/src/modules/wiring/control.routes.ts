import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { assertUpdated, audit } from '../ops/ops.common';
import { dashboardToday, generateRunbook, operationsStatus } from './control.service';
import { dashboardPanels, operationsCalendar, operationsWorkload } from './insights.service';
import { reconGate } from '../recon/recon.service';
import { endOfDay, handOffDependants, taskViews, TASK_AREAS, TASK_STATUSES, type HandOff, type TaskRow } from './tasks';
import { workbook } from '../../lib/xlsx';

/**
 * Operations Control (SRD 5.A.16 `operations`, `operations.view`) at `/api/v1/operations`, and the Command Centre
 * (5.A.1 `command`, `dashboard.view`) at `/api/v1/dashboard`. Admin-portal staff only.
 * Status and KPIs are aggregated live from recon, cash, NAV, accounting, corporate actions and orders. Runbook tasks
 * are persisted: created by staff or generated from live conditions (idempotent per source), with owner, dependency,
 * blocked reason and an audit trail for every change. `operations.view` holders read the runbook and comment; changing
 * tasks (create, edit, start, complete, block, cancel, reopen, refresh) needs `operations.task.manage` (FR-OPS-012).
 */
export const operationsRoutes = Router();
export const dashboardRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canOps = [...staff, requirePermission('operations.view')];
const canManage = [...staff, requirePermission('operations.view'), requirePermission('operations.task.manage')];
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
    /** BR-063: a control task cannot be completed by the person who created it. */
    isControl: z.boolean().optional(),
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
  /** Click-through from the workload charts (FR-OPS-013). */
  ownerId: z.string().trim().max(36).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
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

/** Valuation and close tasks cannot be completed while material reconciliation breaks are open. */
const GATED_SOURCES = ['NAV:RELEASE', 'CASH:CLOSE', 'ACC:JOURNALS', 'RECON:MATERIAL'];
const isGated = (t: TaskRow) => ['VALUATION', 'CLOSE'].includes(t.area) && (!t.sourceRef || GATED_SOURCES.some((p) => t.sourceRef!.startsWith(p)));

const commentBody = z.object({ body: z.string().trim().min(1, 'Write a comment').max(1000) }).strict();
const rangeQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), format: z.enum(['json', 'csv', 'xlsx']).default('json') });

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
/** CSV formula-injection guard: a cell that starts with = + - @ is prefixed so a spreadsheet keeps it as text (XLSX cells are inline text already). */
const safe = (v: unknown) => { const t = String(v ?? ''); return /^[=+\-@]/.test(t) ? `'${t}` : t; };
function sendTable(res: import('express').Response, format: 'csv' | 'xlsx', name: string, head: string[], rows: unknown[][]) {
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.send(workbook(name, [head, ...rows.map((r) => r.map((c) => String(c ?? '')))]));
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send([head.map(csvCell).join(','), ...rows.map((r) => r.map((c) => csvCell(safe(c))).join(','))].join('\n'));
}

operationsRoutes.get('/calendar', ...canOps, validateQuery(rangeQuery), async (req, res) => {
  const q = query<z.infer<typeof rangeQuery>>(req);
  const today = new Date().toISOString().slice(0, 10);
  const from = q.from ?? `${today.slice(0, 8)}01`;
  const to = q.to ?? new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (span < 0 || span > 92) throw HttpError.badRequest('Validation failed', [{ path: 'to', message: 'Choose a range of 1 to 93 days' }]);
  const cal = await operationsCalendar(from, to);
  if (q.format !== 'json') {
    await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'operations.calendar_exported', objectType: 'ops_runbook', objectId: `${from}..${to}`, after: { format: q.format, from, to, rows: cal.events.length } }));
    sendTable(res, q.format, `operations-calendar-${from}-${to}`, ['date', 'type', 'item', 'detail', 'status', 'amount', 'currency'], cal.events.map((e) => [e.date, e.kind, e.title, e.detail, e.status, e.amount, e.currency]));
    return;
  }
  res.json({ data: cal });
});

operationsRoutes.get('/workload', ...canOps, async (_req, res) => {
  res.json({ data: await operationsWorkload() });
});

operationsRoutes.get('/tasks/:id/comments', ...canOps, async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const rows = await prisma.opsTaskComment.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true, email: true } });
  const name = new Map(users.map((u) => [u.id, u.name || u.email]));
  res.json({ data: rows.map((r) => ({ id: r.id, body: r.body, authorId: r.authorId, authorName: name.get(r.authorId) ?? null, createdAt: r.createdAt.toISOString() })), total: rows.length });
});

operationsRoutes.post('/tasks/:id/comments', ...canOps, validateBody(commentBody), idempotent('operations.task_comment', { required: false }), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const { body } = req.body as z.infer<typeof commentBody>;
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.opsTaskComment.create({ data: { taskId: t.id, body, authorId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'operations.task_commented', objectType: 'ops_task', objectId: t.id, after: { ref: t.ref, commentId: c.id, length: body.length } });
    return c;
  });
  res.status(201).json({ data: { id: row.id, body: row.body, authorId: row.authorId, authorName: req.user!.email, createdAt: row.createdAt.toISOString() } });
});

operationsRoutes.get('/status', ...canOps, async (_req, res) => {
  res.json({ data: await operationsStatus() });
});

/** Workload chart click-through: the chart counts overdue live tasks in today's bar, so today's day window includes them. */
function dueDayWhere(d: string): Prisma.OpsTaskWhereInput {
  const end = new Date(`${d}T23:59:59.999Z`);
  if (d === new Date().toISOString().slice(0, 10)) return { dueAt: { lte: end }, status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } };
  return { dueAt: { gte: new Date(`${d}T00:00:00.000Z`), lte: end } };
}

operationsRoutes.get('/tasks', ...canOps, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const eod = endOfDay();
  const where: Prisma.OpsTaskWhereInput = { ...(f.area ? { area: f.area } : {}), ...(f.ownerId ? { ownerId: f.ownerId === 'none' ? null : f.ownerId } : {}), ...(f.dueDate ? dueDayWhere(f.dueDate) : {}) };
  const live = { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } };
  // A due-date click-through keeps its day window; the filter then only narrows by status.
  const dueWin = (w: Prisma.DateTimeFilter) => (f.dueDate ? {} : { dueAt: w });
  if (f.filter === 'due') Object.assign(where, live, dueWin({ lte: eod }));
  else if (f.filter === 'scheduled') Object.assign(where, { status: { in: ['OPEN', 'IN_PROGRESS'] } }, dueWin({ gt: eod }));
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
  if (f.format !== 'json') {
    await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'operations.runbook_exported', objectType: 'ops_runbook', objectId: new Date().toISOString().slice(0, 10), after: { format: f.format, filter: f.filter, area: f.area ?? null, ownerId: f.ownerId ?? null, dueDate: f.dueDate ?? null, rows: views.length } }));
    sendTable(res, f.format, 'runbook', ['ref', 'area', 'title', 'due', 'state', 'owner', 'depends_on', 'control', 'detail'], views.map((v) => [v.ref, v.area, v.title, v.dueAt, v.state, v.ownerName, v.dependsOn?.ref, v.isControl ? 'yes' : '', v.detail]));
    return;
  }
  res.json({ data: views, total: views.length, summary: counts });
});

operationsRoutes.post('/tasks/generate', ...canManage, idempotent('operations.runbook_refresh', { required: false }), async (req, res) => {
  const r = await generateRunbook();
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'operations.runbook_refreshed', objectType: 'ops_runbook', objectId: new Date().toISOString().slice(0, 10), after: { ...r } }));
  res.json({ data: r });
});

operationsRoutes.post('/tasks', ...canManage, validateBody(createBody), idempotent('operations.task_create'), async (req, res) => {
  const b = req.body as z.infer<typeof createBody>;
  await checkRefs(b);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'opsTask');
    const t = await tx.opsTask.create({ data: { ref, area: b.area, title: b.title, detail: b.detail ?? null, dueAt: b.dueAt, ownerId: b.ownerId ?? null, dependsOnId: b.dependsOnId ?? null, link: b.link ?? null, isControl: b.isControl ?? false, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'operations.task_created', objectType: 'ops_task', objectId: t.id, after: { ref, area: b.area, title: b.title, dueAt: b.dueAt.toISOString(), ownerId: b.ownerId ?? null, isControl: b.isControl ?? false } });
    return t;
  });
  res.status(201).json({ data: await one(row) });
});

operationsRoutes.get('/tasks/:id', ...canOps, async (req, res) => {
  res.json({ data: await one(await loadTask(param(req, 'id'))) });
});

operationsRoutes.patch('/tasks/:id', ...canManage, validateBody(patchBody), idempotent('operations.task_update', { required: false }), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  expectVersion(req, t.version);
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
async function transition(req: import('express').Request, t: TaskRow, from: string[], to: (typeof TASK_STATUSES)[number], extra: Prisma.OpsTaskUncheckedUpdateManyInput, action: string, reason?: string, after?: (tx: Prisma.TransactionClient, row: TaskRow) => Promise<void>) {
  if (!from.includes(t.status)) throw HttpError.conflict(`${t.ref} is ${t.status}; it cannot move to ${to}`, 'invalid_state');
  return prisma.$transaction(async (tx) => {
    assertUpdated((await tx.opsTask.updateMany({ where: { id: t.id, status: t.status, version: t.version }, data: { status: to, ...extra, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action, objectType: 'ops_task', objectId: t.id, before: { status: t.status }, after: { status: to, ref: t.ref }, reason: reason ?? null });
    const row = await tx.opsTask.findUniqueOrThrow({ where: { id: t.id } });
    await after?.(tx, row);
    return row;
  });
}

operationsRoutes.post('/tasks/:id/start', ...canManage, validateBody(noteSchema), idempotent('operations.task_start', { required: false }), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  res.json({ data: await one(await transition(req, t, ['OPEN', 'BLOCKED'], 'IN_PROGRESS', { blockedReason: null, ownerId: t.ownerId ?? req.user!.id }, 'operations.task_started')) });
});
operationsRoutes.post('/tasks/:id/complete', ...canManage, validateBody(noteSchema), idempotent('operations.task_complete', { required: false }), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  // BR-063 (extends BR-001): the person who created a control task cannot mark it Done.
  if (t.isControl && t.createdBy === req.user!.id) throw HttpError.forbidden(`${t.ref} is a control task; its creator cannot mark it Done. Ask a colleague to complete it.`, 'segregation_of_duties');
  if (t.dependsOnId) {
    const dep = await prisma.opsTask.findUnique({ where: { id: t.dependsOnId } });
    if (dep && !['DONE', 'CANCELLED'].includes(dep.status)) throw HttpError.conflict(`${t.ref} depends on ${dep.ref}, which is ${dep.status}`, 'dependency_open');
  }
  if (isGated(t)) {
    const gate = await reconGate();
    if (gate.blocked) throw new HttpError(409, 'recon_gate', `${t.ref} is a valuation or close task; ${gate.breaks.length} Critical or High reconciliation break${gate.breaks.length === 1 ? ' is' : 's are'} still open`, { breaks: gate.breaks.map((x) => ({ ref: x.ref, family: x.family, severity: x.severity, status: x.status })) });
  }
  let handOff: HandOff[] = [];
  const done = await transition(req, t, ['OPEN', 'IN_PROGRESS', 'BLOCKED'], 'DONE', { completedBy: req.user!.id, completedAt: new Date() }, 'operations.task_completed', (req.body as z.infer<typeof noteSchema>).note, async (tx, row) => {
    handOff = await handOffDependants(tx, row, audit(req), 'completed');
  });
  res.json({ data: { ...(await one(done)), handOff } });
});
operationsRoutes.post('/tasks/:id/block', ...canManage, validateBody(reasonSchema), idempotent('operations.task_block', { required: false }), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  res.json({ data: await one(await transition(req, t, ['OPEN', 'IN_PROGRESS'], 'BLOCKED', { blockedReason: reason }, 'operations.task_blocked', reason)) });
});
operationsRoutes.post('/tasks/:id/reopen', ...canManage, validateBody(reasonSchema), idempotent('operations.task_reopen', { required: false }), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  res.json({ data: await one(await transition(req, t, ['DONE', 'CANCELLED'], 'OPEN', { completedBy: null, completedAt: null, blockedReason: null }, 'operations.task_reopened', reason)) });
});
operationsRoutes.post('/tasks/:id/cancel', ...canManage, validateBody(reasonSchema), idempotent('operations.task_cancel', { required: false }), async (req, res) => {
  const t = await loadTask(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  let handOff: HandOff[] = [];
  const row = await transition(req, t, ['OPEN', 'IN_PROGRESS', 'BLOCKED'], 'CANCELLED', {}, 'operations.task_cancelled', reason, async (tx, r) => {
    handOff = await handOffDependants(tx, r, audit(req), 'cancelled');
  });
  res.json({ data: { ...(await one(row)), handOff } });
});

dashboardRoutes.get('/panels', ...canDash, async (req, res) => {
  res.json({ data: await dashboardPanels(req.user!.permissions) });
});

dashboardRoutes.get('/today', ...canDash, async (req, res) => {
  res.json({ data: await dashboardToday(req.user!.permissions) });
});
