'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, apiRequest, apiUpload, describeError, OpsError, qs, v1 } from './api';
import { formatDecimal } from './money';
import { DataTable, Tag } from './rp';
import { useCan } from './session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, Modal, optStr, str, useAction, useResource } from './ui';

const R = (p: string) => v1(`/research${p}`);
const num = (v: string | null | undefined, dp = 2) => (v === null || v === undefined || v === '' ? '—' : formatDecimal(v, dp));
const FILING_TYPES = ['ANNUAL_REPORT', 'INTERIM_REPORT', 'TRADING_UPDATE', 'CIRCULAR', 'PROSPECTUS', 'OTHER'] as const;
const typeText = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// ------------------------------------------------------------------ types (mirror /api/v1/research)

interface PriceStamp {
  price: string;
  asOf: string;
  source: string;
}
interface IssuerRow {
  id: string;
  ticker: string;
  isin: string | null;
  name: string;
  market: string;
  sector: string | null;
  currency: string;
  latestPrice: PriceStamp | null;
  latestFinancial: { period: string; asOf: string; source: string } | null;
  filings: number;
  pendingCatalysts: number;
  openCases: number;
}
interface Financial {
  id: string;
  period: string;
  periodType: string;
  periodEnd: string;
  currency: string;
  revenue: string | null;
  ebitda: string | null;
  netIncome: string | null;
  eps: string | null;
  totalAssets: string | null;
  totalDebt: string | null;
  equity: string | null;
  source: string;
  asOf: string;
}
interface Filing {
  id: string;
  filingType: string;
  title: string;
  period: string | null;
  periodEnd: string | null;
  filedOn: string;
  source: string;
  sourceUrl: string | null;
  documentRef: string | null;
  documentVersion: number | null;
  importedBy: string | null;
}
export interface Entry {
  id: string;
  kind: 'NOTE' | 'CATALYST' | 'RISK';
  title: string;
  body: string | null;
  eventDate: string | null;
  trigger: string | null;
  impact: string | null;
  severity: string | null;
  status: string;
  resolutionNote: string | null;
  resolvedByName: string | null;
  authorName: string | null;
  createdAt: string;
}
interface IssuerDetail {
  security: { id: string; ticker: string; isin: string | null; name: string; market: string; sector: string | null; currency: string };
  latestPrice: PriceStamp | null;
  priceHistory: { asOf: string; price: string; source: string }[];
  financials: Financial[];
  filings: Filing[];
  entries: Entry[];
  cases: { id: string; ref: string; title: string; rating: string; status: string; targetPrice: string; currency: string }[];
}

// ------------------------------------------------------------------ issuers tab (FR-RES-006)

export function IssuersTab({ onOpenCase }: { onOpenCase: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const res = useResource<{ data: IssuerRow[]; total: number }>(() => apiRequest('GET', R(`/issuers${qs({ q, limit: '100' })}`)), [q]);
  return (
    <Card title="Issuer universe">
      <input className="ops-input" aria-label="Search issuers" placeholder="Search ticker, ISIN or name" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />
      <Loaded res={res} what="issuers">
        {(r) =>
          r.data.length === 0 ? (
            <Empty>No issuers match.</Empty>
          ) : (
            <DataTable head={['Issuer', 'Market', 'Last price', 'Price as of', 'Source', 'Latest financials', 'Filings', 'Catalysts', 'Cases']}>
              {r.data.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => setOpen(i.id)}>
                  <td>
                    <strong>{i.ticker}</strong>
                    <div className="ops-muted">{i.name}{i.isin ? ` · ${i.isin}` : ''}</div>
                  </td>
                  <td>{i.market}</td>
                  <td className="r">{i.latestPrice ? `${i.currency} ${num(i.latestPrice.price, 4)}` : '—'}</td>
                  <td>{i.latestPrice ? formatDate(i.latestPrice.asOf) : '—'}</td>
                  <td>{i.latestPrice?.source ?? '—'}</td>
                  <td>{i.latestFinancial ? `${i.latestFinancial.period} (as of ${formatDate(i.latestFinancial.asOf)})` : '—'}</td>
                  <td className="r">{i.filings}</td>
                  <td className="r">{i.pendingCatalysts}</td>
                  <td className="r">{i.openCases}</td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {open && <IssuerModal id={open} onClose={() => setOpen(null)} onOpenCase={(id) => { setOpen(null); onOpenCase(id); }} onChanged={res.reload} />}
    </Card>
  );
}

function IssuerModal({ id, onClose, onOpenCase, onChanged }: { id: string; onClose: () => void; onOpenCase: (id: string) => void; onChanged: () => void }) {
  const canEdit = useCan('research.edit');
  const res = useResource<IssuerDetail>(() => api.get<IssuerDetail>(R(`/issuers/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'financials' | 'filing'>(null);
  const [err, setErr] = useState<string | null>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  const download = async (filingId: string) => {
    setErr(null);
    try {
      const r = await apiRequest<{ url: string }>('GET', R(`/filings/${encodeURIComponent(filingId)}/download-url`));
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      setErr(describeError(e));
    }
  };
  return (
    <Modal title="Issuer" kicker="Research & IC" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Alert>{err}</Alert>
        <Loaded res={res} what="this issuer">
          {(d) => (
            <>
              <h3 style={{ marginTop: 0 }}>
                {d.security.ticker} · {d.security.name}
              </h3>
              <p className="ops-muted" data-testid="issuer-price">
                {d.latestPrice ? `Last price ${d.security.currency} ${num(d.latestPrice.price, 4)}, as of ${formatDate(d.latestPrice.asOf)}, source ${d.latestPrice.source}` : 'No price on file'}
                {d.security.isin ? ` · ISIN ${d.security.isin}` : ''}
                {d.security.sector ? ` · ${d.security.sector}` : ''}
              </p>
              <h4>Financials</h4>
              {d.financials.length === 0 ? (
                <Empty>No financials recorded.</Empty>
              ) : (
                <DataTable head={['Period', 'Period end', 'Revenue', 'EBITDA', 'Net income', 'EPS', 'Total debt', 'Equity', 'Source', 'As of']}>
                  {d.financials.map((f) => (
                    <tr key={f.id}>
                      <td><strong>{f.period}</strong></td>
                      <td>{formatDate(f.periodEnd)}</td>
                      <td className="r">{num(f.revenue, 0)}</td>
                      <td className="r">{num(f.ebitda, 0)}</td>
                      <td className="r">{num(f.netIncome, 0)}</td>
                      <td className="r">{num(f.eps, 4)}</td>
                      <td className="r">{num(f.totalDebt, 0)}</td>
                      <td className="r">{num(f.equity, 0)}</td>
                      <td>{f.source}</td>
                      <td>{formatDate(f.asOf)}</td>
                    </tr>
                  ))}
                </DataTable>
              )}
              {canEdit && (
                <p>
                  <button className="ops-btn" type="button" onClick={() => setSub('financials')}>
                    Add financials
                  </button>
                </p>
              )}
              <h4>Filings</h4>
              {d.filings.length === 0 ? (
                <Empty>No filings imported yet.</Empty>
              ) : (
                <DataTable head={['Filing', 'Type', 'Period', 'Filed', 'Source', 'Vault', '']}>
                  {d.filings.map((f) => (
                    <tr key={f.id}>
                      <td><strong>{f.title}</strong></td>
                      <td>{typeText(f.filingType)}</td>
                      <td>{f.period ?? '—'}</td>
                      <td>{formatDate(f.filedOn)}</td>
                      <td>{f.source}</td>
                      <td>{f.documentRef ? `${f.documentRef} v${f.documentVersion ?? 1}` : '—'}</td>
                      <td>
                        <button className="ops-btn small" type="button" onClick={() => download(f.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
              {canEdit && (
                <p>
                  <button className="ops-btn" type="button" onClick={() => setSub('filing')}>
                    Import filing
                  </button>
                </p>
              )}
              <h4>Notes, catalysts and risks</h4>
              <EntriesPanel securityId={d.security.id} entries={d.entries} onChanged={done} />
              <h4>Research cases</h4>
              {d.cases.length === 0 ? (
                <Empty>No research cases on this issuer.</Empty>
              ) : (
                <DataTable head={['Case', 'Rating', 'Target', 'Status']}>
                  {d.cases.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => onOpenCase(c.id)}>
                      <td><strong>{c.ref}</strong><div className="ops-muted">{c.title}</div></td>
                      <td><Tag value={c.rating} /></td>
                      <td className="r">{c.currency} {num(c.targetPrice, 4)}</td>
                      <td><Tag value={c.status} /></td>
                    </tr>
                  ))}
                </DataTable>
              )}
              {sub === 'financials' && <FinancialsForm issuerId={d.security.id} currency={d.security.currency} onClose={() => setSub(null)} onDone={done} />}
              {sub === 'filing' && <FilingForm issuerId={d.security.id} onClose={() => setSub(null)} onDone={done} />}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

const money = (fd: FormData, n: string) => {
  const v = str(fd, n).replace(/,/g, '');
  return v === '' ? undefined : Number(v);
};

function FinancialsForm({ issuerId, currency, onClose, onDone }: { issuerId: string; currency: string; onClose: () => void; onDone: () => void }) {
  return (
    <FormModal
      kicker="Issuer"
      title="Add financials"
      subtitle={`Figures in ${currency}. Every record carries its source and as-of date.`}
      submitLabel="Save financials"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd, key) =>
        api.post(
          R(`/issuers/${encodeURIComponent(issuerId)}/financials`),
          JSON.parse(
            JSON.stringify({
              period: str(fd, 'period'),
              periodType: str(fd, 'periodType'),
              periodEnd: str(fd, 'periodEnd'),
              revenue: money(fd, 'revenue'),
              ebitda: money(fd, 'ebitda'),
              netIncome: money(fd, 'netIncome'),
              eps: money(fd, 'eps'),
              totalAssets: money(fd, 'totalAssets'),
              totalDebt: money(fd, 'totalDebt'),
              equity: money(fd, 'equity'),
              source: str(fd, 'source'),
              asOf: str(fd, 'asOf'),
            }),
          ),
          { idempotencyKey: key },
        )
      }
    >
      <FieldGrid>
        <Field label="Period" hint="FY2025, H1-2026, Q1-2026"><input className="ops-input" name="period" required maxLength={16} /></Field>
        <Field label="Period type">
          <select className="ops-input" name="periodType" defaultValue="FY">
            {['FY', 'H1', 'H2', 'Q'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Period end"><input className="ops-input" name="periodEnd" type="date" required /></Field>
        <Field label="As of" hint="When these figures were published or checked"><input className="ops-input" name="asOf" type="date" required max={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Revenue"><input className="ops-input" name="revenue" inputMode="decimal" /></Field>
        <Field label="EBITDA"><input className="ops-input" name="ebitda" inputMode="decimal" /></Field>
        <Field label="Net income"><input className="ops-input" name="netIncome" inputMode="decimal" /></Field>
        <Field label="EPS"><input className="ops-input" name="eps" inputMode="decimal" /></Field>
        <Field label="Total assets"><input className="ops-input" name="totalAssets" inputMode="decimal" /></Field>
        <Field label="Total debt"><input className="ops-input" name="totalDebt" inputMode="decimal" /></Field>
        <Field label="Equity"><input className="ops-input" name="equity" inputMode="decimal" /></Field>
        <Field label="Source" span={2}><input className="ops-input" name="source" required maxLength={120} placeholder="Annual report, SENS announcement..." /></Field>
      </FieldGrid>
    </FormModal>
  );
}

/** Imports a filing: multipart with the file and its metadata (document type, title, period, filed date, source). */
export function importFiling(issuerId: string, fd: FormData, key: string) {
  const file = fd.get('file');
  if (!file || typeof file === 'string' || file.size === 0) return Promise.reject(new Error('Choose the filing to import'));
  const form = new FormData();
  for (const n of ['filingType', 'title', 'period', 'periodEnd', 'filedOn', 'source', 'sourceUrl']) {
    const v = optStr(fd, n);
    if (v) form.set(n, v);
  }
  form.set('file', file, file.name);
  return apiUpload('POST', R(`/issuers/${encodeURIComponent(issuerId)}/filings`), form, { idempotencyKey: key });
}

function FilingForm({ issuerId, onClose, onDone }: { issuerId: string; onClose: () => void; onDone: () => void }) {
  return (
    <FormModal
      kicker="Issuer"
      title="Import filing"
      subtitle="The file is stored in the document vault and listed here with the same version."
      submitLabel="Import filing"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd, key) => importFiling(issuerId, fd, key)}
    >
      <FieldGrid>
        <Field label="Document type">
          <select className="ops-input" name="filingType" defaultValue="ANNUAL_REPORT">
            {FILING_TYPES.map((t) => <option key={t} value={t}>{typeText(t)}</option>)}
          </select>
        </Field>
        <Field label="Title"><input className="ops-input" name="title" required minLength={3} maxLength={200} /></Field>
        <Field label="Period" hint="FY2025"><input className="ops-input" name="period" maxLength={16} /></Field>
        <Field label="Period end"><input className="ops-input" name="periodEnd" type="date" /></Field>
        <Field label="Filed on"><input className="ops-input" name="filedOn" type="date" required max={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Source"><input className="ops-input" name="source" required maxLength={120} placeholder="ZSE announcements" /></Field>
        <Field label="Source link" span={2}><input className="ops-input" name="sourceUrl" type="url" maxLength={500} /></Field>
        <Field label="File" span={2}><input className="ops-input" name="file" type="file" required /></Field>
      </FieldGrid>
    </FormModal>
  );
}

// ------------------------------------------------------------------ notes, catalysts, risks (FR-RES-008)

const ENTRY_LABEL = { NOTE: 'Note', CATALYST: 'Catalyst', RISK: 'Risk' } as const;

/** History of timestamped entries, newest first, with structured catalyst and risk records. `entries` are the history to show. */
export function EntriesPanel({ securityId, caseId, entries, onChanged }: { securityId?: string; caseId?: string; entries: Entry[]; onChanged: () => void }) {
  const canEdit = useCan('research.edit');
  const [adding, setAdding] = useState<null | Entry['kind']>(null);
  const [resolving, setResolving] = useState<Entry | null>(null);
  return (
    <>
      {canEdit && (
        <p style={{ display: 'flex', gap: 8 }}>
          <button className="ops-btn" type="button" onClick={() => setAdding('NOTE')}>+ Note</button>
          <button className="ops-btn" type="button" onClick={() => setAdding('CATALYST')}>+ Catalyst</button>
          <button className="ops-btn" type="button" onClick={() => setAdding('RISK')}>+ Risk</button>
        </p>
      )}
      {entries.length === 0 ? (
        <Empty>No notes, catalysts or risks recorded.</Empty>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }} aria-label="Entry history, newest first">
          {entries.map((e) => (
            <li key={e.id} style={{ borderLeft: '3px solid var(--ops-border, #d0d5dd)', paddingLeft: 10 }}>
              <div>
                <span className="ops-badge grey">{ENTRY_LABEL[e.kind]}</span> <strong>{e.title}</strong>{' '}
                {e.kind !== 'NOTE' && <Tag value={e.status} />}
                {e.kind === 'RISK' && e.severity && <Tag value={e.severity} tone={e.severity === 'HIGH' ? 'red' : e.severity === 'MEDIUM' ? 'amber' : 'grey'} />}
              </div>
              {e.kind === 'CATALYST' && (
                <div className="ops-muted">
                  {e.eventDate ? formatDate(e.eventDate) : ''} · trigger: {e.trigger}
                  {e.impact ? ` · ${e.impact.toLowerCase()} impact` : ''}
                </div>
              )}
              {e.body && <div style={{ whiteSpace: 'pre-wrap' }}>{e.body}</div>}
              {e.resolutionNote && <div className="ops-muted">Resolved by {e.resolvedByName}: {e.resolutionNote}</div>}
              <div className="ops-muted">{e.authorName} · {formatDateTime(e.createdAt)}</div>
              {canEdit && (e.status === 'PENDING' || e.status === 'OPEN') && (
                <button className="ops-btn small" type="button" onClick={() => setResolving(e)}>
                  {e.kind === 'CATALYST' ? 'Record outcome' : 'Close or mitigate'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <FormModal
          kicker="Research"
          title={`Add ${ENTRY_LABEL[adding].toLowerCase()}`}
          submitLabel={`Add ${ENTRY_LABEL[adding].toLowerCase()}`}
          onClose={() => setAdding(null)}
          onDone={onChanged}
          onSubmit={(fd, key) =>
            api.post(
              R('/entries'),
              JSON.parse(
                JSON.stringify({
                  ...(caseId ? { caseId } : { securityId }),
                  kind: adding,
                  title: str(fd, 'title'),
                  body: optStr(fd, 'body'),
                  eventDate: optStr(fd, 'eventDate'),
                  trigger: optStr(fd, 'trigger'),
                  impact: optStr(fd, 'impact'),
                  severity: optStr(fd, 'severity'),
                }),
              ),
              { idempotencyKey: key },
            )
          }
        >
          <FieldGrid>
            <Field label="Title" span={2}><input className="ops-input" name="title" required minLength={3} maxLength={200} /></Field>
            {adding === 'CATALYST' && (
              <>
                <Field label="Date"><input className="ops-input" name="eventDate" type="date" required /></Field>
                <Field label="Expected impact">
                  <select className="ops-input" name="impact" defaultValue="NEUTRAL">
                    <option value="POSITIVE">Positive</option>
                    <option value="NEUTRAL">Neutral</option>
                    <option value="NEGATIVE">Negative</option>
                  </select>
                </Field>
                <Field label="Trigger" span={2} hint="What has to happen"><input className="ops-input" name="trigger" required maxLength={300} /></Field>
              </>
            )}
            {adding === 'RISK' && (
              <Field label="Severity" span={2}>
                <select className="ops-input" name="severity" defaultValue="MEDIUM">
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </Field>
            )}
            <Field label={adding === 'NOTE' ? 'Note' : 'Detail'} span={2}>
              <textarea className="ops-input" name="body" rows={4} maxLength={5000} required={adding === 'NOTE'} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {resolving && (
        <FormModal
          kicker="Research"
          title={resolving.kind === 'CATALYST' ? 'Record the outcome' : 'Close or mitigate the risk'}
          submitLabel="Save"
          onClose={() => setResolving(null)}
          onDone={onChanged}
          onSubmit={(fd) => api.post(R(`/entries/${resolving.id}/resolve`), { status: str(fd, 'status'), note: str(fd, 'note') })}
        >
          <Field label="Outcome">
            <select className="ops-input" name="status" defaultValue={resolving.kind === 'CATALYST' ? 'OCCURRED' : 'MITIGATED'}>
              {(resolving.kind === 'CATALYST' ? ['OCCURRED', 'MISSED', 'CANCELLED'] : ['MITIGATED', 'CLOSED']).map((s) => <option key={s} value={s}>{typeText(s)}</option>)}
            </select>
          </Field>
          <Field label="Note"><textarea className="ops-input" name="note" rows={3} required minLength={3} maxLength={500} /></Field>
        </FormModal>
      )}
    </>
  );
}

/** Entries for one research case, loaded on their own. */
export function CaseEntries({ caseId }: { caseId: string }) {
  const res = useResource<{ data: Entry[] }>(() => apiRequest('GET', R(`/entries${qs({ caseId, limit: '100' })}`)), [caseId]);
  return (
    <Loaded res={res} what="notes and catalysts">
      {(r) => <EntriesPanel caseId={caseId} entries={r.data} onChanged={res.reload} />}
    </Loaded>
  );
}

// ------------------------------------------------------------------ valuation model (FR-RES-007)

interface ValVersion {
  version: number;
  inputs: Inputs;
  targetPrice: string;
  lowPrice: string;
  highPrice: string;
  upsidePct: string | null;
  note: string | null;
  authorName: string | null;
  createdAt: string;
  result: { warnings?: string[]; targetSource?: string; base?: { terminalSharePct: number } };
}
interface Valuation {
  currentVersion: number;
  currency: string;
  current: ValVersion;
  versions: ValVersion[];
}
interface Range {
  low: number;
  base: number;
  high: number;
}
interface Inputs {
  revenue: number;
  sharesOutstanding: number;
  netDebt: number;
  terminalGrowthPct: number;
  growthPct: Range;
  marginPct: Range;
  discountPct: Range;
}
const DEFAULTS: Inputs = { revenue: 0, sharesOutstanding: 0, netDebt: 0, terminalGrowthPct: 2, growthPct: { low: 5, base: 10, high: 15 }, marginPct: { low: 8, base: 10, high: 12 }, discountPct: { low: 14, base: 16, high: 20 } };

/** Client-side mirror of the server ranges so the error shows beside the field before anything is sent. */
export function validateInputs(i: Inputs, target: string): Record<string, string> {
  const e: Record<string, string> = {};
  const range = (k: 'growthPct' | 'marginPct' | 'discountPct', lo: number, hi: number, what: string) => {
    const r = i[k];
    for (const p of ['low', 'base', 'high'] as const) if (!Number.isFinite(r[p]) || r[p] < lo || r[p] > hi) e[`${k}.${p}`] = `${what} must be between ${lo}% and ${hi}%`;
    if (!e[`${k}.low`] && !e[`${k}.base`] && !e[`${k}.high`] && !(r.low <= r.base && r.base <= r.high)) e[`${k}.base`] = `${what}: low must not exceed base, and base must not exceed high`;
  };
  if (!(i.revenue > 0)) e.revenue = 'Revenue must be greater than zero';
  if (!(i.sharesOutstanding > 0)) e.sharesOutstanding = 'Shares outstanding must be greater than zero';
  range('growthPct', -100, 500, 'Growth');
  range('marginPct', -100, 100, 'Margin');
  range('discountPct', 0, 50, 'Discount rate');
  if (!e['discountPct.low'] && i.discountPct.low <= i.terminalGrowthPct) e['discountPct.low'] = 'The lowest discount rate must exceed terminal growth';
  if (target !== '' && !(Number(target) > 0)) e.targetPrice = 'The target must be greater than zero, in the quote currency';
  return e;
}

export function ValuationPanel({ caseId, caseStatus, isAuthor, currency, onChanged }: { caseId: string; caseStatus: string; isAuthor: boolean; currency: string; onChanged: () => void }) {
  const canEdit = useCan('research.edit');
  const res = useResource<Valuation | null>(() => api.get<Valuation | null>(R(`/cases/${encodeURIComponent(caseId)}/valuation`)), [caseId]);
  const action = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Loaded res={res} what="the valuation model">
      {(v) => {
        const cur = v?.current.inputs ?? DEFAULTS;
        const n = (fd: FormData, k: string) => Number(str(fd, k).replace(/,/g, ''));
        const read = (fd: FormData): Inputs => ({
          revenue: n(fd, 'revenue'),
          sharesOutstanding: n(fd, 'sharesOutstanding'),
          netDebt: str(fd, 'netDebt') === '' ? 0 : n(fd, 'netDebt'),
          terminalGrowthPct: str(fd, 'terminalGrowthPct') === '' ? 2 : n(fd, 'terminalGrowthPct'),
          growthPct: { low: n(fd, 'growthPct.low'), base: n(fd, 'growthPct.base'), high: n(fd, 'growthPct.high') },
          marginPct: { low: n(fd, 'marginPct.low'), base: n(fd, 'marginPct.base'), high: n(fd, 'marginPct.high') },
          discountPct: { low: n(fd, 'discountPct.low'), base: n(fd, 'discountPct.base'), high: n(fd, 'discountPct.high') },
        });
        async function save(ev: FormEvent<HTMLFormElement>) {
          ev.preventDefault();
          setMsg(null);
          const fd = new FormData(ev.currentTarget);
          const inputs = read(fd);
          const target = str(fd, 'targetPrice');
          const local = validateInputs(inputs, target);
          setErrors(local);
          if (Object.keys(local).length) return;
          await action.run(async (key) => {
            try {
              await api.put(R(`/cases/${encodeURIComponent(caseId)}/valuation`), JSON.parse(JSON.stringify({ inputs, targetPrice: target ? Number(target) : undefined, note: optStr(fd, 'note') })), { idempotencyKey: key });
            } catch (e) {
              const d = e instanceof OpsError && Array.isArray(e.details) ? (e.details as { path?: string; message?: string }[]) : [];
              const mapped: Record<string, string> = {};
              for (const x of d) if (x.path && x.message) mapped[x.path.replace(/^inputs\./, '')] = x.message;
              if (Object.keys(mapped).length) setErrors(mapped);
              throw e;
            }
            setMsg('Saved as a new version.');
            res.reload();
            onChanged();
          });
        }
        const field = (name: string, label: string, value: number, step = 'any') => (
          <Field label={label}>
            <input className="ops-input" name={name} type="number" step={step} defaultValue={value || ''} aria-invalid={!!errors[name]} disabled={!canEdit} />
            {errors[name] && <span className="ops-hint" role="alert" style={{ color: 'var(--ops-red, #b42318)' }}>{errors[name]}</span>}
          </Field>
        );
        const rangeRow = (k: 'growthPct' | 'marginPct' | 'discountPct', label: string) => (
          <>
            {field(`${k}.low`, `${label}, low %`, cur[k].low)}
            {field(`${k}.base`, `${label}, base %`, cur[k].base)}
            {field(`${k}.high`, `${label}, high %`, cur[k].high)}
          </>
        );
        return (
          <>
            {v ? (
              <p data-testid="model-hero">
                <strong>Model target {currency} {num(v.current.targetPrice, 4)}</strong>
                {v.current.upsidePct !== null && <> · upside {Number(v.current.upsidePct) > 0 ? '+' : ''}{v.current.upsidePct}% to the last price</>}
                <span className="ops-muted"> · range {num(v.current.lowPrice, 4)} to {num(v.current.highPrice, 4)} · version {v.currentVersion}</span>
              </p>
            ) : (
              <p className="ops-muted">No valuation model yet. Enter the assumptions below; each save becomes a version.</p>
            )}
            {(v?.current.result.warnings ?? []).map((w) => <Alert key={w} kind="warn">{w}</Alert>)}
            <form onSubmit={save} noValidate>
              <FieldGrid>
                {field('revenue', `Revenue (${currency})`, cur.revenue)}
                {field('sharesOutstanding', 'Shares outstanding', cur.sharesOutstanding)}
                {field('netDebt', `Net debt (${currency})`, cur.netDebt)}
                {field('terminalGrowthPct', 'Terminal growth %', cur.terminalGrowthPct)}
                {rangeRow('growthPct', 'Growth')}
                {rangeRow('marginPct', 'Margin')}
                {rangeRow('discountPct', 'Discount rate')}
                <Field label={`Target override (${currency})`} hint="Blank uses the base case of the model">
                  <input className="ops-input" name="targetPrice" inputMode="decimal" aria-invalid={!!errors.targetPrice} disabled={!canEdit} />
                  {errors.targetPrice && <span className="ops-hint" role="alert" style={{ color: 'var(--ops-red, #b42318)' }}>{errors.targetPrice}</span>}
                </Field>
                <Field label="Note" span={2}><input className="ops-input" name="note" maxLength={500} disabled={!canEdit} /></Field>
              </FieldGrid>
              <Alert>{action.error}</Alert>
              {msg && <Alert kind="ok">{msg}</Alert>}
              <div className="ops-actions">
                <button className="ops-btn primary" type="submit" disabled={!canEdit || action.busy || caseStatus === 'ARCHIVED'} title={canEdit ? undefined : 'Needs the research.edit permission'}>
                  {action.busy ? 'Saving…' : 'Save model assumptions'}
                </button>
                {v && canEdit && caseStatus === 'DRAFT' && isAuthor && (
                  <ActionButton label="Apply target to the case" onRun={(key) => api.post(R(`/cases/${encodeURIComponent(caseId)}/valuation/apply-target`), {}, { idempotencyKey: key })} onDone={() => { res.reload(); onChanged(); }} />
                )}
              </div>
            </form>
            {v && (
              <>
                <h4>Version history</h4>
                <DataTable head={['Version', 'Target', 'Low', 'High', 'Upside', 'Saved by', 'When', 'Note']}>
                  {v.versions.map((x) => (
                    <tr key={x.version}>
                      <td>v{x.version}</td>
                      <td className="r">{num(x.targetPrice, 4)}{x.result.targetSource === 'OVERRIDE' ? ' (own)' : ''}</td>
                      <td className="r">{num(x.lowPrice, 4)}</td>
                      <td className="r">{num(x.highPrice, 4)}</td>
                      <td className="r">{x.upsidePct === null ? '—' : `${x.upsidePct}%`}</td>
                      <td>{x.authorName}</td>
                      <td>{formatDateTime(x.createdAt)}</td>
                      <td>{x.note ?? '—'}</td>
                    </tr>
                  ))}
                </DataTable>
              </>
            )}
          </>
        );
      }}
    </Loaded>
  );
}
