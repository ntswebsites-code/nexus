/**
 * Faithful Investee API fixtures: shapes taken from backend/api/src/modules/investee-portal
 * (investee.service.ts views, workspace/records.ts, workspace/cap.ts) and portals/company-web/src/lib/investee/types.ts.
 */
import { ok, raw, fail, type Routes, type ApiResult } from '../_helpers';

export const P = '/api/v1/investee-portal';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** YYYY-MM key for `back` months before the current month. */
export function monthKey(back = 1) {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() - back, 1);
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
}
export function monthBounds(key: string) {
  const [y, m] = key.split('-').map(Number);
  return { periodStart: `${key}-01`, periodEnd: isoDay(new Date(y, m, 0)), label: new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) };
}

export const profile = (over: Record<string, unknown> = {}) => ({
  id: 'usr_tariro',
  firstName: 'Tariro',
  lastName: 'Moyo',
  email: 'tariro@kuda.test',
  userDepartment: 'CFO',
  roleCode: 'report_contributor',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  name: 'Tariro Moyo',
  accessProfile: 'report_contributor',
  title: 'CFO',
  signingAuthority: false,
  mfaEnabled: false,
  capabilities: {},
  company: { id: 'PC-101', name: 'Kuda Logistics', fundName: 'Matanho Growth Partners I' },
  companies: [
    { id: 'PC-100', name: 'Zeta Foods', accessProfile: 'read_only', current: false },
    { id: 'PC-101', name: 'Kuda Logistics', accessProfile: 'report_contributor', current: true },
  ],
  ...over,
});

export const company = (over: Record<string, unknown> = {}) => ({
  id: 'cmp_101',
  name: 'Kuda Logistics',
  registrationNumber: 'REG-101',
  industry: 'Logistics',
  foundingDate: '2019-03-01',
  address: null,
  website: 'https://kuda.test',
  description: 'Last-mile delivery',
  logoUrl: null,
  status: 'ACTIVE',
  companySize: null,
  employeeCount: 42,
  annualRevenue: 1200000,
  fundingStage: 'Series A',
  contactPerson: 'Tariro Moyo',
  contactPhone: '+263 77 000 0000',
  contactEmail: 'finance@kuda.test',
  fundId: 'fund_1',
  startDate: null,
  endDate: null,
  capTable: null,
  financialKpis: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  fund: { id: 'fund_1', name: 'Matanho Growth Partners I' },
  ...over,
});

export const letterhead = (over: Record<string, unknown> = {}) => ({
  id: 'lh_1',
  portfolioCompanyId: 'cmp_101',
  legalName: 'Kuda Logistics (Pvt) Ltd',
  registrationNumber: 'REG-101',
  taxNumber: null,
  email: 'finance@kuda.test',
  phone: null,
  website: 'https://kuda.test',
  logoUrl: null,
  line1: '12 Samora Machel Ave',
  line2: null,
  city: 'Harare',
  state: null,
  postalCode: null,
  country: 'Zimbabwe',
  addressLabel: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

export const dashboard = (over: Record<string, unknown> = {}) => ({
  hasReceivedInvestment: true,
  application: { id: 'cmp_101', currentStage: 'Invested', submittedAt: '2026-01-01T00:00:00.000Z', businessName: 'Kuda Logistics (Pvt) Ltd', requestedAmount: 2500000, industry: 'Logistics', businessStage: 'Series A', applicationProgress: 100, approvedAmount: 2500000 },
  portfolioCompany: { id: 'PC-101', name: 'Kuda Logistics', status: 'ACTIVE', industry: 'Logistics', fundingStage: 'Series A' },
  recentActivities: [],
  summary: { hasApplication: true, hasPortfolioCompany: true, hasReceivedInvestment: true, applicationStage: 'Invested', companyStatus: 'ACTIVE', applicationProgress: 100, requestedAmount: 2500000, approvedAmount: 2500000 },
  reporting: { openPeriods: 1, returnedPeriods: 0, awaitingReview: 0, nextDue: { reportingPeriod: monthKey(1), label: monthBounds(monthKey(1)).label, dueDate: isoDay(new Date(Date.now() + 10 * 86400000)) } },
  termSheets: { awaitingSignature: 0, total: 0 },
  openThreads: 0,
  ...over,
});

export const reportingRequest = (key = monthKey(1), over: Record<string, unknown> = {}) => {
  const b = monthBounds(key);
  return {
    id: `rp_${key}`,
    portfolioCompanyId: 'PC-101',
    companyName: 'Kuda Logistics',
    reportingPeriod: key,
    dueDate: isoDay(new Date(Date.now() + 10 * 86400000)),
    lastRequestedAt: '2026-08-01T00:00:00.000Z',
    status: 'OPEN',
    portalStatus: 'REPORTING_OPEN',
    mandatoryAttachments: [{ name: 'Management accounts', formats: ['XLSX', 'PDF'], key: 'accounts', reportId: `it_${key}_a`, required: true, status: 'pending', files: [] }],
    label: b.label,
    periodType: 'MONTHLY',
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    submittedAt: null,
    reviewedAt: null,
    reviewerName: null,
    reviewNote: null,
    kpis: {},
    notes: '',
    version: 3,
    canEdit: true,
    canSubmit: true,
    ...over,
  };
};

export const financialReport = (over: Record<string, unknown> = {}) => ({
  id: 'it_x',
  portfolioCompanyId: 'PC-101',
  companyName: 'Kuda Logistics',
  reportType: 'INCOME_STATEMENT',
  periodType: 'MONTHLY',
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  reportingPeriod: '2026-05',
  title: 'Management accounts · May 2026',
  description: null,
  reportUrl: null,
  fileUrl: null,
  templateVersion: 'nexus-v1',
  status: 'SUBMITTED',
  totalRevenue: 120000,
  netProfit: 15000,
  cashFlowNet: 8000,
  reviewerId: null,
  reviewedAt: null,
  reviewerComment: null,
  isDraft: false,
  canSubmit: false,
  canUploadFile: false,
  canDownload: false,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  ...over,
});

export const termSheet = (over: Record<string, unknown> = {}) => ({
  id: 'ts_1001',
  applicationId: null,
  title: 'Series A term sheet TS-1001',
  version: '1',
  status: 'ISSUED',
  investmentAmount: 2500000,
  equityPercentage: 12.5,
  valuation: 20000000,
  keyTerms: 'Standard terms',
  conditions: null,
  timeline: null,
  documentUrl: null,
  documentFileName: null,
  documentSize: null,
  isDraft: false,
  isFinal: true,
  isSigned: false,
  signedAt: null,
  applicantSignature: null,
  investorSignature: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  consent: { version: 'ts-esign-v1', text: 'I agree to sign electronically.', hash: 'abc' },
  consentText: 'I agree to sign electronically.',
  documentHash: 'f'.repeat(64),
  ...over,
});

export const capTable = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-09-01',
  derived: false,
  locked: false,
  pendingTransactions: 0,
  shareholders: [
    { id: 'h1', name: 'Founders Pool', type: 'Ordinary', shares: 700000, pct: 70, color: '#4f46e5' },
    { id: 'h2', name: 'Matanho Growth Partners I', type: 'Series A Preferred', shares: 300000, pct: 30, color: '#16a34a' },
  ],
  classes: [
    { id: 'c1', name: 'Ordinary', outstanding: 700000, voting: '1 vote / share', preference: 'None', conversion: 'n/a', status: 'Active' },
    { id: 'c2', name: 'Series A Preferred', outstanding: 300000, voting: 'As-converted', preference: '1x non-participating', conversion: '1:1', status: 'Active' },
  ],
  ...over,
});

export const governance = (over: Record<string, unknown> = {}) => ({
  consents: [],
  actions: [],
  meetings: [],
  reservedMatters: [{ name: 'New share issue', detail: 'Needs investor consent' }],
  calendar: [],
  metrics: { pendingConsents: 0, openActions: 0, upcomingMeetings: 0 },
  ...over,
});

export const forecast = (over: Record<string, unknown> = {}) => {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 3 + i, 1);
    return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), stage: i < 3 ? 'actual-locked' : i === 3 ? 'actual-open' : 'forecast', locked: false };
  });
  const fc: Record<string, number | null> = {};
  for (const m of months) if (m.stage !== 'actual-locked') fc[m.key] = null;
  return {
    scenario: 'Base case',
    months,
    actuals: {},
    forecast: fc,
    lockedPeriods: [],
    scenarios: { 'Base case': { revenue: 0, note: 'Board working plan' }, Upside: { revenue: 0, note: 'Accelerated growth' }, Downside: { revenue: 0, note: 'Liquidity stress' } },
    activeRevenue: 0,
    ...over,
  };
};

export const team = () => [
  { id: 'usr_tariro', name: 'Tariro Moyo', email: 'tariro@kuda.test', title: 'CFO', accessProfile: 'report_contributor', status: 'active', lastActiveAt: '2026-09-30T10:00:00.000Z', mfaEnabled: false, signingAuthority: false, isYou: true },
  { id: 'usr_chipo', name: 'Chipo Dube', email: 'chipo@kuda.test', title: 'CEO', accessProfile: 'executive_approver', status: 'active', lastActiveAt: null, mfaEnabled: true, signingAuthority: true, isYou: false },
];

export const kpis = () => ({
  definitions: [
    { id: 'arr', key: 'arr', label: 'Annual recurring revenue', unit: 'USD', prev: 900000, budget: 1200000, invert: false, series: [800000, 900000, 1000000], latest: 1000000 },
    { id: 'runway', key: 'runway', label: 'Cash runway', unit: 'months', prev: 14, budget: 12, invert: false, series: [14, 15, 16], latest: 16 },
  ],
  periods: [{ reportingPeriod: monthKey(2), label: monthBounds(monthKey(2)).label, status: 'accepted', values: { arr: 1000000, runway: 16 } }],
  covenants: [],
});

export const settings = (over: Record<string, unknown> = {}) => ({
  notifications: [],
  security: { mfaEnabled: false, mfaRequired: true, sessionTimeoutMinutes: 30 },
  accessProfile: 'report_contributor',
  capabilities: {},
  ...over,
});

export const requisition = (over: Record<string, unknown> = {}) => ({
  id: 'REQ-2055',
  title: 'Fleet expansion',
  description: 'Two vans',
  status: 'Under review',
  priority: 'High',
  sourcingCategory: 'Growth capital',
  currency: 'USD',
  estimatedAmount: 45000,
  needBy: '2026-12-01',
  createdByName: 'Tariro Moyo',
  ...over,
});

export const vaultDoc = (over: Record<string, unknown> = {}) => ({ id: 'doc_1', name: 'Certificate of incorporation', fileName: 'cert.pdf', documentType: 'company', uploadedAt: '2026-05-01T00:00:00.000Z', ...over });

export interface World {
  flags: string[] | 'all';
  profile: Record<string, unknown>;
  [k: string]: unknown;
}

/** Complete set of GET routes for a healthy PC-101 workspace. Spread into mockApi; override any key after. */
export function healthyRoutes(over: Partial<Record<string, ApiResult | ((...a: never[]) => ApiResult)>> = {}, liveActions: string[] = ['all']): Routes {
  return {
    'GET /api/v1/platform/flags': raw({ lp: {}, investee: { liveActions }, custodian: { live: false }, onboarding: { live: false } }),
    'GET /api/auth/me': raw({ user: { id: 'usr_tariro', email: 'tariro@kuda.test', name: 'Tariro Moyo', roles: [], permissions: [], createdAt: '2026-01-01T00:00:00.000Z' } }),
    'GET /api/v1/notifications': raw({ items: [] }),
    [`GET ${P}/health`]: ok({ status: 'ok' }),
    [`GET ${P}/dashboard`]: ok(dashboard()),
    [`GET ${P}/profile`]: ok(profile()),
    [`GET ${P}/company`]: ok(company()),
    [`GET ${P}/reporting/requests`]: ok([reportingRequest(monthKey(1))]),
    [`GET ${P}/financial-reports`]: ok([]),
    [`GET ${P}/term-sheets/my`]: ok({ termSheets: [], total: 0, page: 1, totalPages: 1 }),
    [`GET ${P}/application`]: ok({ id: 'cmp_101', businessName: 'Kuda Logistics (Pvt) Ltd', currentStage: 'Invested', requestedAmount: 2500000, documents: [] }),
    [`GET ${P}/procurement`]: ok({ requisitions: [] }),
    [`GET ${P}/cap-table`]: ok(capTable()),
    [`GET ${P}/governance`]: ok(governance()),
    [`GET ${P}/forecast`]: ok(forecast()),
    [`GET ${P}/vault`]: ok({ documents: [] }),
    [`GET ${P}/threads`]: ok([]),
    [`GET ${P}/team`]: ok(team()),
    [`GET ${P}/kpis`]: ok(kpis()),
    [`GET ${P}/letterhead`]: ok(letterhead()),
    [`GET ${P}/settings`]: ok(settings()),
    [`GET ${P}/signature-requests`]: ok({ requests: [] }),
    ...(over as Routes),
  };
}

export { ok, fail, raw };
