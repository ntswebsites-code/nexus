import type { Request } from 'express';
import type { LpNotice as LpNoticeRow, LpNoticeReceipt, Prisma } from '@prisma/client';
import type { LpNotice } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { LpError } from '../lp.http';
import type { LpContext } from '../lp.context';
import { fundNames, lpAudit } from './common';

/** Published, unexpired notices addressed to this member (ALL, their funds, their client, or them). */
export function visibleNoticeWhere(ctx: LpContext): Prisma.LpNoticeWhereInput {
  const now = new Date();
  return {
    status: 'PUBLISHED',
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    AND: [
      {
        OR: [
          { targetType: 'ALL' },
          { targetType: 'FUND', fundId: { in: ctx.fundIds } },
          { targetType: 'ORG', clientId: ctx.client.id },
          { targetType: 'USER', userId: ctx.userId },
        ],
      },
    ],
  };
}

type NoticeWithReceipt = LpNoticeRow & { receipts: LpNoticeReceipt[] };

function noticeView(n: NoticeWithReceipt, names: Map<string, string>, full: boolean): LpNotice {
  const r = n.receipts[0];
  const status = r?.acknowledgedAt ? 'ACKNOWLEDGED' : r?.openedAt ? 'OPENED' : n.status;
  return {
    id: n.id,
    title: n.title,
    status,
    fundId: n.fundId ?? '',
    fundName: n.fundId ? (names.get(n.fundId) ?? '') : 'All funds',
    shareClass: n.shareClassCode,
    publishedAt: (n.publishedAt ?? n.createdAt).toISOString(),
    acknowledgedAt: r?.acknowledgedAt?.toISOString() ?? null,
    openedAt: r?.openedAt?.toISOString() ?? null,
    category: n.category,
    kind: n.requiresAcknowledgement ? 'ACTION_REQUIRED' : 'INFO',
    requiresAcknowledgement: n.requiresAcknowledgement,
    preview: n.body.slice(0, 240),
    ...(full ? { body: n.body } : {}),
  };
}

export async function listNotices(ctx: LpContext, page: number, pageSize: number) {
  const where = visibleNoticeWhere(ctx);
  const [rows, total] = await Promise.all([
    prisma.lpNotice.findMany({
      where,
      include: { receipts: { where: { userId: ctx.userId } } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lpNotice.count({ where }),
  ]);
  const names = await fundNames(rows.map((n) => n.fundId));
  return { items: rows.map((n) => noticeView(n, names, false)), total };
}

async function findNotice(ctx: LpContext, idOrRef: string) {
  const n = await prisma.lpNotice.findFirst({
    where: { AND: [visibleNoticeWhere(ctx), { OR: [{ id: idOrRef }, { ref: idOrRef }] }] },
  });
  if (!n) throw LpError.notFound('Notice');
  return n;
}

/** Detail; opening records the member's receipt (first open wins). */
export async function getNotice(ctx: LpContext, id: string): Promise<LpNotice> {
  const n = await findNotice(ctx, id);
  const now = new Date();
  const existing = await prisma.lpNoticeReceipt.findUnique({ where: { noticeId_userId: { noticeId: n.id, userId: ctx.userId } } });
  const receipt = existing?.openedAt
    ? existing
    : await prisma.lpNoticeReceipt.upsert({
        where: { noticeId_userId: { noticeId: n.id, userId: ctx.userId } },
        create: { noticeId: n.id, clientId: ctx.client.id, userId: ctx.userId, openedAt: now },
        update: { openedAt: now },
      });
  const names = await fundNames([n.fundId]);
  return noticeView({ ...n, receipts: [receipt] }, names, true);
}

/** Acknowledgement is recorded once; repeats answer the original time (no 409). */
export async function acknowledgeNotice(req: Request, ctx: LpContext, id: string) {
  const n = await findNotice(ctx, id);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const existing = await tx.lpNoticeReceipt.findUnique({ where: { noticeId_userId: { noticeId: n.id, userId: ctx.userId } } });
    if (existing?.acknowledgedAt) return { acknowledgedAt: existing.acknowledgedAt.toISOString() };
    const r = await tx.lpNoticeReceipt.upsert({
      where: { noticeId_userId: { noticeId: n.id, userId: ctx.userId } },
      create: { noticeId: n.id, clientId: ctx.client.id, userId: ctx.userId, openedAt: now, acknowledgedAt: now },
      update: { openedAt: existing?.openedAt ?? now, acknowledgedAt: now },
    });
    await writeAudit(tx, lpAudit(req), {
      action: 'lp_notice.acknowledged',
      objectType: 'lp_notice',
      objectId: n.id,
      after: { ref: n.ref, clientId: ctx.client.id, acknowledgedAt: now.toISOString() },
    });
    return { acknowledgedAt: r.acknowledgedAt!.toISOString() };
  });
}

// ── Staff lifecycle helpers (ops/notices) ─────────────────────────────────

/** Clients with a live commitment, optionally to one fund. */
async function committedClientIds(tx: Prisma.TransactionClient, fundId?: string) {
  const rows = await tx.fundCommitment.findMany({
    where: { status: { in: ['ACTIVE', 'PENDING'] }, ...(fundId ? { fundId } : {}) },
    select: { clientId: true },
  });
  return [...new Set(rows.map((r) => r.clientId))];
}

function fundScopeAllows(fundIds: Prisma.JsonValue | null, fundId: string) {
  return !Array.isArray(fundIds) || fundIds.length === 0 || fundIds.includes(fundId);
}

/** Active LP members (client + user) a notice is addressed to. */
export async function noticeRecipients(tx: Prisma.TransactionClient, n: LpNoticeRow) {
  const memberWhere = { revokedAt: null, status: { not: 'SUSPENDED' } };
  let members: { clientId: string; userId: string; fundIds: Prisma.JsonValue | null }[] = [];
  if (n.targetType === 'USER' && n.userId) {
    members = await tx.clientUser.findMany({
      where: { ...memberWhere, userId: n.userId, ...(n.clientId ? { clientId: n.clientId } : {}) },
      select: { clientId: true, userId: true, fundIds: true },
      take: 1,
    });
  } else if (n.targetType === 'ORG' && n.clientId) {
    members = await tx.clientUser.findMany({ where: { ...memberWhere, clientId: n.clientId }, select: { clientId: true, userId: true, fundIds: true } });
  } else if (n.targetType === 'FUND' && n.fundId) {
    const fundId = n.fundId;
    const clientIds = await committedClientIds(tx, fundId);
    members = (
      await tx.clientUser.findMany({ where: { ...memberWhere, clientId: { in: clientIds } }, select: { clientId: true, userId: true, fundIds: true } })
    ).filter((m) => fundScopeAllows(m.fundIds, fundId));
  } else if (n.targetType === 'ALL') {
    const clientIds = await committedClientIds(tx);
    members = await tx.clientUser.findMany({ where: { ...memberWhere, clientId: { in: clientIds } }, select: { clientId: true, userId: true, fundIds: true } });
  }
  const seen = new Set<string>();
  return members.filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true)));
}

/** Allocates NTC-00001 style refs on the shared `sequences` table. */
export async function nextNoticeRef(tx: Prisma.TransactionClient): Promise<string> {
  const name = 'lpNotice';
  await tx.$executeRaw`INSERT INTO sequences (name, value) VALUES (${name}, 0) ON DUPLICATE KEY UPDATE value = value`;
  await tx.$executeRaw`UPDATE sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = ${name}`;
  const rows = await tx.$queryRaw<{ v: bigint }[]>`SELECT LAST_INSERT_ID() AS v`;
  return `NTC-${String(Number(rows[0]!.v)).padStart(5, '0')}`;
}
