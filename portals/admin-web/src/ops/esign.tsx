'use client';

import { useCallback, useEffect, useState } from 'react';
import { EsignInbox } from '@matanho/portal-kit';
import { api, apiBase, apiRequest, describeError, qs } from './api';
import { Badge, downloadCsv } from './admin-core';
import { Tiles } from './suite';
import { useCan, useSession } from './session';
import { Alert, Card, DefinitionList, Empty, Field, FieldGrid, formatDateTime, FormModal, Loaded, Modal, PageHeader, useAction, useResource } from './ui';
import { FieldEditor, defaultLayout, layoutSummary, type FieldBox } from './esign-fields';
import { BatchesCard, BulkModal, CadenceFields, DocPicker, FlowModal, PersonPicker, cadenceBody, type FlowKind } from './esign-flows';
import { esign, KIND, uploadPdf, type DirEntry, type DocEntry, type EsignRequest, type IntegrityReport, type ListResponse } from './esign-shared';

/** Native e-signature console: requests, create wizard with positioned signature fields, flows, bulk send, status, resend, void, sealed PDF and certificate. */

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

export function EsignScreen() {
  const can = useCan('esign.view');
  const canManage = useCan('esign.manage');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  // A signer without esign.view only gets the inbox below, so do not ask for every request (it would be refused).
  const res = useResource<ListResponse>(() => (can ? apiRequest<ListResponse>('GET', esign(`/requests${qs({ status, q })}`)) : Promise.resolve({ data: [], counts: {} })), [status, q, can]);
  const [openId, setOpenId] = useState<string | null>(null);
  const mine = useResource<{ id: string; actionable: boolean }[]>(() => apiRequest<{ data: { id: string; actionable: boolean }[] }>('GET', esign('/me/requests')).then((r) => r.data), []);
  const [wizard, setWizard] = useState(false);
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const [verify, setVerify] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [tab, setTab] = useState<'all' | 'mine'>(can ? 'all' : 'mine');
  const [batchKey, setBatchKey] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);

  if (!can || tab === 'mine') {
    return (
      <>
        <PageHeader
          kicker="Operations"
          title="E-signatures"
          subtitle="Documents waiting for your own signature or approval."
          actions={
            can ? (
              <button className="ops-btn" type="button" onClick={() => setTab('all')}>
                All signature requests
              </button>
            ) : undefined
          }
        />
        {!can && <Alert kind="info">Your role cannot see the signature requests of other people (esign.view), but you can sign what has been sent to you.</Alert>}
        <EsignInbox heading="Awaiting my signature" />
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
            <button className="ops-btn" type="button" onClick={() => setTab('mine')}>
              My signatures
            </button>{' '}
            {canManage && (
              <>
                <select className="ops-input" style={{ width: 'auto', display: 'inline-block' }} value="" aria-label="Start a signing flow" onChange={(e) => { if (e.target.value) setFlow(e.target.value as FlowKind); }}>
                  <option value="">Signing flows…</option>
                  <option value="commitment-pack">Subscription and commitment pack</option>
                  <option value="commitment">LP commitment agreement (single page)</option>
                  <option value="capital-call-ack">Capital call acknowledgement</option>
                  <option value="term-sheet">Term sheet countersignature</option>
                  <option value="staff-approval">Staff approval</option>
                </select>{' '}
                <button className="ops-btn" type="button" onClick={() => setBulk(true)}>
                  Bulk send
                </button>{' '}
                <button className="ops-btn primary" type="button" onClick={() => setWizard(true)}>
                  New signature request
                </button>
              </>
            )}
          </>
        }
      />
      {mine.state === 'ok' && mine.data.filter((m) => m.actionable).length > 0 && (
        <Alert kind="info">
          {mine.data.filter((m) => m.actionable).length} document{mine.data.filter((m) => m.actionable).length === 1 ? ' is' : 's are'} waiting for your own signature.{' '}
          <button className="ops-btn small primary" type="button" onClick={() => setTab('mine')}>
            Review and sign
          </button>
        </Alert>
      )}
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
      <BatchesCard refreshKey={batchKey} onOpenRequest={setOpenId} openBatch={batchId} onOpenBatch={setBatchId} onCloseBatch={() => setBatchId(null)} />
      {bulk && <BulkModal onClose={() => setBulk(false)} onDone={(id) => { res.reload(); setBatchKey((n) => n + 1); setBatchId(id); }} />}
      {openId && <DetailModal id={openId} onClose={() => setOpenId(null)} onChanged={res.reload} onSignMine={() => { setOpenId(null); setTab('mine'); }} />}
      {wizard && <Wizard onClose={() => setWizard(false)} onCreated={(id) => { res.reload(); setOpenId(id); }} />}
      {flow && <FlowModal flow={flow} onClose={() => setFlow(null)} onCreated={(id) => { res.reload(); setOpenId(id); }} />}
      {verify && <VerifyModal onClose={() => setVerify(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ detail

function DetailModal({ id, onClose, onChanged, onSignMine }: { id: string; onClose: () => void; onChanged: () => void; onSignMine: () => void }) {
  const { user } = useSession();
  const canManage = useCan('esign.manage');
  const canVoid = useCan('esign.void');
  const res = useResource<{ request: EsignRequest }>(() => api.get<{ request: EsignRequest }>(esign(`/requests/${id}`)), [id]);
  const [voiding, setVoiding] = useState(false);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [cadenceOpen, setCadenceOpen] = useState(false);
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
                  ['Signature fields', layoutSummary(r.fields)],
                  ['Reminders', r.status === 'DRAFT' || r.status === 'PENDING' ? `every ${r.reminder.intervalDays} day${r.reminder.intervalDays === 1 ? '' : 's'}, up to ${r.reminder.max} per signer${r.reminder.custom ? ' (custom schedule)' : ' (default)'}` : '-'],
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
                          {s.status === 'PENDING' && <div className="ops-muted">{s.viewedAt ? 'viewed' : 'not opened'}{s.reminderCount ? `, ${s.reminderCount} reminder(s)` : ''}{s.nextReminderAt ? `, next ${formatDateTime(s.nextReminderAt)}` : ''}</div>}
                          {s.fieldCount > 0 && <div className="ops-muted">{s.fieldCount} field{s.fieldCount === 1 ? '' : 's'} placed</div>}
                          {s.declineReason && <div className="ops-muted">{s.declineReason}</div>}
                        </td>
                        <td>{s.identityMethod === 'SESSION' ? 'Signed-in session' : s.identityMethod === 'EMAIL_OTP' ? 'E-mail code' : '-'}</td>
                        <td>
                          {formatDateTime(s.signedAt)}
                          {s.ip && <div className="ops-muted">{s.ip}</div>}
                        </td>
                        <td>
                          {s.userId === user.id && r.status === 'PENDING' && s.status === 'PENDING' && (
                            <button className="ops-btn small primary" type="button" onClick={onSignMine}>
                              Sign
                            </button>
                          )}{' '}
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
                  <strong>{report.ok ? 'Integrity verified' : 'Integrity problem'}</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {report.checks.map((c) => (
                      <li key={c.name}>
                        {c.ok ? 'Passed' : 'FAILED'}: {c.name}
                        {c.detail ? ` (${c.detail})` : ''}
                      </li>
                    ))}
                  </ul>
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
                <button className="ops-btn" type="button" disabled={act.busy} onClick={async () => { const v = await act.run(() => api.get<IntegrityReport>(esign(`/requests/${id}/verify`))); if (v) setReport(v); }}>
                  Verify integrity
                </button>
                {(r.fields.length > 0 || (canManage && r.status === 'DRAFT')) && (
                  <button className="ops-btn" type="button" onClick={() => setFieldsOpen(true)}>
                    {canManage && r.status === 'DRAFT' ? (r.fields.length ? 'Edit signature fields' : 'Place signature fields') : 'View signature fields'}
                  </button>
                )}
                {canManage && (r.status === 'DRAFT' || r.status === 'PENDING') && (
                  <button className="ops-btn" type="button" onClick={() => setCadenceOpen(true)}>
                    Reminder schedule
                  </button>
                )}
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
              {fieldsOpen && <FieldsModal r={r} editable={canManage && r.status === 'DRAFT'} onClose={() => setFieldsOpen(false)} onSaved={after} />}
              {cadenceOpen && <CadenceModal r={r} onClose={() => setCadenceOpen(false)} onSaved={after} />}
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

// ------------------------------------------------------------------ fields + cadence

function FieldsModal({ r, editable, onClose, onSaved }: { r: EsignRequest; editable: boolean; onClose: () => void; onSaved: () => void }) {
  const signers = r.signers.map((s) => ({ email: s.email.toLowerCase(), name: s.name }));
  const byId = new Map(r.signers.map((s) => [s.id, s.email.toLowerCase()]));
  const [boxes, setBoxes] = useState<FieldBox[]>(() => r.fields.map((f) => ({ key: f.id, signerEmail: byId.get(f.signerId) ?? '', kind: f.kind as FieldBox['kind'], page: f.page, x: f.x, y: f.y, width: f.width, height: f.height })));
  const act = useAction();
  const missing = signers.filter((s) => !boxes.some((b) => b.signerEmail === s.email && b.kind === 'SIGNATURE'));
  return (
    <Modal wide title={`${r.ref} signature fields`} kicker="E-signature" subtitle={editable ? 'Each signer needs at least one signature box. Fields lock when the request is sent.' : 'Fields are locked once the request has been sent.'} onClose={onClose}>
      <div className="ops-modal-body">
        <FieldEditor source={{ requestId: r.id }} signers={signers} value={boxes} onChange={setBoxes} readOnly={!editable} />
        {editable && missing.length > 0 && boxes.length > 0 && <Alert kind="warn">No signature box yet for {missing.map((m) => m.name).join(', ')}.</Alert>}
        <Alert>{act.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={onClose}>
          {editable ? 'Cancel' : 'Close'}
        </button>
        {editable && (
          <button
            className="ops-btn primary"
            type="button"
            disabled={act.busy || (boxes.length > 0 && missing.length > 0)}
            onClick={async () => {
              if ((await act.run(() => api.put(esign(`/requests/${r.id}/fields`), { fields: boxes.map(({ key: _k, ...f }) => f) }))) !== undefined) {
                onSaved();
                onClose();
              }
            }}
          >
            {act.busy ? 'Saving…' : boxes.length ? 'Save fields' : 'Save with no fields'}
          </button>
        )}
      </footer>
    </Modal>
  );
}

function CadenceModal({ r, onClose, onSaved }: { r: EsignRequest; onClose: () => void; onSaved: () => void }) {
  const [cad, setCad] = useState<{ interval: number | ''; max: number | '' }>({ interval: r.reminder.custom ? r.reminder.intervalDays : '', max: r.reminder.custom ? r.reminder.max : '' });
  const act = useAction();
  return (
    <Modal title={`${r.ref} reminders`} kicker="E-signature" subtitle="Reminders go to signers whose turn it is, once this long has passed since they were last notified. Leave blank for the platform default (every 3 days, up to 3)." onClose={onClose}>
      <div className="ops-modal-body">
        <FieldGrid>
          <CadenceFields interval={cad.interval} max={cad.max} onChange={setCad} />
        </FieldGrid>
        <Alert>{act.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="ops-btn primary"
          type="button"
          disabled={act.busy}
          onClick={async () => {
            const b = cadenceBody(cad.interval, cad.max);
            if ((await act.run(() => api.patch(esign(`/requests/${r.id}/reminders`), { reminderIntervalDays: b.reminderIntervalDays ?? null, reminderMax: b.reminderMax ?? null }))) !== undefined) {
              onSaved();
              onClose();
            }
          }}
        >
          Save schedule
        </button>
      </footer>
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
  const [doc, setDoc] = useState<DocEntry | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState<'PARALLEL' | 'SEQUENTIAL'>('PARALLEL');
  const [days, setDays] = useState(14);
  const [cad, setCad] = useState<{ interval: number | ''; max: number | '' }>({ interval: '', max: '' });
  const [signers, setSigners] = useState<DraftSigner[]>([]);
  const [kind, setKind] = useState('STAFF');
  const [dirQ, setDirQ] = useState('');
  const [dir, setDir] = useState<DirEntry[]>([]);
  const [ext, setExt] = useState({ name: '', email: '', role: '' });
  const [place, setPlace] = useState(false);
  const [boxes, setBoxes] = useState<FieldBox[]>([]);
  const act = useAction();
  const up = useAction();

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

  const pdfSource = source === 'store' ? (doc ? { documentId: doc.id } : null) : fileId ? { fileId } : null;
  const step1Ok = !!pdfSource && title.trim().length >= 3;
  const editorSigners = signers.map((s) => ({ email: s.email.toLowerCase(), name: s.name }));
  const missingSig = editorSigners.filter((s) => !boxes.some((b) => b.signerEmail === s.email && b.kind === 'SIGNATURE'));
  const fieldsOk = !place || (boxes.length > 0 && missingSig.length === 0);

  // Boxes belong to signers; when the signer list changes, drop boxes of removed signers.
  useEffect(() => {
    setBoxes((prev) => prev.filter((b) => editorSigners.some((s) => s.email === b.signerEmail)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signers.map((s) => s.email).join('|')]);

  const startPlacing = async () => {
    setPlace(true);
    if (!boxes.length) {
      const pages = pdfSource ? await api.get<{ pages: { page: number }[] }>(esign(`/source/pages${qs(pdfSource)}`)).catch(() => null) : null;
      setBoxes(defaultLayout(editorSigners, pages?.pages.length ?? 1));
    }
  };

  const submit = async (send: boolean) => {
    const r = await act.run(async () => {
      return api.post<{ request: EsignRequest }>(esign('/requests'), {
        title: title.trim(),
        message: message.trim() || undefined,
        documentId: source === 'store' ? doc?.id : undefined,
        fileId: source === 'upload' ? (fileId ?? undefined) : undefined,
        signingOrder: order,
        expiresInDays: days,
        send,
        ...cadenceBody(cad.interval, cad.max),
        fields: place ? boxes.map(({ key: _k, ...f }) => f) : undefined,
        signers: signers.map((s) => ({ kind: s.kind, userId: s.userId, name: s.name, email: s.email, roleLabel: s.roleLabel, orderNo: s.orderNo, clientId: s.clientId, companyId: s.companyId })),
      });
    });
    if (r) {
      onCreated(r.request.id);
      onClose();
    }
  };

  return (
    <Modal wide title="New signature request" kicker={`Step ${step} of 4`} onClose={onClose}>
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
              <DocPicker value={doc} onChange={(d) => { setDoc(d); setBoxes([]); if (d && !title) setTitle(d.name); }} />
            ) : (
              <Field label="PDF file" hint="Unencrypted PDF, up to the platform upload limit.">
                <input
                  className="ops-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const id = await up.run(() => uploadPdf(f));
                    if (id) {
                      setFileId(id);
                      setFileName(f.name);
                      setBoxes([]);
                      if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
                    }
                  }}
                />
              </Field>
            )}
            {source === 'upload' && fileName && <p className="ops-muted">Uploaded {fileName}.</p>}
            <Alert>{up.error}</Alert>
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
              <CadenceFields interval={cad.interval} max={cad.max} onChange={setCad} />
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
        {step === 3 && pdfSource && (
          <>
            {!place ? (
              <>
                <p>By default each signature goes on a signature page appended to the document. You can instead place signature, date, initials and name boxes on the pages themselves.</p>
                <button className="ops-btn primary" type="button" onClick={startPlacing}>
                  Place signature boxes on the document
                </button>
              </>
            ) : (
              <>
                <FieldEditor source={pdfSource} signers={editorSigners} value={boxes} onChange={setBoxes} />
                {missingSig.length > 0 && <Alert kind="warn">No signature box yet for {missingSig.map((m) => m.name).join(', ')}.</Alert>}
                <button className="ops-btn" type="button" onClick={() => { setPlace(false); setBoxes([]); }}>
                  Skip placement (use the signature page)
                </button>
              </>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <DefinitionList
              items={[
                ['Document', source === 'store' ? `${doc?.ref} ${doc?.name}` : fileName],
                ['Title', title],
                ['Order', order === 'SEQUENTIAL' ? 'Sequential' : 'Parallel'],
                ['Expires', `${days} days after sending`],
                ['Reminders', cad.interval === '' && cad.max === '' ? 'Default (every 3 days, up to 3)' : `Every ${cad.interval || 3} days, up to ${cad.max === '' ? 3 : cad.max}`],
                ['Signature boxes', place ? layoutSummary(boxes) : 'On the appended signature page'],
                ['Signers', signers.map((s) => `${order === 'SEQUENTIAL' ? `${s.orderNo}. ` : ''}${s.name} (${KIND[s.kind]})`).join('; ')],
              ]}
            />
            <p className="ops-muted">External signers get a one-time link and must confirm their e-mail address with a code before signing. Signed-in users sign from their portal. Signature boxes cannot be changed after sending.</p>
          </>
        )}
        <Alert>{act.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={step === 1 ? onClose : () => setStep(step - 1)} disabled={act.busy}>
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < 4 ? (
          <button className="ops-btn primary" type="button" disabled={step === 1 ? !step1Ok : step === 2 ? signers.length === 0 : !fieldsOk} onClick={() => setStep(step + 1)}>
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

interface VerifyResult {
  match: 'SEALED' | 'ORIGINAL' | 'NONE';
  sha256: string;
  ref?: string;
  status?: string;
  completedAt?: string | null;
  signers?: { name: string; roleLabel: string | null; signedAt: string | null }[];
  chainIntact?: boolean | null;
  checks?: { name: string; ok: boolean }[];
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
              {result.checks && ` Checks: ${result.checks.map((c) => `${c.name} ${c.ok ? 'passed' : 'FAILED'}`).join('; ')}.`}
            </Alert>
          ))}
      </div>
    </Modal>
  );
}

export { describeError };
