import { Prisma } from '@prisma/client';

/**
 * NAV & Valuation maths (SRD 6.11, BR-001, BR-012, BR-013). Pure functions: no database, no clock.
 * Money is held as Prisma.Decimal and rounded half-up to 2 dp at the points named below; NAV per unit is 4 dp.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const HALF_UP = D.ROUND_HALF_UP;
const ZERO = new D(0);
const HUNDRED = new D(100);

export interface NavSettings {
  /** A price older than this many days at the NAV date is stale. */
  staleDays: number;
  /** A price move above this percent versus the previous run's price raises a tolerance exception. */
  priceMovePct: number;
  /** Materiality: a difference above this percent of the position value is material (BR-013). */
  tolerancePct: number;
  /** Materiality: a difference above this amount (base currency) is material (BR-013). */
  toleranceAbs: number;
}

export const NAV_SETTING_DEFAULTS: NavSettings = { staleDays: 3, priceMovePct: 10, tolerancePct: 1, toleranceAbs: 50_000 };

/** `policies` keys that override the defaults (numbers). */
export const NAV_SETTING_KEYS = {
  staleDays: 'nav_stale_days',
  priceMovePct: 'nav_price_move_pct',
  tolerancePct: 'nav_tolerance_pct',
  toleranceAbs: 'nav_tolerance_abs',
} as const;

export const NAV_STATUSES = ['DRAFT', 'EXCEPTIONS_OPEN', 'MAKER_REVIEWED', 'RELEASED', 'SUPERSEDED'] as const;
export type NavStatus = (typeof NAV_STATUSES)[number];
export const EXCEPTION_TYPES = ['STALE_PRICE', 'MISSING_PRICE', 'MISSING_FX', 'TOLERANCE', 'NEGATIVE_CASH'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/** Stage bar, in order. */
export const NAV_STAGES = ['POSITIONS', 'CASH', 'PRICES', 'FEES', 'UNITS', 'MAKER_REVIEW', 'RELEASE'] as const;
export type NavStage = (typeof NAV_STAGES)[number] | 'DONE';

export const m2 = (v: Dec) => v.toDecimalPlaces(2, HALF_UP);

/** Management fee accrued for one day: rate (percent per year) x base / 365, 2 dp. */
export function feeFromRate(ratePct: Dec, base: Dec): Dec {
  return m2(ratePct.div(HUNDRED).mul(base).div(365));
}

/** BR-012: NAV = market value + cash + accruals - fees - liabilities. */
export function computeNav(i: { marketValue: Dec; cash: Dec; accruals: Dec; fees: Dec; liabilities: Dec }): Dec {
  return m2(i.marketValue.add(i.cash).add(i.accruals).sub(i.fees).sub(i.liabilities));
}

/** BR-012: NAV per unit = NAV / units, 4 dp half-up; null when there are no units. */
export function navPerUnit(nav: Dec, units: Dec | null | undefined): Dec | null {
  if (!units || !units.gt(0)) return null;
  return nav.div(units).toDecimalPlaces(4, HALF_UP);
}

/** Totals for a run from its stored valuation and the editable inputs. */
export function totalsFor(i: {
  marketValue: Dec;
  cash: Dec;
  accruals: Dec;
  fees: Dec;
  liabilities: Dec;
  feeRatePct: Dec | null;
  units: Dec | null;
}) {
  const fees = i.feeRatePct ? feeFromRate(i.feeRatePct, i.marketValue.add(i.cash).add(i.accruals)) : i.fees;
  const nav = computeNav({ ...i, fees });
  return { fees, nav, navPerUnit: navPerUnit(nav, i.units) };
}

/**
 * BR-013 price coverage: percent of positions, by value, that carry both a price and an FX rate.
 * `unvaluedReference` is the best reference value of the positions that could not be valued (cost, else local value).
 */
export function priceCoverage(valued: Dec, unvaluedReference: Dec): Dec {
  const total = valued.add(unvaluedReference);
  if (!total.gt(0)) return new D(100);
  return valued.div(total).mul(HUNDRED).toDecimalPlaces(4, HALF_UP);
}

/** Whole days between two dates (UTC midnights), `to` minus `from`. */
export function daysBetween(from: Date, to: Date): number {
  const f = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((t - f) / 86_400_000);
}

export const isStale = (priceDate: Date, navDate: Date, staleDays: number) => daysBetween(priceDate, navDate) > staleDays;

/** Percent move of `price` against `previous`, signed (null when there is no usable previous price). */
export function movePct(price: Dec, previous: Dec | null | undefined): Dec | null {
  if (!previous || !previous.gt(0)) return null;
  return price.sub(previous).div(previous).mul(HUNDRED);
}

/** BR-013: material when the difference exceeds the percent tolerance of the position, or the absolute tolerance. */
export function isMaterial(difference: Dec, positionValue: Dec, s: Pick<NavSettings, 'tolerancePct' | 'toleranceAbs'>): boolean {
  const diff = difference.abs();
  if (diff.gt(s.toleranceAbs)) return true;
  return diff.gt(positionValue.abs().mul(s.tolerancePct).div(HUNDRED));
}

export interface ExceptionDraft {
  type: ExceptionType;
  securityId: string | null;
  ticker: string | null;
  detail: string;
  currentValue: Dec | null;
  referenceValue: Dec | null;
  difference: Dec | null;
  material: boolean;
}

/** The stage the run is at, derived from its state (drives the stage bar). */
export function stageFor(r: {
  status: string;
  openPriceExceptions: number;
  openCashExceptions: number;
  inputsTouched: boolean;
  units: Dec | null;
}): NavStage {
  if (r.status === 'RELEASED') return 'DONE';
  if (r.status === 'MAKER_REVIEWED') return 'RELEASE';
  if (r.openPriceExceptions > 0) return 'PRICES';
  if (r.openCashExceptions > 0) return 'CASH';
  if (!r.inputsTouched) return 'FEES';
  if (!r.units || !r.units.gt(0)) return 'UNITS';
  return 'MAKER_REVIEW';
}

export { D as Decimal, ZERO };
