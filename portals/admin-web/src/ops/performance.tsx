'use client';

import { formatDecimal } from './money';

// ------------------------------------------------------------------ types (mirror /api/v1/performance)

export interface SeriesPoint {
  date: string;
  value: number;
  flow: number;
  ret: number;
  cum: number;
  bench: number | null;
  benchCum: number | null;
}

export interface Control {
  key: string;
  title: string;
  description: string;
  state: 'done' | 'warn';
  detail: string;
}

export interface Headline {
  startValue: string;
  endValue: string;
  netFlows: string;
  twrPct: string;
  benchmarkPct: string | null;
  activePct: string | null;
  dayCount: number;
  baseCurrency: string;
}

export interface Returns extends Headline {
  portfolioId: string;
  portfolioRef: string;
  portfolioName: string;
  periodStart: string;
  periodEnd: string;
  benchmark: { id: string; code: string; name: string } | null;
  series: SeriesPoint[];
  issues: { missingPrice: string[]; missingFx: string[]; stale: string[]; gapDays: number };
  controls: Control[];
  controlsPending: number;
  navCheck: { ref: string; nav: string; computed: string; diffPct: string } | null;
  method: string;
}

export interface Segment {
  sector: string;
  avgWeightPct: string;
  benchWeightPct: string;
  allocationBps: number;
  selectionBps: number;
  interactionBps: number;
  totalBps: number;
  portfolioReturnPct: string | null;
  benchmarkReturnPct: string | null;
}

export interface Contribution {
  securityId: string | null;
  ticker: string;
  name: string;
  sector: string;
  avgWeightPct: string;
  returnPct: string | null;
  contributionBps: number;
  benchWeightPct: string | null;
  startValue: string;
  endValue: string;
}

export interface Attribution extends Headline {
  portfolioId: string;
  portfolioName: string;
  periodStart: string;
  periodEnd: string;
  benchmark: { id: string; code: string; name: string } | null;
  segments: Segment[];
  totals: { allocationBps: number; selectionBps: number; interactionBps: number; explainedBps: number; activeBps: number | null; unexplainedBps: number | null };
  contributions: Contribution[];
}

export interface SummaryRow extends Partial<Headline> {
  portfolioId: string;
  portfolioRef: string;
  portfolioName: string;
  benchmarkName?: string | null;
  periodStart?: string;
  periodEnd?: string;
  lastOfficial?: { ref: string; periodEnd: string | null } | null;
  error?: string;
}

export interface Period extends Headline {
  id: string;
  ref: string;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  benchmarkId: string | null;
  periodStart: string;
  periodEnd: string;
  version: number;
  status: 'DRAFT' | 'LOCKED' | 'SUPERSEDED';
  official: boolean;
  makerId: string;
  makerName: string | null;
  checkerId: string | null;
  checkerName: string | null;
  lockedAt: string | null;
  lockNote: string | null;
  supersedesId: string | null;
  correctionReason: string | null;
  createdAt: string;
}

export interface PeriodDetail extends Period {
  series: SeriesPoint[];
  attribution: { benchmark: Attribution['benchmark']; segments: Segment[]; totals: Attribution['totals'] } | null;
  contributions: Contribution[] | null;
  controls: Control[] | null;
  controlsPending: number;
  navCheck: Returns['navCheck'];
  stale: boolean;
  dataHash: string;
  canLock: boolean;
}

export interface Benchmark {
  id: string;
  code: string;
  name: string;
  status: string;
  totalWeightPct: string;
  constituents: { id: string; securityId: string | null; ticker: string | null; name: string | null; sector: string; weightPct: string }[];
}

// ------------------------------------------------------------------ helpers

export const pct = (v: string | number | null | undefined, dp = 2) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(dp)}%`;
};
export const plainPct = (v: string | null | undefined, dp = 2) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(dp)}%`);
export const bpsText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)} bps`);
export const money2 = (v: string | null | undefined) => formatDecimal(v, 2);
export const tone = (v: number | string | null | undefined) => (v === null || v === undefined ? undefined : Number(v) > 0 ? 'var(--ops-green, #087a52)' : Number(v) < 0 ? 'var(--ops-red, #b42318)' : undefined);

export function ControlList({ controls }: { controls: Control[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
      {controls.map((c) => (
        <li key={c.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span className={`ops-badge ${c.state === 'done' ? 'green' : 'amber'}`} aria-label={c.state === 'done' ? 'Done' : 'Needs attention'}>
            {c.state === 'done' ? '✓' : '!'}
          </span>
          <span>
            <strong>{c.title}</strong>
            <span className="ops-sub">{c.description}</span>
            <span className="ops-sub" style={{ color: c.state === 'done' ? undefined : 'var(--ops-amber)' }}>
              {c.detail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Cumulative return line chart: portfolio against benchmark, with a per-point tooltip. */
export function ReturnChart({ series }: { series: SeriesPoint[] }) {
  if (series.length < 2) return <p className="ops-muted">Not enough valuation dates to draw a chart.</p>;
  const W = 760;
  const H = 240;
  const pad = { l: 52, r: 16, t: 14, b: 26 };
  const vals = series.flatMap((p) => [p.cum * 100, p.benchCum === null ? p.cum * 100 : p.benchCum * 100, 0]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const line = (get: (p: SeriesPoint) => number | null) =>
    series
      .map((p, i) => {
        const v = get(p);
        return v === null ? null : `${x(i).toFixed(1)},${y(v * 100).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  const hasBench = series.some((p) => p.benchCum !== null);
  const ticks = [min, min + span / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative return, portfolio against benchmark" style={{ width: '100%', height: 'auto', maxHeight: 280 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" opacity={0.12} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="currentColor" opacity={0.7}>
            {t.toFixed(1)}%
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="currentColor" opacity={0.35} strokeDasharray="4 3" />
      {hasBench && <polyline fill="none" stroke="#9a6500" strokeWidth={2} strokeDasharray="6 3" points={line((p) => p.benchCum)} />}
      <polyline fill="none" stroke="#7448d6" strokeWidth={2.5} points={line((p) => p.cum)} />
      {series.map((p, i) => (
        <circle key={p.date} cx={x(i)} cy={y(p.cum * 100)} r={series.length > 60 ? 1.5 : 3.5} fill="#7448d6">
          <title>{`${p.date}: portfolio ${pct(p.cum * 100)}${p.benchCum !== null ? ` · benchmark ${pct(p.benchCum * 100)} · active ${pct((p.cum - p.benchCum) * 100)}` : ''}`}</title>
        </circle>
      ))}
      <text x={pad.l} y={H - 6} fontSize={11} fill="currentColor" opacity={0.7}>
        {series[0]!.date}
      </text>
      <text x={W - pad.r} y={H - 6} fontSize={11} textAnchor="end" fill="currentColor" opacity={0.7}>
        {series[series.length - 1]!.date}
      </text>
      <text x={W - pad.r} y={12} fontSize={11} textAnchor="end" fill="currentColor">
        <tspan fill="#7448d6">● Portfolio</tspan>
        {hasBench && <tspan fill="#9a6500"> ┅ Benchmark</tspan>}
      </text>
    </svg>
  );
}
