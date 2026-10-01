import type { Request } from 'express';
import type { Prisma, RequestAttachment, ServiceRequest } from '@prisma/client';
import type { LpMessageThreadDetail, LpMessageThreadSummary, LpRequestAttachment, LpServiceRequest, LpServiceRequestAttachment } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { enqueue } from '../../../lib/outbox';
import { actorName } from '../../../lib/http';
import { nextRef } from '../../../lib/refs';
import { HttpError } from '../../../lib/errors';
import { storeFile } from '../../../lib/storage';
import { LpError } from '../lp.http';
import { assertFund, type LpContext } from '../lp.context';
import { asRecord, attachmentId, fundNames, fundScopeWhere, initials, lpAudit, str } from './common';

const LP_BASE = '/api/v1/lp-portal';
const REQUEST_LINK = 'service_request';

// ── Status vocabulary ─────────────────────────────────────────────────────
// Staff work the legacy four-state queue; the LP sees SRD 5B states. `lpStatus` refines the legacy
// bucket when it is consistent with it, otherwise the bucket's default is shown.

const BUCKETS: Record<string, { allowed: string[]; fallback: string }> = {
  Open: { allowed: ['SUBMITTED', 'OPEN', 'ASSIGNED'], fallback: 'OPEN' },
  'In progress': { allowed: ['UNDER_REVIEW', 'AWAITING_INTERNAL', 'ASSIGNED'], fallback: 'UNDER_REVIEW' },
  'Waiting on you': { allowed: ['AWAITING_INVESTOR'], fallback: 'AWAITING_INVESTOR' },
  Closed: { allowed: ['RESOLVED', 'CLOSED'], fallback: 'CLOSED' },
};

export function lpRequestStatus(r: Pick<ServiceRequest, 'status' | 'lpStatus' | 'ownerName'>): string {
  const bucket = BUCKETS[r.status];
  if (!bucket) return r.lpStatus ?? 'OPEN';
  if (r.status === 'Open' && r.lpStatus === 'SUBMITTED' && r.ownerName && r.ownerName !== 'Unassigned') return 'ASSIGNED';
  return r.lpStatus && bucket.allowed.includes(r.lpStatus) ? r.lpStatus : bucket.fallback;
}

function storedPriority(p: string | undefined) {
  const v = (p ?? 'NORMAL').toUpperCase();
  if (['HIGH', 'URGENT', 'TIME_SENSITIVE', 'TIME SENSITIVE'].includes(v)) return 'Time sensitive';
  if (v === 'LOW') return 'Low';
  return 'Normal';
}

function lpPriority(p: string) {
  if (p === 'Time sensitive') return 'HIGH';
  return p.toUpperCase();
}

const SLA_HOURS: Record<string, number> = { 'Time sensitive': 8, Normal: 48, Low: 120 };

// ── Attachments ───────────────────────────────────────────────────────────

function attachmentView(a: RequestAttachment): LpServiceRequestAttachment & { mimeType: string; createdAt: string } {
  return {
    id: a.id,
    name: a.name,
    size: a.size,
    mimeType: a.mime,
    downloadUrl: `${LP_BASE}/requests/attachments/${a.id}/download`,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function uploadAttachment(req: Request, ctx: LpContext, file: Express.Multer.File | undefined) {
  if (!file) throw LpError.validation('file is required', { file: 'Required' });
  const row = await prisma
    .$transaction(async (tx) => {
      const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: ctx.userId }, tx);
      const a = await tx.requestAttachment.create({
        data: {
          id: attachmentId(),
          clientId: ctx.client.id,
          fileId: stored.id,
          name: file.originalname.slice(0, 255),
          size: stored.size,
          mime: stored.mime,
          sha256: stored.sha256,
          uploadedById: ctx.userId,
        },
      });
      await writeAudit(tx, lpAudit(req), { action: 'request_attachment.uploaded', objectType: 'request_attachment', objectId: a.id, after: { name: a.name, size: a.size, sha256: a.sha256 } });
      return a;
    })
    .catch((e: unknown) => {
      if (e instanceof HttpError && e.status === 400 && e.message.startsWith('File type')) {
        throw new LpError(415, 'LP_UNSUPPORTED_MEDIA', e.message);
      }
      throw e;
    });
  const v = attachmentView(row);
  return { ...v, uploadedAt: v.createdAt } satisfies LpRequestAttachment & object;
}

export async function findAttachment(ctx: LpContext, id: string) {
  const a = await prisma.requestAttachment.findFirst({ where: { id, clientId: ctx.client.id } });
  if (!a) throw LpError.notFound('Attachment');
  return a;
}

/** Unlinked uploads of this client only; anything else is a validation error, never a silent drop. */
async function claimAttachments(tx: Prisma.TransactionClient, ctx: LpContext, ids: unknown) {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string') || ids.length > 10) {
    throw LpError.validation('Invalid attachmentIds', { attachmentIds: 'One or more attachments are invalid' });
  }
  const unique = [...new Set(ids as string[])];
  if (!unique.length) return [];
  const rows = await tx.requestAttachment.findMany({
    where: { id: { in: unique }, clientId: ctx.client.id, requestId: null, messageId: null, threadMessageId: null },
  });
  if (rows.length !== unique.length) throw LpError.validation('Invalid attachmentIds', { attachmentIds: 'One or more attachments are invalid' });
  return unique;
}

// ── Requests ──────────────────────────────────────────────────────────────

const requestInclude = { events: { orderBy: { at: 'asc' } } } satisfies Prisma.ServiceRequestInclude;
type RequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

const SYSTEM_EVENTS = new Set(['Submitted', 'Client response', 'Assigned']);

async function people(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, { id: string; email: string; name: string }>();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, email: true, name: true } });
  return new Map(users.map((u) => [u.id, { id: u.id, email: u.email, name: u.name ?? u.email }]));
}

async function requestViews(rows: RequestRow[], withMessages: boolean): Promise<LpServiceRequest[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [names, who, attachments, threads] = await Promise.all([
    fundNames(rows.map((r) => r.fundId)),
    people(rows.map((r) => r.openedById)),
    prisma.requestAttachment.findMany({ where: { requestId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
    withMessages
      ? prisma.messageThread.findMany({
          where: { linkedType: REQUEST_LINK, linkedId: { in: ids } },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
      : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const own = attachments.filter((a) => a.requestId === r.id);
    const view: LpServiceRequest = {
      id: r.id,
      reference: r.ref,
      type: r.type,
      fundId: r.fundId ?? '',
      fundName: r.fundId ? (names.get(r.fundId) ?? '') : '',
      status: lpRequestStatus(r),
      priority: lpPriority(r.priority),
      subject: r.title,
      description: r.detail ?? '',
      submittedBy: (r.openedById && who.get(r.openedById)) || null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      attachments: own.map(attachmentView),
    };
    if (withMessages) {
      const thread = threads.find((t) => t.linkedId === r.id);
      const fromThread = (thread?.messages ?? []).map((m) => ({
        id: m.id,
        authorType: m.fromClient ? 'INVESTOR' : 'INTERNAL',
        authorId: m.authorId ?? '',
        authorName: m.authorName,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        attachments: own.filter((a) => a.threadMessageId === m.id).map(attachmentView),
      }));
      const staffNotes = r.events
        .filter((e) => e.detail && !SYSTEM_EVENTS.has(e.title))
        .map((e) => ({
          id: e.id,
          authorType: 'INTERNAL',
          authorId: e.actorId ?? '',
          authorName: 'Client Services',
          body: e.detail!,
          createdAt: e.at.toISOString(),
          attachments: [],
        }));
      view.messages = [...fromThread, ...staffNotes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return view;
  });
}

export async function listRequests(ctx: LpContext, q: { status?: string; fundId?: string; type?: string }) {
  const rows = await prisma.serviceRequest.findMany({
    where: { clientId: ctx.client.id, ...fundScopeWhere(ctx, q.fundId), ...(q.type ? { type: q.type.toUpperCase() } : {}) },
    include: requestInclude,
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  const views = await requestViews(rows, false);
  const status = q.status?.toUpperCase();
  return status ? views.filter((v) => v.status === status) : views;
}

async function findRequest(ctx: LpContext, reference: string) {
  const r = await prisma.serviceRequest.findFirst({
    where: { clientId: ctx.client.id, OR: [{ ref: reference }, { id: reference }], ...fundScopeWhere(ctx) },
    include: requestInclude,
  });
  if (!r) throw LpError.notFound('Service request');
  return r;
}

export async function getRequest(ctx: LpContext, reference: string) {
  const [view] = await requestViews([await findRequest(ctx, reference)], true);
  return view!;
}

export async function createRequest(req: Request, ctx: LpContext) {
  const b = asRecord(req.body);
  const subject = str(b.subject);
  const fieldErrors: Record<string, string> = {};
  if (!subject) fieldErrors.subject = 'Required';
  else if (subject.length > 200) fieldErrors.subject = 'At most 200 characters';
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length > 10000) fieldErrors.description = 'At most 10000 characters';
  const type = (str(b.type) ?? 'GENERAL').toUpperCase().replace(/\s+/g, '_');
  if (type.length > 64 || !/^[A-Z0-9_]+$/.test(type)) fieldErrors.type = 'Invalid request type';
  if (Object.keys(fieldErrors).length) throw LpError.validation(fieldErrors.subject === 'Required' ? 'subject is required' : 'Check the request details', fieldErrors);
  const fundId = str(b.fundId);
  if (fundId) assertFund(ctx, fundId);
  const priority = storedPriority(str(b.priority));
  const now = new Date();

  const id = await prisma.$transaction(async (tx) => {
    const attachments = await claimAttachments(tx, ctx, b.attachmentIds);
    const ref = await nextRef(tx, 'request');
    const r = await tx.serviceRequest.create({
      data: {
        ref,
        clientId: ctx.client.id,
        type,
        priority,
        title: subject!,
        detail: description || null,
        status: 'Open',
        lpStatus: 'SUBMITTED',
        ownerName: 'Unassigned',
        progress: 10,
        slaDueAt: new Date(now.getTime() + (SLA_HOURS[priority] ?? 48) * 3600 * 1000),
        openedById: ctx.userId,
        fundId: fundId ?? null,
        events: { create: { title: 'Submitted', detail: 'Submitted via the LP portal', actorId: ctx.userId } },
      },
    });
    const thread = await tx.messageThread.create({
      data: {
        clientId: ctx.client.id,
        title: `${ref} · ${subject}`.slice(0, 200),
        ownerName: 'Client Services',
        ownerRole: 'Client Services',
        linkedType: REQUEST_LINK,
        linkedId: r.id,
        fundId: fundId ?? null,
        status: 'OPEN',
        lastMessageAt: now,
      },
    });
    let firstMessageId: string | null = null;
    if (description) {
      const m = await tx.message.create({ data: { threadId: thread.id, authorId: ctx.userId, authorName: actorName(req), fromClient: true, body: description } });
      firstMessageId = m.id;
    }
    await tx.messageRead.create({ data: { threadId: thread.id, userId: ctx.userId, readAt: now } });
    if (attachments.length) {
      await tx.requestAttachment.updateMany({ where: { id: { in: attachments } }, data: { requestId: r.id, threadMessageId: firstMessageId } });
    }
    await writeAudit(tx, lpAudit(req), {
      action: 'service_request.created',
      objectType: 'service_request',
      objectId: r.id,
      after: { ref, type, priority, fundId: fundId ?? null, attachments: attachments.length, via: 'lp-portal' },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'clients.edit',
      type: 'service_request.created',
      title: `New request ${ref} · ${ctx.client.name}`,
      body: subject,
      link: '/?page=clients',
    });
    return r.id;
  });
  return getRequest(ctx, id);
}

/** Investor reply on a request: thread message + queue event; reopens resolved/closed work (BR-181). */
async function onInvestorReply(tx: Prisma.TransactionClient, r: ServiceRequest, ctx: LpContext, body: string) {
  const current = lpRequestStatus(r);
  let data: Prisma.ServiceRequestUpdateInput | null = null;
  if (current === 'AWAITING_INVESTOR') data = { status: 'In progress', lpStatus: 'UNDER_REVIEW' };
  else if (current === 'RESOLVED' || current === 'CLOSED') data = { status: 'In progress', lpStatus: 'AWAITING_INTERNAL' };
  await tx.serviceRequest.update({
    where: { id: r.id },
    data: { ...(data ?? {}), version: { increment: 1 }, events: { create: { title: 'Client response', detail: body.slice(0, 2000), actorId: ctx.userId } } },
  });
  await enqueue(tx, 'notify.permission', {
    permission: 'clients.edit',
    type: 'service_request.updated',
    title: `Client response on ${r.ref}`,
    body: `${ctx.client.name}: ${body.slice(0, 160)}`,
    link: '/?page=clients',
  });
  return data?.status ?? r.status;
}

function replyBody(req: Request) {
  const b = asRecord(req.body);
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (!body) throw LpError.validation('body is required', { body: 'Required' });
  if (body.length > 10000) throw LpError.validation('body is too long', { body: 'At most 10000 characters' });
  return { body, attachmentIds: b.attachmentIds };
}

async function ensureRequestThread(tx: Prisma.TransactionClient, r: ServiceRequest) {
  const existing = await tx.messageThread.findFirst({ where: { linkedType: REQUEST_LINK, linkedId: r.id, clientId: r.clientId } });
  if (existing) return existing;
  return tx.messageThread.create({
    data: {
      clientId: r.clientId,
      title: `${r.ref} · ${r.title}`.slice(0, 200),
      ownerName: r.ownerName || 'Client Services',
      ownerRole: 'Client Services',
      linkedType: REQUEST_LINK,
      linkedId: r.id,
      fundId: r.fundId,
      status: 'OPEN',
    },
  });
}

export async function replyToRequest(req: Request, ctx: LpContext, reference: string) {
  const { body, attachmentIds } = replyBody(req);
  const r = await findRequest(ctx, reference);
  const out = await prisma.$transaction(async (tx) => {
    const attachments = await claimAttachments(tx, ctx, attachmentIds);
    const thread = await ensureRequestThread(tx, r);
    const now = new Date();
    const m = await tx.message.create({ data: { threadId: thread.id, authorId: ctx.userId, authorName: actorName(req), fromClient: true, body } });
    await tx.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: now, status: 'OPEN' } });
    await tx.messageRead.upsert({ where: { threadId_userId: { threadId: thread.id, userId: ctx.userId } }, create: { threadId: thread.id, userId: ctx.userId, readAt: now }, update: { readAt: now } });
    if (attachments.length) await tx.requestAttachment.updateMany({ where: { id: { in: attachments } }, data: { requestId: r.id, threadMessageId: m.id } });
    const status = await onInvestorReply(tx, r, ctx, body);
    await writeAudit(tx, lpAudit(req), {
      action: 'service_request.replied',
      objectType: 'service_request',
      objectId: r.id,
      before: { status: r.status },
      after: { status, messageId: m.id, attachments: attachments.length, via: 'lp-portal' },
    });
    const rows = attachments.length ? await tx.requestAttachment.findMany({ where: { id: { in: attachments } } }) : [];
    return { m, rows };
  });
  return { id: out.m.id, authorType: 'INVESTOR', body: out.m.body, attachments: out.rows.map(attachmentView), createdAt: out.m.createdAt.toISOString() };
}

// ── Message threads ───────────────────────────────────────────────────────

const threadWhere = (ctx: LpContext): Prisma.MessageThreadWhereInput => ({ clientId: ctx.client.id, ...fundScopeWhere(ctx) });

async function relatedRefs(threads: { linkedType: string | null; linkedId: string | null }[]) {
  const ids = threads.filter((t) => t.linkedType === REQUEST_LINK && t.linkedId).map((t) => t.linkedId!);
  if (!ids.length) return new Map<string, string>();
  const rows = await prisma.serviceRequest.findMany({ where: { id: { in: ids } }, select: { id: true, ref: true } });
  return new Map(rows.map((r) => [r.id, r.ref]));
}

function related(t: { linkedType: string | null; linkedId: string | null }, refs: Map<string, string>) {
  if (t.linkedType === REQUEST_LINK && t.linkedId) return { relatedType: 'REQUEST', relatedId: refs.get(t.linkedId) ?? t.linkedId };
  if (t.linkedType) return { relatedType: t.linkedType.toUpperCase(), relatedId: t.linkedId ?? '' };
  return { relatedType: 'GENERAL', relatedId: '' };
}

export async function listThreads(ctx: LpContext, page: number, pageSize: number) {
  const where = threadWhere(ctx);
  const [rows, total] = await Promise.all([
    prisma.messageThread.findMany({
      where,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, select: { createdAt: true, fromClient: true, body: true } },
        reads: { where: { userId: ctx.userId } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.messageThread.count({ where }),
  ]);
  const [names, refs] = await Promise.all([fundNames(rows.map((t) => t.fundId)), relatedRefs(rows)]);
  const items: LpMessageThreadSummary[] = rows.map((t) => {
    const readAt = t.reads[0]?.readAt?.getTime() ?? 0;
    const last = t.messages[0];
    return {
      id: t.id,
      subject: t.title,
      fundId: t.fundId ?? '',
      fundName: t.fundId ? (names.get(t.fundId) ?? '') : '',
      ...related(t, refs),
      status: t.status,
      lastMessageAt: (t.lastMessageAt ?? last?.createdAt ?? t.createdAt).toISOString(),
      lastMessagePreview: last?.body.slice(0, 160) ?? '',
      unreadCount: t.messages.filter((m) => !m.fromClient && m.createdAt.getTime() > readAt).length,
    };
  });
  return { items, total };
}

async function findThread(ctx: LpContext, id: string) {
  const t = await prisma.messageThread.findFirst({
    where: { AND: [threadWhere(ctx), { id }] },
    include: { messages: { orderBy: { createdAt: 'asc' } }, reads: { where: { userId: ctx.userId } } },
  });
  if (!t) throw LpError.notFound('Thread');
  return t;
}

export async function getThread(ctx: LpContext, id: string): Promise<LpMessageThreadDetail> {
  const t = await findThread(ctx, id);
  const readAt = t.reads[0]?.readAt ?? null;
  const [names, refs, attachments] = await Promise.all([
    fundNames([t.fundId]),
    relatedRefs([t]),
    prisma.requestAttachment.findMany({ where: { clientId: ctx.client.id, threadMessageId: { in: t.messages.map((m) => m.id) } } }),
  ]);
  const participants = new Map<string, { name: string; initials: string; role: string }>();
  for (const m of t.messages) {
    const key = m.authorId ?? m.authorName;
    if (!participants.has(key)) participants.set(key, { name: m.authorName, initials: initials(m.authorName), role: m.fromClient ? 'Investor' : (t.ownerRole ?? 'Client Services') });
  }
  if (!participants.size) participants.set(t.ownerName, { name: t.ownerName, initials: initials(t.ownerName), role: t.ownerRole ?? 'Client Services' });
  return {
    id: t.id,
    subject: t.title,
    fundId: t.fundId ?? '',
    fundName: t.fundId ? (names.get(t.fundId) ?? '') : '',
    ...related(t, refs),
    status: t.status,
    participants: [...participants.values()],
    messages: t.messages.map((m) => ({
      id: m.id,
      authorType: m.fromClient ? 'INVESTOR' : 'INTERNAL',
      authorId: m.authorId ?? '',
      body: m.body,
      readAt: m.fromClient ? m.createdAt.toISOString() : readAt && readAt >= m.createdAt ? readAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      attachments: attachments.filter((a) => a.threadMessageId === m.id).map(attachmentView),
    })),
  };
}

export async function markThreadRead(ctx: LpContext, id: string) {
  const t = await findThread(ctx, id);
  const before = t.reads[0]?.readAt?.getTime() ?? 0;
  const markedRead = t.messages.filter((m) => !m.fromClient && m.createdAt.getTime() > before).length;
  const now = new Date();
  await prisma.messageRead.upsert({
    where: { threadId_userId: { threadId: t.id, userId: ctx.userId } },
    create: { threadId: t.id, userId: ctx.userId, readAt: now },
    update: { readAt: now },
  });
  return { threadId: t.id, markedRead };
}

export async function replyToThread(req: Request, ctx: LpContext, id: string) {
  const { body, attachmentIds } = replyBody(req);
  const t = await findThread(ctx, id);
  const linked =
    t.linkedType === REQUEST_LINK && t.linkedId
      ? await prisma.serviceRequest.findFirst({ where: { id: t.linkedId, clientId: ctx.client.id } })
      : null;
  const out = await prisma.$transaction(async (tx) => {
    const attachments = await claimAttachments(tx, ctx, attachmentIds);
    const now = new Date();
    const m = await tx.message.create({ data: { threadId: t.id, authorId: ctx.userId, authorName: actorName(req), fromClient: true, body } });
    await tx.messageThread.update({ where: { id: t.id }, data: { lastMessageAt: now, status: 'OPEN' } });
    await tx.messageRead.upsert({ where: { threadId_userId: { threadId: t.id, userId: ctx.userId } }, create: { threadId: t.id, userId: ctx.userId, readAt: now }, update: { readAt: now } });
    if (attachments.length) {
      await tx.requestAttachment.updateMany({ where: { id: { in: attachments } }, data: { threadMessageId: m.id, ...(linked ? { requestId: linked.id } : {}) } });
    }
    if (linked) await onInvestorReply(tx, linked, ctx, body);
    else {
      await enqueue(tx, 'notify.permission', {
        permission: 'clients.edit',
        type: 'message.received',
        title: `Message from ${ctx.client.name}`,
        body: t.title,
        link: '/?page=clients',
      });
    }
    await writeAudit(tx, lpAudit(req), { action: 'message.sent', objectType: 'message_thread', objectId: t.id, after: { messageId: m.id, attachments: attachments.length, via: 'lp-portal' } });
    const rows = attachments.length ? await tx.requestAttachment.findMany({ where: { id: { in: attachments } } }) : [];
    return { m, rows };
  });
  return { id: out.m.id, authorType: 'INVESTOR', body: out.m.body, attachments: out.rows.map(attachmentView), createdAt: out.m.createdAt.toISOString() };
}
