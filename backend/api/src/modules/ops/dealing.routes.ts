import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { param } from '../../lib/http';
import { validateBody } from '../../middleware/validate';
import { requireAnyPermission, requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { D, ZERO, assertSegregation, assertUpdated, audit, badState, isoDay, money, notifyClientMembers, optionalMoneyInput } from './ops.common';

/**
 * `/ops/dealing`: staff queue for LP subscriptions and redemptions.
 * SUBMITTED/COMPLIANCE_REVIEW -accept-> AWAITING_FUNDS (subscription) | UNDER_REVIEW (redemption)
 * -process (dealing NAV, units)-> AWAITING_NAV -approve (different person, step-up)-> COMPLETED.
 */
export const opsDealingRoutes = Router();

const include = {
  fund: { select: { id: true, ref: true, name: true, currency: true, navPerUnit: true, valuationStatus: true } },
  client: { select: { id: true, ref: true, name: true, dealingHold: true, holdReason: true } },
} satisfies Prisma.LpDealingRequestInclude;
type Row = Prisma.LpDealingRequestGetPayload<{ include: typeof include }>;

const view = (r: Row) => ({
  id: r.id,
  ref: r.ref,
  clientId: r.clientId,
  clientRef: r.client.ref,
  clientName: r.client.name,
  clientOnHold: r.client.dealingHold,
  fundId: r.fundId,
  fundRef: r.fund.ref,
  fundName: r.fund.name,
  shareClass: r.shareClassCode,
  requestType: r.requestType,
  inputMode: r.inputMode,
  redemptionMode: r.redemptionMode,
  amount: r.amount ? money(r.amount) : null,
  units: r.units?.toFixed(6) ?? null,
  currency: r.currency,
  requestedDealingDate: isoDay(r.requestedDealingDate),
  status: r.status,
  estimateId: r.estimateId,
  estimate: r.estimateJson,
  payloadHash: r.payloadHash,
  bankAccountId: r.bankAccountId,
  submittedById: r.submittedById,
  processedById: r.processedById,
  approvedById: r.approvedById,
  dealingNavPerUnit: r.dealingNavPerUnit?.toString() ?? null,
  unitsAllocated: r.unitsAllocated?.toFixed(6) ?? null,
  rejectionReason: r.rejectionReason,
  notes: r.notes,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

async function load(id: string) {
  const r = await prisma.lpDealingRequest.findFirst({ where: { OR: [{ id }, { ref: id }] }, include });
  if (!r) throw HttpError.notFound('Dealing request not found');
  return r;
}

opsDealingRoutes.get('/dealing/requests', requirePermission('dealing.view'), async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const s = (k: string) => (typeof q[k] === 'string' && q[k] ? (q[k] as string) : undefined);
  const rows = await prisma.lpDealingRequest.findMany({
    where: {
      ...(s('status') ? { status: s('status')!.toUpperCase() } : {}),
      ...(s('fundId') ? { fundId: s('fundId') } : {}),
      ...(s('type') ? { requestType: s('type')!.toUpperCase() } : {}),
    },
    include,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ data: rows.map(view), total: rows.length });
});

opsDealingRoutes.get('/dealing/requests/:id', requirePermission('dealing.view'), async (req, res) => {
  res.json({ data: view(await load(param(req, 'id'))) });
});

async function transition(
  r: Row,
  from: string[],
  to: string,
  data: Prisma.LpDealingRequestUncheckedUpdateManyInput,
  auditEntry: { action: string; actorReq: Parameters<typeof audit>[0]; reason?: string; after?: Record<string, unknown> },
  extra?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!from.includes(r.status)) badState('The request', r.status, `moved to ${to}`);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.lpDealingRequest.updateMany({ where: { id: r.id, status: r.status, version: r.version }, data: { ...data, status: to, version: { increment: 1 } } })).count);
    if (extra) await extra(tx);
    await writeAudit(tx, audit(auditEntry.actorReq), {
      action: auditEntry.action,
      objectType: 'lp_dealing_request',
      objectId: r.id,
      before: { status: r.status },
      after: { status: to, ...(auditEntry.after ?? {}) },
      reason: auditEntry.reason ?? null,
    });
    await notifyClientMembers(tx, r.clientId, {
      type: 'dealing.status_changed',
      title: `${r.requestType === 'SUBSCRIPTION' ? 'Subscription' : 'Redemption'} ${r.ref}: ${to === 'COMPLETED' ? 'allocated' : to.toLowerCase().replace(/_/g, ' ')}`,
      body: `${r.fund.name}`,
      link: '/dealing',
    });
  });
}

opsDealingRoutes.post('/dealing/requests/:id/accept', requirePermission('dealing.process'), idempotent('ops.post.dealing_requests_id_accept', { required: false }), async (req, res) => {
  const r = await load(param(req, 'id'));
  if (r.client.dealingHold) throw HttpError.conflict(`The client is on a dealing hold${r.client.holdReason ? `: ${r.client.holdReason}` : ''}`, 'compliance_hold');
  const to = r.requestType === 'SUBSCRIPTION' ? 'AWAITING_FUNDS' : 'UNDER_REVIEW';
  await transition(r, ['SUBMITTED', 'COMPLIANCE_REVIEW'], to, { processedById: req.user!.id }, { action: 'dealing.accepted', actorReq: req });
  res.json({ data: view(await load(r.id)) });
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(255) });

opsDealingRoutes.post('/dealing/requests/:id/reject', requireAnyPermission('dealing.process', 'dealing.approve'), validateBody(reasonSchema), idempotent('ops.post.dealing_requests_id_reject', { required: false }), async (req, res) => {
  const r = await load(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  await transition(r, ['SUBMITTED', 'COMPLIANCE_REVIEW', 'AWAITING_FUNDS', 'UNDER_REVIEW', 'AWAITING_NAV'], 'REJECTED', { rejectionReason: reason }, { action: 'dealing.rejected', actorReq: req, reason });
  res.json({ data: view(await load(r.id)) });
});

const processSchema = z.object({ navPerUnit: optionalMoneyInput.optional(), notes: z.string().trim().max(2000).optional() });

opsDealingRoutes.post('/dealing/requests/:id/process', requirePermission('dealing.process'), validateBody(processSchema), idempotent('ops.post.dealing_requests_id_process', { required: false }), async (req, res) => {
  const r = await load(param(req, 'id'));
  const b = req.body as z.infer<typeof processSchema>;
  const nav = b.navPerUnit ? new D(b.navPerUnit) : r.fund.navPerUnit;
  if (!nav || nav.lte(0)) throw HttpError.badRequest('Give the dealing NAV per unit (the fund has none)');
  let units: Prisma.Decimal;
  if (r.requestType === 'SUBSCRIPTION') {
    units = (r.amount ?? ZERO).div(nav).toDecimalPlaces(6, D.ROUND_DOWN);
  } else if (r.redemptionMode === 'FULL') {
    const h = await prisma.lpHolding.findUnique({ where: { clientId_fundId_shareClassCode: { clientId: r.clientId, fundId: r.fundId, shareClassCode: r.shareClassCode } } });
    units = h?.units ?? ZERO;
  } else if (r.inputMode === 'UNITS') {
    units = r.units ?? ZERO;
  } else {
    units = (r.amount ?? ZERO).div(nav).toDecimalPlaces(6, D.ROUND_UP);
  }
  if (units.lte(0)) throw HttpError.badRequest('The request resolves to zero units');
  await transition(
    r,
    ['AWAITING_FUNDS', 'UNDER_REVIEW'],
    'AWAITING_NAV',
    { processedById: req.user!.id, dealingNavPerUnit: nav, unitsAllocated: units, ...(b.notes ? { notes: [r.notes, `Staff: ${b.notes}`].filter(Boolean).join('\n') } : {}) },
    { action: 'dealing.processed', actorReq: req, after: { navPerUnit: nav.toString(), units: units.toString() } },
  );
  res.json({ data: view(await load(r.id)) });
});

opsDealingRoutes.post('/dealing/requests/:id/approve', requirePermission('dealing.approve'), requireStepUp, idempotent('ops.dealing.approve'), async (req, res) => {
  const r = await load(param(req, 'id'));
  if (r.status !== 'AWAITING_NAV') badState('The request', r.status, 'approved (process it first)');
  assertSegregation(req.user!.id, r.processedById, r.submittedById);
  const nav = r.dealingNavPerUnit!;
  const units = r.unitsAllocated!;
  await transition(
    r,
    ['AWAITING_NAV'],
    'COMPLETED',
    { approvedById: req.user!.id },
    { action: 'dealing.approved', actorReq: req, after: { units: units.toString(), navPerUnit: nav.toString() } },
    async (tx) => {
      const key = { clientId_fundId_shareClassCode: { clientId: r.clientId, fundId: r.fundId, shareClassCode: r.shareClassCode } };
      const h = await tx.lpHolding.findUnique({ where: key });
      const current = h?.units ?? ZERO;
      const next = r.requestType === 'SUBSCRIPTION' ? current.add(units) : current.sub(units);
      if (next.lt(0)) throw HttpError.conflict('The holding no longer has enough units for this redemption', 'insufficient_units');
      const data = {
        units: next,
        navPerUnit: nav,
        accountValue: next.mul(nav).toDecimalPlaces(4, D.ROUND_HALF_UP),
        asOfDate: new Date(new Date().toISOString().slice(0, 10)),
        valuationStatus: r.fund.valuationStatus,
        isActive: next.gt(0),
      };
      if (h) await tx.lpHolding.update({ where: key, data });
      else await tx.lpHolding.create({ data: { clientId: r.clientId, fundId: r.fundId, shareClassCode: r.shareClassCode, currency: r.currency, ...data } });
    },
  );
  res.json({ data: view(await load(r.id)) });
});
