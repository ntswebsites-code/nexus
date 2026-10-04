import { z } from 'zod';

/**
 * Valuation model maths for FR-RES-007 (no database access). A five-year free-cash-flow DCF with a Gordon terminal
 * value, run for three cases built from the analyst's ranges:
 *   low  = lowest growth, lowest margin, highest discount rate
 *   base = base growth, base margin, base discount rate
 *   high = highest growth, highest margin, lowest discount rate
 * All money inputs are in the case's quote currency (revenue and net debt in whole units, so shares are units too).
 * Ranges follow the SRD: growth -100..500 %, margin -100..100 %, discount 0..50 %.
 */
export const HORIZON_YEARS = 5;

const range = (lo: number, hi: number, what: string) =>
  z
    .object({ low: z.number().min(lo).max(hi), base: z.number().min(lo).max(hi), high: z.number().min(lo).max(hi) })
    .strict()
    .refine((r) => r.low <= r.base && r.base <= r.high, `${what}: low <= base <= high`);

export const valuationInputs = z
  .object({
    revenue: z.number().positive('Revenue must be greater than zero').max(1e15),
    sharesOutstanding: z.number().positive('Shares outstanding must be greater than zero').max(1e13),
    netDebt: z.number().min(-1e15).max(1e15).default(0),
    terminalGrowthPct: z.number().min(0).max(10).default(2),
    growthPct: range(-100, 500, 'Growth'),
    marginPct: range(-100, 100, 'Margin'),
    discountPct: range(0, 50, 'Discount rate'),
  })
  .strict()
  .refine((i) => i.discountPct.low > i.terminalGrowthPct, { message: 'The lowest discount rate must exceed terminal growth', path: ['discountPct', 'low'] });

export type ValuationInputs = z.infer<typeof valuationInputs>;

export interface CaseValue {
  perShare: number;
  enterpriseValue: number;
  equityValue: number;
  terminalSharePct: number;
}

function dcf(i: ValuationInputs, growthPct: number, marginPct: number, discountPct: number): CaseValue {
  const g = growthPct / 100;
  const m = marginPct / 100;
  const r = discountPct / 100;
  const tg = i.terminalGrowthPct / 100;
  let pv = 0;
  let lastFcf = 0;
  for (let t = 1; t <= HORIZON_YEARS; t++) {
    const rev = i.revenue * Math.pow(1 + g, t);
    // A revenue line cannot go below zero however negative the growth input is.
    lastFcf = Math.max(rev, 0) * m;
    pv += lastFcf / Math.pow(1 + r, t);
  }
  const terminal = ((lastFcf * (1 + tg)) / (r - tg)) / Math.pow(1 + r, HORIZON_YEARS);
  const ev = pv + terminal;
  const equity = ev - i.netDebt;
  return { perShare: equity / i.sharesOutstanding, enterpriseValue: ev, equityValue: equity, terminalSharePct: ev === 0 ? 0 : (terminal / ev) * 100 };
}

export interface ValuationResult {
  low: CaseValue;
  base: CaseValue;
  high: CaseValue;
  /** Per-share values floored at zero (a share cannot be worth less than nothing). */
  prices: { low: number; base: number; high: number };
  warnings: string[];
}

export function runValuation(i: ValuationInputs): ValuationResult {
  const low = dcf(i, i.growthPct.low, i.marginPct.low, i.discountPct.high);
  const base = dcf(i, i.growthPct.base, i.marginPct.base, i.discountPct.base);
  const high = dcf(i, i.growthPct.high, i.marginPct.high, i.discountPct.low);
  const warnings: string[] = [];
  const floor = (v: number, what: string) => {
    if (v < 0) warnings.push(`The ${what} case values the equity below zero; shown as 0.`);
    return Math.max(0, v);
  };
  const prices = { low: floor(low.perShare, 'low'), base: floor(base.perShare, 'base'), high: floor(high.perShare, 'high') };
  if (base.terminalSharePct > 85) warnings.push(`${base.terminalSharePct.toFixed(0)}% of the base value comes from the terminal value; treat the target with caution.`);
  return { low, base, high, prices, warnings };
}
