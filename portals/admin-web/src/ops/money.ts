/**
 * Money arrives as decimal strings. Totals and checks use scaled BigInt (4 decimal
 * places, the database scale) so no float arithmetic ever touches an amount.
 */

const SCALE = 4;
const FACTOR = BigInt(10) ** BigInt(SCALE);

export type DecimalLike = string | number | null | undefined;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isDecimal(v: string): boolean {
  return DECIMAL_RE.test(v.trim());
}

/** Parses a decimal string to scaled BigInt; extra decimals beyond the scale are truncated. */
export function toScaled(v: DecimalLike): bigint {
  if (v === null || v === undefined || v === '') return BigInt(0);
  const s = String(v).trim().replace(/,/g, '');
  if (!DECIMAL_RE.test(s)) return BigInt(0);
  const neg = s.startsWith('-');
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const scaled = BigInt(int) * FACTOR + BigInt((frac + '0'.repeat(SCALE)).slice(0, SCALE));
  return neg ? -scaled : scaled;
}

export function fromScaled(n: bigint): string {
  const neg = n < BigInt(0);
  const abs = neg ? -n : n;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0');
  return `${neg ? '-' : ''}${int.toString()}.${frac}`;
}

export function sumDecimals(values: DecimalLike[]): string {
  return fromScaled(values.reduce<bigint>((acc, v) => acc + toScaled(v), BigInt(0)));
}

export function subDecimals(a: DecimalLike, b: DecimalLike): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function compareDecimals(a: DecimalLike, b: DecimalLike): number {
  const d = toScaled(a) - toScaled(b);
  return d === BigInt(0) ? 0 : d > BigInt(0) ? 1 : -1;
}

/** "1234567.5" -> "1,234,567.50" (2 dp, half-up on the decimal string). */
export function formatDecimal(v: DecimalLike, dp = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v).trim();
  if (!DECIMAL_RE.test(s)) return s;
  const neg = s.startsWith('-');
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
  let units = BigInt(int + (frac + '0'.repeat(dp)).slice(0, dp));
  if (Number(frac.charAt(dp) || '0') >= 5) units += BigInt(1);
  const base = BigInt(10) ** BigInt(dp);
  const intPart = (units / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracPart = dp > 0 ? '.' + (units % base).toString().padStart(dp, '0') : '';
  const zero = units === BigInt(0);
  return `${neg && !zero ? '-' : ''}${intPart}${fracPart}`;
}

export function formatMoney(v: DecimalLike, currency?: string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${currency ? currency + ' ' : ''}${formatDecimal(v)}`;
}
