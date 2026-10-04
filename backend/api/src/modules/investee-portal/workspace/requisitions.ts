import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import { nextRef } from '../../../lib/refs';
import type { InvesteeContext } from '../investee.context';
import { enqueue } from '../../../lib/outbox';
import { companyUserIds } from '../remainders/mail';
import { D, ensureWorkspace, isoDay, parseDay } from './store';
import { SLA_HOURS, assertWithinTranche, requisitionFingerprint, trancheLedger } from './drawdown';

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------- requisitions (drawdown requests)

export const requisitionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  type: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  currency: z.string().trim().length(3).optional(),
  amount: z.number().finite().nonnegative().optional(),
  needBy: dayStr.optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
  draft: z.boolean().optional(),
});
/** Edits applied when a returned or rejected request is resubmitted (BR-273). */
export const resubmitSchema = requisitionSchema.omit({ draft: true }).partial();
export const decisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'RETURNED', 'RFQ_SENT', 'CONVERTED_TO_PO', 'FULFILLED']),
  note: z.string().trim().max(2000).optional(),
  poRef: z.string().trim().min(1).max(40).optional(),
});
export const trancheSchema = z.object({ totalCommittedAmount: z.number().finite().min(0).max(1e13) });

type ReqRow = Awaited<ReturnType<typeof prisma.investeeRequisition.findMany>>[number];

/** Whole hours a request has waited for VC executive review (SUBMITTED only). */
const waitingHours = (r: Pick<ReqRow, 'status' | 'submittedAt' | 'createdAt'>, now = Date.now()) =>
  r.status === 'SUBMITTED' ? Math.floor((now - (r.submittedAt ?? r.createdAt).getTime()) / 3600000) : null;

const requisitionView = (r: ReqRow) => {
  const hours = waitingHours(r);
  return {
    id: r.ref,
    title: r.title,
    description: r.description ?? '',
    status: r.status,
    priority: r.priority,
    sourcingCategory: r.category,
    currency: r.currency,
    estimatedAmount: r.amount.toNumber(),
    needBy: isoDay(r.needBy) ?? '',
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    note: r.note ?? '',
    submittedAt: r.submittedAt?.toISOString() ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rfqSentAt: r.rfqSentAt?.toISOString() ?? null,
    poRef: r.poRef,
    hoursPending: hours,
    slaBreached: (hours ?? 0) >= SLA_HOURS,
    canResubmit: r.status === 'RETURNED' || r.status === 'REJECTED',
  };
};

export async function requisitionList(companyId: string) {
  await ensureWorkspace(companyId);
  const rows = await prisma.investeeRequisition.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map(requisitionView);
}

/** The tranche panel: committed, reserved, available and approved-to-date (FR-CMP-035). */
export const requisitionTranche = (companyId: string) => trancheLedger(companyId);

const fingerprintOf = (r: Pick<ReqRow, 'title' | 'description' | 'category' | 'currency' | 'amount' | 'needBy' | 'priority'>) =>
  requisitionFingerprint({ ...r, needBy: isoDay(r.needBy) });

export async function createRequisition(c: InvesteeContext, body: z.infer<typeof requisitionSchema>, owner: string, audit: AuditContext) {
  await ensureWorkspace(c.company.id);
  const row = await prisma.$transaction(async (tx) => {
    const amount = body.amount ?? 0;
    if (!body.draft) await assertWithinTranche(tx, c.company.id, amount);
    const data = {
      ref: await nextRef(tx, 'request'),
      companyId: c.company.id,
      title: body.title,
      description: body.description ?? null,
      category: `${body.type ?? 'Capital request'}: ${body.category ?? 'Growth capital'}`.slice(0, 180),
      currency: (body.currency ?? c.company.reportingCurrency ?? 'USD').toUpperCase(),
      amount: new D(amount),
      needBy: body.needBy ? parseDay(body.needBy) : null,
      priority: body.priority ?? 'Medium',
      status: body.draft ? 'DRAFT' : 'SUBMITTED',
      createdById: c.userId,
      createdByName: owner.slice(0, 120),
    };
    const created = await tx.investeeRequisition.create({
      data: { ...data, ...(body.draft ? {} : { submittedAt: new Date(), fingerprint: fingerprintOf(data) }) },
    });
    await writeAudit(tx, audit, { action: 'company.requisition.created', objectType: 'investee_requisition', objectId: created.id, after: { ref: created.ref, status: created.status, amount: created.amount.toString() } });
    if (created.status === 'SUBMITTED') {
      await enqueue(tx, 'notify.permission', { permission: 'research.edit', type: 'investee.requisition_submitted', title: `${c.company.name} submitted request ${created.ref}`, body: `${created.title} - ${created.currency} ${created.amount.toString()}`, link: '/ops/investee-requests' });
    }
    return created;
  });
  return requisitionView(row);
}

async function ownRequisition(c: InvesteeContext, ref: string) {
  const row = await prisma.investeeRequisition.findFirst({ where: { companyId: c.company.id, ref } });
  if (!row) throw HttpError.notFound('Request not found');
  return row;
}

/** Submits a saved draft: same tranche check and SLA clock as a direct submission. */
export async function submitRequisitionDraft(c: InvesteeContext, ref: string, audit: AuditContext) {
  const row = await ownRequisition(c, ref);
  if (row.createdById !== c.userId) throw HttpError.forbidden('Only the person who created this request can submit it', 'permission_denied');
  if (row.status !== 'DRAFT') throw HttpError.conflict(`A ${row.status} request cannot be submitted`, 'invalid_state');
  return prisma.$transaction(async (tx) => {
    await assertWithinTranche(tx, c.company.id, row.amount.toNumber(), row.id);
    const now = new Date();
    const claim = await tx.investeeRequisition.updateMany({ where: { id: row.id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedAt: now, fingerprint: fingerprintOf(row) } });
    if (claim.count === 0) throw HttpError.conflict('This request was just submitted', 'invalid_state');
    await writeAudit(tx, audit, { action: 'company.requisition.submitted', objectType: 'investee_requisition', objectId: row.id, before: { status: 'DRAFT' }, after: { status: 'SUBMITTED' } });
    await enqueue(tx, 'notify.permission', { permission: 'research.edit', type: 'investee.requisition_submitted', title: `${c.company.name} submitted request ${row.ref}`, body: `${row.title} - ${row.currency} ${row.amount.toString()}`, link: '/ops/investee-requests' });
    return requisitionView({ ...row, status: 'SUBMITTED', submittedAt: now });
  });
}

/**
 * BR-273: only the requester may resubmit a returned or rejected request, and the content fingerprint (header and
 * amount) must differ from the one that was reviewed.
 */
export async function resubmitRequisition(c: InvesteeContext, ref: string, body: z.infer<typeof resubmitSchema>, audit: AuditContext) {
  const row = await ownRequisition(c, ref);
  if (row.createdById !== c.userId) throw HttpError.forbidden('Only the person who made this request can resubmit it', 'permission_denied');
  if (row.status !== 'RETURNED' && row.status !== 'REJECTED') throw HttpError.conflict(`A ${row.status} request cannot be resubmitted`, 'invalid_state');
  const [oldType = 'Capital request', ...oldCategory] = row.category.split(': ');
  const next = {
    title: body.title ?? row.title,
    description: body.description ?? row.description,
    category: body.type || body.category ? `${body.type ?? oldType}: ${body.category ?? (oldCategory.join(': ') || 'Growth capital')}`.slice(0, 180) : row.category,
    currency: (body.currency ?? row.currency).toUpperCase(),
    amount: new D(body.amount ?? row.amount.toNumber()),
    needBy: body.needBy ? parseDay(body.needBy) : row.needBy,
    priority: body.priority ?? row.priority,
  };
  const fp = fingerprintOf(next);
  if (fp === row.fingerprint) {
    throw new HttpError(409, 'unchanged_resubmission', 'Change the request before resubmitting it; the content is the same as the version that was reviewed');
  }
  return prisma.$transaction(async (tx) => {
    await assertWithinTranche(tx, c.company.id, next.amount.toNumber(), row.id);
    const now = new Date();
    const claim = await tx.investeeRequisition.updateMany({
      where: { id: row.id, status: row.status },
      data: { ...next, status: 'SUBMITTED', fingerprint: fp, submittedAt: now, decidedBy: null, decidedAt: null, note: null },
    });
    if (claim.count === 0) throw HttpError.conflict('This request was just resubmitted', 'invalid_state');
    await writeAudit(tx, audit, {
      action: 'company.requisition.resubmitted',
      objectType: 'investee_requisition',
      objectId: row.id,
      before: { status: row.status, fingerprint: row.fingerprint },
      after: { status: 'SUBMITTED', fingerprint: fp, amount: next.amount.toString() },
    });
    await enqueue(tx, 'notify.permission', { permission: 'research.edit', type: 'investee.requisition_submitted', title: `${c.company.name} resubmitted request ${row.ref}`, body: `${next.title} - ${next.currency} ${next.amount.toString()}`, link: '/ops/investee-requests' });
    return requisitionView({ ...row, ...next, status: 'SUBMITTED', submittedAt: now, note: null });
  });
}

export async function listRequisitionsForStaff(opts: { slaOnly?: boolean } = {}) {
  const rows = await prisma.investeeRequisition.findMany({ where: { status: opts.slaOnly ? 'SUBMITTED' : { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, take: 500 });
  const companies = await prisma.portfolioCompany.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, name: true, ref: true } });
  const byId = new Map(companies.map((x) => [x.id, x]));
  const out = rows.flatMap((r) => {
    const co = byId.get(r.companyId);
    return co ? [{ ...requisitionView(r), companyId: co.id, companyName: co.name, companyRef: co.ref }] : [];
  });
  return opts.slaOnly ? out.filter((r) => r.slaBreached).sort((a, b) => (b.hoursPending ?? 0) - (a.hoursPending ?? 0)) : out;
}

/** BR-230: requests waiting for VC executive review for 48 hours or more. */
export const slaBreachedRequisitions = () => listRequisitionsForStaff({ slaOnly: true });

const TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ['APPROVED', 'REJECTED', 'RETURNED'],
  APPROVED: ['RFQ_SENT', 'FULFILLED'],
  RFQ_SENT: ['CONVERTED_TO_PO'],
  CONVERTED_TO_PO: ['FULFILLED'],
};

export async function decideRequisition(companyId: string, requestRef: string, body: z.infer<typeof decisionSchema>, audit: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.investeeRequisition.findFirst({ where: { companyId, ref: requestRef } });
    if (!row) throw HttpError.notFound('Request not found');
    if (!TRANSITIONS[row.status]?.includes(body.status)) throw HttpError.conflict(`A ${row.status} request cannot move to ${body.status}`, 'invalid_state');
    if (body.status === 'RETURNED' && !body.note) throw HttpError.badRequest('Give the reason the request is returned, so the company knows what to change');
    const now = new Date();
    const stamps = {
      ...(body.status === 'APPROVED' ? { approvedAt: now } : {}),
      ...(body.status === 'RFQ_SENT' ? { rfqSentAt: now, rfqNote: body.note ?? null } : {}),
      ...(body.status === 'CONVERTED_TO_PO' ? { convertedAt: now, poRef: body.poRef ?? null } : {}),
    };
    const claim = await tx.investeeRequisition.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: body.status, note: body.note ?? row.note, decidedBy: audit.actorId, decidedAt: now, ...stamps },
    });
    if (claim.count === 0) throw HttpError.conflict('This request was just decided', 'invalid_state');
    await writeAudit(tx, audit, { action: 'company.requisition.decided', objectType: 'investee_requisition', objectId: row.id, before: { status: row.status }, after: { status: body.status } });
    await enqueue(tx, 'notify.users', {
      userIds: [...new Set([row.createdById, ...(await companyUserIds(companyId))])],
      type: 'investee.requisition_decided',
      title: `Request ${row.ref} ${body.status.toLowerCase().replace(/_/g, ' ')}`,
      body: `${row.title}${body.note ? ` - ${body.note}` : ''}`,
      link: '/workspace',
      email: true,
    });
    return requisitionView({ ...row, status: body.status, note: body.note ?? row.note, ...stamps });
  });
}

/** Staff sets the company's total committed tranche (BR-270). Audited; idempotent in the route. */
export async function setCommittedTranche(companyId: string, body: z.infer<typeof trancheSchema>, audit: AuditContext) {
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId }, select: { id: true, totalCommittedAmount: true } });
  if (!company) throw HttpError.notFound('Company not found');
  await prisma.$transaction(async (tx) => {
    await tx.portfolioCompany.update({ where: { id: companyId }, data: { totalCommittedAmount: new D(body.totalCommittedAmount) } });
    await writeAudit(tx, audit, {
      action: 'company.tranche.committed_set',
      objectType: 'portfolio_company',
      objectId: companyId,
      before: { totalCommittedAmount: company.totalCommittedAmount?.toString() ?? null },
      after: { totalCommittedAmount: String(body.totalCommittedAmount) },
    });
  });
  return trancheLedger(companyId);
}
