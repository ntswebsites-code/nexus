import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import type { InvesteeContext } from '../investee.context';
import { enqueue } from '../../../lib/outbox';
import { companyUserIds } from '../remainders/mail';
import { day, ensureWorkspace, isoDay, parseDay, refs, requireSigner, sha256 } from './store';
import { complianceHealth, noticeDaysFor, reservedMattersFor } from './compliance';

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export { forecastLockSchema, forecastSchema, forecastView, lockForecast, saveForecast, submitForecast, submittedForecastVersions } from './forecast';

// ---------------------------------------------------------------- governance

export const consentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  basis: z.string().trim().min(3).max(160),
  due: dayStr.refine((v) => v >= new Date().toISOString().slice(0, 10), { message: 'The decision date cannot be in the past' }).optional(),
  note: z.string().trim().max(2000).optional(),
});
export const consentDecisionSchema = z.object({ status: z.enum(['Approved', 'Declined']), note: z.string().trim().max(2000).optional() });
export const meetingSchema = z.object({
  title: z.string().trim().min(3).max(200),
  meetingAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)),
  location: z.string().trim().max(200).optional(),
  agenda: z.string().trim().max(8000).optional(),
});
export const meetingUpdateSchema = z.object({
  status: z.enum(['SCHEDULED', 'HELD', 'CANCELLED']).optional(),
  minutes: z.string().trim().max(20000).optional(),
  agenda: z.string().trim().max(8000).optional(),
  location: z.string().trim().max(200).optional(),
});
export const packItemSchema = z.object({ documentId: z.string().uuid(), label: z.string().trim().max(200).optional() });
export const boardActionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  owner: z.string().trim().min(1).max(120),
  due: dayStr.optional(),
  meetingId: z.string().uuid().optional(),
});
export const boardActionUpdateSchema = z.object({ status: z.enum(['OPEN', 'COMPLETE']), evidence: z.string().trim().max(300).optional() });

const consentView = (r: { ref: string; title: string; basis: string; submittedOn: Date; dueOn: Date; ownerName: string; status: string; note: string | null }) => ({
  id: r.ref,
  title: r.title,
  basis: r.basis,
  submitted: isoDay(r.submittedOn)!,
  due: isoDay(r.dueOn)!,
  owner: r.ownerName,
  status: r.status,
  note: r.note ?? '',
});

const actionView = (a: { id: string; title: string; ownerName: string; dueOn: Date | null; evidence: string | null; status: string; meetingId: string | null }) => ({
  id: a.id,
  title: a.title,
  owner: a.ownerName,
  due: isoDay(a.dueOn) ?? '',
  evidence: a.evidence ?? '',
  status: a.status === 'COMPLETE' ? 'Complete' : 'Open',
  meetingId: a.meetingId,
});

export async function meetingsView(companyId: string) {
  const rows = await prisma.investeeBoardMeeting.findMany({ where: { companyId }, orderBy: { meetingAt: 'desc' }, take: 50, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  const docs = await prisma.document.findMany({ where: { companyId, id: { in: rows.flatMap((m) => m.items.map((i) => i.documentId)) } }, select: { id: true, name: true } });
  const names = new Map(docs.map((d) => [d.id, d.name]));
  return rows.map((m) => ({
    id: m.id,
    ref: m.ref,
    title: m.title,
    meetingAt: m.meetingAt.toISOString(),
    location: m.location,
    status: m.status,
    agenda: m.agenda ?? '',
    minutes: m.minutes ?? '',
    packStatus: m.packStatus,
    packSha256: m.packSha256,
    packPublishedAt: m.packPublished?.toISOString() ?? null,
    pack: m.items.map((i) => ({ id: i.id, documentId: i.documentId, label: i.label, name: names.get(i.documentId) ?? '' })),
  }));
}

export async function governanceView(c: InvesteeContext) {
  const companyId = c.company.id;
  await ensureWorkspace(companyId);
  const [consents, actions, periods, meetings, reservedMatters, health] = await Promise.all([
    prisma.investeeConsent.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.investeeBoardAction.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.reportingPeriod.findMany({ where: { companyId, status: { in: ['open', 'returned'] } }, orderBy: { dueDate: 'asc' }, take: 4, select: { label: true, dueDate: true, status: true } }),
    meetingsView(companyId),
    reservedMattersFor(companyId),
    complianceHealth(companyId),
  ]);
  const consentRows = consents.map(consentView);
  const actionRows = actions.map(actionView);
  const calendar = [
    ...periods.map((p) => ({ title: p.label, due: isoDay(p.dueDate)!, status: isoDay(p.dueDate)! < day() ? `${p.status} - overdue` : p.status, kind: 'reporting' })),
    ...meetings.filter((m) => m.status === 'SCHEDULED').map((m) => ({ title: m.title, due: m.meetingAt.slice(0, 10), status: m.status.toLowerCase(), kind: 'board' })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  return {
    consents: consentRows,
    actions: actionRows,
    meetings,
    reservedMatters: reservedMatters.map(({ name, detail, noticeDays }) => ({ name, detail, noticeDays })),
    calendar,
    metrics: {
      pendingConsents: consentRows.filter((r) => r.status === 'Investor review').length,
      openActions: actionRows.filter((a) => a.status !== 'Complete').length,
      upcomingMeetings: meetings.filter((m) => m.status === 'SCHEDULED').length,
      complianceHealth: health,
    },
  };
}

export async function addConsent(c: InvesteeContext, body: z.infer<typeof consentSchema>, owner: string, audit: AuditContext) {
  await ensureWorkspace(c.company.id);
  await prisma.$transaction(async (tx) => {
    const row = await tx.investeeConsent.create({
      data: {
        ref: await refs.consent(tx),
        companyId: c.company.id,
        title: body.title,
        basis: body.basis,
        submittedOn: parseDay(day()),
        // BR-218: default decision date is the submission date plus the notice period of the matter
        dueOn: parseDay(body.due ?? day(new Date(Date.now() + (await noticeDaysFor(tx, c.company.id, body.basis)) * 86400000))),
        ownerId: c.userId,
        ownerName: owner.slice(0, 120),
        note: body.note ?? null,
      },
    });
    await writeAudit(tx, audit, { action: 'company.governance.consent_requested', objectType: 'investee_consent', objectId: row.id, after: { ref: row.ref, title: row.title } });
    await enqueue(tx, 'notify.permission', { permission: 'research.edit', type: 'investee.consent_requested', title: `${c.company.name} asks for investor consent (${row.ref})`, body: `${row.title} - due ${isoDay(row.dueOn)}`, link: '/ops/investee-requests' });
  });
  return governanceView(c);
}

export async function listConsentsForStaff() {
  const rows = await prisma.investeeConsent.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  const companies = await prisma.portfolioCompany.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, name: true, ref: true } });
  const byId = new Map(companies.map((x) => [x.id, x]));
  return rows.flatMap((r) => {
    const co = byId.get(r.companyId);
    return co ? [{ ...consentView(r), companyId: co.id, companyName: co.name, companyRef: co.ref }] : [];
  });
}

export async function decideConsent(companyId: string, consentRef: string, body: z.infer<typeof consentDecisionSchema>, audit: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.investeeConsent.findFirst({ where: { companyId, ref: consentRef } });
    if (!row) throw HttpError.notFound('Consent request not found');
    if (row.status !== 'Investor review') throw HttpError.conflict(`A consent in ${row.status} cannot be decided again`, 'invalid_state');
    const claim = await tx.investeeConsent.updateMany({
      where: { id: row.id, status: 'Investor review' },
      data: { status: body.status, note: body.note ?? row.note, decidedBy: audit.actorId, decidedAt: new Date() },
    });
    if (claim.count === 0) throw HttpError.conflict('This consent was just decided', 'invalid_state');
    await writeAudit(tx, audit, { action: 'company.governance.consent_decided', objectType: 'investee_consent', objectId: row.id, before: { status: row.status }, after: { status: body.status } });
    await enqueue(tx, 'notify.users', { userIds: await companyUserIds(companyId), type: 'investee.consent_decided', title: `Consent ${row.ref} ${body.status.toLowerCase()}`, body: `${row.title}${body.note ? ` - ${body.note}` : ''}`, link: '/workspace', email: true });
    return consentView({ ...row, status: body.status, note: body.note ?? row.note });
  });
}

export async function createMeeting(c: InvesteeContext, body: z.infer<typeof meetingSchema>, audit: AuditContext) {
  await ensureWorkspace(c.company.id);
  const at = new Date(body.meetingAt.length === 10 ? `${body.meetingAt}T09:00:00.000Z` : body.meetingAt.length === 16 ? `${body.meetingAt}:00.000Z` : body.meetingAt);
  if (Number.isNaN(at.getTime())) throw HttpError.badRequest('Meeting date is not valid');
  await prisma.$transaction(async (tx) => {
    const m = await tx.investeeBoardMeeting.create({ data: { ref: await refs.meeting(tx), companyId: c.company.id, title: body.title, meetingAt: at, location: body.location ?? null, agenda: body.agenda ?? null, createdBy: c.userId } });
    await writeAudit(tx, audit, { action: 'company.board.meeting_created', objectType: 'investee_board_meeting', objectId: m.id, after: { ref: m.ref, meetingAt: at.toISOString() } });
  });
  return meetingsView(c.company.id);
}

async function loadMeeting(companyId: string, id: string) {
  const m = await prisma.investeeBoardMeeting.findFirst({ where: { id, companyId } });
  if (!m) throw HttpError.notFound('Meeting not found');
  return m;
}

export async function updateMeeting(c: InvesteeContext, id: string, body: z.infer<typeof meetingUpdateSchema>, audit: AuditContext) {
  const m = await loadMeeting(c.company.id, id);
  await prisma.$transaction(async (tx) => {
    await tx.investeeBoardMeeting.update({ where: { id: m.id }, data: { ...(body.status ? { status: body.status } : {}), ...(body.minutes !== undefined ? { minutes: body.minutes } : {}), ...(body.agenda !== undefined ? { agenda: body.agenda } : {}), ...(body.location !== undefined ? { location: body.location } : {}) } });
    await writeAudit(tx, audit, { action: 'company.board.meeting_updated', objectType: 'investee_board_meeting', objectId: m.id, before: { status: m.status }, after: { status: body.status ?? m.status } });
  });
  return meetingsView(c.company.id);
}

export async function addPackItem(c: InvesteeContext, id: string, body: z.infer<typeof packItemSchema>, audit: AuditContext) {
  const m = await loadMeeting(c.company.id, id);
  if (m.packStatus !== 'DRAFT') throw HttpError.conflict('The pack is published and frozen', 'pack_frozen');
  const doc = await prisma.document.findFirst({ where: { id: body.documentId, companyId: c.company.id }, select: { id: true, name: true } });
  if (!doc) throw HttpError.notFound('Document not found in this workspace');
  await prisma.$transaction(async (tx) => {
    const count = await tx.investeeBoardPackItem.count({ where: { meetingId: m.id } });
    await tx.investeeBoardPackItem.upsert({
      where: { meetingId_documentId: { meetingId: m.id, documentId: doc.id } },
      create: { meetingId: m.id, documentId: doc.id, label: (body.label ?? doc.name).slice(0, 200), sortOrder: count },
      update: { label: (body.label ?? doc.name).slice(0, 200) },
    });
    await writeAudit(tx, audit, { action: 'company.board.pack_item_added', objectType: 'investee_board_meeting', objectId: m.id, after: { documentId: doc.id } });
  });
  return meetingsView(c.company.id);
}

export async function removePackItem(c: InvesteeContext, id: string, itemId: string, audit: AuditContext) {
  const m = await loadMeeting(c.company.id, id);
  if (m.packStatus !== 'DRAFT') throw HttpError.conflict('The pack is published and frozen', 'pack_frozen');
  await prisma.$transaction(async (tx) => {
    const r = await tx.investeeBoardPackItem.deleteMany({ where: { id: itemId, meetingId: m.id } });
    if (r.count === 0) throw HttpError.notFound('Pack item not found');
    await writeAudit(tx, audit, { action: 'company.board.pack_item_removed', objectType: 'investee_board_meeting', objectId: m.id, after: { itemId } });
  });
  return meetingsView(c.company.id);
}

/** Freezes the pack: records one hash over the current file hash of every item, in order. */
export async function publishPack(c: InvesteeContext, id: string, audit: AuditContext) {
  requireSigner(c, 'publish a board pack');
  const m = await loadMeeting(c.company.id, id);
  if (m.packStatus !== 'DRAFT') throw HttpError.conflict('The pack is already published', 'pack_frozen');
  const items = await prisma.investeeBoardPackItem.findMany({ where: { meetingId: m.id }, orderBy: { sortOrder: 'asc' } });
  if (!items.length) throw HttpError.badRequest('Add at least one document before publishing');
  const parts: string[] = [];
  for (const item of items) {
    const v = await prisma.documentVersion.findFirst({ where: { documentId: item.documentId }, orderBy: { version: 'desc' }, select: { sha256: true } });
    if (!v) throw HttpError.badRequest(`Document ${item.label} has no stored file`);
    parts.push(`${item.documentId}:${v.sha256}`);
  }
  const hash = sha256(parts.join('\n'));
  await prisma.$transaction(async (tx) => {
    const r = await tx.investeeBoardMeeting.updateMany({ where: { id: m.id, packStatus: 'DRAFT' }, data: { packStatus: 'PUBLISHED', packSha256: hash, packPublished: new Date() } });
    if (r.count === 0) throw HttpError.conflict('The pack is already published', 'pack_frozen');
    await writeAudit(tx, audit, { action: 'company.board.pack_published', objectType: 'investee_board_meeting', objectId: m.id, after: { items: items.length, sha256: hash } });
  });
  return meetingsView(c.company.id);
}

export async function createBoardAction(c: InvesteeContext, body: z.infer<typeof boardActionSchema>, audit: AuditContext) {
  if (body.meetingId) await loadMeeting(c.company.id, body.meetingId);
  await prisma.$transaction(async (tx) => {
    const a = await tx.investeeBoardAction.create({ data: { companyId: c.company.id, meetingId: body.meetingId ?? null, title: body.title, ownerName: body.owner, dueOn: body.due ? parseDay(body.due) : null } });
    await writeAudit(tx, audit, { action: 'company.board.action_created', objectType: 'investee_board_action', objectId: a.id, after: { title: a.title } });
  });
  return governanceView(c);
}

export async function updateBoardAction(c: InvesteeContext, id: string, body: z.infer<typeof boardActionUpdateSchema>, audit: AuditContext) {
  await prisma.$transaction(async (tx) => {
    const a = await tx.investeeBoardAction.findFirst({ where: { id, companyId: c.company.id } });
    if (!a) throw HttpError.notFound('Action not found');
    await tx.investeeBoardAction.update({ where: { id: a.id }, data: { status: body.status, ...(body.evidence !== undefined ? { evidence: body.evidence } : {}) } });
    await writeAudit(tx, audit, { action: 'company.board.action_updated', objectType: 'investee_board_action', objectId: a.id, before: { status: a.status }, after: { status: body.status } });
  });
  return governanceView(c);
}

// Requisitions (drawdown requests), the tranche ledger and reserved matters live in ./requisitions and ./compliance.
export {
  createRequisition,
  decideRequisition,
  decisionSchema,
  listRequisitionsForStaff,
  requisitionList,
  requisitionSchema,
  requisitionTranche,
  resubmitRequisition,
  resubmitSchema,
  setCommittedTranche,
  slaBreachedRequisitions,
  submitRequisitionDraft,
  trancheSchema,
} from './requisitions';
