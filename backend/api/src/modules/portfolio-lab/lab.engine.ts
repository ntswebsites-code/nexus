import { Prisma } from '@prisma/client';

/**
 * Pure rebalance maths and whole-book constraint checks for Portfolio Construction (SRD 5.A.4).
 * No database access: the service feeds it the portfolio snapshot and the model.
 *
 * Rules
 *   - Target value of a name = target weight x total portfolio value (securities + cash, base currency).
 *   - Names held but not in the model go to 0 (liquidate) unless `keepUnmodelled`.
 *   - Trades whose drift is below the threshold are skipped, except full exits.
 *   - Quantities round DOWN to the board lot (sells are capped at the holding; exits sell everything).
 *   - Buys are scaled down proportionally when sells + cash cannot fund them above the cash reserve.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const HUNDRED = new D(100);

export interface Holding {
  securityId: string;
  ticker: string;
  sector: string | null;
  assetClass: string;
  market: string;
  currency: string;
  boardLot: number;
  quantity: Dec;
  /** Price in the security currency; null when unpriced. */
  price: Dec | null;
  /** Units of base currency per unit of security currency; null when no rate. */
  fx: Dec | null;
}

export interface RebalanceInput {
  /** Every name that is held or in the model. Held quantity is 0 for a new buy. */
  holdings: Holding[];
  /** securityId -> target percent. */
  targets: Map<string, Dec>;
  cashBase: Dec;
  /** Percent of the portfolio to keep as cash. */
  cashTargetPct: Dec;
  driftThresholdPct: Dec;
  keepUnmodelled?: boolean;
  /** Absolute floor for cash after trades (percent), from the mandate. */
  cashFloorPct?: Dec;
}

export interface ProposedLine {
  securityId: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: Dec;
  price: Dec;
  currency: string;
  currentPct: Dec;
  targetPct: Dec;
  afterPct: Dec;
  notionalBase: Dec;
  exit: boolean;
}

export interface Proposal {
  totalValueBase: Dec;
  lines: ProposedLine[];
  /** After-trade weights by security (percent) including names with no trade. */
  afterWeights: { securityId: string; ticker: string; sector: string | null; market: string; assetClass: string; pct: Dec }[];
  cashAfterBase: Dec;
  cashAfterPct: Dec;
  turnoverPct: Dec;
  warnings: string[];
}

const unitBase = (h: Holding) => (h.price && h.fx ? h.price.mul(h.fx) : null);
const pct4 = (v: Dec) => v.toDecimalPlaces(4, D.ROUND_HALF_UP);
const floorLot = (qty: Dec, lot: number) => (lot > 1 ? qty.div(lot).floor().mul(lot) : qty.floor());

export function proposeRebalance(inp: RebalanceInput): Proposal {
  const warnings: string[] = [];
  const priced = inp.holdings.filter((h) => unitBase(h));
  for (const h of inp.holdings) if (!unitBase(h)) warnings.push(`${h.ticker} has no price or FX rate; it is left out of the rebalance`);
  const secValue = priced.reduce((s, h) => s.add(h.quantity.mul(unitBase(h)!)), ZERO);
  const total = secValue.add(inp.cashBase);
  if (total.lte(0)) return { totalValueBase: total, lines: [], afterWeights: [], cashAfterBase: inp.cashBase, cashAfterPct: ZERO, turnoverPct: ZERO, warnings: [...warnings, 'The portfolio has no value to rebalance'] };

  interface Draft {
    h: Holding;
    unit: Dec;
    current: Dec;
    target: Dec;
    side: 'BUY' | 'SELL';
    qty: Dec;
    exit: boolean;
  }
  const drafts: Draft[] = [];
  for (const h of priced) {
    const unit = unitBase(h)!;
    const currentPct = h.quantity.mul(unit).div(total).mul(HUNDRED);
    const modelled = inp.targets.get(h.securityId);
    const target = modelled ?? (inp.keepUnmodelled ? currentPct : ZERO);
    const drift = target.sub(currentPct);
    const exit = target.isZero() && h.quantity.gt(0);
    if (!exit && drift.abs().lt(inp.driftThresholdPct)) continue;
    if (drift.isZero()) continue;
    const side = drift.gt(0) ? 'BUY' : 'SELL';
    const deltaValue = drift.abs().div(HUNDRED).mul(total);
    let qty = exit ? h.quantity : floorLot(deltaValue.div(unit), h.boardLot);
    if (side === 'SELL' && qty.gt(h.quantity)) qty = h.quantity;
    if (qty.lte(0)) continue;
    drafts.push({ h, unit, current: currentPct, target, side, qty, exit });
  }

  // Fund the buys: sells + cash - reserve.
  const reservePct = D.max(inp.cashTargetPct, inp.cashFloorPct ?? ZERO);
  const reserve = reservePct.div(HUNDRED).mul(total);
  const sells = drafts.filter((d) => d.side === 'SELL').reduce((s, d) => s.add(d.qty.mul(d.unit)), ZERO);
  const buys = drafts.filter((d) => d.side === 'BUY').reduce((s, d) => s.add(d.qty.mul(d.unit)), ZERO);
  const funds = inp.cashBase.add(sells).sub(reserve);
  if (buys.gt(0) && buys.gt(funds)) {
    const scale = funds.lte(0) ? ZERO : funds.div(buys);
    warnings.push(`Buys of ${buys.toFixed(2)} exceed the cash available above the ${reservePct.toFixed(2)}% reserve; scaled to ${scale.mul(HUNDRED).toFixed(1)}%`);
    for (const d of drafts) if (d.side === 'BUY') d.qty = floorLot(d.qty.mul(scale), d.h.boardLot);
  }
  const live = drafts.filter((d) => d.qty.gt(0));

  const lines: ProposedLine[] = live
    .map((d) => {
      const signed = d.side === 'BUY' ? d.qty : d.qty.neg();
      const after = d.h.quantity.add(signed).mul(d.unit).div(total).mul(HUNDRED);
      return { securityId: d.h.securityId, ticker: d.h.ticker, side: d.side, quantity: d.qty, price: d.h.price!, currency: d.h.currency, currentPct: pct4(d.current), targetPct: pct4(d.target), afterPct: pct4(after), notionalBase: d.qty.mul(d.unit).toDecimalPlaces(4, D.ROUND_HALF_UP), exit: d.exit };
    })
    .sort((a, b) => (a.side === b.side ? a.ticker.localeCompare(b.ticker) : a.side === 'SELL' ? -1 : 1));

  const traded = new Map(live.map((d) => [d.h.securityId, d.side === 'BUY' ? d.qty : d.qty.neg()]));
  const afterWeights = priced
    .map((h) => ({ securityId: h.securityId, ticker: h.ticker, sector: h.sector, market: h.market, assetClass: h.assetClass, pct: pct4(h.quantity.add(traded.get(h.securityId) ?? ZERO).mul(unitBase(h)!).div(total).mul(HUNDRED)) }))
    .filter((w) => w.pct.gt(0));
  const sellValue = lines.filter((l) => l.side === 'SELL').reduce((s, l) => s.add(l.notionalBase), ZERO);
  const buyValue = lines.filter((l) => l.side === 'BUY').reduce((s, l) => s.add(l.notionalBase), ZERO);
  const cashAfter = inp.cashBase.add(sellValue).sub(buyValue);
  return {
    totalValueBase: total.toDecimalPlaces(4, D.ROUND_HALF_UP),
    lines,
    afterWeights,
    cashAfterBase: cashAfter.toDecimalPlaces(4, D.ROUND_HALF_UP),
    cashAfterPct: pct4(cashAfter.div(total).mul(HUNDRED)),
    turnoverPct: pct4(buyValue.add(sellValue).div(2).div(total).mul(HUNDRED)),
    warnings,
  };
}

// ---------------------------------------------------------------- constraints

export interface MandateLimits {
  maxSingleNamePct?: number;
  maxSectorPct?: number;
  cashFloorPct?: number;
  maxCashPct?: number;
  maxPositions?: number;
  restrictedTickers?: string[];
  allowedMarkets?: string[];
  allowedAssetClasses?: string[];
}

export interface ConstraintResult {
  key: string;
  label: string;
  limit: string;
  value: string;
  state: 'Pass' | 'Fail';
  detail: string;
}

/** Whole-book mandate checks on the after-trade weights. Existing breaches that the trades do not worsen are reported, not blocked. */
export function checkConstraints(m: MandateLimits, after: Proposal['afterWeights'], cashAfterPct: Dec, buysTickers: string[]): ConstraintResult[] {
  const out: ConstraintResult[] = [];
  const row = (key: string, label: string, limit: string, value: string, ok: boolean, detail: string) => out.push({ key, label, limit, value, state: ok ? 'Pass' : 'Fail', detail });
  if (m.maxSingleNamePct !== undefined) {
    const top = after.reduce<(typeof after)[number] | null>((a, w) => (!a || w.pct.gt(a.pct) ? w : a), null);
    const v = top?.pct ?? ZERO;
    row('single_name', 'Largest single name', `${m.maxSingleNamePct}%`, `${v.toFixed(2)}%`, v.lte(m.maxSingleNamePct), top ? `${top.ticker} after the trades` : 'No positions');
  }
  if (m.maxSectorPct !== undefined) {
    const bySector = new Map<string, Dec>();
    for (const w of after) bySector.set(w.sector ?? 'Unclassified', (bySector.get(w.sector ?? 'Unclassified') ?? ZERO).add(w.pct));
    const top = [...bySector.entries()].sort((a, b) => b[1].comparedTo(a[1]))[0];
    const v = top?.[1] ?? ZERO;
    row('sector', 'Largest sector', `${m.maxSectorPct}%`, `${v.toFixed(2)}%`, v.lte(m.maxSectorPct), top ? `${top[0]} after the trades` : 'No positions');
  }
  if (m.cashFloorPct !== undefined) row('cash_floor', 'Cash floor', `${m.cashFloorPct}%`, `${cashAfterPct.toFixed(2)}%`, cashAfterPct.gte(m.cashFloorPct), 'Cash after the trades');
  if (m.maxCashPct !== undefined) row('cash_cap', 'Maximum cash', `${m.maxCashPct}%`, `${cashAfterPct.toFixed(2)}%`, cashAfterPct.lte(m.maxCashPct), 'Cash after the trades');
  if (m.maxPositions !== undefined) row('positions', 'Number of positions', String(m.maxPositions), String(after.length), after.length <= m.maxPositions, 'Positions after the trades');
  if (m.restrictedTickers?.length) {
    const hit = buysTickers.filter((t) => m.restrictedTickers!.map((x) => x.toUpperCase()).includes(t.toUpperCase()));
    row('restricted', 'Restricted names', m.restrictedTickers.join(', '), hit.length ? hit.join(', ') : 'none bought', hit.length === 0, hit.length ? 'A restricted name is in the buy list' : 'No restricted name is bought');
  }
  if (m.allowedMarkets?.length) {
    const bad = after.filter((w) => !m.allowedMarkets!.includes(w.market));
    row('markets', 'Allowed markets', m.allowedMarkets.join(', '), bad.length ? bad.map((b) => b.ticker).join(', ') : 'all allowed', bad.length === 0, 'Held names outside the permitted markets');
  }
  if (m.allowedAssetClasses?.length) {
    const bad = after.filter((w) => !m.allowedAssetClasses!.includes(w.assetClass));
    row('asset_classes', 'Allowed asset classes', m.allowedAssetClasses.join(', '), bad.length ? bad.map((b) => b.ticker).join(', ') : 'all allowed', bad.length === 0, 'Held names outside the permitted asset classes');
  }
  return out;
}

/** Model validation: weights are positive, unique and, with the cash target, never exceed 100%. An ACTIVE model sums to exactly 100%. */
export function modelProblems(weights: { securityId: string; targetPct: Dec }[], cashTargetPct: Dec, forActivation: boolean): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const w of weights) {
    if (seen.has(w.securityId)) problems.push('A security appears twice in the model');
    seen.add(w.securityId);
    if (w.targetPct.lte(0)) problems.push('Target weights must be above 0');
  }
  const sum = weights.reduce((s, w) => s.add(w.targetPct), ZERO).add(cashTargetPct);
  if (sum.gt(HUNDRED.add('0.0001'))) problems.push(`Weights plus the cash target total ${sum.toFixed(4)}%, which is over 100%`);
  if (forActivation) {
    if (!weights.length) problems.push('An active model needs at least one holding');
    if (sum.sub(HUNDRED).abs().gt('0.0001')) problems.push(`Weights plus the cash target must total 100% (now ${sum.toFixed(4)}%)`);
  }
  return [...new Set(problems)];
}
