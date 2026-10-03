'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, apiBase, apiRequest, describeError, OpsError, qs, v1 } from './api';
import { Badge, downloadCsv } from './admin-core';
import { Tiles } from './suite';
import { useCan } from './session';
import { Alert, Card, DefinitionList, Empty, Field, FieldGrid, formatDateTime, FormModal, Loaded, Modal, PageHeader, useAction, useResource } from './ui';

/** Native e-signature console: requests, create wizard, status, resend, void, sealed PDF and certificate. */

export interface Signer {
  id: string;
  orderNo: number;
  kind: string;
  userId: string | null;
  name: string;
  email: string;
  roleLabel: string | null;
  status: string;
  identityMethod: string | null;
  notifiedAt: string | null;
  reminderCount: number;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  signatureMode: string | null;
  ip: string | null;
  chainHash: string | null;
}
export interface EsignRequest {
  id: string;
  ref: string;
  title: string;
  message: string | null;
  status: string;
  signingOrder: string;
  subjectType: string | null;
  subjectId: string | null;
  originalSha256: string;
  sealedSha256: string | null;
  chainHead: string | null;
  hasSealed: boolean;
  hasCertificate: boolean;
  expiresAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  voidReason: string | null;
  declineReason: string | null;
  createdAt: string;
  progress: { signed: number; total: number };
  signers: Signer[];
  events?: { id: string; type: string; at: string; who: string | null; ip: string | null; hash: string }[];
}
interface ListResponse {
  data: EsignRequest[];
  counts: Record<string, number>;
}
interface DirEntry {
  userId: string;
  name: string;
  email: string;
  kind: string;
  org?: string;
  role?: string;
  clientId?: string;
  companyId?: string;
}
interface DocEntry {
  id: string;
  ref: string;
  name: string;
  type: string;
  version: number;
}

const TONE: Record<string, 'grey' | 'amber' | 'blue' | 'green' | 'red'> = {
  DRAFT: 'grey',
  PENDING: 'amber',
  WAITING: 'grey',
  COMPLETED: 'green',
  SIGNED: 'green',
  DECLINED: 'red',
  VOIDED: 'grey',
  EXPIRED: 'red',
};
const Status = ({ s }: { s: string }) => <Badge tone={TONE[s] ?? 'grey'}>{s.toLowerCase()}</Badge>;
const KIND: Record<string, string> = { STAFF: 'Staff', LP: 'LP signatory', INVESTEE: 'Investee', EXTERNAL: 'External (e-mail link)' };
const esign = (p: string) => v1(`/esign${p}`);

async function uploadPdf(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/v1/uploads`, { method: 'POST', body: fd, credentials: 'include' });
  } catch {
    throw new OpsError(0, 'network_error', 'The API could not be reached.');
  }
  const json = (await res.json().catch(() => ({}))) as { files?: { id: string }[]; error?: { message?: string } };
  if (!res.ok || !json.files?.[0]) throw new Error(json.error?.message ?? `Upload failed (${res.status})`);
  return json.files[0].id;
}

export function EsignScreen() {
  const can = useCan('esign.view');
  const canManage = useCan('esign.manage');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const res = useResource<ListResponse>(() => apiRequest<ListResponse>('GET', esign(`/requests${qs({ status, q })}`)), [status, q]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [flow, setFlow] = useState<'commitment' | 'capital-call-ack' | null>(null);
  const [verify, setVerify] = useState(false);

  if (!can) {
    return (
      <>
        <PageHeader kicker="Operations" title="E-signatures" />
        <Alert>Your role does not include e-signatures. Ask an administrator for the esign.view permission.</Alert>
      </>
    );
  }
  const counts = res.state === 'ok' ? res.data.counts : {};

  return (
    <>
      <PageHeader
        kicker="Operations"
        title="E-signatures"
        subtitle="Native signing on PDFs from the document store: ordered or parallel signers, identity checks, SHA-256 hash chain, sealed PDF and certificate of completion."
        actions={
          <>
            <button className="ops-btn" type="button" onClick={() => setVerify(true)}>
              Verify a document
            </button>{' '}
            {canManage && (
              <>
                <button className="ops-btn" type="button" onClick={() => setFlow('commitment')}>
                  LP commitment agreement
                </button>{' '}
                <button className="ops-btn" type="button" onClick={() => setFlow('capital-call-ack')}>
                  Capital call acknowledgement
                </button>{' '}
                <button className="ops-btn primary" type="button" onClick={() => setWizard(true)}>
                  New signature request
                </button>
              </>
            )}
          </>
        }
      />
      <Tiles
        items={(['PENDING', 'COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED', 'DRAFT'] as const).map((k) => ({
          label: k.charAt(0) + k.slice(1).toLowerCase(),
          value: counts[k] ?? 0,
          tone: k === 'DECLINED' || k === 'EXPIRED' ? ('red' as const) : k === 'PENDING' ? ('amber' as const) : undefined,
        }))}
      />
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(draftQ.trim());
          }}
          className="ops-filters"
        >
          <Field label="Search">
            <input className="ops-input" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Reference, title, signer name or e-mail" />
          </Field>
          <Field label="Status">
            <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {['DRAFT', 'PENDING', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <button className="ops-btn primary" type="submit">
            Search
          </button>
        </form>
        <Loaded res={res} what="signature requests">
          {(d) =>
            d.data.length === 0 ? (
              <Empty>No signature requests match.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Document</th>
                      <th>Subject</th>
                      <th>Signed</th>
                      <th>Status</th>
                      <th>Expires</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                        <td>{r.ref}</td>
                        <td>
                          {r.title}
                          <div className="ops-muted">{r.signers.map((s) => s.name).join(', ')}</div>
                        </td>
                        <td>{r.subjectType ? `${r.subjectType.replace(/_/g, ' ').toLowerCase()}` : 'Document'}</td>
                        <td>
                          {r.progress.signed}/{r.progress.total}
                          <div className="ops-muted">{r.signingOrder.toLowerCase()}</div>
                        </td>
                        <td>
                          <Status s={r.status} />
                        </td>
                        <td>{r.status === 'PENDING' ? formatDateTime(r.expiresAt) : r.completedAt ? `done ${formatDateTime(r.completedAt)}` : '-'}</td>
                        <td>
                          <button className="ops-btn small" type="button" onClick={() => setOpenId(r.id)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {openId && <DetailModal id={openId} onClose={() => setOpenId(null)} onChanged={res.reload} />}
      {wizard && <Wizard onClose={() => setWizard(false)} onCreated={(id) => { res.reload(); setOpenId(id); }} />}
      {flow && <FlowModal flow={flow} onClose={() => setFlow(null)} onCreated={(id) => { res.reload(); setOpenId(id); }} />}
      {verify && <VerifyModal onClose={() => setVerify(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ detail

function DetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const canManage = useCan('esign.manage');
  const canVoid = useCan('esign.void');
  const res = useResource<{ request: EsignRequest }>(() => api.get<{ request: EsignRequest }>(esign(`/requests/${id}`)), [id]);
  const [voiding, setVoiding] = useState(false);
  const [report, setReport] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } | null>(null);
  const act = useAction();
  const dl = (variant: string, name: string) => downloadCsv(esign(`/requests/${id}/${variant}`), name).catch((e: Error) => window.alert(e.message));
  const after = () => {
    res.reload();
    onChanged();
  };

  return (
    <Modal wide title="Signature request" kicker="E-signature" onClose={onClose}>
      <div className="ops-modal-body">
        <Loaded res={res} what="the request">
          {({ request: r }) => (
            <>
              <h3 style={{ margin: '0 0 6px' }}>
                {r.ref} <Status s={r.status} />
              </h3>
              <p>{r.title}</p>
              <DefinitionList
                items={[
                  ['Order', r.signingOrder === 'SEQUENTIAL' ? 'Sequential (by group)' : 'Parallel'],
                  ['Subject', r.subjectType ? `${r.subjectType} ${r.subjectId ?? ''}` : 'Document'],
                  ['Sent', formatDateTime(r.sentAt)],
                  ['Expires', formatDateTime(r.expiresAt)],
                  ['Completed', formatDateTime(r.completedAt)],
                  ['Original SHA-256', <code key="o" style={{ wordBreak: 'break-all' }}>{r.originalSha256}</code>],
                  ['Sealed SHA-256', r.sealedSha256 ? <code key="s" style={{ wordBreak: 'break-all' }}>{r.sealedSha256}</code> : 'Not sealed yet'],
                  ['Signature chain head', r.chainHead ? <code key="c" style={{ wordBreak: 'break-all' }}>{r.chainHead}</code> : '-'],
                  ...(r.voidReason ? ([['Void reason', r.voidReason]] as [string, string][]) : []),
                  ...(r.declineReason ? ([['Decline reason', r.declineReason]] as [string, string][]) : []),
                ]}
              />
              <h4>Signers</h4>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Signer</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Identity</th>
                      <th>Signed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.signers.map((s) => (
                      <tr key={s.id}>
                        <td>{s.orderNo}</td>
                        <td>
                          {s.name}
                          <div className="ops-muted">{s.email}</div>
                          {s.roleLabel && <div className="ops-muted">{s.roleLabel}</div>}
                        </td>
                        <td>{KIND[s.kind] ?? s.kind}</td>
                        <td>
                          <Status s={s.status} />
                          {s.status === 'PENDING' && <div className="ops-muted">{s.viewedAt ? 'viewed' : 'not opened'}{s.reminderCount ? `, ${s.reminderCount} reminder(s)` : ''}</div>}
                          {s.declineReason && <div className="ops-muted">{s.declineReason}</div>}
                        </td>
                        <td>{s.identityMethod === 'SESSION' ? 'Signed-in session' : s.identityMethod === 'EMAIL_OTP' ? 'E-mail code' : '-'}</td>
                        <td>
                          {formatDateTime(s.signedAt)}
                          {s.ip && <div className="ops-muted">{s.ip}</div>}
                        </td>
                        <td>
                          {canManage && r.status === 'PENDING' && s.status === 'PENDING' && (
                            <button className="ops-btn small" type="button" disabled={act.busy} onClick={async () => { if ((await act.run(() => api.post(esign(`/requests/${id}/resend`), { signerId: s.id }))) !== undefined) after(); }}>
                              Resend
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Alert>{act.error}</Alert>
              {report && (
                <Alert kind={report.ok ? 'ok' : 'error'}>
                  {report.ok ? 'Integrity verified: ' : 'Integrity problem: '}
                  {report.checks.map((c) => `${c.name} ${c.ok ? 'ok' : `FAILED${c.detail ? ` (${c.detail})` : ''}`}`).join(' · ')}
                </Alert>
              )}
              <h4>Audit trail</h4>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <tbody>
                    {(r.events ?? []).map((e) => (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.at)}</td>
                        <td>{e.type}</td>
                        <td>{e.who ?? ''}</td>
                        <td className="ops-muted">{e.ip ?? ''}</td>
                        <td className="ops-muted"><code>{e.hash.slice(0, 12)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <button className="ops-btn" type="button" onClick={() => dl('original', `${r.ref}-original.pdf`)}>
                  Download original
                </button>
                <button className="ops-btn" type="button" disabled={!r.hasSealed} onClick={() => dl('sealed', `${r.ref}-signed.pdf`)}>
                  Download sealed PDF
                </button>
                <button className="ops-btn" type="button" disabled={!r.hasCertificate} onClick={() => dl('certificate', `${r.ref}-certificate.pdf`)}>
                  Download certificate
                </button>
                <button className="ops-btn" type="button" disabled={act.busy} onClick={async () => { const v = await act.run(() => api.get<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] }>(esign(`/requests/${id}/verify`))); if (v) setReport(v); }}>
                  Verify integrity
                </button>
                {canManage && r.status === 'DRAFT' && (
                  <button className="ops-btn primary" type="button" disabled={act.busy} onClick={async () => { if ((await act.run(() => api.post(esign(`/requests/${id}/send`), {}))) !== undefined) after(); }}>
                    Send for signature
                  </button>
                )}
                {canManage && r.status === 'PENDING' && (
                  <button className="ops-btn" type="button" disabled={act.busy} onClick={async () => { if ((await act.run(() => api.post(esign(`/requests/${id}/resend`), {}))) !== undefined) after(); }}>
                    Remind everyone due
                  </button>
                )}
                {canVoid && !['COMPLETED', 'VOIDED'].includes(r.status) && (
                  <button className="ops-btn danger" type="button" onClick={() => setVoiding(true)}>
                    Void request
                  </button>
                )}
              </div>
              {voiding && (
                <FormModal
                  danger
                  title={`Void ${r.ref}`}
                  kicker="E-signature"
                  subtitle="Signers are told the request was withdrawn. A completed request can never be voided."
                  submitLabel="Void request"
                  onClose={() => setVoiding(false)}
                  onSubmit={(fd) => api.post(esign(`/requests/${id}/void`), { reason: String(fd.get('reason') ?? '') })}
                  onDone={after}
                >
                  <Field label="Reason">
                    <input className="ops-input" name="reason" required minLength={3} maxLength={500} />
                  </Field>
                </FormModal>
              )}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ wizard

interface DraftSigner {
  key: string;
  kind: string;
  userId?: string;
  name: string;
  email: string;
  roleLabel?: string;
  orderNo: number;
  clientId?: string;
  companyId?: string;
}

function Wizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState(1);
  const [source, setSource] = useState<'store' | 'upload'>('store');
  const [docQ, setDocQ] = useState('');
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [doc, setDoc] = useState<DocEntry | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState<'PARALLEL' | 'SEQUENTIAL'>('PARALLEL');
  const [days, setDays] = useState(14);
  const [signers, setSigners] = useState<DraftSigner[]>([]);
  const [kind, setKind] = useState('STAFF');
  const [dirQ, setDirQ] = useState('');
  const [dir, setDir] = useState<DirEntry[]>([]);
  const [ext, setExt] = useState({ name: '', email: '', role: '' });
  const act = useAction();

  useEffect(() => {
    if (source !== 'store') return;
    const t = setTimeout(() => {
      api.get<DocEntry[]>(esign(`/documents${qs({ q: docQ })}`)).then(setDocs).catch(() => setDocs([]));
    }, 250);
    return () => clearTimeout(t);
  }, [docQ, source]);

  useEffect(() => {
    if (kind === 'EXTERNAL') return;
    const t = setTimeout(() => {
      api.get<DirEntry[]>(esign(`/directory${qs({ kind, q: dirQ })}`)).then(setDir).catch(() => setDir([]));
    }, 250);
    return () => clearTimeout(t);
  }, [kind, dirQ]);

  const addSigner = useCallback(
    (s: Omit<DraftSigner, 'key' | 'orderNo'>) => setSigners((prev) => (prev.some((p) => p.email.toLowerCase() === s.email.toLowerCase()) ? prev : [...prev, { ...s, key: `${s.email}-${prev.length}`, orderNo: prev.length + 1 }])),
    [],
  );

  const step1Ok = (source === 'store' ? !!doc : !!file) && title.trim().length >= 3;
  const submit = async (send: boolean) => {
    const r = await act.run(async () => {
      const fileId = source === 'upload' && file ? await uploadPdf(file) : undefined;
      return api.post<{ request: EsignRequest }>(esign('/requests'), {
        title: title.trim(),
        message: message.trim() || undefined,
        documentId: source === 'store' ? doc?.id : undefined,
        fileId,
        signingOrder: order,
        expiresInDays: days,
        send,
        signers: signers.map((s) => ({ kind: s.kind, userId: s.userId, name: s.name, email: s.email, roleLabel: s.roleLabel, orderNo: s.orderNo, clientId: s.clientId, companyId: s.companyId })),
      });
    });
    if (r) {
      onCreated(r.request.id);
      onClose();
    }
  };

  return (
    <Modal wide title="New signature request" kicker={`Step ${step} of 3`} onClose={onClose}>
      <div className="ops-modal-body">
        {step === 1 && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className={`ops-btn${source === 'store' ? ' primary' : ''}`} type="button" onClick={() => setSource('store')}>
                From the document store
              </button>
              <button className={`ops-btn${source === 'upload' ? ' primary' : ''}`} type="button" onClick={() => setSource('upload')}>
                Upload a PDF
              </button>
            </div>
            {source === 'store' ? (
              <>
                <Field label="Search documents">
                  <input className="ops-input" value={docQ} onChange={(e) => setDocQ(e.target.value)} placeholder="Name or reference" />
                </Field>
                <div className="ops-table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
                  <table className="ops-table">
                    <tbody>
                      {docs.map((d) => (
                        <tr key={d.id} className={`clickable${doc?.id === d.id ? ' selected' : ''}`} onClick={() => { setDoc(d); if (!title) setTitle(d.name); }}>
                          <td>{d.ref}</td>
                          <td>{d.name}</td>
                          <td className="ops-muted">{d.type} v{d.version}</td>
                        </tr>
                      ))}
                      {!docs.length && (
                        <tr>
                          <td className="ops-muted">No PDF documents found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Field label="PDF file" hint="Unencrypted PDF, up to the platform upload limit.">
                <input className="ops-input" type="file" accept="application/pdf,.pdf" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.pdf$/i, '')); }} />
              </Field>
            )}
            <FieldGrid>
              <Field label="Title" span={2}>
                <input className="ops-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Message to signers" span={2}>
                <input className="ops-input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
              </Field>
              <Field label="Signing order">
                <select className="ops-input" value={order} onChange={(e) => setOrder(e.target.value as 'PARALLEL' | 'SEQUENTIAL')}>
                  <option value="PARALLEL">Parallel (everyone at once)</option>
                  <option value="SEQUENTIAL">Sequential (by order number)</option>
                </select>
              </Field>
              <Field label="Expires in (days)">
                <input className="ops-input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value) || 14)} />
              </Field>
            </FieldGrid>
          </>
        )}
        {step === 2 && (
          <>
            <FieldGrid>
              <Field label="Signer type">
                <select className="ops-input" value={kind} onChange={(e) => { setKind(e.target.value); setDir([]); }}>
                  {Object.entries(KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              {kind !== 'EXTERNAL' && (
                <Field label="Search people">
                  <input className="ops-input" value={dirQ} onChange={(e) => setDirQ(e.target.value)} placeholder="Name or e-mail" />
                </Field>
              )}
            </FieldGrid>
            {kind === 'EXTERNAL' ? (
              <FieldGrid>
                <Field label="Full name">
                  <input className="ops-input" value={ext.name} onChange={(e) => setExt({ ...ext, name: e.target.value })} />
                </Field>
                <Field label="E-mail">
                  <input className="ops-input" type="email" value={ext.email} onChange={(e) => setExt({ ...ext, email: e.target.value })} />
                </Field>
                <Field label="Capacity (optional)">
                  <input className="ops-input" value={ext.role} onChange={(e) => setExt({ ...ext, role: e.target.value })} />
                </Field>
                <button className="ops-btn" type="button" disabled={!ext.name.trim() || !/^\S+@\S+\.\S+$/.test(ext.email)} onClick={() => { addSigner({ kind: 'EXTERNAL', name: ext.name.trim(), email: ext.email.trim(), roleLabel: ext.role.trim() || undefined }); setExt({ name: '', email: '', role: '' }); }}>
                  Add external signer
                </button>
              </FieldGrid>
            ) : (
              <div className="ops-table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}>
                <table className="ops-table">
                  <tbody>
                    {dir.map((d) => (
                      <tr key={`${d.userId}${d.clientId ?? ''}${d.companyId ?? ''}`}>
                        <td>
                          {d.name}
                          <div className="ops-muted">{d.email}</div>
                        </td>
                        <td className="ops-muted">
                          {d.org}
                          <div>{d.role}</div>
                        </td>
                        <td>
                          <button className="ops-btn small" type="button" onClick={() => addSigner({ kind: d.kind, userId: d.userId, name: d.name, email: d.email, roleLabel: undefined, clientId: d.clientId, companyId: d.companyId })}>
                            Add
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!dir.length && (
                      <tr>
                        <td className="ops-muted">No eligible signers found. LP signatories need the signatory or manager role; investee users need signing authority.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <h4>Signers ({signers.length})</h4>
            {signers.length === 0 ? (
              <Empty>Add at least one signer.</Empty>
            ) : (
              <table className="ops-table">
                <tbody>
                  {signers.map((s) => (
                    <tr key={s.key}>
                      <td style={{ width: 80 }}>
                        {order === 'SEQUENTIAL' ? (
                          <input className="ops-input" type="number" min={1} max={12} value={s.orderNo} onChange={(e) => setSigners((p) => p.map((x) => (x.key === s.key ? { ...x, orderNo: Number(e.target.value) || 1 } : x)))} />
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>
                        {s.name}
                        <div className="ops-muted">{s.email}</div>
                      </td>
                      <td>{KIND[s.kind]}</td>
                      <td>
                        <button className="ops-btn small" type="button" onClick={() => setSigners((p) => p.filter((x) => x.key !== s.key))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {order === 'SEQUENTIAL' && <p className="ops-muted">Signers with the same number sign together; a group is notified once the previous group has finished.</p>}
          </>
        )}
        {step === 3 && (
          <>
            <DefinitionList
              items={[
                ['Document', source === 'store' ? `${doc?.ref} ${doc?.name}` : file?.name],
                ['Title', title],
                ['Order', order === 'SEQUENTIAL' ? 'Sequential' : 'Parallel'],
                ['Expires', `${days} days after sending`],
                ['Signers', signers.map((s) => `${order === 'SEQUENTIAL' ? `${s.orderNo}. ` : ''}${s.name} (${KIND[s.kind]})`).join('; ')],
              ]}
            />
            <p className="ops-muted">External signers get a one-time link and must confirm their e-mail address with a code before signing. Signed-in users sign from their portal.</p>
          </>
        )}
        <Alert>{act.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={step === 1 ? onClose : () => setStep(step - 1)} disabled={act.busy}>
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < 3 ? (
          <button className="ops-btn primary" type="button" disabled={step === 1 ? !step1Ok : signers.length === 0} onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <>
            <button className="ops-btn" type="button" disabled={act.busy} onClick={() => submit(false)}>
              Save as draft
            </button>
            <button className="ops-btn primary" type="button" disabled={act.busy} onClick={() => submit(true)}>
              {act.busy ? 'Working…' : 'Send for signature'}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}

// ------------------------------------------------------------------ flows + verify

function FlowModal({ flow, onClose, onCreated }: { flow: 'commitment' | 'capital-call-ack'; onClose: () => void; onCreated: (id: string) => void }) {
  const isCommitment = flow === 'commitment';
  return (
    <FormModal
      title={isCommitment ? 'LP commitment agreement' : 'Capital call acknowledgement'}
      kicker="Signing flow"
      subtitle={
        isCommitment
          ? 'Generates the subscription and commitment agreement and asks the investor’s authorised signatories to sign. Completing it activates a pending commitment.'
          : 'Generates the acknowledgement for an issued capital call and asks an investor signatory to sign. Completing it records the acknowledgement on the call.'
      }
      submitLabel="Create and send"
      onClose={onClose}
      onSubmit={(fd) => {
        const id = String(fd.get('id') ?? '').trim();
        const counter = String(fd.get('counter') ?? '').trim();
        return api.post<{ request: EsignRequest }>(esign(`/flows/${flow}/${encodeURIComponent(id)}`), { countersignerUserId: counter || undefined });
      }}
      onDone={(r) => onCreated((r as { request: EsignRequest }).request.id)}
    >
      <Field label={isCommitment ? 'Commitment id' : 'Capital call allocation id'} hint="Copy it from the Funds & commitments or Capital calls screen.">
        <input className="ops-input" name="id" required />
      </Field>
      {isCommitment && (
        <Field label="Countersigner (staff user id, optional)" hint="When set, the staff countersignature follows the investor’s signatures.">
          <input className="ops-input" name="counter" />
        </Field>
      )}
    </FormModal>
  );
}

interface VerifyResult {
  match: 'SEALED' | 'ORIGINAL' | 'NONE';
  sha256: string;
  ref?: string;
  status?: string;
  completedAt?: string | null;
  signers?: { name: string; roleLabel: string | null; signedAt: string | null }[];
  chainIntact?: boolean | null;
  note?: string;
}

export function VerifyModal({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const act = useAction();
  const post = async (body: BodyInit, json?: boolean) => {
    const r = await act.run(async () => {
      const res = await fetch(`${apiBase}${esign('/public/verify')}`, { method: 'POST', body, headers: json ? { 'Content-Type': 'application/json' } : undefined, credentials: 'include' });
      const data = (await res.json()) as VerifyResult & { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? 'Verification failed');
      return data;
    });
    if (r) setResult(r);
  };
  return (
    <Modal title="Verify a document" kicker="E-signature" subtitle="Upload a PDF or paste its SHA-256 to check it against what was sealed." onClose={onClose}>
      <div className="ops-modal-body">
        <Field label="PDF file">
          <input className="ops-input" type="file" accept="application/pdf,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.append('file', f); void post(fd); } }} />
        </Field>
        <form onSubmit={(e) => { e.preventDefault(); const h = String(new FormData(e.currentTarget).get('hash') ?? '').trim(); void post(JSON.stringify({ sha256: h }), true); }}>
          <Field label="or SHA-256">
            <input className="ops-input" name="hash" placeholder="64 hex characters" />
          </Field>
          <button className="ops-btn" type="submit">
            Check hash
          </button>
        </form>
        <Alert>{act.error}</Alert>
        {result &&
          (result.match === 'NONE' ? (
            <Alert>No sealed or original document with this hash is on record. It has been changed or did not come from Matanho Nexus.</Alert>
          ) : (
            <Alert kind={result.match === 'SEALED' && result.chainIntact !== false ? 'ok' : 'warn'}>
              {result.ref}: {result.note} {result.chainIntact === false && 'The recorded signature chain no longer verifies.'}
              {result.signers && ` Signed by ${result.signers.map((s) => s.name).join(', ')}.`}
            </Alert>
          ))}
      </div>
    </Modal>
  );
}

export { describeError };
