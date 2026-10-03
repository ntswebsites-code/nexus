'use client';

import { useState } from 'react';
import { asList, coGet, coPost, NoAccess, rawGet, rawPost, StaffSelect, Tabs, Tile, Tone, type StaffUser } from '@/ops/clientops';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, Loaded, optStr, PageHeader, str, useResource } from '@/ops/ui';

interface ClientRow {
  id: string;
  name: string;
  type: string;
  accounts: number;
  ccy: string;
  kyc: string;
  risk: string;
  mandate: string;
  owner: string;
  email: string;
}
interface Summary {
  total: number;
  onHold: number;
  reviewOverdue: number;
  reviewDueIn30Days: number;
  byKyc: Record<string, number>;
  byRisk: Record<string, number>;
  accountsByStatus: Record<string, number>;
}
interface Detail360 {
  client: ClientRow & { uuid: string; dealingHold: boolean; holdReason: string | null; country: string | null; phone: string; registration: string; address: string; nextReviewDate: string | null; relationshipOwnerId: string | null; portalEnabled: boolean };
  mandates: { id: string; name: string; type: string; status: string }[];
  cashAccounts: { id: string; legalEntity: string; provider: string; masked: string; currency: string; ownership: string; status: string; type: string }[];
  portfolios: { id: string; name: string; type: string; currency: string; status: string }[];
  commitments: { fund: string; fundRef: string; amount: number | null; currency: string; status: string; effectiveDate: string | null }[];
  documents: { total: number; recent: { id: string; name: string; type: string; classification: string; status: string; date: string }[] };
  kycCases: { ref: string; stage: string; risk: string; name: string }[];
  requests: { open: number; recent: { id: string; title: string; status: string; type: string; slaDueAt: string | null }[] };
  portalUsers: { email: string; name: string | null; role: string; lastLoginAt: string | null }[];
  capitalEvents: number;
  pendingChanges: number;
}

export default function ClientsPage() {
  const canView = useCan('clients.view');
  const canEdit = useCan('clients.edit');
  const [q, setQ] = useState('');
  const [kyc, setKyc] = useState('');
  const [risk, setRisk] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const summary = useResource<Summary>(() => coGet<Summary>('/clients/summary'), []);
  const list = useResource<ClientRow[]>(
    () => rawGet<{ data: ClientRow[] }>(`/api/v1/clients?${new URLSearchParams({ ...(q ? { q } : {}), ...(kyc ? { kyc } : {}), ...(risk ? { risk } : {}) })}`).then(asList),
    [q, kyc, risk],
  );
  if (!canView) return <NoAccess kicker="Clients" title="Clients & Accounts" perm="clients.view" />;
  return (
    <>
      <PageHeader
        kicker="Clients"
        title="Clients & Accounts"
        subtitle="Client master, mandates, cash accounts and the 360 view across portfolios, commitments, documents and requests."
        actions={canEdit ? <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>New client</button> : undefined}
      />
      <Loaded res={summary} what="client summary">
        {(s) => (
          <div className="ops-tiles">
            <Tile label="Clients" value={s.total} hint={`${s.byRisk.High ?? 0} high risk`} />
            <Tile label="KYC current" value={s.byKyc.Current ?? 0} hint={`${(s.byKyc['Review due'] ?? 0) + (s.byKyc['Enhanced review'] ?? 0)} in review`} />
            <Tile label="Reviews overdue" value={s.reviewOverdue} hint={`${s.reviewDueIn30Days} due in 30 days`} warn={s.reviewOverdue > 0} />
            <Tile label="Dealing holds" value={s.onHold} warn={s.onHold > 0} />
            <Tile label="Accounts awaiting approval" value={s.accountsByStatus.PENDING_APPROVAL ?? 0} hint={`${s.accountsByStatus.ACTIVE ?? 0} active`} />
          </div>
        )}
      </Loaded>
      <ChangeRequests onChanged={() => { list.reload(); summary.reload(); }} />
      <Card title="Clients">
        <div className="ops-filters">
          <Field label="Search">
            <input className="ops-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, reference or owner" />
          </Field>
          <Field label="KYC">
            <select className="ops-input" value={kyc} onChange={(e) => setKyc(e.target.value)}>
              <option value="">All</option>
              {['Pending', 'Current', 'Review due', 'Enhanced review'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="Risk">
            <select className="ops-input" value={risk} onChange={(e) => setRisk(e.target.value)}>
              <option value="">All</option>
              {['Low', 'Medium', 'High'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
        </div>
        <Loaded res={list} what="clients">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No clients match.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Type</th>
                      <th>Mandate</th>
                      <th className="r">Accounts</th>
                      <th>KYC</th>
                      <th>Risk</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id} className={`clickable${sel === c.id ? ' selected' : ''}`} onClick={() => setSel(c.id)}>
                        <td>
                          <strong>{c.name}</strong>
                          <span className="ops-sub">{c.id} · {c.ccy}</span>
                        </td>
                        <td>{c.type}</td>
                        <td>{c.mandate}</td>
                        <td className="r">{c.accounts}</td>
                        <td><Tone value={c.kyc} /></td>
                        <td><Tone value={c.risk} /></td>
                        <td>{c.owner}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {sel && <Client360 key={sel} id={sel} canEdit={canEdit} onChanged={() => { list.reload(); summary.reload(); }} />}
      {adding && (
        <FormModal
          title="New client"
          kicker="Clients & Accounts"
          submitLabel="Create client"
          onClose={() => setAdding(false)}
          onSubmit={(fd, key) =>
            rawPost('/api/v1/clients', { name: str(fd, 'name'), type: str(fd, 'type'), ccy: str(fd, 'ccy') || 'USD', risk: str(fd, 'risk') || 'Medium', email: optStr(fd, 'email'), owner: optStr(fd, 'owner') }, key)
          }
          onDone={() => { list.reload(); summary.reload(); }}
        >
          <FieldGrid>
            <Field label="Legal name"><input className="ops-input" name="name" required /></Field>
            <Field label="Type">
              <select className="ops-input" name="type">
                {['Individual', 'Corporate', 'Trust', 'Family office', 'Pension fund', 'Foundation'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Base currency"><input className="ops-input" name="ccy" defaultValue="USD" maxLength={3} /></Field>
            <Field label="Risk">
              <select className="ops-input" name="risk" defaultValue="Medium">
                {['Low', 'Medium', 'High'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Email"><input className="ops-input" name="email" type="email" /></Field>
            <Field label="Relationship owner"><input className="ops-input" name="owner" /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}

type Tab = 'overview' | 'accounts' | 'mandates' | 'holdings' | 'documents' | 'service';
type Dialog = 'hold' | 'release' | 'owner' | 'review' | 'mandate' | 'account' | null;

function Client360({ id, canEdit, onChanged }: { id: string; canEdit: boolean; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<Dialog>(null);
  const res = useResource<Detail360>(() => coGet<Detail360>(`/clients/${encodeURIComponent(id)}/360`), [id]);
  const staff = useResource<StaffUser[]>(() => coGet<{ data: StaffUser[] }>('/staff').then(asList), []);
  const done = () => { res.reload(); onChanged(); };
  return (
    <Loaded res={res} what="the client 360 view">
      {(d) => {
        const c = d.client;
        return (
          <Card
            title={<>{c.name} <span className="ops-sub">{c.id} · {c.type}</span></>}
            actions={
              canEdit ? (
                <>
                  {c.dealingHold ? <button className="ops-btn" type="button" onClick={() => setDialog('release')}>Request hold release</button> : <button className="ops-btn" type="button" onClick={() => setDialog('hold')}>Place dealing hold</button>}
                  <button className="ops-btn" type="button" onClick={() => setDialog('owner')}>Assign owner</button>
                  <button className="ops-btn" type="button" onClick={() => setDialog('review')}>Set review date</button>
                </>
              ) : undefined
            }
          >
            {c.dealingHold && <Alert kind="warn">Dealing hold in place: {c.holdReason}</Alert>}
            {d.pendingChanges > 0 && <Alert kind="info">{d.pendingChanges} change request{d.pendingChanges === 1 ? '' : 's'} awaiting approval for this client (see Pending approvals above).</Alert>}
            <Tabs
              tabs={[
                { key: 'overview', label: 'Overview' },
                { key: 'accounts', label: `Cash accounts (${d.cashAccounts.length})` },
                { key: 'mandates', label: `Mandates (${d.mandates.length})` },
                { key: 'holdings', label: `Portfolios & commitments (${d.portfolios.length + d.commitments.length})` },
                { key: 'documents', label: `Documents (${d.documents.total})` },
                { key: 'service', label: `KYC & requests (${d.requests.open} open)` },
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === 'overview' && (
              <dl className="ops-dl">
                {([
                  ['KYC', <Tone key="k" value={c.kyc} />],
                  ['Risk', <Tone key="r" value={c.risk} />],
                  ['Relationship owner', c.owner],
                  ['Next review', formatDate(c.nextReviewDate)],
                  ['Email', c.email || '-'],
                  ['Phone', c.phone || '-'],
                  ['Country', c.country ?? '-'],
                  ['Registration', c.registration || '-'],
                  ['Address', c.address || '-'],
                  ['Investor portal', c.portalEnabled ? `Enabled (${d.portalUsers.length} user${d.portalUsers.length === 1 ? '' : 's'})` : 'Not enabled'],
                  ['Capital events', d.capitalEvents],
                ] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {tab === 'accounts' && (
              <>
                {d.cashAccounts.length === 0 ? <Empty>No cash accounts.</Empty> : (
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead><tr><th>Account</th><th>Provider</th><th>Ownership</th><th>Ccy</th><th>Status</th><th /></tr></thead>
                      <tbody>
                        {d.cashAccounts.map((a) => (
                          <tr key={a.id}>
                            <td><strong>{a.legalEntity}</strong><span className="ops-sub">{a.id} · {a.masked}</span></td>
                            <td>{a.provider}</td>
                            <td>{a.ownership}</td>
                            <td>{a.currency}</td>
                            <td><Tone value={a.status} /></td>
                            <td>
                              {canEdit && a.status === 'DRAFT' && <ActionButton label="Submit for approval" onRun={(k) => rawPost(`/api/v1/cash-accounts/${a.id}/submit`, {}, k)} onDone={done} />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canEdit && <p><button className="ops-btn" type="button" onClick={() => setDialog('account')}>Add cash account</button></p>}
              </>
            )}
            {tab === 'mandates' && (
              <>
                {d.mandates.length === 0 ? <Empty>No mandates.</Empty> : (
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead><tr><th>Mandate</th><th>Type</th><th>Status</th><th /></tr></thead>
                      <tbody>
                        {d.mandates.map((m) => (
                          <tr key={m.id}>
                            <td><strong>{m.name}</strong><span className="ops-sub">{m.id}</span></td>
                            <td>{m.type}</td>
                            <td><Tone value={m.status} /></td>
                            <td>
                              {canEdit && m.status === 'Shell' && <ActionButton label="Request activation" primary confirm="Send this mandate for activation approval? A different person must approve." onRun={(k) => coPost(`/clients/${c.id}/change-requests`, { kind: 'MANDATE_STATUS', mandate: m.id, status: 'Active', reason: 'Mandate activation requested from the client record' }, k)} onDone={done} />}
                              {canEdit && m.status === 'Active' && <ActionButton label="Request closure" danger confirm="Send this mandate for closure approval? A closed mandate cannot be reopened." onRun={(k) => coPost(`/clients/${c.id}/change-requests`, { kind: 'MANDATE_STATUS', mandate: m.id, status: 'Closed', reason: 'Mandate closure requested from the client record' }, k)} onDone={done} />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canEdit && <p><button className="ops-btn" type="button" onClick={() => setDialog('mandate')}>Add mandate</button></p>}
              </>
            )}
            {tab === 'holdings' && (
              <>
                <h3>Portfolios</h3>
                {d.portfolios.length === 0 ? <Empty>No portfolios linked.</Empty> : (
                  <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Portfolio</th><th>Type</th><th>Ccy</th><th>Status</th></tr></thead><tbody>
                    {d.portfolios.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><span className="ops-sub">{p.id}</span></td><td>{p.type}</td><td>{p.currency}</td><td><Tone value={p.status} /></td></tr>)}
                  </tbody></table></div>
                )}
                <h3>Fund commitments</h3>
                {d.commitments.length === 0 ? <Empty>No fund commitments.</Empty> : (
                  <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Fund</th><th className="r">Commitment</th><th>Status</th><th>Effective</th></tr></thead><tbody>
                    {d.commitments.map((m) => <tr key={m.fundRef}><td><strong>{m.fund}</strong><span className="ops-sub">{m.fundRef}</span></td><td className="r">{m.currency} {m.amount === null ? '-' : m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td><Tone value={m.status} /></td><td>{formatDate(m.effectiveDate)}</td></tr>)}
                  </tbody></table></div>
                )}
              </>
            )}
            {tab === 'documents' && (
              d.documents.recent.length === 0 ? <Empty>No documents linked to this client.</Empty> : (
                <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Document</th><th>Type</th><th>Classification</th><th>Status</th><th>Date</th></tr></thead><tbody>
                  {d.documents.recent.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><span className="ops-sub">{x.id}</span></td><td>{x.type}</td><td><Tone value={x.classification} /></td><td>{x.status}</td><td>{formatDate(x.date)}</td></tr>)}
                </tbody></table></div>
              )
            )}
            {tab === 'service' && (
              <>
                <h3>KYC cases</h3>
                {d.kycCases.length === 0 ? <Empty>No KYC cases.</Empty> : d.kycCases.map((k) => <p key={k.ref}><strong>{k.ref}</strong> · {k.stage} · <Tone value={k.risk} /></p>)}
                <h3>Recent requests</h3>
                {d.requests.recent.length === 0 ? <Empty>No requests.</Empty> : (
                  <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Request</th><th>Type</th><th>Status</th><th>Due</th></tr></thead><tbody>
                    {d.requests.recent.map((r) => <tr key={r.id}><td><strong>{r.title}</strong><span className="ops-sub">{r.id}</span></td><td>{r.type}</td><td><Tone value={r.status} /></td><td>{formatDate(r.slaDueAt)}</td></tr>)}
                  </tbody></table></div>
                )}
              </>
            )}
            {dialog === 'hold' && (
              <FormModal title="Place dealing hold" kicker={c.name} subtitle="Blocks the client's dealing requests until released." submitLabel="Place hold" danger onClose={() => setDialog(null)} onDone={done}
                onSubmit={(fd, key) => coPost(`/clients/${c.id}/dealing-hold`, { hold: true, reason: str(fd, 'reason') }, key)}>
                <Field label="Reason"><textarea className="ops-input" name="reason" required minLength={5} /></Field>
              </FormModal>
            )}
            {dialog === 'release' && (
              <FormModal title="Request release of dealing hold" kicker={c.name} subtitle="A different person must approve the release (maker-checker). The hold stays in place until they do." submitLabel="Send for approval" onClose={() => setDialog(null)} onDone={done}
                onSubmit={(fd, key) => coPost(`/clients/${c.id}/change-requests`, { kind: 'DEALING_HOLD_RELEASE', reason: str(fd, 'reason') }, key)}>
                <Field label="Reason for release"><textarea className="ops-input" name="reason" required minLength={5} /></Field>
              </FormModal>
            )}
            {dialog === 'owner' && (
              <FormModal title="Relationship owner" kicker={c.name} submitLabel="Assign" onClose={() => setDialog(null)} onDone={done}
                onSubmit={(fd) => coPost(`/clients/${c.id}/relationship-owner`, { userId: optStr(fd, 'userId') ?? null })}>
                <Field label="Staff member"><StaffSelect staff={staff.state === 'ok' ? staff.data : []} name="userId" value={c.relationshipOwnerId} /></Field>
              </FormModal>
            )}
            {dialog === 'review' && (
              <FormModal title="Next periodic review" kicker={c.name} submitLabel="Save" onClose={() => setDialog(null)} onDone={done}
                onSubmit={(fd) => coPost(`/clients/${c.id}/review-date`, { nextReviewDate: optStr(fd, 'date') ?? null, note: optStr(fd, 'note') })}>
                <FieldGrid>
                  <Field label="Review date"><input className="ops-input" type="date" name="date" defaultValue={c.nextReviewDate?.slice(0, 10) ?? ''} /></Field>
                  <Field label="Note"><input className="ops-input" name="note" /></Field>
                </FieldGrid>
              </FormModal>
            )}
            {dialog === 'mandate' && (
              <FormModal title="Add mandate" kicker={c.name} submitLabel="Add mandate" onClose={() => setDialog(null)} onDone={done}
                onSubmit={(fd) => rawPost(`/api/v1/clients/${c.id}/mandates`, { name: str(fd, 'name'), type: str(fd, 'type') })}>
                <FieldGrid>
                  <Field label="Name"><input className="ops-input" name="name" required /></Field>
                  <Field label="Type">
                    <select className="ops-input" name="type">
                      {['discretionary', 'cis', 'private_markets', 'treasury', 'advisory'].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                </FieldGrid>
              </FormModal>
            )}
            {dialog === 'account' && (
              <FormModal title="Add cash account" kicker={c.name} subtitle="Created as a draft; submit it for approval by a different person." submitLabel="Add account" onClose={() => setDialog(null)} onDone={done}
                onSubmit={(fd) => rawPost('/api/v1/cash-accounts', { clientId: c.id, provider: str(fd, 'provider'), identifier: str(fd, 'identifier'), currency: str(fd, 'currency') || c.ccy, ownership: str(fd, 'ownership') || 'SEGREGATED' })}>
                <FieldGrid>
                  <Field label="Bank / provider"><input className="ops-input" name="provider" required /></Field>
                  <Field label="Account identifier" hint="Stored encrypted; shown masked"><input className="ops-input" name="identifier" required minLength={2} /></Field>
                  <Field label="Currency"><input className="ops-input" name="currency" defaultValue={c.ccy} maxLength={3} /></Field>
                  <Field label="Ownership">
                    <select className="ops-input" name="ownership">{['SEGREGATED', 'OMNIBUS', 'HYBRID'].map((t) => <option key={t}>{t}</option>)}</select>
                  </Field>
                </FieldGrid>
              </FormModal>
            )}
          </Card>
        );
      }}
    </Loaded>
  );
}

interface ChangeReq {
  id: string;
  kind: string;
  client: string | null;
  clientRef: string | null;
  mandate: string | null;
  mandateName: string | null;
  from: string;
  to: string;
  reason: string;
  maker: string | null;
  makerId: string;
  createdAt: string;
}

/** Pending maker-checker requests: dealing-hold releases and mandate activation or closure. */
function ChangeRequests({ onChanged }: { onChanged: () => void }) {
  const { user } = useSession();
  const canApprove = useCan('onboarding.approve');
  const res = useResource<ChangeReq[]>(() => coGet<{ data: ChangeReq[] }>('/change-requests', { status: 'PENDING' }).then(asList), []);
  const [act, setAct] = useState<{ r: ChangeReq; kind: 'approve' | 'reject' } | null>(null);
  const done = () => { res.reload(); onChanged(); };
  return (
    <Loaded res={res} what="pending approvals">
      {(rows) =>
        rows.length === 0 ? null : (
          <Card title={`Pending approvals (${rows.length})`}>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead><tr><th>Client</th><th>Change</th><th>Reason</th><th>Requested by</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.client}</strong><span className="ops-sub">{r.clientRef}</span></td>
                      <td>{r.kind === 'DEALING_HOLD_RELEASE' ? 'Release dealing hold' : `Mandate ${r.mandate ?? ''}: ${r.from} to ${r.to}`}</td>
                      <td>{r.reason}</td>
                      <td>{r.maker}<span className="ops-sub">{formatDate(r.createdAt)}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canApprove && r.makerId !== user.id && (
                          <>
                            <button className="ops-btn small primary" type="button" onClick={() => setAct({ r, kind: 'approve' })}>Approve</button>{' '}
                            <button className="ops-btn small" type="button" onClick={() => setAct({ r, kind: 'reject' })}>Reject</button>
                          </>
                        )}
                        {r.makerId === user.id && <ActionButton label="Withdraw" onRun={() => coPost(`/change-requests/${r.id}/withdraw`, {})} onDone={done} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {act && (
              <FormModal title={`${act.kind === 'approve' ? 'Approve' : 'Reject'}: ${act.r.client}`} subtitle={act.kind === 'approve' ? 'Needs a fresh authentication code. The change is applied immediately.' : undefined} submitLabel={act.kind === 'approve' ? 'Approve and apply' : 'Reject'} danger={act.kind === 'reject'} onClose={() => setAct(null)} onDone={done}
                onSubmit={(fd, key) => coPost(`/change-requests/${act.r.id}/${act.kind}`, { note: str(fd, 'note') }, key)}>
                <Field label="Note"><textarea className="ops-input" name="note" required minLength={5} maxLength={500} /></Field>
              </FormModal>
            )}
          </Card>
        )
      }
    </Loaded>
  );
}
