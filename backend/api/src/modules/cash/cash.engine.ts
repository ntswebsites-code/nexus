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
export const JOURNAL_PURPOSES = ['BUY_SETTLEMENT', 'CLIENT_DEPOSIT', 'CLIENT_WITHDRAWAL', 'EXTERNAL_FEE', 'TRANSFER', 'MANUAL_CORRECTION', 'REVERSAL', 'SELL_SETTLEMENT', 'CORPORATE_ACTION', 'PM_CALL', 'PM_DISTRIBUTION'] as const;
export const RESERVATION_PURPOSES = ['BUY_SETTLEMENT', 'WITHDRAWAL', 'TRANSFER'] as const;
export const EXPECTATION_KINDS = ['SETTLEMENT', 'DIVIDEND', 'CAPITAL_CALL', 'DISTRIBUTION', 'FEE', 'MARGIN_CALL', 'OTHER'] as const;
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
  /** Account identifier and currency the file declares (CAMT.053 and MT940); checked against the ledger by the caller. */
  accountRef?: string | null;
  currency?: string | null;
}

export type StatementFormat = 'CSV' | 'JSON' | 'CAMT053' | 'MT940';

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

// ---------------------------------------------------------------- CAMT.053 and MT940 readers (FR-CASH-017)

export interface RawStatement {
  accountRef: string | null;
  currency: string | null;
  opening: string | null;
  closing: string | null;
  entries: { date: string; amount: string; reference: string; description: string }[];
  errors: { path: string; message: string }[];
}

const xmlText = (v: string) =>
  v
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
/** First child element text (any namespace prefix); the match is by local name only. */
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? xmlText(m[1]!) : null;
};
const blocks = (xml: string, name: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!);
  return out;
};
const ccyAttr = (xml: string, name: string) => new RegExp(`<(?:[\\w-]+:)?${name}[^>]*\\sCcy="([A-Z]{3})"`).exec(xml)?.[1] ?? null;

/**
 * ISO 20022 camt.053 bank-to-customer statement (one statement per file). Opening is the OPBD (else PRCD) balance and
 * closing the CLBD balance; a DBIT indicator makes the amount negative. Every entry's sign is normalised so a positive
 * amount is cash in to the fund: a credit is positive, a debit negative, and a reversal (RvslInd true) flips it.
 * Pending entries (Sts PDNG) are not part of the booked statement and are skipped.
 */
export function readCamt053(xml: string): RawStatement {
  const out: RawStatement = { accountRef: null, currency: null, opening: null, closing: null, entries: [], errors: [] };
  const stmts = blocks(xml, 'Stmt');
  if (!stmts.length) return { ...out, errors: [{ path: 'content', message: 'No <Stmt> element: this is not a camt.053 statement' }] };
  if (stmts.length > 1) return { ...out, errors: [{ path: 'content', message: `The file holds ${stmts.length} statements; import one statement per file` }] };
  const st = stmts[0]!;
  const acct = tag(st, 'Acct') ?? '';
  out.accountRef = tag(acct, 'IBAN') ?? tag(tag(acct, 'Othr') ?? '', 'Id') ?? tag(acct, 'Id');
  out.currency = tag(acct, 'Ccy');
  const signedBal = (b: string) => {
    const amt = tag(b, 'Amt');
    if (amt === null) return null;
    return (tag(b, 'CdtDbtInd') === 'DBIT' ? '-' : '') + amt;
  };
  for (const b of blocks(st, 'Bal')) {
    const code = tag(tag(b, 'Tp') ?? '', 'Cd');
    if (code === 'OPBD' || (code === 'PRCD' && out.opening === null)) out.opening = signedBal(b);
    else if (code === 'CLBD') out.closing = signedBal(b);
    out.currency = out.currency ?? ccyAttr(b, 'Amt');
  }
  const body = st.replace(/<(?:[\w-]+:)?Bal(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w-]+:)?Bal>/g, '');
  blocks(body, 'Ntry').forEach((n, i) => {
    if (/^PDNG$/i.test(tag(n, 'Sts') ?? '') || /^PDNG$/i.test(tag(tag(n, 'Sts') ?? '', 'Cd') ?? '')) return;
    const amt = tag(n, 'Amt');
    const dir = tag(n, 'CdtDbtInd');
    const val = tag(tag(n, 'ValDt') ?? '', 'Dt') ?? tag(tag(n, 'ValDt') ?? '', 'DtTm') ?? tag(tag(n, 'BookgDt') ?? '', 'Dt') ?? tag(tag(n, 'BookgDt') ?? '', 'DtTm');
    if (amt === null || (dir !== 'CRDT' && dir !== 'DBIT')) {
      out.errors.push({ path: `entries[${i}]`, message: 'An entry needs Amt and CdtDbtInd (CRDT or DBIT)' });
      return;
    }
    const rev = /^(true|1)$/i.test(tag(n, 'RvslInd') ?? '');
    const negative = (dir === 'DBIT') !== rev;
    out.entries.push({
      date: (val ?? '').slice(0, 10),
      amount: (negative ? '-' : '') + amt,
      reference: tag(n, 'AcctSvcrRef') ?? tag(n, 'NtryRef') ?? tag(n, 'EndToEndId') ?? '',
      description: tag(n, 'AddtlNtryInf') ?? tag(n, 'Ustrd') ?? '',
    });
  });
  return out;
}

const mtDate = (yymmdd: string) => `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
const mtAmount = (v: string) => v.replace(',', '.').replace(/\.$/, '');

/**
 * SWIFT MT940 customer statement (one statement per file): :25: account, :60F:/:60M: opening, :61: lines with the
 * :86: narrative that follows, :62F:/:62M: closing. C or RD is cash in, D or RC is cash out, which already matches the
 * "positive = cash increased" convention. Amounts use the SWIFT decimal comma.
 */
export function readMt940(text: string): RawStatement {
  const out: RawStatement = { accountRef: null, currency: null, opening: null, closing: null, entries: [], errors: [] };
  const fields: { tag: string; value: string }[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(raw);
    if (m) fields.push({ tag: m[1]!, value: m[2]! });
    else if (fields.length && raw.trim() !== '' && !/^-\}?$/.test(raw.trim())) fields[fields.length - 1]!.value += '\n' + raw;
  }
  if (!fields.some((f) => f.tag === '60F' || f.tag === '60M')) return { ...out, errors: [{ path: 'content', message: 'No :60F: opening balance: this is not an MT940 statement' }] };
  if (fields.filter((f) => f.tag === '25').length > 1) return { ...out, errors: [{ path: 'content', message: 'The file holds more than one statement; import one statement per file' }] };
  const bal = (v: string, path: string) => {
    const m = /^([CD])(\d{6})([A-Z]{3})(\d+(?:,\d*)?)\s*$/.exec(v.trim());
    if (!m) {
      out.errors.push({ path, message: `Unreadable balance "${v.trim()}"` });
      return null;
    }
    out.currency = out.currency ?? m[3]!;
    if (out.currency !== m[3]) out.errors.push({ path, message: `Balance currency ${m[3]} differs from ${out.currency}` });
    return (m[1] === 'D' ? '-' : '') + mtAmount(m[4]!);
  };
  let n = -1;
  for (let k = 0; k < fields.length; k++) {
    const f = fields[k]!;
    if (f.tag === '25') out.accountRef = f.value.trim().split('/')[0]!.trim() || null;
    else if (f.tag === '60F' || f.tag === '60M') out.opening = out.opening ?? bal(f.value, 'openingBalance');
    else if (f.tag === '62F' || f.tag === '62M') out.closing = bal(f.value, 'closingBalance');
    else if (f.tag === '61') {
      n += 1;
      const m = /^(\d{6})(\d{4})?(RC|RD|C|D)[A-Z]?(\d+(?:,\d*)?)(N[A-Z0-9]{3})([^\n]*?)(?:\/\/([^\n]*))?(?:\n[^\n]*)?$/.exec(f.value.trim());
      if (!m) {
        out.errors.push({ path: `entries[${n}]`, message: `Unreadable :61: line "${f.value.split('\n')[0]!.trim()}"` });
        continue;
      }
      const cashIn = m[3] === 'C' || m[3] === 'RD';
      const next = fields[k + 1];
      const info = next && next.tag === '86' ? next.value.replace(/\n/g, ' ').trim() : '';
      const ref = (m[7] ?? m[6] ?? '').trim() || m[6]!.trim();
      out.entries.push({ date: mtDate(m[1]!), amount: (cashIn ? '' : '-') + mtAmount(m[4]!), reference: ref, description: info });
    }
  }
  return out;
}

/**
 * Parses a bank statement. CSV needs a header row with `date` and either `amount` (signed, positive = money in) or
 * `credit` / `debit` columns (credit = money in); optional `reference` and `description`. JSON is
 * `{ openingBalance?, closingBalance?, lines: [{ date, amount, reference?, description? }] }`.
 */
export function parseStatement(format: StatementFormat, content: string, given: { opening?: Dec | null; closing?: Dec | null }): ParsedStatement {
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
  let accountRef: string | null = null;
  let currency: string | null = null;
  if (format === 'CAMT053' || format === 'MT940') {
    const raw = format === 'CAMT053' ? readCamt053(content) : readMt940(content);
    if (raw.errors.length) return { lines, opening, closing, errors: raw.errors };
    accountRef = raw.accountRef;
    currency = raw.currency;
    if (opening === null && raw.opening !== null) opening = parseAmount(raw.opening);
    if (closing === null && raw.closing !== null) closing = parseAmount(raw.closing);
    raw.entries.forEach((e, i) => add(i, e.date, parseAmount(e.amount), e.reference, e.description));
  } else if (format === 'JSON') {
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
  return { lines, opening, closing, errors, accountRef, currency };
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

/** Sub-ledger to general ledger comparison for one currency: ok when the absolute difference is within the tolerance. */
export function tieOut(subLedger: Dec, generalLedger: Dec, tolerance: Dec): { difference: Dec; ok: boolean } {
  const difference = generalLedger.sub(subLedger);
  return { difference, ok: difference.abs().lte(tolerance) };
}
