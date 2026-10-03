'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, v1 } from './api';
import { moneyFmt } from './operations';
import { Bars } from './opsinsights';
import { Card, Empty, Loaded, useResource } from './ui';

/** Command Centre performance, allocation and scenario panels, read from `GET /dashboard/panels`. */

interface PerfRow {
  portfolioId: string;
  ref: string;
  name: string;
  error?: string;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  twrPct?: number;
  benchmarkPct?: number | null;
  activePct?: number | null;
  benchmarkName?: string | null;
  series?: { date: string; cumPct: number; benchCumPct: number | null }[];
}
interface AllocRow {
  currency: string;
  portfolios: number;
  total: string;
  byAssetClass: { key: string; valueBase: string; weightPct: string }[];
  bySector: { key: string; valueBase: string; weightPct: string }[];
  byMarket: { key: string; valueBase: string; weightPct: string }[];
}
interface ScenarioPreset {
  key: string;
  name: string;
  description: string;
  worst: 'Escalate' | 'Review' | 'Within';
  results: { portfolioId: string; ref: string; name: string; error?: string; currency?: string; nav?: string; lossPct?: string; loss?: string; status?: 'Escalate' | 'Review' | 'Within'; coverage?: string | null; reasons?: string[] }[];
}
interface Panels {
  asOf: string;
  performance: PerfRow[] | null;
  allocation: AllocRow[] | null;
  scenario: ScenarioPreset[] | null;
}

const PALETTE = ['#3a6fd8', '#0a9474', '#d58b1d', '#7a54c9', '#d83c54', '#4a8fa8', '#8a8f98', '#b0883a'];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const STATUS_TONE: Record<string, string> = { Escalate: 'red', Review: 'amber', Within: 'green' };

/** Cumulative return line (portfolio solid, benchmark dashed) with a zero line; no chart library. */
function LineChart({ series }: { series: NonNullable<PerfRow['series']> }) {
  const w = 520;
  const h = 150;
  const pad = 28;
  const vals = series.flatMap((p) => [p.cumPct, ...(p.benchCumPct === null ? [] : [p.benchCumPct])]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals, lo + 0.01);
  const x = (i: number) => pad + (i / Math.max(1, series.length - 1)) * (w - pad - 8);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (h - 8 - 20);
  const path = (get: (p: (typeof series)[number]) => number | null) =>
    series
      .map((p, i) => {
        const v = get(p);
        return v === null ? '' : `${i === 0 || get(series[i - 1]!) === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Cumulative return" style={{ maxWidth: 560 }}>
      <line x1={pad} x2={w - 8} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity=".3" />
      <text x={2} y={y(hi) + 4} fontSize="10" fill="currentColor">{hi.toFixed(1)}%</text>
      <text x={2} y={y(lo)} fontSize="10" fill="currentColor">{lo.toFixed(1)}%</text>
      <path d={path((p) => p.cumPct)} fill="none" stroke="#3a6fd8" strokeWidth="2" />
      <path d={path((p) => p.benchCumPct)} fill="none" stroke="#d58b1d" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={pad} y={h - 4} fontSize="10" fill="currentColor">{series[0]?.date}</text>
      <text x={w - 8} y={h - 4} fontSize="10" textAnchor="end" fill="currentColor">{series[series.length - 1]?.date}</text>
    </svg>
  );
}

function PerformancePanel({ rows }: { rows: PerfRow[] }) {
  const ok = rows.filter((r) => !r.error && r.series?.length);
  const [sel, setSel] = useState(ok[0]?.portfolioId ?? '');
  const cur = ok.find((r) => r.portfolioId === sel) ?? ok[0];
  return (
    <Card title="Performance · net time-weighted return, last 90 days of price history">
      {rows.length === 0 ? (
        <Empty>No active portfolios.</Empty>
      ) : (
        <>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr><th>Portfolio</th><th className="r">Return</th><th className="r">Benchmark</th><th className="r">Active</th><th>Period</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.portfolioId} onClick={() => !r.error && setSel(r.portfolioId)} style={{ cursor: r.error ? 'default' : 'pointer', fontWeight: r.portfolioId === cur?.portfolioId ? 700 : 400 }}>
                    <td>{r.name}<span className="ops-sub">{r.ref}</span></td>
                    {r.error ? (
                      <td colSpan={4} className="ops-muted">{r.error}</td>
                    ) : (
                      <>
                        <td className="r">{pct(r.twrPct)}</td>
                        <td className="r">{pct(r.benchmarkPct)}<span className="ops-sub">{r.benchmarkName ?? 'none set'}</span></td>
                        <td className="r">{pct(r.activePct)}</td>
                        <td>{r.periodStart} to {r.periodEnd}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cur?.series && cur.series.length > 1 ? (
            <div style={{ marginTop: 10 }}>
              <LineChart series={cur.series} />
              <p className="ops-muted" style={{ margin: 0 }}>{cur.name}: solid is the portfolio, dashed the benchmark. Open <Link href="/ops/performance">Performance</Link> for attribution and the official period.</p>
            </div>
          ) : (
            <p className="ops-muted">Choose a portfolio with price history to see its curve.</p>
          )}
        </>
      )}
    </Card>
  );
}

function AllocationPanel({ rows }: { rows: AllocRow[] }) {
  return (
    <Card title="Allocation · all active portfolios">
      {rows.length === 0 ? (
        <Empty>No valued positions.</Empty>
      ) : (
        rows.map((a) => (
          <div key={a.currency} style={{ marginBottom: 14 }}>
            <p style={{ margin: '0 0 6px' }}><strong>{a.currency}</strong> book: {moneyFmt(a.total, a.currency)} across {a.portfolios} portfolio{a.portfolios === 1 ? '' : 's'}</p>
            <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', background: 'rgba(120,130,150,.2)' }} role="img" aria-label={`Asset class split ${a.currency}`}>
              {a.byAssetClass.map((c, i) => (
                <div key={c.key} title={`${c.key} ${c.weightPct}%`} style={{ width: `${c.weightPct}%`, background: PALETTE[i % PALETTE.length] }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginTop: 6 }}>
              {a.byAssetClass.map((c, i) => (
                <span key={c.key}><span style={{ display: 'inline-block', width: 10, height: 10, background: PALETTE[i % PALETTE.length], borderRadius: 2, marginRight: 4 }} />{c.key} {c.weightPct}%</span>
              ))}
            </div>
            {a.bySector.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p className="ops-muted" style={{ margin: '0 0 4px' }}>Largest sectors</p>
                <Bars tone="#0a9474" unit="%" rows={a.bySector.map((s) => ({ label: s.key, value: Number(s.weightPct) }))} />
              </div>
            )}
          </div>
        ))
      )}
    </Card>
  );
}

function ScenarioPanel({ presets }: { presets: ScenarioPreset[] }) {
  const [open, setOpen] = useState(presets[0]?.key ?? '');
  const cur = presets.find((p) => p.key === open) ?? presets[0];
  return (
    <Card title="Scenarios · preset stresses on the largest portfolios">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {presets.map((p) => (
          <button key={p.key} type="button" className={`ops-btn small${p.key === cur?.key ? ' primary' : ''}`} onClick={() => setOpen(p.key)}>
            {p.name} <span className={`ops-badge ${STATUS_TONE[p.worst]}`}>{p.worst.toLowerCase()}</span>
          </button>
        ))}
      </div>
      {cur && (
        <>
          <p className="ops-muted" style={{ marginTop: 0 }}>{cur.description}</p>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Portfolio</th><th className="r">NAV</th><th className="r">Loss</th><th className="r">Liquidity cover</th><th>Result</th></tr></thead>
              <tbody>
                {cur.results.map((r) => (
                  <tr key={r.portfolioId}>
                    <td>{r.name}<span className="ops-sub">{r.ref}</span></td>
                    {r.error || !r.status ? (
                      <td colSpan={4} className="ops-muted">{r.error ?? 'Not available'}</td>
                    ) : (
                      <>
                        <td className="r">{moneyFmt(r.nav ?? 0, r.currency)}</td>
                        <td className="r">{r.lossPct}%<span className="ops-sub">{moneyFmt(r.loss ?? 0, r.currency)}</span></td>
                        <td className="r">{r.coverage ?? 'n/a'}</td>
                        <td><span className={`ops-badge ${STATUS_TONE[r.status]}`}>{r.status.toLowerCase()}</span>{r.reasons?.[0] && <span className="ops-sub">{r.reasons[0]}</span>}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ops-muted" style={{ marginBottom: 0 }}>Run custom shocks in <Link href="/ops/risk">Risk</Link>.</p>
        </>
      )}
    </Card>
  );
}

export function CommandPanels() {
  const res = useResource<Panels>(() => api.get<Panels>(v1('/dashboard/panels')), []);
  return (
    <Loaded res={res} what="the performance, allocation and scenario panels">
      {(p) => (
        <>
          {p.performance && <PerformancePanel rows={p.performance} />}
          {p.allocation && <AllocationPanel rows={p.allocation} />}
          {p.scenario && <ScenarioPanel presets={p.scenario} />}
        </>
      )}
    </Loaded>
  );
}
