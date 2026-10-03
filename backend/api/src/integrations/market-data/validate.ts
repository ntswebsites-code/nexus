import { businessDaysBetween, isoDay } from '../common';

/** Acceptance rules applied to every provider's output before it touches security_prices / fx_rates. */
export interface ValidationPolicy {
  /** Reject a price that moves more than this vs the previous stored price. */
  maxMovePct: number;
  /** Flag (not reject) a value this many business days old. */
  maxAgeBusinessDays: number;
}

export const DEFAULT_POLICY: ValidationPolicy = { maxMovePct: 40, maxAgeBusinessDays: 3 };
export const FX_POLICY: ValidationPolicy = { maxMovePct: 25, maxAgeBusinessDays: 3 };

export type Validation =
  | { ok: true; stale: boolean; ageBusinessDays: number; movePct: number | null }
  | { ok: false; code: string; reason: string };

const DECIMAL = /^\d{1,14}(\.\d{1,10})?$/;

export function validateValue(
  value: string,
  dateIso: string,
  previous: { value: string; date?: string } | null,
  now: Date,
  policy: ValidationPolicy = DEFAULT_POLICY,
): Validation {
  if (!DECIMAL.test(value)) return { ok: false, code: 'BAD_NUMBER', reason: `Not a plain positive number: "${value.slice(0, 40)}"` };
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, code: 'NON_POSITIVE', reason: 'Value must be greater than zero' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || Number.isNaN(Date.parse(`${dateIso}T00:00:00Z`))) {
    return { ok: false, code: 'BAD_DATE', reason: `Invalid date "${dateIso}"` };
  }
  const today = isoDay(now);
  if (Date.parse(`${dateIso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) > 86_400_000) {
    return { ok: false, code: 'FUTURE_DATE', reason: `Date ${dateIso} is in the future` };
  }
  let movePct: number | null = null;
  if (previous) {
    const p = Number(previous.value);
    if (Number.isFinite(p) && p > 0) {
      movePct = ((n - p) / p) * 100;
      if (Math.abs(movePct) > policy.maxMovePct) {
        return {
          ok: false,
          code: 'MOVE_EXCEEDS_BOUND',
          reason: `Moves ${movePct.toFixed(1)}% vs previous ${previous.value} (bound ${policy.maxMovePct}%)`,
        };
      }
    }
  }
  const age = businessDaysBetween(dateIso, today);
  return { ok: true, stale: age > policy.maxAgeBusinessDays, ageBusinessDays: age, movePct };
}
