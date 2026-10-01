import { Prisma, type PortfolioCompany, type User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { signedDownloadUrl } from '../../lib/storage';
import { EDITABLE_STATUSES, periodInclude, profileCan, type CompanyProfile, type PeriodRow } from '../company/company.service';
import { INVESTEE_VISIBLE, SIGNABLE } from '../term-sheets/term-sheets.service';
import { capabilities, type InvesteeContext } from './investee.context';
import type { DraftKind, InvesteeCompany, InvesteeFinancialReport, InvesteeLetterhead, InvesteeReportingRequest } from './investee.contract';
import { iso, isoDay } from './investee.http';

// ---------------------------------------------------------------- profile

export async function mfaEnabled(userId: string) {
  return (await prisma.userMfaFactor.count({ where: { userId, verifiedAt: { not: null } } })) > 0;
}

export function splitName(name: string | null | undefined, email: string) {
  const full = (name ?? '').trim() || email.split('@')[0]!;
  const [first, ...rest] = full.split(/\s+/);
  return { firstName: first ?? full, lastName: rest.join(' '), name: full };
}

export function profileView(user: User, c: InvesteeContext, mfa: boolean) {
  const n = splitName(user.name, user.email);
  return {
    id: user.id,
    firstName: n.firstName,
    lastName: n.lastName,
    email: user.email,
    userDepartment: c.title,
    roleCode: c.profile,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    name: n.name,
    accessProfile: c.profile,
    title: c.title,
    signingAuthority: c.signingAuthority,
    mfaEnabled: mfa,
    capabilities: capabilities(c.profile),
    company: { id: c.company.ref, name: c.company.name },
  };
}

// ---------------------------------------------------------------- company + letterhead

interface Contact {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
}

/** `portfolio_companies.letterhead` JSON: letterhead fields, `logoFileId`, and `_profile` (description, socials). */
export interface LetterheadJson {
  legalName?: string;
  registrationNumber?: string | null;
  taxNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  line1?: string;
  line2?: string | null;
  city?: string;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
  addressLabel?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  logoFileId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _profile?: { description?: string | null; socialMedia?: Record<string, string> | null };
}

export const letterheadJson = (c: PortfolioCompany): LetterheadJson =>
  c.letterhead && typeof c.letterhead === 'object' && !Array.isArray(c.letterhead) ? (c.letterhead as LetterheadJson) : {};

export const contactsOf = (c: PortfolioCompany): Contact[] => (Array.isArray(c.contacts) ? (c.contacts as Contact[]) : []);

const relationshipOf = (c: PortfolioCompany) =>
  (c.relationship && typeof c.relationship === 'object' && !Array.isArray(c.relationship) ? c.relationship : {}) as Record<string, unknown>;

export function investedAmount(c: PortfolioCompany): number {
  const v = relationshipOf(c).invested;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!m) return 0;
    const n = Number(m[0]);
    return /m\b/i.test(v) ? n * 1_000_000 : /k\b/i.test(v) ? n * 1_000 : n;
  }
  return 0;
}

function companySize(employees: number | null) {
  if (employees === null) return null;
  if (employees < 10) return '1-9';
  if (employees < 50) return '10-49';
  if (employees < 250) return '50-249';
  return '250+';
}

/** `{ [periodEnd]: { KEY: number } }` from submitted/accepted periods (numeric values only). */
export async function financialKpis(companyId: string) {
  const periods = await prisma.reportingPeriod.findMany({
    where: { companyId, status: { in: ['submitted', 'accepted'] } },
    orderBy: { period: 'asc' },
  });
  const out: Record<string, Record<string, number>> = {};
  for (const p of periods) {
    const values = (p.kpiValues as Record<string, unknown> | null) ?? {};
    const numeric = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
    if (Object.keys(numeric).length) out[isoDay(p.periodEnd) ?? `${p.period}-01`] = numeric;
  }
  return { kpiValues: out };
}

export async function companyPayload(c: PortfolioCompany): Promise<InvesteeCompany> {
  const lh = letterheadJson(c);
  const primary = contactsOf(c)[0] ?? {};
  const [fund, kpis] = await Promise.all([
    c.fundId ? prisma.fund.findUnique({ where: { id: c.fundId }, select: { name: true } }) : Promise.resolve(null),
    financialKpis(c.id),
  ]);
  const relFund = relationshipOf(c).fund;
  return {
    id: c.ref,
    userId: null,
    name: c.name,
    registrationNumber: c.registrationNumber,
    industry: c.industry ?? c.sector,
    foundingDate: c.founded ? `${c.founded}-01-01` : null,
    address: c.address,
    website: c.website,
    description: lh._profile?.description ?? null,
    logoUrl: lh.logoFileId ? signedDownloadUrl(lh.logoFileId, 300) : null,
    status: c.status,
    companySize: companySize(c.employees),
    employeeCount: c.employees,
    annualRevenue: null,
    fundingStage: c.fundingStage,
    contactPerson: primary.name ?? null,
    contactPhone: primary.phone ?? null,
    contactEmail: primary.email ?? null,
    socialMedia: lh._profile?.socialMedia ?? null,
    fundId: c.fundId,
    startDate: null,
    endDate: null,
    capTable: null,
    financialKpis: kpis,
    financialHistoryExcel: null,
    eSign: null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    fund: fund ? { name: fund.name } : typeof relFund === 'string' ? { name: relFund } : null,
    legalName: c.legalName,
    ticker: c.ticker,
    sector: c.sector,
    country: c.country,
    reportingCurrency: c.reportingCurrency,
    version: c.version,
  };
}

/** The caller's letterhead; defaults are derived from the company record until one is saved. */
export function letterheadView(c: PortfolioCompany): InvesteeLetterhead {
  const lh = letterheadJson(c);
  return {
    id: `${c.ref}-letterhead`,
    portfolioCompanyId: c.ref,
    legalName: lh.legalName ?? c.legalName,
    registrationNumber: lh.registrationNumber ?? c.registrationNumber ?? null,
    taxNumber: lh.taxNumber ?? null,
    email: lh.email ?? null,
    phone: lh.phone ?? null,
    website: lh.website ?? c.website ?? null,
    logoUrl: lh.logoFileId ? signedDownloadUrl(lh.logoFileId, 300) : null,
    line1: lh.line1 ?? c.address ?? '',
    line2: lh.line2 ?? null,
    city: lh.city ?? '',
    state: lh.state ?? null,
    postalCode: lh.postalCode ?? null,
    country: lh.country ?? c.country,
    addressLabel: lh.addressLabel ?? null,
    twitter: lh.twitter ?? null,
    facebook: lh.facebook ?? null,
    linkedin: lh.linkedin ?? null,
    instagram: lh.instagram ?? null,
    createdAt: lh.createdAt ?? c.createdAt.toISOString(),
    updatedAt: lh.updatedAt ?? c.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- reporting

const SLOT_TYPE: Record<string, InvesteeFinancialReport['reportType']> = {
  accounts: 'MANAGEMENT_ACCOUNTS',
  kpis: 'OPERATIONAL_KPIS',
  debt: 'DEBT_AND_CASH',
  board: 'BOARD_PACK',
  compliance: 'COMPLIANCE_CERTIFICATES',
};

export const DRAFT_SLOT: Record<DraftKind, string> = {
  'income-statement': 'accounts',
  'balance-sheet': 'accounts',
  'cash-flow': 'accounts',
  'operational-kpis': 'kpis',
};

export const DRAFT_PREFIX: Record<DraftKind, string> = {
  'income-statement': 'IS',
  'balance-sheet': 'BS',
  'cash-flow': 'CF',
  'operational-kpis': 'OK',
};

const REQUEST_STATUS = { open: 'OPEN', returned: 'RETURNED', submitted: 'SUBMITTED', accepted: 'ACCEPTED' } as const;
const PORTAL_STATUS = { open: 'REPORTING_OPEN', returned: 'CHANGES_REQUESTED', submitted: 'SUBMITTED', accepted: 'ACCEPTED' } as const;
const REPORT_STATUS = { open: 'DRAFT', returned: 'NEEDS_REVISION', submitted: 'SUBMITTED', accepted: 'ACCEPTED' } as const;
type PStatus = keyof typeof REQUEST_STATUS;
const pstatus = (s: string): PStatus => (s in REQUEST_STATUS ? (s as PStatus) : 'open');

const formats = (accept: string) => accept.split(',').map((e) => e.trim().replace(/^\./, '').toUpperCase());
const fileView = (s: PeriodRow['items'][number]['submissions'][number]) => ({ id: s.id, name: s.name, size: s.size, status: s.status });

export function reportingRequestView(p: PeriodRow, company: PortfolioCompany, profile: CompanyProfile): InvesteeReportingRequest {
  const status = pstatus(p.status);
  const editable = EDITABLE_STATUSES.includes(p.status);
  return {
    id: p.id,
    portfolioCompanyId: company.ref,
    companyName: company.name,
    reportingPeriod: p.period,
    dueDate: isoDay(p.dueDate)!,
    lastRequestedAt: iso(p.requestedAt ?? p.createdAt),
    status: REQUEST_STATUS[status],
    portalStatus: PORTAL_STATUS[status],
    mandatoryAttachments: p.items.map((i) => ({
      name: i.title,
      formats: formats(i.accept),
      key: i.key,
      reportId: i.id,
      required: i.required,
      status: i.status,
      files: i.submissions.map(fileView),
    })),
    label: p.label,
    periodType: p.periodType,
    periodStart: isoDay(p.periodStart),
    periodEnd: isoDay(p.periodEnd),
    submittedAt: iso(p.submittedAt),
    reviewedAt: iso(p.reviewedAt),
    reviewerName: p.reviewerName,
    reviewNote: p.reviewNote,
    kpis: (p.kpiValues as Record<string, number | ''> | null) ?? {},
    notes: p.notes ?? '',
    version: p.version,
    canEdit: editable && profileCan(profile, 'edit_draft'),
    canSubmit: editable && profileCan(profile, 'submit_pack'),
  };
}

function kpiNumber(values: Record<string, unknown>, keys: string[]) {
  for (const k of keys) if (typeof values[k] === 'number') return values[k] as number;
  return null;
}

export function financialReportView(p: PeriodRow, item: PeriodRow['items'][number], company: PortfolioCompany, profile: CompanyProfile) {
  const status = pstatus(p.status);
  const editable = EDITABLE_STATUSES.includes(p.status);
  const values = (p.kpiValues as Record<string, unknown> | null) ?? {};
  const isAccounts = item.key === 'accounts';
  return {
    id: item.id,
    portfolioCompanyId: company.ref,
    companyName: company.name,
    reportType: SLOT_TYPE[item.key] ?? 'OTHER',
    periodType: p.periodType,
    periodStart: isoDay(p.periodStart),
    periodEnd: isoDay(p.periodEnd),
    reportingPeriod: p.period,
    title: `${item.title} · ${p.label}`,
    description: item.detail,
    reportUrl: null,
    fileUrl: null,
    storagePath: null,
    templateVersion: 'nexus-v1',
    status: REPORT_STATUS[status],
    totalRevenue: isAccounts ? kpiNumber(values, ['totalRevenue', 'IS.totalRevenue', 'IS.revenue']) : null,
    netProfit: isAccounts ? kpiNumber(values, ['netProfit', 'IS.netProfit']) : null,
    cashFlowNet: isAccounts ? kpiNumber(values, ['cashFlowNet', 'CF.netCashFlow', 'CF.cashFlowNet']) : null,
    reviewerId: p.reviewedById,
    reviewedAt: iso(p.reviewedAt),
    reviewerComment: p.reviewNote,
    isDraft: editable,
    canSubmit: editable && profileCan(profile, 'submit_pack'),
    canUploadFile: editable && profileCan(profile, 'edit_draft'),
    canDownload: item.submissions.length > 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    slot: item.key,
    required: item.required,
    accept: item.accept,
    files: item.submissions.map(fileView),
  } satisfies InvesteeFinancialReport;
}

/** Numeric values stored on the period for one report slot (accounts: IS./BS./CF. + totals; kpis: OK. + register keys). */
export function reportData(p: PeriodRow, slot: string): Record<string, number> {
  const values = (p.kpiValues as Record<string, unknown> | null) ?? {};
  const accounts = (k: string) => /^(IS|BS|CF)\./.test(k) || ['totalRevenue', 'netProfit', 'cashFlowNet'].includes(k);
  const keep = slot === 'accounts' ? accounts : slot === 'kpis' ? (k: string) => !accounts(k) : () => false;
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => typeof v === 'number' && keep(k))) as Record<string, number>;
}

export async function companyPeriods(companyId: string) {
  return prisma.reportingPeriod.findMany({ where: { companyId }, include: periodInclude, orderBy: { period: 'desc' } });
}

/** A report (= pack item) by id, scoped to the caller's company. */
export async function loadReport(companyId: string, reportId: string) {
  const item = await prisma.reportingItem.findFirst({ where: { id: reportId, period: { companyId } }, select: { periodId: true } });
  if (!item) throw HttpError.notFound('Report not found');
  const period = await prisma.reportingPeriod.findUniqueOrThrow({ where: { id: item.periodId }, include: periodInclude });
  return { period, item: period.items.find((i) => i.id === reportId)! };
}

/** `YYYY-MM`, `YYYY-MM-DD` or a period start date -> `YYYY-MM`. */
export function periodKey(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    const m = c?.trim().match(/^(\d{4})-(\d{2})(-\d{2})?/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  return null;
}

export const NUMERIC_ERROR = 'Invalid Input: Please enter a numerical value for this KPI.';

/** Flattens draft data into prefixed numeric KPI values. Blank -> 0; anything non-numeric is rejected. */
export function flattenDraft(kind: DraftKind, data: Record<string, unknown>) {
  const prefix = DRAFT_PREFIX[kind];
  const out: Record<string, number> = {};
  const bad: string[] = [];
  for (const [key, raw] of Object.entries(data)) {
    let value: number;
    if (raw === '' || raw === null || raw === undefined) value = 0;
    else if (typeof raw === 'number') value = raw;
    else if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.replace(/,/g, '').trim())) value = Number(raw.replace(/,/g, ''));
    else {
      bad.push(key);
      continue;
    }
    if (!Number.isFinite(value)) bad.push(key);
    else out[`${prefix}.${key.slice(0, 60)}`] = value;
  }
  if (bad.length) throw HttpError.badRequest(NUMERIC_ERROR, bad.map((path) => ({ path, message: NUMERIC_ERROR })));
  if (kind === 'balance-sheet') {
    const a = out['BS.totalAssets'];
    const l = out['BS.totalLiabilities'];
    const e = out['BS.totalEquity'];
    if (a !== undefined && l !== undefined && e !== undefined && Math.abs(a - (l + e)) > 0.02) {
      throw HttpError.badRequest('Balance sheet does not balance: total assets must equal total liabilities plus equity', [
        { path: 'totalAssets', message: 'Assets must equal liabilities plus equity' },
      ]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- dashboard

export async function dashboardView(c: InvesteeContext) {
  const company = c.company;
  const [periods, termSheets, openThreads, notifications, latestTs] = await Promise.all([
    prisma.reportingPeriod.findMany({ where: { companyId: company.id }, select: { period: true, label: true, status: true, dueDate: true } }),
    prisma.termSheet.groupBy({ by: ['status'], where: { companyId: company.id, status: { in: INVESTEE_VISIBLE } }, _count: true }),
    prisma.reportingQuestion.count({ where: { companyId: company.id, status: 'open' } }),
    prisma.notification.findMany({ where: { userId: c.userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.termSheet.findFirst({
      where: { companyId: company.id, status: { in: INVESTEE_VISIBLE } },
      orderBy: { issuedAt: 'desc' },
      select: { investmentAmount: true },
    }),
  ]);
  const invested = investedAmount(company);
  const editable = periods.filter((p) => EDITABLE_STATUSES.includes(p.status)).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const next = editable[0];
  const tsTotal = termSheets.reduce((n, g) => n + g._count, 0);
  const awaiting = termSheets.filter((g) => SIGNABLE.includes(g.status as (typeof SIGNABLE)[number])).reduce((n, g) => n + g._count, 0);
  const hasInvestment = invested > 0;
  return {
    hasReceivedInvestment: hasInvestment,
    application: null,
    portfolioCompany: { id: company.ref, name: company.name, status: company.status, industry: company.industry ?? company.sector, fundingStage: company.fundingStage },
    recentActivities: notifications.map((n) => ({
      id: n.id,
      notificationType: n.type,
      title: n.title,
      message: n.body ?? '',
      createdAt: n.createdAt.toISOString(),
    })),
    summary: {
      hasApplication: false,
      hasPortfolioCompany: true,
      hasReceivedInvestment: hasInvestment,
      applicationStage: hasInvestment ? 'Invested' : awaiting ? 'Term sheet issued' : 'Portfolio company',
      companyStatus: company.status,
      applicationProgress: hasInvestment ? 100 : awaiting ? 80 : 0,
      requestedAmount: latestTs ? latestTs.investmentAmount.toNumber() : invested,
      approvedAmount: invested,
    },
    reporting: {
      openPeriods: periods.filter((p) => p.status === 'open').length,
      returnedPeriods: periods.filter((p) => p.status === 'returned').length,
      awaitingReview: periods.filter((p) => p.status === 'submitted').length,
      nextDue: next ? { reportingPeriod: next.period, label: next.label, dueDate: isoDay(next.dueDate)! } : null,
    },
    termSheets: { awaitingSignature: awaiting, total: tsTotal },
    openThreads,
  };
}

export const jsonValue = (v: unknown) => v as Prisma.InputJsonValue;
