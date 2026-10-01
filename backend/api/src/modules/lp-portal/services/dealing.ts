import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import type {
  LpBankAccount,
  LpDealingCompliance,
  LpDealingOverview,
  LpDealingRequest,
  LpDealingRules,
  LpRedemptionEstimate,
  LpSubscriptionEstimate,
} from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { ctx } from '../../../lib/http';
import { sha256Hex } from '../../../lib/crypto';
import { storeFile } from '../../../lib/storage';
import { workbook } from '../../../lib/xlsx';
import { attachmentId } from './common';
import { assertFund, fundFilter, type LpContext } from '../lp.context';
import { LpError } from '../lp.http';
import { D, ZERO, money, notifyPermission, seqRef, type Dec } from '../../ops/ops.common';

export const ESTIMATE_TTL_MS = 15 * 60 * 1000;
export const OPEN_DEALING_STATUSES = ['SUBMITTED', 'COMPLIANCE_REVIEW', 'AWAITING_FUNDS', 'AWAITING_NAV', 'UNDER_REVIEW'];
const SUB_DISCLAIMER = 'Final allocation will be based on the NAV on the applicable dealing date and may differ.';
const RED_DISCLAIMER = 'Indicative amounts. Final settlement will use the approved dealing-date NAV.';
const KYC_CURRENT = ['Current', 'Review due'];

// ---------------------------------------------------------------- dates

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
/** Fixed market closures used when there is no per-fund holiday table (New Year, Christmas, Boxing Day). */
const FIXED_HOLIDAYS = new Set(['01-01', '12-25', '12-26']);
const isHoliday = (d: Date) => FIXED_HOLIDAYS.has(`${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
const isClosed = (d: Date) => isWeekend(d) || isHoliday(d);
const today = () => utcDay(dayStr(new Date()));

export function addBusinessDays(d: Date, n: number): Date {
  let out = d;
  let left = n;
  while (left > 0) {
    out = addDays(out, 1);
    if (!isClosed(out)) left--;
  }
  return out;
}

/** First dealing date of the fund's frequency on or after `from`, skipping weekends and fixed market holidays. */
export function nextDealingDate(from: Date, frequency: string): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  switch (frequency.toUpperCase()) {
    case 'DAILY': {
      let d = from;
      while (isClosed(d)) d = addDays(d, 1);
      return d;
    }
    case 'WEEKLY': {
      let d = from;
      while (d.getUTCDay() !== 5) d = addDays(d, 1);
      while (isClosed(d)) d = addDays(d, 7);
      return d;
    }
    case 'MONTHLY_LAST_BUSINESS_DAY': {
      for (let i = 0; i < 2; i++) {
        let d = new Date(Date.UTC(y, m + i + 1, 0));
        while (isClosed(d)) d = addDays(d, -1);
        if (d >= from) return d;
      }
      return from;
    }
    case 'QUARTERLY': {
      for (let i = 0; i < 4; i++) {
        const d = new Date(Date.UTC(y, Math.floor(m / 3) * 3 + 3 * i, 1));
        if (d >= from) return d;
      }
      return from;
    }
    case 'MONTHLY':
    default:
      return from.getUTCDate() === 1 ? from : new Date(Date.UTC(y, m + 1, 1));
  }
}

// ---------------------------------------------------------------- rules

export interface DealingRules {
  minBalanceAmount: Dec;
  minBalanceUnits: Dec;
  noticeDays: number;
  dealingFrequency: string;
  configuredNextDate: string | null;
  settlementLagDays: number;
  mgmtFeeRate: Dec;
  otherFeeFlat: Dec;
  maxFileMb: number;
  feeRate: Dec;
  modes: Array<'AMOUNT' | 'UNITS' | 'FULL'>;
  suspended: boolean;
  termsUrl: string | null;
}

const decOr = (v: unknown, fallback: string) => {
  try {
    return new D(typeof v === 'string' || typeof v === 'number' ? String(v) : fallback);
  } catch {
    return new D(fallback);
  }
};

/** `funds.dealing_rules_json` with defaults for anything not configured. */
export function loadRules(json: unknown): DealingRules {
  const j = (json && typeof json === 'object' && !Array.isArray(json) ? json : {}) as Record<string, any>;
  const sub = (j.subscription ?? {}) as Record<string, unknown>;
  const red = (j.redemption ?? {}) as Record<string, unknown>;
  const modes = Array.isArray(red.modes) ? (red.modes as string[]).filter((m): m is 'AMOUNT' | 'UNITS' | 'FULL' => ['AMOUNT', 'UNITS', 'FULL'].includes(m)) : [];
  return {
    minBalanceAmount: decOr(j.minBalanceAmount, '0'),
    minBalanceUnits: decOr(j.minBalanceUnits, '0'),
    noticeDays: Number.isInteger(j.noticeDays) ? j.noticeDays : 30,
    dealingFrequency: typeof j.dealingFrequency === 'string' ? j.dealingFrequency : 'MONTHLY',
    configuredNextDate: typeof j.nextEligibleDealingDate === 'string' ? j.nextEligibleDealingDate : null,
    settlementLagDays: Number.isInteger(j.settlementLagDays) ? j.settlementLagDays : 2,
    mgmtFeeRate: decOr(sub.mgmtFeeRate, '0'),
    otherFeeFlat: decOr(sub.otherFeeFlat, '0'),
    maxFileMb: Number.isInteger(sub.maxFileMb) ? (sub.maxFileMb as number) : 25,
    feeRate: decOr(red.feeRate, '0'),
    modes: modes.length ? modes : ['AMOUNT', 'UNITS', 'FULL'],
    suspended: j.suspended === true,
    termsUrl: typeof j.termsUrl === 'string' ? j.termsUrl : null,
  };
}

/** Earliest redemption dealing date: first calendar dealing date on/after today + notice days (BR-166). */
export function earliestEligible(rules: DealingRules): Date {
  const min = nextDealingDate(addDays(today(), rules.noticeDays), rules.dealingFrequency);
  if (rules.configuredNextDate && /^\d{4}-\d{2}-\d{2}$/.test(rules.configuredNextDate)) {
    const configured = utcDay(rules.configuredNextDate);
    if (configured >= min) return configured;
  }
  return min;
}

export function rulesPayload(rules: DealingRules): LpDealingRules {
  return {
    minBalanceAmount: money(rules.minBalanceAmount),
    minBalanceUnits: rules.minBalanceUnits.toFixed(4),
    noticeDays: rules.noticeDays,
    dealingFrequency: rules.dealingFrequency,
    nextEligibleDealingDate: dayStr(earliestEligible(rules)),
    settlementLagDays: rules.settlementLagDays,
    subscription: { mgmtFeeRate: rules.mgmtFeeRate.toFixed(4), otherFeeFlat: money(rules.otherFeeFlat), maxFileMb: rules.maxFileMb },
    redemption: { feeRate: rules.feeRate.toFixed(4), modes: rules.modes },
  };
}

// ---------------------------------------------------------------- position

async function loadFund(lp: LpContext, fundId: string | undefined) {
  if (!fundId) throw LpError.validation('fundId is required', { fundId: 'Choose a fund' });
  assertFund(lp, fundId);
  const fund = await prisma.fund.findUnique({ where: { id: fundId } });
  if (!fund) throw LpError.notFound('Fund');
  const commitment = await prisma.fundCommitment.findUnique({ where: { clientId_fundId: { clientId: lp.client.id, fundId } } });
  return { fund, rules: loadRules(fund.dealingRulesJson), commitment };
}
type FundCtx = Awaited<ReturnType<typeof loadFund>>;

function resolveShareClass(f: FundCtx, holdings: { shareClassCode: string }[], requested: string | undefined): string {
  const def = f.fund.defaultShareClass ?? holdings[0]?.shareClassCode ?? 'DEFAULT';
  if (!requested || requested === 'N/A') return def;
  if (requested === def || holdings.some((h) => h.shareClassCode === requested)) return requested;
  throw LpError.validation('Unknown share class for this fund', { shareClass: 'Choose the fund share class' });
}

async function position(lp: LpContext, f: FundCtx, requestedClass?: string) {
  const holdings = await prisma.lpHolding.findMany({ where: { clientId: lp.client.id, fundId: f.fund.id, isActive: true }, orderBy: { asOfDate: 'desc' } });
  const shareClass = resolveShareClass(f, holdings, requestedClass);
  const holding = holdings.find((h) => h.shareClassCode === shareClass) ?? null;
  const nav = f.fund.navPerUnit && f.fund.navPerUnit.gt(0) ? f.fund.navPerUnit : (holding?.navPerUnit ?? ZERO);
  const units = holding?.units ?? ZERO;
  const storedValue = holding?.accountValue ?? null;
  const pending = await prisma.lpDealingRequest.findMany({
    where: { clientId: lp.client.id, fundId: f.fund.id, shareClassCode: shareClass, status: { in: OPEN_DEALING_STATUSES } },
    select: { requestType: true, amount: true, units: true },
  });
  const pendingSub = pending.filter((p) => p.requestType === 'SUBSCRIPTION').reduce((s, p) => s.add(p.amount ?? ZERO), ZERO);
  const pendingRedAmount = pending.filter((p) => p.requestType === 'REDEMPTION').reduce((s, p) => s.add(p.amount ?? ZERO), ZERO);
  const pendingRedUnits = pending.filter((p) => p.requestType === 'REDEMPTION').reduce((s, p) => s.add(p.units ?? ZERO), ZERO);
  const freeUnits = D.max(ZERO, units.sub(pendingRedUnits));
  return {
    shareClass,
    holding,
    nav,
    units,
    accountValue: storedValue ?? units.mul(nav),
    pendingSub,
    pendingRedAmount,
    pendingRedUnits,
    freeUnits,
    freeValue: freeUnits.mul(nav),
  };
}
type Position = Awaited<ReturnType<typeof position>>;

async function hasOverdueCalls(lp: LpContext) {
  const rows = await prisma.capitalCallAllocation.findMany({
    where: {
      clientId: lp.client.id,
      status: { in: ['PENDING', 'PARTIALLY_PAID'] },
      call: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, issuedAt: { not: null }, dueDate: { lt: today() } },
    },
    select: { id: true },
    take: 1,
  });
  return rows.length > 0;
}

async function compliance(lp: LpContext, f: FundCtx): Promise<LpDealingCompliance> {
  const overdue = await hasOverdueCalls(lp);
  const blockers: string[] = [];
  if (f.fund.operatingModel !== 'OPEN_ENDED') blockers.push('Dealing not available for private capital funds');
  if (lp.client.dealingHold) blockers.push('COMPLIANCE_HOLD');
  if (f.rules.suspended) blockers.push('DEALING_SUSPENDED');
  if (!lp.client.accreditedInvestor) blockers.push('NOT_ACCREDITED');
  if (!KYC_CURRENT.includes(lp.client.kycStatus)) blockers.push('KYC_NOT_CURRENT');
  if (overdue) blockers.push('UNSETTLED_CAPITAL_CALLS');
  if (f.fund.status !== 'Active' || f.commitment?.status !== 'ACTIVE') blockers.push('ACCOUNT_INACTIVE');
  return {
    accreditedInvestor: lp.client.accreditedInvestor,
    kycStatus: KYC_CURRENT.includes(lp.client.kycStatus) ? 'APPROVED' : lp.client.kycStatus.toUpperCase().replace(/\s+/g, '_'),
    noUnsettledCapitalCalls: !overdue,
    noLegalHolds: !lp.client.dealingHold,
    blockers,
    termsUrl: f.rules.termsUrl,
    holdReason: lp.client.holdReason,
  };
}

/** BR-167 gate on estimate and submit. */
async function assertDealingAllowed(lp: LpContext, f: FundCtx) {
  if (f.fund.operatingModel !== 'OPEN_ENDED') throw LpError.validation('Dealing is not available for private capital funds');
  if (lp.client.dealingHold) throw new LpError(403, 'LP_COMPLIANCE_HOLD', lp.client.holdReason || 'Dealing blocked by compliance hold');
  if (f.rules.suspended) throw new LpError(403, 'LP_DEALING_SUSPENDED', 'Dealing is suspended for this fund');
  if (f.fund.status !== 'Active' || f.commitment?.status !== 'ACTIVE') throw new LpError(409, 'LP_ACCOUNT_INACTIVE', 'Investor account is inactive');
  if (!lp.client.accreditedInvestor) throw new LpError(403, 'LP_COMPLIANCE_HOLD', 'Accredited investor status is required to deal');
  if (!KYC_CURRENT.includes(lp.client.kycStatus)) throw new LpError(403, 'LP_COMPLIANCE_HOLD', 'Your KYC review must be current before dealing');
  if (await hasOverdueCalls(lp)) throw new LpError(403, 'LP_COMPLIANCE_HOLD', 'Settle overdue capital calls before dealing');
}

export async function overview(lp: LpContext, fundId: string | undefined): Promise<LpDealingOverview> {
  const f = await loadFund(lp, fundId);
  const p = await position(lp, f).catch((e) => {
    if (e instanceof LpError && e.code === 'LP_VALIDATION') return null;
    throw e;
  });
  const comp = await compliance(lp, f);
  const rules = rulesPayload(f.rules);
  // Displayed availability is holdings minus pending redemptions. The minimum balance stays a
  // dealing rule and is enforced when the redemption is submitted, not deducted from this figure.
  const availableValue = p ? D.max(ZERO, p.accountValue.sub(p.pendingRedAmount)) : ZERO;
  const availableUnits = p ? D.max(ZERO, p.units.sub(p.pendingRedUnits ?? ZERO)) : ZERO;
  return {
    fundId: f.fund.id,
    shareClass: p?.shareClass ?? f.fund.defaultShareClass ?? 'N/A',
    asOfDate: dayStr(p?.holding?.asOfDate ?? f.fund.asOfDate ?? today()),
    valuationStatus: p?.holding?.valuationStatus ?? f.fund.valuationStatus,
    navPerUnit: p ? p.nav.toFixed(8) : '0',
    accountValue: money(p?.accountValue ?? ZERO),
    unitsHeld: (p?.units ?? ZERO).toFixed(6),
    availableToRedeemValue: money(availableValue),
    availableUnits: availableUnits.toFixed(6),
    pendingSubscriptions: money(p?.pendingSub ?? ZERO),
    pendingRedemptions: money(p?.pendingRedAmount ?? ZERO),
    rules: { ...rules, compliance: comp },
    compliance: comp,
  };
}

export async function rules(lp: LpContext, fundId: string | undefined) {
  const f = await loadFund(lp, fundId);
  return { ...rulesPayload(f.rules), fundId: f.fund.id, compliance: await compliance(lp, f) };
}

export async function bankAccounts(lp: LpContext, fundId?: string): Promise<LpBankAccount[]> {
  if (fundId) assertFund(lp, fundId);
  const rows = await prisma.bankInstruction.findMany({
    where: { clientId: lp.client.id, status: 'Active', ...(fundId ? { OR: [{ fundId }, { fundId: null }] } : { OR: [{ fundId: null }, { fundId: { in: lp.fundIds } }] }) },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map((b) => ({
    id: b.id,
    label: b.label ?? b.bank,
    bankName: b.bank,
    accountName: b.accountName ?? lp.client.name,
    accountNumberMasked: b.masked,
    currencyCode: b.currency ?? lp.client.baseCurrency,
    isDefault: b.isDefault,
    fundId: b.fundId,
    status: 'ACTIVE',
  }));
}

// ---------------------------------------------------------------- estimates

const canonical = (o: Record<string, unknown>) => sha256Hex(JSON.stringify(o));

interface SubInput {
  fundId: string;
  shareClass: string;
  amount: string;
  currency: string;
}

function subscriptionMaths(f: FundCtx, p: Position, amount: Dec) {
  if (!p.nav.gt(0)) throw LpError.validation('No dealing NAV is published for this fund yet');
  const managementFee = amount.mul(f.rules.mgmtFeeRate).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const otherFees = f.rules.otherFeeFlat.toDecimalPlaces(2, D.ROUND_HALF_UP);
  return {
    navPerUnit: p.nav.toFixed(8),
    estimatedUnits: amount.div(p.nav).toFixed(6, D.ROUND_DOWN),
    managementFee: money(managementFee),
    otherFees: money(otherFees),
    estimatedTotalInvestment: money(amount.add(managementFee).add(otherFees)),
  };
}

export async function estimateSubscription(lp: LpContext, body: { fundId: string; shareClass: string; amount: string; currency: string }): Promise<LpSubscriptionEstimate> {
  const f = await loadFund(lp, body.fundId);
  await assertDealingAllowed(lp, f);
  const p = await position(lp, f, body.shareClass);
  const amount = new D(body.amount);
  if (amount.lte(0)) throw LpError.validation('amount must be a positive number', { amount: 'Required positive amount' });
  if (body.currency.toUpperCase() !== f.fund.currency) throw LpError.validation(`Subscriptions in this fund are in ${f.fund.currency}`, { currency: f.fund.currency });
  const input: SubInput = { fundId: f.fund.id, shareClass: p.shareClass, amount: money(amount), currency: f.fund.currency };
  const result = subscriptionMaths(f, p, amount);
  const est = await prisma.dealingEstimate.create({
    data: {
      clientId: lp.client.id,
      fundId: f.fund.id,
      estimateType: 'SUBSCRIPTION',
      estimateJson: { input, result } as unknown as Prisma.InputJsonValue,
      payloadHash: canonical({ ...input }),
      expiresAt: new Date(Date.now() + ESTIMATE_TTL_MS),
    },
  });
  return { estimateSnapshotId: est.id, ...result, isEstimate: true, disclaimer: SUB_DISCLAIMER };
}

interface RedInput {
  fundId: string;
  shareClass: string;
  mode: 'AMOUNT' | 'UNITS' | 'FULL';
  amount: string | null;
  units: string | null;
  earliestDealingDate: string;
}

function redemptionMaths(f: FundCtx, p: Position, input: RedInput) {
  if (!p.nav.gt(0)) throw LpError.validation('No dealing NAV is published for this fund yet');
  let units: Dec;
  let value: Dec;
  if (input.mode === 'FULL') {
    units = p.freeUnits;
    value = p.freeValue;
  } else if (input.mode === 'UNITS') {
    units = new D(input.units ?? '0');
    value = units.mul(p.nav);
  } else {
    value = new D(input.amount ?? '0');
    units = value.div(p.nav).toDecimalPlaces(6, D.ROUND_UP);
  }
  if (!units.gt(0)) {
    if (input.mode === 'FULL') throw new LpError(422, 'LP_INSUFFICIENT_UNITS', 'There are no units available to redeem', { fieldErrors: { units: 'No units available' } });
    throw LpError.validation('Invalid redemption amount/units', { [input.mode === 'UNITS' ? 'units' : 'amount']: 'Enter a positive value' });
  }
  if (units.gt(p.freeUnits)) {
    throw new LpError(422, 'LP_INSUFFICIENT_UNITS', 'Redemption exceeds holdings', { fieldErrors: { units: 'Insufficient units' } });
  }
  const remainingUnits = p.freeUnits.sub(units);
  const remainingValue = p.freeValue.sub(value);
  if (input.mode !== 'FULL' && !remainingUnits.isZero()) {
    if (remainingValue.lt(f.rules.minBalanceAmount) || remainingUnits.lt(f.rules.minBalanceUnits)) {
      throw new LpError(422, 'LP_MIN_BALANCE_BREACH', 'Redemption would breach the minimum balance.', {
        fieldErrors: { amount: `Remaining account value would be below ${f.fund.currency} ${money(f.rules.minBalanceAmount)}` },
      });
    }
  }
  const earliest = earliestEligible(f.rules);
  if (input.earliestDealingDate < dayStr(earliest)) {
    throw new LpError(422, 'LP_NOTICE_PERIOD', `Earliest dealing date must respect the ${f.rules.noticeDays}-day notice period`, {
      fieldErrors: { earliestDealingDate: `Must be on or after ${dayStr(earliest)}` },
    });
  }
  const fee = value.mul(f.rules.feeRate).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return {
    value: value.toDecimalPlaces(2, D.ROUND_HALF_UP),
    estimatedUnitsToCancel: units.toFixed(6),
    estimatedSettlementAmount: money(value.sub(fee)),
    earliestDealingDate: input.earliestDealingDate,
    estimatedSettlementDate: dayStr(addBusinessDays(utcDay(input.earliestDealingDate), f.rules.settlementLagDays)),
    noticeDays: f.rules.noticeDays,
    aboveMinBalance: true,
    redemptionFee: money(fee),
  };
}

function redInput(f: FundCtx, p: Position, body: { mode?: string; amount?: string; units?: string; full?: boolean; earliestDealingDate?: string }): RedInput {
  const mode = body.full || body.mode === 'FULL' ? 'FULL' : body.mode === 'UNITS' ? 'UNITS' : 'AMOUNT';
  if (!f.rules.modes.includes(mode)) throw LpError.validation(`${mode} redemptions are not offered by this fund`, { mode: 'Not available' });
  const earliest = body.earliestDealingDate && /^\d{4}-\d{2}-\d{2}$/.test(body.earliestDealingDate) ? body.earliestDealingDate : dayStr(earliestEligible(f.rules));
  return {
    fundId: f.fund.id,
    shareClass: p.shareClass,
    mode,
    amount: mode === 'AMOUNT' ? money(new D(body.amount ?? '0')) : null,
    units: mode === 'UNITS' ? new D(body.units ?? '0').toFixed(6) : null,
    earliestDealingDate: earliest,
  };
}

export async function estimateRedemption(
  lp: LpContext,
  body: { fundId: string; shareClass: string; mode: 'AMOUNT' | 'UNITS' | 'FULL'; amount?: string; units?: string; full?: boolean; earliestDealingDate: string },
): Promise<LpRedemptionEstimate> {
  const f = await loadFund(lp, body.fundId);
  await assertDealingAllowed(lp, f);
  const p = await position(lp, f, body.shareClass);
  const input = redInput(f, p, body);
  const { value: _v, ...result } = redemptionMaths(f, p, input);
  const est = await prisma.dealingEstimate.create({
    data: {
      clientId: lp.client.id,
      fundId: f.fund.id,
      estimateType: 'REDEMPTION',
      estimateJson: { input, result } as unknown as Prisma.InputJsonValue,
      payloadHash: canonical({ ...input }),
      expiresAt: new Date(Date.now() + ESTIMATE_TTL_MS),
    },
  });
  return { estimateSnapshotId: est.id, ...result, isEstimate: true, disclaimer: RED_DISCLAIMER };
}

// ---------------------------------------------------------------- requests

const lpStatus = (s: string) => (s === 'COMPLETED' ? 'ALLOCATED' : s);
const dbStatus = (s: string) => (s.toUpperCase() === 'ALLOCATED' ? 'COMPLETED' : s.toUpperCase());

type RequestRow = Prisma.LpDealingRequestGetPayload<{ include: { fund: { select: { name: true } } } }>;

export function requestView(r: RequestRow): LpDealingRequest {
  const done = r.status === 'COMPLETED';
  return {
    id: r.id,
    fundId: r.fundId,
    fundName: r.fund.name,
    shareClass: r.shareClassCode,
    requestType: r.requestType as 'SUBSCRIPTION' | 'REDEMPTION',
    status: lpStatus(r.status),
    amount: money(r.amount ?? ZERO),
    units: (done && r.unitsAllocated ? r.unitsAllocated : (r.units ?? ZERO)).toFixed(6),
    redemptionMode: r.redemptionMode,
    currencyCode: r.currency,
    requestedDealingDate: r.requestedDealingDate ? dayStr(r.requestedDealingDate) : '',
    estimateSnapshotId: r.estimateId ?? '',
    isEstimate: !done,
    createdAt: r.createdAt.toISOString(),
    notes: r.notes,
  };
}

export async function listRequests(lp: LpContext, q: { fundId?: string; type?: string; status?: string; page: number; pageSize: number }) {
  const where: Prisma.LpDealingRequestWhereInput = {
    clientId: lp.client.id,
    fundId: fundFilter(lp, q.fundId),
    ...(q.type ? { requestType: q.type.toUpperCase() } : {}),
    ...(q.status ? { status: dbStatus(q.status) } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.lpDealingRequest.count({ where }),
    prisma.lpDealingRequest.findMany({
      where,
      include: { fund: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map(requestView), total };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

export async function exportRequests(req: Request, lp: LpContext, q: { fundId?: string; type?: string }) {
  const { items } = await listRequests(lp, { ...q, page: 1, pageSize: 500 });
  const header = ['id', 'fundName', 'shareClass', 'requestType', 'status', 'amount', 'units', 'currency', 'requestedDealingDate', 'createdAt'];
  const lines = [header.join(','), ...items.map((i) => [i.id, i.fundName, i.shareClass, i.requestType, i.status, i.amount, i.units, i.currencyCode, i.requestedDealingDate, i.createdAt].map(csvCell).join(','))];
  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx(req, 'investor'), { action: 'lp.dealing.requests_exported', objectType: 'client', objectId: lp.client.id, after: { rows: items.length, fundId: q.fundId ?? null } }),
  );
  return `${lines.join('\r\n')}\r\n`;
}

export async function exportRequestsXlsx(req: Request, lp: LpContext, q: { fundId?: string; type?: string }) {
  const { items } = await listRequests(lp, { ...q, page: 1, pageSize: 500 });
  const header = ['id', 'fundName', 'shareClass', 'requestType', 'status', 'amount', 'units', 'currency', 'requestedDealingDate', 'createdAt'];
  const rows = items.map((i) => [i.id, i.fundName, i.shareClass, i.requestType, i.status, i.amount, i.units, i.currencyCode, i.requestedDealingDate, i.createdAt].map((v) => String(v ?? '')));
  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx(req, 'investor'), { action: 'lp.dealing.requests_exported', objectType: 'client', objectId: lp.client.id, after: { rows: items.length, fundId: q.fundId ?? null, format: 'xlsx' } }),
  );
  return workbook('Dealing requests', [header, ...rows]);
}

interface SubmitBody {
  fundId: string;
  shareClass?: string;
  estimateSnapshotId: string;
  amount?: string;
  units?: string;
  mode?: 'AMOUNT' | 'UNITS' | 'FULL';
  currency?: string;
  bankAccountId?: string;
  requestedDealingDate?: string;
  notes?: string;
}

async function consumeEstimate(lp: LpContext, f: FundCtx, type: 'SUBSCRIPTION' | 'REDEMPTION', id: string) {
  const est = await prisma.dealingEstimate.findFirst({ where: { id, clientId: lp.client.id } });
  if (!est) throw new LpError(409, 'LP_VALIDATION', 'Invalid estimate snapshot', { fieldErrors: { estimateSnapshotId: 'Run the estimate again' } });
  if (est.estimateType !== type) throw new LpError(409, 'LP_VALIDATION', 'Estimate type mismatch');
  if (est.consumedByRequestId) throw new LpError(409, 'LP_VALIDATION', 'This estimate was already used; run the estimate again');
  if (est.expiresAt < new Date()) throw new LpError(409, 'LP_ESTIMATE_EXPIRED', 'Estimate has expired - re-run estimate', { fieldErrors: { amount: 'Estimate expired - refresh estimate' } });
  if (est.fundId !== f.fund.id) throw new LpError(409, 'LP_VALIDATION', 'Fund mismatch vs estimate');
  return est;
}

async function bankAccountFor(lp: LpContext, fundId: string, id: string | undefined) {
  if (!id) return null;
  const b = await prisma.bankInstruction.findFirst({ where: { id, clientId: lp.client.id, status: 'Active', OR: [{ fundId }, { fundId: null }] } });
  if (!b) throw LpError.validation('Choose one of your active bank accounts', { bankAccountId: 'Unknown or inactive account' });
  return b;
}

function uploaded(req: Request): Express.Multer.File[] {
  const files = req.files;
  if (Array.isArray(files)) return files;
  if (files && typeof files === 'object') return Object.values(files).flat();
  return req.file ? [req.file] : [];
}

async function createRequest(req: Request, lp: LpContext, f: FundCtx, est: { id: string; payloadHash: string }, data: Omit<Prisma.LpDealingRequestUncheckedCreateInput, 'ref' | 'clientId' | 'fundId'>) {
  const row = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'dealing_request', 'DLR-', 5);
    const r = await tx.lpDealingRequest.create({
      data: { ...data, ref, clientId: lp.client.id, fundId: f.fund.id, estimateId: est.id, payloadHash: est.payloadHash, submittedById: lp.userId, status: 'SUBMITTED' },
      include: { fund: { select: { name: true } } },
    });
    const files = uploaded(req);
    for (const file of files) {
      const stored = await storeFile({ name: file.originalname, mime: file.mimetype || 'application/octet-stream', data: file.buffer, uploadedById: lp.userId }, tx);
      await tx.requestAttachment.create({
        data: {
          id: attachmentId(),
          clientId: lp.client.id,
          fileId: stored.id,
          name: stored.name,
          size: stored.size,
          mime: stored.mime,
          sha256: stored.sha256,
          requestId: r.id,
          uploadedById: lp.userId,
        },
      });
    }
    const claimed = await tx.dealingEstimate.updateMany({ where: { id: est.id, consumedByRequestId: null }, data: { consumedByRequestId: r.id } });
    if (claimed.count !== 1) throw new LpError(409, 'LP_VALIDATION', 'This estimate was already used; run the estimate again');
    await writeAudit(tx, ctx(req, 'investor'), {
      action: data.requestType === 'SUBSCRIPTION' ? 'lp.dealing.subscription_submitted' : 'lp.dealing.redemption_submitted',
      objectType: 'lp_dealing_request',
      objectId: r.id,
      after: { ref, fund: f.fund.ref, amount: data.amount?.toString() ?? null, units: data.units?.toString() ?? null, estimateId: est.id, payloadHash: est.payloadHash, attachments: uploaded(req).length },
    });
    await notifyPermission(tx, 'dealing.process', {
      type: 'dealing.submitted',
      title: `${data.requestType === 'SUBSCRIPTION' ? 'Subscription' : 'Redemption'} ${ref} · ${lp.client.name}`,
      body: `${f.fund.name}: ${money(data.amount as Dec | null)} ${f.fund.currency}`,
    });
    return r;
  });
  return requestView(row);
}

export async function submitSubscription(req: Request, lp: LpContext, body: SubmitBody) {
  const f = await loadFund(lp, body.fundId);
  await assertDealingAllowed(lp, f);
  const est = await consumeEstimate(lp, f, 'SUBSCRIPTION', body.estimateSnapshotId);
  const snap = est.estimateJson as unknown as { input: SubInput };
  const p = await position(lp, f, body.shareClass ?? snap.input.shareClass);
  const input: SubInput = {
    fundId: f.fund.id,
    shareClass: p.shareClass,
    amount: body.amount ? money(new D(body.amount)) : snap.input.amount,
    currency: (body.currency ?? snap.input.currency).toUpperCase(),
  };
  if (canonical({ ...input }) !== est.payloadHash) throw new LpError(409, 'LP_VALIDATION', 'Request body does not match estimate snapshot');
  const amount = new D(input.amount);
  const result = subscriptionMaths(f, p, amount);
  const bank = await bankAccountFor(lp, f.fund.id, body.bankAccountId);
  const dealingDate = body.requestedDealingDate && /^\d{4}-\d{2}-\d{2}$/.test(body.requestedDealingDate) ? utcDay(body.requestedDealingDate) : nextDealingDate(addDays(today(), 1), f.rules.dealingFrequency);
  if (dealingDate < today()) throw LpError.validation('The dealing date cannot be in the past', { requestedDealingDate: 'Choose a future dealing date' });
  return createRequest(req, lp, f, est, {
    shareClassCode: p.shareClass,
    requestType: 'SUBSCRIPTION',
    inputMode: 'AMOUNT',
    amount,
    units: new D(result.estimatedUnits),
    currency: f.fund.currency,
    requestedDealingDate: dealingDate,
    estimateJson: { input, result } as unknown as Prisma.InputJsonValue,
    bankAccountId: bank?.id ?? null,
    notes: body.notes ?? null,
  });
}

export async function submitRedemption(req: Request, lp: LpContext, body: SubmitBody & { full?: boolean; earliestDealingDate?: string }) {
  const f = await loadFund(lp, body.fundId);
  await assertDealingAllowed(lp, f);
  const est = await consumeEstimate(lp, f, 'REDEMPTION', body.estimateSnapshotId);
  const snap = est.estimateJson as unknown as { input: RedInput };
  const p = await position(lp, f, body.shareClass ?? snap.input.shareClass);
  const input = redInput(f, p, {
    mode: body.full ? 'FULL' : (body.mode ?? snap.input.mode),
    amount: body.amount ?? snap.input.amount ?? undefined,
    units: body.units ?? snap.input.units ?? undefined,
    earliestDealingDate: body.earliestDealingDate ?? body.requestedDealingDate ?? snap.input.earliestDealingDate,
  });
  if (canonical({ ...input }) !== est.payloadHash) throw new LpError(409, 'LP_VALIDATION', 'Request body does not match estimate snapshot');
  const result = redemptionMaths(f, p, input);
  const bank = await bankAccountFor(lp, f.fund.id, body.bankAccountId);
  const { value, ...stored } = result;
  return createRequest(req, lp, f, est, {
    shareClassCode: p.shareClass,
    requestType: 'REDEMPTION',
    inputMode: input.mode,
    redemptionMode: input.mode === 'FULL' ? 'FULL' : 'PARTIAL',
    amount: value,
    units: new D(result.estimatedUnitsToCancel),
    currency: f.fund.currency,
    requestedDealingDate: utcDay(input.earliestDealingDate),
    estimateJson: { input, result: stored } as unknown as Prisma.InputJsonValue,
    bankAccountId: bank?.id ?? null,
    notes: body.notes ?? null,
  });
}
