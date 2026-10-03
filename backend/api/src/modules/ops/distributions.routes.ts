import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { expectVersion, param } from '../../lib/http';
import { validateBody } from '../../middleware/validate';
import { requireAnyPermission, requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { rollUpStatus } from './capital.service';
import {
  DISTRIBUTION_TYPES,
  issueDistributionArtefacts,
  loadDistribution,
  planDistribution,
  staffDistributionView,
} from './distributions.service';
import {
  D,
  ZERO,
  assertSegregation,
  assertUpdated,
  audit,
  badState,
  dateInput,
  money,
  moneyInput,
  notifyClientMembers,
  notifyPermission,
  optionalMoneyInput,
  seqRef,
} from './ops.common';

/** `/ops/distributions`: same lifecycle as capital calls; settlement records payouts. */
export const opsDistributionsRoutes = Router();

opsDistributionsRoutes.get('/distributions', requireAnyPermission('capital.view', 'distributions.create', 'distributions.approve'), async (req, res) => {
  const fundId = typeof req.query.fundId === 'string' ? req.query.fundId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await prisma.distribution.findMany({
    where: { ...(fundId ? { fundId } : {}), ...(status ? { status } : {}) },
    include: { fund: { select: { id: true, ref: true, name: true, currency: true, operatingModel: true } }, allocations: { include: { client: { select: { id: true, ref: true, name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ data: rows.map((d) => ({ ...staffDistributionView(d), allocations: undefined, allocationCount: d.allocations.length })), total: rows.length });
});

const createSchema = z.object({
  fundId: z.string().trim().min(1).max(36),
  distributionDate: dateInput,
  type: z.enum(DISTRIBUTION_TYPES),
  grossAmount: moneyInput,
  carryAmount: optionalMoneyInput.optional(),
  adjustmentsAmount: optionalMoneyInput.optional(),
  notes: z.string().trim().max(2000).optional(),
  allocationMethod: z.enum(['PRO_RATA', 'EXPLICIT']).default('PRO_RATA'),
  allocations: z
    .array(z.object({ clientId: z.string().trim().min(1).max(36), amount: moneyInput, grossShare: moneyInput.optional() }))
    .max(500)
    .optional(),
});

opsDistributionsRoutes.post('/distributions', requirePermission('distributions.create'), validateBody(createSchema), idempotent('ops.post.distributions', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const fund = await prisma.fund.findFirst({ where: { OR: [{ id: b.fundId }, { ref: b.fundId }] } });
  if (!fund) throw HttpError.badRequest('Unknown fund');
  const gross = new D(b.grossAmount);
  const carry = new D(b.carryAmount ?? '0');
  const adjustments = new D(b.adjustmentsAmount ?? '0');
  const net = gross.sub(carry).sub(adjustments);
  if (net.lte(0)) throw HttpError.badRequest('Carry and adjustments leave nothing to distribute');
  const id = await prisma.$transaction(async (tx) => {
    const plan = await planDistribution(fund, gross, net, b.allocationMethod, b.allocations, tx);
    const ref = await seqRef(tx, 'distribution', 'DIST-', 4);
    const d = await tx.distribution.create({
      data: {
        ref,
        fundId: fund.id,
        distributionDate: b.distributionDate,
        type: b.type,
        currency: fund.currency,
        grossAmount: gross,
        carryAmount: carry,
        adjustmentsAmount: adjustments,
        netToLps: net,
        status: 'DRAFT',
        notes: b.notes ?? null,
        makerId: req.user!.id,
        allocations: {
          create: plan.map((p) => ({
            clientId: p.clientId,
            commitmentId: p.commitmentId,
            lpLegalNameSnapshot: p.lpLegalName,
            commitmentSnapshot: p.commitment,
            paidInSnapshot: p.paidIn,
            grossShare: p.grossShare,
            adjustments: p.grossShare.sub(p.shareAmount),
            shareAmount: p.shareAmount,
          })),
        },
      },
    });
    await writeAudit(tx, audit(req), {
      action: 'distribution.created',
      objectType: 'distribution',
      objectId: d.id,
      after: { ref, fund: fund.ref, type: b.type, gross: money(gross), net: money(net), allocations: plan.map((p) => ({ clientId: p.clientId, net: money(p.shareAmount) })) },
    });
    return d.id;
  });
  res.status(201).json({ data: staffDistributionView(await loadDistribution(id)) });
});

opsDistributionsRoutes.get('/distributions/:id', requireAnyPermission('capital.view', 'distributions.create', 'distributions.approve'), async (req, res) => {
  res.json({ data: staffDistributionView(await loadDistribution(param(req, 'id'))) });
});

opsDistributionsRoutes.post('/distributions/:id/submit', requirePermission('distributions.create'), idempotent('ops.post.distributions_id_submit', { required: false }), async (req, res) => {
  const d = await loadDistribution(param(req, 'id'));
  expectVersion(req, d.version);
  if (d.status !== 'DRAFT') badState('The distribution', d.status, 'submitted');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.distribution.updateMany({ where: { id: d.id, status: 'DRAFT', version: d.version }, data: { status: 'PENDING_APPROVAL', version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'distribution.submitted', objectType: 'distribution', objectId: d.id, before: { status: d.status }, after: { status: 'PENDING_APPROVAL' } });
    await notifyPermission(tx, 'distributions.approve', { type: 'distribution.approval', title: `Approve distribution ${d.ref} · ${d.fund.name}`, body: `${money(d.netToLps)} ${d.currency} net to LPs` });
  });
  res.json({ data: staffDistributionView(await loadDistribution(d.id)) });
});

opsDistributionsRoutes.post('/distributions/:id/approve', requirePermission('distributions.approve'), requireStepUp, idempotent('ops.distribution.approve'), async (req, res) => {
  const d = await loadDistribution(param(req, 'id'));
  expectVersion(req, d.version);
  if (d.status !== 'PENDING_APPROVAL') badState('The distribution', d.status, 'approved');
  assertSegregation(req.user!.id, d.makerId);
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (await tx.distribution.updateMany({ where: { id: d.id, status: 'PENDING_APPROVAL', version: d.version }, data: { status: 'APPROVED', checkerId: req.user!.id, version: { increment: 1 } } }))
        .count,
    );
    await writeAudit(tx, audit(req), { action: 'distribution.approved', objectType: 'distribution', objectId: d.id, before: { status: d.status }, after: { status: 'APPROVED', checkerId: req.user!.id } });
  });
  res.json({ data: staffDistributionView(await loadDistribution(d.id)) });
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(255) });

opsDistributionsRoutes.post('/distributions/:id/reject', requirePermission('distributions.approve'), validateBody(reasonSchema), idempotent('ops.post.distributions_id_reject', { required: false }), async (req, res) => {
  const d = await loadDistribution(param(req, 'id'));
  expectVersion(req, d.version);
  if (d.status !== 'PENDING_APPROVAL') badState('The distribution', d.status, 'rejected');
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.distribution.updateMany({ where: { id: d.id, status: 'PENDING_APPROVAL', version: d.version }, data: { status: 'DRAFT', version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'distribution.rejected', objectType: 'distribution', objectId: d.id, before: { status: d.status }, after: { status: 'DRAFT' }, reason });
  });
  res.json({ data: staffDistributionView(await loadDistribution(d.id)) });
});

opsDistributionsRoutes.post('/distributions/:id/issue', requirePermission('distributions.create'), requireStepUp, idempotent('ops.distribution.issue'), async (req, res) => {
  const d = await loadDistribution(param(req, 'id'));
  expectVersion(req, d.version);
  if (d.status !== 'APPROVED') badState('The distribution', d.status, 'issued (it must be approved first)');
  await prisma.$transaction(
    async (tx) => {
      assertUpdated((await tx.distribution.updateMany({ where: { id: d.id, status: 'APPROVED', version: d.version }, data: { status: 'ISSUED', issuedAt: new Date(), version: { increment: 1 } } })).count);
      await issueDistributionArtefacts(tx, d, req.user!.id);
      await writeAudit(tx, audit(req), { action: 'distribution.issued', objectType: 'distribution', objectId: d.id, before: { status: d.status }, after: { status: 'ISSUED' } });
    },
    { timeout: 30_000 },
  );
  res.json({ data: staffDistributionView(await loadDistribution(d.id)) });
});

const settleSchema = z.object({
  amount: moneyInput.optional(),
  paidAt: dateInput,
  reference: z.string().trim().min(1).max(80),
});

opsDistributionsRoutes.post(
  '/distributions/:id/allocations/:allocationId/settle',
  requirePermission('distributions.settle'),
  requireStepUp,
  idempotent('ops.distribution.settle'),
  validateBody(settleSchema),
  async (req, res) => {
    const d = await loadDistribution(param(req, 'id'));
    const a = d.allocations.find((x) => x.id === param(req, 'allocationId'));
    if (!a) throw HttpError.notFound('Allocation not found');
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(d.status)) badState('The distribution', d.status, 'settled');
    if (a.status === 'CANCELLED' || a.status === 'PAID') badState('The allocation', a.status, 'paid again');
    const b = req.body as z.infer<typeof settleSchema>;
    const outstanding = a.shareAmount.sub(a.amountPaid);
    const amount = b.amount ? new D(b.amount) : outstanding;
    if (amount.gt(outstanding)) throw HttpError.badRequest(`Payout ${money(amount)} exceeds the outstanding ${money(outstanding)}`);
    const newPaid = a.amountPaid.add(amount);
    const status = newPaid.gte(a.shareAmount) ? 'PAID' : 'PARTIALLY_PAID';
    await prisma.$transaction(async (tx) => {
      assertUpdated(
        (
          await tx.distributionAllocation.updateMany({
            where: { id: a.id, version: a.version },
            data: { amountPaid: newPaid, status, paidAt: b.paidAt, version: { increment: 1 } },
          })
        ).count,
      );
      const fresh = await tx.distributionAllocation.findMany({ where: { distributionId: d.id }, select: { status: true, amountPaid: true } });
      const header = rollUpStatus(fresh);
      if (header !== d.status) await tx.distribution.update({ where: { id: d.id }, data: { status: header, version: { increment: 1 } } });
      await writeAudit(tx, audit(req), {
        action: 'distribution.payout_recorded',
        objectType: 'distribution_allocation',
        objectId: a.id,
        before: { amountPaid: money(a.amountPaid), status: a.status },
        after: { amount: money(amount), reference: b.reference, paidAt: b.paidAt, amountPaid: money(newPaid), status, distributionStatus: header },
      });
      await notifyClientMembers(tx, a.clientId, {
        type: 'distribution.paid',
        title: `Distribution paid · ${d.ref} ${d.fund.name}`,
        body: `${money(amount)} ${d.currency} sent.`,
        link: `/distributions/${a.id}`,
      });
    });
    res.status(201).json({ data: staffDistributionView(await loadDistribution(d.id)) });
  },
);

opsDistributionsRoutes.post(
  '/distributions/:id/cancel',
  requireAnyPermission('distributions.create', 'distributions.approve'),
  requireStepUp,
  validateBody(reasonSchema),
  async (req, res) => {
    const d = await loadDistribution(param(req, 'id'));
    expectVersion(req, d.version);
    if (['CANCELLED', 'PAID', 'PARTIALLY_PAID'].includes(d.status)) badState('The distribution', d.status, 'cancelled');
    if (d.allocations.some((a) => a.amountPaid.gt(ZERO))) badState('The distribution', 'part-paid', 'cancelled');
    if (d.status === 'ISSUED' && !req.user!.permissions.includes('distributions.approve')) {
      throw HttpError.forbidden('Cancelling an issued distribution needs an approver', 'permission_denied');
    }
    const { reason } = req.body as z.infer<typeof reasonSchema>;
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.distribution.updateMany({ where: { id: d.id, version: d.version }, data: { status: 'CANCELLED', version: { increment: 1 } } })).count);
      await tx.distributionAllocation.updateMany({ where: { distributionId: d.id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      if (d.issuedAt) {
        await tx.document.updateMany({ where: { sourceType: 'DISTRIBUTION_ALLOCATION', sourceRefId: { in: d.allocations.map((a) => a.id) } }, data: { status: 'Superseded', version: { increment: 1 } } });
      }
      await writeAudit(tx, audit(req), { action: 'distribution.cancelled', objectType: 'distribution', objectId: d.id, before: { status: d.status }, after: { status: 'CANCELLED' }, reason });
    });
    res.json({ data: staffDistributionView(await loadDistribution(d.id)) });
  },
);
