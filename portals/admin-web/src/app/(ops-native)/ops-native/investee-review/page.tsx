'use client';

import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { useSession } from '@/ops/session';
import { ActionButton, Alert, Card, DateText, Empty, Loaded, PageHeader, StatusBadge, useResource } from '@/ops/ui';

type Area = 'CAP_TABLE' | 'FORECAST' | 'GOVERNANCE';

interface CompanyRow {
  id: string;
  ref: string;
  name: string;
  status: string;
  pendingCapTransactions: number;
  pendingConsents: number;
  submittedRequests: number;
  openSignoffs: number;
  lastReviews: Partial<Record<Area, string | null>>;
}
interface Reviews {
  latest: Partial<Record<Area, { outcome: string; note: string | null; reviewer: string; createdAt: string; changedSince: boolean }>>;
  history: { id: string; area: Area; outcome: string; note: string | null; reviewer: string; createdAt: string }[];
}
interface CapData {
  snapshotSha256: string;
  cap: { derived: boolean; asOf: string; pendingTransactions: number; shareholders: { id: string; name: string; type: string; shares: number; pct: number }[]; classes: { name: string; outstanding: number; voting: string; preference: string; conversion: string }[] };
  transactions: { id: string; kind: string; status: string; holder: string; className: string; shares: number; consideration: number; currency: string; effectiveDate?: string }[];
  certificates: { id: string; holder: string; className: string; shares: number; issuedOn: string | null; sha256: string; status: string }[];
}
interface ForecastData {
  snapshotSha256: string;
  forecast: { scenario: string; months: { key: string; label?: string; stage?: string; locked: boolean }[]; actuals: Record<string, number | null>; forecast: Record<string, number | null>; activeRevenue: number };
}
interface GovData {
  snapshotSha256: string;
  consents: { ref: string; title: string; basis: string; due: string | null; owner: string; status: string }[];
  meetings: { ref: string; title: string; meetingAt: string; status: string; packStatus: string; packSha256: string | null; packItems: number }[];
  actions: { id: string; title: string; owner: string; due: string | null; status: string }[];
}
interface Signoffs {
  signoffs: { id: string; period: string; esignRef: string; status: string; requestedBy: string; requestedAt: string; signedAt: string | null }[];
  periods: { period: string; label: string; status: string; submittedAt: string | null }[];
}
interface MailRow {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  status: string;
  attempts: number;
  transport: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

const num = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
const AREA_LABEL: Record<Area, string> = { CAP_TABLE: 'Cap table', FORECAST: 'Forecast', GOVERNANCE: 'Governance' };

function ReviewBar({ companyId, area, snapshot, reviews, onDone }: { companyId: string; area: Area; snapshot: string; reviews: Reviews | null; onDone: () => void }) {
  const { can } = useSession();
  const [note, setNote] = useState('');
  const last = reviews?.latest[area];
  const post = (outcome: 'REVIEWED' | 'QUERIED') => (key: string) =>
    api.post(ops(`/investee-review/${encodeURIComponent(companyId)}/reviews`), { area, outcome, note: note || undefined, snapshotSha256: snapshot }, { idempotencyKey: key });
  return (
    <Card title={`Review: ${AREA_LABEL[area]}`}>
      {last ? (
        <p className="ops-muted">
          Last {last.outcome.toLowerCase()} by {last.reviewer} on <DateText value={last.createdAt} time />
          {last.note ? ` - ${last.note}` : ''}. {last.changedSince ? <strong>The data has changed since.</strong> : 'No change since.'}
        </p>
      ) : (
        <p className="ops-muted">Not reviewed yet.</p>
      )}
      {can('research.edit') ? (
        <>
          <textarea className="ops-input" rows={2} maxLength={1000} placeholder="Note (required when you query the company)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
          <p>
            <ActionButton primary label="Mark reviewed" confirm={`Record that you reviewed the ${AREA_LABEL[area].toLowerCase()} as shown?`} onRun={post('REVIEWED')} onDone={() => { setNote(''); onDone(); }} />
            <ActionButton label="Query the company" disabled={!note.trim()} title="Sends your note to the company and records the query" confirm="Send this question to the company?" onRun={post('QUERIED')} onDone={() => { setNote(''); onDone(); }} />
          </p>
        </>
      ) : (
        <p className="ops-muted">Recording a review needs research.edit.</p>
      )}
    </Card>
  );
}

function CapPanel({ companyId, reviews }: { companyId: string; reviews: Resource2 }) {
  const res = useResource<CapData>(() => api.get<CapData>(ops(`/investee-review/${encodeURIComponent(companyId)}/cap-table`)), [companyId]);
  return (
    <Loaded res={res} what="cap table">
      {(d) => (
        <>
          {d.cap.derived && <Alert kind="info">No register transactions yet: the holders below are derived from the investment record, not from a signed register.</Alert>}
          <Card title="Shareholders">
            <table className="ops-table">
              <thead><tr><th>Holder</th><th>Class</th><th>Shares</th><th>%</th></tr></thead>
              <tbody>{d.cap.shareholders.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.type}</td><td>{num(s.shares)}</td><td>{s.pct}%</td></tr>)}</tbody>
            </table>
          </Card>
          <Card title="Share classes">
            <table className="ops-table">
              <thead><tr><th>Class</th><th>Outstanding</th><th>Voting</th><th>Preference</th><th>Conversion</th></tr></thead>
              <tbody>{d.cap.classes.map((k) => <tr key={k.name}><td>{k.name}</td><td>{num(k.outstanding)}</td><td>{k.voting}</td><td>{k.preference}</td><td>{k.conversion}</td></tr>)}</tbody>
            </table>
          </Card>
          <Card title={`Transactions (${d.cap.pendingTransactions} awaiting approval)`}>
            {d.transactions.length === 0 ? <Empty>No transactions.</Empty> : (
              <table className="ops-table">
                <thead><tr><th>Ref</th><th>Kind</th><th>Holder</th><th>Class</th><th>Shares</th><th>Consideration</th><th>Status</th></tr></thead>
                <tbody>{d.transactions.map((t) => <tr key={t.id}><td>{t.id}</td><td>{t.kind}</td><td>{t.holder}</td><td>{t.className}</td><td>{num(t.shares)}</td><td>{t.currency} {num(t.consideration)}</td><td><StatusBadge status={t.status} /></td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <Card title="Certificates">
            {d.certificates.length === 0 ? <Empty>No certificates issued.</Empty> : (
              <table className="ops-table">
                <thead><tr><th>No.</th><th>Holder</th><th>Class</th><th>Shares</th><th>Issued</th><th /></tr></thead>
                <tbody>
                  {d.certificates.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td><td>{c.holder}</td><td>{c.className}</td><td>{num(c.shares)}</td><td>{c.issuedOn ?? '-'}</td>
                      <td><ActionButton label="Verify hash" onRun={async () => { const v = await api.get<{ valid: boolean }>(ops(`/investee-review/${encodeURIComponent(companyId)}/certificates/${encodeURIComponent(c.id)}/verify`)); window.alert(v.valid ? 'The stored file matches the recorded hash.' : 'MISMATCH: the stored file differs from the recorded hash.'); }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <ReviewBar companyId={companyId} area="CAP_TABLE" snapshot={d.snapshotSha256} reviews={reviews.data} onDone={reviews.reload} />
        </>
      )}
    </Loaded>
  );
}

function ForecastPanel({ companyId, reviews }: { companyId: string; reviews: Resource2 }) {
  const res = useResource<ForecastData>(() => api.get<ForecastData>(ops(`/investee-review/${encodeURIComponent(companyId)}/forecast`)), [companyId]);
  return (
    <Loaded res={res} what="forecast">
      {(d) => (
        <>
          <Card title={`Revenue forecast - ${d.forecast.scenario} (plan ${num(d.forecast.activeRevenue)})`}>
            <table className="ops-table">
              <thead><tr><th>Month</th><th>Actual</th><th>Forecast</th><th>Locked</th></tr></thead>
              <tbody>
                {d.forecast.months.map((m) => (
                  <tr key={m.key}>
                    <td>{m.label ?? m.key}</td>
                    <td>{d.forecast.actuals[m.key] != null ? num(d.forecast.actuals[m.key]!) : '-'}</td>
                    <td>{d.forecast.forecast[m.key] != null ? num(d.forecast.forecast[m.key]!) : '-'}</td>
                    <td>{m.locked ? 'Yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <ReviewBar companyId={companyId} area="FORECAST" snapshot={d.snapshotSha256} reviews={reviews.data} onDone={reviews.reload} />
        </>
      )}
    </Loaded>
  );
}

function GovernancePanel({ companyId, reviews }: { companyId: string; reviews: Resource2 }) {
  const res = useResource<GovData>(() => api.get<GovData>(ops(`/investee-review/${encodeURIComponent(companyId)}/governance`)), [companyId]);
  return (
    <Loaded res={res} what="governance">
      {(d) => (
        <>
          <Card title="Consents (decide them under Investee requests)">
            {d.consents.length === 0 ? <Empty>None.</Empty> : (
              <table className="ops-table">
                <thead><tr><th>Ref</th><th>Matter</th><th>Basis</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>{d.consents.map((c) => <tr key={c.ref}><td>{c.ref}</td><td>{c.title}</td><td>{c.basis}</td><td>{c.due ?? '-'}</td><td><StatusBadge status={c.status} /></td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <Card title="Board meetings">
            {d.meetings.length === 0 ? <Empty>None.</Empty> : (
              <table className="ops-table">
                <thead><tr><th>Ref</th><th>Meeting</th><th>When</th><th>Status</th><th>Pack</th></tr></thead>
                <tbody>{d.meetings.map((m) => <tr key={m.ref}><td>{m.ref}</td><td>{m.title}</td><td><DateText value={m.meetingAt} time /></td><td><StatusBadge status={m.status} /></td><td>{m.packStatus} ({m.packItems} items){m.packSha256 ? ` ${m.packSha256.slice(0, 10)}...` : ''}</td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <Card title="Board actions">
            {d.actions.length === 0 ? <Empty>None.</Empty> : (
              <table className="ops-table">
                <thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>{d.actions.map((a) => <tr key={a.id}><td>{a.title}</td><td>{a.owner}</td><td>{a.due ?? '-'}</td><td><StatusBadge status={a.status} /></td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <ReviewBar companyId={companyId} area="GOVERNANCE" snapshot={d.snapshotSha256} reviews={reviews.data} onDone={reviews.reload} />
        </>
      )}
    </Loaded>
  );
}

function SignoffPanel({ companyId }: { companyId: string }) {
  const { can } = useSession();
  const res = useResource<Signoffs>(() => api.get<Signoffs>(ops(`/investee-review/${encodeURIComponent(companyId)}/signoffs`)), [companyId]);
  return (
    <Loaded res={res} what="sign-offs">
      {(d) => (
        <Card title="Reporting pack sign-off (native e-signature)">
          <p className="ops-muted">Once a company submits a period, its authorised signatories sign a declaration of the submitted figures. The signed copy is sealed by the e-signature module.</p>
          {d.periods.length === 0 ? <Empty>No submitted reporting periods.</Empty> : (
            <table className="ops-table">
              <thead><tr><th>Period</th><th>Pack</th><th>Sign-off</th><th /></tr></thead>
              <tbody>
                {d.periods.map((p) => {
                  const rows = d.signoffs.filter((s) => s.period === p.period);
                  const latest = rows[0];
                  const done = rows.some((s) => s.status === 'SIGNED');
                  return (
                    <tr key={p.period}>
                      <td>{p.label}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td>{latest ? <><StatusBadge status={latest.status} /> <span className="ops-sub">{latest.esignRef}{latest.signedAt ? ` - signed ${latest.signedAt.slice(0, 10)}` : ''}</span></> : 'Not requested'}</td>
                      <td>
                        {can('research.edit') && !done && latest?.status !== 'REQUESTED' && (
                          <ActionButton primary label={latest ? 'Request again' : 'Request sign-off'} confirm={`Send the ${p.label} declaration to the company's signatories?`} onRun={(key) => api.post(ops(`/investee-review/${encodeURIComponent(companyId)}/signoffs`), { period: p.period }, { idempotencyKey: key })} onDone={res.reload} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </Loaded>
  );
}

function MailPanel({ companyId }: { companyId: string }) {
  const res = useResource<MailRow[]>(() => api.get<MailRow[]>(ops(`/investee-review/${encodeURIComponent(companyId)}/mail-log`)), [companyId]);
  return (
    <Loaded res={res} what="deliveries">
      {(rows) => (
        <Card title="E-mail deliveries to company contacts">
          {rows.length === 0 ? <Empty>Nothing sent yet.</Empty> : (
            <table className="ops-table">
              <thead><tr><th>When</th><th>Kind</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><DateText value={r.createdAt} time /></td>
                    <td>{r.kind.replace('_', ' ').toLowerCase()}</td>
                    <td>{r.recipient}</td>
                    <td>{r.subject}</td>
                    <td><StatusBadge status={r.status} />{r.error ? <span className="ops-error-text"> {r.error}</span> : null} <span className="ops-sub">{r.attempts > 1 ? `${r.attempts} attempts` : ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </Loaded>
  );
}

type Resource2 = { data: Reviews | null; reload: () => void };
type Tab = 'cap' | 'forecast' | 'governance' | 'signoff' | 'mail';

export default function InvesteeReviewPage() {
  const companies = useResource<CompanyRow[]>(() => api.get<CompanyRow[]>(ops('/investee-review/companies')), []);
  const [companyId, setCompanyId] = useState('');
  const [tab, setTab] = useState<Tab>('cap');
  const reviewsRes = useResource<Reviews | null>(() => (companyId ? api.get<Reviews>(ops(`/investee-review/${encodeURIComponent(companyId)}/reviews`)) : Promise.resolve(null)), [companyId]);
  const reviews: Resource2 = { data: reviewsRes.state === 'ok' ? (reviewsRes.data ?? null) : null, reload: reviewsRes.reload };
  const tabs: [Tab, string][] = [['cap', 'Cap table'], ['forecast', 'Forecast'], ['governance', 'Governance'], ['signoff', 'Reporting sign-off'], ['mail', 'Deliveries']];

  return (
    <>
      <PageHeader kicker="Portfolio companies" title="Investee data review" subtitle="Read a company's cap table, forecast and governance records, record that you reviewed them or send a question back, and run the reporting sign-off." />
      <Card title="Company">
        <Loaded res={companies} what="companies">
          {(list) => (
            <table className="ops-table">
              <thead><tr><th>Company</th><th>Cap tx pending</th><th>Consents</th><th>Requests</th><th>Sign-offs open</th><th>Reviewed</th><th /></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} style={c.id === companyId ? { fontWeight: 600 } : undefined}>
                    <td>{c.name}<span className="ops-sub">{c.ref}</span></td>
                    <td>{c.pendingCapTransactions}</td>
                    <td>{c.pendingConsents}</td>
                    <td>{c.submittedRequests}</td>
                    <td>{c.openSignoffs}</td>
                    <td className="ops-sub">{(['CAP_TABLE', 'FORECAST', 'GOVERNANCE'] as Area[]).map((a) => `${AREA_LABEL[a]}: ${c.lastReviews[a] ? c.lastReviews[a]!.slice(0, 10) : 'never'}`).join(' | ')}</td>
                    <td><button className="ops-btn" type="button" onClick={() => setCompanyId(c.id)}>{c.id === companyId ? 'Open' : 'Select'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Loaded>
      </Card>
      {companyId && (
        <>
          <div className="ops-tabs" role="tablist">
            {tabs.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`ops-btn${tab === key ? ' primary' : ''}`} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          {tab === 'cap' && <CapPanel key={companyId} companyId={companyId} reviews={reviews} />}
          {tab === 'forecast' && <ForecastPanel key={companyId} companyId={companyId} reviews={reviews} />}
          {tab === 'governance' && <GovernancePanel key={companyId} companyId={companyId} reviews={reviews} />}
          {tab === 'signoff' && <SignoffPanel key={companyId} companyId={companyId} />}
          {tab === 'mail' && <MailPanel key={companyId} companyId={companyId} />}
        </>
      )}
    </>
  );
}
