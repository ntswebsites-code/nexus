import { Prisma } from '@prisma/client';

/**
 * Payments reconciliation matching rules (pure; no database). Expected payments (an LP's share of an issued
 * distribution, money out; an LP's share of an issued capital call, money in) are paired with imported bank statement
 * lines. Rules, in order:
 *  1. Reference: the line's reference or description carries the document reference (or a wire reference) of the
 *     item, direction (sign) and currency agree. Several LPs share a document reference, so a tie is narrowed by the
 *     payee name, then by an exact amount; still tied means the line is AMBIGUOUS and is raised, never guessed.
 *     A pair on reference whose amount differs beyond the tolerance is an AMOUNT_DIFF.
 *  2. Amount: no reference; same direction and currency, amount within the tolerance, value date within the date
 *     window of the due date, and the pairing is unique in both directions.
 * An item with no line stays NOT_DUE until `dueDate + graceDays`; after that it is a MISSING_PAYMENT, but only when a
 * statement covers the date (a missing statement is a missing source, not a break).
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface ExpItem {
  key: string;
  documentRef: string;
  /** Extra tokens that identify the payment on a bank line (a wire reference). */
  tokens: string[];
  payeeName: string;
  direction: 'IN' | 'OUT';
  /** Positive expected amount. */
  amount: Dec;
  currency: string;
  dueDate: string;
  /** A statement extends past the grace deadline, so a missing line is meaningful. */
  covered: boolean;
}
export interface StmtLine {
  id: string;
  date: string;
  /** Signed from the fund's view: positive is money in. */
  amount: Dec;
  currency: string;
  text: string;
}
export interface PayParams {
  tolerance: Dec;
  graceDays: number;
  dateWindowDays: number;
}
export const DEFAULT_PAY_PARAMS = { tolerance: '0.01', graceDays: 2, dateWindowDays: 5 };

export interface Pair {
  itemKey: string;
  lineId: string;
  method: 'REFERENCE' | 'AMOUNT';
  actual: Dec;
  difference: Dec;
}
export interface Unpaired {
  lineId: string;
  reason: 'DUPLICATE' | 'AMBIGUOUS' | 'WRONG_DIRECTION' | 'WRONG_CURRENCY';
  documentRefs: string[];
}
export interface PayMatchResult {
  pairs: Pair[];
  /** past grace, covered by a statement, no line */
  missing: { itemKey: string; daysOverdue: number }[];
  notDue: string[];
  /** past grace but no statement covers it */
  awaitingStatement: string[];
  unpaired: Unpaired[];
}

export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Token match on word boundaries: `CC-100` must not match inside `CC-1001`. */
export function hasToken(text: string, token: string): boolean {
  const t = token.trim().toUpperCase();
  if (t.length < 4) return false;
  return new RegExp(`(^|[^A-Z0-9])${escRe(t)}([^A-Z0-9]|$)`).test(text.toUpperCase());
}

const STOP = new Set(['LTD', 'LIMITED', 'PTY', 'INC', 'LLC', 'LP', 'THE', 'FUND', 'TRUST', 'AND', 'OF', 'PLC', 'CO', 'COMPANY', 'HOLDINGS']);
/** The payee's first two significant words must both appear in the line text. */
export function payeeInText(payee: string, text: string): boolean {
  const words = norm(payee).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)).slice(0, 2);
  if (!words.length) return false;
  const t = ` ${norm(text)} `;
  return words.every((w) => t.includes(` ${w} `) || t.includes(` ${w}`));
}

const signOf = (a: Dec) => (a.gt(0) ? 'IN' : a.lt(0) ? 'OUT' : null);

export function matchPayments(items: ExpItem[], lines: StmtLine[], asOf: string, p: PayParams): PayMatchResult {
  const res: PayMatchResult = { pairs: [], missing: [], notDue: [], awaitingStatement: [], unpaired: [] };
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const paired = new Map<string, Pair>();
  const usedLines = new Set<string>();
  const refHitLines = new Set<string>();
  const hits = (it: ExpItem, text: string) => [it.documentRef, ...it.tokens].some((t) => hasToken(text, t));

  // Pass 1: reference
  for (const l of sorted) {
    const all = items.filter((it) => hits(it, l.text));
    if (!all.length) continue;
    refHitLines.add(l.id);
    const dir = signOf(l.amount);
    const open = all.filter((it) => !paired.has(it.key));
    const fit = open.filter((it) => it.direction === dir && it.currency === l.currency);
    if (!fit.length) {
      const refs = [...new Set(all.map((x) => x.documentRef))];
      if (!open.length) res.unpaired.push({ lineId: l.id, reason: 'DUPLICATE', documentRefs: refs });
      else if (open.some((it) => it.direction !== dir)) res.unpaired.push({ lineId: l.id, reason: 'WRONG_DIRECTION', documentRefs: refs });
      else res.unpaired.push({ lineId: l.id, reason: 'WRONG_CURRENCY', documentRefs: refs });
      continue;
    }
    // The line names a payee whose payment is already paired and no open payment of that payee remains: a duplicate.
    if (!fit.some((it) => payeeInText(it.payeeName, l.text)) && all.some((it) => paired.has(it.key) && payeeInText(it.payeeName, l.text))) {
      res.unpaired.push({ lineId: l.id, reason: 'DUPLICATE', documentRefs: [...new Set(all.map((x) => x.documentRef))] });
      continue;
    }
    let cand = fit;
    if (cand.length > 1) {
      const byPayee = cand.filter((it) => payeeInText(it.payeeName, l.text));
      if (byPayee.length) cand = byPayee;
    }
    if (cand.length > 1) {
      const exact = cand.filter((it) => l.amount.abs().sub(it.amount).abs().lte(p.tolerance));
      if (exact.length) cand = exact;
    }
    if (cand.length !== 1) {
      res.unpaired.push({ lineId: l.id, reason: 'AMBIGUOUS', documentRefs: [...new Set(cand.map((x) => x.documentRef))] });
      continue;
    }
    const it = cand[0]!;
    const actual = l.amount.abs();
    const pair: Pair = { itemKey: it.key, lineId: l.id, method: 'REFERENCE', actual, difference: actual.sub(it.amount) };
    paired.set(it.key, pair);
    usedLines.add(l.id);
    res.pairs.push(pair);
  }

  // Pass 2: amount, unique both ways, no reference involved
  const freeLines = sorted.filter((l) => !usedLines.has(l.id) && !refHitLines.has(l.id));
  const fits = (it: ExpItem, l: StmtLine) =>
    it.direction === signOf(l.amount) && it.currency === l.currency && l.amount.abs().sub(it.amount).abs().lte(p.tolerance) && Math.abs(dayDiff(l.date, it.dueDate)) <= p.dateWindowDays;
  const openItems = items.filter((it) => !paired.has(it.key));
  const itemsOfLine = new Map<string, ExpItem[]>();
  for (const l of freeLines) itemsOfLine.set(l.id, openItems.filter((it) => fits(it, l)));
  for (const it of openItems) {
    const ls = freeLines.filter((l) => !usedLines.has(l.id) && fits(it, l));
    if (ls.length !== 1) continue;
    const l = ls[0]!;
    if (itemsOfLine.get(l.id)!.length !== 1) continue;
    const actual = l.amount.abs();
    const pair: Pair = { itemKey: it.key, lineId: l.id, method: 'AMOUNT', actual, difference: actual.sub(it.amount) };
    paired.set(it.key, pair);
    usedLines.add(l.id);
    res.pairs.push(pair);
  }

  for (const it of items) {
    if (paired.has(it.key)) continue;
    const late = dayDiff(asOf, it.dueDate);
    if (late <= p.graceDays) res.notDue.push(it.key);
    else if (!it.covered) res.awaitingStatement.push(it.key);
    else res.missing.push({ itemKey: it.key, daysOverdue: late });
  }
  return res;
}

// ---------------------------------------------------------------- severity

export type Sev = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const MATERIAL_SEV: Sev[] = ['HIGH', 'CRITICAL'];

/** Difference as a percent of the larger amount: >= 20% CRITICAL, > 5% HIGH, > 1% MEDIUM, else LOW. */
export function diffSeverity(expected: Dec, actual: Dec): Sev {
  const big = D.max(expected.abs(), actual.abs());
  if (big.isZero()) return 'LOW';
  const pct = actual.sub(expected).abs().div(big).mul(100);
  if (pct.gte(20)) return 'CRITICAL';
  if (pct.gt(5)) return 'HIGH';
  if (pct.gt(1)) return 'MEDIUM';
  return 'LOW';
}
/** Days past the due date: >= 10 CRITICAL, >= 3 HIGH, else MEDIUM. */
export function missingSeverity(daysOverdue: number): Sev {
  return daysOverdue >= 10 ? 'CRITICAL' : daysOverdue >= 3 ? 'HIGH' : 'MEDIUM';
}

export const PAY_OPEN: string[] = ['OPEN', 'INVESTIGATING', 'PENDING_CHECKER'];
export const RESOLUTIONS = ['MANUAL_MATCH', 'ACCEPT_DIFFERENCE', 'TIMING', 'RETURNED_PAYMENT'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
