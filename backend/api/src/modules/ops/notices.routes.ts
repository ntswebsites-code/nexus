import { Router } from 'express';
import type { LpNotice, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { ctx, expectVersion, param } from '../../lib/http';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { requirePermission } from '../../middleware/requireAuth';
import { validateBody } from '../../middleware/validate';
import { nextNoticeRef, noticeRecipients } from '../lp-portal/services/notices';
import { idempotent } from '../../lib/idempotency';

/**
 * `/api/v1/ops/notices` - LP notices authored by staff (SRD 5B notices, DEV-PLAN WS1).
 * DRAFT -> PENDING_APPROVAL (submit) -> APPROVED (approve, a different person) -> PUBLISHED -> WITHDRAWN.
 */
export const opsNoticesRoutes = Router();

const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'admin');

const CATEGORIES = ['CAPITAL_CALL', 'DISTRIBUTION', 'REPORT', 'NAV', 'DEALING', 'POLICY', 'SYSTEM', 'GENERAL'] as const;

const createSchema = z
  .object({
    title: z.string().trim().min(3).max(512),
    body: z.string().trim().min(1).max(20000),
    category: z.enum(CATEGORIES).default('GENERAL'),
    targetType: z.enum(['ALL', 'FUND', 'ORG', 'USER']),
    fundId: z.string().trim().length(36).optional().nullable(),
    clientId: z.string().trim().length(36).optional().nullable(),
    userId: z.string().trim().length(36).optional().nullable(),
    shareClassCode: z.string().trim().max(32).optional().nullable(),
    requiresAcknowledgement: z.boolean().default(false),
    expiresAt: z.coerce.date().optional().nullable(),
  })
  .superRefine((b, c) => {
    if (b.targetType === 'FUND' && !b.fundId) c.addIssue({ code: 'custom', path: ['fundId'], message: 'Required for a fund notice' });
    if (b.targetType === 'ORG' && !b.clientId) c.addIssue({ code: 'custom', path: ['clientId'], message: 'Required for an organisation notice' });
    if (b.targetType === 'USER' && !b.userId) c.addIssue({ code: 'custom', path: ['userId'], message: 'Required for a user notice' });
    if (b.expiresAt && b.expiresAt.getTime() <= Date.now()) c.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Must be in the future' });
  });

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });

function noticeView(n: LpNotice & { _count?: { receipts: number } }) {
  return {
    id: n.id,
    ref: n.ref,
    title: n.title,
    body: n.body,
    category: n.category,
    targetType: n.targetType,
    fundId: n.fundId,
    clientId: n.clientId,
    userId: n.userId,
    shareClassCode: n.shareClassCode,
    requiresAcknowledgement: n.requiresAcknowledgement,
    status: n.status,
    createdById: n.createdById,
    approvedById: n.approvedById,
    publishedById: n.publishedById,
    publishedAt: n.publishedAt,
    expiresAt: n.expiresAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    version: n.version,
    ...(n._count ? { recipients: n._count.receipts } : {}),
  };
}

/** Adds display names (preparer, approver, fund, LP, user) so the console never shows raw ids. */
async function noticeNames(rows: LpNotice[]) {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const userIds = uniq(rows.flatMap((n) => [n.createdById, n.approvedById, n.publishedById, n.userId]));
  const fundIds = uniq(rows.map((n) => n.fundId));
  const clientIds = uniq(rows.map((n) => n.clientId));
  const [users, funds, clients] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
    fundIds.length ? prisma.fund.findMany({ where: { id: { in: fundIds } }, select: { id: true, name: true } }) : [],
    clientIds.length ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = (id: string | null) => {
    const u = users.find((x) => x.id === id);
    return u ? (u.name ?? u.email) : null;
  };
  return (n: LpNotice) => ({
    createdByName: userName(n.createdById),
    approvedByName: userName(n.approvedById),
    userName: userName(n.userId),
    fundName: funds.find((f) => f.id === n.fundId)?.name ?? null,
    clientName: clients.find((c) => c.id === n.clientId)?.name ?? null,
  });
}

async function findNotice(id: string) {
  const n = await prisma.lpNotice.findFirst({ where: { OR: [{ id }, { ref: id }] } });
  if (!n) throw HttpError.notFound('Notice not found');
  return n;
}

/** Moves `from` -> `to` only if nobody changed the notice meanwhile (status + version guard). */
async function transition(tx: Prisma.TransactionClient, n: LpNotice, from: string[], to: string, data: Prisma.LpNoticeUpdateManyMutationInput = {}) {
  if (!from.includes(n.status)) {
    throw HttpError.conflict(`Notice is ${n.status}; expected ${from.join(' or ')}`, 'invalid_state');
  }
  const res = await tx.lpNotice.updateMany({
    where: { id: n.id, status: n.status, version: n.version },
    data: { ...data, status: to, version: { increment: 1 } },
  });
  if (res.count !== 1) throw HttpError.conflict('Notice was changed by someone else - reload and retry', 'version_conflict');
  return tx.lpNotice.findUniqueOrThrow({ where: { id: n.id } });
}

opsNoticesRoutes.get('/', requirePermission('notices.view'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
  const rows = await prisma.lpNotice.findMany({
    where: status ? { status } : {},
    include: { _count: { select: { receipts: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const names = await noticeNames(rows);
  res.json({ data: rows.map((n) => ({ ...noticeView(n), ...names(n) })), total: rows.length });
});

opsNoticesRoutes.get('/:id', requirePermission('notices.view'), async (req, res) => {
  const n = await findNotice(param(req, 'id'));
  const recipients = await prisma.lpNoticeReceipt.count({ where: { noticeId: n.id } });
  const names = await noticeNames([n]);
  res.json({ notice: { ...noticeView(n), ...names(n), recipients } });
});

opsNoticesRoutes.post('/', requirePermission('notices.create'), validateBody(createSchema), idempotent('ops.post.root', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  if (b.targetType === 'FUND' && !(await prisma.fund.findUnique({ where: { id: b.fundId! }, select: { id: true } }))) {
    throw HttpError.badRequest('Validation failed', [{ path: 'fundId', message: 'Unknown fund' }]);
  }
  if (b.targetType === 'ORG' && !(await prisma.client.findUnique({ where: { id: b.clientId! }, select: { id: true } }))) {
    throw HttpError.badRequest('Validation failed', [{ path: 'clientId', message: 'Unknown client' }]);
  }
  if (b.targetType === 'USER') {
    const member = await prisma.clientUser.findFirst({
      where: { userId: b.userId!, revokedAt: null, ...(b.clientId ? { clientId: b.clientId } : {}) },
      select: { clientId: true },
    });
    if (!member) throw HttpError.badRequest('Validation failed', [{ path: 'userId', message: 'Not an investor-portal member' }]);
    b.clientId = member.clientId;
  }
  const notice = await prisma.$transaction(async (tx) => {
    const n = await tx.lpNotice.create({
      data: {
        ref: await nextNoticeRef(tx),
        title: b.title,
        body: b.body,
        category: b.category,
        targetType: b.targetType,
        fundId: b.targetType === 'FUND' ? b.fundId : null,
        clientId: b.targetType === 'ORG' || b.targetType === 'USER' ? b.clientId : null,
        userId: b.targetType === 'USER' ? b.userId : null,
        shareClassCode: b.shareClassCode ?? null,
        requiresAcknowledgement: b.requiresAcknowledgement,
        expiresAt: b.expiresAt ?? null,
        status: 'DRAFT',
        createdById: req.user!.id,
      },
    });
    await writeAudit(tx, audit(req), { action: 'lp_notice.created', objectType: 'lp_notice', objectId: n.id, after: noticeView(n) });
    return n;
  });
  res.status(201).json({ notice: noticeView(notice) });
});

opsNoticesRoutes.post('/:id/submit', requirePermission('notices.create'), idempotent('ops.post.id_submit', { required: false }), async (req, res) => {
  const n = await findNotice(param(req, 'id'));
  const updated = await prisma.$transaction(async (tx) => {
    expectVersion(req, n.version);
    const u = await transition(tx, n, ['DRAFT'], 'PENDING_APPROVAL');
    await writeAudit(tx, audit(req), { action: 'lp_notice.submitted', objectType: 'lp_notice', objectId: n.id, before: { status: n.status }, after: { status: u.status } });
    await enqueue(tx, 'notify.permission', {
      permission: 'notices.publish',
      type: 'lp_notice.pending_approval',
      title: `Notice awaiting approval · ${n.ref}`,
      body: n.title,
      link: '/?page=notices',
    });
    return u;
  });
  res.json({ notice: noticeView(updated) });
});

opsNoticesRoutes.post('/:id/approve', requirePermission('notices.publish'), idempotent('ops.post.id_approve', { required: false }), async (req, res) => {
  const n = await findNotice(param(req, 'id'));
  if (n.createdById && n.createdById === req.user!.id) {
    throw HttpError.forbidden('Segregation of duties: a different person must approve this notice', 'segregation_of_duties');
  }
  const updated = await prisma.$transaction(async (tx) => {
    expectVersion(req, n.version);
    const u = await transition(tx, n, ['PENDING_APPROVAL'], 'APPROVED', { approvedById: req.user!.id });
    await writeAudit(tx, audit(req), { action: 'lp_notice.approved', objectType: 'lp_notice', objectId: n.id, before: { status: n.status }, after: { status: u.status, approvedById: req.user!.id } });
    return u;
  });
  res.json({ notice: noticeView(updated) });
});

opsNoticesRoutes.post('/:id/publish', requirePermission('notices.publish'), idempotent('ops.post.id_publish', { required: false }), async (req, res) => {
  const n = await findNotice(param(req, 'id'));
  if (n.expiresAt && n.expiresAt.getTime() <= Date.now()) throw HttpError.conflict('Notice has already expired', 'invalid_state');
  const out = await prisma.$transaction(async (tx) => {
    const now = new Date();
    expectVersion(req, n.version);
    const u = await transition(tx, n, ['APPROVED'], 'PUBLISHED', { publishedAt: now, publishedById: req.user!.id });
    const recipients = await noticeRecipients(tx, u);
    if (recipients.length) {
      await tx.lpNoticeReceipt.createMany({
        data: recipients.map((m) => ({ noticeId: u.id, clientId: m.clientId, userId: m.userId, deliveredAt: now })),
        skipDuplicates: true,
      });
      await enqueue(tx, 'notify.users', {
        userIds: recipients.map((m) => m.userId),
        type: 'notice.published',
        title: u.title,
        body: u.body.slice(0, 240),
        link: `/lp-portal/notices?id=${u.id}`,
        email: true,
      });
    }
    await writeAudit(tx, audit(req), {
      action: 'lp_notice.published',
      objectType: 'lp_notice',
      objectId: n.id,
      before: { status: n.status },
      after: { status: u.status, publishedAt: now.toISOString(), recipients: recipients.length },
    });
    return { u, recipients: recipients.length };
  });
  res.json({ notice: { ...noticeView(out.u), recipients: out.recipients } });
});

opsNoticesRoutes.post('/:id/withdraw', requirePermission('notices.publish'), validateBody(reasonSchema), idempotent('ops.post.id_withdraw', { required: false }), async (req, res) => {
  const n = await findNotice(param(req, 'id'));
  const { reason } = req.body as z.infer<typeof reasonSchema>;
  const updated = await prisma.$transaction(async (tx) => {
    expectVersion(req, n.version);
    const u = await transition(tx, n, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED'], 'WITHDRAWN');
    await writeAudit(tx, audit(req), { action: 'lp_notice.withdrawn', objectType: 'lp_notice', objectId: n.id, before: { status: n.status }, after: { status: u.status }, reason });
    return u;
  });
  res.json({ notice: noticeView(updated) });
});

opsNoticesRoutes.get('/:id/receipts', requirePermission('notices.view'), async (req, res) => {
  const n = await findNotice(param(req, 'id'));
  const rows = await prisma.lpNoticeReceipt.findMany({ where: { noticeId: n.id }, orderBy: { deliveredAt: 'asc' }, take: 2000 });
  const [users, clients] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, email: true } }),
    prisma.client.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.clientId))] } }, select: { id: true, ref: true, name: true } }),
  ]);
  const u = new Map(users.map((x) => [x.id, x]));
  const c = new Map(clients.map((x) => [x.id, x]));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientRef: c.get(r.clientId)?.ref ?? null,
      clientName: c.get(r.clientId)?.name ?? null,
      userId: r.userId,
      userName: u.get(r.userId)?.name ?? null,
      email: u.get(r.userId)?.email ?? null,
      deliveredAt: r.deliveredAt,
      openedAt: r.openedAt,
      acknowledgedAt: r.acknowledgedAt,
    })),
    total: rows.length,
    summary: {
      delivered: rows.length,
      opened: rows.filter((r) => r.openedAt).length,
      acknowledged: rows.filter((r) => r.acknowledgedAt).length,
    },
  });
});
