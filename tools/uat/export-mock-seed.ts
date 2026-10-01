/**
 * Builds the UAT seed dataset from the demo fixtures, so live data and the mock oracle agree:
 *   - the LP mock store (portals/investor-web/src/lib/lp-portal/mock-store.ts) -> client A
 *     "Horizon Pension Fund LP" with a private-capital and an open-ended fund
 *   - the Investee runtime fixtures (portals/company-web/.../matanho-investee-portal-runtime.js)
 *     -> company 101 (Zambezi Pay Technologies)
 * plus the extra records the plan needs for negative tests (client B, company 102, a prospect
 * with a draft term sheet, one counterparty) and the persona definitions (no credentials).
 *
 *   npx tsx tools/uat/export-mock-seed.ts            writes tools/uat/seed-data/uat-seed.json
 *   npx tsx tools/uat/export-mock-seed.ts --check    exits 1 if the committed file is stale
 *
 * Loaded by backend/api/prisma/seed-uat.ts.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMockStore, MOCK_FUND_IDS } from '../../portals/investor-web/src/lib/lp-portal/mock-store';
import type { UatSeed } from './seed-types';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(here, 'seed-data', 'uat-seed.json');
const RUNTIME = path.join(root, 'portals/company-web/src/components/investee-portal-v8-mock/matanho-investee-portal-runtime.js');
const DEMO_COMPANY = path.join(root, 'backend/api/prisma/seed/demo-company.json');

const store = getMockStore();
const { GROWTH, EQUITY, AS_OF } = MOCK_FUND_IDS;

// ------------------------------------------------------------------ references
export const REF = {
  clientA: 'CL-00418',
  clientB: 'CL-90001',
  fund: { [GROWTH]: 'FND-AGFI', [EQUITY]: 'FND-AEOF' } as Record<string, string>,
  company101: 'PC-101',
  company102: 'PC-102',
  prospect: 'PC-103',
  counterparty: 'CP-001',
};
const fundRef = (mockFundId: string) => {
  const r = REF.fund[mockFundId];
  if (!r) throw new Error(`unmapped mock fund ${mockFundId}`);
  return r;
};
const upperRef = (prefix: string, id: string) => `${prefix}${id.replace(/^[a-z]+-/i, '').toUpperCase()}`;
const num = (s: string | number | null | undefined) => Number(s ?? 0);
const money = (n: number) => n.toFixed(2);

/** LP document category (Document.category) for the mock's display category; the label keeps the display text. */
const DOC_CATEGORY: Record<string, string> = {
  'Fund Reports': 'PERFORMANCE_REPORT',
  Statements: 'QUARTERLY_STATEMENT',
  'Capital Calls': 'CALL_NOTICE',
  Distributions: 'DISTRIBUTIONS',
  'Financial Statements': 'AUDIT',
  Legal: 'LEGAL',
  Tax: 'TAX',
  Dealing: 'MANUAL',
};
/** Document.type (staff vocabulary: report | statement | capital | legal | tax | other). */
const DOC_TYPE: Record<string, string> = {
  PERFORMANCE_REPORT: 'report',
  QUARTERLY_STATEMENT: 'statement',
  CALL_NOTICE: 'capital',
  DISTRIBUTIONS: 'capital',
  AUDIT: 'report',
  LEGAL: 'legal',
  TAX: 'tax',
  MANUAL: 'other',
};
const DIST_TYPE: Record<string, string> = {
  'Exit Proceeds': 'REALISATION_PROCEEDS',
  Dividend: 'DIVIDEND',
  'Return of Capital': 'RETURN_OF_CAPITAL',
};
const REQUEST_LEGACY_STATUS: Record<string, string> = {
  SUBMITTED: 'Open',
  UNDER_REVIEW: 'In progress',
  AWAITING_INVESTOR: 'Waiting on you',
  CLOSED: 'Closed',
};
const DEALING_STATUS: Record<string, string> = { ALLOCATED: 'COMPLETED', UNDER_REVIEW: 'UNDER_REVIEW', SUBMITTED: 'SUBMITTED' };

// ------------------------------------------------------------------ Investee runtime literals
/** Extracts a plain data literal (`const name=...` / `let name=...`) from the runtime source without running it. */
function runtimeLiteral<T>(src: string, name: string): T {
  const m = new RegExp(`(?:const|let) ${name}=`).exec(src);
  if (!m) throw new Error(`runtime literal ${name} not found`);
  let i = m.index + m[0].length;
  const open = src[i];
  const close = open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) throw new Error(`runtime literal ${name} is not an object/array`);
  let depth = 0;
  let quote: string | null = null;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) break;
  }
  const literal = src.slice(start, i + 1);
  if (literal.includes('${')) throw new Error(`runtime literal ${name} is not plain data`);
  return Function(`"use strict";return (${literal});`)() as T;
}

interface RtCompany { name: string; short: string; fund: string; sector: string; stage: string; currency: string; investmentDate: string; invested: number; valuation: number; ownership: number; board: string; lead: string; reporting: string; nextBoard: string }
interface RtReport { id: string; name: string; period: string; due: string; owner: string; status: string; progress: number; version: string }
interface RtKpi { name: string; category: string; value: number; target: number; unit: string; trend: number; frequency: string; owner: string; status: string; series: number[] }

function buildCompanies(): Pick<UatSeed, 'companies' | 'termSheets'> {
  const src = readFileSync(RUNTIME, 'utf8');
  const co = runtimeLiteral<RtCompany>(src, 'company');
  const reports = runtimeLiteral<RtReport[]>(src, 'reports');
  const kpis = runtimeLiteral<RtKpi[]>(src, 'kpis');
  const demoCompany = JSON.parse(readFileSync(DEMO_COMPANY, 'utf8')) as {
    covenants: { id: string; name: string; threshold: string; actual: number; limit: number; unit: string; headroom: number; evidence: string; note?: string }[];
  };
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
  const unit = (u: string) => (u === 'money' ? 'USD' : u === 'percent' ? '%' : '#');
  const accepted = reports.filter((r) => r.status === 'Accepted');

  return {
    companies: [
      {
        ref: REF.company101,
        name: co.name,
        legalName: `${co.name} (Private) Limited`,
        ticker: 'ZPAY',
        sector: co.sector,
        country: 'Zimbabwe',
        fundingStage: co.stage,
        reportingCurrency: co.currency,
        status: 'Active',
        relationship: {
          fund: co.fund,
          ownership: co.ownership,
          invested: co.invested,
          valuation: co.valuation,
          entry: co.investmentDate,
          board: co.board,
          dealTeam: [co.lead],
          reporting: co.reporting,
          nextBoard: co.nextBoard,
        },
        contacts: [],
        kpis: kpis.map((k, sort) => ({
          key: slug(k.name),
          label: k.name,
          unit: unit(k.unit),
          prev: k.series.length > 1 ? k.series[k.series.length - 2]! : k.value,
          budget: k.target,
          series: k.series,
          sort,
        })),
        covenants: demoCompany.covenants.map((v, sort) => ({ ...v, headroom: String(v.headroom), sort })),
        // Four quarterly periods, the newest open (J5 starts there). Labels follow the runtime's reports.
        periods: [
          { period: '2025-09', periodType: 'QUARTERLY', label: 'Q3 2025', due: '2025-11-15', status: 'accepted', reviewNote: 'Accepted.' },
          { period: '2025-12', periodType: 'QUARTERLY', label: accepted[0]?.period ?? 'Q4 2025', due: '2026-03-31', status: 'accepted', reviewNote: 'Accepted.' },
          { period: '2026-03', periodType: 'QUARTERLY', label: reports.find((r) => r.id === 'RPT-024')?.period ?? 'Q1 2026', due: '2026-05-10', status: 'accepted', reviewNote: 'Accepted.' },
          { period: '2026-06', periodType: 'QUARTERLY', label: reports.find((r) => r.id === 'RPT-026')?.period ?? 'Q2 2026', due: '2026-08-12', status: 'open' },
        ],
      },
      {
        ref: REF.company102,
        name: 'Mosi Agritech',
        legalName: 'Mosi Agritech (Private) Limited',
        ticker: 'MOSI',
        sector: 'Agriculture technology',
        country: 'Zambia',
        fundingStage: 'Series A',
        reportingCurrency: 'USD',
        status: 'Active',
        relationship: { fund: co.fund, ownership: 12.5, invested: 6500000, entry: '04 Apr 2024', dealTeam: [co.lead], reporting: 'Quarterly' },
        contacts: [],
        kpis: [],
        covenants: [],
        periods: [{ period: '2026-06', periodType: 'QUARTERLY', label: 'Apr – Jun 2026', due: '2026-08-12', status: 'open' }],
      },
      {
        ref: REF.prospect,
        name: 'Kariba Solar Holdings',
        legalName: 'Kariba Solar Holdings (Private) Limited',
        ticker: 'KSOL',
        sector: 'Renewable energy',
        country: 'Zimbabwe',
        fundingStage: 'Seed',
        reportingCurrency: 'USD',
        status: 'Prospect',
        relationship: { fund: co.fund, ownership: 0, invested: 0, dealTeam: [co.lead] },
        contacts: [],
        kpis: [],
        covenants: [],
        periods: [],
      },
    ],
    termSheets: [
      {
        ref: 'TS-103-01',
        company: REF.prospect,
        title: 'Seed investment term sheet - Kariba Solar Holdings',
        status: 'DRAFT',
        investmentAmount: '2500000.00',
        valuation: '12500000.00',
        equityPercentage: '20.00',
        currency: 'USD',
        keyTerms: { security: 'Series Seed preferred', boardSeats: 1, liquidationPreference: '1x non-participating', proRata: true },
        conditions: 'Satisfactory legal, financial and ESG due diligence; investment committee approval.',
        timeline: 'Issue within 10 business days of IC approval; long-stop 60 days after issue.',
      },
    ],
  };
}

// ------------------------------------------------------------------ LP
function buildLp(): Omit<UatSeed, 'version' | 'note' | 'asOfDate' | 'personas' | 'companies' | 'termSheets' | 'counterparties'> {
  const s = store.session;
  const B_SHARE = 0.2; // client B committed 1,000,000 to Growth Fund I against A's 5,000,000

  const growthKpis = store.dashboards[GROWTH]!.kpis;
  const equityKpis = store.dashboards[EQUITY]!.kpis;
  const rowFor = (id: string) => store.performanceByFundRows.find((r) => r.fundId === id) ?? null;
  const seededPaid = store.capitalCalls.filter((c) => c.fundId === GROWTH).reduce((a, c) => a + num(c.paid), 0);
  const seededOutstanding = store.capitalCalls.filter((c) => c.fundId === GROWTH).reduce((a, c) => a + num(c.outstanding), 0);
  const seededDist = store.distributions.filter((d) => d.fundId === GROWTH).reduce((a, d) => a + num(d.netPaid), 0);

  const funds: UatSeed['funds'] = s.funds.map((f) => {
    const ov = store.dealingOverviews[f.fundId];
    const { compliance: _c, ...rules } = (ov?.rules ?? {}) as unknown as Record<string, unknown>;
    const navHistory = store.dashboards[f.fundId]?.openEndedHistory?.points ?? [];
    const wiring = store.capitalCalls.find((c) => c.fundId === f.fundId)?.wiring;
    return {
      ref: fundRef(f.fundId),
      mockId: f.fundId,
      name: f.fundName,
      shortName: f.shortName,
      publicReference: f.publicReference,
      operatingModel: f.operatingModel,
      currency: f.currencyCode,
      defaultShareClass: f.shareClass,
      valuationStatus: f.valuationStatus,
      asOfDate: f.asOfDate,
      navPerUnit: f.operatingModel === 'OPEN_ENDED' ? (ov?.navPerUnit ?? null) : null,
      dealingRules: f.operatingModel === 'OPEN_ENDED' ? { ...rules, navHistory } : null,
      wiring: wiring
        ? { bankName: wiring.bankName, accountName: wiring.accountName, accountNumberMasked: wiring.accountNumberMasked, abaRouting: wiring.abaRouting }
        : null,
    };
  });

  const clients: UatSeed['clients'] = [
    {
      key: 'A',
      ref: REF.clientA,
      name: s.client.legalName,
      type: 'Pension fund',
      email: store.organisation.email,
      phone: store.organisation.phone,
      address: store.organisation.address,
      country: store.organisation.country,
      baseCurrency: s.presentationCurrency,
      kycStatus: 'Current',
      mockInvestorId: s.client.investorId,
    },
    {
      key: 'B',
      ref: REF.clientB,
      name: 'Kariba Provident Fund',
      type: 'Pension fund',
      email: 'ir@kariba-provident.example',
      phone: '+263 242 111 111',
      address: '4 Nelson Mandela Avenue, Harare',
      country: 'Zimbabwe',
      baseCurrency: 'USD',
      kycStatus: 'Current',
      mockInvestorId: null,
    },
  ];

  const commitments: UatSeed['commitments'] = [
    {
      client: 'A',
      fund: fundRef(GROWTH),
      amount: s.funds.find((f) => f.fundId === GROWTH)!.commitmentAmount,
      investorAccountRef: s.funds.find((f) => f.fundId === GROWTH)!.investorAccountReference,
      metrics: {
        ...growthKpis,
        called: money(num(growthKpis.paidIn) + seededOutstanding),
        byFund: rowFor(GROWTH),
        asOfDate: AS_OF,
        valuationStatus: 'FINAL',
        // Paid-in / distributions before the first call that exists on the platform (CC-010).
        // paidIn = openingPaidIn + sum(paid allocations); distributions = openingDistributions + sum(paid).
        openingPaidIn: money(num(growthKpis.paidIn) - seededPaid),
        openingDistributions: money(num(growthKpis.distributions) - seededDist),
      },
    },
    {
      client: 'A',
      fund: fundRef(EQUITY),
      amount: s.funds.find((f) => f.fundId === EQUITY)!.commitmentAmount,
      investorAccountRef: s.funds.find((f) => f.fundId === EQUITY)!.investorAccountReference,
      metrics: { ...equityKpis, byFund: rowFor(EQUITY), asOfDate: AS_OF, valuationStatus: 'FINAL', openEndedSummary: store.dashboards[EQUITY]!.openEndedSummary ?? null },
    },
    {
      client: 'B',
      fund: fundRef(GROWTH),
      amount: '1000000.00',
      investorAccountRef: 'INV-AGFI-2051',
      metrics: {
        totalCommitment: '1000000.00',
        paidIn: money(num(growthKpis.paidIn) * B_SHARE),
        unfunded: money(num(growthKpis.unfunded) * B_SHARE),
        currentNav: money(num(growthKpis.currentNav) * B_SHARE),
        distributions: money(num(growthKpis.distributions) * B_SHARE),
        netIrr: growthKpis.netIrr,
        tvpi: growthKpis.tvpi,
        dpi: growthKpis.dpi,
        rvpi: growthKpis.rvpi,
        investmentCount: 1,
        asOfDate: AS_OF,
        valuationStatus: 'FINAL',
        openingPaidIn: money((num(growthKpis.paidIn) - seededPaid) * B_SHARE),
        openingDistributions: money((num(growthKpis.distributions) - seededDist) * B_SHARE),
      },
    },
  ];

  const eq = store.dealingOverviews[EQUITY]!;
  const holdings: UatSeed['holdings'] = [
    {
      client: 'A',
      fund: fundRef(EQUITY),
      shareClassCode: eq.shareClass,
      units: eq.unitsHeld,
      navPerUnit: eq.navPerUnit,
      accountValue: eq.accountValue,
      accountRef: s.funds.find((f) => f.fundId === EQUITY)!.investorAccountReference,
      asOfDate: eq.asOfDate,
      valuationStatus: eq.valuationStatus,
    },
  ];

  const bankAccounts: UatSeed['bankAccounts'] = store.bankAccounts.map((b) => ({
    client: 'A',
    key: b.id,
    label: b.label,
    bankName: b.bankName,
    accountName: b.accountName,
    masked: b.accountNumberMasked,
    currency: b.currencyCode,
    isDefault: b.isDefault,
    fund: b.fundId ? fundRef(b.fundId) : null,
  }));
  bankAccounts.push({ client: 'B', key: 'bank-b1', label: 'Primary USD', bankName: 'CBZ Bank', accountName: 'Kariba Provident Fund', masked: '•••• 2290', currency: 'USD', isDefault: true, fund: null });

  const step = (c: (typeof store.capitalCalls)[number], code: string) => c.timeline.find((t) => t.code === code)?.at ?? null;
  const capitalCalls: UatSeed['capitalCalls'] = store.capitalCalls.map((c) => {
    const amountA = num(c.amount);
    const paidA = num(c.paid);
    return {
      ref: `CC-AGFI-${String(c.callNo).padStart(3, '0')}`,
      mockId: c.id,
      fund: fundRef(c.fundId),
      callNo: c.callNo,
      issueDate: c.issueDate,
      dueDate: c.dueDate,
      currency: c.currencyCode,
      status: c.status,
      totalAmount: money(amountA * (1 + B_SHARE)),
      issuedAt: step(c, 'ISSUED') ?? `${c.issueDate}T09:00:00Z`,
      wire: { bankName: c.wiring.bankName, accountName: c.wiring.accountName, accountNumberMasked: c.wiring.accountNumberMasked, abaRouting: c.wiring.abaRouting, reference: c.wiring.reference },
      wireText: c.wiring.raw,
      purpose: `Capital call #${c.callNo} for ${c.fundName}`,
      noticeDocumentRef: store.capitalCallDocuments[c.id]?.[0] ? upperRef('LP-DOC-', store.capitalCallDocuments[c.id]![0]!.id) : null,
      allocations: [
        { client: 'A', amount: money(amountA), paid: money(paidA), acknowledgedAt: c.acknowledgedAt, paymentReceivedAt: step(c, 'PAYMENT_RECEIVED') },
        { client: 'B', amount: money(amountA * B_SHARE), paid: money(paidA * B_SHARE), acknowledgedAt: c.acknowledgedAt, paymentReceivedAt: step(c, 'PAYMENT_RECEIVED') },
      ],
    };
  });

  const distributions: UatSeed['distributions'] = store.distributions.map((d) => ({
    ref: d.reference,
    mockId: d.id,
    fund: fundRef(d.fundId),
    date: d.paymentDate,
    type: DIST_TYPE[d.type] ?? 'OTHER',
    typeLabel: d.type,
    currency: d.currencyCode,
    status: d.status,
    gross: money(num(d.gross) * (1 + B_SHARE)),
    adjustments: money(num(d.adjustments) * (1 + B_SHARE)),
    net: money(num(d.netPaid) * (1 + B_SHARE)),
    allocations: [
      { client: 'A', gross: d.gross, adjustments: d.adjustments, net: d.netPaid, bankMasked: d.destinationBankMasked, documentRef: d.documentId ? upperRef('LP-DOC-', d.documentId) : null },
      { client: 'B', gross: money(num(d.gross) * B_SHARE), adjustments: money(num(d.adjustments) * B_SHARE), net: money(num(d.netPaid) * B_SHARE), bankMasked: '•••• 2290', documentRef: null },
    ],
  }));

  const documents: UatSeed['documents'] = store.documents.map((d) => {
    const category = DOC_CATEGORY[d.category] ?? 'MANUAL';
    const source = d.sourceType === 'CAPITAL_CALL' ? store.capitalCalls.find((c) => c.id === d.sourceRefId) : null;
    return {
      ref: upperRef('LP-DOC-', d.id),
      mockId: d.id,
      client: 'A',
      fund: fundRef(d.fundId),
      name: d.name,
      category,
      type: DOC_TYPE[category] ?? 'other',
      label: d.category,
      period: d.period,
      publishedDate: d.publishedDate,
      status: d.status,
      requiresSignature: d.status === 'REQUIRES_SIGNATURE',
      sourceType: d.sourceType ?? null,
      sourceRef: source ? `CC-AGFI-${String(source.callNo).padStart(3, '0')}` : d.sourceRefId ? d.sourceRefId.toUpperCase() : null,
      mimeType: d.mimeType ?? 'application/pdf',
    };
  });
  documents.push({
    ref: 'LP-DOC-B01',
    mockId: null,
    client: 'B',
    fund: fundRef(GROWTH),
    name: 'Q2 2026 Investor Report - Kariba Provident Fund',
    category: 'PERFORMANCE_REPORT',
    type: 'report',
    label: 'Fund Reports',
    period: 'Q2 2026',
    publishedDate: '2026-07-10',
    status: 'PUBLISHED',
    requiresSignature: false,
    sourceType: null,
    sourceRef: null,
    mimeType: 'application/pdf',
  });

  const notices: UatSeed['notices'] = store.notices.map((n) => ({
    ref: `NTC-${n.id.replace(/\D/g, '').padStart(4, '0')}`,
    mockId: n.id,
    client: 'A',
    fund: fundRef(n.fundId),
    title: n.title,
    body: n.body ?? n.preview ?? n.title,
    category: n.category ?? 'GENERAL',
    kind: n.kind ?? 'INFO',
    shareClass: n.shareClass,
    requiresAcknowledgement: n.requiresAcknowledgement ?? false,
    publishedAt: n.publishedAt,
    receipts: n.openedAt || n.acknowledgedAt ? [{ persona: 'lp_a_manager', openedAt: n.openedAt ?? n.acknowledgedAt, acknowledgedAt: n.acknowledgedAt }] : [],
  }));
  notices.push({
    ref: 'NTC-B001',
    mockId: null,
    client: 'B',
    fund: fundRef(GROWTH),
    title: 'Kariba Provident Fund: Q2 2026 report available',
    body: 'Dear Investor,\n\nYour Q2 2026 investor report is available in the Document Centre.\n\nMatanho Investor Relations',
    category: 'REPORT',
    kind: 'INFO',
    shareClass: null,
    requiresAcknowledgement: false,
    publishedAt: '2026-07-10T08:00:00Z',
    receipts: [],
  });

  const requests: UatSeed['requests'] = store.requests.map((r) => ({
    ref: r.reference,
    client: 'A',
    fund: fundRef(r.fundId),
    type: r.type,
    priority: r.priority === 'HIGH' ? 'High' : r.priority === 'LOW' ? 'Low' : 'Normal',
    subject: r.subject,
    description: r.description,
    lpStatus: r.status,
    legacyStatus: REQUEST_LEGACY_STATUS[r.status] ?? 'Open',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    submittedBy: 'lp_a_manager',
  }));
  requests.push({
    ref: 'REQ-9001',
    client: 'B',
    fund: fundRef(GROWTH),
    type: 'Account / Statement',
    priority: 'Normal',
    subject: 'Confirm Q2 statement delivery address',
    description: 'Please confirm the statement delivery address for Kariba Provident Fund.',
    lpStatus: 'SUBMITTED',
    legacyStatus: 'Open',
    createdAt: '2026-07-14T09:00:00Z',
    updatedAt: '2026-07-14T09:00:00Z',
    submittedBy: 'lp_b_signatory',
  });

  const threads: UatSeed['threads'] = store.messageThreads.map((t) => {
    const internal = t.participants?.find((p) => p.role === 'INTERNAL');
    return {
      key: t.id,
      client: 'A',
      fund: fundRef(t.fundId),
      subject: t.subject,
      relatedType: t.relatedType,
      relatedRequestRef: t.relatedType === 'REQUEST' ? t.relatedId : null,
      status: t.status,
      ownerName: internal?.name ?? 'Matanho Investor Relations',
      ownerRole: 'Client Services',
      messages: t.messages.map((m) => ({
        fromClient: m.authorType === 'INVESTOR',
        authorName: m.authorType === 'INVESTOR' ? (t.participants?.find((p) => p.role !== 'INTERNAL')?.name ?? 'Investor') : (internal?.name ?? 'Matanho'),
        authorPersona: m.authorType === 'INVESTOR' ? 'lp_a_manager' : null,
        body: m.body,
        createdAt: m.createdAt,
        readAt: m.readAt,
      })),
    };
  });

  const dealingRequests: UatSeed['dealingRequests'] = store.dealingRequests.map((d) => ({
    ref: d.id.replace(/^deal-/, '').toUpperCase(),
    mockId: d.id,
    client: 'A',
    fund: fundRef(d.fundId),
    shareClassCode: d.shareClass ?? 'DEFAULT',
    requestType: d.requestType,
    inputMode: d.redemptionMode === 'UNITS' ? 'UNITS' : d.redemptionMode === 'FULL' ? 'FULL' : 'AMOUNT',
    redemptionMode: d.requestType === 'REDEMPTION' ? (d.redemptionMode === 'FULL' ? 'FULL' : 'PARTIAL') : null,
    amount: d.amount,
    units: d.units,
    currency: d.currencyCode,
    requestedDealingDate: d.requestedDealingDate,
    status: DEALING_STATUS[d.status] ?? d.status,
    mockStatus: d.status,
    notes: d.notes ?? null,
    createdAt: d.createdAt,
  }));

  const notifications: UatSeed['notifications'] = store.notifications.map((n) => ({
    persona: 'lp_a_manager',
    type: n.type ?? 'GENERAL',
    title: n.title,
    link: n.href,
    createdAt: n.createdAt,
    read: !!n.read,
  }));

  return { funds, clients, commitments, holdings, bankAccounts, capitalCalls, distributions, documents, notices, requests, threads, dealingRequests, notifications };
}

// ------------------------------------------------------------------ personas (no credentials)
const PERSONAS: UatSeed['personas'] = [
  { key: 'sysadmin', kind: 'staff', name: 'UAT System Administrator', roles: ['admin:system_admin'] },
  { key: 'client_services', kind: 'staff', name: 'UAT Client Services (maker)', roles: ['admin:client_services'] },
  { key: 'compliance', kind: 'staff', name: 'UAT Compliance Officer', roles: ['admin:compliance'] },
  { key: 'investment_director', kind: 'staff', name: 'UAT Investment Director (approver)', roles: ['admin:investment_director'] },
  { key: 'operations', kind: 'staff', name: 'UAT Operations (settlement)', roles: ['admin:operations'] },
  { key: 'analyst', kind: 'staff', name: 'UAT Analyst (second reviewer)', roles: ['admin:analyst'] },
  { key: 'lp_a_manager', kind: 'lp', name: 'Jane Smith', roles: ['investor:admin'], client: 'A', investorRole: 'admin', lpRole: 'MANAGER', funds: null },
  { key: 'lp_a_signatory', kind: 'lp', name: 'Tawanda Moyo', roles: ['investor:finance'], client: 'A', investorRole: 'finance', lpRole: 'SIGNATORY', funds: [REF.fund[GROWTH]!] },
  { key: 'lp_a_viewer', kind: 'lp', name: 'Rudo Maposa', roles: ['investor:auditor'], client: 'A', investorRole: 'auditor', lpRole: 'VIEWER', funds: null },
  { key: 'lp_b_signatory', kind: 'lp', name: 'Kariba Signatory', roles: ['investor:finance'], client: 'B', investorRole: 'finance', lpRole: 'SIGNATORY', funds: null },
  { key: 'investee_101_approver', kind: 'investee', name: 'Tariro Moyo', roles: [], company: REF.company101, profile: 'executive_approver', title: 'Chief Executive Officer' },
  { key: 'investee_101_contributor', kind: 'investee', name: 'Nyasha Chikore', roles: [], company: REF.company101, profile: 'report_contributor', title: 'Finance Manager' },
  { key: 'investee_101_viewer', kind: 'investee', name: 'Rudo Ncube', roles: [], company: REF.company101, profile: 'read_only', title: 'Impact Lead' },
  { key: 'investee_102_admin', kind: 'investee', name: 'Mosi Administrator', roles: [], company: REF.company102, profile: 'workspace_administrator', title: 'Chief Financial Officer' },
  { key: 'custodian_submitter', kind: 'custodian', name: 'Custodian Submitter', roles: ['custodian:submitter'], counterparty: REF.counterparty, counterpartyRole: 'submitter' },
  { key: 'custodian_approver', kind: 'custodian', name: 'Custodian Approver', roles: ['custodian:approver'], counterparty: REF.counterparty, counterpartyRole: 'approver' },
];

function build(): UatSeed {
  return {
    version: 1,
    note: 'GENERATED by tools/uat/export-mock-seed.ts from the LP mock store and the Investee runtime fixtures. Do not edit by hand.',
    asOfDate: AS_OF,
    personas: PERSONAS,
    ...buildLp(),
    ...buildCompanies(),
    counterparties: [{ ref: REF.counterparty, name: 'Stanbic Custodial Services', type: 'CUSTODIAN', accounts: [`CUST-${REF.clientA}`] }],
  };
}

const json = `${JSON.stringify(build(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    /* missing */
  }
  if (current !== json) {
    console.error(`${path.relative(root, OUT)} is stale - run: npx tsx tools/uat/export-mock-seed.ts`);
    process.exit(1);
  }
  console.log(`${path.relative(root, OUT)} is up to date`);
} else {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  const d = JSON.parse(json) as UatSeed;
  console.log(
    `wrote ${path.relative(root, OUT)}: ${d.personas.length} personas, ${d.funds.length} funds, ${d.clients.length} clients, ` +
      `${d.capitalCalls.length} calls, ${d.distributions.length} distributions, ${d.documents.length} documents, ${d.notices.length} notices, ` +
      `${d.requests.length} requests, ${d.threads.length} threads, ${d.dealingRequests.length} dealing requests, ${d.companies.length} companies`,
  );
}
