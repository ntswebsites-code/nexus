import { Prisma } from '@prisma/client';

/**
 * Reconciliation matching rules (SRD FR-OPS-002, 6.10; V61 notes). Pure functions only: no database access, so the
 * hand-computed cases in `scripts/test-recon.ts` and the service share one implementation.
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const FAMILIES = ['TRADES', 'CASH', 'HOLDINGS', 'DAYEND_COUNT'] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = {
  TRADES: 'Trades',
  CASH: 'Cash',
  HOLDINGS: 'Holdings',
  DAYEND_COUNT: 'Day-end trade count',
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
}
export const DEFAULT_TOLERANCES: Tolerances = { price: '0.01', cash: '0.01', holdingsPct: '0.5' };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Severity from the size of a difference relative to the item (percent): at least 20% CRITICAL, above 5% HIGH,
 * above 1% MEDIUM, otherwise LOW.
 */
export function severityForPct(pct: Dec | number): Severity {
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
  | 'COUNT_DIFF';

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
}

const norm = (s: string) => s.trim().toUpperCase();

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
 * Quantity must be exact; the price must be within +/- `priceTol`. Everything left on either side is a break.
 */
export function matchTrades(exts: ExtTrade[], ints: IntFill[], priceTol: Dec): TradeOutcome {
  const out: TradeOutcome = { matched: [], detected: [], exceptionExts: [] };
  const freeInts = new Set(ints.map((i) => i.id));
  const byId = new Map(ints.map((i) => [i.id, i]));
  const pairs: { ext: ExtTrade; int: IntFill; via: 'REFERENCE' | 'ATTRIBUTES' }[] = [];
  const unmatchedExts: ExtTrade[] = [];

  // Pass 1: reference
  for (const e of exts) {
    const ref = norm(e.tradeRef);
    const hit = ints.find((i) => freeInts.has(i.id) && i.refs.some((r) => r === ref));
    if (hit) {
      freeInts.delete(hit.id);
      pairs.push({ ext: e, int: hit, via: 'REFERENCE' });
    } else unmatchedExts.push(e);
  }
  // Pass 2: ticker + side + quantity
  const stillUnmatched: ExtTrade[] = [];
  for (const e of unmatchedExts) {
    const cands = [...freeInts]
      .map((id) => byId.get(id)!)
      .filter((i) => norm(i.ticker) === norm(e.ticker) && norm(i.side) === norm(e.side) && i.quantity.equals(e.quantity));
    if (!cands.length) {
      stillUnmatched.push(e);
      continue;
    }
    cands.sort((a, b) => a.price.minus(e.price).abs().comparedTo(b.price.minus(e.price).abs()));
    const best = cands[0]!;
    freeInts.delete(best.id);
    pairs.push({ ext: e, int: best, via: 'ATTRIBUTES' });
  }

  for (const { ext, int, via } of pairs) {
    const base = {
      counterpartyId: ext.counterpartyId,
      portfolioId: ext.portfolioId,
      currency: ext.currency,
      itemKey: `TRD:${ext.counterpartyRef}:${ext.tradeRef}`.slice(0, 190),
      internal: { ...tradeValue(int), orderRef: int.orderRef, matchedBy: via },
      external: { ...tradeValue(ext), tradeRef: ext.tradeRef, account: ext.accountRef, matchedBy: via },
    };
    const attrDiff = norm(int.ticker) !== norm(ext.ticker) || norm(int.side) !== norm(ext.side) || int.currency !== ext.currency;
    if (attrDiff) {
      out.detected.push({
        ...base,
        kind: 'ATTRIBUTE_DIFF',
        label: `Trade ${ext.tradeRef}: instrument, side or currency differs (${tradeLabel(int)} vs ${tradeLabel(ext)})`,
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
    const pdiff = ext.price.minus(int.price);
    if (pdiff.abs().gt(priceTol)) {
      const pct = pctDiff(int.price, ext.price);
      out.detected.push({
        ...base,
        kind: 'PRICE_OUT_OF_TOLERANCE',
        label: `Trade ${ext.tradeRef} ${ext.ticker}: price ${int.price.toString()} internal vs ${ext.price.toString()} custodian (tolerance ${priceTol.toString()})`,
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
  for (const id of freeInts) {
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
