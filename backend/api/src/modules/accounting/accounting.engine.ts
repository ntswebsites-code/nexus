import { Prisma } from '@prisma/client';

/**
 * Pure double-entry rules for Accounting & Close (SRD 5.A.21 page `accounting`, ABOR). No database access.
 * All money is Decimal; a journal is valid only when every line carries exactly one positive side and
 * total debits equal total credits.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Assets and expenses increase with a debit; liabilities, equity and income with a credit. */
export const isDebitNormal = (t: string) => t === 'ASSET' || t === 'EXPENSE';

/** Balance on the account's natural side (positive = normal). */
export const naturalBalance = (type: string, debit: Dec, credit: Dec): Dec => (isDebitNormal(type) ? debit.sub(credit) : credit.sub(debit));

export interface LineInput {
  accountId: string;
  debit?: Dec | null;
  credit?: Dec | null;
  memo?: string | null;
}

export interface LineError {
  path: string;
  message: string;
}

export function totals(lines: { debit?: Dec | null; credit?: Dec | null }[]): { debit: Dec; credit: Dec } {
  let debit = ZERO;
  let credit = ZERO;
  for (const l of lines) {
    debit = debit.add(l.debit ?? ZERO);
    credit = credit.add(l.credit ?? ZERO);
  }
  return { debit, credit };
}

/** Balanced-lines validation: at least two lines, one positive side each, debits == credits. */
export function validateLines(lines: LineInput[]): LineError[] {
  const errors: LineError[] = [];
  if (lines.length < 2) errors.push({ path: 'lines', message: 'A journal needs at least two lines' });
  lines.forEach((l, i) => {
    const d = l.debit ?? ZERO;
    const c = l.credit ?? ZERO;
    if (d.lt(0) || c.lt(0)) errors.push({ path: `lines[${i}]`, message: 'Amounts must be positive' });
    else if (d.gt(0) && c.gt(0)) errors.push({ path: `lines[${i}]`, message: 'A line is either a debit or a credit, not both' });
    else if (d.isZero() && c.isZero()) errors.push({ path: `lines[${i}]`, message: 'Enter a debit or a credit above zero' });
  });
  const t = totals(lines);
  if (!errors.length && !t.debit.eq(t.credit)) {
    errors.push({ path: 'lines', message: `Debits ${t.debit.toFixed(2)} and credits ${t.credit.toFixed(2)} must be equal (out by ${t.debit.sub(t.credit).abs().toFixed(2)})` });
  }
  return errors;
}

/** The exact inverse of a posted journal's lines: debits and credits swapped. */
export function invertLines<T extends { accountId: string; debit: Dec; credit: Dec; memo: string | null }>(lines: T[]) {
  return lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo }));
}

/** First and last day (UTC) of a `YYYY-MM` month. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}

export interface DefaultAccount {
  code: string;
  name: string;
  type: AccountType;
}

/** A compact fund chart of accounts offered for a new entity. */
export const DEFAULT_COA: DefaultAccount[] = [
  { code: '1000', name: 'Cash at bank', type: 'ASSET' },
  { code: '1100', name: 'Investments at fair value', type: 'ASSET' },
  { code: '1200', name: 'Dividends and interest receivable', type: 'ASSET' },
  { code: '1300', name: 'Subscriptions receivable', type: 'ASSET' },
  { code: '2000', name: 'Accrued management fees', type: 'LIABILITY' },
  { code: '2100', name: 'Accrued expenses', type: 'LIABILITY' },
  { code: '2200', name: 'Redemptions payable', type: 'LIABILITY' },
  { code: '3000', name: 'Unitholders capital', type: 'EQUITY' },
  { code: '3100', name: 'Retained earnings', type: 'EQUITY' },
  { code: '4000', name: 'Dividend income', type: 'INCOME' },
  { code: '4100', name: 'Interest income', type: 'INCOME' },
  { code: '4200', name: 'Unrealised gains and losses', type: 'INCOME' },
  { code: '5000', name: 'Management fees', type: 'EXPENSE' },
  { code: '5100', name: 'Custody and admin fees', type: 'EXPENSE' },
  { code: '5200', name: 'Audit and legal fees', type: 'EXPENSE' },
];
