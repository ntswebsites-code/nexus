import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { validateLines as validateAccountingLines, invertLines as invertAccountingLines, totals } from '../accounting/accounting.engine';

/**
 * Pure rules for Cash & Ledgers (SRD 5.A.15 page `cash`). No database access.
 * Money is Decimal. Cash sign convention everywhere: positive = cash in to the fund (a debit to a BANK ledger).
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

export const LEDGER_KINDS = ['BANK', 'CONTROL', 'CLEARING', 'SUSPENSE', 'EXPENSE'] as const;
export const JOURNAL_PURPOSES = ['BUY_SETTLEMENT', 'CLIENT_DEPOSIT', 'CLIENT_WITHDRAWAL', 'EXTERNAL_FEE', 'TRANSFER', 'MANUAL_CORRECTION', 'REVERSAL'] as const;
export const RESERVATION_PURPOSES = ['BUY_SETTLEMENT', 'WITHDRAWAL', 'TRANSFER'] as const;
export const EXPECTATION_KINDS = ['SETTLEMENT', 'DIVIDEND', 'CAPITAL_CALL', 'DISTRIBUTION', 'FEE', 'OTHER'] as const;
/** Reservation and expectation states that still count. */
export const LIVE_RESERVATION = ['ACTIVE', 'PARTIALLY_CONSUMED'];
/** Journals that have an effect on the ledger. */
export const EFFECTIVE = ['POSTED', 'REVERSED'];
export const UNPOSTED = ['DRAFT', 'PENDING_APPROVAL'];
/** An unmatched statement line older than this many days blocks a close. */
export const AGED_DAYS = 5;
/** Statement lines match a posted journal when amounts are equal and value dates are within this many days. */
export const MATCH_WINDOW_DAYS = 3;

export interface CashLine {
  ledgerId: string;
  debit?: Dec | null;
  credit?: Dec | null;
  memo?: string | null;
}

/** Balanced-lines validation (same rules as the accounting ledger). */
export function validateLines(lines: CashLine[]) {
  return validateAccountingLines(lines.map((l) => ({ accountId: l.ledgerId, debit: l.debit, credit: l.credit })));
}
export { totals };

/** The exact inverse of a posted journal's lines: debits and credits swapped. */
export function invertLines<T extends { ledgerId: string; debit: Dec; credit: Dec; memo: string | null }>(lines: T[]) {
  return invertAccountingLines(lines.map((l) => ({ accountId: l.ledgerId, debit: l.debit, credit: l.credit, memo: l.memo }))).map((l) => ({ ledgerId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo }));
}

/** Signed effect of a line on a BANK ledger (debit = cash in). */
export const signed = (l: { debit: Dec; credit: Dec }): Dec => l.debit.sub(l.credit);

/**
 * AVAIL-v1: available = max(0, posted - active reservations - minimum buffer). Withdrawable is the same figure.
 * Expected movements are projection only and never enter it; the external statement balance is evidence only.
 */
export function availability(posted: Dec, reserved: Dec, minBuffer: Dec): { available: Dec; withdrawable: Dec } {
  const raw = posted.sub(reserved).sub(minBuffer);
  const v = raw.gt(0) ? raw : ZERO;
  return { available: v, withdrawable: v };
}

export const AVAIL_VERSION = 'AVAIL-v1';

export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

// ---------------------------------------------------------------- statement parsing

export interface StatementLineInput {
  valueDate: Date;
  amount: Dec;
  reference: string | null;
  description: string | null;
}

export interface ParsedStatement {
  lines: StatementLineInput[];
  opening: Dec | null;
  closing: Dec | null;
  errors: { path: string; message: string }[];
}

const AMOUNT = /^[+-]?\d+(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseAmount(raw: unknown): Dec | null {
  const s = String(raw ?? '').replace(/[,\s]/g, '');
  return AMOUNT.test(s) ? new D(s.replace(/^\+/, '')) : null;
}
function parseDate(raw: unknown): Date | null {
  const s = String(raw ?? '').trim();
  if (!DATE.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, '');
const pick = (headers: string[], ...names: string[]) => headers.findIndex((h) => names.includes(h));

/**
 * Parses a bank statement. CSV needs a header row with `date` and either `amount` (signed, positive = money in) or
 * `credit` / `debit` columns (credit = money in); optional `reference` and `description`. JSON is
 * `{ openingBalance?, closingBalance?, lines: [{ date, amount, reference?, description? }] }`.
 */
export function parseStatement(format: 'CSV' | 'JSON', content: string, given: { opening?: Dec | null; closing?: Dec | null }): ParsedStatement {
  const errors: ParsedStatement['errors'] = [];
  const lines: StatementLineInput[] = [];
  let opening = given.opening ?? null;
  let closing = given.closing ?? null;
  const add = (i: number, date: unknown, amount: Dec | null, reference: unknown, description: unknown) => {
    const d = parseDate(date);
    if (!d) errors.push({ path: `lines[${i}].date`, message: 'Use YYYY-MM-DD' });
    if (!amount) errors.push({ path: `lines[${i}].amount`, message: 'Enter a number with up to 4 decimals' });
    else if (amount.isZero()) errors.push({ path: `lines[${i}].amount`, message: 'A statement line cannot be zero' });
    if (d && amount && !amount.isZero()) {
      lines.push({ valueDate: d, amount, reference: String(reference ?? '').trim().slice(0, 120) || null, description: String(description ?? '').trim().slice(0, 255) || null });
    }
  };
  if (format === 'JSON') {
    let doc: any;
    try {
      doc = JSON.parse(content);
    } catch {
      return { lines, opening, closing, errors: [{ path: 'content', message: 'The file is not valid JSON' }] };
    }
    const arr = Array.isArray(doc) ? doc : doc?.lines;
    if (!Array.isArray(arr)) return { lines, opening, closing, errors: [{ path: 'content', message: 'Expected an array of lines or an object with a "lines" array' }] };
    if (!Array.isArray(doc)) {
      if (doc.openingBalance !== undefined && opening === null) opening = parseAmount(doc.openingBalance);
      if (doc.closingBalance !== undefined && closing === null) closing = parseAmount(doc.closingBalance);
    }
    arr.forEach((l: any, i: number) => add(i, l?.date ?? l?.valueDate, parseAmount(l?.amount), l?.reference, l?.description));
  } else {
    const rows = parseCsvRows(content);
    if (rows.length < 2) return { lines, opening, closing, errors: [{ path: 'content', message: 'The CSV needs a header row and at least one line' }] };
    const h = rows[0]!.map(norm);
    const iDate = pick(h, 'date', 'valuedate');
    const iAmt = pick(h, 'amount');
    const iCr = pick(h, 'credit');
    const iDr = pick(h, 'debit');
    const iRef = pick(h, 'reference', 'ref');
    const iDesc = pick(h, 'description', 'narrative', 'details');
    if (iDate < 0 || (iAmt < 0 && iCr < 0 && iDr < 0)) {
      return { lines, opening, closing, errors: [{ path: 'content', message: 'The header must include date and amount (or credit and debit)' }] };
    }
    rows.slice(1).forEach((r, i) => {
      let amount: Dec | null;
      if (iAmt >= 0) amount = parseAmount(r[iAmt]);
      else {
        const cr = (r[iCr] ?? '').trim() === '' ? ZERO : parseAmount(r[iCr]);
        const dr = iDr < 0 || (r[iDr] ?? '').trim() === '' ? ZERO : parseAmount(r[iDr]);
        amount = cr && dr ? cr.sub(dr) : null;
      }
      add(i, r[iDate], amount, iRef >= 0 ? r[iRef] : null, iDesc >= 0 ? r[iDesc] : null);
    });
  }
  if (opening === null) errors.push({ path: 'openingBalance', message: 'Opening balance is required' });
  if (closing === null) errors.push({ path: 'closingBalance', message: 'Closing balance is required' });
  if (!lines.length && !errors.length) errors.push({ path: 'content', message: 'The statement has no lines' });
  return { lines, opening, closing, errors };
}

/** opening + movements - closing; zero when the statement foots. */
export function statementVariance(opening: Dec, closing: Dec, lines: { amount: Dec }[]): Dec {
  return lines.reduce((s, l) => s.add(l.amount), opening).sub(closing);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const lineFingerprint = (ledgerId: string, l: StatementLineInput) => sha256([ledgerId, isoDay(l.valueDate), l.amount.toFixed(4), l.reference ?? '', l.description ?? ''].join('|'));

// ---------------------------------------------------------------- matching

export interface MatchCandidate {
  journalId: string;
  date: Date;
  amount: Dec;
}

/** One-to-one greedy matching: equal signed amount, nearest value date within the window. */
export function matchLines<L extends { id: string; valueDate: Date; amount: Dec }>(lines: L[], candidates: MatchCandidate[]): { lineId: string; journalId: string }[] {
  const used = new Set<number>();
  const out: { lineId: string; journalId: string }[] = [];
  for (const l of [...lines].sort((a, b) => a.valueDate.getTime() - b.valueDate.getTime())) {
    let best = -1;
    let bestGap = Infinity;
    candidates.forEach((c, i) => {
      if (used.has(i) || !c.amount.eq(l.amount)) return;
      const gap = Math.abs(daysBetween(c.date, l.valueDate));
      if (gap <= MATCH_WINDOW_DAYS && gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    if (best >= 0) {
      used.add(best);
      out.push({ lineId: l.id, journalId: candidates[best]!.journalId });
    }
  }
  return out;
}

// ---------------------------------------------------------------- close pre-check helpers

/** Gaps in committed statement cover of a ledger up to `periodEnd`: nothing at all, a trailing gap, or a break between statements. */
export function coverageProblems(statements: { ref: string; statementFrom: Date; statementTo: Date; openingBalance: Dec; closingBalance: Dec }[], periodEnd: Date): string[] {
  const sorted = [...statements].sort((a, b) => a.statementFrom.getTime() - b.statementFrom.getTime());
  if (!sorted.length) return ['No committed statement'];
  const problems: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = daysBetween(prev.statementTo, cur.statementFrom);
    if (gap > 1) problems.push(`Gap between ${prev.ref} (to ${isoDay(prev.statementTo)}) and ${cur.ref} (from ${isoDay(cur.statementFrom)})`);
    else if (!prev.closingBalance.eq(cur.openingBalance)) problems.push(`${cur.ref} opens at ${cur.openingBalance.toFixed(2)} but ${prev.ref} closed at ${prev.closingBalance.toFixed(2)}`);
  }
  const last = sorted[sorted.length - 1]!;
  if (last.statementTo.getTime() < periodEnd.getTime()) problems.push(`Latest statement ends ${isoDay(last.statementTo)}, before ${isoDay(periodEnd)}`);
  return problems;
}
