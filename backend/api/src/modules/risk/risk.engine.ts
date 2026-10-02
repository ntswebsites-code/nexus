/**
 * Risk engine: pure, deterministic maths (no database access). SRD 6.8 FR-RSK-001..005, BR-014.
 *
 * A `Book` is a portfolio valued in its base currency: positions (with sector, asset class and currency) plus
 * cash by currency. Limits are measured on a book, and scenario shocks are applied to a book, so the monitor,
 * the pre-trade check (hypothetical holdings) and the scenario lab all share one set of formulas.
 *
 * Percentages are plain numbers (10 = 10%). Weights are percent of TOTAL value (securities + cash), rounded
 * half-up to 4 dp, the same convention as `getPortfolioSnapshot`.
 */
import { Prisma } from '@prisma/client';
import type { PortfolioSnapshot } from '../portfolio/portfolio.service';

const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
const ZERO = new D(0);
const HUNDRED = new D(100);

export const RISK_METRICS = ['SINGLE_NAME_PCT', 'SECTOR_PCT', 'CASH_FLOOR_PCT', 'TOP5_PCT'] as const;
export type RiskMetric = (typeof RISK_METRICS)[number];

export const METRIC_LABEL: Record<RiskMetric, string> = {
  SINGLE_NAME_PCT: 'Single-name concentration (max weight of any security)',
  SECTOR_PCT: 'Sector concentration (max weight of any sector)',
  CASH_FLOOR_PCT: 'Cash floor (minimum cash weight)',
  TOP5_PCT: 'Top-5 concentration (combined weight of the five largest securities)',
};

/** CASH_FLOOR_PCT is a minimum, every other metric is a maximum. */
export const isFloorMetric = (m: RiskMetric) => m === 'CASH_FLOOR_PCT';

/** A value within this fraction of the limit (on the safe side) is a warning / "Review". */
export const WARN_BAND = new D('0.10');

const w4 = (v: Dec) => v.toDecimalPlaces(4, D.ROUND_HALF_UP);
const m2 = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);

// ---------------------------------------------------------------- book

export interface BookItem {
  ticker: string;
  sector: string | null;
  assetClass: string;
  currency: string;
  valueBase: Dec;
}
export interface BookCash {
  currency: string;
  valueBase: Dec;
}
export interface Book {
  baseCurrency: string;
  items: BookItem[];
  cash: BookCash[];
}

/** Valued lines and cash only; lines that cannot be valued are left out (the snapshot names them in `warnings`). */
export function bookFromSnapshot(s: PortfolioSnapshot): Book {
  return {
    baseCurrency: s.baseCurrency,
    items: s.lines
      .filter((l) => l.marketValueBase !== null)
      .map((l) => ({ ticker: l.ticker, sector: l.sector, assetClass: l.assetClass, currency: l.currency, valueBase: new D(l.marketValueBase!) })),
    cash: s.cash.filter((c) => c.availableBase !== null).map((c) => ({ currency: c.currency, valueBase: new D(c.availableBase!) })),
  };
}

export const securitiesTotal = (b: Book) => b.items.reduce((s, i) => s.add(i.valueBase), ZERO);
export const cashTotal = (b: Book) => b.cash.reduce((s, c) => s.add(c.valueBase), ZERO);
export const bookTotal = (b: Book) => securitiesTotal(b).add(cashTotal(b));

// ---------------------------------------------------------------- measuring

export interface Measure {
  /** Percent, 4 dp. */
  value: Dec;
  /** What drove the number, e.g. the ticker or sector. */
  detail: Record<string, unknown>;
}
export type Measures = Record<RiskMetric, Measure>;

/** Measures every supported metric on a book. Returns null for an empty (zero-value) book. */
export function measureBook(b: Book): Measures | null {
  const total = bookTotal(b);
  if (total.lte(ZERO)) return null;
  const pct = (v: Dec) => v.div(total).mul(HUNDRED);

  const byTicker = new Map<string, Dec>();
  const bySector = new Map<string, Dec>();
  for (const i of b.items) {
    byTicker.set(i.ticker, (byTicker.get(i.ticker) ?? ZERO).add(i.valueBase));
    const sec = i.sector ?? 'Unclassified';
    bySector.set(sec, (bySector.get(sec) ?? ZERO).add(i.valueBase));
  }
  const top = (m: Map<string, Dec>) => [...m.entries()].sort((a, c) => c[1].comparedTo(a[1]) || a[0].localeCompare(c[0]));
  const tickers = top(byTicker);
  const sectors = top(bySector);

  return {
    SINGLE_NAME_PCT: {
      value: w4(tickers[0] ? pct(tickers[0][1]) : ZERO),
      detail: { ticker: tickers[0]?.[0] ?? null },
    },
    SECTOR_PCT: {
      value: w4(sectors[0] ? pct(sectors[0][1]) : ZERO),
      detail: { sector: sectors[0]?.[0] ?? null },
    },
    CASH_FLOOR_PCT: { value: w4(pct(cashTotal(b))), detail: {} },
    TOP5_PCT: {
      value: w4(pct(tickers.slice(0, 5).reduce((s, [, v]) => s.add(v), ZERO))),
      detail: { tickers: tickers.slice(0, 5).map(([t]) => t) },
    },
  };
}

// ---------------------------------------------------------------- evaluating

export type LimitState = 'BREACH' | 'WARNING' | 'OK';
export interface Evaluation {
  metric: RiskMetric;
  threshold: Dec;
  value: Dec;
  state: LimitState;
  /** |value - threshold| / threshold, 4 dp (how far past the limit when in breach). */
  excessRatio: Dec;
  detail: Record<string, unknown>;
}

/** Breach: max metric strictly above the limit, floor metric strictly below it. Warning: inside the 10% band. */
export function evaluateMeasure(metric: RiskMetric, threshold: Dec, m: Measure): Evaluation {
  const value = m.value;
  const floor = isFloorMetric(metric);
  let state: LimitState = 'OK';
  if (floor) {
    if (value.lt(threshold)) state = 'BREACH';
    else if (value.lte(threshold.mul(new D(1).add(WARN_BAND)))) state = 'WARNING';
  } else if (value.gt(threshold)) state = 'BREACH';
  else if (value.gte(threshold.mul(new D(1).sub(WARN_BAND)))) state = 'WARNING';
  const excessRatio = threshold.isZero() ? ZERO : w4(value.sub(threshold).abs().div(threshold));
  return { metric, threshold, value, state, excessRatio, detail: m.detail };
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Case severity from how far past the limit the value is: <5% LOW, <15% MEDIUM, <30% HIGH, otherwise CRITICAL. */
export function severityFor(excessRatio: Dec): Severity {
  if (excessRatio.lt('0.05')) return 'LOW';
  if (excessRatio.lt('0.15')) return 'MEDIUM';
  if (excessRatio.lt('0.30')) return 'HIGH';
  return 'CRITICAL';
}

// ---------------------------------------------------------------- scenarios (BR-014)

export interface Shocks {
  /** Percent move of equity-like holdings (Equity, Fund, Private). -20 = fall of 20%. */
  equityPct: number;
  /** Percent depreciation of ZWG against USD (positive = ZWG weaker). */
  fxPct: number;
  /** Parallel rate move in percentage points (+2 = +200 bp). Applied to Fixed income. */
  ratePctPoints: number;
  /** Modified duration, years, used for the rate shock. */
  durationYears: number;
  /** Percent of NAV redeemed. */
  redemptionPct: number;
}

export const DEFAULT_SHOCKS: Shocks = { equityPct: 0, fxPct: 0, ratePctPoints: 0, durationYears: 1, redemptionPct: 0 };

export interface Preset {
  key: 'liquidity' | 'equity' | 'fx';
  name: string;
  description: string;
  shocks: Shocks;
}

export const PRESETS: Preset[] = [
  { key: 'liquidity', name: 'Liquidity stress: 15% redemptions', description: 'Investors redeem 15% of NAV; no market move.', shocks: { ...DEFAULT_SHOCKS, redemptionPct: 15 } },
  { key: 'equity', name: 'Equity drawdown: -20%', description: 'Listed equities fall 20%.', shocks: { ...DEFAULT_SHOCKS, equityPct: -20 } },
  { key: 'fx', name: 'FX shock: ZWG -25% vs USD', description: 'ZWG depreciates 25% against the US dollar.', shocks: { ...DEFAULT_SHOCKS, fxPct: 25 } },
];

const EQUITY_LIKE = new Set(['Equity', 'Fund', 'Private']);
const FIXED_INCOME = 'Fixed income';

export const isEquityLike = (assetClass: string) => EQUITY_LIKE.has(assetClass);
export const isFixedIncome = (assetClass: string) => assetClass === FIXED_INCOME;

/**
 * FX factor for a holding denominated in `currency`, in a book valued in `base`. Only the ZWG/USD pair is shocked.
 * A depreciation of x% means one ZWG buys x% less USD (r' = r (1 - x)): ZWG holdings in a USD book are worth
 * (1 - x), USD holdings in a ZWG book are worth 1 / (1 - x) of their former ZWG value.
 */
export function fxFactor(currency: string, base: string, fxPct: number): Dec {
  const keep = new D(1).sub(new D(fxPct).div(HUNDRED));
  if (currency === base) return new D(1);
  if (base === 'USD' && currency === 'ZWG') return keep;
  if (base === 'ZWG' && currency === 'USD') return new D(1).div(keep);
  return new D(1);
}

export interface ScenarioInputLimit {
  ref: string;
  metric: RiskMetric;
  threshold: Dec;
  breachAction: string;
}

export type ScenarioStatus = 'Escalate' | 'Review' | 'Within';

export interface ScenarioResult {
  asOf: string;
  baseCurrency: string;
  shocks: Shocks;
  /** Pre-shock NAV (securities + cash), base currency, 2 dp. */
  nav: string;
  postShockValue: string;
  /** Positive = loss, negative = gain. */
  loss: string;
  lossPct: string;
  /** Signed value change by driver (negative = loss). They sum to -loss. */
  impacts: { equity: string; rate: string; fx: string };
  notes: string[];
  liquidity: {
    liquidAssets: string;
    redemptionAmount: string;
    /** liquid assets / redemption amount, 4 dp; null when there is no redemption shock. */
    coverage: string | null;
    status: ScenarioStatus;
  };
  limitChecks: { ref: string; metric: RiskMetric; threshold: string; value: string; state: LimitState; breachAction: string }[];
  status: ScenarioStatus;
  reasons: string[];
  warnings: string[];
}

/**
 * Applies the shocks to a book and judges the outcome.
 *
 * Per holding: post = value x localFactor x fxFactor, where localFactor is (1 + equityPct/100) for equity-like
 * holdings, max(0, 1 - duration x ratePctPoints/100) for fixed income and 1 otherwise. Cash is only affected by FX.
 * Liquid assets = post-shock cash + post-shock fixed income. Redemption amount = redemptionPct x post-shock NAV.
 * Coverage = liquid assets / redemption amount: below 1.0 Escalate, below 1.1 Review.
 * Limit checks re-measure the post-shock book against the ACTIVE limits supplied: any breach Escalate, any warning Review.
 * Overall status is the worst of liquidity and limit checks.
 */
export function runScenarioMaths(book: Book, shocksIn: Partial<Shocks>, limits: ScenarioInputLimit[], meta: { asOf: string; warnings?: string[] }): ScenarioResult {
  const shocks: Shocks = { ...DEFAULT_SHOCKS, ...shocksIn };
  const pre = bookTotal(book);
  const notes: string[] = [];

  let equityImpact = ZERO;
  let rateImpact = ZERO;
  let fxImpact = ZERO;
  const shockedItems: BookItem[] = [];
  const shockedCash: BookCash[] = [];
  let fxExposed = false;

  for (const i of book.items) {
    let local = new D(1);
    if (isEquityLike(i.assetClass)) local = new D(1).add(new D(shocks.equityPct).div(HUNDRED));
    else if (isFixedIncome(i.assetClass)) local = D.max(ZERO, new D(1).sub(new D(shocks.durationYears).mul(shocks.ratePctPoints).div(HUNDRED)));
    const afterLocal = i.valueBase.mul(local);
    const fxf = fxFactor(i.currency, book.baseCurrency, shocks.fxPct);
    if (!fxf.eq(1)) fxExposed = true;
    const post = afterLocal.mul(fxf);
    if (isEquityLike(i.assetClass)) equityImpact = equityImpact.add(afterLocal.sub(i.valueBase));
    else if (isFixedIncome(i.assetClass)) rateImpact = rateImpact.add(afterLocal.sub(i.valueBase));
    fxImpact = fxImpact.add(post.sub(afterLocal));
    shockedItems.push({ ...i, valueBase: post });
  }
  for (const c of book.cash) {
    const fxf = fxFactor(c.currency, book.baseCurrency, shocks.fxPct);
    if (!fxf.eq(1)) fxExposed = true;
    const post = c.valueBase.mul(fxf);
    fxImpact = fxImpact.add(post.sub(c.valueBase));
    shockedCash.push({ ...c, valueBase: post });
  }

  const post: Book = { baseCurrency: book.baseCurrency, items: shockedItems, cash: shockedCash };
  const postTotal = bookTotal(post);
  const loss = pre.sub(postTotal);
  const lossPct = pre.isZero() ? ZERO : loss.div(pre).mul(HUNDRED);

  if (shocks.ratePctPoints !== 0 && !book.items.some((i) => isFixedIncome(i.assetClass))) {
    notes.push('This portfolio holds no fixed-income securities, so the interest-rate shock has no effect (0).');
  }
  if (shocks.fxPct !== 0 && !fxExposed) {
    notes.push('This portfolio has no ZWG/USD currency exposure for the shock to act on, so the FX shock has no effect (0).');
  }
  if (shocks.equityPct !== 0 && !book.items.some((i) => isEquityLike(i.assetClass))) {
    notes.push('This portfolio holds no equity-like securities, so the equity shock has no effect (0).');
  }

  // liquidity
  const liquid = cashTotal(post).add(shockedItems.filter((i) => isFixedIncome(i.assetClass)).reduce((s, i) => s.add(i.valueBase), ZERO));
  const redemption = postTotal.mul(shocks.redemptionPct).div(HUNDRED);
  let coverage: Dec | null = null;
  let liqStatus: ScenarioStatus = 'Within';
  const reasons: string[] = [];
  if (redemption.gt(ZERO)) {
    coverage = w4(liquid.div(redemption));
    if (coverage.lt(1)) {
      liqStatus = 'Escalate';
      reasons.push(`Liquidity coverage ${coverage.toFixed(4)}x is below 1.0x (liquid assets cannot meet the redemption)`);
    } else if (coverage.lt('1.1')) {
      liqStatus = 'Review';
      reasons.push(`Liquidity coverage ${coverage.toFixed(4)}x is within 10% of the 1.0x minimum`);
    }
  }

  // limits on the post-shock book
  const measures = measureBook(post);
  const limitChecks: ScenarioResult['limitChecks'] = [];
  let limStatus: ScenarioStatus = 'Within';
  if (measures) {
    for (const l of limits) {
      const ev = evaluateMeasure(l.metric, l.threshold, measures[l.metric]);
      limitChecks.push({ ref: l.ref, metric: l.metric, threshold: ev.threshold.toFixed(4), value: ev.value.toFixed(4), state: ev.state, breachAction: l.breachAction });
      if (ev.state === 'BREACH') {
        limStatus = 'Escalate';
        reasons.push(`${l.ref} ${l.metric} would be ${ev.value.toFixed(4)}% against a limit of ${ev.threshold.toFixed(4)}%`);
      } else if (ev.state === 'WARNING' && limStatus !== 'Escalate') {
        limStatus = 'Review';
        reasons.push(`${l.ref} ${l.metric} would be ${ev.value.toFixed(4)}%, within 10% of its limit of ${ev.threshold.toFixed(4)}%`);
      }
    }
  }

  const rank = { Within: 0, Review: 1, Escalate: 2 } as const;
  const status: ScenarioStatus = rank[liqStatus] >= rank[limStatus] ? liqStatus : limStatus;

  return {
    asOf: meta.asOf,
    baseCurrency: book.baseCurrency,
    shocks,
    nav: m2(pre),
    postShockValue: m2(postTotal),
    loss: m2(loss),
    lossPct: w4(lossPct).toFixed(4),
    impacts: { equity: m2(equityImpact), rate: m2(rateImpact), fx: m2(fxImpact) },
    notes,
    liquidity: {
      liquidAssets: m2(liquid),
      redemptionAmount: m2(redemption),
      coverage: coverage ? coverage.toFixed(4) : null,
      status: liqStatus,
    },
    limitChecks,
    status,
    reasons,
    warnings: meta.warnings ?? [],
  };
}
