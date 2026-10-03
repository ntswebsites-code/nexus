import { z } from 'zod';
import { createHash } from 'node:crypto';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import { enqueue } from '../../../lib/outbox';
import { capTableView, capTransactions, certificatesView } from '../workspace/cap';
import { forecastView } from '../workspace/records';
import { ensureWorkspace, isoDay } from '../workspace/store';
import { companyUserIds } from './mail';

/**
 * Staff-side read and review of what a portfolio company keeps in its workspace: cap table, forecast and governance.
 * Reading is research.view; recording a review (or a query back to the company) is research.edit. A review pins the
 * SHA-256 of the data the reviewer saw, so a later change to the data shows as "changed since review".
 */
export const AREAS = ['CAP_TABLE', 'FORECAST', 'GOVERNANCE'] as const;
export type Area = (typeof AREAS)[number];

export const reviewSchema = z.object({
  area: z.enum(AREAS),
  outcome: z.enum(['REVIEWED', 'QUERIED']),
  note: z.string().trim().max(1000).optional(),
  /** The snapshot hash the screen showed; the review is refused when the data moved since. */
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function companyOrThrow(companyId: string) {
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId } });
  if (!company) throw HttpError.notFound('Company not found');
  return company;
}

export async function capData(companyId: string) {
  const company = await companyOrThrow(companyId);
  await ensureWorkspace(companyId);
  const [view, transactions, certificates] = await Promise.all([capTableView(company), capTransactions(companyId), certificatesView(companyId)]);
  const snapshot = {
    shareholders: view.shareholders.map((s) => [s.name, s.type, s.shares]),
    classes: view.classes.map((k) => [k.name, k.outstanding]),
    transactions: transactions.map((t) => [t.id, t.kind, t.status, t.shares]),
    certificates: certificates.map((c) => [c.id, c.sha256]),
  };
  const outstanding = view.shareholders.reduce((s, r) => s + r.shares, 0);
  return {
    company: { id: company.id, ref: company.ref, name: company.name },
    cap: view,
    transactions,
    certificates,
    snapshotSha256: hash(snapshot),
    summary: { derived: view.derived, shareholders: view.shareholders.length, outstandingShares: outstanding, pendingTransactions: view.pendingTransactions, certificates: certificates.length },
  };
}

export async function forecastData(companyId: string) {
  const company = await companyOrThrow(companyId);
  const f = await forecastView(companyId);
  const snapshot = { scenario: f.scenario, forecast: f.forecast, actuals: f.actuals, locked: f.lockedPeriods };
  return {
    company: { id: company.id, ref: company.ref, name: company.name },
    forecast: f,
    snapshotSha256: hash(snapshot),
    summary: { scenario: f.scenario, forecastMonths: Object.values(f.forecast).filter((v) => v !== null).length, lockedMonths: f.lockedPeriods.length, activeRevenue: Math.round(f.activeRevenue) },
  };
}

export async function governanceData(companyId: string) {
  const company = await companyOrThrow(companyId);
  await ensureWorkspace(companyId);
  const [consents, meetings, actions] = await Promise.all([
    prisma.investeeConsent.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.investeeBoardMeeting.findMany({ where: { companyId }, orderBy: { meetingAt: 'desc' }, take: 50, include: { _count: { select: { items: true } } } }),
    prisma.investeeBoardAction.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const view = {
    consents: consents.map((r) => ({ ref: r.ref, title: r.title, basis: r.basis, submitted: isoDay(r.submittedOn), due: isoDay(r.dueOn), owner: r.ownerName, status: r.status, note: r.note ?? '' })),
    meetings: meetings.map((m) => ({ ref: m.ref, title: m.title, meetingAt: m.meetingAt.toISOString(), status: m.status, packStatus: m.packStatus, packSha256: m.packSha256, packItems: m._count.items })),
    actions: actions.map((a) => ({ id: a.id, title: a.title, owner: a.ownerName, due: isoDay(a.dueOn), status: a.status })),
  };
  const snapshot = { consents: view.consents.map((r) => [r.ref, r.status]), meetings: view.meetings.map((m) => [m.ref, m.status, m.packSha256]), actions: view.actions.map((a) => [a.id, a.status]) };
  return {
    company: { id: company.id, ref: company.ref, name: company.name },
    ...view,
    snapshotSha256: hash(snapshot),
    summary: {
      pendingConsents: view.consents.filter((r) => r.status === 'Investor review').length,
      upcomingMeetings: view.meetings.filter((m) => m.status === 'SCHEDULED').length,
      openActions: view.actions.filter((a) => a.status !== 'COMPLETE').length,
    },
  };
}

type ReviewRow = Awaited<ReturnType<typeof prisma.investeeStaffReview.findMany>>[number];
const reviewView = (r: ReviewRow) => ({ id: r.id, area: r.area, outcome: r.outcome, note: r.note, snapshotSha256: r.snapshotSha256, summary: r.summary, reviewer: r.reviewerName, createdAt: r.createdAt.toISOString() });

const AREA_DATA: Record<Area, (companyId: string) => Promise<{ snapshotSha256: string; summary: object }>> = { CAP_TABLE: capData, FORECAST: forecastData, GOVERNANCE: governanceData };

/** Reviews with a flag saying whether the data has moved since the latest review of each area. */
export async function reviews(companyId: string) {
  await companyOrThrow(companyId);
  const rows = await prisma.investeeStaffReview.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const latest: Record<string, ReturnType<typeof reviewView> & { changedSince: boolean }> = {};
  for (const area of AREAS) {
    const r = rows.find((x) => x.area === area);
    if (r) latest[area] = { ...reviewView(r), changedSince: (await AREA_DATA[area](companyId)).snapshotSha256 !== r.snapshotSha256 };
  }
  return { latest, history: rows.map(reviewView) };
}

/** Idempotent: the same reviewer reviewing the same data snapshot again returns the existing row. */
export async function recordReview(companyId: string, reviewer: { id: string; name: string }, body: z.infer<typeof reviewSchema>, audit: AuditContext) {
  const company = await companyOrThrow(companyId);
  const data = await AREA_DATA[body.area](companyId);
  if (body.snapshotSha256 && body.snapshotSha256 !== data.snapshotSha256) throw HttpError.conflict('The company data changed after you opened it. Reload and review again.', 'data_changed');
  if (body.outcome === 'QUERIED' && !body.note) throw HttpError.badRequest('Say what you want the company to clarify');
    const existing = await prisma.investeeStaffReview.findUnique({ where: { companyId_area_snapshotSha256_reviewerId: { companyId, area: body.area, snapshotSha256: data.snapshotSha256, reviewerId: reviewer.id } } });
  if (existing) return reviewView(existing);
  const key = { companyId_area_snapshotSha256_reviewerId: { companyId, area: body.area, snapshotSha256: data.snapshotSha256, reviewerId: reviewer.id } };
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.investeeStaffReview.create({
      data: { companyId, area: body.area, outcome: body.outcome, note: body.note ?? null, snapshotSha256: data.snapshotSha256, summary: data.summary, reviewerId: reviewer.id, reviewerName: reviewer.name.slice(0, 120) },
    });
    await writeAudit(tx, audit, { action: 'investee.staff_review.recorded', objectType: 'investee_staff_review', objectId: r.id, after: { companyId, area: r.area, outcome: r.outcome, snapshotSha256: r.snapshotSha256 } });
    if (body.outcome === 'QUERIED') {
      await enqueue(tx, 'notify.users', {
        userIds: await companyUserIds(companyId),
        type: 'investee.review_queried',
        title: `${company.name}: the investment team has a question on your ${body.area.replace('_', ' ').toLowerCase()}`,
        body: body.note,
        link: '/workspace',
        email: true,
      });
    }
    return r;
  }).catch(async (error: { code?: string }) => {
    if (error?.code === 'P2002') return prisma.investeeStaffReview.findUniqueOrThrow({ where: key }); // a concurrent identical request won
    throw error;
  });
  return reviewView(row);
}

export async function companiesOverview() {
  const companies = await prisma.portfolioCompany.findMany({ orderBy: { ref: 'asc' }, take: 200, select: { id: true, ref: true, name: true, status: true, reportingCurrency: true } });
  const ids = companies.map((c) => c.id);
  const [pendingTx, consents, reqs, lastReviews, signoffs] = await Promise.all([
    prisma.investeeCapTx.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, status: 'PENDING_APPROVAL' }, _count: { _all: true } }),
    prisma.investeeConsent.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, status: 'Investor review' }, _count: { _all: true } }),
    prisma.investeeRequisition.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, status: 'SUBMITTED' }, _count: { _all: true } }),
    prisma.investeeStaffReview.groupBy({ by: ['companyId', 'area'], where: { companyId: { in: ids } }, _max: { createdAt: true } }),
    prisma.investeeReportSignoff.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, status: 'REQUESTED' }, _count: { _all: true } }),
  ]);
  const count = (rows: { companyId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.companyId === id)?._count._all ?? 0;
  return companies.map((c) => ({
    ...c,
    pendingCapTransactions: count(pendingTx, c.id),
    pendingConsents: count(consents, c.id),
    submittedRequests: count(reqs, c.id),
    openSignoffs: count(signoffs, c.id),
    lastReviews: Object.fromEntries(lastReviews.filter((r) => r.companyId === c.id).map((r) => [r.area, r._max.createdAt?.toISOString() ?? null])),
  }));
}
