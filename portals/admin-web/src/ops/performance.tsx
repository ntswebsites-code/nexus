'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, qs, v1 } from './api';
import { formatDecimal } from './money';
import { Modal } from './ui';

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

// ------------------------------------------------------------------ chart event markers and keyboard operation (FR-PERF-006/007)

export interface ChartEvent {
  id: string;
  kind: 'CASH_FLOW' | 'REBALANCE' | 'IC_DECISION';
  date: string;
  label: string;
  ref: string;
  href: string;
}

export const EVENT_STYLE: Record<ChartEvent['kind'], { name: string; color: string; shape: 'circle' | 'diamond' | 'square' }> = {
  CASH_FLOW: { name: 'Cash flow', color: '#087a52', shape: 'circle' },
  REBALANCE: { name: 'Rebalance', color: '#1d5fd1', shape: 'diamond' },
  IC_DECISION: { name: 'IC decision', color: '#b4540a', shape: 'square' },
};
const KIND_ROW: Record<ChartEvent['kind'], number> = { CASH_FLOW: 0, REBALANCE: 1, IC_DECISION: 2 };

/** Index of the last chart date on or before the event date (the first date when the event precedes the chart). */
export function markerIndex(series: SeriesPoint[], date: string): number {
  let idx = 0;
  for (let i = 0; i < series.length; i++) if (series[i]!.date <= date) idx = i;
  return idx;
}

function Marker({ kind, x, y, color }: { kind: ChartEvent['kind']; x: number; y: number; color: string }) {
  const s = EVENT_STYLE[kind].shape;
  if (s === 'circle') return <circle cx={x} cy={y} r={5} fill="var(--ops-card-bg, #fff)" stroke={color} strokeWidth={2.5} />;
  if (s === 'square') return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} fill={color} />;
  return <polygon points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`} fill={color} />;
}

const dayText = (p: SeriesPoint) =>
  `${p.date}: portfolio ${pct(p.cum * 100)}${p.benchCum !== null ? `, benchmark ${pct(p.benchCum * 100)}, active ${pct((p.cum - p.benchCum) * 100)}` : ''}`;

/**
 * Cumulative return line chart: portfolio against benchmark, with a per-point tooltip, labelled event markers (cash
 * flow, rebalance, IC decision; click or Enter opens the linked record) and keyboard operation: the chart is a tab
 * stop, Left and Right move the crosshair, Home and End jump to the ends, Enter opens the drill drawer for the date.
 * Pass `portfolioId` to load the markers from `/performance/events` for the charted window.
 */
export function ReturnChart({ series, portfolioId }: { series: SeriesPoint[]; portfolioId?: string }) {
  const router = useRouter();
  const [events, setEvents] = useState<ChartEvent[]>([]);
  const [cursor, setCursor] = useState(Math.max(0, series.length - 1));
  const [drill, setDrill] = useState<number | null>(null);
  const first = series[0]?.date;
  const last = series[series.length - 1]?.date;

  useEffect(() => {
    setCursor(Math.max(0, series.length - 1));
  }, [series.length, first, last]);

  useEffect(() => {
    let alive = true;
    if (!portfolioId || !first || !last) {
      setEvents([]);
      return;
    }
    api
      .get<ChartEvent[]>(v1(`/performance/events${qs({ portfolioId, from: first, to: last })}`))
      .then((e) => alive && setEvents(Array.isArray(e) ? e : []))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [portfolioId, first, last]);

  if (series.length < 2) return <p className="ops-muted">Not enough valuation dates to draw a chart.</p>;
  const W = 760;
  const H = 270;
  const pad = { l: 52, r: 16, t: 44, b: 26 };
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
  const cur = series[Math.min(cursor, series.length - 1)]!;
  const placed = events.map((e) => ({ e, i: markerIndex(series, e.date) }));
  const atCursor = placed.filter((m) => m.i === cursor).map((m) => m.e);

  const onKey = (ev: React.KeyboardEvent) => {
    const n = series.length - 1;
    const move = (to: number) => {
      ev.preventDefault();
      setCursor(Math.min(n, Math.max(0, to)));
    };
    if (ev.key === 'ArrowRight') move(cursor + 1);
    else if (ev.key === 'ArrowLeft') move(cursor - 1);
    else if (ev.key === 'PageDown') move(cursor + 10);
    else if (ev.key === 'PageUp') move(cursor - 10);
    else if (ev.key === 'Home') move(0);
    else if (ev.key === 'End') move(n);
    else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      setDrill(cursor);
    }
  };
  const open = (href: string) => router.push(href);
  const drillPoint = drill === null ? null : series[Math.min(drill, series.length - 1)]!;
  const drillEvents = drill === null ? [] : placed.filter((m) => m.i === drill).map((m) => m.e);

  return (
    <div>
      <div
        role="application"
        aria-roledescription="line chart"
        aria-label="Cumulative return, portfolio against benchmark. Use the left and right arrow keys to move along the dates and Enter to open the details of a date."
        aria-describedby="return-chart-readout"
        tabIndex={0}
        onKeyDown={onKey}
        style={{ outlineOffset: 2 }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative return, portfolio against benchmark" style={{ width: '100%', height: 'auto', maxHeight: 310 }}>
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
          <line data-testid="chart-crosshair" x1={x(cursor)} x2={x(cursor)} y1={pad.t - 4} y2={H - pad.b} stroke="currentColor" strokeWidth={1.5} opacity={0.55} />
          {series.map((p, i) => (
            <circle key={p.date} cx={x(i)} cy={y(p.cum * 100)} r={i === cursor ? 5 : series.length > 60 ? 1.5 : 3.5} fill="#7448d6" onClick={() => setCursor(i)} style={{ cursor: 'pointer' }}>
              <title>{`${p.date}: portfolio ${pct(p.cum * 100)}${p.benchCum !== null ? ` · benchmark ${pct(p.benchCum * 100)} · active ${pct((p.cum - p.benchCum) * 100)}` : ''}`}</title>
            </circle>
          ))}
          {placed.map(({ e, i }) => {
            const st = EVENT_STYLE[e.kind];
            const my = 10 + KIND_ROW[e.kind] * 11;
            return (
              <g
                key={`${e.kind}-${e.id}`}
                role="link"
                tabIndex={0}
                data-testid={`marker-${e.kind}`}
                aria-label={`${st.name}: ${e.label}, ${e.date}. Press Enter to open the record.`}
                style={{ cursor: 'pointer' }}
                onClick={() => open(e.href)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    open(e.href);
                  } else ev.stopPropagation();
                }}
              >
                <title>{`${st.name}: ${e.label} · ${e.date}`}</title>
                <line x1={x(i)} x2={x(i)} y1={my + 6} y2={H - pad.b} stroke={st.color} strokeWidth={1} opacity={0.35} strokeDasharray="2 3" />
                <Marker kind={e.kind} x={x(i)} y={my} color={st.color} />
              </g>
            );
          })}
          <text x={pad.l} y={H - 6} fontSize={11} fill="currentColor" opacity={0.7}>
            {series[0]!.date}
          </text>
          <text x={W - pad.r} y={H - 6} fontSize={11} textAnchor="end" fill="currentColor" opacity={0.7}>
            {series[series.length - 1]!.date}
          </text>
          <text x={W - pad.r} y={H - 6 - 14} fontSize={11} textAnchor="end" fill="currentColor">
            <tspan fill="#7448d6">● Portfolio</tspan>
            {hasBench && <tspan fill="#9a6500"> ┅ Benchmark</tspan>}
          </text>
        </svg>
        <p id="return-chart-readout" role="status" aria-live="polite" data-testid="chart-readout" className="ops-muted" style={{ margin: '4px 0 0' }}>
          {dayText(cur)}
          {atCursor.length > 0 ? ` · ${atCursor.map((e) => `${EVENT_STYLE[e.kind].name}: ${e.label}`).join('; ')}` : ''}
        </p>
      </div>
      <ul aria-label="Chart markers" style={{ display: 'flex', gap: 16, listStyle: 'none', padding: 0, margin: '6px 0 0', flexWrap: 'wrap', fontSize: 12 }}>
        {(Object.keys(EVENT_STYLE) as ChartEvent['kind'][]).map((k) => (
          <li key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
              <Marker kind={k} x={7} y={7} color={EVENT_STYLE[k].color} />
            </svg>
            {EVENT_STYLE[k].name} ({events.filter((e) => e.kind === k).length})
          </li>
        ))}
        <li className="ops-muted">Left and right arrows move along the dates; Enter opens the day.</li>
      </ul>
      {drillPoint && (
        <Modal title={`Day detail: ${drillPoint.date}`} kicker="Performance" onClose={() => setDrill(null)}>
          <div className="ops-modal-body">
            <dl className="ops-dl">
              <div><dt>Portfolio value</dt><dd>{money2(String(drillPoint.value))}</dd></div>
              <div><dt>External flow</dt><dd>{money2(String(drillPoint.flow))}</dd></div>
              <div><dt>Day return</dt><dd>{pct(drillPoint.ret * 100, 3)}</dd></div>
              <div><dt>Cumulative, portfolio</dt><dd>{pct(drillPoint.cum * 100)}</dd></div>
              <div><dt>Cumulative, benchmark</dt><dd>{drillPoint.benchCum === null ? '—' : pct(drillPoint.benchCum * 100)}</dd></div>
              <div><dt>Active</dt><dd>{drillPoint.benchCum === null ? '—' : pct((drillPoint.cum - drillPoint.benchCum) * 100)}</dd></div>
            </dl>
            <h4>Events on this date</h4>
            {drillEvents.length === 0 ? (
              <p className="ops-muted">No cash flow, rebalance or IC decision is marked on this date.</p>
            ) : (
              <ul>
                {drillEvents.map((e) => (
                  <li key={`${e.kind}-${e.id}`}>
                    {EVENT_STYLE[e.kind].name}:{' '}
                    <a href={e.href} onClick={(ev) => { ev.preventDefault(); open(e.href); }}>
                      {e.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <footer className="ops-modal-foot">
            <button className="ops-btn" type="button" autoFocus onClick={() => setDrill(null)}>
              Close
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
