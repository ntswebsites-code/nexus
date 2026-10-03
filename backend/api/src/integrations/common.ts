import { createHash } from 'node:crypto';

/**
 * Shared helpers for the integration adapters (market data, custodian feed).
 * Pure module: no database or config imports, so offline scripts can load it.
 */

/** Thrown by a `live` adapter stub until the paid feed or vendor credentials are supplied. */
export class IntegrationNotConfiguredError extends Error {
  readonly code = 'integration_not_configured';
  constructor(
    readonly integration: string,
    readonly requiredEnv: string[],
    detail?: string,
  ) {
    super(
      `${integration} live adapter is not configured. Set ${requiredEnv.join(', ')} and implement the vendor client.${detail ? ` ${detail}` : ''}`,
    );
    this.name = 'IntegrationNotConfiguredError';
  }
}

/** Reads `INTEGRATION_<NAME>` style mode flags; unknown values fall back to the default. */
export function integrationMode<T extends string>(envName: string, allowed: readonly T[], fallback: T, env: NodeJS.ProcessEnv = process.env): T {
  const raw = (env[envName] ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Deterministic unit float in [0, 1) from a string (for the fake generators). */
export function hashUnit(seed: string): number {
  const h = createHash('sha256').update(seed).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const dayFromIso = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Harare is UTC+2 all year (no DST). The Zimbabwean exchanges trade on this clock. */
export const HARARE_OFFSET_MS = 2 * 60 * 60 * 1000;
export const hararePartsOf = (d: Date) => {
  const local = new Date(d.getTime() + HARARE_OFFSET_MS);
  return { iso: isoDay(local), weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
};

/** The most recent weekday on or before `iso` (Saturday and Sunday roll back to Friday). */
export function lastWeekdayOnOrBefore(iso: string): string {
  const d = dayFromIso(iso);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return isoDay(d);
}

/** Weekdays elapsed from `fromIso` to `toIso` (0 when the same day or reversed). */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = dayFromIso(fromIso);
  const to = dayFromIso(toIso);
  let n = 0;
  for (const d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) {
    const next = new Date(d.getTime() + 86_400_000);
    if (next.getUTCDay() !== 0 && next.getUTCDay() !== 6) n++;
  }
  return n;
}
