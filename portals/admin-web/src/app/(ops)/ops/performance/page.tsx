'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, apiDownload, apiRequest, qs, v1 } from '@/ops/api';
import {
  bpsText,
  ControlList,
  money2,
  pct,
  plainPct,
  ReturnChart,
  tone,
  type Attribution,
  type Benchmark,
  type Period,
  type PeriodDetail,
  type Returns,
  type SummaryRow,
} from '@/ops/performance';
import { Tile } from '@/ops/ibor';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import type { SecurityRow } from '@/ops/types';
import { Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, Loaded, PageHeader, StatusBadge, optStr, str, useResource } from '@/ops/ui';

type Tab = 'overview' | 'attribution' | 'contributions' | 'controls' | 'periods' | 'benchmarks';

export default function PerformancePage() {
  const router = useRouter();
  const canView = useCan('reports.view');
  const canPrepare = useCan('reports.create');
  const [portfolioId, setPortfolioId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [benchmarkId, setBenchmarkId] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [preparing, setPreparing] = useState(false);

  const summary = useResource<{ data: SummaryRow[] }>(() => apiRequest<{ data: SummaryRow[] }>('GET', v1(`/performance/summary${qs({ from, to })}`)), [from, to]);
  const benchmarks = useResource<Benchmark[]>(() => api.get<Benchmark[]>(v1('/performance/benchmarks')), []);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('portfolioId')) setPortfolioId(sp.get('portfolioId')!);
  }, []);
  useEffect(() => {
    if (!portfolioId && summary.state === 'ok' && summary.data.data.length) setPortfolioId(summary.data.data[0]!.portfolioId);
  }, [portfolioId, summary]);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Performance" title="Performance & Attribution" />
        <Alert>Your role does not include performance reporting. Ask an administrator for the reports.view permission.</Alert>
      </>
    );
  }
  const rows = summary.state === 'ok' ? summary.data.data : [];
  const selected = rows.find((r) => r.portfolioId === portfolioId);

  return (
    <>
      <PageHeader
        kicker="PBOR · returns and attribution"
        title="Performance & Attribution"
        subtitle="Net time-weighted returns from position, price and flow history, against the portfolio's benchmark, with Brinson attribution and a maker-checker lock for official returns."
        actions={
          canPrepare && portfolioId ? (
            <button className="ops-btn primary" type="button" onClick={() => setPreparing(true)}>
              Prepare official period
            </button>
          ) : undefined
        }
      />

      {(() => {
        const today = new Date().toISOString().slice(0, 10);
        const latest = rows.map((x) => x.periodEnd).filter((x): x is string => !!x).sort().pop();
        const gap = latest ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000) : 0;
        return gap > 7 ? <Alert kind="warn">{`Price history ends ${formatDate(latest)}, ${gap} days before today. Returns stop at that date until newer prices are loaded; check the period dates before preparing an official period.`}</Alert> : null;
      })()}
      <Card title="Returns by portfolio">
        <div className="ops-filters">
          <Field label="From" hint="Blank uses each portfolio's price history">
            <input className="ops-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="ops-input" type="date" value={to} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Loaded res={summary} what="portfolio returns">
          {(s) =>
            s.data.length === 0 ? (
              <Empty>No portfolios yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Portfolio</th>
                      <th>Period</th>
                      <th className="r">TWR</th>
                      <th className="r">Benchmark</th>
                      <th className="r">Active</th>
                      <th>Last official</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.data.map((r) => (
                      <tr key={r.portfolioId} className="clickable" onClick={() => setPortfolioId(r.portfolioId)} style={r.portfolioId === portfolioId ? { background: 'var(--ops-hover, rgba(116,72,214,0.08))' } : undefined}>
                        <td>
                          <strong>{r.portfolioName}</strong>
                          <span className="ops-sub">{r.benchmarkName ?? 'No benchmark'}</span>
                        </td>
                        <td>{r.error ? <span className="ops-muted">{r.error}</span> : `${formatDate(r.periodStart)} to ${formatDate(r.periodEnd)}`}</td>
                        <td className="r" style={{ color: tone(r.twrPct) }}>
                          {pct(r.twrPct)}
                        </td>
                        <td className="r">{r.benchmarkPct == null && !r.error ? <span className="ops-muted" title={`${r.benchmarkName ?? 'This benchmark'} has no constituent composition loaded, so no benchmark return can be computed`}>No composition</span> : pct(r.benchmarkPct)}</td>
                        <td className="r" style={{ color: tone(r.activePct) }}>
                          {pct(r.activePct)}
                        </td>
                        <td>{r.lastOfficial ? `${r.lastOfficial.ref} to ${formatDate(r.lastOfficial.periodEnd)}` : <span className="ops-muted">None</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>

      {portfolioId && (
        <>
          <h2 style={{ margin: '18px 0 8px' }}>{selected?.portfolioName ?? 'Selected portfolio'}</h2>
          <TabBar
            tabs={[
              { key: 'overview', label: 'Return & benchmark' },
              { key: 'attribution', label: 'Allocation & selection' },
              { key: 'contributions', label: 'Contributions' },
              { key: 'controls', label: 'Official-return controls' },
              { key: 'periods', label: 'Periods' },
              { key: 'benchmarks', label: 'Benchmarks' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab !== 'periods' && tab !== 'benchmarks' && (
            <Card>
              <div className="ops-filters">
                <Field label="Benchmark">
                  <select className="ops-input" value={benchmarkId} onChange={(e) => setBenchmarkId(e.target.value)}>
                    <option value="">Portfolio default</option>
                    {benchmarks.state === 'ok' &&
                      benchmarks.data.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} · {b.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
            </Card>
          )}
          {(tab === 'overview' || tab === 'controls') && <ReturnsTab tab={tab} portfolioId={portfolioId} from={from} to={to} benchmarkId={benchmarkId} />}
          {(tab === 'attribution' || tab === 'contributions') && <AttributionTab tab={tab} portfolioId={portfolioId} from={from} to={to} benchmarkId={benchmarkId} />}
          {tab === 'periods' && <PeriodsTab portfolioId={portfolioId} />}
          {tab === 'benchmarks' && <BenchmarksTab canEdit={canPrepare} res={benchmarks} />}
        </>
      )}

      {preparing && (
        <FormModal
          title="Prepare official period"
          kicker="Performance"
          subtitle="Stores the return, attribution and controls as a draft. A different person with the lock permission locks it once all five controls are done."
          submitLabel="Prepare draft"
          onClose={() => setPreparing(false)}
          onSubmit={(fd, key) =>
            api.post<PeriodDetail>(v1('/performance/periods'), { portfolioId, periodStart: str(fd, 'periodStart'), periodEnd: str(fd, 'periodEnd'), ...(optStr(fd, 'benchmarkId') ? { benchmarkId: optStr(fd, 'benchmarkId') } : {}) }, { idempotencyKey: key })
          }
          onDone={(r) => router.push(`/ops/performance/${encodeURIComponent((r as PeriodDetail).id)}`)}
        >
          <FieldGrid>
            <Field label="Period start" hint="Pre-filled from the portfolio's price history; confirm both dates">
              <input className="ops-input" type="date" name="periodStart" required defaultValue={selected?.periodStart ?? from} />
            </Field>
            <Field label="Period end" hint="Cannot be in the future">
              <input className="ops-input" type="date" name="periodEnd" required defaultValue={selected?.periodEnd ?? to} max={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="Benchmark" span={2} hint="Blank uses the benchmark matching the portfolio's benchmark name">
              <select className="ops-input" name="benchmarkId" defaultValue={benchmarkId}>
                <option value="">Portfolio default</option>
                {benchmarks.state === 'ok' &&
                  benchmarks.data.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}

// ================================================================ return and controls

function ReturnsTab({ tab, portfolioId, from, to, benchmarkId }: { tab: Tab; portfolioId: string; from: string; to: string; benchmarkId: string }) {
  const res = useResource<Returns>(() => api.get<Returns>(v1(`/performance/returns${qs({ portfolioId, from, to, benchmarkId })}`)), [portfolioId, from, to, benchmarkId]);
  return (
    <Loaded res={res} what="the return">
      {(r) => (
        <>
          {tab === 'overview' && (
            <>
              <div className="ops-tiles">
                <Tile label="Net TWR" value={pct(r.twrPct)} hint={`${formatDate(r.periodStart)} to ${formatDate(r.periodEnd)} · ${r.dayCount} day(s)`} />
                <Tile label="Benchmark" value={pct(r.benchmarkPct)} hint={r.benchmark?.name ?? 'No benchmark composition'} tone={r.benchmark ? undefined : 'warn'} />
                <Tile label="Active return" value={pct(r.activePct)} hint="Portfolio less benchmark" />
                <Tile label="End value" value={`${r.baseCurrency} ${money2(r.endValue)}`} hint={`Start ${money2(r.startValue)} · net flows ${money2(r.netFlows)}`} />
              </div>
              <Card title="Cumulative return">
                <ReturnChart series={r.series} portfolioId={r.portfolioId} />
                <p className="ops-muted">{r.method}</p>
                {(r.issues.missingPrice.length > 0 || r.issues.missingFx.length > 0 || r.issues.stale.length > 0) && (
                  <Alert kind="warn">
                    {[r.issues.missingPrice.length > 0 && `No price: ${r.issues.missingPrice.join(', ')}.`, r.issues.missingFx.length > 0 && `No FX rate: ${r.issues.missingFx.join(', ')}.`, r.issues.stale.length > 0 && `Stale at period end: ${r.issues.stale.join(', ')}.`].filter(Boolean).join(' ')}
                  </Alert>
                )}
              </Card>
              <Card title="Evidence">
                <ul>
                  <li>
                    <Link href={`/ops/ibor${qs({ portfolioId })}`}>Positions (IBOR) →</Link> · authoritative investment book
                  </li>
                  <li>
                    <Link href="/ops/accounting">Accounting & Close →</Link> · fees, accruals and official accounting
                  </li>
                  <li>
                    <Link href="/ops/orders">Orders →</Link> · decision price, fills and implementation costs
                  </li>
                </ul>
              </Card>
            </>
          )}
          {tab === 'controls' && (
            <Card title={r.controlsPending === 0 ? 'All official-return controls are done' : `${r.controlsPending} control(s) still to clear`}>
              <ControlList controls={r.controls} />
              {r.navCheck && (
                <p className="ops-muted" style={{ marginTop: 12 }}>
                  NAV cross-check: {r.navCheck.ref} {money2(r.navCheck.nav)} vs computed {money2(r.navCheck.computed)} ({r.navCheck.diffPct}% apart).
                </p>
              )}
              <p className="ops-muted">
                Return basis: net time-weighted return, daily geometric chaining, external flows neutralised, benchmark effective-dated. A period can be locked only when all five controls are done, and only by someone other than the preparer.
              </p>
            </Card>
          )}
        </>
      )}
    </Loaded>
  );
}

// ================================================================ attribution and contributions

function AttributionTab({ tab, portfolioId, from, to, benchmarkId }: { tab: Tab; portfolioId: string; from: string; to: string; benchmarkId: string }) {
  const [exportError, setExportError] = useState<string | null>(null);
  const exportFile = (format: 'csv' | 'xlsx') =>
    void apiDownload(v1(`/performance/attribution/export${qs({ portfolioId, from, to, benchmarkId, format })}`), `attribution.${format}`).then(() => setExportError(null), (e: Error) => setExportError(e.message));
  const res = useResource<Attribution>(() => api.get<Attribution>(v1(`/performance/attribution${qs({ portfolioId, from, to, benchmarkId })}`)), [portfolioId, from, to, benchmarkId]);
  return (
    <Loaded res={res} what="the attribution">
      {(a) => (
        <>
          <div className="ops-actions" style={{ marginBottom: 10 }}>
            <button className="ops-btn" type="button" onClick={() => exportFile('csv')}>Export CSV</button>
            <button className="ops-btn" type="button" onClick={() => exportFile('xlsx')}>Export XLSX</button>
          </div>
          {exportError && <Alert>{exportError}</Alert>}
          {tab === 'attribution' && (
            <Card title="Brinson attribution by sector">
              {!a.benchmark ? (
                <Empty>No benchmark composition is attached, so there is nothing to attribute against. Add one on the Benchmarks tab.</Empty>
              ) : (
                <>
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th>Segment</th>
                          <th className="r">Avg wt.</th>
                          <th className="r">BM wt.</th>
                          <th className="r">Port. return</th>
                          <th className="r">BM return</th>
                          <th className="r">Allocation</th>
                          <th className="r">Selection</th>
                          <th className="r">Interaction</th>
                          <th className="r">Total active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.segments.map((s) => (
                          <tr key={s.sector}>
                            <td>
                              <strong>{s.sector}</strong>
                            </td>
                            <td className="r">{plainPct(s.avgWeightPct, 1)}</td>
                            <td className="r">{plainPct(s.benchWeightPct, 1)}</td>
                            <td className="r">{s.portfolioReturnPct === null ? '—' : pct(s.portfolioReturnPct)}</td>
                            <td className="r">{s.benchmarkReturnPct === null ? '—' : pct(s.benchmarkReturnPct)}</td>
                            <td className="r">{bpsText(s.allocationBps)}</td>
                            <td className="r">{bpsText(s.selectionBps)}</td>
                            <td className="r">{bpsText(s.interactionBps)}</td>
                            <td className="r" style={{ color: tone(s.totalBps) }}>
                              {bpsText(s.totalBps)}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td>
                            <strong>Explained</strong>
                          </td>
                          <td colSpan={4} />
                          <td className="r">{bpsText(a.totals.allocationBps)}</td>
                          <td className="r">{bpsText(a.totals.selectionBps)}</td>
                          <td className="r">{bpsText(a.totals.interactionBps)}</td>
                          <td className="r">
                            <strong>{bpsText(a.totals.explainedBps)}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Linking, trading and timing</td>
                          <td colSpan={7} />
                          <td className="r">{bpsText(a.totals.unexplainedBps)}</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Active return</strong>
                          </td>
                          <td colSpan={7} />
                          <td className="r">
                            <strong>{bpsText(a.totals.activeBps)}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="ops-muted">Brinson-Fachler on average start-of-day weights and linked sector returns; benchmark {a.benchmark.code} held at its target weights. The unexplained line is the difference between the geometric active return and the sum of the arithmetic effects.</p>
                </>
              )}
            </Card>
          )}
          {tab === 'contributions' && (
            <Card title="Contribution by security">
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Security</th>
                      <th>Sector</th>
                      <th className="r">Avg wt.</th>
                      <th className="r">Return</th>
                      <th className="r">Contribution</th>
                      <th className="r">BM wt.</th>
                      <th>Drill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.contributions.map((c) => (
                      <tr key={`${c.ticker}-${c.securityId}`}>
                        <td>
                          <strong>{c.ticker}</strong>
                          <span className="ops-sub">{c.name}</span>
                        </td>
                        <td>{c.sector}</td>
                        <td className="r">{plainPct(c.avgWeightPct, 1)}</td>
                        <td className="r">{c.returnPct === null ? '—' : pct(c.returnPct)}</td>
                        <td className="r" style={{ color: tone(c.contributionBps) }}>
                          {bpsText(c.contributionBps)}
                        </td>
                        <td className="r">{c.benchWeightPct === null ? '—' : plainPct(c.benchWeightPct, 1)}</td>
                        <td>
                          {c.securityId ? (
                            <>
                              <Link href={`/ops/ibor/position${qs({ portfolioId, securityId: c.securityId })}`}>Positions</Link> · <Link href={`/ops/orders?q=${encodeURIComponent(c.ticker)}`}>Orders</Link>
                            </>
                          ) : (
                            <span className="ops-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4}>
                        <strong>Total (equals the time-weighted return)</strong>
                      </td>
                      <td className="r">
                        <strong>{bpsText(a.contributions.reduce((s, c) => s + c.contributionBps, 0))}</strong>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </Loaded>
  );
}

// ================================================================ periods

function PeriodsTab({ portfolioId }: { portfolioId: string }) {
  const router = useRouter();
  const res = useResource<{ data: Period[]; total: number }>(() => apiRequest<{ data: Period[]; total: number }>('GET', v1(`/performance/periods${qs({ portfolioId })}`)), [portfolioId]);
  return (
    <Card title="Official periods">
      <Loaded res={res} what="periods">
        {(p) =>
          p.data.length === 0 ? (
            <Empty>No periods prepared for this portfolio yet. Use Prepare official period.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Dates</th>
                    <th className="r">TWR</th>
                    <th className="r">Benchmark</th>
                    <th className="r">Active</th>
                    <th>Status</th>
                    <th>Prepared by</th>
                    <th>Locked by</th>
                  </tr>
                </thead>
                <tbody>
                  {p.data.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => router.push(`/ops/performance/${encodeURIComponent(r.id)}`)}>
                      <td>
                        <strong>{r.ref}</strong>
                        <span className="ops-sub">version {r.version}</span>
                      </td>
                      <td>
                        {formatDate(r.periodStart)} to {formatDate(r.periodEnd)}
                      </td>
                      <td className="r">{pct(r.twrPct)}</td>
                      <td className="r">{pct(r.benchmarkPct)}</td>
                      <td className="r">{pct(r.activePct)}</td>
                      <td>
                        <StatusBadge status={r.official ? 'Official' : r.status} />
                      </td>
                      <td>{r.makerName ?? '—'}</td>
                      <td>{r.checkerName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
    </Card>
  );
}

// ================================================================ benchmarks

interface Row {
  securityId: string;
  weightPct: string;
}

function BenchmarksTab({ canEdit, res }: { canEdit: boolean; res: ReturnType<typeof useResource<Benchmark[]>> }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Benchmark | null>(null);
  return (
    <Card
      title="Benchmark compositions"
      actions={
        canEdit ? (
          <button className="ops-btn" type="button" onClick={() => setCreating(true)}>
            New benchmark
          </button>
        ) : undefined
      }
    >
      <Loaded res={res} what="benchmarks">
        {(list) =>
          list.length === 0 ? (
            <Empty>No benchmarks yet.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Benchmark</th>
                    <th>Constituents</th>
                    <th className="r">Total weight</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.code}</strong>
                        <span className="ops-sub">{b.name}</span>
                      </td>
                      <td>{b.constituents.length === 0 ? <span className="ops-muted">Not set</span> : b.constituents.map((c) => `${c.ticker} ${Number(c.weightPct).toFixed(1)}%`).join(' · ')}</td>
                      <td className="r" style={{ color: Number(b.totalWeightPct) === 100 ? undefined : 'var(--ops-amber)' }}>
                        {Number(b.totalWeightPct).toFixed(2)}%
                      </td>
                      <td>
                        {canEdit && (
                          <button className="ops-btn small" type="button" onClick={() => setEditing(b)}>
                            Edit composition
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {creating && (
        <FormModal
          title="New benchmark"
          kicker="Performance"
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) => api.post(v1('/performance/benchmarks'), { code: str(fd, 'code'), name: str(fd, 'name') }, { idempotencyKey: key })}
          onDone={() => res.reload()}
        >
          <FieldGrid>
            <Field label="Code" hint="Letters, digits . _ -">
              <input className="ops-input" name="code" required maxLength={24} />
            </Field>
            <Field label="Name" hint="Match a portfolio's benchmark name to attach it automatically">
              <input className="ops-input" name="name" required maxLength={160} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {editing && <CompositionModal benchmark={editing} onClose={() => setEditing(null)} onDone={() => res.reload()} />}
    </Card>
  );
}

function CompositionModal({ benchmark, onClose, onDone }: { benchmark: Benchmark; onClose: () => void; onDone: () => void }) {
  const securities = useResource<SecurityRow[]>(() => api.get<SecurityRow[]>(v1('/securities?limit=200')), []);
  const [rows, setRows] = useState<Row[]>(benchmark.constituents.filter((c) => c.securityId).map((c) => ({ securityId: c.securityId!, weightPct: Number(c.weightPct).toString() })));
  const cash = benchmark.constituents.find((c) => !c.securityId);
  const [cashPct, setCashPct] = useState(cash ? Number(cash.weightPct).toString() : '');
  const total = rows.reduce((s, r) => s + (Number(r.weightPct) || 0), 0) + (Number(cashPct) || 0);
  const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <FormModal
      title={`Composition · ${benchmark.code}`}
      kicker="Performance"
      subtitle="Target weights by security, in percent, totalling exactly 100. Locked periods keep the composition they were prepared with."
      submitLabel="Save composition"
      wide
      disabled={Math.abs(total - 100) > 0.00005}
      onClose={onClose}
      onSubmit={(_fd, key) =>
        api.put(
          v1(`/performance/benchmarks/${encodeURIComponent(benchmark.id)}/constituents`),
          { constituents: [...rows.filter((r) => r.securityId && r.weightPct).map((r) => ({ securityId: r.securityId, weightPct: r.weightPct })), ...(Number(cashPct) > 0 ? [{ securityId: null, sector: 'Cash', weightPct: cashPct }] : [])] },
          { idempotencyKey: key },
        )
      }
      onDone={onDone}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px auto', gap: 8 }}>
            <select className="ops-input" value={r.securityId} onChange={(e) => set(i, { securityId: e.target.value })} aria-label="Security">
              <option value="">Choose a security</option>
              {securities.state === 'ok' &&
                securities.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.ticker} · {s.name}
                  </option>
                ))}
            </select>
            <input className="ops-input" inputMode="decimal" value={r.weightPct} onChange={(e) => set(i, { weightPct: e.target.value })} placeholder="Weight %" aria-label="Weight percent" />
            <button className="ops-btn small" type="button" onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <div>
          <button className="ops-btn small" type="button" onClick={() => setRows((all) => [...all, { securityId: '', weightPct: '' }])}>
            Add security
          </button>
        </div>
        <Field label="Cash sleeve weight %" hint="Optional; earns zero return in the benchmark">
          <input className="ops-input" inputMode="decimal" value={cashPct} onChange={(e) => setCashPct(e.target.value)} />
        </Field>
        <p style={{ color: Math.abs(total - 100) > 0.00005 ? 'var(--ops-amber)' : undefined }}>Total {total.toFixed(4)}%{Math.abs(total - 100) > 0.00005 ? ' (must be 100)' : ''}</p>
      </div>
    </FormModal>
  );
}
