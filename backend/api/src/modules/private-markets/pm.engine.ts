import { Prisma } from '@prisma/client';

/** Pure private-markets maths (SRD 5.A.3). No database access. */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

export const STRATEGIES = ['PRIVATE_EQUITY', 'VENTURE', 'REAL_ASSETS', 'PRIVATE_CREDIT', 'INFRASTRUCTURE', 'OTHER'] as const;
export const MARK_METHODS = ['GP_REPORTED', 'DCF', 'COMPARABLES', 'COST', 'ADJUSTED'] as const;
export const EVIDENCE_KINDS = ['GP_STATEMENT', 'VALUATION_REPORT', 'AUDITED_FS', 'TRANSACTION', 'OTHER'] as const;
/** A NAV move bigger than this against the previous approved mark needs an explanation in the note. */
export const BIG_MOVE_PCT = 30;
/** A mark older than this many days is flagged stale. */
export const STALE_DAYS = 120;

export interface Flow {
  /** CALL | DISTRIBUTION */
  kind: string;
  amount: Dec;
  /** Paid date when PAID, otherwise the due date. */
  date: Date;
  /** NOTICED | PAID | CANCELLED (cancelled flows are ignored). */
  status: string;
}

const MS_DAY = 86_400_000;

/**
 * Money-weighted annualised return (XIRR, actual/365). Calls are outflows, distributions and the closing NAV are inflows.
 * Returns null when it is undefined (no outflow, no inflow, or no sign change) or does not converge.
 */
export function xirr(flows: { date: Date; amount: number }[]): number | null {
  const fl = flows.filter((f) => f.amount !== 0);
  if (!fl.some((f) => f.amount < 0) || !fl.some((f) => f.amount > 0)) return null;
  const t0 = Math.min(...fl.map((f) => f.date.getTime()));
  const npv = (r: number) => fl.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.date.getTime() - t0) / MS_DAY / 365), 0);
  let lo = -0.9999;
  let hi = 1;
  let fLo = npv(lo);
  let fHi = npv(hi);
  while (fLo * fHi > 0 && hi < 1e6) {
    hi *= 2;
    fHi = npv(hi);
  }
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-12) return mid;
    if (fLo * fm < 0) {
      hi = mid;
      fHi = fm;
    } else {
      lo = mid;
      fLo = fm;
    }
  }
  return (lo + hi) / 2;
}

export interface Perf {
  committed: Dec;
  /** PAID calls. */
  paidIn: Dec;
  /** NOTICED calls not yet paid. */
  calledUnpaid: Dec;
  /** committed - paid - noticed: what can still be called. */
  unfunded: Dec;
  distributed: Dec;
  nav: Dec | null;
  navAsOf: Date | null;
  dpi: Dec | null;
  rvpi: Dec | null;
  tvpi: Dec | null;
  /** Fraction (0.12 = 12 %). */
  irr: number | null;
}

/** Performance of one commitment from its settled cashflows and its latest APPROVED mark. */
export function performance(committed: Dec, flows: Flow[], mark: { nav: Dec; asOf: Date } | null): Perf {
  const paidIn = flows.filter((f) => f.kind === 'CALL' && f.status === 'PAID').reduce((s, f) => s.add(f.amount), ZERO);
  return finish(committed, flows, paidIn, mark);
}

function finish(committed: Dec, flows: Flow[], paidIn: Dec, mark: { nav: Dec; asOf: Date } | null): Perf {
  const calledUnpaid = flows.filter((f) => f.kind === 'CALL' && f.status === 'NOTICED').reduce((s, f) => s.add(f.amount), ZERO);
  const distributed = flows.filter((f) => f.kind === 'DISTRIBUTION' && f.status === 'PAID').reduce((s, f) => s.add(f.amount), ZERO);
  const unfunded = Dec0(committed.sub(paidIn).sub(calledUnpaid));
  const nav = mark?.nav ?? null;
  const ratio = (n: Dec | null) => (n && paidIn.gt(0) ? n.div(paidIn).toDecimalPlaces(4, D.ROUND_HALF_UP) : null);
  const settled = flows.filter((f) => f.status === 'PAID');
  const irrFlows = settled.map((f) => ({ date: f.date, amount: (f.kind === 'CALL' ? f.amount.neg() : f.amount).toNumber() }));
  if (mark && nav && nav.gt(0)) {
    const last = settled.reduce((m, f) => Math.max(m, f.date.getTime()), 0);
    irrFlows.push({ date: new Date(Math.max(mark.asOf.getTime(), last)), amount: nav.toNumber() });
  }
  return {
    committed,
    paidIn,
    calledUnpaid,
    unfunded,
    distributed,
    nav,
    navAsOf: mark?.asOf ?? null,
    dpi: ratio(distributed),
    rvpi: ratio(nav),
    tvpi: paidIn.gt(0) ? distributed.add(nav ?? ZERO).div(paidIn).toDecimalPlaces(4, D.ROUND_HALF_UP) : null,
    irr: xirr(irrFlows),
  };
}
const Dec0 = (v: Dec) => (v.lt(0) ? ZERO : v);

/** Combines several commitments into one performance line (flows pooled, NAVs summed). */
export function pooled(items: { committed: Dec; flows: Flow[]; mark: { nav: Dec; asOf: Date } | null }[]): Perf {
  const committed = items.reduce((s, i) => s.add(i.committed), ZERO);
  const flows = items.flatMap((i) => i.flows);
  const paidIn = flows.filter((f) => f.kind === 'CALL' && f.status === 'PAID').reduce((s, f) => s.add(f.amount), ZERO);
  const navs = items.filter((i) => i.mark);
  const nav = navs.reduce((s, i) => s.add(i.mark!.nav), ZERO);
  const asOf = navs.length ? new Date(Math.max(...navs.map((i) => i.mark!.asOf.getTime()))) : null;
  return finish(committed, flows, paidIn, asOf ? { nav, asOf } : null);
}

export interface CurvePoint {
  date: Date;
  /** Cumulative paid calls. */
  calls: Dec;
  /** Cumulative paid distributions. */
  distributions: Dec;
  /** distributions - calls to date: dips below zero while capital is being drawn (the J). */
  netCash: Dec;
  /** Latest approved NAV at or before the date, or null before the first mark. */
  nav: Dec | null;
  /** netCash + nav: what the investor is ahead or behind, null before the first mark. */
  netValue: Dec | null;
}

/** J-curve points on every settled-flow and mark date (pooled across commitments when the inputs are pooled). */
export function jCurve(flows: Flow[], marks: { asOf: Date; nav: Dec }[]): CurvePoint[] {
  const paid = flows.filter((f) => f.status === 'PAID').sort((a, b) => a.date.getTime() - b.date.getTime());
  const ms = [...marks].sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
  const days = [...new Set([...paid.map((f) => f.date.getTime()), ...ms.map((m) => m.asOf.getTime())])].sort((a, b) => a - b);
  return days.map((t) => {
    const upTo = paid.filter((f) => f.date.getTime() <= t);
    const calls = upTo.filter((f) => f.kind === 'CALL').reduce((s, f) => s.add(f.amount), ZERO);
    const distributions = upTo.filter((f) => f.kind === 'DISTRIBUTION').reduce((s, f) => s.add(f.amount), ZERO);
    const mark = [...ms].reverse().find((m) => m.asOf.getTime() <= t) ?? null;
    const netCash = distributions.sub(calls);
    return { date: new Date(t), calls, distributions, netCash, nav: mark?.nav ?? null, netValue: mark ? netCash.add(mark.nav) : null };
  });
}

/** Distribution split: the return of capital cannot exceed the amount. */
export function rocProblem(amount: Dec, roc: Dec | null | undefined): string | null {
  if (!roc) return null;
  return roc.gt(amount) ? `Return of capital ${roc.toFixed(2)} exceeds the distribution of ${amount.toFixed(2)}` : null;
}

/** Call cap: a new call may not exceed what is still uncommitted to calls. */
export function callProblem(committed: Dec, called: Dec, amount: Dec): string | null {
  const room = committed.sub(called);
  return amount.gt(room) ? `Call of ${amount.toFixed(2)} exceeds the unfunded commitment of ${room.toFixed(2)}` : null;
}

/** NAV move against the previous approved mark, percent; null when there is none. */
export function markMovePct(prev: Dec | null, next: Dec): Dec | null {
  if (!prev || prev.lte(0)) return null;
  return next.sub(prev).div(prev).mul(100).toDecimalPlaces(1, D.ROUND_HALF_UP);
}
