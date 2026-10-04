'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, apiDownload, qs, v1 } from '@/ops/api';
import { ImportPanel } from '@/ops/imports';
import { AccessDenied, DataTable, label, m2, PortfolioSelect, ReasonModal, Tag, Tile, today, usePortfolios } from '@/ops/rp';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

const P = (p: string) => v1(`/private-markets${p}`);
const STRATEGIES = ['PRIVATE_EQUITY', 'VENTURE', 'REAL_ASSETS', 'PRIVATE_CREDIT', 'INFRASTRUCTURE', 'OTHER'];
const METHODS = ['GP_REPORTED', 'DCF', 'COMPARABLES', 'COST', 'ADJUSTED'];
const EVIDENCE = ['GP_STATEMENT', 'VALUATION_REPORT', 'AUDITED_FS', 'TRANSACTION', 'OTHER'];

interface Perf {
  committed: string;
  paidIn: string;
  calledUnpaid: string;
  unfunded: string;
  distributed: string;
  nav: string | null;
  navAsOf: string | null;
  dpi: string | null;
  rvpi: string | null;
  tvpi: string | null;
  irrPct: string | null;
}
interface Posting {
  accountingJournal: string | null;
  accountingJournalId: string | null;
  cashJournal: string | null;
  cashJournalId: string | null;
  skipped: string | null;
  fxRate: string;
  baseCurrency: string;
  baseAmount: string | null;
  carryingDelta: string | null;
}
interface Commitment extends Perf {
  carryingValue?: string | null;
  id: string;
  ref: string;
  fundId: string;
  fundRef: string | null;
  fundName: string | null;
  manager: string | null;
  strategy: string | null;
  vintage: number | null;
  currency: string | null;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  committedOn: string;
  status: string;
  markStale: boolean;
  cashflows?: Cashflow[];
  marks?: Mark[];
}
interface Cashflow {
  id: string;
  ref: string;
  kind: string;
  amount: string;
  returnOfCapital?: string | null;
  posting?: Posting | null;
  noticeDate: string;
  dueDate: string;
  paidOn: string | null;
  status: string;
  overdue: boolean;
  note: string | null;
  commitmentRef?: string | null;
  fundName?: string | null;
  portfolioRef?: string | null;
}
interface Mark {
  id: string;
  ref: string;
  commitmentId: string;
  commitmentRef: string | null;
  fundName: string | null;
  asOf: string;
  nav: string;
  method: string;
  status: string;
  note: string | null;
  makerId: string;
  makerName: string | null;
  approverName: string | null;
  rejectReason: string | null;
  posting?: Posting | null;
  evidence: { id: string; kind: string; title: string; reference: string | null; documentId: string | null; documentRef: string | null; addedByName: string | null }[];
}
interface Fund {
  id: string;
  ref: string;
  name: string;
  manager: string;
  strategy: string;
  vintage: number;
  currency: string;
  status: string;
  commitments: number;
  committed: string | null;
  totals?: Perf;
  totalsCurrency?: string;
  commitmentList?: Commitment[];
}
interface CurvePoint {
  date: string;
  calls: string;
  distributions: string;
  netCash: string;
  nav: string | null;
  netValue: string | null;
}
interface ClientExposure extends Perf {
  clientId: string;
  clientRef: string;
  clientName: string;
  commitments: number;
  currency: string;
  fxMissing: string[];
  lines?: Commitment[];
}
interface Summary {
  totals: Perf;
  reportCurrency: string;
  fxMissing: string[];
  commitments: Commitment[];
  pendingMarks: number;
  staleMarks: number;
  byStrategy: { strategy: string; nav: string; committed: string }[];
  upcomingCashflows: Cashflow[];
}

type Tab = 'overview' | 'funds' | 'marks' | 'clients' | 'lookthrough' | 'import';
const xr = (v: string | null) => (v === null ? '—' : `${v}x`);
const irr = (v: string | null) => (v === null ? '—' : `${v}%`);

export default function PrivateMarketsPage() {
  const canView = useCan('portfolio.view');
  const [tab, setTab] = useState<Tab>('overview');
  const [portfolioId, setPortfolioId] = useState('');
  const [open, setOpen] = useState<{ kind: 'commitment' | 'fund' | 'mark'; id: string } | null>(null);
  const portfolios = usePortfolios();
  const summary = useResource<Summary>(() => api.get<Summary>(P(`/summary${qs({ portfolioId })}`)), [portfolioId]);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('commitment')) setOpen({ kind: 'commitment', id: sp.get('commitment')! });
    else if (sp.get('mark')) {
      setTab('marks');
      setOpen({ kind: 'mark', id: sp.get('mark')! });
    }
  }, []);

  if (!canView) return <AccessDenied kicker="Portfolio" title="Private Markets" perm="portfolio.view" />;
  return (
    <>
      <PageHeader
        kicker="Portfolio"
        title="Private Markets"
        subtitle="Private funds, commitments, capital calls and distributions, and NAV marks that need evidence and a second approver. IRR, TVPI, DPI and RVPI are derived from settled cashflows and the latest approved mark."
        actions={<Link className="ops-btn" href="/ops/reporting">Company reporting packs</Link>}
      />
      <Card>
        <div className="ops-filters">
          <Field label="Portfolio">
            <PortfolioSelect list={portfolios} value={portfolioId} onChange={setPortfolioId} all="All portfolios" />
          </Field>
        </div>
      </Card>
      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['overview', 'funds', 'marks', 'clients', 'lookthrough', 'import'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`ops-btn${tab === t ? ' primary' : ''}`} type="button" onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : t === 'funds' ? 'Funds' : t === 'marks' ? 'NAV marks' : t === 'clients' ? 'By client' : t === 'lookthrough' ? 'Look-through' : 'Import'}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview summary={summary} portfolioId={portfolioId} onOpen={(id) => setOpen({ kind: 'commitment', id })} />}
      {tab === 'clients' && <ClientsTab onOpen={(id) => setOpen({ kind: 'commitment', id })} />}
      {tab === 'funds' && <FundsTab onOpen={(id) => setOpen({ kind: 'fund', id })} portfolios={portfolios} onChanged={summary.reload} />}
      {tab === 'marks' && <MarksTab onOpen={(id) => setOpen({ kind: 'mark', id })} />}
      {tab === 'lookthrough' && <LookThroughTab portfolioId={portfolioId} />}
      {tab === 'import' && <ImportPanel only={['pm-funds', 'pm-commitments', 'pm-valuations']} onCommitted={summary.reload} />}
      {open?.kind === 'commitment' && <CommitmentModal id={open.id} onClose={() => setOpen(null)} onChanged={summary.reload} onOpenMark={(id) => setOpen({ kind: 'mark', id })} />}
      {open?.kind === 'fund' && <FundModal id={open.id} portfolios={portfolios} onClose={() => setOpen(null)} onChanged={summary.reload} onOpenCommitment={(id) => setOpen({ kind: 'commitment', id })} />}
      {open?.kind === 'mark' && <MarkModal id={open.id} onClose={() => setOpen(null)} onChanged={summary.reload} />}
    </>
  );
}

interface LookThrough {
  reportCurrency: string;
  totalNavReport: string;
  fxMissing: string[];
  rows: { commitmentRef: string; fundRef: string; fundName: string; manager: string | null; strategy: string | null; vintage: number | null; portfolioRef: string | null; currency: string; nav: string | null; navAsOf: string | null; markStale: boolean; unfunded: string | null; navReport: string | null; unfundedReport: string | null; exposureReport: string | null; pctOfNav: string | null }[];
}

/** Underlying exposures behind the private book (FR-PM-003), with the same rows available as CSV or XLSX. */
function LookThroughTab({ portfolioId }: { portfolioId: string }) {
  const res = useResource<LookThrough>(() => api.get<LookThrough>(P(`/lookthrough${qs({ portfolioId })}`)), [portfolioId]);
  const [error, setError] = useState<string | null>(null);
  const download = (format: 'csv' | 'xlsx') => void apiDownload(P(`/lookthrough/export${qs({ portfolioId, format })}`), `private-lookthrough.${format}`).then(() => setError(null), (e: Error) => setError(e.message));
  return (
    <Card title="Look-through" actions={<span className="ops-actions"><button className="ops-btn" type="button" onClick={() => download('csv')}>Export CSV</button><button className="ops-btn" type="button" onClick={() => download('xlsx')}>Export XLSX</button></span>}>
      <Alert>{error}</Alert>
      <Loaded res={res} what="the look-through">
        {(lt) => (
          <>
            <p className="ops-muted" style={{ marginTop: 0 }}>Total private NAV {m2(lt.totalNavReport)} {lt.reportCurrency}.</p>
            {lt.fxMissing.length > 0 && <Alert kind="warn">No FX rate to {lt.reportCurrency} for {lt.fxMissing.join(', ')}; those lines show no converted figures and are left out of the total.</Alert>}
            {lt.rows.length === 0 ? (
              <Empty>No active commitments.</Empty>
            ) : (
              <DataTable head={['Commitment', 'Fund', 'Manager', 'Strategy', 'Vintage', 'Ccy', 'NAV', 'Unfunded', `NAV ${lt.reportCurrency}`, `Exposure ${lt.reportCurrency}`, '% of NAV']}>
                {lt.rows.map((r) => (
                  <tr key={r.commitmentRef}>
                    <td>{r.commitmentRef}</td>
                    <td>{r.fundName}<span className="ops-sub">{r.fundRef}</span></td>
                    <td>{r.manager ?? ''}</td>
                    <td>{r.strategy ?? ''}</td>
                    <td>{r.vintage ?? ''}</td>
                    <td>{r.currency}</td>
                    <td className="r">{r.nav ? m2(r.nav) : '—'}{r.markStale && <span className="ops-sub">mark is stale</span>}</td>
                    <td className="r">{r.unfunded ? m2(r.unfunded) : '—'}</td>
                    <td className="r">{r.navReport ? m2(r.navReport) : '—'}</td>
                    <td className="r">{r.exposureReport ? m2(r.exposureReport) : '—'}</td>
                    <td className="r">{r.pctOfNav ?? '—'}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}

function Overview({ summary, portfolioId, onOpen }: { summary: ReturnType<typeof useResource<Summary>>; portfolioId: string; onOpen: (id: string) => void }) {
  return (
    <Loaded res={summary} what="private markets">
      {(s) => (
        <>
          {s.fxMissing.length > 0 && <Alert kind="warn">No FX rate to {s.reportCurrency} for {s.fxMissing.join(', ')}: those funds are left out of the pooled totals below. Add the rate under Portfolio FX rates.</Alert>}
          <p className="ops-muted" style={{ margin: '0 0 8px' }}>Pooled totals are in {s.reportCurrency}; each fund is converted at its latest rate.</p>
          <div className="ops-tiles">
            <Tile label="Committed" value={m2(s.totals.committed)} hint={`${m2(s.totals.unfunded)} unfunded`} />
            <Tile label="NAV" value={m2(s.totals.nav)} hint={(s.totals.navAsOf ? `Latest approved mark ${formatDate(s.totals.navAsOf)}` : 'No approved marks') + (s.pendingMarks ? ` · ${s.pendingMarks} newer mark(s) awaiting approval` : '')} />
            <Tile label="TVPI / DPI" value={`${xr(s.totals.tvpi)} / ${xr(s.totals.dpi)}`} hint={`RVPI ${xr(s.totals.rvpi)}`} />
            <Tile label="IRR" value={irr(s.totals.irrPct)} hint={`Paid-in ${m2(s.totals.paidIn)} · distributed ${m2(s.totals.distributed)}`} />
            <Tile label="Marks awaiting approval" value={String(s.pendingMarks)} hint={`${s.staleMarks} commitment(s) with a stale or missing mark`} />
          </div>
          <JCurveCard portfolioId={portfolioId} />
          <Card title="Commitments">
            {s.commitments.length === 0 ? (
              <Empty>No active commitments. Add a fund and a commitment under Funds.</Empty>
            ) : (
              <DataTable head={['Commitment', 'Fund', 'Portfolio', 'Committed', 'Paid-in', 'NAV', 'DPI', 'TVPI', 'IRR', 'Mark']}>
                {s.commitments.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => onOpen(c.id)}>
                    <td><strong>{c.ref}</strong></td>
                    <td>{c.fundName}<div className="ops-muted">{label(c.strategy)} · {c.vintage}</div></td>
                    <td>{c.portfolioName}</td>
                    <td className="r">{m2(c.committed)}</td>
                    <td className="r">{m2(c.paidIn)}</td>
                    <td className="r">{m2(c.nav)}</td>
                    <td className="r">{xr(c.dpi)}</td>
                    <td className="r">{xr(c.tvpi)}</td>
                    <td className="r">{irr(c.irrPct)}</td>
                    <td>{c.markStale ? <Tag value="Stale" tone="amber" /> : <Tag value="Current" tone="green" />}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
          <Card title="Upcoming capital calls and distributions (90 days)">
            {s.upcomingCashflows.length === 0 ? (
              <Empty>Nothing is noticed for the next 90 days.</Empty>
            ) : (
              <DataTable head={['Notice', 'Fund', 'Portfolio', 'Kind', 'Amount', 'Due', 'State']}>
                {s.upcomingCashflows.map((f) => (
                  <tr key={f.id}>
                    <td>{f.ref}</td>
                    <td>{f.fundName}</td>
                    <td>{f.portfolioRef}</td>
                    <td><Tag value={f.kind} tone={f.kind === 'CALL' ? 'amber' : 'green'} /></td>
                    <td className="r">{m2(f.amount)}</td>
                    <td>{formatDate(f.dueDate)}</td>
                    <td>{f.overdue ? <Tag value="Overdue" tone="red" /> : <Tag value={f.status} />}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
        </>
      )}
    </Loaded>
  );
}

// ================================================================ J-curve and clients

function JCurveCard({ portfolioId }: { portfolioId: string }) {
  const res = useResource<{ currency: string; fxMissing: string[]; points: CurvePoint[] }>(() => api.get(P(`/jcurve${qs({ portfolioId })}`)), [portfolioId]);
  return (
    <Card title="J-curve: net cash and net value over time">
      <Loaded res={res} what="the J-curve">
        {(d) => {
          if (d.points.length < 2) return <Empty>Not enough settled cashflows yet to draw a curve.</Empty>;
          const W = 640;
          const H = 180;
          const pad = 28;
          const vals = d.points.flatMap((p) => [Number(p.netCash), p.netValue === null ? Number(p.netCash) : Number(p.netValue)]);
          const lo = Math.min(0, ...vals);
          const hi = Math.max(0, ...vals);
          const t0 = new Date(d.points[0]!.date).getTime();
          const t1 = new Date(d.points[d.points.length - 1]!.date).getTime();
          const x = (date: string) => pad + ((new Date(date).getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
          const y = (v: number) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - pad * 2);
          const line = (f: (p: CurvePoint) => number | null) => d.points.filter((p) => f(p) !== null).map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(f(p)!).toFixed(1)}`).join(' ');
          return (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="J-curve" style={{ width: '100%', maxWidth: W, height: 'auto' }}>
                <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 3" />
                <path d={line((p) => Number(p.netCash))} fill="none" stroke="#b3261e" strokeWidth={2} />
                <path d={line((p) => (p.netValue === null ? null : Number(p.netValue)))} fill="none" stroke="#0f7a45" strokeWidth={2} />
                <text x={pad} y={14} fontSize={11} fill="currentColor">{d.currency} {m2(String(hi))}</text>
                <text x={pad} y={H - 6} fontSize={11} fill="currentColor">{d.currency} {m2(String(lo))}</text>
                <text x={W - pad} y={H - 6} fontSize={11} textAnchor="end" fill="currentColor">{formatDate(d.points[d.points.length - 1]!.date)}</text>
              </svg>
              <p className="ops-muted">
                <span style={{ color: '#b3261e' }}>Net cash</span> (distributions less calls) dips while capital is drawn; <span style={{ color: '#0f7a45' }}>net value</span> adds the latest approved NAV once marks exist. Pooled in {d.currency}.
                {d.fxMissing.length > 0 && ` Excluded, no FX rate: ${d.fxMissing.join(', ')}.`}
              </p>
            </>
          );
        }}
      </Loaded>
    </Card>
  );
}

function ClientsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [open, setOpen] = useState('');
  const res = useResource<ClientExposure[]>(() => api.get<ClientExposure[]>(P(`/clients${qs({ clientId: open })}`)), [open]);
  return (
    <Card title="Private-market exposure by client" actions={open ? <button className="ops-btn" type="button" onClick={() => setOpen('')}>All clients</button> : undefined}>
      <Loaded res={res} what="client exposure">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No client has an active private-market commitment through a portfolio.</Empty>
          ) : (
            <>
              <DataTable head={['Client', 'Commitments', 'Committed', 'Paid-in', 'Distributed', 'NAV', 'TVPI', 'IRR']}>
                {rows.map((c) => (
                  <tr key={c.clientId} className="clickable" onClick={() => setOpen(c.clientId)}>
                    <td><strong>{c.clientName}</strong><div className="ops-muted">{c.clientRef}</div></td>
                    <td className="r">{c.commitments}</td>
                    <td className="r">{c.currency} {m2(c.committed)}</td>
                    <td className="r">{m2(c.paidIn)}</td>
                    <td className="r">{m2(c.distributed)}</td>
                    <td className="r">{m2(c.nav)}</td>
                    <td className="r">{xr(c.tvpi)}</td>
                    <td className="r">{irr(c.irrPct)}</td>
                  </tr>
                ))}
              </DataTable>
              {open && rows[0]?.lines && (
                <>
                  <h4>Commitments</h4>
                  <DataTable head={['Commitment', 'Fund', 'Portfolio', 'Committed', 'Paid-in', 'NAV']}>
                    {rows[0].lines.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => onOpen(c.id)}>
                        <td>{c.ref}</td>
                        <td>{c.fundName}</td>
                        <td>{c.portfolioName}</td>
                        <td className="r">{c.currency} {m2(c.committed)}</td>
                        <td className="r">{m2(c.paidIn)}</td>
                        <td className="r">{m2(c.nav)}</td>
                      </tr>
                    ))}
                  </DataTable>
                </>
              )}
            </>
          )
        }
      </Loaded>
    </Card>
  );
}

// ================================================================ funds

function FundsTab({ onOpen, portfolios, onChanged }: { onOpen: (id: string) => void; portfolios: ReturnType<typeof usePortfolios>; onChanged: () => void }) {
  const canManage = useCan('portfolio.manage');
  const [creating, setCreating] = useState(false);
  const res = useResource<Fund[]>(() => api.get<Fund[]>(P('/funds')), []);
  void portfolios;
  return (
    <Card title="Private funds" actions={canManage && <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>New fund</button>}>
      <Loaded res={res} what="funds">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No private funds yet.</Empty>
          ) : (
            <DataTable head={['Fund', 'Manager', 'Strategy', 'Vintage', 'Commitments', 'Committed', 'Status']}>
              {rows.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => onOpen(f.id)}>
                  <td><strong>{f.ref}</strong><div className="ops-muted">{f.name}</div></td>
                  <td>{f.manager}</td>
                  <td>{label(f.strategy)}</td>
                  <td>{f.vintage}</td>
                  <td className="r">{f.commitments}</td>
                  <td className="r">{f.currency} {m2(f.committed)}</td>
                  <td><Tag value={f.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {creating && (
        <FormModal title="New private fund" submitLabel="Create fund" onClose={() => setCreating(false)} onSubmit={(fd, k) => api.post(P('/funds'), { name: str(fd, 'name'), manager: str(fd, 'manager'), strategy: str(fd, 'strategy'), vintage: Number(str(fd, 'vintage')), currency: str(fd, 'currency') || 'USD', notes: optStr(fd, 'notes') }, { idempotencyKey: k })} onDone={() => { res.reload(); onChanged(); }}>
          <FieldGrid>
            <Field label="Name"><input className="ops-input" name="name" required minLength={2} /></Field>
            <Field label="Manager (GP)"><input className="ops-input" name="manager" required minLength={2} /></Field>
            <Field label="Strategy"><select className="ops-input" name="strategy">{STRATEGIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
            <Field label="Vintage"><input className="ops-input" name="vintage" type="number" min={1990} max={2100} defaultValue={new Date().getFullYear()} required /></Field>
            <Field label="Currency"><input className="ops-input" name="currency" defaultValue="USD" maxLength={3} /></Field>
            <Field label="Notes"><input className="ops-input" name="notes" maxLength={500} /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function FundModal({ id, portfolios, onClose, onChanged, onOpenCommitment }: { id: string; portfolios: ReturnType<typeof usePortfolios>; onClose: () => void; onChanged: () => void; onOpenCommitment: (id: string) => void }) {
  const canManage = useCan('portfolio.manage');
  const res = useResource<Fund>(() => api.get<Fund>(P(`/funds/${encodeURIComponent(id)}`)), [id]);
  const [adding, setAdding] = useState(false);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Private fund" kicker="Private Markets" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this fund">
          {(f) => (
            <>
              <h3 style={{ marginTop: 0 }}>{f.ref} · {f.name} <Tag value={f.status} /></h3>
              <p className="ops-muted">{f.manager} · {label(f.strategy)} · vintage {f.vintage} · {f.currency}</p>
              {f.totals && (
                <dl className="ops-dl">
                  <div><dt>Committed</dt><dd>{m2(f.totals.committed)}</dd></div>
                  <div><dt>Paid-in</dt><dd>{m2(f.totals.paidIn)}</dd></div>
                  <div><dt>Distributed</dt><dd>{m2(f.totals.distributed)}</dd></div>
                  <div><dt>NAV</dt><dd>{m2(f.totals.nav)}</dd></div>
                  <div><dt>TVPI</dt><dd>{xr(f.totals.tvpi)}</dd></div>
                  <div><dt>DPI</dt><dd>{xr(f.totals.dpi)}</dd></div>
                  <div><dt>IRR</dt><dd>{irr(f.totals.irrPct)}</dd></div>
                </dl>
              )}
              <h4>Commitments</h4>
              {f.commitmentList && f.commitmentList.length ? (
                <DataTable head={['Commitment', 'Portfolio', 'Committed', 'Paid-in', 'NAV', 'Status']}>
                  {f.commitmentList.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => onOpenCommitment(c.id)}>
                      <td>{c.ref}</td>
                      <td>{c.portfolioName}</td>
                      <td className="r">{m2(c.committed)}</td>
                      <td className="r">{m2(c.paidIn)}</td>
                      <td className="r">{m2(c.nav)}</td>
                      <td><Tag value={c.status} /></td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <p className="ops-muted">No commitments yet.</p>
              )}
              {canManage && f.status === 'ACTIVE' && (
                <div className="ops-actions" style={{ marginTop: 14 }}>
                  <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>Add commitment</button>
                </div>
              )}
              {adding && (
                <FormModal title="Add commitment" submitLabel="Commit" onClose={() => setAdding(false)} onSubmit={(fd, k) => api.post(P(`/funds/${f.id}/commitments`), { portfolioId: str(fd, 'portfolioId'), amount: str(fd, 'amount').replace(/,/g, ''), committedOn: str(fd, 'committedOn') }, { idempotencyKey: k })} onDone={done}>
                  <FieldGrid>
                    <Field label="Portfolio"><PortfolioSelect name="portfolioId" list={portfolios} /></Field>
                    <Field label="Commitment"><input className="ops-input" name="amount" inputMode="decimal" required /></Field>
                    <Field label="Committed on"><input className="ops-input" name="committedOn" type="date" defaultValue={today()} required /></Field>
                  </FieldGrid>
                </FormModal>
              )}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

// ================================================================ commitment

function CommitmentModal({ id, onClose, onChanged, onOpenMark }: { id: string; onClose: () => void; onChanged: () => void; onOpenMark: (id: string) => void }) {
  const canManage = useCan('portfolio.manage');
  const res = useResource<Commitment>(() => api.get<Commitment>(P(`/commitments/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'flow' | 'mark' | { cancel: string }>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Commitment" kicker="Private Markets" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this commitment">
          {(c) => (
            <>
              <h3 style={{ marginTop: 0 }}>{c.ref} · {c.fundName} <Tag value={c.status} /></h3>
              <p className="ops-muted">{c.portfolioName} · committed {formatDate(c.committedOn)} · {c.manager}</p>
              <dl className="ops-dl">
                <div><dt>Committed</dt><dd>{m2(c.committed)}</dd></div>
                <div><dt>Paid-in</dt><dd>{m2(c.paidIn)}</dd></div>
                <div><dt>Called, unpaid</dt><dd>{m2(c.calledUnpaid)}</dd></div>
                <div><dt>Unfunded</dt><dd>{m2(c.unfunded)}</dd></div>
                <div><dt>Distributed</dt><dd>{m2(c.distributed)}</dd></div>
                <div><dt>NAV {c.navAsOf ? `(${formatDate(c.navAsOf)})` : ''}</dt><dd>{m2(c.nav)}</dd></div>
                <div><dt>DPI</dt><dd>{xr(c.dpi)}</dd></div>
                <div><dt>RVPI</dt><dd>{xr(c.rvpi)}</dd></div>
                <div><dt>TVPI</dt><dd>{xr(c.tvpi)}</dd></div>
                <div><dt>IRR</dt><dd>{irr(c.irrPct)}</dd></div>
                <div><dt>Carrying value (books)</dt><dd>{m2(c.carryingValue ?? null)}</dd></div>
              </dl>
              <h4>Capital calls and distributions</h4>
              {c.cashflows && c.cashflows.length ? (
                <DataTable head={['Notice', 'Kind', 'Amount', 'Notice date', 'Due', 'Paid', 'Status', 'Books', '']}>
                  {c.cashflows.map((f) => (
                    <tr key={f.id}>
                      <td>{f.ref}</td>
                      <td><Tag value={f.kind} tone={f.kind === 'CALL' ? 'amber' : 'green'} /></td>
                      <td className="r">{m2(f.amount)}</td>
                      <td>{formatDate(f.noticeDate)}</td>
                      <td>{formatDate(f.dueDate)} {f.overdue && <Tag value="Overdue" tone="red" />}</td>
                      <td>{formatDate(f.paidOn)}</td>
                      <td><Tag value={f.status} />{f.kind === 'DISTRIBUTION' && f.returnOfCapital && <div className="ops-muted">{m2(f.returnOfCapital)} return of capital</div>}</td>
                      <td>
                        {f.posting ? (
                          <>
                            {f.posting.accountingJournal ? <Link href={`/ops/accounting/journals/${f.posting.accountingJournalId ?? ''}`}>{f.posting.accountingJournal}</Link> : '—'}
                            {f.posting.cashJournal && <div className="ops-muted">cash <Link href={`/ops/cash/journals/${f.posting.cashJournalId ?? ''}`}>{f.posting.cashJournal}</Link></div>}
                            {f.posting.skipped && <div className="ops-muted">not booked: {f.posting.skipped}</div>}
                            {f.posting.fxRate !== '1' && <div className="ops-muted">FX {f.posting.fxRate} to {f.posting.baseCurrency}</div>}
                          </>
                        ) : f.status === 'PAID' ? 'not booked' : ''}
                      </td>
                      <td>
                        {canManage && f.status === 'NOTICED' && (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <ActionButton label={f.kind === 'CALL' ? 'Mark paid' : 'Mark received'} onRun={(k) => api.post(P(`/cashflows/${f.id}/pay`), {}, { idempotencyKey: k })} onDone={done} />
                            <button className="ops-btn small" type="button" onClick={() => setSub({ cancel: f.id })}>Cancel</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <p className="ops-muted">No cashflows yet.</p>
              )}
              <h4>NAV marks</h4>
              {c.marks && c.marks.length ? (
                <DataTable head={['Mark', 'As of', 'NAV', 'Method', 'Evidence', 'Status']}>
                  {c.marks.map((m) => (
                    <tr key={m.id} className="clickable" onClick={() => onOpenMark(m.id)}>
                      <td>{m.ref}</td>
                      <td>{formatDate(m.asOf)}</td>
                      <td className="r">{m2(m.nav)}</td>
                      <td>{label(m.method)}</td>
                      <td className="r">{m.evidence.length}</td>
                      <td><Tag value={m.status} /></td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <p className="ops-muted">No marks yet.</p>
              )}
              {canManage && c.status === 'ACTIVE' && (
                <div className="ops-actions" style={{ marginTop: 14 }}>
                  <button className="ops-btn primary" type="button" onClick={() => setSub('flow')}>Notice a call or distribution</button>
                  <button className="ops-btn" type="button" onClick={() => setSub('mark')}>Prepare NAV mark</button>
                </div>
              )}
              {sub === 'flow' && (
                <FormModal title="Notice a capital call or distribution" subtitle={`Unfunded commitment: ${m2(c.unfunded)} (calls cannot exceed it)`} submitLabel="Record notice" onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(P(`/commitments/${c.id}/cashflows`), { kind: str(fd, 'kind'), amount: str(fd, 'amount').replace(/,/g, ''), noticeDate: str(fd, 'noticeDate'), dueDate: str(fd, 'dueDate'), note: optStr(fd, 'note'), ...(str(fd, 'kind') === 'DISTRIBUTION' && optStr(fd, 'returnOfCapital') ? { returnOfCapital: str(fd, 'returnOfCapital').replace(/,/g, '') } : {}) }, { idempotencyKey: k })} onDone={done}>
                  <FieldGrid>
                    <Field label="Kind"><select className="ops-input" name="kind"><option value="CALL">Capital call</option><option value="DISTRIBUTION">Distribution</option></select></Field>
                    <Field label="Amount"><input className="ops-input" name="amount" inputMode="decimal" required /></Field>
                    <Field label="Of which return of capital" hint="Distributions only; the rest books as income and gains"><input className="ops-input" name="returnOfCapital" inputMode="decimal" /></Field>
                    <Field label="Notice date"><input className="ops-input" name="noticeDate" type="date" defaultValue={today()} required /></Field>
                    <Field label="Due date"><input className="ops-input" name="dueDate" type="date" defaultValue={today()} required /></Field>
                    <Field label="Note" span={2}><input className="ops-input" name="note" maxLength={500} /></Field>
                  </FieldGrid>
                </FormModal>
              )}
              {sub === 'mark' && (
                <FormModal title="Prepare a NAV mark" subtitle="Our share of the fund NAV. Attach evidence, then submit for a second person to approve." submitLabel="Create draft mark" onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(P(`/commitments/${c.id}/marks`), { asOf: str(fd, 'asOf'), nav: str(fd, 'nav').replace(/,/g, ''), method: str(fd, 'method'), note: optStr(fd, 'note') }, { idempotencyKey: k })} onDone={(r) => { done(); const id2 = (r as { id?: string } | undefined)?.id; if (id2) onOpenMark(id2); }}>
                  <FieldGrid>
                    <Field label="As of"><input className="ops-input" name="asOf" type="date" defaultValue={today()} required /></Field>
                    <Field label="NAV"><input className="ops-input" name="nav" inputMode="decimal" required /></Field>
                    <Field label="Method"><select className="ops-input" name="method">{METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field>
                    <Field label="Note" hint="Required when NAV moves more than 30%"><input className="ops-input" name="note" maxLength={500} /></Field>
                  </FieldGrid>
                </FormModal>
              )}
              {sub && typeof sub === 'object' && <ReasonModal title="Cancel notice" submitLabel="Cancel notice" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(P(`/cashflows/${sub.cancel}/cancel`), { reason })} onDone={done} />}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

// ================================================================ marks

function MarksTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('PENDING_APPROVAL');
  const res = useResource<Mark[]>(() => api.get<Mark[]>(P(`/marks${qs({ status })}`)), [status]);
  return (
    <Card title="NAV marks">
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      <Loaded res={res} what="marks">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No marks in this state.</Empty>
          ) : (
            <DataTable head={['Mark', 'Fund', 'As of', 'NAV', 'Method', 'Evidence', 'Prepared by', 'Status']}>
              {rows.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => onOpen(m.id)}>
                  <td>{m.ref}</td>
                  <td>{m.fundName}</td>
                  <td>{formatDate(m.asOf)}</td>
                  <td className="r">{m2(m.nav)}</td>
                  <td>{label(m.method)}</td>
                  <td className="r">{m.evidence.length}</td>
                  <td>{m.makerName}</td>
                  <td><Tag value={m.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
    </Card>
  );
}

function MarkModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const canManage = useCan('portfolio.manage');
  const canApprove = useCan('private.mark.approve');
  const res = useResource<Mark>(() => api.get<Mark>(P(`/marks/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'evidence' | 'upload' | 'reject' | 'return'>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="NAV mark" kicker="Private Markets" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this mark">
          {(m) => {
            const maker = m.makerId === user.id;
            return (
              <>
                <h3 style={{ marginTop: 0 }}>{m.ref} · {m.fundName} <Tag value={m.status} /></h3>
                <dl className="ops-dl">
                  <div><dt>As of</dt><dd>{formatDate(m.asOf)}</dd></div>
                  <div><dt>NAV</dt><dd>{m2(m.nav)}</dd></div>
                  <div><dt>Method</dt><dd>{label(m.method)}</dd></div>
                  <div><dt>Prepared by</dt><dd>{m.makerName}</dd></div>
                  <div><dt>Approved by</dt><dd>{m.approverName ?? '—'}</dd></div>
                </dl>
                {m.note && <p>{m.note}</p>}
                {m.posting && (
                  <Alert kind="info">
                    Booked on approval: {m.posting.carryingDelta && Number(m.posting.carryingDelta) !== 0 ? `${Number(m.posting.carryingDelta) > 0 ? 'unrealised gain' : 'unrealised loss'} of ${m2(String(Math.abs(Number(m.posting.carryingDelta))))} against the carrying value` : 'no change to the carrying value'}
                    {m.posting.accountingJournal ? `, journal ${m.posting.accountingJournal} (pending approval in Accounting)` : ''}
                    {m.posting.skipped ? ` (${m.posting.skipped})` : ''}.
                  </Alert>
                )}
                {m.rejectReason && <Alert kind="warn">{m.status === 'REJECTED' ? 'Rejected' : 'Returned'}: {m.rejectReason}</Alert>}
                <h4>Valuation evidence</h4>
                {m.evidence.length ? (
                  <DataTable head={['Kind', 'Title', 'Reference', 'Added by']}>
                    {m.evidence.map((e) => (
                      <tr key={e.id}>
                        <td>{label(e.kind)}</td>
                        <td>{e.title}</td>
                        <td>{e.documentRef ? <Link href="/ops/vault">{e.documentRef}</Link> : (e.reference ?? '—')}</td>
                        <td>{e.addedByName}</td>
                      </tr>
                    ))}
                  </DataTable>
                ) : (
                  <Alert kind="warn">No evidence attached. A mark cannot be submitted or approved without it.</Alert>
                )}
                <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                  {m.status === 'DRAFT' && maker && canManage && (
                    <>
                      <button className="ops-btn" type="button" onClick={() => setSub('upload')}>Upload evidence file</button>
                      <button className="ops-btn" type="button" onClick={() => setSub('evidence')}>Link by reference</button>
                      <ActionButton primary label="Submit for approval" onRun={(k) => api.post(P(`/marks/${m.id}/submit`), {}, { idempotencyKey: k })} onDone={done} />
                    </>
                  )}
                  {m.status === 'PENDING_APPROVAL' && canApprove && !maker && (
                    <>
                      <ActionButton primary label="Approve" confirm="Approve this NAV mark? It becomes the official valuation." onRun={(k) => api.post(P(`/marks/${m.id}/approve`), {}, { idempotencyKey: k })} onDone={done} />
                      <button className="ops-btn" type="button" onClick={() => setSub('return')}>Return</button>
                      <button className="ops-btn danger" type="button" onClick={() => setSub('reject')}>Reject</button>
                    </>
                  )}
                  {m.status === 'PENDING_APPROVAL' && !canApprove && <button className="ops-btn primary" type="button" disabled title="Needs the private.mark.approve permission">Approve</button>}
                  {m.status === 'PENDING_APPROVAL' && maker && <span className="ops-muted">A different person with private.mark.approve must approve.</span>}
                </div>
                {sub === 'evidence' && (
                  <FormModal title="Add valuation evidence" submitLabel="Add" onClose={() => setSub(null)} onSubmit={(fd) => api.post(P(`/marks/${m.id}/evidence`), { kind: str(fd, 'kind'), title: str(fd, 'title'), ...(/^DOC-\d+$/i.test(str(fd, 'reference')) ? { documentId: str(fd, 'reference').toUpperCase() } : { reference: optStr(fd, 'reference') }), note: optStr(fd, 'note') })} onDone={done}>
                    <FieldGrid>
                      <Field label="Kind"><select className="ops-input" name="kind">{EVIDENCE.map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></Field>
                      <Field label="Title"><input className="ops-input" name="title" required minLength={3} /></Field>
                      <Field label="Vault document reference (DOC-####) or link" span={2}><input className="ops-input" name="reference" maxLength={255} /></Field>
                      <Field label="Note" span={2}><input className="ops-input" name="note" maxLength={500} /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {sub === 'upload' && (
                  <FormModal
                    title="Upload valuation evidence"
                    subtitle="The file is stored in the document vault (restricted) and linked to this mark."
                    submitLabel="Upload"
                    onClose={() => setSub(null)}
                    onSubmit={(fd) => {
                      const body = new FormData();
                      body.append('kind', str(fd, 'kind'));
                      body.append('title', str(fd, 'title'));
                      const note = optStr(fd, 'note');
                      if (note) body.append('note', note);
                      const file = fd.get('file');
                      if (!(file instanceof File) || file.size === 0) return Promise.reject(new Error('Choose the evidence file.'));
                      body.append('file', file);
                      return api.post(P(`/marks/${m.id}/evidence/upload`), body);
                    }}
                    onDone={done}
                  >
                    <FieldGrid>
                      <Field label="Kind"><select className="ops-input" name="kind">{EVIDENCE.map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></Field>
                      <Field label="Title"><input className="ops-input" name="title" required minLength={3} /></Field>
                      <Field label="File" span={2}><input className="ops-input" name="file" type="file" required /></Field>
                      <Field label="Note" span={2}><input className="ops-input" name="note" maxLength={500} /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {sub === 'return' && <ReasonModal title="Return to preparer" submitLabel="Return" onClose={() => setSub(null)} onSubmit={(reason) => api.post(P(`/marks/${m.id}/return`), { reason })} onDone={done} />}
                {sub === 'reject' && <ReasonModal title="Reject mark" submitLabel="Reject" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(P(`/marks/${m.id}/reject`), { reason })} onDone={done} />}
              </>
            );
          }}
        </Loaded>
      </div>
    </Modal>
  );
}
