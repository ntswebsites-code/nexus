import { Prisma } from '@prisma/client';

/**
 * Pure entitlement rules for Corporate Actions (SRD 5.A.19 page `corporate-actions`). No database access.
 * All maths is Decimal. Cash is rounded half-up to 4 dp; share counts are rounded DOWN to whole shares
 * (fractions are reported; they are paid in cash only when the event sets a cash-in-lieu price).
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

export const CA_TYPES = ['CASH_DIVIDEND', 'STOCK_SPLIT', 'BONUS_ISSUE', 'SCRIP_DIVIDEND', 'RIGHTS_ISSUE', 'MERGER'] as const;
export type CaType = (typeof CA_TYPES)[number];
export const CA_STATUSES = ['ANNOUNCED', 'CONFIRMED', 'PROCESSED', 'REVERSED', 'CANCELLED'] as const;

export const TYPE_LABEL: Record<CaType, string> = {
  CASH_DIVIDEND: 'Cash dividend',
  STOCK_SPLIT: 'Stock split',
  BONUS_ISSUE: 'Bonus issue',
  SCRIP_DIVIDEND: 'Scrip dividend',
  RIGHTS_ISSUE: 'Rights issue',
  MERGER: 'Merger',
};

/** Election options per type; the first is the usual default. Types not listed are mandatory (no election). */
export const ELECTION_OPTIONS: Partial<Record<CaType, readonly string[]>> = {
  SCRIP_DIVIDEND: ['CASH', 'SCRIP'],
  RIGHTS_ISSUE: ['LAPSE', 'TAKE_UP'],
};
export const isElective = (t: string) => t in ELECTION_OPTIONS;

export const needsRate = (t: string) => t === 'CASH_DIVIDEND' || t === 'SCRIP_DIVIDEND' || t === 'RIGHTS_ISSUE';
export const needsRatio = (t: string) => t !== 'CASH_DIVIDEND';

export interface EventParams {
  type: string;
  rate: Dec | null;
  ratioNew: Dec | null;
  ratioOld: Dec | null;
  withholdingPct: Dec;
  /** When set, a fraction of a share is paid in cash at this price per share (cash in lieu). Absent = fractions are only reported. */
  cilPrice?: Dec | null;
}

export interface Entitlement {
  /** Cash for the fraction of a share (already included in `cash`). */
  cashInLieu: Dec;
  gross: Dec;
  tax: Dec;
  /** Net cash effect on the portfolio (negative when it pays, e.g. a rights subscription). */
  cash: Dec;
  /** Change in the held security. */
  sharesDelta: Dec;
  /** Merger: shares of the acquirer security received. */
  targetShares: Dec;
  /** Fraction of a share that is not delivered. */
  fraction: Dec;
  /** Extra cost basis added to the position (scrip, rights); the carried cost for a merger is handled by the processor. */
  addedCost: Dec;
}

const r4 = (v: Dec) => v.toDecimalPlaces(4, D.ROUND_HALF_UP);
const floorShares = (v: Dec) => v.toDecimalPlaces(0, D.ROUND_DOWN);

/** Validates an option for the type; returns the option to store (null for mandatory actions). */
export function normaliseOption(type: string, option: string | null | undefined, fallback: string | null): string | null {
  const allowed = ELECTION_OPTIONS[type as CaType];
  if (!allowed) return null;
  const pick = option ?? fallback ?? allowed[0]!;
  if (!allowed.includes(pick)) throw new Error(`Option ${pick} is not valid for ${type}; use ${allowed.join(' or ')}`);
  return pick;
}

const ratio = (p: EventParams) => (p.ratioNew && p.ratioOld && p.ratioOld.gt(0) ? p.ratioNew.div(p.ratioOld) : ZERO);

/** The entitlement of one holding of `qty` shares at the record date. */
export function computeEntitlement(p: EventParams, qty: Dec, option: string | null): Entitlement {
  const out: Entitlement = { gross: ZERO, tax: ZERO, cash: ZERO, sharesDelta: ZERO, targetShares: ZERO, fraction: ZERO, addedCost: ZERO, cashInLieu: ZERO };
  const rate = p.rate ?? ZERO;
  const exact = qty.mul(ratio(p));
  const whole = floorShares(exact);
  const dividend = () => {
    out.gross = r4(qty.mul(rate));
    out.tax = r4(out.gross.mul(p.withholdingPct).div(100));
    out.cash = out.gross.sub(out.tax);
  };
  switch (p.type) {
    case 'CASH_DIVIDEND':
      dividend();
      break;
    case 'STOCK_SPLIT':
      // new : old, so a 2-for-1 split holds twice the shares; a reverse split (new < old) holds fewer.
      out.sharesDelta = whole.sub(qty);
      out.fraction = exact.sub(whole);
      break;
    case 'BONUS_ISSUE':
      // ratioNew free shares for every ratioOld held
      out.sharesDelta = floorShares(qty.mul(ratio(p)));
      out.fraction = exact.sub(out.sharesDelta);
      break;
    case 'SCRIP_DIVIDEND':
      if (option === 'SCRIP') {
        out.gross = r4(qty.mul(rate));
        out.sharesDelta = whole;
        out.fraction = exact.sub(whole);
        out.addedCost = out.gross; // the forgone cash dividend becomes cost of the new shares
      } else {
        dividend();
      }
      break;
    case 'RIGHTS_ISSUE':
      if (option === 'TAKE_UP') {
        out.sharesDelta = whole;
        out.fraction = exact.sub(whole);
        out.gross = r4(whole.mul(rate));
        out.cash = out.gross.neg();
        out.addedCost = out.gross;
      }
      break;
    case 'MERGER':
      out.sharesDelta = qty.neg();
      out.targetShares = whole;
      out.fraction = exact.sub(whole);
      out.gross = r4(qty.mul(rate));
      out.cash = out.gross;
      break;
  }
  // Cash in lieu: the undeliverable fraction is paid for in cash (not subject to withholding).
  if (p.cilPrice && p.cilPrice.gt(0) && out.fraction.gt(0)) {
    out.cashInLieu = r4(out.fraction.mul(p.cilPrice));
    out.cash = out.cash.add(out.cashInLieu);
  }
  return out;
}

/**
 * Book cost of the fraction that is sold for cash in lieu, so the cash-in-lieu journal can split cost from realised gain.
 * Split, bonus and merger spread the held cost over the exact resulting shares; scrip and rights use the price paid per share.
 */
export function fractionCost(p: EventParams, qty: Dec, avgCost: Dec, option: string | null, e: Entitlement): Dec {
  if (e.fraction.lte(0)) return ZERO;
  const held = qty.mul(avgCost);
  const exact = qty.mul(ratio(p));
  switch (p.type) {
    case 'STOCK_SPLIT':
    case 'MERGER':
      return exact.gt(0) ? r4(held.div(exact).mul(e.fraction)) : ZERO;
    case 'BONUS_ISSUE': {
      const total = qty.add(exact);
      return total.gt(0) ? r4(held.div(total).mul(e.fraction)) : ZERO;
    }
    case 'SCRIP_DIVIDEND':
      return option === 'SCRIP' && exact.gt(0) ? r4(qty.mul(p.rate ?? ZERO).div(exact).mul(e.fraction)) : ZERO;
    case 'RIGHTS_ISSUE':
      return option === 'TAKE_UP' ? r4((p.rate ?? ZERO).mul(e.fraction)) : ZERO;
    default:
      return ZERO;
  }
}

/** New quantity and average cost for the held security after the effect, never below zero. */
export function applyToPosition(
  p: { type: string },
  held: Dec,
  avgCost: Dec,
  e: Entitlement,
  /** Book cost of a fraction sold for cash in lieu; it leaves the position's total cost. */
  cilCost: Dec = ZERO,
): { quantity: Dec; avgCost: Dec; clamped: boolean } {
  let q = held.add(e.sharesDelta);
  let clamped = false;
  if (q.lt(0)) {
    q = ZERO;
    clamped = true;
  }
  if (q.eq(0)) return { quantity: ZERO, avgCost, clamped };
  // total cost is unchanged by a split or bonus; scrip and rights add their cost; a merger closes the position
  const totalCost = held.mul(avgCost).add(e.addedCost).sub(cilCost);
  const newAvg = p.type === 'MERGER' ? avgCost : totalCost.div(q).toDecimalPlaces(6, D.ROUND_HALF_UP);
  return { quantity: q, avgCost: newAvg, clamped };
}

/** Which date the effect lands on: the ex-date for share-structure changes, else the pay date. */
export const effectDateField = (type: string): 'exDate' | 'payDate' => (type === 'STOCK_SPLIT' || type === 'BONUS_ISSUE' ? 'exDate' : 'payDate');

export interface DateSet {
  exDate: Date;
  recordDate: Date;
  payDate: Date;
  electionDeadline: Date | null;
}

/** Date-order rules; returns validation errors (empty when fine). */
export function dateErrors(type: string, d: DateSet): { path: string; message: string }[] {
  const errs: { path: string; message: string }[] = [];
  const t = (x: Date) => x.getTime();
  if (t(d.recordDate) < t(d.exDate)) errs.push({ path: 'recordDate', message: 'The record date cannot be before the ex-date' });
  if (t(d.payDate) < t(d.recordDate)) errs.push({ path: 'payDate', message: 'The pay date cannot be before the record date' });
  if (isElective(type)) {
    if (!d.electionDeadline) errs.push({ path: 'electionDeadline', message: 'An election deadline is required for this action' });
    else if (t(d.electionDeadline) > t(d.payDate)) errs.push({ path: 'electionDeadline', message: 'The election deadline cannot be after the pay date' });
  }
  return errs;
}
