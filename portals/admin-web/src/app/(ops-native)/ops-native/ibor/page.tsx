'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, apiRequest, describeError, qs, v1 } from '@/ops/api';
import {
  ageText,
  ALL_GROUPS,
  BUCKET_LABEL,
  COLUMN_GROUPS,
  EVENT_LABEL,
  money2,
  qty,
  signed,
  StateBadge,
  Tile,
  type IborEventRow,
  type IborLedger,
  type ColumnGroup,
  type IborOverview,
  type Ladder,
  type RefreshJob,
} from '@/ops/ibor';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import type { PortfolioSummary } from '@/ops/types';
import { Alert, Card, Empty, Field, formatDate, formatDateTime, Loaded, PageHeader, useAction, useResource } from '@/ops/ui';

const PAGE = 50;
const failing = (items: { title: string; ok: boolean }[]) => {
  const bad = items.filter((i) => !i.ok);
  return bad.length ? `${bad.length} check(s) need attention: ${bad.map((i) => i.title).join(' · ')}` : 'All controls clear';
};
const ASSET_CLASSES = ['Equity', 'Fixed income', 'Cash', 'Fund', 'Private'];
const JOB_LABEL: Record<RefreshJob['status'], string> = { QUEUED: 'Queued', RUNNING: 'Running', SUCCEEDED: 'Complete', FAILED: 'Failed' };
const ACTIVE_JOB = ['QUEUED', 'RUNNING'];
const SORTS = [
  ['ticker', 'Security (ticker)'],
  ['name', 'Security (name)'],
  ['portfolio', 'Portfolio'],
  ['assetClass', 'Asset class'],
  ['quantity', 'Quantity'],
] as const;

export default function IborPage() {
  const router = useRouter();
  const canView = useCan('portfolio.view');
  const canRefresh = useCan('portfolio.manage');
  const canReconcile = useCan('recon.manage');
  const [portfolioId, setPortfolioId] = useState('');
  const [asOf, setAsOf] = useState('');
  const [q, setQ] = useState('');
  const [assetClass, setAssetClass] = useState('');
  const [state, setState] = useState('');
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<'ledger' | 'events'>('ledger');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('ticker');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [groups, setGroups] = useState<ColumnGroup[]>(ALL_GROUPS);
  const [chooser, setChooser] = useState(false);
  const [viewNote, setViewNote] = useState('');
  const [job, setJob] = useState<RefreshJob | null>(null);
  const refresh = useAction();
  const reconcile = useAction();
  const shows = (g: ColumnGroup) => groups.includes(g);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('portfolioId')) setPortfolioId(sp.get('portfolioId')!);
  }, []);

  // FR-IBOR-007: the column groups this user chose last time; FR-IBOR-004: pick up a refresh that is still running.
  useEffect(() => {
    let alive = true;
    api
      .get<{ config: { groups?: ColumnGroup[] } }[]>(v1('/views?scope=ibor.columns'))
      .then((views) => {
        const g = views?.[0]?.config?.groups?.filter((x) => ALL_GROUPS.includes(x));
        if (alive && g?.length) setGroups(g);
      })
      .catch(() => undefined);
    api
      .get<RefreshJob[]>(v1('/ibor/refresh-jobs?limit=1'))
      .then((jobs) => alive && jobs?.[0] && ACTIVE_JOB.includes(jobs[0].status) && setJob(jobs[0]))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const saveGroups = async (next: ColumnGroup[]) => {
    if (!next.length) return;
    setGroups(next);
    try {
      await api.put(v1('/views'), { scope: 'ibor.columns', name: 'default', config: { groups: next }, isDefault: true });
      setViewNote('Saved for you');
    } catch (e) {
      setViewNote(`Not saved: ${describeError(e)}`);
    }
  };

  // Poll the refresh job until it is complete or failed.
  useEffect(() => {
    if (!job || !ACTIVE_JOB.includes(job.status)) return;
    const t = setTimeout(async () => {
      try {
        setJob(await api.get<RefreshJob>(v1(`/ibor/refresh-jobs/${job.id}`)));
      } catch (e) {
        setJob({ ...job, status: 'FAILED', error: describeError(e) });
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [job]);

  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  const overview = useResource<IborOverview>(() => api.get<IborOverview>(v1(`/ibor/overview${qs({ portfolioId, asOf })}`)), [portfolioId, asOf]);
  const ledger = useResource<IborLedger>(
    () => apiRequest<IborLedger>('GET', v1(`/ibor/ledger${qs({ portfolioId, asOf, q, assetClass, state, sort, dir, limit: String(PAGE), offset: String(offset) })}`)),
    [portfolioId, asOf, q, assetClass, state, sort, dir, offset],
  );
  const ladder = useResource<Ladder>(() => api.get<Ladder>(v1(`/ibor/settlement-ladder${qs({ portfolioId })}`)), [portfolioId]);
  const events = useResource<{ data: IborEventRow[]; total: number }>(() => apiRequest<{ data: IborEventRow[]; total: number }>('GET', v1(`/ibor/events${qs({ portfolioId, limit: '30' })}`)), [portfolioId]);
  const reloadAll = () => {
    overview.reload();
    ledger.reload();
    ladder.reload();
    events.reload();
  };

  const jobStatus = job?.status;
  const jobRef = job?.result?.ref;
  useEffect(() => {
    if (!job) return;
    if (job.status === 'SUCCEEDED' && job.result) {
      const r = job.result;
      setNotice({
        kind: r.exceptions.length ? 'warn' : 'ok',
        text: `${r.ref}: ${r.eventsIngested} event(s) ingested, ${r.lotsOpened} lot(s) opened, ${r.adjustments} adjustment(s)${r.exceptions.length ? `, ${r.exceptions.length} exception(s): ${r.exceptions.map((x) => `${x.ticker} ${x.issue}`).join('; ')}` : ''}.`,
      });
      reloadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus, jobRef]);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Positions" title="IBOR & Positions" />
        <Alert>Your role does not include positions. Ask an administrator for the portfolio.view permission.</Alert>
      </>
    );
  }
  const filter = (set: (v: string) => void) => (v: string) => {
    setOffset(0);
    set(v);
  };

  return (
    <>
      <PageHeader
        kicker="Investment book of record · positions · lots · exposures"
        title="IBOR & Positions"
        subtitle="Positions, tax lots, unsettled activity and available-to-trade, with the event lineage behind every change."
        actions={
          <>
            {(
              <button
                className="ops-btn"
                type="button"
                disabled={!canReconcile || !portfolioId || reconcile.busy}
                title={!canReconcile ? 'Needs the recon.manage permission' : portfolioId ? 'Runs the holdings reconciliation for this portfolio' : 'Pick a portfolio first'}
                onClick={async () => {
                  setNotice(null);
                  const r = await reconcile.run((key) => api.post<{ run: { ref: string; status: string; breaks: number } }>(v1('/ibor/reconcile'), { portfolioId }, { idempotencyKey: key }));
                  if (r) {
                    setNotice({ kind: r.run.breaks ? 'warn' : 'ok', text: `Holdings reconciliation ${r.run.ref}: ${r.run.status.toLowerCase().replace('_', ' ')}, ${r.run.breaks} break(s).` });
                    reloadAll();
                  }
                }}
              >
                {reconcile.busy ? 'Reconciling…' : 'Reconcile positions'}
              </button>
            )}
            {(
              <button
                className="ops-btn primary"
                type="button"
                disabled={!canRefresh || refresh.busy || (!!job && ACTIVE_JOB.includes(job.status))}
                title={canRefresh ? 'Queues a background job that books new fills into tax lots and records any drift against the position record' : 'Needs the portfolio.manage permission'}
                onClick={async () => {
                  setNotice(null);
                  const r = await refresh.run((key) => api.post<RefreshJob>(v1('/ibor/refresh'), portfolioId ? { portfolioId, async: true } : { async: true }, { idempotencyKey: key }));
                  if (r) setJob(r);
                }}
              >
                {job?.status === 'QUEUED' ? 'Queued…' : job?.status === 'RUNNING' || refresh.busy ? 'Refreshing…' : 'Refresh IBOR'}
              </button>
            )}
          </>
        }
      />
      {job && (
        <p role="status" aria-live="polite" data-testid="refresh-status" style={{ margin: '0 0 10px' }}>
          <span className={`ops-badge ${job.status === 'SUCCEEDED' ? 'green' : job.status === 'FAILED' ? 'red' : 'amber'}`}>Refresh: {(JOB_LABEL[job.status] ?? job.status).toLowerCase()}</span>
          {job.status === 'SUCCEEDED' && job.durationMs !== null && <span className="ops-muted"> in {job.durationMs} ms</span>}
          {job.status === 'FAILED' && <span className="ops-muted"> {job.error ?? ''}</span>}
        </p>
      )}
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      <Alert>{refresh.error || reconcile.error}</Alert>

      <Card>
        <div className="ops-filters">
          <Field label="Portfolio">
            <select className="ops-input" value={portfolioId} onChange={(e) => filter(setPortfolioId)(e.target.value)}>
              <option value="">All portfolios</option>
              {portfolios.state === 'ok' &&
                portfolios.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.ref})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="As of" hint="Historical snapshot; blank is now">
            <input className="ops-input" type="date" value={asOf} max={new Date().toISOString().slice(0, 10)} onChange={(e) => filter(setAsOf)(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Loaded res={overview} what="the book overview">
        {(o) => (
          <>
            <div className="ops-tiles">
              <Tile label="As of" value={formatDate(o.asOf)} hint="Position snapshot date" />
              <Tile label="Book state" value={o.control.bookState} tone={o.control.bookState === 'Current' ? undefined : 'warn'} hint={failing(o.health.items)} />
              <Tile label="Last event" value={o.control.lastEvent ? `${EVENT_LABEL[o.control.lastEvent.type] ?? o.control.lastEvent.type} · ${o.control.lastEvent.ref}` : 'None yet'} hint={o.control.lastEvent ? formatDateTime(o.control.lastEvent.at) : 'Refresh IBOR to start the lineage'} onClick={() => setTab('events')} />
              <Tile label="Last refresh" value={ageText(o.control.refreshAgeSeconds)} hint={o.control.lastRefresh ? `${o.control.lastRefresh.ref} · ${o.control.lastRefresh.durationMs} ms` : canRefresh ? 'Use Refresh IBOR to book new fills' : 'Refresh IBOR needs portfolio.manage'} />
            </div>
            <div className="ops-tiles">
              <Tile label="Market value" tone={o.kpis.fxMissing?.length ? 'warn' : undefined} value={`${o.kpis.currency} ${money2(o.kpis.marketValueBase)}`} hint={o.kpis.fxMissing?.length ? `Incomplete: no FX rate for ${o.kpis.fxMissing.join(', ')}; those amounts are excluded` : `Every position converted to ${o.kpis.currency}`} />
              <Tile label="Positions" value={String(o.kpis.positions)} hint={`${o.kpis.portfolios} portfolio(s)`} />
              <Tile label="Available cash" value={`${o.kpis.currency} ${money2(o.kpis.availableCash)}`} hint="After reservations" />
              <Tile label="Unsettled buys" value={`${o.kpis.currency} ${money2(o.kpis.unsettledBuys)}`} hint={`${o.kpis.unsettledBuyCount} live fill(s)`} />
              <Tile label="Accrued income" value={`${o.kpis.currency} ${money2(o.kpis.accruedIncome)}`} hint="Confirmed dividends not yet paid" />
              <Tile label="Exceptions" value={String(o.kpis.exceptions)} tone={o.kpis.exceptions ? 'warn' : undefined} hint={`${o.kpis.materialExceptions} material position exception(s)${o.health.items.some((i) => !i.ok) ? ` · plus ${o.health.items.filter((i) => !i.ok).length} failing book check(s)` : ''}`} onClick={() => filter(setState)('Review')} />
            </div>
          </>
        )}
      </Loaded>

      <TabBar
        tabs={[
          { key: 'ledger', label: 'Position ledger' },
          { key: 'events', label: 'Book events & lineage' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'ledger' && (
        <>
          <Card title="Position ledger">
            <div className="ops-filters">
              <Field label="Search">
                <input className="ops-input" value={q} placeholder="Ticker, ISIN, name, portfolio" onChange={(e) => filter(setQ)(e.target.value)} />
              </Field>
              <Field label="Asset class">
                <select className="ops-input" value={assetClass} onChange={(e) => filter(setAssetClass)(e.target.value)}>
                  <option value="">All</option>
                  {ASSET_CLASSES.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>
              <Field label="Data state">
                <select className="ops-input" value={state} onChange={(e) => filter(setState)(e.target.value)}>
                  <option value="">All</option>
                  <option>Current</option>
                  <option>Review</option>
                </select>
              </Field>
              <Field label="Sort by">
                <select className="ops-input" value={sort} onChange={(e) => filter((v) => setSort(v as typeof sort))(e.target.value)}>
                  {SORTS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Order">
                <select className="ops-input" value={dir} onChange={(e) => filter((v) => setDir(v as 'asc' | 'desc'))(e.target.value)}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </Field>
              <div className="ops-field">
                <span className="ops-label">Columns</span>
                <button className="ops-btn" type="button" aria-expanded={chooser} onClick={() => setChooser(!chooser)}>
                  Choose columns ({groups.length} of {ALL_GROUPS.length} groups)
                </button>
              </div>
            </div>
            {chooser && (
              <fieldset className="ops-card" style={{ margin: '8px 0 12px', padding: 12 }}>
                <legend>Column groups shown in the ledger</legend>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {COLUMN_GROUPS.map((g) => (
                    <label key={g.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }} title={g.hint}>
                      <input
                        type="checkbox"
                        checked={shows(g.key)}
                        disabled={shows(g.key) && groups.length === 1}
                        onChange={(e) => saveGroups(e.target.checked ? ALL_GROUPS.filter((x) => x === g.key || shows(x)) : groups.filter((x) => x !== g.key))}
                      />
                      {g.label}
                    </label>
                  ))}
                </div>
                <p className="ops-muted" role="status" style={{ margin: '8px 0 0' }}>
                  {viewNote || 'Your choice is saved to your profile and restored next time. Security, portfolio and asset class always show.'}
                </p>
              </fieldset>
            )}
            <Loaded res={ledger} what="positions">
              {(l) =>
                l.data.length === 0 ? (
                  <Empty>No positions match these filters.</Empty>
                ) : (
                  <>
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>Security</th>
                            <th>Portfolio</th>
                            <th>Asset class</th>
                            {shows('position') && <th className="r">Quantity</th>}
                            {shows('settlement') && <th className="r">Settled</th>}
                            {shows('settlement') && <th className="r">Unsettled</th>}
                            {shows('valuation') && <th className="r">Local MV</th>}
                            {shows('valuation') && <th className="r">Base MV</th>}
                            {shows('cost') && <th className="r">Cost</th>}
                            {shows('cost') && <th className="r">Accrued</th>}
                            {shows('availability') && <th className="r">Available</th>}
                            {shows('control') && <th>State</th>}
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {l.data.map((r) => (
                            <tr key={`${r.portfolioId}-${r.securityId}`}>
                              <td>
                                <strong>{r.ticker}</strong>
                                <span className="ops-sub">{r.name}</span>
                              </td>
                              <td>{r.portfolioName}</td>
                              <td>{r.assetClass}</td>
                              {shows('position') && <td className="r">{qty(r.quantity)}</td>}
                              {shows('settlement') && <td className="r">{qty(r.settled)}</td>}
                              {shows('settlement') && <td className="r">{signed(r.unsettled)}</td>}
                              {shows('valuation') && (
                                <td className="r">
                                  {r.marketValueLocal ? money2(r.marketValueLocal) : '—'}
                                  <span className="ops-sub">{r.currency}</span>
                                </td>
                              )}
                              {shows('valuation') && (
                                <td className="r">
                                  {r.marketValueBase ? money2(r.marketValueBase) : '—'}
                                  <span className="ops-sub">{r.baseCurrency}</span>
                                </td>
                              )}
                              {shows('cost') && <td className="r">{r.costBase ? money2(r.costBase) : '—'}</td>}
                              {shows('cost') && <td className="r">{r.accrued ? money2(r.accrued) : '—'}</td>}
                              {shows('availability') && <td className="r">{r.restricted ? 'Restricted' : qty(r.available)}</td>}
                              {shows('control') && (
                                <td>
                                  <StateBadge state={r.state} reasons={r.reasons} />
                                </td>
                              )}
                              <td>
                                <button className="ops-btn small" type="button" onClick={() => router.push(`/ops-native/ibor/position${qs({ portfolioId: r.portfolioId, securityId: r.securityId, asOf })}`)}>
                                  Open
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="ops-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                      <span className="ops-muted">{`${offset + 1}–${Math.min(offset + PAGE, l.total)} of ${l.total} position(s)`}</span>
                      <span>
                        <button className="ops-btn small" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                          Previous
                        </button>{' '}
                        <button className="ops-btn small" type="button" disabled={offset + PAGE >= l.total} onClick={() => setOffset(offset + PAGE)}>
                          Next
                        </button>
                      </span>
                    </div>
                  </>
                )
              }
            </Loaded>
          </Card>

          <div className="ops-grid" style={{ alignItems: 'start' }}>
            <Card title="Position & cash ladder" actions={<Link href="/ops-native/cash">Open cash →</Link>}>
              <Loaded res={ladder} what="the settlement ladder">
                {(lad) => (
                  <>
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>Bucket</th>
                            <th className="r">Net amount</th>
                            <th>Flows</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lad.buckets.map((b) => (
                            <tr key={b.bucket}>
                              <td>
                                <strong>{BUCKET_LABEL[b.bucket]}</strong>
                              </td>
                              <td className="r">
                                {b.flows.length === 0
                                  ? '—'
                                  : b.flows.map((f) => (
                                      <div key={f.currency} style={{ color: Number(f.netCash) < 0 ? 'var(--ops-amber)' : undefined }}>
                                        {f.currency} {signed(f.netCash)}
                                        <span className="ops-sub">{money2(f.netCash)}</span>
                                      </div>
                                    ))}
                              </td>
                              <td>{b.flows.length === 0 ? <span className="ops-muted">Nothing settling</span> : b.flows.map((f) => `${f.buys} buy / ${f.sells} sell`).join('; ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {lad.items.length > 0 && (
                      <details style={{ marginTop: 10 }}>
                        <summary>{lad.items.length} unsettled fill(s)</summary>
                        <div className="ops-table-wrap">
                          <table className="ops-table">
                            <thead>
                              <tr>
                                <th>Order</th>
                                <th>Security</th>
                                <th>Side</th>
                                <th className="r">Quantity</th>
                                <th className="r">Net cash</th>
                                <th>Settles</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lad.items.map((i) => (
                                <tr key={i.fillId}>
                                  <td>
                                    <Link href={`/ops-native/orders/${encodeURIComponent(i.orderId)}`}>{i.orderRef}</Link>
                                  </td>
                                  <td>{i.ticker}</td>
                                  <td>{i.side}</td>
                                  <td className="r">{qty(i.quantity)}</td>
                                  <td className="r">
                                    {money2(i.netCash)} {i.currency}
                                  </td>
                                  <td>{formatDate(i.settlesOn)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </>
                )}
              </Loaded>
            </Card>

            <Card title="Authoritative-data controls" actions={<Link href="/ops-native/reconciliation">Reconciliation evidence →</Link>}>
              <Loaded res={overview} what="book health">
                {(o) => (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                    {o.health.items.map((h) => (
                      <li key={h.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span className={`ops-badge ${h.ok ? 'green' : 'amber'}`}>{h.ok ? 'Pass' : 'Check'}</span>
                        <span>
                          <strong>{h.title}</strong>
                          <span className="ops-sub">{h.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Loaded>
            </Card>
          </div>
        </>
      )}

      {tab === 'events' && (
        <Card title="Book events & lineage">
          <Loaded res={events} what="book events">
            {(e) =>
              e.data.length === 0 ? (
                <Empty>No book events yet. Use Refresh IBOR to build lots and the lineage from the position record.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Type</th>
                        <th>Portfolio</th>
                        <th>Security</th>
                        <th className="r">Quantity</th>
                        <th>Effective</th>
                        <th>Summary</th>
                        <th>Recorded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.data.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.ref}</strong>
                          </td>
                          <td>{EVENT_LABEL[r.type] ?? r.type}</td>
                          <td>{r.portfolioName}</td>
                          <td>{r.ticker ?? '—'}</td>
                          <td className="r">{signed(r.quantityDelta)}</td>
                          <td>{formatDate(r.effectiveDate)}</td>
                          <td>{r.summary}</td>
                          <td>{formatDateTime(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loaded>
        </Card>
      )}
    </>
  );
}
