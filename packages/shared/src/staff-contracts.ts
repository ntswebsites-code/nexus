/**
 * Staff-module response contracts (GAP-025). The zod schemas here are the single definition of what the
 * admin console reads from `/api/v1/*`; `portals/admin-web/src/ops/types.ts` derives its types from them
 * and `tools/uat/contract-staff.ts` validates a running API against them, one entry per module.
 *
 * Money is a decimal string; dates are ISO strings. Schemas strip unknown keys (the API may add fields
 * without breaking the console) but reject missing or mistyped ones.
 */
import { z } from 'zod';

const dec = z.string();
const iso = z.string();
const opt = <T extends z.ZodType>(t: T) => t.nullish();

// ---------------------------------------------------------------- ops: funds, calls, distributions

export const OpsFundSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  name: z.string(),
  shortName: z.string(),
  publicReference: opt(z.string()),
  operatingModel: z.string(),
  currency: z.string(),
  vintage: opt(z.number()),
  status: z.string().optional(),
  portalVisible: z.boolean().optional(),
  defaultShareClass: opt(z.string()),
  navPerUnit: opt(dec),
  totalNav: opt(dec),
  asOfDate: opt(iso),
  valuationStatus: opt(z.string()),
  totalCommitted: opt(dec),
  commitmentCount: opt(z.number()),
  version: z.number(),
});
export type OpsFund = z.infer<typeof OpsFundSchema>;

export const OpsCapitalCallRowSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  fundId: z.string(),
  fundName: opt(z.string()),
  dueDate: iso,
  totalAmount: dec,
  currency: z.string(),
  status: z.string(),
  version: z.number().optional(),
});
export type OpsCapitalCallRow = z.infer<typeof OpsCapitalCallRowSchema>;

export const OpsDistributionRowSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  fundId: z.string(),
  fundName: opt(z.string()),
  distributionDate: iso,
  type: z.string(),
  currency: z.string(),
  grossAmount: dec,
  netToLps: dec,
  status: z.string(),
  version: z.number().optional(),
});
export type OpsDistributionRow = z.infer<typeof OpsDistributionRowSchema>;

export const OpsNoticeSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  title: z.string(),
  body: z.string(),
  category: z.string(),
  targetType: z.string(),
  requiresAcknowledgement: z.boolean(),
  status: z.string(),
  publishedAt: opt(iso),
  expiresAt: opt(iso),
  receiptCount: opt(z.number()),
  acknowledgedCount: opt(z.number()),
});
export type OpsNotice = z.infer<typeof OpsNoticeSchema>;

export const OpsDealingRequestSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  clientId: z.string(),
  clientName: opt(z.string()),
  fundId: z.string(),
  fundName: opt(z.string()),
  requestType: z.string(),
  amount: opt(dec),
  units: opt(dec),
  currency: z.string(),
  status: z.string(),
  createdAt: iso.optional(),
});
export type OpsDealingRequest = z.infer<typeof OpsDealingRequestSchema>;

export const OpsTermSheetSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  companyId: z.string(),
  companyName: opt(z.string()),
  title: z.string(),
  status: z.string(),
  investmentAmount: dec,
  valuation: dec,
  equityPercentage: dec,
  currency: z.string(),
  version: z.number().optional(),
});
export type OpsTermSheet = z.infer<typeof OpsTermSheetSchema>;

// ---------------------------------------------------------------- custodian (staff and counterparty views)

export const DayEndPackageSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  counterpartyId: z.string().optional(),
  counterpartyName: opt(z.string()),
  accountRef: z.string(),
  statementDate: z.string(),
  currency: z.string(),
  closingCash: dec,
  holdingsMv: dec,
  tradeCount: z.number(),
  tradeQuantity: opt(dec),
  tradeNotional: opt(dec),
  sha256: opt(z.string()),
  note: opt(z.string()),
  status: z.string(),
  submittedAt: iso,
  approvedAt: opt(iso),
});
export type DayEndPackage = z.infer<typeof DayEndPackageSchema>;

export const CustodianExecutionSchema = z.object({
  id: z.string(),
  ref: z.string(),
  tradeRef: z.string(),
  executionAt: iso,
  accountRef: z.string(),
  ticker: z.string(),
  isin: opt(z.string()),
  side: z.enum(['BUY', 'SELL']),
  quantity: dec,
  price: dec,
  currency: z.string(),
  settlementDate: opt(z.string()),
  broker: opt(z.string()),
  note: opt(z.string()),
  status: z.string(),
  amendable: z.boolean(),
  batchId: opt(z.string()),
  amendCount: z.number(),
  amendedAt: opt(iso),
  cancelledAt: opt(iso),
  submittedAt: iso,
});
export type CustodianExecution = z.infer<typeof CustodianExecutionSchema>;

export const CustodianBatchSchema = z.object({
  id: z.string(),
  ref: z.string(),
  fileName: z.string(),
  rowCount: z.number(),
  acceptedCount: z.number(),
  duplicateCount: z.number(),
  rejectedCount: z.number(),
  declared: z.object({ count: opt(z.number()), quantity: opt(dec), notional: opt(dec) }),
  actual: z.object({ quantity: dec, notional: dec }),
  controlStatus: z.enum(['NONE', 'OK', 'MISMATCH']),
  status: z.enum(['Accepted', 'Rejected']),
  submittedAt: iso,
});
export type CustodianBatch = z.infer<typeof CustodianBatchSchema>;

export const CustodianEventSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  action: z.string(),
  fromStatus: opt(z.string()),
  toStatus: z.string(),
  reason: opt(z.string()),
  by: z.string(),
  at: iso,
  ref: opt(z.string()),
  tradeRef: opt(z.string()),
});
export type CustodianEvent = z.infer<typeof CustodianEventSchema>;

// ---------------------------------------------------------------- portfolio foundation

const PriceViewSchema = z.object({ price: z.string(), priceDate: z.string(), source: z.string() });
export const PortfolioSummarySchema = z.object({
  id: z.string(),
  ref: z.string(),
  name: z.string(),
  type: z.string(),
  baseCurrency: z.string(),
  clientId: z.string().nullable(),
  managerUserId: z.string().nullable(),
  benchmark: z.string().nullable(),
  status: z.string(),
  version: z.number(),
  asOf: z.string(),
  marketValueBase: z.string(),
  securitiesValueBase: z.string(),
  cashBase: z.string(),
  cashPct: z.string(),
  positionCount: z.number(),
  largestPositionTicker: z.string().nullable(),
  largestPositionPct: z.string(),
  warnings: z.number(),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

export const SecurityRowSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  isin: z.string().nullable(),
  name: z.string(),
  market: z.string(),
  assetClass: z.string(),
  currency: z.string(),
  boardLot: z.number(),
  sector: z.string().nullable(),
  status: z.string(),
  latestPrice: PriceViewSchema.nullable(),
  previousPrice: PriceViewSchema.nullable(),
  change: z.string().nullable(),
  changePct: z.string().nullable(),
});
export type SecurityRow = z.infer<typeof SecurityRowSchema>;

// ---------------------------------------------------------------- realtime polling contract (LP portal, GAP-017)

/** `GET /api/v1/lp-portal/realtime?since=<cursor>`: the polling contract that stands in for push. */
export const LpRealtimeSchema = z.object({
  cursor: z.string(),
  pollAfterMs: z.number().int().min(1000),
  events: z.array(z.object({ id: z.string(), type: z.string(), at: iso, resource: z.string().optional(), refId: z.string().optional() })),
});
export type LpRealtime = z.infer<typeof LpRealtimeSchema>;

// ---------------------------------------------------------------- registry: one contract test per module

export interface StaffContract {
  /** Module name used in reports. */
  module: string;
  /** Read-only GET that must answer 200 for a staff user holding the permission. */
  path: string;
  /** Permission the persona needs (informational; the harness reports a 403 as SKIPPED). */
  permission: string;
  /** Key holding the array in the response body (`data`, `items`, ...). */
  listKey: string;
  schema: z.ZodType;
  portal?: 'admin' | 'custodian' | 'investor';
}

export const STAFF_CONTRACTS: StaffContract[] = [
  { module: 'ops/funds', path: '/api/v1/ops/funds', permission: 'funds.view', listKey: 'data', schema: OpsFundSchema },
  { module: 'ops/capital-calls', path: '/api/v1/ops/capital-calls', permission: 'capital.view', listKey: 'data', schema: OpsCapitalCallRowSchema },
  { module: 'ops/distributions', path: '/api/v1/ops/distributions', permission: 'capital.view', listKey: 'data', schema: OpsDistributionRowSchema },
  { module: 'ops/notices', path: '/api/v1/ops/notices', permission: 'notices.view', listKey: 'data', schema: OpsNoticeSchema },
  { module: 'ops/dealing', path: '/api/v1/ops/dealing', permission: 'dealing.view', listKey: 'data', schema: OpsDealingRequestSchema },
  { module: 'ops/term-sheets', path: '/api/v1/ops/term-sheets', permission: 'term_sheets.view', listKey: 'data', schema: OpsTermSheetSchema },
  { module: 'ops/custodian', path: '/api/v1/ops/custodian/submissions', permission: 'custodian.view', listKey: 'dayEnds', schema: DayEndPackageSchema },
  { module: 'portfolios', path: '/api/v1/portfolios', permission: 'portfolio.view', listKey: 'data', schema: PortfolioSummarySchema },
  { module: 'securities', path: '/api/v1/securities', permission: 'portfolio.view', listKey: 'data', schema: SecurityRowSchema },
  { module: 'custodian/executions', path: '/api/v1/custodian/executions', permission: 'custodian.portal.access', listKey: 'items', schema: CustodianExecutionSchema, portal: 'custodian' },
  { module: 'custodian/batches', path: '/api/v1/custodian/executions-batches', permission: 'custodian.portal.access', listKey: 'items', schema: CustodianBatchSchema, portal: 'custodian' },
  { module: 'custodian/history', path: '/api/v1/custodian/history', permission: 'custodian.portal.access', listKey: 'items', schema: CustodianEventSchema, portal: 'custodian' },
];
