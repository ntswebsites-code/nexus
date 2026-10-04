import { Prisma } from '@prisma/client';

/**
 * Reconciliation matching rules (SRD FR-OPS-002, 6.10; V61 notes). Pure functions only: no database access, so the
 * hand-computed cases in `scripts/test-recon.ts` and the service share one implementation.
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const FAMILIES = ['TRADES', 'CASH', 'HOLDINGS', 'DAYEND_COUNT', 'POSITIONS_VS_CUSTODY', 'SETTLEMENT_FAILS', 'CORP_ACTIONS'] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = {
  TRADES: 'Trades',
  CASH: 'Cash',
  HOLDINGS: 'Holdings',
  DAYEND_COUNT: 'Day-end trade count',
  POSITIONS_VS_CUSTODY: 'Positions vs custody',
  SETTLEMENT_FAILS: 'Settlement fails',
  CORP_ACTIONS: 'Corporate actions',
};

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];
const RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export const BREAK_STATUSES = ['NEW', 'ASSIGNED', 'INVESTIGATING', 'PENDING_CHECKER', 'MATCHED', 'CLOSED'] as const;
export type BreakStatus = (typeof BREAK_STATUSES)[number];
export const OPEN_STATUSES: BreakStatus[] = ['NEW', 'ASSIGNED', 'INVESTIGATING', 'PENDING_CHECKER'];
export const TERMINAL_STATUSES: BreakStatus[] = ['MATCHED', 'CLOSED'];
/** Material breaks block the daily sign-off while open. */
export const MATERIAL: Severity[] = ['HIGH', 'CRITICAL'];

export const CAUSES = ['TIMING', 'BOOKING_ERROR', 'CUSTODIAN_ERROR', 'PRICE_SOURCE', 'FX', 'FEES', 'CORPORATE_ACTION', 'OTHER'] as const;

/** A break older than this many days (or any CRITICAL break) is flagged overdue. */
export const SLA_DAYS = 3;

export interface Tolerances {
  /** Absolute execution price tolerance (+/-). */
  price: string;
  /** Absolute cash tolerance (+/-), in the statement currency. */
  cash: string;
  /** Holdings control-total tolerance, percent of the custodian value. */
  holdingsPct: string;
  /** Absolute quantity tolerance (+/-) for positions vs custody. */
  positionQty: string;
  /** Days after the expected settlement date before an unsettled trade counts as a fail. */
  settleDays: number;
  /** Absolute net cash tolerance (+/-) for a corporate-action entitlement, in its currency. */
  caCash: string;
}
export const DEFAULT_TOLERANCES: Tolerances = { price: '0.01', cash: '0.01', holdingsPct: '0.5', positionQty: '0', settleDays: 0, caCash: '0.01' };
/** Default trade-date to settlement-date offset (calendar days) when the custodian gave no settlement date. */
export const DEFAULT_SETTLE_OFFSET_DAYS = 2;

export function maxSeverity(a: Severity, b: Severity): Severity {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Severity from the size of a difference relative to the item (percent): at least 20% CRITICAL, above 5% HIGH,
 * above 1% MEDIUM, otherwise LOW.
 */
export function severityForPct(pct: Dec | number | string): Severity {
  const p = new D(pct).abs();
  if (p.gte(20)) return 'CRITICAL';
  if (p.gt(5)) return 'HIGH';
  if (p.gt(1)) return 'MEDIUM';
  return 'LOW';
}

/** |external - internal| as a percent of the larger of the two magnitudes; null when both are zero. */
export function pctDiff(internal: Dec, external: Dec): Dec | null {
  const base = D.max(internal.abs(), external.abs());
  if (base.isZero()) return null;
  return external.minus(internal).abs().div(base).mul(100);
}

export type BreakKind =
  | 'MISSING_INTERNAL'
  | 'MISSING_EXTERNAL'
  | 'PRICE_OUT_OF_TOLERANCE'
  | 'QUANTITY_DIFF'
  | 'ATTRIBUTE_DIFF'
  | 'CASH_DIFF'
  | 'HOLDINGS_DIFF'
  | 'COUNT_DIFF'
  | 'POSITION_QTY_DIFF'
  | 'POSITION_MISSING_INTERNAL'
  | 'POSITION_MISSING_CUSTODY'
  | 'SETTLEMENT_FAIL'
  | 'CA_ENTITLEMENT_DIFF'
  | 'CA_MISSING_INTERNAL'
  | 'CA_MISSING_CUSTODY';

/** One difference found by a run, before it is persisted as a break. */
export interface Detected {
  itemKey: string;
  kind: BreakKind;
  label: string;
  severity: Severity;
  internal: Record<string, unknown> | null;
  external: Record<string, unknown> | null;
  difference: string | null;
  differencePct: string | null;
  currency: string | null;
  counterpartyId: string | null;
  portfolioId: string | null;
}

// ---------------------------------------------------------------- trades

export interface ExtTrade {
  id: string;
  tradeRef: string;
  ticker: string;
  side: string;
  quantity: Dec;
  price: Dec;
  currency: string;
  counterpartyId: string;
  counterpartyRef: string;
  accountRef: string;
  portfolioId: string;
}
export interface IntFill {
  id: string;
  /** Contract-note / broker reference and the order reference, normalised, used for the reference match. */
  refs: string[];
  orderRef: string;
  ticker: string;
  side: string;
  quantity: Dec;
  price: Dec;
  currency: string;
  portfolioId: string;
  /** Set when several partial fills of one order were aggregated into this row (ids of every member fill). */
  memberIds?: string[];
}

/** Rate to convert one unit of `from` into `to`; null when unknown. */
export type FxLookup = (from: string, to: string) => Dec | null;
/** Extra relative price slack (percent of the internal price) when the two sides are in different currencies. */
export const FX_PRICE_BUFFER_PCT = new D('0.1');

const norm = (s: string) => s.trim().toUpperCase();

/** One row standing for several partial fills of the same order: summed quantity, volume-weighted price. */
export function aggregateFills(group: IntFill[]): IntFill {
  const qty = group.reduce((s, g) => s.plus(g.quantity), new D(0));
  const notional = group.reduce((s, g) => s.plus(g.quantity.mul(g.price)), new D(0));
  const first = group[0]!;
  return {
    ...first,
    refs: [...new Set(group.flatMap((g) => g.refs))],
    quantity: qty,
    price: qty.isZero() ? first.price : notional.div(qty).toDecimalPlaces(8),
    memberIds: group.map((g) => g.id),
  };
}

export interface TradeOutcome {
  matched: ExtTrade[];
  detected: Detected[];
  /** External trades that produced a break (their custodian status becomes Exception). */
  exceptionExts: ExtTrade[];
}

function tradeValue(t: { quantity: Dec; price: Dec; side: string; ticker: string; currency: string }) {
  return { ticker: t.ticker, side: t.side, quantity: t.quantity.toString(), price: t.price.toString(), currency: t.currency };
}
const tradeLabel = (t: { side: string; quantity: Dec; ticker: string; price: Dec; currency: string }) =>
  `${t.side} ${t.quantity.toString()} ${t.ticker} @ ${t.price.toString()} ${t.currency}`;

/**
 * Trade matching for one portfolio's population. Pass 1: exact trade reference (custodian `tradeRef` against the fill's
 * contract-note reference or the order reference). Pass 2: ticker + side + exact quantity, preferring the closest price.
 * Pass 3: several partial fills of one order whose summed quantity equals the custodian quantity are aggregated
 * (volume-weighted price) and matched as one trade; the same aggregation is applied in pass 1 when the reference points
 * at an order with several fills. Quantity must be exact; the price must be within +/- `priceTol`. When the custodian
 * reports in another currency the price is converted with `fx` (rate for the date) and an extra
 * `FX_PRICE_BUFFER_PCT` of the internal price is allowed for rate rounding; with no rate it is an attribute break.
 * Everything left on either side is a break.
 */
export function matchTrades(exts: ExtTrade[], ints: IntFill[], priceTol: Dec, fx?: FxLookup, opts: { suppressMissingExternal?: boolean } = {}): TradeOutcome {
  const out: TradeOutcome = { matched: [], detected: [], exceptionExts: [] };
  const freeInts = new Set(ints.map((i) => i.id));
  const byId = new Map(ints.map((i) => [i.id, i]));
  const pairs: { ext: ExtTrade; int: IntFill; via: 'REFERENCE' | 'ATTRIBUTES' | 'AGGREGATED' }[] = [];
  const unmatchedExts: ExtTrade[] = [];

  const consume = (group: IntFill[]) => {
    for (const g of group) freeInts.delete(g.id);
  };
  const freeOfOrder = (seed: IntFill) => ints.filter((i) => freeInts.has(i.id) && i.orderRef === seed.orderRef && i.portfolioId === seed.portfolioId);

  // Pass 1: reference
  for (const e of exts) {
    const ref = norm(e.tradeRef);
    const hit = ints.find((i) => freeInts.has(i.id) && i.refs.some((r) => r === ref));
    if (!hit) {
      unmatchedExts.push(e);
      continue;
    }
    const group = freeOfOrder(hit);
    const total = group.reduce((s, g) => s.plus(g.quantity), new D(0));
    if (group.length > 1 && !hit.quantity.equals(e.quantity) && total.equals(e.quantity)) {
      consume(group);
      pairs.push({ ext: e, int: aggregateFills(group), via: 'AGGREGATED' });
    } else {
      freeInts.delete(hit.id);
      pairs.push({ ext: e, int: hit, via: 'REFERENCE' });
    }
  }
  // Pass 2 (ticker + side + quantity) and pass 3 (aggregated partial fills of one order)
  const stillUnmatched: ExtTrade[] = [];
  for (const e of unmatchedExts) {
    const cands = [...freeInts]
      .map((id) => byId.get(id)!)
      .filter((i) => norm(i.ticker) === norm(e.ticker) && norm(i.side) === norm(e.side) && i.quantity.equals(e.quantity));
    if (cands.length) {
      cands.sort((a, b) => a.price.minus(e.price).abs().comparedTo(b.price.minus(e.price).abs()));
      const best = cands[0]!;
      freeInts.delete(best.id);
      pairs.push({ ext: e, int: best, via: 'ATTRIBUTES' });
      continue;
    }
    const orders = new Map<string, IntFill[]>();
    for (const id of freeInts) {
      const i = byId.get(id)!;
      if (norm(i.ticker) !== norm(e.ticker) || norm(i.side) !== norm(e.side)) continue;
      orders.set(i.orderRef, [...(orders.get(i.orderRef) ?? []), i]);
    }
    const group = [...orders.values()].find((g) => g.length > 1 && g.reduce((s, x) => s.plus(x.quantity), new D(0)).equals(e.quantity));
    if (group) {
      consume(group);
      pairs.push({ ext: e, int: aggregateFills(group), via: 'AGGREGATED' });
    } else stillUnmatched.push(e);
  }

  for (const { ext, int, via } of pairs) {
    const sameCur = int.currency === ext.currency;
    const rate = sameCur ? null : (fx?.(ext.currency, int.currency) ?? null);
    const extPrice = rate ? ext.price.mul(rate) : ext.price;
    const base = {
      counterpartyId: ext.counterpartyId,
      portfolioId: ext.portfolioId,
      currency: ext.currency,
      itemKey: `TRD:${ext.counterpartyRef}:${ext.tradeRef}`.slice(0, 190),
      internal: { ...tradeValue(int), orderRef: int.orderRef, matchedBy: via, ...(int.memberIds ? { aggregatedFills: int.memberIds.length } : {}) },
      external: { ...tradeValue(ext), tradeRef: ext.tradeRef, account: ext.accountRef, matchedBy: via, ...(rate ? { fxRateToInternalCurrency: rate.toString(), priceInInternalCurrency: extPrice.toDecimalPlaces(6).toString() } : {}) },
    };
    const attrDiff = norm(int.ticker) !== norm(ext.ticker) || norm(int.side) !== norm(ext.side) || (!sameCur && !rate);
    if (attrDiff) {
      out.detected.push({
        ...base,
        kind: 'ATTRIBUTE_DIFF',
        label: `Trade ${ext.tradeRef}: instrument, side or currency differs (${tradeLabel(int)} vs ${tradeLabel(ext)})${!sameCur && !rate ? `; no ${ext.currency}/${int.currency} rate to compare prices` : ''}`,
        severity: 'HIGH',
        difference: null,
        differencePct: null,
      });
      out.exceptionExts.push(ext);
      continue;
    }
    if (!int.quantity.equals(ext.quantity)) {
      const diff = ext.quantity.minus(int.quantity);
      const pct = pctDiff(int.quantity, ext.quantity);
      out.detected.push({
        ...base,
        kind: 'QUANTITY_DIFF',
        label: `Trade ${ext.tradeRef}: quantity ${int.quantity.toString()} internal vs ${ext.quantity.toString()} custodian`,
        severity: maxSeverity('HIGH', pct ? severityForPct(pct) : 'HIGH'),
        difference: diff.toString(),
        differencePct: pct ? pct.toFixed(4) : null,
      });
      out.exceptionExts.push(ext);
      continue;
    }
    const pdiff = extPrice.minus(int.price);
    const tol = rate ? D.max(priceTol, int.price.abs().mul(FX_PRICE_BUFFER_PCT).div(100)) : priceTol;
    if (pdiff.abs().gt(tol)) {
      const pct = pctDiff(int.price, extPrice);
      out.detected.push({
        ...base,
        kind: 'PRICE_OUT_OF_TOLERANCE',
        label: `Trade ${ext.tradeRef} ${ext.ticker}: price ${int.price.toString()} ${int.currency} internal vs ${rate ? `${extPrice.toDecimalPlaces(6).toString()} ${int.currency} (${ext.price.toString()} ${ext.currency} at ${rate.toString()})` : ext.price.toString()} custodian (tolerance ${tol.toDecimalPlaces(6).toString()})`,
        severity: pct ? severityForPct(pct) : 'LOW',
        difference: pdiff.toString(),
        differencePct: pct ? pct.toFixed(4) : null,
      });
      out.exceptionExts.push(ext);
      continue;
    }
    out.matched.push(ext);
  }

  for (const e of stillUnmatched) {
    out.detected.push({
      itemKey: `TRD:${e.counterpartyRef}:${e.tradeRef}`.slice(0, 190),
      kind: 'MISSING_INTERNAL',
      label: `Custodian trade ${e.tradeRef} not in the internal book: ${tradeLabel(e)}`,
      severity: 'CRITICAL',
      internal: null,
      external: { ...tradeValue(e), tradeRef: e.tradeRef, account: e.accountRef },
      difference: null,
      differencePct: null,
      currency: e.currency,
      counterpartyId: e.counterpartyId,
      portfolioId: e.portfolioId,
    });
    out.exceptionExts.push(e);
  }
  // BR-065: an internal fill cannot be called "not confirmed" while the counterparty population is incomplete.
  for (const id of opts.suppressMissingExternal ? [] : freeInts) {
    const i = byId.get(id)!;
    out.detected.push({
      itemKey: `FILL:${i.id}`,
      kind: 'MISSING_EXTERNAL',
      label: `Internal fill on ${i.orderRef} not confirmed by the custodian: ${tradeLabel(i)}`,
      severity: 'HIGH',
      internal: { ...tradeValue(i), orderRef: i.orderRef },
      external: null,
      difference: null,
      differencePct: null,
      currency: i.currency,
      counterpartyId: null,
      portfolioId: i.portfolioId,
    });
  }
  return out;
}

// ---------------------------------------------------------------- amounts

/** Compare an internal amount with a custodian amount; null when within the absolute tolerance. */
export function compareAmount(
  internal: Dec,
  external: Dec,
  tol: { abs?: Dec; pctOfExternal?: Dec },
): { difference: Dec; pct: Dec | null; severity: Severity } | null {
  const diff = external.minus(internal);
  const limit = tol.pctOfExternal ? external.abs().mul(tol.pctOfExternal).div(100) : (tol.abs ?? new D(0));
  if (diff.abs().lte(limit)) return null;
  const pct = pctDiff(internal, external);
  return { difference: diff, pct, severity: pct ? severityForPct(pct) : 'LOW' };
}

/** Day-end trade count against executions received: any difference is at least HIGH (a trade is missing or extra). */
export function compareCount(packageCount: number, received: number): { difference: number; pct: Dec | null; severity: Severity } | null {
  if (packageCount === received) return null;
  const pct = pctDiff(new D(received), new D(packageCount));
  return { difference: packageCount - received, pct, severity: maxSeverity('HIGH', pct ? severityForPct(pct) : 'HIGH') };
}

/**
 * BR-065: the independent counterparty population (executions or the day-end package) must have been received before a
 * difference may be classified as a break. Pure rule shared by the run and the sign-off readiness.
 */
export function populationReceived(executionsReceived: number, dayEndPackageReceived: boolean): boolean {
  return executionsReceived > 0 || dayEndPackageReceived;
}

/** Stable JSON used to tell whether a re-run found the same difference again. */
export function signature(d: Pick<Detected, 'kind' | 'internal' | 'external' | 'difference'>): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)]))
        : v;
  const dec = (v: string | null) => (v === null ? null : new D(v).toString());
  return JSON.stringify(sort({ k: d.kind, i: d.internal, e: d.external, d: dec(d.difference) }));
}

// ---------------------------------------------------------------- positions vs custody

export interface PosRow {
  ticker: string;
  quantity: Dec;
}
export interface PosCtx {
  counterpartyId: string;
  counterpartyRef: string;
  accountRef: string;
  portfolioId: string;
  portfolioRef: string;
  currency?: string | null;
}

/**
 * Quantity per security, internal book against the custodian's statement for one mapped account. A difference within
 * +/- `tol` shares matches. A holding only the custodian reports is CRITICAL (we do not know we own it); one only we
 * hold is HIGH; a quantity difference is at least HIGH. Zero quantities on either side are ignored.
 */
export function matchPositions(internal: PosRow[], custody: PosRow[], tol: Dec, ctx: PosCtx): { matched: number; detected: Detected[] } {
  const sum = (rows: PosRow[]) => {
    const m = new Map<string, Dec>();
    for (const r of rows) m.set(norm(r.ticker), (m.get(norm(r.ticker)) ?? new D(0)).plus(r.quantity));
    return m;
  };
  const i = sum(internal);
  const c = sum(custody);
  const out = { matched: 0, detected: [] as Detected[] };
  const base = { counterpartyId: ctx.counterpartyId, portfolioId: ctx.portfolioId, currency: null as string | null };
  for (const t of [...new Set([...i.keys(), ...c.keys()])].sort()) {
    const iq = i.get(t) ?? new D(0);
    const cq = c.get(t) ?? new D(0);
    if (iq.isZero() && cq.isZero()) continue;
    const itemKey = `POS:${ctx.counterpartyRef}:${ctx.accountRef}:${t}`.slice(0, 190);
    const where = { account: ctx.accountRef, portfolio: ctx.portfolioRef };
    if (iq.isZero()) {
      out.detected.push({ ...base, itemKey, kind: 'POSITION_MISSING_INTERNAL', label: `${ctx.accountRef} ${t}: custodian holds ${cq.toString()} but the internal book has none`, severity: 'CRITICAL', internal: null, external: { ticker: t, quantity: cq.toString(), ...where }, difference: null, differencePct: null });
      continue;
    }
    if (cq.isZero()) {
      out.detected.push({ ...base, itemKey, kind: 'POSITION_MISSING_CUSTODY', label: `${ctx.accountRef} ${t}: internal book holds ${iq.toString()} but the custodian reports none`, severity: 'HIGH', internal: { ticker: t, quantity: iq.toString(), ...where }, external: null, difference: null, differencePct: null });
      continue;
    }
    const diff = cq.minus(iq);
    if (diff.abs().lte(tol)) {
      out.matched += 1;
      continue;
    }
    const pct = pctDiff(iq, cq);
    out.detected.push({
      ...base,
      itemKey,
      kind: 'POSITION_QTY_DIFF',
      label: `${ctx.accountRef} ${t}: ${iq.toString()} internal vs ${cq.toString()} custodian (tolerance ${tol.toString()})`,
      severity: maxSeverity('HIGH', pct ? severityForPct(pct) : 'HIGH'),
      internal: { ticker: t, quantity: iq.toString(), ...where },
      external: { ticker: t, quantity: cq.toString(), ...where },
      difference: diff.toString(),
      differencePct: pct ? pct.toFixed(4) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- settlement fails

export interface SettleTrade {
  orderRef: string;
  ticker: string;
  side: string;
  quantity: Dec;
  currency: string;
  portfolioId: string;
  /** YYYY-MM-DD of the last fill. */
  tradeDate: string;
  /** YYYY-MM-DD: the custodian's settlement date, else trade date + the default offset. */
  expectedSettle: string;
  settleSource: 'CUSTODIAN' | 'DEFAULT';
  counterpartyId: string | null;
  counterpartyRef: string | null;
  accountRef: string | null;
  /** The order was Settled (booked) on or before the as-of date. */
  settled: boolean;
}

export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
export const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** 1-2 days late MEDIUM, 3-5 HIGH, more than 5 CRITICAL. */
export function failSeverity(daysLate: number): Severity {
  return daysLate > 5 ? 'CRITICAL' : daysLate > 2 ? 'HIGH' : 'MEDIUM';
}

/**
 * Filled trades that should have settled by the as-of date and have not. The expected date is the custodian's
 * settlement date when it reported one, else the trade date plus the default offset. A fail starts the day after
 * expected settlement plus `graceDays`. Settled trades and trades not yet due count as matched.
 */
export function detectSettlementFails(trades: SettleTrade[], asOf: string, graceDays: number): { matched: number; detected: Detected[] } {
  const out = { matched: 0, detected: [] as Detected[] };
  for (const t of trades) {
    const late = dayDiff(asOf, t.expectedSettle);
    if (t.settled || late <= graceDays) {
      out.matched += 1;
      continue;
    }
    out.detected.push({
      itemKey: `SFAIL:${t.orderRef}`,
      kind: 'SETTLEMENT_FAIL',
      label: `${t.orderRef} ${t.side} ${t.quantity.toString()} ${t.ticker} traded ${t.tradeDate} was due to settle ${t.expectedSettle} and is still unsettled (${late} day${late === 1 ? '' : 's'} late)`,
      severity: failSeverity(late),
      internal: { orderRef: t.orderRef, ticker: t.ticker, side: t.side, quantity: t.quantity.toString(), tradeDate: t.tradeDate, status: 'Filled, not settled' },
      external: { expectedSettlement: t.expectedSettle, expectedFrom: t.settleSource === 'CUSTODIAN' ? 'custodian execution' : 'default T+' + DEFAULT_SETTLE_OFFSET_DAYS, ...(t.accountRef ? { account: t.accountRef } : {}) },
      difference: String(late),
      differencePct: null,
      currency: t.currency,
      counterpartyId: t.counterpartyId,
      portfolioId: t.portfolioId,
    });
  }
  return out;
}

// ---------------------------------------------------------------- corporate actions

export interface IntEntitlement {
  eventRef: string;
  ticker: string;
  type: string;
  exDate: string;
  portfolioId: string;
  /** Record-date holding the entitlement was computed on. */
  quantity: Dec;
  /** Net cash effect of the entitlement. */
  cashAmount: Dec;
  currency: string;
}
export interface CustodyNotice {
  ticker: string;
  exDate: string;
  quantity: Dec;
  cashAmount: Dec;
  currency: string;
  externalRef: string | null;
}
export interface CaCtx {
  counterpartyId: string;
  counterpartyRef: string;
  accountRef: string;
  portfolioId: string;
  portfolioRef: string;
}

/**
 * Corporate-action entitlements per (security, ex date): our computed entitlement against the custodian's notice for
 * the account. Quantity must be exact; net cash must be within +/- `cashTol`. An entitlement the custodian does not
 * report is HIGH, a custodian notice we have no entitlement for is CRITICAL, a difference is at least HIGH.
 */
export function matchCorpActions(internal: IntEntitlement[], custody: CustodyNotice[], cashTol: Dec, ctx: CaCtx): { matched: number; detected: Detected[] } {
  const key = (t: string, d: string) => `${norm(t)}|${d}`;
  const i = new Map<string, IntEntitlement>();
  for (const e of internal) i.set(key(e.ticker, e.exDate), e);
  const c = new Map<string, { qty: Dec; cash: Dec; currency: string; refs: string[] }>();
  for (const n of custody) {
    const k = key(n.ticker, n.exDate);
    const cur = c.get(k);
    c.set(k, { qty: (cur?.qty ?? new D(0)).plus(n.quantity), cash: (cur?.cash ?? new D(0)).plus(n.cashAmount), currency: n.currency, refs: [...(cur?.refs ?? []), ...(n.externalRef ? [n.externalRef] : [])] });
  }
  const out = { matched: 0, detected: [] as Detected[] };
  for (const k of [...new Set([...i.keys(), ...c.keys()])].sort()) {
    const ie = i.get(k);
    const ce = c.get(k);
    const [ticker, exDate] = k.split('|') as [string, string];
    const itemKey = `CA:${ctx.counterpartyRef}:${ctx.accountRef}:${ticker}:${exDate}`.slice(0, 190);
    const base = { counterpartyId: ctx.counterpartyId, portfolioId: ctx.portfolioId, itemKey };
    const where = { account: ctx.accountRef, portfolio: ctx.portfolioRef };
    if (ie && !ce) {
      out.detected.push({ ...base, kind: 'CA_MISSING_CUSTODY', label: `${ie.eventRef} ${ticker} ${ie.type} (ex ${exDate}): entitlement ${ie.quantity.toString()} / ${ie.cashAmount.toString()} ${ie.currency} not reported by the custodian`, severity: 'HIGH', internal: { event: ie.eventRef, type: ie.type, quantity: ie.quantity.toString(), cashAmount: ie.cashAmount.toString(), currency: ie.currency, ...where }, external: null, difference: null, differencePct: null, currency: ie.currency });
      continue;
    }
    if (!ie && ce) {
      out.detected.push({ ...base, kind: 'CA_MISSING_INTERNAL', label: `${ticker} (ex ${exDate}): custodian reports ${ce.qty.toString()} / ${ce.cash.toString()} ${ce.currency} but we hold no entitlement`, severity: 'CRITICAL', internal: null, external: { quantity: ce.qty.toString(), cashAmount: ce.cash.toString(), currency: ce.currency, ...(ce.refs.length ? { externalRef: ce.refs.join(', ') } : {}), ...where }, difference: null, differencePct: null, currency: ce.currency });
      continue;
    }
    if (!ie || !ce) continue;
    const dq = ce.qty.minus(ie.quantity);
    const dc = ce.cash.minus(ie.cashAmount);
    if (dq.isZero() && dc.abs().lte(cashTol) && ce.currency === ie.currency) {
      out.matched += 1;
      continue;
    }
    const pct = !dc.isZero() || ce.currency !== ie.currency ? pctDiff(ie.cashAmount, ce.cash) : pctDiff(ie.quantity, ce.qty);
    out.detected.push({
      ...base,
      kind: 'CA_ENTITLEMENT_DIFF',
      label: `${ie.eventRef} ${ticker} ${ie.type} (ex ${exDate}): ${ie.quantity.toString()} / ${ie.cashAmount.toString()} ${ie.currency} internal vs ${ce.qty.toString()} / ${ce.cash.toString()} ${ce.currency} custodian`,
      severity: maxSeverity('HIGH', pct ? severityForPct(pct) : 'HIGH'),
      internal: { event: ie.eventRef, type: ie.type, quantity: ie.quantity.toString(), cashAmount: ie.cashAmount.toString(), currency: ie.currency, ...where },
      external: { quantity: ce.qty.toString(), cashAmount: ce.cash.toString(), currency: ce.currency, ...(ce.refs.length ? { externalRef: ce.refs.join(', ') } : {}), ...where },
      difference: dc.toString(),
      differencePct: pct ? pct.toFixed(4) : null,
      currency: ie.currency,
    });
  }
  return out;
}

// ---------------------------------------------------------------- candidate matches (FR-REC-006)

export interface CandidateSide {
  ticker: string;
  side: string;
  quantity: Dec;
  price: Dec | null;
}
export interface CandidateScore {
  score: number;
  reasons: string[];
}

/**
 * How well a break on one side of a trade reconciliation lines up with a break on the other side (a custodian trade the
 * book does not have against an internal fill the custodian did not confirm). The security must be the same; side,
 * quantity and price add to the score. Below `MIN_CANDIDATE_SCORE` it is not offered.
 */
export const MIN_CANDIDATE_SCORE = 70;
export function scoreCandidate(target: CandidateSide, other: CandidateSide): CandidateScore | null {
  if (norm(target.ticker) !== norm(other.ticker)) return null;
  let score = 50;
  const reasons = ['Same security'];
  if (norm(target.side) === norm(other.side)) {
    score += 20;
    reasons.push('Same side');
  }
  if (target.quantity.equals(other.quantity)) {
    score += 20;
    reasons.push('Same quantity');
  } else {
    const p = pctDiff(target.quantity, other.quantity);
    if (p && p.lte(5)) {
      score += 10;
      reasons.push('Quantity within 5%');
    }
  }
  if (target.price && other.price) {
    const p = pctDiff(target.price, other.price);
    if (p && p.lte(1)) {
      score += 10;
      reasons.push('Price within 1%');
    }
  }
  return score >= MIN_CANDIDATE_SCORE ? { score, reasons } : null;
}

/** Kinds of break that have a counterpart on the other side. */
export const CANDIDATE_KINDS: Record<string, string> = { MISSING_INTERNAL: 'MISSING_EXTERNAL', MISSING_EXTERNAL: 'MISSING_INTERNAL' };
