'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api, qs } from './api';
import { Alert, Card, Empty, Field, FieldGrid, formatDateTime, Loaded, Modal, useAction, useResource } from './ui';
import { Badge } from './admin-core';
import { FieldEditor, type FieldBox } from './esign-fields';
import { esign, KIND, uploadPdf, type DirEntry, type DocEntry, type EsignRequest, type LookupRow } from './esign-shared';

/** Pickers (search by name or reference, never raw ids), the signing flows and bulk send of the e-signature console. */

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ------------------------------------------------------------------ generic search picker

export function SearchPicker<T extends { id: string }>({
  label,
  hint,
  value,
  onChange,
  fetcher,
  render,
  placeholder,
  deps = [],
}: {
  label: string;
  hint?: ReactNode;
  value: T | null;
  onChange: (v: T | null) => void;
  fetcher: (q: string) => Promise<T[]>;
  render: (row: T) => ReactNode;
  placeholder?: string;
  deps?: unknown[];
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<T[] | null>(null);
  const dq = useDebounced(q);

  useEffect(() => {
    if (!open || value) return;
    let alive = true;
    setRows(null);
    fetcher(dq)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, open, value, ...deps]);

  return (
    <Field label={label} hint={hint}>
      {value ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>{render(value)}</div>
          <button className="ops-btn small" type="button" onClick={() => { onChange(null); setQ(''); }}>
            Change
          </button>
        </div>
      ) : (
        <div>
          <input className="ops-input" value={q} placeholder={placeholder ?? 'Type to search'} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
          {open && (
            <div className="ops-table-wrap" style={{ maxHeight: 200, overflow: 'auto', marginTop: 4 }}>
              <table className="ops-table">
                <tbody>
                  {(rows ?? []).map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => { onChange(r); setOpen(false); setQ(''); }}>
                      <td>{render(r)}</td>
                    </tr>
                  ))}
                  {rows && !rows.length && (
                    <tr>
                      <td className="ops-muted">Nothing matches.</td>
                    </tr>
                  )}
                  {!rows && (
                    <tr>
                      <td className="ops-muted">Searching…</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

const dirRow = (d: DirEntry) => (
  <>
    {d.name} <span className="ops-muted">{d.email}</span>
    <div className="ops-muted">{[d.org, d.role].filter(Boolean).join(' - ')}</div>
  </>
);

const dirKey = (d: DirEntry) => ({ ...d, id: `${d.userId}${d.clientId ?? ''}${d.companyId ?? ''}` });
type DirPick = DirEntry & { id: string };

export function PersonPicker({ label, hint, kind = 'STAFF', value, onChange, clientId, companyId }: { label: string; hint?: ReactNode; kind?: string; value: DirEntry | null; onChange: (d: DirEntry | null) => void; clientId?: string; companyId?: string }) {
  return (
    <SearchPicker<DirPick>
      label={label}
      hint={hint}
      value={value ? dirKey(value) : null}
      onChange={(v) => onChange(v)}
      fetcher={async (q) => (await api.get<DirEntry[]>(esign(`/directory${qs({ kind, q, clientId, companyId })}`))).map(dirKey)}
      render={dirRow}
      placeholder="Name or e-mail"
      deps={[kind, clientId, companyId]}
    />
  );
}

function MultiPeople({ label, hint, kind = 'STAFF', value, onChange, ordered }: { label: string; hint?: ReactNode; kind?: string; value: DirEntry[]; onChange: (v: DirEntry[]) => void; ordered?: boolean }) {
  const [reset, setReset] = useState(0);
  return (
    <>
      <SearchPicker<DirPick>
        key={reset}
        label={label}
        hint={hint}
        value={null}
        onChange={(v) => {
          if (v && !value.some((x) => x.userId === v.userId)) onChange([...value, v]);
          setReset((n) => n + 1);
        }}
        fetcher={async (q) => (await api.get<DirEntry[]>(esign(`/directory${qs({ kind, q })}`))).map(dirKey).filter((d) => !value.some((x) => x.userId === d.userId))}
        render={dirRow}
        placeholder="Add by name or e-mail"
        deps={[value.length]}
      />
      {value.length > 0 && (
        <table className="ops-table">
          <tbody>
            {value.map((p, i) => (
              <tr key={p.userId}>
                <td style={{ width: 28 }}>{ordered ? i + 1 : ''}</td>
                <td>
                  {p.name} <span className="ops-muted">{p.email}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="ops-btn small" type="button" onClick={() => onChange(value.filter((x) => x.userId !== p.userId))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function DocPicker({ value, onChange }: { value: DocEntry | null; onChange: (d: DocEntry | null) => void }) {
  return (
    <SearchPicker<DocEntry>
      label="Document from the document store"
      value={value}
      onChange={onChange}
      fetcher={(q) => api.get<DocEntry[]>(esign(`/documents${qs({ q })}`))}
      render={(d) => (
        <>
          {d.ref} {d.name} <span className="ops-muted">{d.type} v{d.version}</span>
        </>
      )}
      placeholder="Name or reference"
    />
  );
}

export function CadenceFields({ interval, max, onChange }: { interval: number | ''; max: number | ''; onChange: (v: { interval: number | ''; max: number | '' }) => void }) {
  return (
    <>
      <Field label="Remind every (days)" hint="Blank = 3 days.">
        <input className="ops-input" type="number" min={1} max={30} value={interval} onChange={(e) => onChange({ interval: e.target.value === '' ? '' : Number(e.target.value), max })} />
      </Field>
      <Field label="Reminders per signer" hint="Blank = 3. Use 0 for none.">
        <input className="ops-input" type="number" min={0} max={10} value={max} onChange={(e) => onChange({ interval, max: e.target.value === '' ? '' : Number(e.target.value) })} />
      </Field>
    </>
  );
}
export const cadenceBody = (interval: number | '', max: number | '') => ({ reminderIntervalDays: interval === '' ? undefined : interval, reminderMax: max === '' ? undefined : max });

// ------------------------------------------------------------------ flows

export type FlowKind = 'commitment' | 'commitment-pack' | 'capital-call-ack' | 'term-sheet' | 'staff-approval';

const FLOW: Record<FlowKind, { title: string; subtitle: string; picker?: { label: string; path: string; hint?: string } }> = {
  commitment: {
    title: 'LP commitment agreement',
    subtitle: 'One-page subscription and commitment agreement for the investor’s authorised signatories. Completing it activates a pending commitment.',
    picker: { label: 'Commitment', path: '/lookup/commitments', hint: 'Search by investor, fund or account reference.' },
  },
  'commitment-pack': {
    title: 'Subscription and commitment pack',
    subtitle: 'One PDF with the subscription agreement, investor declarations and payment notice, each part with its own signature and date boxes. Completing it activates a pending commitment.',
    picker: { label: 'Commitment', path: '/lookup/commitments', hint: 'Search by investor, fund or account reference.' },
  },
  'capital-call-ack': {
    title: 'Capital call acknowledgement',
    subtitle: 'Asks an investor signatory to acknowledge an issued capital call. Completing it records the acknowledgement on the call.',
    picker: { label: 'Capital call allocation', path: '/lookup/allocations', hint: 'Issued calls not yet acknowledged. Search by call reference or investor.' },
  },
  'term-sheet': {
    title: 'Term sheet countersignature',
    subtitle: 'Fund countersignature of a term sheet the company has signed. The issuer and author cannot countersign; marking it executed stays a separate step for a different person.',
    picker: { label: 'Term sheet', path: '/lookup/term-sheets', hint: 'Only term sheets signed by the company and awaiting the fund.' },
  },
  'staff-approval': {
    title: 'Staff approval',
    subtitle: 'Ask one or more colleagues to approve a decision with a signed, sealed record. You cannot approve your own request.',
  },
};

export function FlowModal({ flow, onClose, onCreated }: { flow: FlowKind; onClose: () => void; onCreated: (id: string) => void }) {
  const cfg = FLOW[flow];
  const [subject, setSubject] = useState<LookupRow | null>(null);
  const [counter, setCounter] = useState<DirEntry | null>(null);
  const [days, setDays] = useState<number | ''>('');
  const [cad, setCad] = useState<{ interval: number | ''; max: number | '' }>({ interval: '', max: '' });
  // staff approval
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [summary, setSummary] = useState('');
  const [approvers, setApprovers] = useState<DirEntry[]>([]);
  const [order, setOrder] = useState<'SEQUENTIAL' | 'PARALLEL'>('SEQUENTIAL');
  const [doc, setDoc] = useState<DocEntry | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const act = useAction();

  const needsCounter = flow === 'term-sheet';
  const ok = flow === 'staff-approval' ? title.trim().length >= 3 && summary.trim().length >= 3 && approvers.length > 0 : !!subject && (!needsCounter || !!counter);

  const submit = async () => {
    const r = await act.run(async () => {
      const common = { expiresInDays: days === '' ? undefined : days, ...cadenceBody(cad.interval, cad.max) };
      if (flow === 'staff-approval') {
        const fileId = file ? await uploadPdf(file) : undefined;
        return api.post<{ request: EsignRequest }>(esign('/flows/staff-approval'), { ...common, title: title.trim(), summary: summary.trim(), reference: reference.trim() || undefined, approverUserIds: approvers.map((a) => a.userId), order, documentId: doc?.id, fileId });
      }
      const path = flow === 'term-sheet' ? `/flows/term-sheet-countersign/${subject!.id}` : `/flows/${flow}/${subject!.id}`;
      return api.post<{ request: EsignRequest }>(esign(path), { ...common, countersignerUserId: counter?.userId });
    });
    if (r) {
      onCreated(r.request.id);
      onClose();
    }
  };

  return (
    <Modal wide title={cfg.title} kicker="Signing flow" subtitle={cfg.subtitle} onClose={onClose}>
      <div className="ops-modal-body">
        {cfg.picker && (
          <SearchPicker<LookupRow>
            label={cfg.picker.label}
            hint={cfg.picker.hint}
            value={subject}
            onChange={setSubject}
            fetcher={(q) => api.get<LookupRow[]>(esign(`${cfg.picker!.path}${qs({ q })}`))}
            render={(r) => (
              <>
                {r.label}
                <div className="ops-muted">{r.sub}</div>
              </>
            )}
            placeholder="Type a name or reference"
          />
        )}
        {(flow === 'commitment' || flow === 'commitment-pack' || flow === 'term-sheet') && (
          <PersonPicker label={flow === 'term-sheet' ? 'Countersigner (staff)' : 'Countersigner (staff, optional)'} hint={flow === 'term-sheet' ? 'Must not be the issuer or author of the term sheet.' : 'When set, the staff countersignature follows the investor’s signatures.'} value={counter} onChange={setCounter} />
        )}
        {flow === 'staff-approval' && (
          <>
            <FieldGrid>
              <Field label="What needs approval" span={2}>
                <input className="ops-input" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Reference (optional)" hint="Stops a second open approval for the same item.">
                <input className="ops-input" value={reference} maxLength={64} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field label="Order">
                <select className="ops-input" value={order} onChange={(e) => setOrder(e.target.value as 'SEQUENTIAL' | 'PARALLEL')}>
                  <option value="SEQUENTIAL">One after another</option>
                  <option value="PARALLEL">Any order</option>
                </select>
              </Field>
              <Field label="Summary for the approvers" span={2}>
                <textarea className="ops-input" rows={4} value={summary} maxLength={4000} onChange={(e) => setSummary(e.target.value)} />
              </Field>
            </FieldGrid>
            <MultiPeople label="Approvers" hint="Staff only; you cannot be one of them." value={approvers} onChange={setApprovers} ordered={order === 'SEQUENTIAL'} />
            <DocPicker value={doc} onChange={(d) => { setDoc(d); if (d) setFile(null); }} />
            <Field label="or upload a supporting PDF" hint="Optional. The approval sheet is appended to the document.">
              <input className="ops-input" type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setDoc(null); }} />
            </Field>
          </>
        )}
        <FieldGrid>
          <Field label="Expires in (days)" hint="Blank = flow default.">
            <input className="ops-input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <CadenceFields interval={cad.interval} max={cad.max} onChange={setCad} />
        </FieldGrid>
        <Alert>{act.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={onClose} disabled={act.busy}>
          Cancel
        </button>
        <button className="ops-btn primary" type="button" disabled={!ok || act.busy} onClick={submit}>
          {act.busy ? 'Working…' : 'Create and send'}
        </button>
      </footer>
    </Modal>
  );
}

// ------------------------------------------------------------------ bulk send

interface BatchSummary {
  id: string;
  title: string;
  total: number;
  created: number;
  failed: number;
  failures: { name: string; email: string; error: string }[];
  createdAt: string;
  counts: Record<string, number>;
  requests: { id: string; ref: string; status: string; signer: { name: string; email: string; status: string; reminders: number } | null }[];
}

interface Recipient {
  key: string;
  kind: string;
  userId?: string;
  name: string;
  email: string;
  roleLabel?: string;
  clientId?: string;
  companyId?: string;
}

/** Parses "Name <email>" or "email" lines into external recipients. */
export function parseRecipients(text: string): { ok: Recipient[]; bad: string[] } {
  const ok: Recipient[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:"?([^"<]*?)"?\s*)?<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?$/.exec(line);
    if (!m) {
      bad.push(line);
      continue;
    }
    const email = m[2]!.toLowerCase();
    ok.push({ key: `x-${email}`, kind: 'EXTERNAL', name: (m[1] ?? '').trim() || email.split('@')[0]!, email });
  }
  return { ok, bad };
}

export function BulkModal({ onClose, onDone }: { onClose: () => void; onDone: (batchId: string) => void }) {
  const [step, setStep] = useState(1);
  const [doc, setDoc] = useState<DocEntry | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [days, setDays] = useState(14);
  const [cad, setCad] = useState<{ interval: number | ''; max: number | '' }>({ interval: '', max: '' });
  const [kind, setKind] = useState('LP');
  const [recips, setRecips] = useState<Recipient[]>([]);
  const [paste, setPaste] = useState('');
  const [boxes, setBoxes] = useState<FieldBox[]>([]);
  const [place, setPlace] = useState(false);
  const [pick, setPick] = useState(0);
  const act = useAction();
  const up = useAction();

  const addPeople = (d: DirEntry) => setRecips((p) => (p.some((x) => x.email === d.email.toLowerCase()) ? p : [...p, { key: `${d.userId}${d.clientId ?? ''}`, kind: d.kind, userId: d.userId, name: d.name, email: d.email.toLowerCase(), clientId: d.clientId, companyId: d.companyId }]));
  const addPasted = () => {
    const { ok, bad } = parseRecipients(paste);
    setRecips((p) => [...p, ...ok.filter((n) => !p.some((x) => x.email === n.email))]);
    setPaste(bad.join('\n'));
  };
  const source = doc ? { documentId: doc.id } : fileId ? { fileId } : null;
  const step1 = !!source && title.trim().length >= 3;

  const submit = async (send: boolean) => {
    const r = await act.run((key) =>
      api.post<{ replayed: boolean; batch: BatchSummary }>(
        esign('/bulk'),
        {
          title: title.trim(),
          message: message.trim() || undefined,
          documentId: doc?.id,
          fileId: doc ? undefined : fileId,
          recipients: recips.map((r) => ({ kind: r.kind, userId: r.userId, name: r.name, email: r.email, clientId: r.clientId, companyId: r.companyId })),
          fieldTemplate: place ? boxes.map(({ key: _k, signerEmail: _s, ...f }) => f) : undefined,
          expiresInDays: days,
          send,
          idempotencyKey: key,
          ...cadenceBody(cad.interval, cad.max),
        },
      ),
    );
    if (r) {
      onDone(r.batch.id);
      onClose();
    }
  };

  return (
    <Modal wide title="Bulk send" kicker={`Step ${step} of 3`} subtitle="The same PDF to many recipients. Each recipient gets their own signature request and signs their own copy." onClose={onClose}>
      <div className="ops-modal-body">
        {step === 1 && (
          <>
            <DocPicker value={doc} onChange={(d) => { setDoc(d); if (d) { setFileId(null); setFileName(''); if (!title) setTitle(d.name); } }} />
            <Field label="or upload a PDF">
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
                    setDoc(null);
                    setBoxes([]);
                    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
                  }
                }}
              />
            </Field>
            {fileName && <p className="ops-muted">Uploaded {fileName}.</p>}
            <Alert>{up.error}</Alert>
            <FieldGrid>
              <Field label="Title" span={2}>
                <input className="ops-input" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Message to signers" span={2}>
                <input className="ops-input" value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
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
              <Field label="Add people">
                <select className="ops-input" value={kind} onChange={(e) => { setKind(e.target.value); setPick((n) => n + 1); }}>
                  {['LP', 'INVESTEE', 'STAFF'].map((k) => (
                    <option key={k} value={k}>
                      {KIND[k]}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldGrid>
            <SearchPicker<DirPick> key={`${kind}-${pick}`} label="Search" value={null} onChange={(v) => { if (v) { addPeople(v); setPick((n) => n + 1); } }} fetcher={async (q) => (await api.get<DirEntry[]>(esign(`/directory${qs({ kind, q })}`))).map(dirKey)} render={dirRow} placeholder="Name or e-mail" deps={[kind]} />
            <Field label="or paste external recipients" hint="One per line: Name <email@example.com> or just the e-mail.">
              <textarea className="ops-input" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} />
            </Field>
            <button className="ops-btn" type="button" disabled={!paste.trim()} onClick={addPasted}>
              Add pasted recipients
            </button>
            {paste.trim() && <p className="ops-muted">Lines that are not valid e-mail addresses stay in the box.</p>}
            <h4>Recipients ({recips.length})</h4>
            {recips.length === 0 ? (
              <Empty>Add at least one recipient (at most 100).</Empty>
            ) : (
              <div className="ops-table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
                <table className="ops-table">
                  <tbody>
                    {recips.map((r) => (
                      <tr key={r.key}>
                        <td>
                          {r.name} <span className="ops-muted">{r.email}</span>
                        </td>
                        <td>{KIND[r.kind]}</td>
                        <td>
                          <button className="ops-btn small" type="button" onClick={() => setRecips((p) => p.filter((x) => x.key !== r.key))}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {step === 3 && source && (
          <>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <input type="checkbox" checked={place} onChange={(e) => { setPlace(e.target.checked); if (e.target.checked && !boxes.length) setBoxes([{ key: 'tmpl-sig', signerEmail: '*', kind: 'SIGNATURE', page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.06 }]); }} /> Place the signature boxes on the document (otherwise signatures go on an appended signature page)
            </label>
            {place && <FieldEditor source={source} signers={[{ email: '*', name: 'Each recipient' }]} value={boxes} onChange={setBoxes} />}
            <h4>Review</h4>
            <p>
              {title} to {recips.length} recipient{recips.length === 1 ? '' : 's'}, expiring {days} days after sending. Submitting twice cannot send twice.
            </p>
          </>
        )}
        <Alert>{act.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={step === 1 ? onClose : () => setStep(step - 1)} disabled={act.busy}>
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < 3 ? (
          <button className="ops-btn primary" type="button" disabled={step === 1 ? !step1 : recips.length === 0 || recips.length > 100} onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <>
            <button className="ops-btn" type="button" disabled={act.busy || (place && !boxes.some((b) => b.kind === 'SIGNATURE'))} onClick={() => submit(false)}>
              Save as drafts
            </button>
            <button className="ops-btn primary" type="button" disabled={act.busy || (place && !boxes.some((b) => b.kind === 'SIGNATURE'))} onClick={() => submit(true)}>
              {act.busy ? 'Sending…' : `Send to ${recips.length}`}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}

// ------------------------------------------------------------------ batches

export function BatchesCard({ refreshKey, onOpenRequest, openBatch, onCloseBatch, onOpenBatch }: { refreshKey: number; onOpenRequest: (id: string) => void; openBatch: string | null; onCloseBatch: () => void; onOpenBatch: (id: string) => void }) {
  const res = useResource<{ id: string; title: string; total: number; created: number; failed: number; createdAt: string }[]>(() => api.get(esign('/batches')), [refreshKey]);
  if (res.state === 'ok' && res.data.length === 0 && !openBatch) return null;
  return (
    <>
      <Card title="Bulk sends">
        <Loaded res={res} what="bulk sends">
          {(rows) => (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <tbody>
                  {rows.slice(0, 6).map((b) => (
                    <tr key={b.id} className="clickable" onClick={() => onOpenBatch(b.id)}>
                      <td>{b.title}</td>
                      <td>{b.created} of {b.total} created{b.failed ? `, ${b.failed} failed` : ''}</td>
                      <td className="ops-muted">{formatDateTime(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </Card>
      {openBatch && <BatchModal id={openBatch} onClose={onCloseBatch} onOpenRequest={onOpenRequest} />}
    </>
  );
}

function BatchModal({ id, onClose, onOpenRequest }: { id: string; onClose: () => void; onOpenRequest: (id: string) => void }) {
  const res = useResource<{ batch: BatchSummary }>(() => api.get(esign(`/batches/${id}`)), [id]);
  const act = useAction();
  return (
    <Modal wide title="Bulk send" kicker="E-signature" onClose={onClose}>
      <div className="ops-modal-body">
        <Loaded res={res} what="the batch">
          {({ batch: b }) => (
            <>
              <h3 style={{ margin: '0 0 6px' }}>{b.title}</h3>
              <p className="ops-muted">
                {Object.entries(b.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'No requests'} - sent {formatDateTime(b.createdAt)}
              </p>
              {b.failures.length > 0 && (
                <Alert>
                  {b.failures.length} recipient{b.failures.length === 1 ? '' : 's'} could not be created: {b.failures.map((f) => `${f.name || f.email} (${f.error})`).join('; ')}
                </Alert>
              )}
              <div className="ops-table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                <table className="ops-table">
                  <tbody>
                    {b.requests.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => onOpenRequest(r.id)}>
                        <td>{r.ref}</td>
                        <td>
                          {r.signer?.name} <span className="ops-muted">{r.signer?.email}</span>
                        </td>
                        <td>
                          <Badge tone={r.status === 'COMPLETED' ? 'green' : r.status === 'PENDING' ? 'amber' : r.status === 'DECLINED' || r.status === 'EXPIRED' ? 'red' : 'grey'}>{r.status.toLowerCase()}</Badge>
                        </td>
                        <td className="ops-muted">{r.signer?.reminders ? `${r.signer.reminders} reminder(s)` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Alert>{act.error}</Alert>
              <div style={{ marginTop: 12 }}>
                <button className="ops-btn" type="button" disabled={act.busy || !(b.counts.PENDING > 0)} onClick={async () => { if (await act.run(() => api.post(esign(`/batches/${id}/remind`), {}))) res.reload(); }}>
                  Remind everyone still waiting
                </button>
              </div>
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}
