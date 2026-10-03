import { hararePartsOf } from '../common';
export type RefreshScope = 'EOD' | 'INTRADAY' | 'FX' | 'ALL';

/**
 * Worker hook (called from worker.ts tick): decides from the clock and md_refresh_runs which refresh is due.
 * State lives in the database, so a worker restart never double-runs or skips. Times are Harare (UTC+2), Mon-Fri.
 *  - FX:       once a day after 07:30
 *  - INTRADAY: every 30 min between 09:30 and 14:00 (delayed prices; exchange hours are a conservative window)
 *  - EOD:      after 15:00, once per day (retried at most 3 times at 30 min gaps if it failed)
 */
export const SCHEDULE = { fxFrom: 7 * 60 + 30, open: 9 * 60 + 30, close: 14 * 60, eodFrom: 15 * 60, intradayEveryMs: 30 * 60_000, retryEveryMs: 30 * 60_000, maxEodAttempts: 3 };

export function dueScope(now: Date, runsToday: { scope: string; status: string; startedAt: Date }[]): RefreshScope | null {
  const { weekday, minutes } = hararePartsOf(now);
  if (weekday === 0 || weekday === 6) return null;
  const of = (scope: string) => runsToday.filter((r) => r.scope === scope);
  const lastStart = (scope: string) => Math.max(0, ...of(scope).map((r) => r.startedAt.getTime()));

  if (minutes >= SCHEDULE.eodFrom) {
    const eod = of('EOD');
    const done = eod.some((r) => r.status === 'OK' || r.status === 'PARTIAL');
    if (!done && eod.length < SCHEDULE.maxEodAttempts && now.getTime() - lastStart('EOD') >= SCHEDULE.retryEveryMs) return 'EOD';
  } else if (minutes >= SCHEDULE.open && minutes <= SCHEDULE.close) {
    if (now.getTime() - lastStart('INTRADAY') >= SCHEDULE.intradayEveryMs) return 'INTRADAY';
  }
  if (minutes >= SCHEDULE.fxFrom) {
    const fx = of('FX');
    if (!fx.some((r) => r.status === 'OK' || r.status === 'PARTIAL') && fx.length < 3 && now.getTime() - lastStart('FX') >= SCHEDULE.retryEveryMs) return 'FX';
  }
  return null;
}

