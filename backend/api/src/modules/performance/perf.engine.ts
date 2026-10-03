/**
 * Performance pure maths (SRD 5.A.8, BR-030): daily time-weighted return with external flows neutralised, geometric
 * chaining, and single-period Brinson-Fachler attribution by sector. Returns are plain fractions (0.0123 = 1.23%).
 * No database access here.
 */

export interface DayInput {
  /** Portfolio value at the end of the day, base currency. */
  value: number;
  /** Net external flow during the day (deposits positive), applied at the start of the day. */
  flow: number;
}

/** r = V1 / (V0 + F) - 1 (flow at start of day). A non-positive base gives 0 and is reported as a gap. */
export function dayReturn(prevValue: number, d: DayInput): { r: number; gap: boolean } {
  const base = prevValue + d.flow;
  if (!(base > 0)) return { r: 0, gap: true };
  return { r: d.value / base - 1, gap: false };
}

export const chain = (rs: number[]) => rs.reduce((a, r) => a * (1 + r), 1) - 1;

export interface SeriesPoint {
  date: string;
  value: number;
  flow: number;
  ret: number;
  cum: number;
  bench: number | null;
  benchCum: number | null;
}

export function buildSeries(dates: string[], inputs: DayInput[], benchDaily: (number | null)[] | null): { points: SeriesPoint[]; gaps: number; twr: number; benchTwr: number | null } {
  const points: SeriesPoint[] = [{ date: dates[0]!, value: inputs[0]!.value, flow: 0, ret: 0, cum: 0, bench: null, benchCum: benchDaily ? 0 : null }];
  let cum = 1;
  let bcum = 1;
  let gaps = 0;
  for (let t = 1; t < dates.length; t++) {
    const { r, gap } = dayReturn(inputs[t - 1]!.value, inputs[t]!);
    if (gap) gaps += 1;
    cum *= 1 + r;
    const b = benchDaily ? (benchDaily[t] ?? 0) : null;
    if (b !== null) bcum *= 1 + b;
    points.push({ date: dates[t]!, value: inputs[t]!.value, flow: inputs[t]!.flow, ret: r, cum: cum - 1, bench: b, benchCum: benchDaily ? bcum - 1 : null });
  }
  return { points, gaps, twr: cum - 1, benchTwr: benchDaily ? bcum - 1 : null };
}

export interface Segment {
  sector: string;
  /** Average portfolio weight (fraction) and linked return over the period. */
  wp: number;
  rp: number | null;
  /** Benchmark weight (fraction) and linked return. */
  wb: number;
  rb: number | null;
}

export interface SegmentResult extends Segment {
  allocation: number;
  selection: number;
  interaction: number;
  total: number;
}

/**
 * Brinson-Fachler: allocation = (wp - wb)(rb - Rb), selection = wb (rp - rb), interaction = (wp - wb)(rp - rb).
 * Where a side has no holding its return is undefined, so it takes the other side's (selection or allocation drops
 * out rather than inventing an effect).
 */
export function brinson(segments: Segment[], benchTotal: number): SegmentResult[] {
  return segments.map((s) => {
    const rb = s.wb === 0 ? benchTotal : (s.rb ?? benchTotal);
    const rpe = s.wp === 0 ? rb : (s.rp ?? rb);
    const allocation = (s.wp - s.wb) * (rb - benchTotal);
    const selection = s.wb * (rpe - rb);
    const interaction = (s.wp - s.wb) * (rpe - rb);
    return { ...s, allocation, selection, interaction, total: allocation + selection + interaction };
  });
}

export const bps = (v: number) => Math.round(v * 10_000 * 100) / 100;
export const pct6 = (v: number) => (v * 100).toFixed(6);
