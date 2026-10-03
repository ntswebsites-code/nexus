import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import { nextRef } from '../../../lib/refs';
import type { InvesteeContext } from '../investee.context';
import { enqueue } from '../../../lib/outbox';
import { companyUserIds } from '../remainders/mail';
import { D, day, ensureWorkspace, isoDay, parseDay, refs, requireSigner, sha256 } from './store';

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthStr = z.string().regex(/^\d{4}-\d{2}$/);

// ---------------------------------------------------------------- forecast

export const forecastSchema = z.object({
  scenario: z.enum(['Base case', 'Upside', 'Downside']).optional(),
  revenue: z.record(monthStr, z.number().finite()).optional(),
});
export const forecastLockSchema = z.object({ periods: z.array(monthStr).min(1).max(24) });

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function rollingMonths(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  return Array.from({ length: 12 }, (_, index) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const stage = index < 3 ? 'actual-locked' : index === 3 ? 'actual-open' : 'forecast';
    const label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { key, label, stage };
  });
}

export async function forecastView(companyId: string) {
  const ws = await ensureWorkspace(companyId);
  const [cells, locks, periods] = await Promise.all([
    prisma.investeeForecastCell.findMany({ where: { companyId, metric: 'revenue' } }),
    prisma.investeeForecastLock.findMany({ where: { companyId } }),
    prisma.reportingPeriod.findMany({ where: { companyId }, select: { period: true, status: true, kpiValues: true } }),
  ]);
  const stored = new Map(cells.map((c) => [c.period, c.value.toNumber()]));
  const locked = new Set(locks.map((l) => l.period));
  const actuals: Record<string, number | null> = {};
  for (const period of periods) {
    const revenue = num(asObject(period.kpiValues)?.totalRevenue);
    if (revenue !== null && (period.status === 'submitted' || period.status === 'accepted')) actuals[period.period] = revenue;
  }
  const months = rollingMonths().map((m) => ({ ...m, locked: locked.has(m.key) }));
  const forecast: Record<string, number | null> = {};
  for (const m of months) if (m.stage !== 'actual-locked') forecast[m.key] = stored.get(m.key) ?? null;
  const actualTotal = Object.values(actuals).reduce<number>((s, v) => s + (v ?? 0), 0);
  const forecastTotal = Object.values(forecast).reduce<number>((s, v) => s + (v ?? 0), 0);
  const scale = ws.forecastScenario === 'Upside' ? 1.15 : ws.forecastScenario === 'Downside' ? 0.8 : 1;
  return {
    scenario: ws.forecastScenario,
    months,
    actuals,
    forecast,
    lockedPeriods: [...locked].sort(),
    scenarios: {
      'Base case': { revenue: actualTotal + forecastTotal, note: 'Board working plan' },
      Upside: { revenue: (actualTotal + forecastTotal) * 1.15, note: 'Accelerated growth' },
      Downside: { revenue: (actualTotal + forecastTotal) * 0.8, note: 'Liquidity stress' },
    },
    activeRevenue: (actualTotal + forecastTotal) * scale,
  };
}

export async function saveForecast(c: InvesteeContext, body: z.infer<typeof forecastSchema>, audit: AuditContext) {
  const companyId = c.company.id;
  await ensureWorkspace(companyId);
  await prisma.$transaction(async (tx) => {
    const cells = Object.entries(body.revenue ?? {});
    if (cells.length) {
      const locked = await tx.investeeForecastLock.findMany({ where: { companyId, period: { in: cells.map(([p]) => p) } } });
      if (locked.length) throw HttpError.conflict(`${locked.map((l) => l.period).join(', ')} is locked and cannot be edited`, 'period_locked');
    }
    if (body.scenario) await tx.investeeWorkspace.update({ where: { companyId }, data: { forecastScenario: body.scenario } });
    for (const [period, value] of cells) {
      await tx.investeeForecastCell.upsert({
        where: { companyId_period_metric: { companyId, period, metric: 'revenue' } },
        create: { companyId, period, metric: 'revenue', value: new D(value), updatedBy: c.userId },
        update: { value: new D(value), updatedBy: c.userId },
      });
    }
    await writeAudit(tx, audit, { action: 'company.forecast.saved', objectType: 'investee_forecast', objectId: companyId, after: { scenario: body.scenario ?? null, cells: cells.length } });
  });
  return forecastView(companyId);
}

export async function lockForecast(c: InvesteeContext, body: z.infer<typeof forecastLockSchema>, lock: boolean, audit: AuditContext) {
  requireSigner(c, lock ? 'lock forecast months' : 'unlock forecast months');
  if (!lock && c.profile !== 'workspace_administrator') throw HttpError.forbidden('Only a workspace administrator can unlock a month', 'permission_denied');
  const companyId = c.company.id;
  await ensureWorkspace(companyId);
  await prisma.$transaction(async (tx) => {
    for (const period of body.periods) {
      if (lock) {
        await tx.investeeForecastLock.upsert({ where: { companyId_period: { companyId, period } }, create: { companyId, period, lockedBy: c.userId }, update: {} });
      } else {
        await tx.investeeForecastLock.deleteMany({ where: { companyId, period } });
      }
    }
    await writeAudit(tx, audit, { action: lock ? 'company.forecast.locked' : 'company.forecast.unlocked', objectType: 'investee_forecast', objectId: companyId, after: { periods: body.periods } });
  });
  return forecastView(companyId);
}

// ---------------------------------------------------------------- governance

export const consentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  basis: z.string().trim().min(3).max(160),
  due: dayStr.optional(),
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

const RESERVED_MATTERS = [
  { name: 'New debt', detail: 'Borrowing above the agreed facility, or security over company assets.' },
  { name: 'Share capital', detail: 'Issue, transfer, buyback or a change to the option pool.' },
  { name: 'Acquisitions', detail: 'A material acquisition or disposal.' },
  { name: 'Executive changes', detail: 'Appointment, dismissal or a material remuneration change.' },
  { name: 'Annual budget', detail: 'The annual budget and changes above the agreed tolerance.' },
] as const;

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
  const [consents, actions, periods, meetings] = await Promise.all([
    prisma.investeeConsent.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.investeeBoardAction.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.reportingPeriod.findMany({ where: { companyId, status: { in: ['open', 'returned'] } }, orderBy: { dueDate: 'asc' }, take: 4, select: { label: true, dueDate: true, status: true } }),
    meetingsView(companyId),
  ]);
  const consentRows = consents.map(consentView);
  const actionRows = actions.map(actionView);
  const calendar = [
    ...periods.map((p) => ({ title: p.label, due: isoDay(p.dueDate)!, status: p.status, kind: 'reporting' })),
    ...meetings.filter((m) => m.status === 'SCHEDULED').map((m) => ({ title: m.title, due: m.meetingAt.slice(0, 10), status: m.status.toLowerCase(), kind: 'board' })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  return {
    consents: consentRows,
    actions: actionRows,
    meetings,
    reservedMatters: RESERVED_MATTERS,
    calendar,
    metrics: {
      pendingConsents: consentRows.filter((r) => r.status === 'Investor review').length,
      openActions: actionRows.filter((a) => a.status !== 'Complete').length,
      upcomingMeetings: meetings.filter((m) => m.status === 'SCHEDULED').length,
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
        dueOn: parseDay(body.due ?? day(new Date(Date.now() + 14 * 86400000))),
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

// ---------------------------------------------------------------- requisitions

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
export const decisionSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'FULFILLED']), note: z.string().trim().max(2000).optional() });

type ReqRow = Awaited<ReturnType<typeof prisma.investeeRequisition.findMany>>[number];
const requisitionView = (r: ReqRow) => ({
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
});

export async function requisitionList(companyId: string) {
  await ensureWorkspace(companyId);
  const rows = await prisma.investeeRequisition.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map(requisitionView);
}

export async function createRequisition(c: InvesteeContext, body: z.infer<typeof requisitionSchema>, owner: string, audit: AuditContext) {
  await ensureWorkspace(c.company.id);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.investeeRequisition.create({
      data: {
        ref: await nextRef(tx, 'request'),
        companyId: c.company.id,
        title: body.title,
        description: body.description ?? null,
        category: `${body.type ?? 'Capital request'}: ${body.category ?? 'Growth capital'}`.slice(0, 180),
        currency: (body.currency ?? c.company.reportingCurrency ?? 'USD').toUpperCase(),
        amount: new D(body.amount ?? 0),
        needBy: body.needBy ? parseDay(body.needBy) : null,
        priority: body.priority ?? 'Medium',
        status: body.draft ? 'DRAFT' : 'SUBMITTED',
        createdById: c.userId,
        createdByName: owner.slice(0, 120),
      },
    });
    await writeAudit(tx, audit, { action: 'company.requisition.created', objectType: 'investee_requisition', objectId: created.id, after: { ref: created.ref, status: created.status, amount: created.amount.toString() } });
    if (created.status === 'SUBMITTED') {
      await enqueue(tx, 'notify.permission', { permission: 'research.edit', type: 'investee.requisition_submitted', title: `${c.company.name} submitted request ${created.ref}`, body: `${created.title} - ${created.currency} ${created.amount.toString()}`, link: '/ops/investee-requests' });
    }
    return created;
  });
  return requisitionView(row);
}

export async function listRequisitionsForStaff() {
  const rows = await prisma.investeeRequisition.findMany({ where: { status: { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, take: 500 });
  const companies = await prisma.portfolioCompany.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, name: true, ref: true } });
  const byId = new Map(companies.map((x) => [x.id, x]));
  return rows.flatMap((r) => {
    const co = byId.get(r.companyId);
    return co ? [{ ...requisitionView(r), companyId: co.id, companyName: co.name, companyRef: co.ref }] : [];
  });
}

export async function decideRequisition(companyId: string, requestRef: string, body: z.infer<typeof decisionSchema>, audit: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.investeeRequisition.findFirst({ where: { companyId, ref: requestRef } });
    if (!row) throw HttpError.notFound('Request not found');
    const allowed: Record<string, string[]> = { SUBMITTED: ['APPROVED', 'REJECTED'], APPROVED: ['FULFILLED'] };
    if (!allowed[row.status]?.includes(body.status)) throw HttpError.conflict(`A ${row.status} request cannot move to ${body.status}`, 'invalid_state');
    const claim = await tx.investeeRequisition.updateMany({ where: { id: row.id, status: row.status }, data: { status: body.status, note: body.note ?? row.note, decidedBy: audit.actorId, decidedAt: new Date() } });
    if (claim.count === 0) throw HttpError.conflict('This request was just decided', 'invalid_state');
    await writeAudit(tx, audit, { action: 'company.requisition.decided', objectType: 'investee_requisition', objectId: row.id, before: { status: row.status }, after: { status: body.status } });
    await enqueue(tx, 'notify.users', { userIds: [...new Set([row.createdById, ...(await companyUserIds(companyId))])], type: 'investee.requisition_decided', title: `Request ${row.ref} ${body.status.toLowerCase()}`, body: `${row.title}${body.note ? ` - ${body.note}` : ''}`, link: '/workspace', email: true });
    return requisitionView({ ...row, status: body.status, note: body.note ?? row.note });
  });
}
