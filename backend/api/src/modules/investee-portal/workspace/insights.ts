import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import { workbook } from '../../../lib/xlsx';
import { deriveKpis } from '../investee.service';
import type { InvesteeContext } from '../investee.context';
import { isoDay } from './store';

// ---------------------------------------------------------------- global search

export interface SearchHit {
  type: 'document' | 'requisition' | 'consent' | 'cap_transaction' | 'meeting' | 'signature' | 'term_sheet';
  id: string;
  title: string;
  subtitle: string;
  page: string;
}

/** Searches this company's records only. Every query is scoped by the caller's company id. */
export async function searchWorkspace(companyId: string, q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) throw HttpError.badRequest('Type at least two characters');
  const like = { contains: term };
  const [docs, reqs, consents, txs, meetings, sigs, sheets, holders] = await Promise.all([
    prisma.document.findMany({ where: { companyId, OR: [{ name: like }, { ref: like }] }, take: 8, select: { id: true, ref: true, name: true, status: true } }),
    prisma.investeeRequisition.findMany({ where: { companyId, OR: [{ title: like }, { ref: like }] }, take: 8 }),
    prisma.investeeConsent.findMany({ where: { companyId, OR: [{ title: like }, { ref: like }] }, take: 8 }),
    prisma.investeeCapTx.findMany({ where: { companyId, ref: like }, take: 8 }),
    prisma.investeeBoardMeeting.findMany({ where: { companyId, OR: [{ title: like }, { ref: like }] }, take: 8 }),
    prisma.investeeSignRequest.findMany({ where: { companyId, OR: [{ title: like }, { ref: like }] }, take: 8 }),
    prisma.termSheet.findMany({ where: { companyId, status: { not: 'DRAFT' }, OR: [{ title: like }, { ref: like }] }, take: 8, select: { id: true, ref: true, title: true, status: true } }),
    prisma.investeeShareholder.findMany({ where: { companyId, name: like }, take: 8 }),
  ]);
  const hits: SearchHit[] = [
    ...docs.map((d) => ({ type: 'document' as const, id: d.id, title: d.name, subtitle: `${d.ref} - ${d.status}`, page: '/data-room' })),
    ...reqs.map((r) => ({ type: 'requisition' as const, id: r.ref, title: r.title, subtitle: `${r.ref} - ${r.status}`, page: '/requests' })),
    ...consents.map((r) => ({ type: 'consent' as const, id: r.ref, title: r.title, subtitle: `${r.ref} - ${r.status}`, page: '/governance' })),
    ...txs.map((t) => ({ type: 'cap_transaction' as const, id: t.ref, title: `${t.kind} ${t.shares.toString()} shares`, subtitle: `${t.ref} - ${t.status}`, page: '/cap-table' })),
    ...holders.map((h) => ({ type: 'cap_transaction' as const, id: h.id, title: h.name, subtitle: 'Shareholder', page: '/cap-table' })),
    ...meetings.map((m) => ({ type: 'meeting' as const, id: m.id, title: m.title, subtitle: `${m.ref} - ${isoDay(m.meetingAt)}`, page: '/governance' })),
    ...sigs.map((s) => ({ type: 'signature' as const, id: s.id, title: s.title, subtitle: `${s.ref} - ${s.status}`, page: '/signatures' })),
    ...sheets.map((t) => ({ type: 'term_sheet' as const, id: t.id, title: t.title, subtitle: `${t.ref} - ${t.status}`, page: '/terms' })),
  ];
  return hits;
}

// ---------------------------------------------------------------- derived KPIs and export

const COLUMNS = ['revenue', 'revenueGrowthPct', 'grossProfit', 'grossMarginPct', 'netProfit', 'netMarginPct', 'cashFlowNet', 'runwayMonths'] as const;
type Col = (typeof COLUMNS)[number];

export interface KpiHistoryRow {
  period: string;
  label: string;
  status: string;
  values: Record<Col, number | null>;
  /** Every numeric company KPI recorded for the period, keyed by KPI key (INO-009). */
  metrics: Record<string, number>;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export async function kpiHistory(companyId: string): Promise<KpiHistoryRow[]> {
  const periods = await prisma.reportingPeriod.findMany({
    where: { companyId, status: { in: ['submitted', 'accepted'] } },
    orderBy: { period: 'asc' },
    select: { period: true, label: true, status: true, kpiValues: true },
  });
  let prev: number | null = null;
  return periods.map((p) => {
    const raw = p.kpiValues && typeof p.kpiValues === 'object' && !Array.isArray(p.kpiValues) ? (p.kpiValues as Record<string, unknown>) : {};
    const d = deriveKpis(raw);
    const revenue = d.totalRevenue ?? null;
    const growth = revenue !== null && prev !== null && prev !== 0 ? r1(((revenue - prev) / Math.abs(prev)) * 100) : null;
    if (revenue !== null) prev = revenue;
    const metrics: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) metrics[k] = v;
    return {
      period: p.period,
      label: p.label,
      status: p.status,
      metrics,
      values: { revenue, revenueGrowthPct: growth, grossProfit: d.grossProfit ?? null, grossMarginPct: d.grossMargin ?? null, netProfit: d.netProfit ?? null, netMarginPct: d.netMargin ?? null, cashFlowNet: d.cashFlowNet ?? null, runwayMonths: d.runwayMonths ?? null },
    };
  });
}

function csvCell(v: string) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function kpiExport(companyId: string, format: 'csv' | 'xlsx') {
  const [rows, defs] = await Promise.all([kpiHistory(companyId), prisma.companyKpi.findMany({ where: { companyId }, orderBy: { sort: 'asc' } })]);
  // Derived columns first, then one column per company KPI definition with its label and unit.
  const table: string[][] = [
    ['period', 'status', ...COLUMNS, ...defs.map((d) => (d.unit ? `${d.label} (${d.unit})` : d.label))],
    ...rows.map((r) => [
      r.period,
      r.status,
      ...COLUMNS.map((c) => (r.values[c] === null ? '' : String(r.values[c]))),
      ...defs.map((d) => (r.metrics[d.key] === undefined ? '' : String(r.metrics[d.key]))),
    ]),
  ];
  if (format === 'xlsx') return { body: workbook('KPI history', table), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: 'kpi-history.xlsx' };
  return { body: Buffer.from(table.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8'), type: 'text/csv; charset=utf-8', name: 'kpi-history.csv' };
}

// ---------------------------------------------------------------- access and MFA coverage

export const accessReviewSchema = z.object({
  decisions: z.array(z.object({ userId: z.string().uuid(), decision: z.enum(['CERTIFIED', 'REVOKED']) })).min(1).max(100),
  note: z.string().trim().max(500).optional(),
});

export async function accessView(companyId: string) {
  const members = await prisma.companyUser.findMany({ where: { companyId }, include: { user: { select: { id: true, email: true, name: true, lastLoginAt: true } } }, orderBy: { createdAt: 'asc' } });
  const factors = await prisma.userMfaFactor.findMany({ where: { userId: { in: members.map((m) => m.userId) }, verifiedAt: { not: null } }, select: { userId: true } });
  const withMfa = new Set(factors.map((f) => f.userId));
  const reviews = await prisma.investeeAccessReview.findMany({ where: { companyId }, orderBy: { reviewedAt: 'desc' }, take: 10 });
  const rows = members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    profile: m.profile,
    title: m.title,
    status: m.status,
    mfa: withMfa.has(m.userId),
    lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
  }));
  const active = rows.filter((r) => r.status === 'active');
  const covered = active.filter((r) => r.mfa).length;
  const last = reviews[0];
  return {
    members: rows,
    coverage: { active: active.length, mfa: covered, pct: active.length ? Math.round((covered / active.length) * 100) : 0 },
    lastReview: last ? { id: last.id, reviewedAt: last.reviewedAt.toISOString(), mfaCovered: last.mfaCovered, mfaTotal: last.mfaTotal } : null,
    reviewDue: !last || Date.now() - last.reviewedAt.getTime() > 90 * 86_400_000,
    reviews: reviews.map((r) => ({ id: r.id, reviewedAt: r.reviewedAt.toISOString(), note: r.note, mfaCovered: r.mfaCovered, mfaTotal: r.mfaTotal, items: r.items })),
  };
}

export async function recordAccessReview(c: InvesteeContext, body: z.infer<typeof accessReviewSchema>, audit: AuditContext) {
  const companyId = c.company.id;
  await prisma.$transaction(async (tx) => {
    const members = await tx.companyUser.findMany({ where: { companyId, status: 'active' }, include: { user: { select: { email: true } } } });
    const byUser = new Map(body.decisions.map((d) => [d.userId, d.decision]));
    const missing = members.filter((m) => !byUser.has(m.userId));
    if (missing.length) throw HttpError.badRequest(`Decide every active member: ${missing.map((m) => m.user.email).join(', ')} still need a decision`);
    for (const id of byUser.keys()) if (!members.some((m) => m.userId === id)) throw HttpError.badRequest('A decision names someone who is not an active member');
    if (byUser.get(c.userId) === 'REVOKED') throw HttpError.badRequest('You cannot revoke your own access');
    const keptAdmins = members.filter((m) => m.profile === 'workspace_administrator' && byUser.get(m.userId) === 'CERTIFIED');
    if (!keptAdmins.length) throw HttpError.badRequest('At least one workspace administrator must keep access');
    const factors = await tx.userMfaFactor.findMany({ where: { userId: { in: members.map((m) => m.userId) }, verifiedAt: { not: null } }, select: { userId: true } });
    const withMfa = new Set(factors.map((f) => f.userId));
    const items = members.map((m) => ({ userId: m.userId, email: m.user.email, profile: m.profile, mfa: withMfa.has(m.userId), decision: byUser.get(m.userId)! }));
    const review = await tx.investeeAccessReview.create({
      data: { companyId, reviewerId: c.userId, note: body.note ?? null, items, mfaCovered: items.filter((i) => i.mfa).length, mfaTotal: items.length },
    });
    for (const i of items.filter((x) => x.decision === 'REVOKED')) {
      await tx.companyUser.update({ where: { companyId_userId: { companyId, userId: i.userId } }, data: { status: 'disabled' } });
      await tx.session.deleteMany({ where: { userId: i.userId } }).catch(() => undefined);
    }
    await writeAudit(tx, audit, { action: 'company.access_review.recorded', objectType: 'investee_access_review', objectId: review.id, after: { certified: items.filter((i) => i.decision === 'CERTIFIED').length, revoked: items.filter((i) => i.decision === 'REVOKED').length } });
  });
  return accessView(companyId);
}
