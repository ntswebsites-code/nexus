'use client';

import { useState } from 'react';
import { asList, coGet, coPost, NoAccess, rawGet, Tabs, Tile, Tone } from '@/ops/clientops';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

interface Doc {
  id: string;
  name: string;
  type: string;
  classification: string;
  status: string;
  client: string | null;
  clientRef: string | null;
  fund: string | null;
  fundRef: string | null;
  date: string;
  versions: number;
  retentionYears: number;
  retainUntil: string;
  retention: string;
  held: boolean;
  pendingChanges: number;
}
interface Summary {
  total: number;
  byClassification: Record<string, number>;
  retention: Record<string, number>;
  held: number;
  pendingChanges: number;
  accessLast7Days: number;
}
interface Change { id: string; document: string | null; name: string | null; kind: string; from: string; to: string; reason: string; status: string; maker: string | null; makerId: string; at: string }
interface Detail {
  document: Doc & { label: string | null; relatedLabel: string | null; period: string | null };
  versions: { version: number; sha256: string; file: string | null; size: string; scan: string | null; by: string | null; at: string }[];
  holds: { id: string; reason: string; placedBy: string | null; placedById: string; placedAt: string; releasedAt: string | null; releasedBy: string | null; releaseNote: string | null }[];
  changes: Change[];
  published: { client: string | null; clientRef: string | null; at: string }[];
  accessLog: { id: string; action: string; by: string | null; at: string; ip: string | null }[];
}

const CLASSES = ['Public', 'Client', 'Internal', 'Restricted'];
const TYPES = ['report', 'statement', 'capital', 'legal', 'tax', 'kyc', 'company', 'research', 'ic', 'clients', 'compliance', 'valuations', 'other'];

export default function VaultPage() {
  const canView = useCan('documents.view');
  const canApprove = useCan('documents.approve');
  const [tab, setTab] = useState<'register' | 'changes' | 'access'>('register');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [cls, setCls] = useState('');
  const [retention, setRetention] = useState('');
  const [client, setClient] = useState('');
  const [fund, setFund] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const summary = useResource<Summary>(() => coGet<Summary>('/vault/summary'), []);
  const list = useResource<Doc[]>(() => coGet<{ data: Doc[] }>('/vault/documents', { q, type, classification: cls, retention, client, fund }).then(asList), [q, type, cls, retention, client, fund]);
  const clients = useResource<{ id: string; name: string }[]>(() => rawGet<{ data: { id: string; name: string }[] }>('/api/v1/clients').then(asList), []);
  const funds = useResource<{ id: string; ref?: string; name: string }[]>(() => rawGet<{ data: { id: string; ref?: string; name: string }[] } | { id: string; ref?: string; name: string }[]>('/api/v1/ops/funds').then(asList).catch(() => []), []);
  const reload = () => { list.reload(); summary.reload(); };
  if (!canView) return <NoAccess kicker="Clients" title="Document Vault" perm="documents.view" />;
  return (
    <>
      <PageHeader kicker="Clients" title="Document Vault" subtitle="Register of every document with classification, retention, legal holds, versions and access history, linked to clients and funds." />
      <Loaded res={summary} what="vault summary">
        {(s) => (
          <div className="ops-tiles">
            <Tile label="Documents" value={s.total} hint={`${s.byClassification.Restricted ?? 0} restricted`} />
            <Tile label="On legal hold" value={s.held} warn={s.held > 0} />
            <Tile label="Disposal eligible" value={s.retention['Disposal eligible'] ?? 0} hint={`${s.retention['Due within 90 days'] ?? 0} due within 90 days`} />
            <Tile label="Changes awaiting approval" value={s.pendingChanges} warn={s.pendingChanges > 0} />
            <Tile label="Accesses, last 7 days" value={s.accessLast7Days} />
          </div>
        )}
      </Loaded>
      <Tabs tabs={[{ key: 'register', label: 'Register' }, { key: 'changes', label: 'Pending changes' }, ...(canApprove ? [{ key: 'access' as const, label: 'Access log' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'register' && (
        <Card title="Documents">
          <div className="ops-filters">
            <Field label="Search"><input className="ops-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, reference or related item" /></Field>
            <Field label="Type"><select className="ops-input" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Classification"><select className="ops-input" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All</option>{CLASSES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Retention"><select className="ops-input" value={retention} onChange={(e) => setRetention(e.target.value)}><option value="">All</option>{['Held', 'Disposal eligible', 'Due within 90 days', 'Retained'].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Client"><select className="ops-input" value={client} onChange={(e) => setClient(e.target.value)}><option value="">All</option>{(clients.state === 'ok' ? clients.data : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Fund"><select className="ops-input" value={fund} onChange={(e) => setFund(e.target.value)}><option value="">All</option>{(funds.state === 'ok' ? funds.data : []).filter((f) => f.ref).map((f) => <option key={f.id} value={f.ref}>{f.name}</option>)}</select></Field>
          </div>
          <Loaded res={list} what="documents">
            {(rows) =>
              rows.length === 0 ? <Empty>No documents match.</Empty> : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Document</th><th>Type</th><th>Classification</th><th>Linked to</th><th className="r">Ver.</th><th>Retention</th><th>Status</th></tr></thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                          <td><strong>{d.name}</strong><span className="ops-sub">{d.id} · {formatDate(d.date)}</span></td>
                          <td>{d.type}</td>
                          <td><Tone value={d.classification} />{d.pendingChanges > 0 && <span className="ops-sub">change pending</span>}</td>
                          <td>{d.client ?? '-'}{d.fund && <span className="ops-sub">{d.fund}</span>}</td>
                          <td className="r">{d.versions}</td>
                          <td><Tone value={d.retention} /><span className="ops-sub">{d.retentionYears}y · until {formatDate(d.retainUntil)}</span></td>
                          <td>{d.status}</td>
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
      {tab === 'changes' && <Changes onDone={reload} />}
      {tab === 'access' && <AccessLog />}
      {open && <DocModal id={open} clients={clients.state === 'ok' ? clients.data : []} funds={(funds.state === 'ok' ? funds.data : []).filter((f) => f.ref)} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

function Changes({ onDone }: { onDone: () => void }) {
  const approve = useCan('documents.approve');
  const { user } = useSession();
  const res = useResource<Change[]>(() => coGet<{ data: Change[] }>('/vault/changes', { status: 'PENDING' }).then(asList), []);
  const [dlg, setDlg] = useState<{ id: string; approve: boolean } | null>(null);
  return (
    <Card title="Changes awaiting a checker">
      <Loaded res={res} what="pending changes">
        {(rows) =>
          rows.length === 0 ? <Empty>Nothing awaiting approval.</Empty> : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead><tr><th>Document</th><th>Change</th><th>Reason</th><th>Maker</th><th>When</th><th /></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong><span className="ops-sub">{c.document}</span></td>
                      <td>{c.kind.toLowerCase()}: {c.from} to <strong>{c.to}</strong></td>
                      <td>{c.reason}</td>
                      <td>{c.maker}</td>
                      <td>{formatDateTime(c.at)}</td>
                      <td>
                        {approve && c.makerId !== user.id ? (
                          <>
                            <button className="ops-btn small primary" type="button" onClick={() => setDlg({ id: c.id, approve: true })}>Approve</button>{' '}
                            <button className="ops-btn small" type="button" onClick={() => setDlg({ id: c.id, approve: false })}>Reject</button>
                          </>
                        ) : c.makerId === user.id ? <span className="ops-sub">Awaiting a different approver</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {dlg && (
        <FormModal title={dlg.approve ? 'Approve change' : 'Reject change'} kicker="Document Vault" subtitle={dlg.approve ? 'Applies the change. Needs a fresh authentication code.' : undefined} submitLabel={dlg.approve ? 'Approve' : 'Reject'} danger={!dlg.approve} onClose={() => setDlg(null)} onDone={() => { res.reload(); onDone(); }}
          onSubmit={(fd) => coPost(`/vault/changes/${dlg.id}/${dlg.approve ? 'approve' : 'reject'}`, { note: str(fd, 'note') })}>
          <Field label="Note"><textarea className="ops-input" name="note" required minLength={5} /></Field>
        </FormModal>
      )}
    </Card>
  );
}

function AccessLog() {
  const res = useResource<{ id: string; document: string | null; name: string | null; action: string; by: string | null; at: string; ip: string | null }[]>(() => coGet<{ data: never[] }>('/vault/access-log').then(asList), []);
  return (
    <Card title="Recent document access">
      <Loaded res={res} what="the access log">
        {(rows) =>
          rows.length === 0 ? <Empty>No access recorded yet.</Empty> : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead><tr><th>When</th><th>Document</th><th>Action</th><th>User</th><th>IP</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}><td>{formatDateTime(r.at)}</td><td><strong>{r.name}</strong><span className="ops-sub">{r.document}</span></td><td>{r.action}</td><td>{r.by ?? '-'}</td><td>{r.ip ?? '-'}</td></tr>
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

type Dlg = 'classification' | 'retention' | 'hold' | 'link' | { release: string } | null;

function DocModal({ id, clients, funds, onClose, onChanged }: { id: string; clients: { id: string; name: string }[]; funds: { id: string; ref?: string; name: string }[]; onClose: () => void; onChanged: () => void }) {
  const edit = useCan('documents.edit');
  const approve = useCan('documents.approve');
  const { user } = useSession();
  const res = useResource<Detail>(() => coGet<Detail>(`/vault/documents/${encodeURIComponent(id)}`), [id]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [tab, setTab] = useState<'versions' | 'access' | 'changes'>('versions');
  const done = () => { res.reload(); onChanged(); };
  async function download(version: number) {
    const r = await coGet<{ url: string }>(`/vault/documents/${encodeURIComponent(id)}/download-url`, { version: String(version) });
    window.open(r.url, '_blank', 'noopener');
    res.reload();
  }
  return (
    <Modal title="Document" kicker="Document Vault" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="the document">
          {(d) => {
            const doc = d.document;
            const hold = d.holds.find((h) => !h.releasedAt);
            return (
              <>
                <h2 style={{ margin: 0 }}>{doc.name} <Tone value={doc.classification} /> {doc.held && <Tone value="Held" />}</h2>
                <p className="ops-muted">{doc.id} · {doc.type} · {doc.status}</p>
                <dl className="ops-dl">
                  {([['Client', doc.client ?? '-'], ['Fund', doc.fund ?? '-'], ['Related', doc.relatedLabel ?? '-'], ['Retention', `${doc.retentionYears} years, until ${formatDate(doc.retainUntil)}`], ['Retention state', <Tone key="r" value={doc.retention} />], ['Published to', d.published.map((p) => p.client).join(', ') || 'Nobody']] as [string, React.ReactNode][]).map(([k, v]) => (
                    <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
                {hold && <Alert kind="warn">Legal hold since {formatDateTime(hold.placedAt)} by {hold.placedBy}: {hold.reason}</Alert>}
                <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {edit && <button className="ops-btn" type="button" onClick={() => setDlg('classification')}>Change classification</button>}
                  {edit && <button className="ops-btn" type="button" onClick={() => setDlg('retention')}>Change retention</button>}
                  {edit && <button className="ops-btn" type="button" onClick={() => setDlg('link')}>Link client / fund</button>}
                  {edit && !hold && <button className="ops-btn" type="button" onClick={() => setDlg('hold')}>Place legal hold</button>}
                  {approve && hold && hold.placedById !== user.id && <button className="ops-btn" type="button" onClick={() => setDlg({ release: hold.id })}>Release legal hold</button>}
                </p>
                <Tabs tabs={[{ key: 'versions', label: `Versions (${d.versions.length})` }, { key: 'access', label: `Access (${d.accessLog.length})` }, { key: 'changes', label: `Changes & holds (${d.changes.length + d.holds.length})` }]} value={tab} onChange={setTab} />
                {tab === 'versions' && (
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead><tr><th>Version</th><th>File</th><th>Size</th><th>SHA-256</th><th>Uploaded</th><th /></tr></thead>
                      <tbody>
                        {d.versions.map((v) => (
                          <tr key={v.version}>
                            <td>v{v.version}</td><td>{v.file}</td><td>{v.size}</td>
                            <td><code title={v.sha256}>{v.sha256.slice(0, 12)}</code></td>
                            <td>{formatDateTime(v.at)}{v.by ? ` · ${v.by}` : ''}</td>
                            <td><ActionButton label="Download" onRun={() => download(v.version)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {tab === 'access' && (d.accessLog.length === 0 ? <Empty>No access recorded.</Empty> : (
                  <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>When</th><th>Action</th><th>User</th><th>IP</th></tr></thead><tbody>
                    {d.accessLog.map((a) => <tr key={a.id}><td>{formatDateTime(a.at)}</td><td>{a.action}</td><td>{a.by ?? 'Investor user'}</td><td>{a.ip ?? '-'}</td></tr>)}
                  </tbody></table></div>
                ))}
                {tab === 'changes' && (
                  <>
                    {d.changes.map((c) => <p key={c.id}><Tone value={c.status} /> {c.kind.toLowerCase()}: {c.from} to {c.to} - {c.reason} <span className="ops-sub">{c.maker}</span></p>)}
                    {d.holds.map((h) => <p key={h.id}><Tone value={h.releasedAt ? 'Released' : 'Held'} /> {h.reason} <span className="ops-sub">placed {formatDateTime(h.placedAt)} by {h.placedBy}{h.releasedAt ? `; released ${formatDateTime(h.releasedAt)} by ${h.releasedBy}: ${h.releaseNote}` : ''}</span></p>)}
                    {d.changes.length + d.holds.length === 0 && <Empty>No changes or holds.</Empty>}
                  </>
                )}

                {(dlg === 'classification' || dlg === 'retention') && (
                  <FormModal title={dlg === 'classification' ? 'Change classification' : 'Change retention'} kicker={doc.id} subtitle="Goes to a different approver before it takes effect." submitLabel="Submit for approval" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd, key) => coPost(`/vault/documents/${doc.id}/changes`, { kind: dlg === 'classification' ? 'CLASSIFICATION' : 'RETENTION', to: dlg === 'classification' ? str(fd, 'to') : Number(str(fd, 'to')), reason: str(fd, 'reason') }, key)}>
                    <FieldGrid>
                      <Field label={dlg === 'classification' ? 'New classification' : 'Retention (years)'}>
                        {dlg === 'classification'
                          ? <select className="ops-input" name="to" defaultValue={doc.classification}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>
                          : <input className="ops-input" name="to" type="number" min={1} max={50} defaultValue={doc.retentionYears} required />}
                      </Field>
                      <Field label="Reason" span={2}><textarea className="ops-input" name="reason" required minLength={5} /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {dlg === 'hold' && (
                  <FormModal title="Place legal hold" kicker={doc.id} subtitle="Blocks retention shortening and disposal until a different person releases it." submitLabel="Place hold" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd, key) => coPost(`/vault/documents/${doc.id}/hold`, { reason: str(fd, 'reason') }, key)}>
                    <Field label="Reason"><textarea className="ops-input" name="reason" required minLength={5} /></Field>
                  </FormModal>
                )}
                {typeof dlg === 'object' && dlg !== null && 'release' in dlg && (
                  <FormModal title="Release legal hold" kicker={doc.id} subtitle="Needs a fresh authentication code." submitLabel="Release" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd) => coPost(`/vault/holds/${dlg.release}/release`, { note: str(fd, 'note') })}>
                    <Field label="Note"><textarea className="ops-input" name="note" required minLength={5} /></Field>
                  </FormModal>
                )}
                {dlg === 'link' && (
                  <FormModal title="Link document" kicker={doc.id} submitLabel="Save links" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd) => coPost(`/vault/documents/${doc.id}/link`, { clientId: optStr(fd, 'clientId') ?? null, fundId: optStr(fd, 'fundId') ?? null })}>
                    <FieldGrid>
                      <Field label="Client"><select className="ops-input" name="clientId" defaultValue={doc.clientRef ?? ''}><option value="">None</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                      <Field label="Fund"><select className="ops-input" name="fundId" defaultValue={doc.fundRef ?? ''}><option value="">None</option>{funds.map((f) => <option key={f.id} value={f.ref}>{f.name}</option>)}</select></Field>
                    </FieldGrid>
                  </FormModal>
                )}
              </>
            );
          }}
        </Loaded>
      </div>
    </Modal>
  );
}
