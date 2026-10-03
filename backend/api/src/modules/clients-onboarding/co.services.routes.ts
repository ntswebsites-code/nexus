import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { actorName, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requirePermission } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import { PRIORITIES, REQUEST_TYPES, slaDueFor, slaState } from './co.engine';
import { assertStaff, findClientByRef, notifyClientMembers, slaHours, userNames } from './co.service';

/** Investor Services (page `investor-services`): request/case desk with SLA policy and assignment. */
export const coServicesRoutes = Router();

type Row = Prisma.ServiceRequestGetPayload<{ include: { client: { select: { ref: true; name: true } } } }>;

function view(r: Row, names: Map<string, string>) {
  const closed = r.status === 'Closed';
  return {
    id: r.ref,
    uuid: r.id,
    clientRef: r.client.ref,
    client: r.client.name,
    type: r.type,
    priority: r.priority,
    title: r.title,
    detail: r.detail,
    status: r.status,
    assignee: r.assigneeId ? (names.get(r.assigneeId) ?? 'Unknown') : null,
    assigneeId: r.assigneeId,
    owner: r.ownerName,
    progress: r.progress,
    slaDueAt: r.slaDueAt,
    sla: slaState(r.slaDueAt, r.createdAt, closed),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ageHours: Math.round(((closed ? r.updatedAt : new Date()).getTime() - r.createdAt.getTime()) / 3_600_000),
    version: r.version,
  };
}

const include = { client: { select: { ref: true, name: true } } } as const;

async function findRequest(refOrId: string) {
  const r = await prisma.serviceRequest.findFirst({ where: { OR: [{ ref: refOrId }, { id: refOrId }] }, include });
  if (!r) throw HttpError.notFound('Request not found');
  return r;
}

const listQuery = z.object({
  status: z.string().trim().max(60).optional(),
  type: z.string().trim().max(64).optional(),
  assignee: z.string().trim().max(40).optional(),
  sla: z.enum(['Breached', 'At risk', 'On track', 'Closed']).optional(),
  client: z.string().trim().max(40).optional(),
  q: z.string().trim().max(120).optional(),
});

coServicesRoutes.get('/services/requests', requirePermission('clients.view'), validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const client = f.client ? await findClientByRef(f.client) : null;
  const rows = await prisma.serviceRequest.findMany({
    where: {
      ...(f.status ? { status: { in: f.status.split(',').map((s) => s.trim()) } } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.assignee === 'unassigned' ? { assigneeId: null } : f.assignee ? { assigneeId: f.assignee } : {}),
      ...(client ? { clientId: client.id } : {}),
      ...(f.q ? { OR: [{ ref: { contains: f.q } }, { title: { contains: f.q } }, { client: { name: { contains: f.q } } }] } : {}),
    },
    include,
    orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  const names = await userNames(rows.map((r) => r.assigneeId));
  let data = rows.map((r) => view(r, names));
  if (f.sla) data = data.filter((r) => r.sla === f.sla);
  res.json({ data, total: data.length });
});

coServicesRoutes.get('/services/summary', requirePermission('clients.view'), async (_req, res) => {
  const rows = await prisma.serviceRequest.findMany({ include, orderBy: { createdAt: 'desc' }, take: 2000 });
  const names = await userNames(rows.map((r) => r.assigneeId));
  const v = rows.map((r) => view(r, names));
  const open = v.filter((r) => r.status !== 'Closed');
  const count = (pred: (r: (typeof v)[number]) => boolean) => v.filter(pred).length;
  const byType: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};
  for (const r of open) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    const k = r.assignee ?? 'Unassigned';
    byAssignee[k] = (byAssignee[k] ?? 0) + 1;
  }
  const closed = rows.filter((r) => r.status === 'Closed');
  const avg = closed.length ? closed.reduce((a, r) => a + (r.updatedAt.getTime() - r.createdAt.getTime()), 0) / closed.length / 3_600_000 : null;
  const within = closed.filter((r) => !r.slaDueAt || r.updatedAt <= r.slaDueAt).length;
  res.json({
    open: open.length,
    byStatus: Object.fromEntries(['Open', 'In progress', 'Waiting on you', 'Closed'].map((s) => [s, count((r) => r.status === s)])),
    unassigned: open.filter((r) => !r.assigneeId).length,
    breached: count((r) => r.sla === 'Breached'),
    atRisk: count((r) => r.sla === 'At risk'),
    byType,
    byAssignee,
    avgResolutionHours: avg === null ? null : Math.round(avg * 10) / 10,
    slaMetPct: closed.length ? Math.round((within / closed.length) * 100) : null,
  });
});

coServicesRoutes.get('/services/requests/:ref', requirePermission('clients.view'), async (req, res) => {
  const r = await findRequest(param(req, 'ref'));
  const events = await prisma.serviceRequestEvent.findMany({ where: { requestId: r.id }, orderBy: { at: 'asc' } });
  const names = await userNames([r.assigneeId, ...events.map((e) => e.actorId)]);
  res.json({ request: view(r, names), events: events.map((e) => ({ at: e.at, title: e.title, detail: e.detail, by: e.actorId ? (names.get(e.actorId) ?? null) : null })) });
});

const createSchema = z
  .object({
    clientId: z.string().trim().min(1).max(40),
    type: z.enum(REQUEST_TYPES),
    priority: z.enum(PRIORITIES).default('Normal'),
    title: z.string().trim().min(3).max(200),
    detail: z.string().trim().min(1).max(4000),
    assigneeId: z.string().uuid().optional(),
  })
  .strict();

/** Case captured by staff on the client's behalf; the due date comes from the SLA policy. */
coServicesRoutes.post('/services/requests', requirePermission('clients.edit'), validateBody(createSchema), idempotent('co.service_create', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const client = await findClientByRef(b.clientId);
  const assignee = b.assigneeId ? await assertStaff(b.assigneeId) : null;
  const hours = await slaHours(b.type, b.priority);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'request');
    const r = await tx.serviceRequest.create({
      data: {
        ref,
        clientId: client.id,
        type: b.type,
        priority: b.priority,
        title: b.title,
        detail: b.detail,
        status: 'Open',
        ownerName: assignee?.name ?? actorName(req),
        ownerId: assignee?.id ?? req.user!.id,
        assigneeId: assignee?.id ?? null,
        slaDueAt: slaDueFor(hours),
        openedById: req.user!.id,
        events: { create: { title: 'Submitted', detail: `Logged by ${actorName(req)}; SLA ${hours}h`, actorId: req.user!.id } },
      },
      include,
    });
    await writeAudit(tx, audit(req), { action: 'service_request.created', objectType: 'service_request', objectId: r.id, after: { ref, client: client.ref, type: b.type, slaHours: hours } });
    return r;
  });
  res.status(201).json({ request: view(row, await userNames([row.assigneeId])) });
});

const assignSchema = z.object({ userId: z.string().uuid().nullable(), note: z.string().trim().max(500).optional() }).strict();

coServicesRoutes.post('/services/requests/:ref/assign', requirePermission('clients.edit'), validateBody(assignSchema), idempotent('clients-onboarding.post.services_requests_ref_assign', { required: false }), async (req, res) => {
  const r = await findRequest(param(req, 'ref'));
  if (r.status === 'Closed') throw HttpError.conflict('A closed request cannot be reassigned', 'invalid_state');
  const staff = req.body.userId ? await assertStaff(req.body.userId) : null;
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.serviceRequest.update({
      where: { id: r.id },
      data: { assigneeId: staff?.id ?? null, ownerName: staff?.name ?? 'Client Services', ownerId: staff?.id ?? null, version: { increment: 1 } },
      include,
    });
    await tx.serviceRequestEvent.create({ data: { requestId: r.id, title: staff ? 'Assigned' : 'Unassigned', detail: staff ? `${staff.name}${req.body.note ? ` - ${req.body.note}` : ''}` : (req.body.note ?? null), actorId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'service_request.assigned', objectType: 'service_request', objectId: r.id, before: { assigneeId: r.assigneeId }, after: { assigneeId: staff?.id ?? null } });
    return u;
  });
  res.json({ request: view(row, await userNames([row.assigneeId])) });
});

const statusSchema = z
  .object({ status: z.enum(['Open', 'In progress', 'Waiting on you', 'Closed']), note: z.string().trim().max(2000).optional(), notifyClient: z.boolean().default(true) })
  .strict();

coServicesRoutes.post('/services/requests/:ref/status', requirePermission('clients.edit'), validateBody(statusSchema), idempotent('clients-onboarding.post.services_requests_ref_status', { required: false }), async (req, res) => {
  const r = await findRequest(param(req, 'ref'));
  const b = req.body as z.infer<typeof statusSchema>;
  if (r.status === b.status) throw HttpError.conflict(`The request is already ${b.status}`, 'invalid_state');
  if (r.status === 'Closed') throw HttpError.conflict('A closed request cannot be reopened; log a new request', 'invalid_state');
  if (b.status === 'Closed' && !b.note) throw HttpError.badRequest('Validation failed', [{ path: 'note', message: 'Record the resolution when closing' }]);
  const row = await prisma.$transaction(async (tx) => {
    const n = await tx.serviceRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: b.status, progress: b.status === 'Closed' ? 100 : Math.max(r.progress, b.status === 'In progress' ? 40 : r.progress), version: { increment: 1 } } });
    if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    await tx.serviceRequestEvent.create({ data: { requestId: r.id, title: b.status, detail: b.note ?? null, actorId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'service_request.status_changed', objectType: 'service_request', objectId: r.id, before: { status: r.status }, after: { status: b.status }, reason: b.note ?? null });
    if (b.notifyClient) {
      await notifyClientMembers(tx, r.clientId, { type: 'service_request.updated', title: `Request ${r.ref} updated`, body: `${r.title} - ${b.status}${b.note ? `: ${b.note.slice(0, 160)}` : ''}`, link: '/?page=requests', email: b.status === 'Waiting on you' || b.status === 'Closed' });
    }
    return tx.serviceRequest.findUniqueOrThrow({ where: { id: r.id }, include });
  });
  res.json({ request: view(row, await userNames([row.assigneeId])) });
});

coServicesRoutes.post('/services/requests/:ref/note', requirePermission('clients.edit'), validateBody(z.object({ note: z.string().trim().min(1).max(2000) }).strict()), idempotent('clients-onboarding.post.services_requests_ref_note', { required: false }), async (req, res) => {
  const r = await findRequest(param(req, 'ref'));
  await prisma.$transaction(async (tx) => {
    await tx.serviceRequestEvent.create({ data: { requestId: r.id, title: 'Internal note', detail: req.body.note, actorId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'service_request.noted', objectType: 'service_request', objectId: r.id });
  });
  res.status(201).json({ ok: true });
});

const slaSchema = z.object({ dueAt: z.coerce.date(), reason: z.string().trim().min(5).max(500) }).strict();

coServicesRoutes.post('/services/requests/:ref/sla', requirePermission('clients.edit'), validateBody(slaSchema), idempotent('clients-onboarding.post.services_requests_ref_sla', { required: false }), async (req, res) => {
  const r = await findRequest(param(req, 'ref'));
  if (r.status === 'Closed') throw HttpError.conflict('A closed request has no active SLA', 'invalid_state');
  if (req.body.dueAt.getTime() <= r.createdAt.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'dueAt', message: 'Due date must be after the request was opened' }]);
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.serviceRequest.update({ where: { id: r.id }, data: { slaDueAt: req.body.dueAt, version: { increment: 1 } }, include });
    await tx.serviceRequestEvent.create({ data: { requestId: r.id, title: 'SLA re-set', detail: req.body.reason, actorId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'service_request.sla_changed', objectType: 'service_request', objectId: r.id, before: { slaDueAt: r.slaDueAt }, after: { slaDueAt: req.body.dueAt }, reason: req.body.reason });
    return u;
  });
  res.json({ request: view(row, await userNames([row.assigneeId])) });
});

coServicesRoutes.get('/services/sla-policies', requirePermission('clients.view'), async (_req, res) => {
  const rows = await prisma.serviceSlaPolicy.findMany({ orderBy: [{ requestType: 'asc' }, { priority: 'asc' }] });
  res.json({ data: rows.map((p) => ({ id: p.id, requestType: p.requestType, priority: p.priority, targetHours: p.targetHours, updatedAt: p.updatedAt })), types: REQUEST_TYPES, priorities: PRIORITIES });
});

const policySchema = z.object({ requestType: z.union([z.enum(REQUEST_TYPES), z.literal('*')]), priority: z.enum(PRIORITIES), targetHours: z.number().int().min(1).max(24 * 30) }).strict();

coServicesRoutes.put('/services/sla-policies', requirePermission('clients.edit'), validateBody(policySchema), idempotent('clients-onboarding.put.services_sla_policies', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof policySchema>;
  const key = { requestType_priority: { requestType: b.requestType, priority: b.priority } };
  const before = await prisma.serviceSlaPolicy.findUnique({ where: key });
  const row = await prisma.$transaction(async (tx) => {
    const p = await tx.serviceSlaPolicy.upsert({ where: key, create: { requestType: b.requestType, priority: b.priority, targetHours: b.targetHours, updatedBy: req.user!.id }, update: { targetHours: b.targetHours, updatedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'service_sla.policy_set', objectType: 'service_sla_policy', objectId: p.id, before: before ? { targetHours: before.targetHours } : null, after: { requestType: b.requestType, priority: b.priority, targetHours: b.targetHours } });
    return p;
  });
  res.json({ policy: { id: row.id, requestType: row.requestType, priority: row.priority, targetHours: row.targetHours } });
});
