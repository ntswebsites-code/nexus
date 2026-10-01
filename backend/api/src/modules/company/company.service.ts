import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { num } from '../../lib/http';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { storeFile } from '../../lib/storage';
import { renderPdf } from '../ops/pdf';
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

/** First and last calendar day (UTC) of a `YYYY-MM` period key. */
export function periodBounds(period: string) {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(y!, m! - 1, 1)), end: new Date(Date.UTC(y!, m!, 0)) };
}

export async function openPeriod(tx: Prisma.TransactionClient, companyId: string, period: string, due: Date, periodType = 'MONTHLY') {
  const { start, end } = periodBounds(period);
  return tx.reportingPeriod.create({
    data: {
      companyId,
      period,
      label: periodLabel(period),
      dueDate: due,
      periodType,
      periodStart: start,
      periodEnd: end,
      requestedAt: new Date(),
      status: 'open',
      items: { create: REPORTING_ITEMS.map((i, sort) => ({ ...i, sort })) },
    },
  });
}

/** The company the signed-in portal user belongs to (company users are linked, not role-based). */
export async function companyContext(req: Request) {
  return (await companyMembership(req)).company;
}

/** The caller's active company link (first by creation, or `?company=<ref>` when linked to several). */
export async function companyMembership(req: Request) {
  const requested = typeof req.query.company === 'string' ? req.query.company : undefined;
  const links = await prisma.companyUser.findMany({
    where: { userId: req.user!.id, status: 'active' },
    include: { company: true },
    orderBy: { createdAt: 'asc' },
  });
  const link = requested ? links.find((l) => l.company.ref === requested) : links[0];
  if (!link) throw HttpError.forbidden('This account is not linked to a portfolio company', 'no_company_access');
  return link;
}

// ---------------------------------------------------------------- access profiles (SRD 5D roles)

export const COMPANY_PROFILES = [
  'workspace_administrator',
  'executive_approver',
  'report_contributor',
  'kpi_owner',
  'finance_editor',
  'read_only',
] as const;
export type CompanyProfile = (typeof COMPANY_PROFILES)[number];

export type CompanyCapability = 'view' | 'edit_draft' | 'submit_pack' | 'submit_kpis' | 'sign' | 'post_messages' | 'manage_company';

const CAPABILITIES: Record<CompanyCapability, readonly CompanyProfile[]> = {
  view: COMPANY_PROFILES,
  edit_draft: ['workspace_administrator', 'executive_approver', 'report_contributor', 'finance_editor'],
  submit_pack: ['workspace_administrator', 'executive_approver'],
  submit_kpis: ['workspace_administrator', 'executive_approver', 'kpi_owner', 'finance_editor'],
  sign: ['workspace_administrator', 'executive_approver'],
  post_messages: ['workspace_administrator', 'executive_approver', 'report_contributor', 'kpi_owner', 'finance_editor'],
  manage_company: ['workspace_administrator'],
};

export function asProfile(value: string | null | undefined): CompanyProfile {
  return (COMPANY_PROFILES as readonly string[]).includes(value ?? '') ? (value as CompanyProfile) : 'read_only';
}

export function profileCan(profile: CompanyProfile, capability: CompanyCapability) {
  return CAPABILITIES[capability].includes(profile);
}

const CAPABILITY_TEXT: Record<CompanyCapability, string> = {
  view: 'view this workspace',
  edit_draft: 'edit report drafts',
  submit_pack: 'submit the reporting pack (approver or administrator only)',
  submit_kpis: 'submit period KPIs',
  sign: 'sign documents',
  post_messages: 'post messages',
  manage_company: 'change company settings (workspace administrator only)',
};

export function assertProfile(profile: CompanyProfile, capability: CompanyCapability) {
  if (!profileCan(profile, capability)) {
    throw HttpError.forbidden(`Your access profile does not allow you to ${CAPABILITY_TEXT[capability]}`, 'permission_denied');
  }
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

// ---------------------------------------------------------------- pack flow (shared by /company and /investee-portal)

export const EDITABLE_STATUSES = ['open', 'returned'];

export interface PackActor {
  userId: string;
  name: string;
  audit: AuditContext;
}

export async function loadPeriod(companyId: string, period: string) {
  const row = await prisma.reportingPeriod.findUnique({
    where: { companyId_period: { companyId, period } },
    include: periodInclude,
  });
  if (!row) throw HttpError.notFound('Reporting period not found');
  return row;
}

export function assertEditable(p: { status: string; label: string }) {
  if (!EDITABLE_STATUSES.includes(p.status)) {
    throw HttpError.conflict(`The ${p.label} pack is ${p.status} and can no longer be changed`, 'invalid_state');
  }
}

type KpiValues = Record<string, number | string | '' | Record<string, number>>;
export interface DraftInput {
  kpis?: KpiValues;
  notes?: string;
}

/** Attaches files to one pack item; the period must be editable and the extensions must match the item. */
export async function uploadItemFiles(actor: PackActor, period: PeriodRow, itemKey: string, files: Express.Multer.File[]) {
  assertEditable(period);
  const item = period.items.find((i) => i.key === itemKey);
  if (!item) throw HttpError.notFound('Reporting item not found');
  if (!files.length) throw HttpError.badRequest('Attach at least one file');
  const exts = item.accept.split(',').map((e) => e.trim().toLowerCase());
  const bad = files.find((f) => !exts.some((e) => f.originalname.toLowerCase().endsWith(e)));
  if (bad) throw HttpError.badRequest(`${bad.originalname} is not an accepted format (${item.accept})`);

  const created: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const f of files) {
      const stored = await storeFile({ name: f.originalname, mime: f.mimetype, data: f.buffer, uploadedById: actor.userId }, tx);
      const sub = await tx.reportingSubmission.create({
        data: { itemId: item.id, fileId: stored.id, name: stored.name, size: stored.size, uploadedById: actor.userId },
      });
      created.push(sub.id);
    }
    await tx.reportingItem.update({ where: { id: item.id }, data: { status: 'Complete' } });
    await writeAudit(tx, actor.audit, {
      action: 'reporting.files.uploaded',
      objectType: 'reporting_period',
      objectId: period.id,
      after: { item: item.key, files: files.map((f) => f.originalname) },
    });
  });
  return created;
}

function mergedKpis(period: PeriodRow, kpis?: KpiValues) {
  return kpis ? { kpiValues: { ...((period.kpiValues as object | null) ?? {}), ...kpis } } : {};
}

/** Saves KPI values and notes on an editable pack (optimistic version bump). */
export async function saveDraft(actor: PackActor, period: PeriodRow, input: DraftInput, auditAfter?: Record<string, unknown>) {
  assertEditable(period);
  await prisma.$transaction(async (tx) => {
    await tx.reportingPeriod.update({
      where: { id: period.id },
      data: {
        ...mergedKpis(period, input.kpis),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, actor.audit, {
      action: 'reporting.draft.saved',
      objectType: 'reporting_period',
      objectId: period.id,
      after: { kpis: input.kpis ? Object.keys(input.kpis) : undefined, notes: input.notes !== undefined, ...auditAfter },
    });
  });
}

function revenueOf(values: unknown): number | null {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const o = values as Record<string, unknown>;
  for (const key of ['totalRevenue', 'TOTAL_REVENUE', 'TOTAL_REVENUE_COMPUTED', 'IS.totalRevenue', 'IS.revenue']) {
    const n = typeof o[key] === 'number' ? o[key] : typeof o[key] === 'string' && o[key] !== '' ? Number(o[key]) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * BR-252: a drop of more than half versus the previous posted period needs an explanation
 * (a note of at least 20 characters, or a file whose name says variance or explanation).
 */
async function assertRevenueVariance(period: PeriodRow, input: DraftInput) {
  const merged = { ...((period.kpiValues as object | null) ?? {}), ...(input.kpis ?? {}) };
  const current = revenueOf(merged);
  if (current === null) return;
  const prior = await prisma.reportingPeriod.findFirst({
    where: { companyId: period.companyId, period: { lt: period.period }, status: { in: ['submitted', 'accepted'] } },
    orderBy: { period: 'desc' },
  });
  const previous = prior ? revenueOf(prior.kpiValues) : null;
  if (!previous || current >= previous * 0.5) return;
  const note = `${input.notes ?? ''} ${period.notes ?? ''} ${typeof (merged as Record<string, unknown>).varianceExplanationNote === 'string' ? (merged as Record<string, unknown>).varianceExplanationNote : ''}`.trim();
  const explained = period.items.some((item) => item.submissions.some((s) => /variance|explanation/i.test(s.name)));
  if (note.length < 20 && !explained) {
    throw HttpError.badRequest(
      'Variance validation: Revenue is more than 50% below the prior reporting period. Add a variance explanation of at least 20 characters, or attach a file whose name contains "variance" or "explanation".',
      { varianceExplanationNote: 'Required when revenue falls by more than half' },
    );
  }
}

/** Builds the file a required pack item is missing when the investee submits figures from the portal. */
function packFile(period: PeriodRow, item: { key: string; title: string; accept: string }) {
  const values = period.kpiValues && typeof period.kpiValues === 'object' ? (period.kpiValues as Record<string, unknown>) : {};
  const rows = Object.entries(values).filter(([, v]) => typeof v === 'number' || typeof v === 'string');
  if (item.accept.includes('.csv')) {
    const lines = ['metric,value', ...(rows.length ? rows.map(([k, v]) => `${k},${v}`) : ['note,submitted from the investee portal'])];
    return { name: `${period.period}-${item.key}.csv`, mime: 'text/csv', data: Buffer.from(`${lines.join('\n')}\n`) };
  }
  return {
    name: `${period.period}-${item.key}.pdf`,
    mime: 'application/pdf',
    data: renderPdf(
      `${period.label} · ${item.title}`,
      rows.length ? rows.slice(0, 24).map(([k, v]) => ({ text: `${k}: ${v}` })) : [{ text: 'Submitted from the investee portal.' }],
    ),
  };
}

async function attachGeneratedPackFiles(actor: PackActor, period: PeriodRow) {
  const missing = period.items.filter((i) => i.required && i.submissions.length === 0);
  if (!missing.length) return period;
  await prisma.$transaction(async (tx) => {
    for (const item of missing) {
      const file = packFile(period, item);
      const stored = await storeFile({ name: file.name, mime: file.mime, data: file.data, uploadedById: actor.userId }, tx);
      await tx.reportingSubmission.create({
        data: { itemId: item.id, fileId: stored.id, name: stored.name, size: stored.size, uploadedById: actor.userId },
      });
      await tx.reportingItem.update({ where: { id: item.id }, data: { status: 'Complete' } });
    }
    await writeAudit(tx, actor.audit, {
      action: 'reporting.files.generated',
      objectType: 'reporting_period',
      objectId: period.id,
      after: { items: missing.map((i) => i.key) },
    });
  });
  return loadPeriod(period.companyId, period.period);
}

export async function submitPack(actor: PackActor, company: { name: string }, period: PeriodRow, input: DraftInput) {
  assertEditable(period);
  period = await attachGeneratedPackFiles(actor, period);
  const missing = period.items.filter((i) => i.required && i.submissions.length === 0);
  if (missing.length) {
    throw HttpError.badRequest(`Still needed: ${missing.map((i) => i.title).join(', ')}`, { missing: missing.map((i) => i.key) });
  }
  await assertRevenueVariance(period, input);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.reportingPeriod.update({
      where: { id: period.id },
      data: {
        status: 'submitted',
        submittedAt: now,
        submittedById: actor.userId,
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
        reviewerName: null,
        ...mergedKpis(period, input.kpis),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        version: { increment: 1 },
      },
    });
    await tx.reportingSubmission.updateMany({
      where: { itemId: { in: period.items.map((i) => i.id) }, status: { in: ['Draft', 'Returned'] } },
      data: { status: 'Submitted' },
    });
    await writeAudit(tx, actor.audit, {
      action: 'reporting.pack.submitted',
      objectType: 'reporting_period',
      objectId: period.id,
      before: { status: period.status },
      after: { status: 'submitted', period: period.period },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'research.edit',
      type: 'reporting.submitted',
      title: `${company.name} · ${period.label} pack submitted`,
      body: `${actor.name} submitted the ${period.label} reporting pack for review.`,
      link: '/?page=private-markets',
    });
  });
}
