import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { num } from '../../lib/http';
import { fmtDate, fmtDay, fmtShort, fmtSize, fmtTime } from '../../lib/format';

/** Monthly pack template (SRD 8.4). Items are copied onto each period when it is opened. */
export const REPORTING_ITEMS = [
  { key: 'accounts', title: 'Management accounts', detail: 'Income statement, balance sheet and cashflow in USD.', required: true, accept: '.pdf,.xlsx,.xls' },
  { key: 'kpis', title: 'Operating KPIs', detail: 'Revenue, customers, churn and transaction volume workbook.', required: true, accept: '.xlsx,.xls,.csv' },
  { key: 'debt', title: 'Debt & cash', detail: 'Bank balances, facilities and maturity schedule.', required: true, accept: '.pdf,.xlsx' },
  { key: 'board', title: 'Board pack', detail: 'Latest approved board materials.', required: false, accept: '.pdf' },
  { key: 'compliance', title: 'Compliance certificates', detail: 'Tax, insurance and key licences.', required: true, accept: '.pdf,.jpg,.png' },
] as const;

export function periodLabel(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function monthName(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
}

export async function openPeriod(tx: Prisma.TransactionClient, companyId: string, period: string, due: Date) {
  return tx.reportingPeriod.create({
    data: {
      companyId,
      period,
      label: periodLabel(period),
      dueDate: due,
      status: 'open',
      items: { create: REPORTING_ITEMS.map((i, sort) => ({ ...i, sort })) },
    },
  });
}

/** The company the signed-in portal user belongs to (company users are linked, not role-based). */
export async function companyContext(req: Request) {
  const link = await prisma.companyUser.findFirst({
    where: { userId: req.user!.id },
    include: { company: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!link) throw HttpError.forbidden('This account is not linked to a portfolio company', 'no_company_access');
  return link.company;
}

type CompanyRow = Prisma.PortfolioCompanyGetPayload<object>;

export function companyView(c: CompanyRow) {
  return {
    id: c.ref,
    name: c.name,
    legalName: c.legalName,
    ticker: c.ticker,
    sector: c.sector,
    country: c.country,
    founded: c.founded,
    employees: c.employees,
    website: c.website ?? '',
    address: c.address ?? '',
    relationship: c.relationship,
    contacts: c.contacts,
  };
}

export const periodInclude = {
  items: { orderBy: { sort: 'asc' }, include: { submissions: { orderBy: { createdAt: 'asc' } } } },
} satisfies Prisma.ReportingPeriodInclude;
export type PeriodRow = Prisma.ReportingPeriodGetPayload<{ include: typeof periodInclude }>;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function periodSummary(p: { period: string; label: string; dueDate: Date; status: string }) {
  return { id: p.period, label: p.label, due: isoDay(p.dueDate), status: p.status };
}

export function periodDetail(p: PeriodRow) {
  return {
    ...periodSummary(p),
    uuid: p.id,
    kpis: (p.kpiValues as Record<string, number | ''> | null) ?? {},
    notes: p.notes ?? '',
    submittedAt: p.submittedAt,
    reviewer: p.reviewerName,
    reviewedAt: p.reviewedAt,
    reviewNote: p.reviewNote,
    version: p.version,
    items: p.items.map((i) => ({
      id: i.key,
      title: i.title,
      detail: i.detail,
      required: i.required,
      accept: i.accept,
      status: i.status,
      files: i.submissions.map((s) => ({ id: s.id, name: s.name, size: s.size, status: s.status })),
    })),
  };
}

export function historyEntry(p: { period: string; label: string; submittedAt: Date | null; status: string; reviewerName: string | null; reviewNote: string | null }) {
  return {
    id: p.period,
    label: p.label,
    submitted: p.submittedAt ? `${fmtDate(p.submittedAt)} ${fmtTime(p.submittedAt)} CAT` : '—',
    status: p.status,
    reviewer: p.reviewerName ?? '—',
    note: p.reviewNote ?? (p.status === 'submitted' ? 'Awaiting review by the investment team.' : ''),
  };
}

export const questionInclude = { messages: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.ReportingQuestionInclude;
type QuestionRow = Prisma.ReportingQuestionGetPayload<{ include: typeof questionInclude }>;

/** `viewer` decides which side is "me". */
export function questionView(q: QuestionRow, viewer: 'company' | 'staff') {
  return {
    id: q.ref,
    title: q.title,
    from: q.fromName,
    role: q.fromRole,
    opened: fmtDate(q.createdAt),
    status: q.status,
    messages: q.messages.map((m) => ({
      who: (viewer === 'company') === m.fromCompany ? 'me' : 'them',
      name: viewer === 'company' && m.fromCompany ? 'You' : m.authorName,
      at: `${fmtShort(m.createdAt)} · ${fmtTime(m.createdAt)} CAT`,
      text: m.body,
    })),
  };
}

export function kpiView(k: Prisma.CompanyKpiGetPayload<object>) {
  return { id: k.key, label: k.label, unit: k.unit, prev: num(k.prev)!, budget: num(k.budget)!, invert: k.invert, series: k.series as number[] };
}

export function covenantView(c: Prisma.CovenantGetPayload<object>) {
  return {
    id: c.key,
    name: c.name,
    threshold: c.threshold,
    actual: num(c.actual)!,
    limit: num(c.limit)!,
    unit: c.unit,
    headroom: Number.parseFloat(c.headroom) || 0,
    evidence: c.evidence,
    ...(c.note ? { note: c.note } : {}),
  };
}

const LIBRARY_KINDS = new Set(['guide', 'template', 'legal', 'board']);

/** Everything the company portal renders, in the shapes of portals/company-web/src/data/company.ts. */
export async function workspace(companyId: string, viewer: 'company' | 'staff') {
  const [company, periods, kpis, covenants, questions, library] = await Promise.all([
    prisma.portfolioCompany.findUniqueOrThrow({ where: { id: companyId } }),
    prisma.reportingPeriod.findMany({ where: { companyId }, orderBy: { period: 'desc' } }),
    prisma.companyKpi.findMany({ where: { companyId }, orderBy: { sort: 'asc' } }),
    prisma.covenant.findMany({ where: { companyId }, orderBy: { sort: 'asc' } }),
    prisma.reportingQuestion.findMany({ where: { companyId }, include: questionInclude, orderBy: { createdAt: 'desc' } }),
    prisma.document.findMany({
      where: { companyId, classification: { in: ['Client', 'Public'] }, status: { in: ['Approved', 'Published'] } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const sizes = new Map(
    (
      await prisma.fileObject.findMany({
        where: { id: { in: library.flatMap((d) => d.versions.map((v) => v.fileId)) } },
        select: { id: true, size: true },
      })
    ).map((f) => [f.id, f.size]),
  );

  const activity: { at: string; text: string; ts: number }[] = [];
  for (const q of questions) {
    const last = q.messages.at(-1);
    if (last) activity.push({ ts: last.createdAt.getTime(), at: fmtDay(last.createdAt), text: `${last.fromCompany ? 'You replied' : `${q.fromName} wrote`} on ${q.title} (${q.ref}).` });
  }
  for (const p of periods) {
    if (p.reviewedAt) activity.push({ ts: p.reviewedAt.getTime(), at: fmtDay(p.reviewedAt), text: `${p.label} pack marked ${p.status === 'accepted' ? 'Accepted' : 'Returned'}.` });
    else if (p.submittedAt) activity.push({ ts: p.submittedAt.getTime(), at: fmtDay(p.submittedAt), text: `${p.label} pack submitted for review.` });
  }
  const open = periods.find((p) => p.status === 'open' || p.status === 'returned');
  const deadlines = [
    ...(open ? [{ when: fmtShort(open.dueDate), title: `${monthName(open.period)} reporting pack due`, tone: 'due' as const }] : []),
    ...covenants
      .filter((c) => c.evidence === 'expiring' && c.note && /\d{1,2} \w{3}/.test(c.note))
      .map((c) => ({ when: c.note!.match(/\d{1,2} \w{3}/)![0], title: `${c.name} renewal`, tone: 'soon' as const })),
  ];

  return {
    company: companyView(company),
    periods: periods.map(periodSummary),
    kpiDefs: kpis.map(kpiView),
    covenants: covenants.map(covenantView),
    cashRunway: (company.cashRunway as number[] | null) ?? [],
    volumeSeries: (company.volumeSeries as number[] | null) ?? [],
    threads: questions.map((q) => questionView(q, viewer)),
    history: periods.filter((p) => p.status !== 'open').map(historyEntry),
    activity: activity.sort((a, b) => b.ts - a.ts).slice(0, 6).map(({ at, text }) => ({ at, text })),
    deadlines,
    library: library.map((d) => ({
      id: d.ref,
      kind: LIBRARY_KINDS.has(d.label ?? '') ? d.label : d.type === 'legal' ? 'legal' : /board/i.test(d.name) ? 'board' : /template/i.test(d.name) ? 'template' : 'guide',
      title: d.name,
      date: fmtDate(d.documentDate ?? d.createdAt),
      size: fmtSize(d.versions[0] ? sizes.get(d.versions[0].fileId) : null),
    })),
  };
}
