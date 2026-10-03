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
  seqRef,
  storeWire,
  wireInput,
} from './ops.common';
import { callNoLabel, issueCallArtefacts, loadCall, planCallAllocations, rollUpStatus, staffCallView } from './capital.service';

/** `/ops/capital-calls`: draft, allocate, submit, approve (checker ≠ maker), issue, settle, cancel. */
export const opsCapitalRoutes = Router();

opsCapitalRoutes.get('/capital-calls', requirePermission('capital.view'), async (req, res) => {
  const fundId = typeof req.query.fundId === 'string' ? req.query.fundId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await prisma.capitalCall.findMany({
    where: { ...(fundId ? { fundId } : {}), ...(status ? { status } : {}) },
    include: { fund: { select: { ref: true, name: true } }, allocations: { select: { callAmount: true, amountPaid: true, status: true, acknowledgedAt: true } } },
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  });
  res.json({
    data: rows.map((c) => {
      const live = c.allocations.filter((a) => a.status !== 'CANCELLED');
      const paid = live.reduce((s, a) => s.add(a.amountPaid), ZERO);
      return {
        id: c.id,
        ref: c.ref,
        fundId: c.fundId,
        fundRef: c.fund.ref,
        fundName: c.fund.name,
        callNo: c.callNo,
        callLabel: callNoLabel(c.callNo),
        totalAmount: money(c.totalAmount),
        paid: money(paid),
        outstanding: money(D.max(ZERO, c.totalAmount.sub(paid))),
        currency: c.currency,
        callDate: c.transactionDate?.toISOString().slice(0, 10) ?? null,
        dueDate: c.dueDate.toISOString().slice(0, 10),
        status: c.status,
        allocationCount: live.length,
        acknowledgedCount: live.filter((a) => a.acknowledgedAt).length,
        makerId: c.makerId,
        checkerId: c.checkerId,
        issuedAt: c.issuedAt,
        version: c.version,
      };
    }),
    total: rows.length,
  });
});

const createSchema = z.object({
  fundId: z.string().trim().min(1).max(36),
  callDate: dateInput,
  dueDate: dateInput,
  purpose: z.string().trim().min(1).max(2000),
  totalAmount: moneyInput,
  allocationMethod: z.enum(['PRO_RATA', 'EXPLICIT']).default('PRO_RATA'),
  allocations: z.array(z.object({ clientId: z.string().trim().min(1).max(36), amount: moneyInput })).max(500).optional(),
  wire: wireInput.optional(),
});

opsCapitalRoutes.post('/capital-calls', requirePermission('capital.create'), validateBody(createSchema), idempotent('ops.post.capital_calls', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  if (b.dueDate < b.callDate) throw HttpError.badRequest('The due date must be on or after the call date');
  const fund = await prisma.fund.findFirst({ where: { OR: [{ id: b.fundId }, { ref: b.fundId }] } });
  if (!fund) throw HttpError.badRequest('Unknown fund');
  if (fund.status === 'Closed') throw HttpError.conflict('The fund is closed', 'invalid_state');
  if (fund.operatingModel !== 'PRIVATE_CAPITAL') throw HttpError.badRequest('Capital calls apply to private-capital funds only');
  const total = new D(b.totalAmount);
  const id = await prisma.$transaction(async (tx) => {
    const plan = await planCallAllocations(fund.id, total, b.allocationMethod, b.allocations, tx);
    const committed = plan.reduce((s, p) => s.add(p.commitmentAmount), ZERO);
    const last = await tx.capitalCall.aggregate({ where: { fundId: fund.id }, _max: { callNo: true } });
    const callNo = (last._max.callNo ?? 0) + 1;
    const ref = await seqRef(tx, 'capital_call', 'CC-', 5);
    const call = await tx.capitalCall.create({
      data: {
        ref,
        fundId: fund.id,
        callNo,
        callPercent: committed.gt(0) ? total.mul(100).div(committed).toDecimalPlaces(6, D.ROUND_HALF_UP) : null,
        totalAmount: total,
        currency: fund.currency,
        dueDate: b.dueDate,
        transactionDate: b.callDate,
        purpose: b.purpose,
        wireJson: (b.wire ? storeWire(b.wire) : (fund.wiringJson ?? undefined)) as Prisma.InputJsonValue | undefined,
        status: 'DRAFT',
        makerId: req.user!.id,
        allocations: {
          create: plan.map((p) => ({
            clientId: p.clientId,
            commitmentId: p.commitmentId,
            lpLegalNameSnapshot: p.lpLegalName,
            totalCommitmentSnapshot: p.commitmentAmount,
            uncalledBeforeSnapshot: p.uncalledBefore,
            callAmount: p.amount,
          })),
        },
      },
    });
    await writeAudit(tx, audit(req), {
      action: 'capital_call.created',
      objectType: 'capital_call',
      objectId: call.id,
      after: {
        ref,
        fund: fund.ref,
        callNo,
        totalAmount: money(total),
        allocationMethod: b.allocationMethod,
        allocations: plan.map((p) => ({ clientId: p.clientId, amount: money(p.amount) })),
      },
    });
    return call.id;
  });
  res.status(201).json({ data: await staffCallView(await loadCall(id)) });
});

opsCapitalRoutes.get('/capital-calls/:id', requirePermission('capital.view'), async (req, res) => {
  res.json({ data: await staffCallView(await loadCall(param(req, 'id'))) });
});

opsCapitalRoutes.post('/capital-calls/:id/submit', requirePermission('capital.create'), idempotent('ops.post.capital_calls_id_submit', { required: false }), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (c.status !== 'DRAFT') badState('The call', c.status, 'submitted');
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (await tx.capitalCall.updateMany({ where: { id: c.id, status: 'DRAFT', version: c.version }, data: { status: 'PENDING_APPROVAL', version: { increment: 1 } } })).count,
    );
    await writeAudit(tx, audit(req), { action: 'capital_call.submitted', objectType: 'capital_call', objectId: c.id, before: { status: c.status }, after: { status: 'PENDING_APPROVAL' } });
    await notifyPermission(tx, 'capital.approve', {
      type: 'capital_call.approval',
      title: `Approve capital call ${c.ref} · ${c.fund.name}`,
      body: `${money(c.totalAmount)} ${c.currency} across ${c.allocations.length} investors`,
    });
  });
  res.json({ data: await staffCallView(await loadCall(c.id)) });
});

opsCapitalRoutes.post('/capital-calls/:id/approve', requirePermission('capital.approve'), requireStepUp, idempotent('ops.capital_call.approve'), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (c.status !== 'PENDING_APPROVAL') badState('The call', c.status, 'approved');
  assertSegregation(req.user!.id, c.makerId);
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (
        await tx.capitalCall.updateMany({
          where: { id: c.id, status: 'PENDING_APPROVAL', version: c.version },
          data: { status: 'APPROVED', checkerId: req.user!.id, approvedAt: new Date(), version: { increment: 1 } },
        })
      ).count,
    );
    await writeAudit(tx, audit(req), { action: 'capital_call.approved', objectType: 'capital_call', objectId: c.id, before: { status: c.status }, after: { status: 'APPROVED', checkerId: req.user!.id } });
  });
  res.json({ data: await staffCallView(await loadCall(c.id)) });
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(255) });

opsCapitalRoutes.post('/capital-calls/:id/reject', requirePermission('capital.approve'), validateBody(reasonSchema), idempotent('ops.post.capital_calls_id_reject', { required: false }), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (c.status !== 'PENDING_APPROVAL') badState('The call', c.status, 'rejected');
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (await tx.capitalCall.updateMany({ where: { id: c.id, status: 'PENDING_APPROVAL', version: c.version }, data: { status: 'DRAFT', version: { increment: 1 } } })).count,
    );
    await writeAudit(tx, audit(req), { action: 'capital_call.rejected', objectType: 'capital_call', objectId: c.id, before: { status: c.status }, after: { status: 'DRAFT' }, reason });
    if (c.makerId) {
      await tx.outboxEvent.create({
        data: { type: 'notify.users', payload: { userIds: [c.makerId], type: 'capital_call.rejected', title: `Capital call ${c.ref} returned`, body: reason } },
      });
    }
  });
  res.json({ data: await staffCallView(await loadCall(c.id)) });
});

opsCapitalRoutes.post('/capital-calls/:id/issue', requirePermission('capital.create'), requireStepUp, idempotent('ops.capital_call.issue'), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (c.status !== 'APPROVED') badState('The call', c.status, 'issued (it must be approved first)');
  await prisma.$transaction(
    async (tx) => {
      const issuedAt = new Date();
      assertUpdated(
        (await tx.capitalCall.updateMany({ where: { id: c.id, status: 'APPROVED', version: c.version }, data: { status: 'ISSUED', issuedAt, version: { increment: 1 } } })).count,
      );
      await issueCallArtefacts(tx, { ...c, issuedAt }, req.user!.id);
      await writeAudit(tx, audit(req), {
        action: 'capital_call.issued',
        objectType: 'capital_call',
        objectId: c.id,
        before: { status: c.status },
        after: { status: 'ISSUED', investors: c.allocations.filter((a) => a.status !== 'CANCELLED').length },
      });
    },
    { timeout: 30_000 },
  );
  res.json({ data: await staffCallView(await loadCall(c.id)) });
});

const paymentSchema = z.object({
  amount: moneyInput,
  paidAt: dateInput,
  reference: z.string().trim().min(1).max(80),
  evidenceId: z.string().trim().max(36).optional(),
});

opsCapitalRoutes.post(
  '/capital-calls/:id/allocations/:allocationId/payments',
  requirePermission('capital.settle'),
  requireStepUp,
  idempotent('ops.capital_call.payment'),
  validateBody(paymentSchema),
  async (req, res) => {
    const c = await loadCall(param(req, 'id'));
    const a = c.allocations.find((x) => x.id === param(req, 'allocationId'));
    if (!a) throw HttpError.notFound('Allocation not found');
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(c.status)) badState('The call', c.status, 'settled');
    if (a.status === 'CANCELLED' || a.status === 'PAID') badState('The allocation', a.status, 'paid again');
    const b = req.body as z.infer<typeof paymentSchema>;
    const amount = new D(b.amount);
    const outstanding = a.callAmount.sub(a.amountPaid);
    if (amount.gt(outstanding)) throw HttpError.badRequest(`Payment ${money(amount)} exceeds the outstanding ${money(outstanding)}`);
    let evidence = null;
    if (b.evidenceId) {
      evidence = await prisma.fundingEvidence.findFirst({ where: { id: b.evidenceId, allocationId: a.id } });
      if (!evidence) throw HttpError.badRequest('That payment confirmation does not belong to this allocation');
      assertSegregation(req.user!.id, evidence.confirmedById);
    }
    const newPaid = a.amountPaid.add(amount);
    const allocStatus = newPaid.gte(a.callAmount) ? 'PAID' : 'PARTIALLY_PAID';
    await prisma.$transaction(async (tx) => {
      assertUpdated(
        (
          await tx.capitalCallAllocation.updateMany({
            where: { id: a.id, version: a.version },
            data: { amountPaid: newPaid, status: allocStatus, version: { increment: 1 } },
          })
        ).count,
      );
      const payment = await tx.capitalCallPayment.create({
        data: { allocationId: a.id, amount, recordedAt: b.paidAt, recordedById: req.user!.id, bankReference: b.reference, confirmationId: evidence?.id ?? null },
      });
      if (evidence) {
        await tx.fundingEvidence.update({ where: { id: evidence.id }, data: { matchedAt: new Date(), matchedById: req.user!.id } });
        if (allocStatus === 'PAID') await tx.capitalEvent.update({ where: { id: evidence.capitalEventId }, data: { status: 'Paid', version: { increment: 1 } } });
      }
      const fresh = await tx.capitalCallAllocation.findMany({ where: { callId: c.id }, select: { status: true, amountPaid: true } });
      const callStatus = rollUpStatus(fresh);
      if (callStatus !== c.status) {
        assertUpdated((await tx.capitalCall.updateMany({ where: { id: c.id, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, data: { status: callStatus, version: { increment: 1 } } })).count);
      }
      await writeAudit(tx, audit(req), {
        action: 'capital_call.payment_recorded',
        objectType: 'capital_call_allocation',
        objectId: a.id,
        before: { amountPaid: money(a.amountPaid), status: a.status, callStatus: c.status },
        after: { paymentId: payment.id, amount: money(amount), reference: b.reference, evidenceId: evidence?.id ?? null, amountPaid: money(newPaid), status: allocStatus, callStatus },
      });
      await notifyClientMembers(tx, a.clientId, {
        type: 'capital_call.payment_received',
        title: `Payment received · ${callNoLabel(c.callNo)} ${c.fund.name}`,
        body: `${money(amount)} ${c.currency} recorded${allocStatus === 'PAID' ? '; the call is fully paid' : ''}.`,
        link: `/capital-calls/${a.id}`,
      });
    });
    res.status(201).json({ data: await staffCallView(await loadCall(c.id)) });
  },
);

opsCapitalRoutes.post(
  '/capital-calls/:id/cancel',
  requireAnyPermission('capital.create', 'capital.approve'),
  requireStepUp,
  validateBody(reasonSchema),
  async (req, res) => {
    const c = await loadCall(param(req, 'id'));
    if (['CANCELLED', 'PAID', 'PARTIALLY_PAID'].includes(c.status)) badState('The call', c.status, 'cancelled');
    if (c.allocations.some((a) => a.amountPaid.gt(0))) badState('The call', 'part-paid', 'cancelled');
    if (c.status === 'ISSUED' && !req.user!.permissions.includes('capital.approve')) {
      throw HttpError.forbidden('Cancelling an issued call needs an approver', 'permission_denied');
    }
    const { reason } = req.body as z.infer<typeof reasonSchema>;
    await prisma.$transaction(async (tx) => {
      assertUpdated(
        (
          await tx.capitalCall.updateMany({
            where: { id: c.id, version: c.version },
            data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } },
          })
        ).count,
      );
      await tx.capitalCallAllocation.updateMany({ where: { callId: c.id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      if (c.issuedAt) {
        await tx.document.updateMany({
          where: { sourceType: 'CAPITAL_CALL_ALLOCATION', sourceRefId: { in: c.allocations.map((a) => a.id) } },
          data: { status: 'Superseded', version: { increment: 1 } },
        });
        await tx.lpNotice.updateMany({ where: { category: 'CAPITAL_CALL', fundId: c.fundId, title: { startsWith: `${callNoLabel(c.callNo)} ` } }, data: { status: 'WITHDRAWN' } });
        for (const a of c.allocations) {
          await notifyClientMembers(tx, a.clientId, { type: 'capital_call.cancelled', title: `Capital call ${callNoLabel(c.callNo)} cancelled · ${c.fund.name}`, body: reason });
        }
      }
      await writeAudit(tx, audit(req), { action: 'capital_call.cancelled', objectType: 'capital_call', objectId: c.id, before: { status: c.status }, after: { status: 'CANCELLED' }, reason });
    });
    res.json({ data: await staffCallView(await loadCall(c.id)) });
  },
);
