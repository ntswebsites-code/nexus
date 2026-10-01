/**
 * Shapes the console reads from `/api/v1/ops/*`. Field names follow the Prisma models
 * (Fund, FundCommitment, CapitalCall, ...). Money is a decimal string; dates are ISO strings.
 * Optional display fields (names, nested relations) are read defensively.
 */

export type Decimal = string;

export interface Fund {
  id: string;
  ref?: string;
  name: string;
  shortName: string;
  publicReference?: string | null;
  operatingModel: 'PRIVATE_CAPITAL' | 'OPEN_ENDED' | string;
  currency: string;
  vintage?: number | null;
  status?: string;
  portalVisible?: boolean;
  defaultShareClass?: string | null;
  navPerUnit?: Decimal | null;
  totalNav?: Decimal | null;
  asOfDate?: string | null;
  valuationStatus?: string | null;
  totalCommitted?: Decimal | null;
  commitmentCount?: number | null;
  version: number;
  commitments?: FundCommitment[];
}

export interface FundCommitment {
  id: string;
  clientId: string;
  clientName?: string | null;
  clientRef?: string | null;
  client?: { id?: string; ref?: string; name?: string } | null;
  fundId: string;
  commitmentAmount: Decimal;
  currency: string;
  status: 'PENDING' | 'ACTIVE' | 'CLOSED' | string;
  effectiveDate?: string | null;
  investorAccountRef?: string | null;
  calledToDate?: Decimal | null;
  paidIn?: Decimal | null;
  unfunded?: Decimal | null;
  version: number;
}

export type CallStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface Evidence {
  id: string;
  allocationId?: string | null;
  name?: string | null;
  fileName?: string | null;
  mime?: string | null;
  uploadedAt?: string | null;
  createdAt?: string | null;
  uploadedByName?: string | null;
  uploadedById?: string | null;
  url?: string | null;
}

export interface Payment {
  id: string;
  allocationId: string;
  amount: Decimal;
  recordedAt?: string | null;
  paidAt?: string | null;
  recordedById?: string | null;
  recordedByName?: string | null;
  bankReference?: string | null;
  reference?: string | null;
  confirmationId?: string | null;
  evidenceId?: string | null;
}

export interface CallAllocation {
  id: string;
  clientId: string;
  clientName?: string | null;
  lpLegalNameSnapshot?: string | null;
  totalCommitmentSnapshot?: Decimal | null;
  uncalledBeforeSnapshot?: Decimal | null;
  callAmount: Decimal;
  amountPaid: Decimal;
  status: string;
  acknowledgedAt?: string | null;
  payments?: Payment[];
  evidence?: Evidence[];
}

export interface CapitalCall {
  id: string;
  ref?: string;
  fundId: string;
  fundName?: string | null;
  fund?: { id?: string; name?: string; shortName?: string } | null;
  callNo?: number;
  callDate?: string | null;
  transactionDate?: string | null;
  dueDate: string;
  purpose?: string | null;
  totalAmount: Decimal;
  currency: string;
  status: CallStatus | string;
  allocationMethod?: string | null;
  makerId?: string | null;
  makerName?: string | null;
  checkerId?: string | null;
  checkerName?: string | null;
  approvedAt?: string | null;
  issuedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  version?: number;
  amountPaid?: Decimal | null;
  allocations?: CallAllocation[];
  payments?: Payment[];
  evidence?: Evidence[];
}

export interface DistributionAllocation {
  id: string;
  clientId: string;
  clientName?: string | null;
  lpLegalNameSnapshot?: string | null;
  commitmentSnapshot?: Decimal | null;
  paidInSnapshot?: Decimal | null;
  grossShare?: Decimal | null;
  adjustments?: Decimal | null;
  shareAmount: Decimal;
  amountPaid: Decimal;
  status: string;
  paidAt?: string | null;
  payments?: Payment[];
}

export interface Distribution {
  id: string;
  ref?: string;
  fundId: string;
  fundName?: string | null;
  fund?: { id?: string; name?: string; shortName?: string } | null;
  distributionDate: string;
  type: string;
  currency: string;
  grossAmount: Decimal;
  carryAmount?: Decimal | null;
  adjustmentsAmount?: Decimal | null;
  netToLps: Decimal;
  status: CallStatus | string;
  notes?: string | null;
  makerId?: string | null;
  makerName?: string | null;
  checkerId?: string | null;
  checkerName?: string | null;
  issuedAt?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  version?: number;
  allocations?: DistributionAllocation[];
  payments?: Payment[];
}

export interface LpNotice {
  id: string;
  ref?: string;
  title: string;
  body: string;
  category: string;
  targetType: 'ALL' | 'FUND' | 'ORG' | 'USER' | string;
  fundId?: string | null;
  fundName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  userId?: string | null;
  requiresAcknowledgement: boolean;
  status: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  approvedById?: string | null;
  createdAt?: string;
  receiptCount?: number | null;
  acknowledgedCount?: number | null;
}

export interface LpNoticeReceipt {
  id: string;
  noticeId: string;
  clientId: string;
  clientName?: string | null;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  deliveredAt: string;
  openedAt?: string | null;
  acknowledgedAt?: string | null;
}

export interface DealingRequest {
  id: string;
  ref?: string;
  clientId: string;
  clientName?: string | null;
  fundId: string;
  fundName?: string | null;
  shareClassCode?: string;
  requestType: 'SUBSCRIPTION' | 'REDEMPTION' | string;
  inputMode?: string;
  redemptionMode?: string | null;
  amount?: Decimal | null;
  units?: Decimal | null;
  currency: string;
  requestedDealingDate?: string | null;
  status: string;
  submittedById?: string | null;
  submittedByName?: string | null;
  processedById?: string | null;
  approvedById?: string | null;
  dealingNavPerUnit?: Decimal | null;
  unitsAllocated?: Decimal | null;
  rejectionReason?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface TermSheet {
  id: string;
  ref?: string;
  companyId: string;
  companyName?: string | null;
  company?: { id?: string; ref?: string; name?: string } | null;
  title: string;
  versionNo?: number;
  status: string;
  investmentAmount: Decimal;
  valuation: Decimal;
  equityPercentage: Decimal;
  currency: string;
  keyTerms?: unknown;
  conditions?: string | null;
  timeline?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  approvedById?: string | null;
  approvedByName?: string | null;
  issuedAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  createdAt?: string;
  version?: number;
}

export interface DayEndPackage {
  id: string;
  ref?: string;
  counterpartyId: string;
  counterpartyName?: string | null;
  counterparty?: { name?: string; ref?: string } | null;
  accountRef: string;
  statementDate: string;
  currency: string;
  closingCash: Decimal;
  holdingsMv: Decimal;
  tradeCount: number;
  sha256?: string | null;
  note?: string | null;
  status: string;
  submittedByName?: string | null;
  submittedAt: string;
  approvedAt?: string | null;
  reviewNote?: string | null;
}

/** Existing staff clients list (`GET /api/v1/clients`): `id` is the client ref, `uuid` the row id. */
export interface ClientOption {
  id: string;
  uuid: string;
  name: string;
  ccy?: string;
}

/** Existing staff companies list (`GET /api/v1/private-markets/companies`): `id` is the company ref. */
export interface CompanyOption {
  id: string;
  name: string;
}
