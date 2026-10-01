import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { enqueue, type NotifyUsersPayload } from '../../lib/outbox';
import { ctx, param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { requirePermission } from '../../middleware/requireAuth';
import { validateBody } from '../../middleware/validate';
import { accountRefs, dayEndView, executionView, filesById, latestReviews, packageHash, tradeControl } from '../custodian/custodian.service';

/**
 * `/api/v1/ops/custodian` - staff view of counterparty submissions and the day-end review
 * that feeds reconciliation status (SRD 5E.4). Mounted under `opsRoutes` (admin portal access).
 */
export const opsCustodianRoutes = Router();

const cpSelect = { id: true, ref: true, name: true, type: true } as const;

opsCustodianRoutes.get('/counterparties', requirePermission('custodian.view'), async (_req, res) => {
  const rows = await prisma.counterparty.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
  res.json({
    items: rows.map((c) => ({ id: c.id, ref: c.ref, name: c.name, type: c.type, status: c.status, accounts: accountRefs(c.accounts), users: c._count.users })),
  });
});

opsCustodianRoutes.get('/submissions', requirePermission('custodian.view'), async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const counterpartyId = typeof req.query.counterpartyId === 'string' && req.query.counterpartyId ? req.query.counterpartyId : undefined;
  const where = { ...(counterpartyId ? { counterpartyId } : {}) };
  const [dayEnds, executions] = await Promise.all([
    prisma.counterpartyDayEndPackage.findMany({
      // Drafts belong to the counterparty until submitted.
      where: { ...where, status: status ?? { not: 'Draft' } },
      orderBy: { submittedAt: 'desc' },
      take: 200,
      include: { counterparty: { select: cpSelect } },
    }),
    prisma.counterpartyExecution.findMany({
      where: { ...where, ...(status ? { status } : {}) },
      orderBy: { submittedAt: 'desc' },
      take: 200,
      include: { counterparty: { select: cpSelect } },
    }),
  ]);
  const files = await filesById(dayEnds.map((d) => d.fileId));
  const reviews = await latestReviews(dayEnds.map((d) => d.id));
  const controls = await Promise.all(dayEnds.map((d) => tradeControl(d.counterpartyId, d.accountRef, d.statementDate, d.tradeCount)));
  res.json({
    counts: {
      awaitingReview: dayEnds.filter((d) => d.status === 'Approved').length,
      dayEnds: dayEnds.length,
      executions: executions.length,
    },
    dayEnds: dayEnds.map((d, i) => ({
      ...dayEndView(d, d.fileId ? files.get(d.fileId) : null),
      counterparty: d.counterparty,
      controls: controls[i],
      review: reviews.get(d.id) ?? null,
    })),
    executions: executions.map((e) => ({ ...executionView(e), counterparty: e.counterparty })),
  });
});

opsCustodianRoutes.get('/day-end/:id', requirePermission('custodian.view'), async (req, res) => {
  const pkg = await prisma.counterpartyDayEndPackage.findFirst({
    where: { id: param(req, 'id'), status: { not: 'Draft' } },
    include: { counterparty: { select: cpSelect } },
  });
  if (!pkg) throw HttpError.notFound('Day-end package not found');
  const files = await filesById([pkg.fileId]);
  const recomputed = await packageHash(pkg, pkg.counterparty.ref);
  res.json({
    package: { ...dayEndView(pkg, pkg.fileId ? files.get(pkg.fileId) : null), counterparty: pkg.counterparty },
    integrity: { verified: recomputed === pkg.sha256 },
    controls: await tradeControl(pkg.counterpartyId, pkg.accountRef, pkg.statementDate, pkg.tradeCount),
    review: (await latestReviews([pkg.id])).get(pkg.id) ?? null,
  });
});

const reviewSchema = z
  .object({ decision: z.enum(['ACCEPT', 'REJECT']), note: z.string().trim().max(2000).optional() })
  .refine((v) => v.decision === 'ACCEPT' || !!v.note, { message: 'Give the reason for rejecting the package', path: ['note'] });

/**
 * Staff decision on a counterparty-approved package. ACCEPT -> Accepted and the account's
 * executions for that date move Received -> Matched; REJECT -> Rejected and they move to
 * Exception. The note travels back to the counterparty (FR-REC-015).
 */
opsCustodianRoutes.post(
  '/day-end/:id/review',
  requirePermission('custodian.review'),
  idempotent('ops.custodian.review', { required: false }),
  validateBody(reviewSchema),
  async (req, res) => {
    const { decision, note } = req.body as z.infer<typeof reviewSchema>;
    const pkg = await prisma.counterpartyDayEndPackage.findFirst({
      where: { id: param(req, 'id'), status: { not: 'Draft' } },
      include: { counterparty: { select: cpSelect } },
    });
    if (!pkg) throw HttpError.notFound('Day-end package not found');
    if (pkg.status !== 'Approved') {
      throw HttpError.conflict(`Only counterparty-approved packages can be reviewed (this one is ${pkg.status.toLowerCase()})`, 'invalid_transition');
    }
    if ((await packageHash(pkg, pkg.counterparty.ref)) !== pkg.sha256) {
      throw HttpError.conflict('The package no longer matches its submitted fingerprint', 'integrity_mismatch');
    }
    const controls = await tradeControl(pkg.counterpartyId, pkg.accountRef, pkg.statementDate, pkg.tradeCount);
    const next = decision === 'ACCEPT' ? 'Accepted' : 'Rejected';
    const executionStatus = decision === 'ACCEPT' ? 'Matched' : 'Exception';
    const start = new Date(`${pkg.statementDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    const counterpartyUsers = (
      await prisma.counterpartyUser.findMany({ where: { counterpartyId: pkg.counterpartyId, status: 'active' }, select: { userId: true } })
    ).map((u) => u.userId);

    const updated = await prisma.$transaction(async (tx) => {
      const n = await tx.counterpartyDayEndPackage.updateMany({ where: { id: pkg.id, status: 'Approved' }, data: { status: next } });
      if (!n.count) throw HttpError.conflict('This package changed; reload and try again', 'invalid_transition');
      const affected = await tx.counterpartyExecution.findMany({
        where: { counterpartyId: pkg.counterpartyId, accountRef: pkg.accountRef, executionAt: { gte: start, lt: end }, status: 'Received' },
        select: { id: true, ref: true },
      });
      if (affected.length) {
        await tx.counterpartyExecution.updateMany({ where: { id: { in: affected.map((a) => a.id) } }, data: { status: executionStatus } });
      }
      await writeAudit(tx, ctx(req, 'admin'), {
        action: 'custodian.dayend.reviewed',
        objectType: 'custodian_day_end',
        objectId: pkg.id,
        before: { status: 'Approved' },
        after: { status: next, decision, ref: pkg.ref, controls, executions: affected.map((a) => a.ref), executionStatus },
        reason: note || null,
      });
      if (counterpartyUsers.length) {
        await enqueue(tx, 'notify.users', {
          userIds: counterpartyUsers,
          type: 'custodian.dayend.reviewed',
          title: `Day-end package ${pkg.ref} ${next.toLowerCase()} by Matanho`,
          body: note || `${pkg.accountRef} · ${pkg.statementDate.toISOString().slice(0, 10)}`,
        } satisfies NotifyUsersPayload);
      }
      return { row: await tx.counterpartyDayEndPackage.findUniqueOrThrow({ where: { id: pkg.id } }), affected: affected.length };
    });
    const files = await filesById([updated.row.fileId]);
    res.json({
      package: { ...dayEndView(updated.row, updated.row.fileId ? files.get(updated.row.fileId) : null), counterparty: pkg.counterparty },
      controls,
      executionsUpdated: updated.affected,
      executionStatus,
    });
  },
);
