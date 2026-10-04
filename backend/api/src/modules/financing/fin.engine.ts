import { Prisma } from '@prisma/client';

/**
 * Pure collateral and margin maths for Collateral & Financing (SRD 5.A.15 `financing`). No database access.
 *
 * Collateral value = market value x (1 - haircut) for eligible assets. A rule group (asset class + market) with a
 * pool cap counts at most cap% of the pool's total eligible after-haircut value (single pass, pro rata inside the group).
 * Coverage = counted collateral / drawn. Below the maintenance ratio the facility is in margin deficit and a call restores
 * coverage to the initial ratio: call = drawn x initial - counted collateral.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const HUNDRED = new D(100);

export const FACILITY_TYPES = ['MARGIN_LOAN', 'REPO', 'SEC_LENDING', 'OVERDRAFT'] as const;
export const OPEN_CALL = ['ISSUED', 'ACKNOWLEDGED', 'DISPUTED', 'PENDING_CHECK'];
/// Coverage within this multiple of maintenance is a warning.
export const WARN_BUFFER = new D('1.10');

export interface Rule {
  assetClass: string;
  market: string;
  eligible: boolean;
  haircutPct: Dec;
  maxPoolPct: Dec | null;
}

/** Most specific active rule: asset class + market, else asset class with any market. Null = no rule (ineligible). */
export function pickRule(rules: Rule[], assetClass: string, market: string): Rule | null {
  return rules.find((r) => r.assetClass === assetClass && r.market === market) ?? rules.find((r) => r.assetClass === assetClass && r.market === '') ?? null;
}

export interface CollateralInput {
  itemId: string;
  securityId: string;
  ticker: string;
  assetClass: string;
  market: string;
  quantity: Dec;
  /** Market value in the valuation currency; null when unpriced or no FX rate. */
  marketValue: Dec | null;
}

export interface ValuedLine extends CollateralInput {
  eligible: boolean;
  haircutPct: Dec;
  afterHaircut: Dec;
  counted: Dec;
  capped: boolean;
  reason: string | null;
}

export interface PoolValuation {
  lines: ValuedLine[];
  marketValue: Dec;
  afterHaircut: Dec;
  counted: Dec;
  ineligible: Dec;
  warnings: string[];
}

export function valuePool(items: CollateralInput[], rules: Rule[]): PoolValuation {
  const warnings: string[] = [];
  const lines: ValuedLine[] = items.map((i) => {
    if (i.marketValue === null) {
      warnings.push(`${i.ticker} is unpriced and counts as zero`);
      return { ...i, eligible: false, haircutPct: ZERO, afterHaircut: ZERO, counted: ZERO, capped: false, reason: 'No price or FX rate' };
    }
    const rule = pickRule(rules, i.assetClass, i.market);
    if (!rule) return { ...i, eligible: false, haircutPct: ZERO, afterHaircut: ZERO, counted: ZERO, capped: false, reason: `No eligibility rule for ${i.assetClass}` };
    if (!rule.eligible) return { ...i, eligible: false, haircutPct: rule.haircutPct, afterHaircut: ZERO, counted: ZERO, capped: false, reason: `${i.assetClass} is not eligible collateral` };
    const after = i.marketValue.mul(HUNDRED.sub(rule.haircutPct)).div(HUNDRED);
    return { ...i, eligible: true, haircutPct: rule.haircutPct, afterHaircut: after, counted: after, capped: false, reason: null };
  });
  const totalAfter = lines.reduce((s, l) => s.add(l.afterHaircut), ZERO);
  const groups = new Map<string, { cap: Dec; idx: number[] }>();
  lines.forEach((l, idx) => {
    if (!l.eligible) return;
    const r = pickRule(rules, l.assetClass, l.market)!;
    if (!r.maxPoolPct) return;
    const k = `${r.assetClass}|${r.market}`;
    const g = groups.get(k) ?? { cap: r.maxPoolPct, idx: [] };
    g.idx.push(idx);
    groups.set(k, g);
  });
  for (const g of groups.values()) {
    const groupValue = g.idx.reduce((s, i) => s.add(lines[i]!.afterHaircut), ZERO);
    const limit = totalAfter.mul(g.cap).div(HUNDRED);
    if (groupValue.gt(limit) && groupValue.gt(0)) {
      const f = limit.div(groupValue);
      for (const i of g.idx) {
        lines[i]!.counted = lines[i]!.afterHaircut.mul(f);
        lines[i]!.capped = true;
        lines[i]!.reason = `Above the ${g.cap.toFixed(2)}% pool cap; counted at ${f.mul(HUNDRED).toFixed(1)}%`;
      }
    }
  }
  const sum = (f: (l: ValuedLine) => Dec) => lines.reduce((s, l) => s.add(f(l)), ZERO);
  return {
    lines,
    marketValue: sum((l) => l.marketValue ?? ZERO).toDecimalPlaces(4, D.ROUND_HALF_UP),
    afterHaircut: totalAfter.toDecimalPlaces(4, D.ROUND_HALF_UP),
    counted: sum((l) => l.counted).toDecimalPlaces(4, D.ROUND_HALF_UP),
    ineligible: sum((l) => (l.eligible ? ZERO : (l.marketValue ?? ZERO))).toDecimalPlaces(4, D.ROUND_HALF_UP),
    warnings,
  };
}

export interface FacilityTerms {
  limitAmount: Dec;
  initialRatio: Dec;
  maintenanceRatio: Dec;
}

export type MarginState = 'NO_DRAWINGS' | 'OK' | 'WARNING' | 'DEFICIT';

export interface Margin {
  drawn: Dec;
  counted: Dec;
  coverage: Dec | null;
  state: MarginState;
  /** Counted collateral above the maintenance requirement (negative = deficit). */
  excess: Dec;
  /** What a margin call would ask for: restores coverage to the initial ratio. Zero when not in deficit. */
  callAmount: Dec;
  /** Room to draw within the limit and still hold the initial ratio. */
  availableToDraw: Dec;
}

export function margin(t: FacilityTerms, drawn: Dec, counted: Dec): Margin {
  const coverage = drawn.gt(0) ? counted.div(drawn).toDecimalPlaces(4, D.ROUND_HALF_UP) : null;
  const requirement = drawn.mul(t.maintenanceRatio);
  const state: MarginState = !coverage ? 'NO_DRAWINGS' : coverage.lt(t.maintenanceRatio) ? 'DEFICIT' : coverage.lt(t.maintenanceRatio.mul(WARN_BUFFER)) ? 'WARNING' : 'OK';
  const restore = drawn.mul(t.initialRatio).sub(counted);
  const byCollateral = counted.div(t.initialRatio).sub(drawn);
  const byLimit = t.limitAmount.sub(drawn);
  const room = D.min(byCollateral, byLimit);
  return {
    drawn,
    counted,
    coverage,
    state,
    excess: counted.sub(requirement).toDecimalPlaces(4, D.ROUND_HALF_UP),
    callAmount: state === 'DEFICIT' && restore.gt(0) ? restore.toDecimalPlaces(4, D.ROUND_HALF_UP) : ZERO,
    availableToDraw: room.lt(0) ? ZERO : room.toDecimalPlaces(4, D.ROUND_HALF_UP),
  };
}

/** Terms sanity: initial above maintenance above or at 1; limit positive. */
export function termsProblems(t: FacilityTerms): string[] {
  const p: string[] = [];
  if (t.maintenanceRatio.lt(1)) p.push('The maintenance ratio cannot be below 1.00 (the loan would be under-collateralised)');
  if (t.initialRatio.lt(t.maintenanceRatio)) p.push('The initial ratio must be at or above the maintenance ratio');
  if (t.limitAmount.lte(0)) p.push('The facility limit must be positive');
  return p;
}

/**
 * Margin disposition (FR-FIN-002, FR-FIN-004, BR-070). A maker proposes how an open call ends and an independent checker
 * approves it. FUNDED needs the call to be issued or acknowledged; DISPUTE_RESOLVED needs it to be disputed, and records
 * the counterparty's evidence and the house calculation.
 */
export const DISPOSITION_KINDS = ['FUNDED', 'DISPUTE_RESOLVED'] as const;
export const DISPUTE_OUTCOMES = ['CALL_STANDS', 'CALL_WITHDRAWN'] as const;
export const DISPOSITION_FROM: Record<(typeof DISPOSITION_KINDS)[number], string[]> = { FUNDED: ['ISSUED', 'ACKNOWLEDGED'], DISPUTE_RESOLVED: ['DISPUTED'] };

export function dispositionProblems(kind: (typeof DISPOSITION_KINDS)[number], status: string, input: { counterpartyEvidenceRef?: string | null; houseCalcAmount?: unknown; houseCalcNote?: string | null; outcome?: string | null; fundingLedgerId?: string | null }): string[] {
  const out: string[] = [];
  if (!DISPOSITION_FROM[kind].includes(status)) out.push(`A ${kind === 'FUNDED' ? 'funding' : 'dispute resolution'} needs a call that is ${DISPOSITION_FROM[kind].join(' or ').toLowerCase()}, not ${status.toLowerCase()}`);
  if (kind === 'DISPUTE_RESOLVED') {
    if (!input.counterpartyEvidenceRef) out.push('counterpartyEvidenceRef: record the counterparty evidence (statement, email or valuation reference)');
    if (input.houseCalcAmount === undefined || input.houseCalcAmount === null || input.houseCalcAmount === '') out.push('houseCalcAmount: record the house-calculated call amount');
    if (!input.houseCalcNote) out.push('houseCalcNote: explain the house calculation');
    if (!input.outcome) out.push('outcome: CALL_STANDS or CALL_WITHDRAWN');
  } else if (!input.fundingLedgerId) out.push('fundingLedgerId: choose the bank ledger the cash leaves from');
  return out;
}
