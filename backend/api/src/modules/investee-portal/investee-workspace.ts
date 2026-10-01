import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PortfolioCompany } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { storeFile } from '../../lib/storage';
import { investedAmount, jsonValue } from './investee.service';
import type { InvesteeContext } from './investee.context';
import { INVESTEE_VISIBLE } from '../term-sheets/term-sheets.service';

/**
 * Company workspace records that have no dedicated table (schema stays frozen).
 * Shareholders, consents, forecast cells and requisitions live in `settings`
 * keyed by the company id. The vault and the application summary are read from
 * documents, term sheets and the company row.
 */

const CAP_KEY = 'workspace.cap';
const GOV_KEY = 'workspace.governance';
const FORECAST_KEY = 'workspace.forecast';
const REQUESTS_KEY = 'workspace.requests';

const COLORS = ['#6654e8', '#2774f0', '#0798b6', '#078b68', '#c97b08', '#c2410c', '#7c3aed', '#0f766e'];

const RESERVED_MATTERS = [
  { name: 'New debt', detail: 'Borrowing above the agreed facility, or security over company assets.' },
  { name: 'Share capital', detail: 'Issue, transfer, buyback or a change to the option pool.' },
  { name: 'Acquisitions', detail: 'A material acquisition or disposal.' },
  { name: 'Executive changes', detail: 'Appointment, dismissal or a material remuneration change.' },
  { name: 'Annual budget', detail: 'The annual budget and changes above the agreed tolerance.' },
] as const;

export const roundSchema = z.object({
  amount: z.number().positive().max(1_000_000_000_000),
  preMoney: z.number().positive().max(1_000_000_000_000),
});

export const capTableSchema = z.object({
  shareholders: z
    .array(
      z.object({
        id: z.string().trim().max(40).optional(),
        name: z.string().trim().min(1).max(160),
        type: z.string().trim().min(1).max(80),
        shares: z.number().int().positive().max(1_000_000_000_000),
      }),
    )
    .min(1)
    .max(40),
});

export const forecastSchema = z.object({
  scenario: z.enum(['Base case', 'Upside', 'Downside']).optional(),
  revenue: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().finite()).optional(),
});

export const consentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  basis: z.string().trim().min(3).max(160),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const requisitionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  type: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  currency: z.string().trim().length(3).optional(),
  amount: z.number().finite().nonnegative().optional(),
  needBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
  draft: z.boolean().optional(),
});

export const decisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'FULFILLED']),
  note: z.string().trim().max(2000).optional(),
});

export const consentDecisionSchema = z.object({
  status: z.enum(['Approved', 'Declined']),
  note: z.string().trim().max(2000).optional(),
});

interface Shareholder {
  id: string;
  name: string;
  type: string;
  shares: number;
  pct: number;
  color: string;
}

interface CapStore {
  asOf: string;
  shareholders: Shareholder[];
}

interface Consent {
  id: string;
  title: string;
  basis: string;
  submitted: string;
  due: string;
  owner: string;
  status: string;
  note: string;
}

interface BoardAction {
  id: string;
  title: string;
  owner: string;
  due: string;
  evidence: string;
  status: string;
}

interface GovStore {
  consents: Consent[];
  actions: BoardAction[];
}

interface ForecastStore {
  scenario: 'Base case' | 'Upside' | 'Downside';
  revenue: Record<string, number>;
}

interface Requisition {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  sourcingCategory: string;
  currency: string;
  estimatedAmount: number;
  needBy: string;
  createdByName: string;
  createdAt: string;
  note: string;
}

function day(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readSetting<T>(companyId: string, key: string): Promise<T | null> {
  const row = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: companyId, key } } });
  return (row?.value as T | undefined) ?? null;
}

async function writeSetting(companyId: string, key: string, value: unknown, audit: AuditContext, action: string) {
  const json = jsonValue(value);
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { ownerId_key: { ownerId: companyId, key } },
      create: { ownerId: companyId, key, value: json },
      update: { value: json },
    });
    await writeAudit(tx, audit, { action, objectType: 'setting', objectId: `${companyId}:${key}`, after: { key } });
  });
}

function fundLabel(company: PortfolioCompany) {
  const rel = asObject(company.relationship);
  const fund = rel?.fund;
  return typeof fund === 'string' && fund.trim() ? fund.trim() : 'Matanho';
}

function withPercents(rows: { id?: string; name: string; type: string; shares: number }[]): Shareholder[] {
  const total = rows.reduce((sum, row) => sum + row.shares, 0);
  return rows.map((row, index) => ({
    id: row.id && row.id.length <= 40 ? row.id : randomUUID(),
    name: row.name,
    type: row.type,
    shares: row.shares,
    pct: total > 0 ? Math.round((row.shares / total) * 1000) / 10 : 0,
    color: COLORS[index % COLORS.length]!,
  }));
}

function classesOf(shareholders: Shareholder[]) {
  const grouped = new Map<string, number>();
  for (const row of shareholders) grouped.set(row.type, (grouped.get(row.type) ?? 0) + row.shares);
  return [...grouped].map(([name, outstanding]) => ({
    name,
    outstanding,
    voting: /option/i.test(name) ? 'No vote until exercise' : /preferred/i.test(name) ? 'As-converted' : '1 vote / share',
    preference: /preferred/i.test(name) ? '1× non-participating' : 'None',
    conversion: /option/i.test(name) ? 'Exercise' : /preferred/i.test(name) ? '1:1' : 'n/a',
    status: 'Active',
  }));
}

async function derivedCap(company: PortfolioCompany): Promise<Shareholder[]> {
  const latest = await prisma.termSheet.findFirst({
    where: { companyId: company.id, status: { in: [...INVESTEE_VISIBLE] } },
    orderBy: { issuedAt: 'desc' },
    select: { equityPercentage: true },
  });
  const equity = latest ? latest.equityPercentage.toNumber() : 0;
  if (equity <= 0 || equity >= 100) return [];
  const base = 10_000_000;
  const fundShares = Math.round((base * equity) / 100);
  return withPercents([
    { name: 'Founders and management', type: 'Ordinary', shares: base - fundShares },
    { name: fundLabel(company), type: 'Preferred', shares: fundShares },
  ]);
}

export async function capTableView(company: PortfolioCompany) {
  const stored = await readSetting<CapStore>(company.id, CAP_KEY);
  const shareholders = stored?.shareholders?.length ? stored.shareholders : await derivedCap(company);
  return {
    asOf: stored?.asOf ?? day(),
    derived: !stored?.shareholders?.length,
    shareholders,
    classes: classesOf(shareholders),
  };
}

/** New-money round at a pre-money valuation. Does not write the register. */
export function simulateRound(holders: { name: string; type: string; shares: number }[], amount: number, preMoney: number) {
  const existing = holders.reduce((sum, row) => sum + row.shares, 0);
  if (existing <= 0) throw HttpError.badRequest('Record at least one holder before modelling a round');
  const price = preMoney / existing;
  const issued = Math.round(amount / price);
  if (issued <= 0) throw HttpError.badRequest('The round issues no shares at this valuation');
  const total = existing + issued;
  const pct = (shares: number) => Number(((shares / total) * 100).toFixed(1));
  return {
    pricePerShare: Number(price.toFixed(4)),
    issued,
    postMoney: preMoney + amount,
    shareholders: [
      ...holders.map((row) => ({ name: row.name, type: row.type, shares: row.shares, pct: pct(row.shares) })),
      { name: 'New investor', type: 'New money', shares: issued, pct: pct(issued) },
    ],
  };
}

export async function saveCapTable(c: InvesteeContext, body: z.infer<typeof capTableSchema>, audit: AuditContext) {
  const shareholders = withPercents(body.shareholders);
  const value: CapStore = { asOf: day(), shareholders };
  await writeSetting(c.company.id, CAP_KEY, value, audit, 'company.cap_table.saved');
  return { asOf: value.asOf, derived: false, shareholders, classes: classesOf(shareholders) };
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
  const stored = (await readSetting<ForecastStore>(companyId, FORECAST_KEY)) ?? { scenario: 'Base case' as const, revenue: {} };
  const periods = await prisma.reportingPeriod.findMany({
    where: { companyId },
    select: { period: true, status: true, kpiValues: true },
  });
  const actuals: Record<string, number | null> = {};
  for (const period of periods) {
    const values = asObject(period.kpiValues);
    const revenue = num(values?.totalRevenue);
    if (revenue !== null && (period.status === 'submitted' || period.status === 'accepted')) actuals[period.period] = revenue;
  }
  const months = rollingMonths();
  const forecastRevenue = months
    .filter((m) => m.stage !== 'actual-locked')
    .map((m) => m.key)
    .reduce<Record<string, number | null>>((acc, key) => {
      acc[key] = num(stored.revenue?.[key]);
      return acc;
    }, {});
  const actualTotal = Object.values(actuals).reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const forecastTotal = Object.values(forecastRevenue).reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const scale = stored.scenario === 'Upside' ? 1.15 : stored.scenario === 'Downside' ? 0.8 : 1;
  return {
    scenario: stored.scenario ?? 'Base case',
    months,
    actuals,
    forecast: forecastRevenue,
    scenarios: {
      'Base case': { revenue: actualTotal + forecastTotal, note: 'Board working plan' },
      Upside: { revenue: (actualTotal + forecastTotal) * 1.15, note: 'Accelerated growth' },
      Downside: { revenue: (actualTotal + forecastTotal) * 0.8, note: 'Liquidity stress' },
    },
    activeRevenue: (actualTotal + forecastTotal) * scale,
  };
}

export async function saveForecast(c: InvesteeContext, body: z.infer<typeof forecastSchema>, audit: AuditContext) {
  const current = (await readSetting<ForecastStore>(c.company.id, FORECAST_KEY)) ?? { scenario: 'Base case' as const, revenue: {} };
  const next: ForecastStore = {
    scenario: body.scenario ?? current.scenario ?? 'Base case',
    revenue: { ...(current.revenue ?? {}), ...(body.revenue ?? {}) },
  };
  await writeSetting(c.company.id, FORECAST_KEY, next, audit, 'company.forecast.saved');
  return forecastView(c.company.id);
}

export async function governanceView(c: InvesteeContext) {
  const stored = (await readSetting<GovStore>(c.company.id, GOV_KEY)) ?? { consents: [], actions: [] };
  const periods = await prisma.reportingPeriod.findMany({
    where: { companyId: c.company.id, status: { in: ['open', 'returned'] } },
    orderBy: { dueDate: 'asc' },
    take: 4,
    select: { label: true, dueDate: true, status: true },
  });
  const pending = stored.consents.filter((row) => /review|pending|open|submitted/i.test(row.status)).length;
  return {
    consents: stored.consents,
    actions: stored.actions,
    reservedMatters: RESERVED_MATTERS,
    calendar: periods.map((p) => ({
      title: p.label,
      due: p.dueDate.toISOString().slice(0, 10),
      status: p.status,
    })),
    metrics: { pendingConsents: pending, openActions: stored.actions.filter((a) => !/complete/i.test(a.status)).length },
  };
}

export async function addConsent(c: InvesteeContext, body: z.infer<typeof consentSchema>, owner: string, audit: AuditContext) {
  const stored = (await readSetting<GovStore>(c.company.id, GOV_KEY)) ?? { consents: [], actions: [] };
  const consent: Consent = {
    id: `GOV-${randomUUID().slice(0, 8)}`,
    title: body.title,
    basis: body.basis,
    submitted: day(),
    due: body.due ?? day(new Date(Date.now() + 14 * 86400000)),
    owner,
    status: 'Investor review',
    note: body.note ?? '',
  };
  stored.consents = [consent, ...stored.consents].slice(0, 50);
  await writeSetting(c.company.id, GOV_KEY, stored, audit, 'company.governance.consent_requested');
  return governanceView(c);
}

function normaliseConsents(value: unknown): Consent[] {
  const rows = asObject(value)?.consents;
  return Array.isArray(rows) ? (rows as Consent[]) : [];
}

export async function listConsentsForStaff() {
  const rows = await prisma.setting.findMany({ where: { key: GOV_KEY } });
  const companies = await prisma.portfolioCompany.findMany({
    where: { id: { in: rows.map((r) => r.ownerId) } },
    select: { id: true, name: true, ref: true },
  });
  const byId = new Map(companies.map((c) => [c.id, c]));
  return rows.flatMap((row) => {
    const company = byId.get(row.ownerId);
    if (!company) return [];
    return normaliseConsents(row.value).map((item) => ({ ...item, companyId: company.id, companyName: company.name, companyRef: company.ref }));
  });
}

export async function decideConsent(companyId: string, consentId: string, body: z.infer<typeof consentDecisionSchema>, audit: AuditContext) {
  const stored = (await readSetting<GovStore>(companyId, GOV_KEY)) ?? { consents: [], actions: [] };
  const row = stored.consents.find((item) => item.id === consentId);
  if (!row) throw HttpError.notFound('Consent request not found');
  if (row.status !== 'Investor review') {
    throw HttpError.conflict(`A consent in ${row.status} cannot be decided again`, 'invalid_state');
  }
  row.status = body.status;
  if (body.note) row.note = body.note;
  await writeSetting(companyId, GOV_KEY, stored, audit, 'company.governance.consent_decided');
  return row;
}

function normaliseRequisitions(value: unknown): Requisition[] {
  const rows = asObject(value)?.requisitions;
  return Array.isArray(rows) ? (rows as Requisition[]) : [];
}

export async function requisitionList(companyId: string) {
  const stored = await readSetting<unknown>(companyId, REQUESTS_KEY);
  return normaliseRequisitions(stored);
}

export async function createRequisition(c: InvesteeContext, body: z.infer<typeof requisitionSchema>, owner: string, audit: AuditContext) {
  const ref = await prisma.$transaction((tx) => nextRef(tx, 'request'));
  const kind = body.type ?? 'Capital request';
  const category = body.category ?? 'Growth capital';
  const row: Requisition = {
    id: ref,
    title: body.title,
    description: body.description ?? '',
    status: body.draft ? 'DRAFT' : 'SUBMITTED',
    priority: body.priority ?? 'Medium',
    sourcingCategory: `${kind}: ${category}`,
    currency: (body.currency ?? c.company.reportingCurrency ?? 'USD').toUpperCase(),
    estimatedAmount: body.amount ?? 0,
    needBy: body.needBy ?? '',
    createdByName: owner,
    createdAt: new Date().toISOString(),
    note: '',
  };
  const requisitions = [row, ...(await requisitionList(c.company.id))].slice(0, 100);
  await writeSetting(c.company.id, REQUESTS_KEY, { requisitions }, audit, 'company.requisition.created');
  return row;
}

export async function listRequisitionsForStaff() {
  const rows = await prisma.setting.findMany({ where: { key: REQUESTS_KEY } });
  const companies = await prisma.portfolioCompany.findMany({
    where: { id: { in: rows.map((r) => r.ownerId) } },
    select: { id: true, name: true, ref: true },
  });
  const byId = new Map(companies.map((c) => [c.id, c]));
  return rows.flatMap((row) => {
    const company = byId.get(row.ownerId);
    if (!company) return [];
    return normaliseRequisitions(row.value).map((item) => ({ ...item, companyId: company.id, companyName: company.name, companyRef: company.ref }));
  });
}

export async function decideRequisition(companyId: string, requestId: string, body: z.infer<typeof decisionSchema>, audit: AuditContext) {
  const requisitions = await requisitionList(companyId);
  const row = requisitions.find((item) => item.id === requestId);
  if (!row) throw HttpError.notFound('Request not found');
  const allowed: Record<string, string[]> = { SUBMITTED: ['APPROVED', 'REJECTED'], APPROVED: ['FULFILLED'] };
  if (!allowed[row.status]?.includes(body.status)) {
    throw HttpError.conflict(`A ${row.status} request cannot move to ${body.status}`, 'invalid_state');
  }
  row.status = body.status;
  row.note = body.note ?? row.note;
  await writeSetting(companyId, REQUESTS_KEY, { requisitions }, audit, 'company.requisition.decided');
  return row;
}

export async function vaultDocuments(companyId: string) {
  const docs = await prisma.document.findMany({
    where: { companyId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, ref: true, name: true, type: true, status: true, createdAt: true, updatedAt: true },
  });
  return docs.map((d) => ({
    id: d.id,
    ref: d.ref,
    fileName: d.name,
    name: d.name,
    documentType: d.type,
    type: d.type,
    isSubmitted: d.status === 'Approved' || d.status === 'Published',
    uploadedAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    status: d.status,
  }));
}

export async function uploadVaultFile(
  c: InvesteeContext,
  file: { originalname: string; mimetype: string; buffer: Buffer },
  meta: { name?: string; type?: string },
  audit: AuditContext,
) {
  const id = await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: c.userId }, tx);
    const ref = await nextRef(tx, 'document');
    const doc = await tx.document.create({
      data: {
        ref,
        name: (meta.name || file.originalname).slice(0, 255),
        type: (meta.type || 'company').slice(0, 32),
        classification: 'Client',
        status: 'Published',
        ownerName: c.company.name,
        companyId: c.company.id,
        relatedType: 'company',
        relatedId: c.company.id,
        relatedLabel: c.company.name,
        year: new Date().getFullYear(),
        makerId: c.userId,
        createdBy: c.userId,
        versions: { create: { version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: c.userId } },
      },
    });
    await writeAudit(tx, audit, { action: 'company.vault.uploaded', objectType: 'document', objectId: doc.id, after: { ref, name: doc.name } });
    return doc.id;
  });
  const docs = await vaultDocuments(c.company.id);
  return docs.find((d) => d.id === id) ?? docs[0];
}

export async function applicationView(c: InvesteeContext) {
  const company = c.company;
  const [latest, documents] = await Promise.all([
    prisma.termSheet.findFirst({
      where: { companyId: company.id, status: { in: [...INVESTEE_VISIBLE] } },
      orderBy: { issuedAt: 'desc' },
      select: { investmentAmount: true, equityPercentage: true, status: true, issuedAt: true },
    }),
    vaultDocuments(company.id),
  ]);
  const invested = investedAmount(company);
  const requested = latest ? latest.investmentAmount.toNumber() : invested || null;
  const stage = invested > 0 ? 'Invested' : latest ? 'Term sheet issued' : company.status;
  return {
    id: company.id,
    businessName: company.legalName || company.name,
    currentStage: stage,
    submittedAt: company.createdAt.toISOString(),
    requestedAmount: requested,
    approvedAmount: invested || null,
    industry: company.industry ?? company.sector,
    businessStage: company.fundingStage,
    applicationProgress: invested > 0 ? 100 : latest ? 80 : 20,
    registrationNumber: company.registrationNumber,
    equityPercentage: latest ? latest.equityPercentage.toNumber() : null,
    termSheetStatus: latest?.status ?? null,
    documents,
  };
}

export async function signatureRequests(companyId: string) {
  const rows = await prisma.termSheet.findMany({
    where: { companyId, status: { in: [...INVESTEE_VISIBLE] } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, ref: true, title: true, status: true, signedAt: true, issuedAt: true, updatedAt: true },
  });
  return rows.map((ts) => {
    const signed = ts.status === 'SIGNED_BY_COMPANY' || ts.status === 'COUNTERSIGNED' || ts.status === 'EXECUTED';
    const declined = ts.status === 'WITHDRAWN';
    return {
      id: ts.id,
      termSheetId: ts.id,
      document: ts.title,
      category: 'Term sheet',
      status: signed ? 'Completed' : declined ? 'Declined' : 'Awaiting your signature',
      ref: ts.ref,
      updatedAt: ts.updatedAt.toISOString(),
      signedAt: ts.signedAt?.toISOString() ?? null,
    };
  });
}
