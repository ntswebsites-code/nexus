'use client';

import { useEffect, useRef, useState } from 'react';
import { api, apiRequest, v1 } from '@/ops/api';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import { dayOf, full, label, openLink, saveText, SimpleTable, Tiles, Tone, upload, when } from '@/ops/suite';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, Loaded, Modal, PageHeader, str, useResource } from '@/ops/ui';

interface FilingRow {
  id: string;
  ref: string;
  templateKey: string;
  template: string;
  regulator: string;
  formCode: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  daysToDue: number;
  status: string;
  effectiveStatus: string;
  populated: boolean;
  evidenceCount: number;
  maker: string | null;
  submittedBy: string | null;
  submissionRef: string | null;
}
interface Calendar {
  data: FilingRow[];
  counts: { open: number; overdue: number; dueIn14Days: number; inReview: number; awaitingSubmission: number; submitted: number };
}
interface Template {
  key: string;
  regulator: string;
  formCode: string;
  name: string;
  description: string;
  frequency: string;
  dueAfterDays: number;
}
interface Payload {
  template: string;
  period: { start: string; end: string };
  figures: { label: string; value: string }[];
  tables: { name: string; columns: string[]; rows: (string | number | null)[][] }[];
  notes: string[];
}
interface Detail extends FilingRow {
  notes: string | null;
  returnReason: string | null;
  payload: Payload | null;
  payloadSha256: string | null;
  evidence: { id: string; name: string; description: string | null; sha256: string; uploadedBy: string | null; createdAt: string }[];
  timeline: { at: string; action: string; actor: string | null; reason: string | null }[];
  submissions?: { id: string; regulator: string; formCode: string; status: string; receiptRef: string; receivedAt: string; payloadSha256: string; submittedBy: string | null }[];
  actions: { populate: boolean; attachEvidence: boolean; submitForReview: boolean; approve: boolean; return: boolean; submit: boolean; waive: boolean };
}

type Tab = 'calendar' | 'templates';
const G = (p: string) => v1(`/regulatory${p}`);

export default function RegulatoryPage() {
  const canView = useCan('reports.view');
  const canPrepare = useCan('reports.create');
  const [tab, setTab] = useState<Tab>('calendar');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const cal = useResource(() => full<Calendar>(G('/calendar')), []);
  const templates = useResource<Template[]>(() => api.get<Template[]>(G('/templates')), []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('filing');
    if (id) setOpen(id);
  }, []);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Compliance" title="Regulatory reporting" />
        <Alert>You do not have permission to view regulatory reporting.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        kicker="Compliance"
        title="Regulatory reporting"
        subtitle="Filings are populated from live data, evidenced, reviewed by a different person, approved with step-up MFA and submitted by someone who did not prepare them."
        actions={
          canPrepare && (
            <>
              <ActionButton label="Open calendar filings" onRun={() => api.post(G('/calendar/generate'), {})} onDone={cal.reload} />
              <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
                New filing
              </button>
            </>
          )
        }
      />
      <TabBar
        tabs={[
          { key: 'calendar', label: 'Filing calendar' },
          { key: 'templates', label: 'Templates' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'calendar' && (
        <Loaded res={cal}>
          {(c) => (
            <>
              <Tiles
                items={[
                  { label: 'Open', value: c.counts.open },
                  { label: 'Overdue', value: c.counts.overdue, tone: c.counts.overdue ? 'red' : undefined },
                  { label: 'Due in 14 days', value: c.counts.dueIn14Days, tone: c.counts.dueIn14Days ? 'amber' : undefined },
                  { label: 'In review', value: c.counts.inReview },
                  { label: 'Awaiting submission', value: c.counts.awaitingSubmission },
                  { label: 'Submitted', value: c.counts.submitted },
                ]}
              />
              <Card>
                {c.data.length === 0 ? (
                  <Empty>No filings yet. Use Open calendar filings to create the current periods.</Empty>
                ) : (
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th>Filing</th>
                          <th>Form</th>
                          <th>Period</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th>Evidence</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {c.data.map((f) => (
                          <tr key={f.id}>
                            <td>
                              {f.ref}
                              <span className="ops-sub">{f.maker ?? 'not prepared'}</span>
                            </td>
                            <td>
                              {f.template}
                              <span className="ops-sub">{f.regulator} {f.formCode}</span>
                            </td>
                            <td>
                              {dayOf(f.periodStart)} to {dayOf(f.periodEnd)}
                            </td>
                            <td>
                              {dayOf(f.dueDate)}
                              <span className="ops-sub">{['SUBMITTED', 'WAIVED'].includes(f.status) ? '' : f.daysToDue < 0 ? `${-f.daysToDue} days late` : `in ${f.daysToDue} days`}</span>
                            </td>
                            <td>
                              <Tone value={f.effectiveStatus} />
                              {f.effectiveStatus === 'OVERDUE' && <span className="ops-sub">{label(f.status)}</span>}
                            </td>
                            <td>{f.evidenceCount}</td>
                            <td>
                              <button className="ops-btn small" type="button" onClick={() => setOpen(f.id)}>
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </Loaded>
      )}
      {tab === 'templates' && (
        <Loaded res={templates}>
          {(rows) => (
            <Card>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Regulator</th>
                      <th>Frequency</th>
                      <th>Due after period end</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.key}>
                        <td>
                          {t.name}
                          <span className="ops-sub">{t.description}</span>
                        </td>
                        <td>
                          {t.regulator} {t.formCode}
                        </td>
                        <td>{label(t.frequency)}</td>
                        <td>{t.dueAfterDays} days</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </Loaded>
      )}
      {creating && templates.state === 'ok' && (
        <FormModal
          title="New filing"
          submitLabel="Create and populate"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) => api.post<{ id: string }>(G('/filings'), { templateKey: str(fd, 'templateKey'), periodEnd: str(fd, 'periodEnd') || undefined, notes: str(fd, 'notes') || undefined }, { idempotencyKey: key })}
          onDone={(r) => {
            cal.reload();
            setOpen((r as { id: string }).id);
          }}
        >
          <FieldGrid>
            <Field label="Template" span={2}>
              <select className="ops-input" name="templateKey" required>
                {templates.data.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Any date in the period" hint="Blank means the last completed period">
              <input className="ops-input" type="date" name="periodEnd" />
            </Field>
            <Field label="Notes (optional)" span={2}>
              <input className="ops-input" name="notes" maxLength={1000} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {open && <FilingModal id={open} onClose={() => (setOpen(null), cal.reload())} />}
    </>
  );
}

function FilingModal({ id, onClose }: { id: string; onClose: () => void }) {
  const res = useResource<Detail>(() => api.get<Detail>(G(`/filings/${id}`)), [id]);
  const [form, setForm] = useState<'return' | 'submit' | 'waive' | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const post = (path: string) => (key: string) => api.post(G(`/filings/${id}${path}`), {}, { idempotencyKey: key });

  return (
    <Modal title="Filing" kicker="Regulatory reporting" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res}>
          {(f) => (
            <>
              <DefinitionList
                items={[
                  ['Filing', `${f.ref} - ${f.template}`],
                  ['Period', `${dayOf(f.periodStart)} to ${dayOf(f.periodEnd)}`],
                  ['Due', dayOf(f.dueDate)],
                  ['Status', <Tone key="s" value={f.effectiveStatus} />],
                  ['Prepared by', f.maker ?? 'nobody yet'],
                  ['Submission reference', f.submissionRef ?? '-'],
                  ['Payload hash', f.payloadSha256 ? f.payloadSha256.slice(0, 16) : 'not locked'],
                ]}
              />
              {f.returnReason && <Alert kind="warn">{f.status === 'WAIVED' ? 'Waived' : 'Returned'}: {f.returnReason}</Alert>}
              <div className="ops-actions" style={{ margin: '10px 0' }}>
                {f.actions.populate && <ActionButton label="Rebuild from live data" confirm="Rebuild the figures from live data? You become the preparer." onRun={post('/populate')} onDone={res.reload} />}
                {f.actions.submitForReview && (() => {
                  // Derived from the current filing, and keyed on it, so a failure message from an earlier click cannot outlive the fix.
                  const missing = [!f.payload && 'populate the figures', f.evidence.length === 0 && 'attach at least one piece of evidence'].filter(Boolean) as string[];
                  return (
                    <>
                      <ActionButton key={`${f.payload ? 'p' : 'n'}-${f.evidence.length}`} primary label="Send for review" disabled={missing.length > 0} title={missing.length ? `First ${missing.join(' and ')}` : undefined} onRun={post('/submit-review')} onDone={res.reload} />
                      {missing.length > 0 && <span className="ops-sub">First {missing.join(' and ')}.</span>}
                    </>
                  );
                })()}
                {f.actions.approve && <ActionButton primary label="Approve" onRun={post('/approve')} onDone={res.reload} />}
                {f.actions.return && <button className="ops-btn" type="button" onClick={() => setForm('return')}>Return</button>}
                {f.actions.submit && <button className="ops-btn primary" type="button" onClick={() => setForm('submit')}>Record submission</button>}
                {f.actions.waive && <button className="ops-btn danger" type="button" onClick={() => setForm('waive')}>Waive</button>}
                {f.payload && (
                  <button
                    className="ops-btn"
                    type="button"
                    onClick={async () => {
                      const r = await api.get<{ filename: string; csv: string }>(G(`/filings/${id}/export`));
                      saveText(r.filename, r.csv);
                    }}
                  >
                    Download CSV
                  </button>
                )}
              </div>

              <h3>Figures</h3>
              {!f.payload ? (
                <Empty>Not populated yet.</Empty>
              ) : (
                <>
                  <DefinitionList items={f.payload.figures.map((x): [string, string] => [x.label, x.value])} />
                  {f.payload.tables.map((t) => (
                    <div key={t.name} style={{ marginTop: 12 }}>
                      <strong>{t.name}</strong>
                      <SimpleTable columns={t.columns} rows={t.rows} />
                    </div>
                  ))}
                  {f.payload.notes.map((n) => (
                    <p key={n} className="ops-muted">
                      {n}
                    </p>
                  ))}
                </>
              )}

              <h3 style={{ marginTop: 18 }}>Evidence</h3>
              {f.evidence.length === 0 ? (
                <p className="ops-muted">No evidence attached. At least one item is needed before review.</p>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <tbody>
                      {f.evidence.map((e) => (
                        <tr key={e.id}>
                          <td>
                            {e.name}
                            <span className="ops-sub">{e.description}</span>
                          </td>
                          <td>
                            {e.uploadedBy}
                            <span className="ops-sub">{when(e.createdAt)}</span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="ops-btn small" type="button" onClick={() => openLink(G(`/filings/${id}/evidence/${e.id}/link`))}>
                              Download
                            </button>{' '}
                            {f.actions.attachEvidence && <ActionButton label="Remove" danger confirm={`Remove ${e.name}?`} onRun={() => fetchDelete(G(`/filings/${id}/evidence/${e.id}`))} onDone={res.reload} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {f.actions.attachEvidence && (
                <div className="ops-filters" style={{ marginTop: 8 }}>
                  <input ref={fileRef} type="file" className="ops-input" />
                  <button
                    className="ops-btn"
                    type="button"
                    disabled={uploading}
                    onClick={async () => {
                      const file = fileRef.current?.files?.[0];
                      if (!file) return setUploadErr('Choose a file first');
                      setUploading(true);
                      setUploadErr(null);
                      try {
                        await upload(G(`/filings/${id}/evidence`), file);
                        if (fileRef.current) fileRef.current.value = '';
                        res.reload();
                      } catch (e) {
                        setUploadErr(e instanceof Error ? e.message : 'Upload failed');
                      } finally {
                        setUploading(false);
                      }
                    }}
                  >
                    {uploading ? 'Uploading...' : 'Attach evidence'}
                  </button>
                  {uploadErr && <span className="ops-error-text">{uploadErr}</span>}
                </div>
              )}

              {f.submissions && f.submissions.length > 0 && (
                <>
                  <h3 style={{ marginTop: 18 }}>Electronic submissions</h3>
                  <ul className="ops-muted" style={{ paddingLeft: 18 }}>
                    {f.submissions.map((s) => (
                      <li key={s.id}>
                        {when(s.receivedAt)}: {s.regulator} {s.formCode} {s.status.toLowerCase()}, receipt {s.receiptRef} (sent by {s.submittedBy ?? 'unknown'})
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3 style={{ marginTop: 18 }}>History</h3>
              <ul className="ops-muted" style={{ paddingLeft: 18 }}>
                {f.timeline.map((t, i) => (
                  <li key={i}>
                    {when(t.at)}: {label(t.action.replace('regulatory.', ''))} by {t.actor ?? 'system'}
                    {t.reason ? ` (${t.reason})` : ''}
                  </li>
                ))}
              </ul>

              {form === 'return' && (
                <FormModal title="Return filing" submitLabel="Return to preparer" onClose={() => setForm(null)} onSubmit={(fd) => api.post(G(`/filings/${id}/return`), { reason: str(fd, 'reason') })} onDone={res.reload}>
                  <Field label="Reason">
                    <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} rows={3} />
                  </Field>
                </FormModal>
              )}
              {form === 'waive' && (
                <FormModal title="Waive filing" danger submitLabel="Waive" onClose={() => setForm(null)} onSubmit={(fd) => api.post(G(`/filings/${id}/waive`), { reason: str(fd, 'reason') })} onDone={res.reload}>
                  <Field label="Reason (for example, no activity in the period)">
                    <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} rows={3} />
                  </Field>
                </FormModal>
              )}
              {form === 'submit' && (
                <FormModal title="Record submission" submitLabel="Record as submitted" onClose={() => setForm(null)} onSubmit={(fd, key) => api.post(G(`/filings/${id}/submit`), { submissionRef: str(fd, 'submissionRef') }, { idempotencyKey: key })} onDone={res.reload}>
                  <p className="ops-muted">Upload the CSV to the regulator portal first, then enter the acknowledgement reference here.</p>
                  <Field label="Regulator reference">
                    <input className="ops-input" name="submissionRef" required minLength={3} maxLength={80} />
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

const fetchDelete = (path: string) => apiRequest('DELETE', path);
