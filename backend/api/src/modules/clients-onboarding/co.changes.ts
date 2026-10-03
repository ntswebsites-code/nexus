import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, audit, notifyPermission } from '../ops/ops.common';
import { ensureRiskFactors, findClientByRef, loadRiskConfig, userNames } from './co.service';
import { DEFAULT_RISK_FACTORS } from './co.engine';

/**
 * Maker-checker for the two risky client changes: releasing a dealing hold and activating or closing a mandate.
 * `clients.edit` proposes; `onboarding.approve` (a different person, step-up) approves, and the change is applied in the
 * same transaction. Placing a hold stays immediate because it only restricts. Also hosts the configurable KYC risk factors.
 */
export const coChangeRoutes = Router();

type Client = Prisma.ClientGetPayload<object>;

/** Why a mandate cannot be activated now, or an empty list. */
async function activationBlockers(client: Client): Promise<string[]> {
  const b: string[] = [];
  if (client.kycStatus !== 'Current') b.push(`KYC is ${client.kycStatus}; it must be Current`);
  if (client.dealingHold) b.push('The client is on dealing hold');
  if (!(await prisma.cashAccount.count({ where: { clientId: client.id, status: 'ACTIVE' } }))) b.push('No approved (active) cash account');
  return b;
}

const proposeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DEALING_HOLD_RELEASE'), reason: z.string().trim().min(5).max(500) }).strict(),
  z.object({ kind: z.literal('MANDATE_STATUS'), mandate: z.string().trim().min(1).max(40), status: z.enum(['Active', 'Closed']), reason: z.string().trim().min(5).max(500) }).strict(),
]);

coChangeRoutes.post('/clients/:id/change-requests', requirePermission('clients.edit'), validateBody(proposeSchema), idempotent('co.change_request', { required: false }), async (req, res) => {
  const client = await findClientByRef(param(req, 'id'));
  const b = req.body as z.infer<typeof proposeSchema>;
  let targetId: string | null = null;
  let from: string;
  let to: string;
  if (b.kind === 'DEALING_HOLD_RELEASE') {
    if (!client.dealingHold) throw HttpError.conflict('The client is not on dealing hold', 'invalid_state');
    from = 'On hold';
    to = 'Released';
  } else {
    const m = await prisma.mandate.findFirst({ where: { OR: [{ ref: b.mandate }, { id: b.mandate }], clientId: client.id } });
    if (!m) throw HttpError.notFound('Mandate not found');
    if (m.status === 'Closed') throw HttpError.conflict('A closed mandate cannot be reopened; create a new mandate', 'invalid_state');
    if (m.status === b.status) throw HttpError.conflict(`The mandate is already ${b.status}`, 'invalid_state');
    if (b.status === 'Active') {
      const blockers = await activationBlockers(client);
      if (blockers.length) throw new HttpError(409, 'activation_blocked', `The mandate cannot be activated: ${blockers.join('; ')}`, { blockers });
    }
    targetId = m.id;
    from = m.status;
    to = b.status;
  }
  if (await prisma.clientChangeRequest.findFirst({ where: { clientId: client.id, kind: b.kind, targetId, status: 'PENDING' }, select: { id: true } })) {
    throw HttpError.conflict('A change request for this is already awaiting approval', 'change_pending');
  }
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.clientChangeRequest.create({ data: { kind: b.kind, clientId: client.id, targetId, toValue: to, fromValue: from, reason: b.reason, makerId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'client.change_proposed', objectType: 'client', objectId: client.id, after: { requestId: r.id, kind: b.kind, from, to }, reason: b.reason });
    await notifyPermission(tx, 'onboarding.approve', { type: 'client.change.pending', title: `${client.ref}: ${b.kind === 'DEALING_HOLD_RELEASE' ? 'dealing hold release' : `mandate ${to.toLowerCase()}`} awaits approval`, body: b.reason.slice(0, 120), link: '/ops/clients' });
    return r;
  });
  res.status(201).json({ request: { id: row.id, kind: row.kind, from, to, status: row.status } });
});

const listQuery = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']).default('PENDING'), client: z.string().trim().max(40).optional() });
coChangeRoutes.get('/change-requests', requirePermission('clients.view'), validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const client = f.client ? await findClientByRef(f.client) : null;
  const rows = await prisma.clientChangeRequest.findMany({ where: { status: f.status, ...(client ? { clientId: client.id } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  const [clients, mandates, names] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: rows.map((r) => r.clientId) } }, select: { id: true, ref: true, name: true } }),
    prisma.mandate.findMany({ where: { id: { in: rows.map((r) => r.targetId).filter(Boolean) as string[] } }, select: { id: true, ref: true, name: true } }),
    userNames(rows.flatMap((r) => [r.makerId, r.checkerId])),
  ]);
  const cm = new Map(clients.map((c) => [c.id, c]));
  const mm = new Map(mandates.map((m) => [m.id, m]));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      client: cm.get(r.clientId)?.name ?? null,
      clientRef: cm.get(r.clientId)?.ref ?? null,
      mandate: r.targetId ? (mm.get(r.targetId)?.ref ?? null) : null,
      mandateName: r.targetId ? (mm.get(r.targetId)?.name ?? null) : null,
      from: r.fromValue,
      to: r.toValue,
      reason: r.reason,
      status: r.status,
      maker: names.get(r.makerId) ?? null,
      makerId: r.makerId,
      checker: r.checkerId ? (names.get(r.checkerId) ?? null) : null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    })),
  });
});

const decideSchema = z.object({ note: z.string().trim().min(5).max(500) }).strict();

async function decide(req: Request, approve: boolean) {
  const r = await prisma.clientChangeRequest.findUnique({ where: { id: param(req, 'id') } });
  if (!r) throw HttpError.notFound('Change request not found');
  if (r.status !== 'PENDING') throw HttpError.conflict(`The request is ${r.status}; it cannot be decided`, 'invalid_state');
  assertSegregation(req.user!.id, r.makerId);
  const client = await prisma.client.findUnique({ where: { id: r.clientId } });
  if (!client || client.archivedAt) throw HttpError.notFound('Client not found');
  const note = (req.body as z.infer<typeof decideSchema>).note;
  if (approve && r.kind === 'MANDATE_STATUS' && r.toValue === 'Active') {
    const blockers = await activationBlockers(client);
    if (blockers.length) throw new HttpError(409, 'activation_blocked', `The mandate cannot be activated: ${blockers.join('; ')}`, { blockers });
  }
  await prisma.$transaction(async (tx) => {
    const n = await tx.clientChangeRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', checkerId: req.user!.id, decisionNote: note, decidedAt: new Date() } });
    if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    if (approve) {
      if (r.kind === 'DEALING_HOLD_RELEASE') {
        const u = await tx.client.updateMany({ where: { id: client.id, dealingHold: true }, data: { dealingHold: false, holdReason: null, updatedBy: req.user!.id, version: { increment: 1 } } });
        if (u.count !== 1) throw HttpError.conflict('The client is no longer on dealing hold', 'invalid_state');
        await writeAudit(tx, audit(req), { action: 'client.dealing_hold_released', objectType: 'client', objectId: client.id, before: { dealingHold: true, reason: client.holdReason }, after: { dealingHold: false, requestId: r.id, maker: r.makerId }, reason: note });
      } else {
        const u = await tx.mandate.updateMany({ where: { id: r.targetId!, status: r.fromValue }, data: { status: r.toValue, version: { increment: 1 } } });
        if (u.count !== 1) throw HttpError.conflict('The mandate changed since this was requested', 'version_conflict');
        await writeAudit(tx, audit(req), { action: 'mandate.status_changed', objectType: 'mandate', objectId: r.targetId!, before: { status: r.fromValue }, after: { status: r.toValue, requestId: r.id, maker: r.makerId }, reason: note });
      }
    } else await writeAudit(tx, audit(req), { action: 'client.change_rejected', objectType: 'client', objectId: client.id, after: { requestId: r.id, kind: r.kind }, reason: note });
    await notifyPermission(tx, 'clients.edit', { type: 'client.change.decided', title: `${client.ref}: change ${approve ? 'approved' : 'rejected'}`, body: note.slice(0, 120), link: '/ops/clients' });
  });
  return { id: r.id, status: approve ? 'APPROVED' : 'REJECTED' };
}

coChangeRoutes.post('/change-requests/:id/approve', requirePermission('onboarding.approve'), validateBody(decideSchema), requireStepUp, async (req, res) => res.json(await decide(req, true)));
coChangeRoutes.post('/change-requests/:id/reject', requirePermission('onboarding.approve'), validateBody(decideSchema), async (req, res) => res.json(await decide(req, false)));

coChangeRoutes.post('/change-requests/:id/withdraw', requirePermission('clients.edit'), async (req, res) => {
  const r = await prisma.clientChangeRequest.findUnique({ where: { id: param(req, 'id') } });
  if (!r) throw HttpError.notFound('Change request not found');
  if (r.status !== 'PENDING') throw HttpError.conflict(`The request is ${r.status}; it cannot be withdrawn`, 'invalid_state');
  if (r.makerId !== req.user!.id) throw HttpError.forbidden('Only the person who proposed the change can withdraw it', 'permission_denied');
  await prisma.$transaction(async (tx) => {
    await tx.clientChangeRequest.update({ where: { id: r.id }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
    await writeAudit(tx, audit(req), { action: 'client.change_withdrawn', objectType: 'client', objectId: r.clientId, after: { requestId: r.id, kind: r.kind } });
  });
  res.json({ id: r.id, status: 'WITHDRAWN' });
});

// ------------------------------------------------------------ configurable KYC risk factors

coChangeRoutes.get('/onboarding/risk-factors', requirePermission('onboarding.view'), async (_req, res) => {
  await ensureRiskFactors();
  const rows = await prisma.kycRiskFactor.findMany({ orderBy: [{ kind: 'asc' }, { key: 'asc' }] });
  const names = await userNames(rows.map((r) => r.updatedBy));
  const def = new Map(DEFAULT_RISK_FACTORS.map((d) => [d.key, d]));
  const cfg = await loadRiskConfig();
  res.json({
    factors: rows.filter((r) => r.kind === 'FACTOR').map((r) => ({ key: r.key, label: r.label, points: r.points, defaultPoints: def.get(r.key)?.points ?? null, enabled: r.enabled, params: r.params, updatedBy: r.updatedBy ? (names.get(r.updatedBy) ?? null) : null, updatedAt: r.updatedAt })),
    thresholds: { medium: cfg.medium, high: cfg.high },
  });
});

const factorSchema = z
  .object({
    points: z.coerce.number().int().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
    params: z.record(z.string(), z.unknown()).nullable().optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

/** Changing the scoring changes every future rating, so it needs the approver permission and a fresh step-up. */
coChangeRoutes.put('/onboarding/risk-factors/:key', requirePermission('onboarding.approve'), validateBody(factorSchema), requireStepUp, async (req, res) => {
  await ensureRiskFactors();
  const key = param(req, 'key');
  const row = await prisma.kycRiskFactor.findUnique({ where: { key } });
  if (!row) throw HttpError.notFound('Unknown risk factor');
  const b = req.body as z.infer<typeof factorSchema>;
  if (row.kind === 'THRESHOLD') {
    if (b.enabled !== undefined || b.params !== undefined) throw HttpError.badRequest('A rating threshold only has a score');
    const cfg = await loadRiskConfig();
    const next = { medium: key === 'rating_medium' ? (b.points ?? cfg.medium) : cfg.medium, high: key === 'rating_high' ? (b.points ?? cfg.high) : cfg.high };
    if (next.medium < 1 || next.medium >= next.high || next.high > 100) throw HttpError.badRequest('Validation failed', [{ path: 'points', message: 'Thresholds must satisfy 1 <= medium < high <= 100' }]);
  }
  if (b.params) {
    const t = (b.params as { threshold?: unknown }).threshold;
    if (t !== undefined && (!Number.isFinite(Number(t)) || Number(t) < 0)) throw HttpError.badRequest('Validation failed', [{ path: 'params.threshold', message: 'threshold must be a positive number' }]);
    const c = (b.params as { countries?: unknown }).countries;
    if (c !== undefined && (!Array.isArray(c) || c.some((x) => typeof x !== 'string'))) throw HttpError.badRequest('Validation failed', [{ path: 'params.countries', message: 'countries must be a list of names' }]);
  }
  await prisma.$transaction(async (tx) => {
    await tx.kycRiskFactor.update({ where: { key }, data: { ...(b.points !== undefined ? { points: b.points } : {}), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.params !== undefined ? { params: (b.params ?? undefined) as Prisma.InputJsonValue | undefined } : {}), updatedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'kyc.risk_factor_changed', objectType: 'kyc_risk_factor', objectId: row.id, before: { key, points: row.points, enabled: row.enabled, params: row.params }, after: { key, points: b.points ?? row.points, enabled: b.enabled ?? row.enabled, params: b.params ?? row.params }, reason: b.reason });
  });
  res.json({ ok: true });
});
