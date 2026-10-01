/**
 * Shape of tools/uat/seed-data/uat-seed.json (written by export-mock-seed.ts, loaded by
 * backend/api/prisma/seed-uat.ts). Money/units are decimal strings; dates are ISO strings.
 * Client keys are 'A' / 'B'; funds, companies and counterparties are addressed by `ref`.
 */
export type ClientKey = 'A' | 'B';

export interface SeedPersona {
  key: string;
  kind: 'staff' | 'lp' | 'investee' | 'custodian';
  name: string;
  /** "<portal>:<roleKey>" (role-catalog.json). Investee users are linked, not role-based. */
  roles: string[];
  client?: ClientKey;
  investorRole?: string;
  lpRole?: 'VIEWER' | 'SIGNATORY' | 'MANAGER';
  /** Fund refs the LP member may see; null = all of the client's commitments. */
  funds?: string[] | null;
  company?: string;
  profile?: string;
  title?: string;
  counterparty?: string;
  counterpartyRole?: 'submitter' | 'approver';
}

export interface UatSeed {
  version: 1;
  note: string;
  asOfDate: string;
  personas: SeedPersona[];
  funds: {
    ref: string;
    mockId: string;
    name: string;
    shortName: string;
    publicReference: string;
    operatingModel: 'PRIVATE_CAPITAL' | 'OPEN_ENDED';
    currency: string;
    defaultShareClass: string | null;
    valuationStatus: string;
    asOfDate: string;
    navPerUnit: string | null;
    dealingRules: Record<string, unknown> | null;
    wiring: Record<string, string> | null;
  }[];
  clients: {
    key: ClientKey;
    ref: string;
    name: string;
    type: string;
    email: string;
    phone: string;
    address: string;
    country: string;
    baseCurrency: string;
    kycStatus: string;
    mockInvestorId: string | null;
  }[];
  commitments: { client: ClientKey; fund: string; amount: string; investorAccountRef: string; metrics: Record<string, unknown> }[];
  holdings: {
    client: ClientKey;
    fund: string;
    shareClassCode: string;
    units: string;
    navPerUnit: string;
    accountValue: string;
    accountRef: string;
    asOfDate: string;
    valuationStatus: string;
  }[];
  bankAccounts: {
    client: ClientKey;
    key: string;
    label: string;
    bankName: string;
    accountName: string;
    masked: string;
    currency: string;
    isDefault: boolean;
    fund: string | null;
  }[];
  capitalCalls: {
    ref: string;
    mockId: string;
    fund: string;
    callNo: number;
    issueDate: string;
    dueDate: string;
    currency: string;
    /** Mock status: ISSUED | PAID ... */
    status: string;
    totalAmount: string;
    issuedAt: string;
    wire: Record<string, string>;
    wireText: string | null;
    purpose: string;
    noticeDocumentRef: string | null;
    allocations: { client: ClientKey; amount: string; paid: string; acknowledgedAt: string | null; paymentReceivedAt: string | null }[];
  }[];
  distributions: {
    ref: string;
    mockId: string;
    fund: string;
    date: string;
    type: string;
    typeLabel: string;
    currency: string;
    status: string;
    gross: string;
    adjustments: string;
    net: string;
    allocations: { client: ClientKey; gross: string; adjustments: string; net: string; bankMasked: string | null; documentRef: string | null }[];
  }[];
  documents: {
    ref: string;
    mockId: string | null;
    client: ClientKey;
    fund: string;
    name: string;
    category: string;
    type: string;
    label: string;
    period: string | null;
    publishedDate: string;
    status: string;
    requiresSignature: boolean;
    sourceType: string | null;
    sourceRef: string | null;
    mimeType: string;
  }[];
  notices: {
    ref: string;
    mockId: string | null;
    client: ClientKey;
    fund: string;
    title: string;
    body: string;
    category: string;
    kind: string;
    shareClass: string | null;
    requiresAcknowledgement: boolean;
    publishedAt: string;
    receipts: { persona: string; openedAt: string | null; acknowledgedAt: string | null }[];
  }[];
  requests: {
    ref: string;
    client: ClientKey;
    fund: string;
    type: string;
    priority: string;
    subject: string;
    description: string;
    lpStatus: string;
    legacyStatus: string;
    createdAt: string;
    updatedAt: string;
    submittedBy: string;
  }[];
  threads: {
    key: string;
    client: ClientKey;
    fund: string;
    subject: string;
    relatedType: string;
    relatedRequestRef: string | null;
    status: string;
    ownerName: string;
    ownerRole: string;
    messages: { fromClient: boolean; authorName: string; authorPersona: string | null; body: string; createdAt: string; readAt: string | null }[];
  }[];
  dealingRequests: {
    ref: string;
    mockId: string;
    client: ClientKey;
    fund: string;
    shareClassCode: string;
    requestType: 'SUBSCRIPTION' | 'REDEMPTION';
    inputMode: string;
    redemptionMode: string | null;
    amount: string;
    units: string;
    currency: string;
    requestedDealingDate: string;
    status: string;
    mockStatus: string;
    notes: string | null;
    createdAt: string;
  }[];
  notifications: { persona: string; type: string; title: string; link: string; createdAt: string; read: boolean }[];
  companies: {
    ref: string;
    name: string;
    legalName: string;
    ticker: string;
    sector: string;
    country: string;
    fundingStage: string;
    reportingCurrency: string;
    status: string;
    relationship: Record<string, unknown>;
    contacts: unknown[];
    kpis: { key: string; label: string; unit: string; prev: number; budget: number; series: number[]; sort: number }[];
    covenants: { id: string; name: string; threshold: string; actual: number; limit: number; unit: string; headroom: string; evidence: string; note?: string; sort: number }[];
    periods: { period: string; periodType: string; label: string; due: string; status: 'open' | 'accepted' | 'returned' | 'submitted'; reviewNote?: string }[];
  }[];
  termSheets: {
    ref: string;
    company: string;
    title: string;
    status: string;
    investmentAmount: string;
    valuation: string;
    equityPercentage: string;
    currency: string;
    keyTerms: Record<string, unknown>;
    conditions: string;
    timeline: string;
  }[];
  counterparties: { ref: string; name: string; type: string; accounts: string[] }[];
}
