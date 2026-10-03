'use client';

import { useEffect, useState } from 'react';
import { api, apiRequest, qs, v1 } from '@/ops/api';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import { dayOf, full, label, Pager, Tiles, Tone, when } from '@/ops/suite';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, Loaded, Modal, PageHeader, optStr, str, useResource } from '@/ops/ui';

interface ModelRow {
  id: string;
  ref: string;
  name: string;
  purpose: string;
  modelType: string;
  tier: number;
  ownerName: string;
  status: string;
  currentVersion: string | null;
  inFlightVersion: { id: string; version: string; status: string } | null;
  nextReviewOn: string | null;
  reviewOverdue: boolean;
  usageCount: number;
  lastUsedAt: string | null;
}
interface Validation {
  id: string;
  validator: string | null;
  outcome: string;
  scope: string;
  findings: string | null;
  evidenceRef: string | null;
  performedOn: string;
}
interface Version {
  id: string;
  version: string;
  status: string;
  changeNote: string;
  documentation: string | null;
  author: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  isCurrent: boolean;
  validations: Validation[];
  actions: { submit: boolean; validate: boolean; approve: boolean; reject: boolean };
}
interface ModelDetail extends ModelRow {
  createdBy: string | null;
  versionList: Version[];
  timeline: { at: string; action: string; actor: string | null; reason: string | null }[];
}
interface UsageRow {
  id: string;
  modelRef: string;
  modelName: string;
  version: string | null;
  context: string;
  objectRef: string | null;
  note: string | null;
  usedBy: string | null;
  usedAt: string;
}
interface Summary {
  byStatus: Record<string, number>;
  byTier: Record<string, number>;
  reviewsOverdue: number;
  awaitingValidation: number;
  awaitingApproval: number;
  usesLast30Days: number;
}

const TYPES = ['PRICING', 'RISK', 'CREDIT', 'SCORING', 'FORECAST', 'OTHER'];
const M = (p: string) => v1(`/model-governance${p}`);
type Tab = 'inventory' | 'usage';
const PAGE = 25;

export default function ModelGovernancePage() {
  const canView = useCan('risk.view');
  const canAuthor = useCan('risk.manage');
  const [tab, setTab] = useState<Tab>('inventory');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const models = useResource(() => full<{ data: ModelRow[]; total: number }>(M('/models')), []);
  const summary = useResource<Summary>(() => api.get<Summary>(M('/summary')), []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('model');
    if (id) setOpen(id);
  }, []);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Risk" title="Model governance" />
        <Alert>You do not have permission to view model governance.</Alert>
      </>
    );
  }
  const reload = () => (models.reload(), summary.reload());
  return (
    <>
      <PageHeader
        kicker="Risk"
        title="Model governance"
        subtitle="Every model is registered, versioned, independently validated and approved before use. The author, the validator and the approver are three different people, and the usage log refuses a model with no approved version."
        actions={canAuthor && <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>Register model</button>}
      />
      {summary.state === 'ok' && (
        <Tiles
          items={[
            { label: 'Approved models', value: summary.data.byStatus.APPROVED ?? 0 },
            { label: 'Awaiting validation', value: summary.data.awaitingValidation, tone: summary.data.awaitingValidation ? 'amber' : undefined },
            { label: 'Awaiting approval', value: summary.data.awaitingApproval, tone: summary.data.awaitingApproval ? 'amber' : undefined },
            { label: 'Reviews overdue', value: summary.data.reviewsOverdue, tone: summary.data.reviewsOverdue ? 'red' : undefined },
            { label: 'Uses, last 30 days', value: summary.data.usesLast30Days },
          ]}
        />
      )}
      <TabBar
        tabs={[
          { key: 'inventory', label: 'Model inventory' },
          { key: 'usage', label: 'Usage log' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'inventory' && (
        <Card>
          <Loaded res={models}>
            {(r) =>
              r.data.length === 0 ? (
                <Empty>No models registered.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Type</th>
                        <th>Tier</th>
                        <th>Owner</th>
                        <th>Version</th>
                        <th>Next review</th>
                        <th>Uses</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {r.data.map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.name}
                            <span className="ops-sub">{m.ref}</span>
                          </td>
                          <td>{label(m.modelType)}</td>
                          <td>{m.tier}</td>
                          <td>{m.ownerName}</td>
                          <td>
                            {m.currentVersion ?? '-'}
                            {m.inFlightVersion && <span className="ops-sub">v{m.inFlightVersion.version} {label(m.inFlightVersion.status)}</span>}
                          </td>
                          <td>
                            {dayOf(m.nextReviewOn)}
                            {m.reviewOverdue && <span className="ops-sub" style={{ color: 'var(--ops-red, #b42318)' }}>overdue</span>}
                          </td>
                          <td>{m.usageCount}</td>
                          <td>
                            <Tone value={m.status} />
                          </td>
                          <td>
                            <button className="ops-btn small" type="button" onClick={() => setOpen(m.id)}>
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
      )}
      {tab === 'usage' && <UsageTab />}
      {adding && (
        <FormModal
          title="Register model"
          submitLabel="Register"
          onClose={() => setAdding(false)}
          onSubmit={(fd, key) =>
            api.post(M('/models'), { name: str(fd, 'name'), purpose: str(fd, 'purpose'), modelType: str(fd, 'modelType'), tier: Number(str(fd, 'tier')), ownerName: str(fd, 'ownerName'), nextReviewOn: optStr(fd, 'nextReviewOn'), changeNote: optStr(fd, 'changeNote'), documentation: optStr(fd, 'documentation') }, { idempotencyKey: key })
          }
          onDone={reload}
        >
          <FieldGrid>
            <Field label="Name" span={2}>
              <input className="ops-input" name="name" required minLength={3} maxLength={160} />
            </Field>
            <Field label="Purpose" span={2}>
              <textarea className="ops-input" name="purpose" required minLength={10} maxLength={600} rows={3} />
            </Field>
            <Field label="Type">
              <select className="ops-input" name="modelType">
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tier" hint="1 is highest materiality">
              <select className="ops-input" name="tier" defaultValue="2">
                <option>1</option>
                <option>2</option>
                <option>3</option>
              </select>
            </Field>
            <Field label="Owner">
              <input className="ops-input" name="ownerName" required maxLength={120} />
            </Field>
            <Field label="Next review (optional)">
              <input className="ops-input" type="date" name="nextReviewOn" />
            </Field>
            <Field label="Documentation link or reference (optional)" span={2}>
              <input className="ops-input" name="documentation" maxLength={300} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {open && <ModelModal id={open} onClose={() => (setOpen(null), reload())} />}
    </>
  );
}

function UsageTab() {
  const [offset, setOffset] = useState(0);
  const res = useResource(() => full<{ data: UsageRow[]; total: number }>(M(`/usage${qs({ limit: String(PAGE), offset: String(offset) })}`)), [offset]);
  return (
    <Card>
      <Loaded res={res}>
        {(r) =>
          r.data.length === 0 ? (
            <Empty>No model use recorded yet.</Empty>
          ) : (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Model</th>
                      <th>Version</th>
                      <th>Context</th>
                      <th>Object</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((u) => (
                      <tr key={u.id}>
                        <td>{when(u.usedAt)}</td>
                        <td>
                          {u.modelName}
                          <span className="ops-sub">{u.modelRef}</span>
                        </td>
                        <td>{u.version}</td>
                        <td>
                          {u.context}
                          <span className="ops-sub">{u.note}</span>
                        </td>
                        <td>{u.objectRef ?? '-'}</td>
                        <td>{u.usedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={PAGE} total={r.total} onChange={setOffset} />
            </>
          )
        }
      </Loaded>
    </Card>
  );
}

type Form = { kind: 'version' } | { kind: 'validate' | 'reject'; v: Version } | { kind: 'usage' } | { kind: 'retire' } | null;

function ModelModal({ id, onClose }: { id: string; onClose: () => void }) {
  const res = useResource<ModelDetail>(() => api.get<ModelDetail>(M(`/models/${id}`)), [id]);
  const canAuthor = useCan('risk.manage');
  const canApprove = useCan('model.approve');
  const canUse = useCan('risk.manage', 'portfolio.manage', 'valuation.release', 'model.approve');
  const [form, setForm] = useState<Form>(null);
  const [warn, setWarn] = useState<string | null>(null);
  return (
    <Modal title="Model" kicker="Model governance" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res}>
          {(m) => (
            <>
              <DefinitionList
                items={[
                  ['Model', `${m.ref} - ${m.name}`],
                  ['Purpose', m.purpose],
                  ['Type and tier', `${label(m.modelType)}, tier ${m.tier}`],
                  ['Owner', m.ownerName],
                  ['Status', <Tone key="s" value={m.status} />],
                  ['Approved version', m.currentVersion ?? 'none'],
                  ['Next review', dayOf(m.nextReviewOn) + (m.reviewOverdue ? ' (overdue)' : '')],
                  ['Registered by', m.createdBy ?? '-'],
                ]}
              />
              <Alert kind="warn">{warn}</Alert>
              <div className="ops-actions" style={{ margin: '10px 0' }}>
                {canAuthor && m.status !== 'RETIRED' && !m.inFlightVersion && (
                  <button className="ops-btn" type="button" onClick={() => setForm({ kind: 'version' })}>
                    Draft new version
                  </button>
                )}
                {canUse && m.status === 'APPROVED' && (
                  <button className="ops-btn primary" type="button" onClick={() => setForm({ kind: 'usage' })}>
                    Log usage
                  </button>
                )}
                {canApprove && m.status !== 'RETIRED' && (
                  <button className="ops-btn danger" type="button" onClick={() => setForm({ kind: 'retire' })}>
                    Retire model
                  </button>
                )}
              </div>

              <h3>Versions</h3>
              {m.versionList.map((v) => (
                <Card key={v.id} title={`Version ${v.version}${v.isCurrent ? ' (current)' : ''}`} actions={<Tone value={v.status} />}>
                  <p>{v.changeNote}</p>
                  <p className="ops-sub">
                    Author {v.author}
                    {v.documentation ? `, docs: ${v.documentation}` : ''}
                    {v.approvedBy ? `, approved by ${v.approvedBy} on ${dayOf(v.approvedAt)}` : ''}
                  </p>
                  {v.decisionNote && <p className="ops-muted">{v.decisionNote}</p>}
                  {v.validations.length > 0 && (
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>Validation</th>
                            <th>By</th>
                            <th>Scope</th>
                            <th>Findings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.validations.map((x) => (
                            <tr key={x.id}>
                              <td>
                                <Tone value={x.outcome} />
                                <span className="ops-sub">{dayOf(x.performedOn)}</span>
                              </td>
                              <td>{x.validator}</td>
                              <td>
                                {x.scope}
                                <span className="ops-sub">{x.evidenceRef}</span>
                              </td>
                              <td>{x.findings ?? '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="ops-actions" style={{ marginTop: 8 }}>
                    {v.actions.submit && <ActionButton primary label="Submit for validation" onRun={() => api.post(M(`/versions/${v.id}/submit`), {})} onDone={res.reload} />}
                    {v.actions.validate && (
                      <button className="ops-btn" type="button" onClick={() => setForm({ kind: 'validate', v })}>
                        Record validation
                      </button>
                    )}
                    {v.actions.approve && <ActionButton primary label="Approve" confirm={`Approve ${m.name} v${v.version} for use?`} onRun={(k) => api.post(M(`/versions/${v.id}/approve`), {}, { idempotencyKey: k })} onDone={res.reload} />}
                    {v.actions.reject && (
                      <button className="ops-btn" type="button" onClick={() => setForm({ kind: 'reject', v })}>
                        Reject
                      </button>
                    )}
                  </div>
                </Card>
              ))}

              <h3 style={{ marginTop: 18 }}>History</h3>
              <ul className="ops-muted" style={{ paddingLeft: 18 }}>
                {m.timeline.map((t, i) => (
                  <li key={i}>
                    {when(t.at)}: {label(t.action.replace('model.', ''))} by {t.actor ?? 'system'}
                    {t.reason ? ` (${t.reason})` : ''}
                  </li>
                ))}
              </ul>

              {form?.kind === 'version' && (
                <FormModal title="Draft new version" submitLabel="Create draft" onClose={() => setForm(null)} onSubmit={(fd, k) => api.post(M(`/models/${m.id}/versions`), { version: str(fd, 'version'), changeNote: str(fd, 'changeNote'), documentation: optStr(fd, 'documentation') }, { idempotencyKey: k })} onDone={res.reload}>
                  <FieldGrid>
                    <Field label="Version">
                      <input className="ops-input" name="version" required maxLength={20} placeholder="1.1" />
                    </Field>
                    <Field label="Documentation (optional)">
                      <input className="ops-input" name="documentation" maxLength={300} />
                    </Field>
                    <Field label="What changed" span={2}>
                      <textarea className="ops-input" name="changeNote" required minLength={3} maxLength={1000} rows={3} />
                    </Field>
                  </FieldGrid>
                </FormModal>
              )}
              {form?.kind === 'validate' && (
                <FormModal title={`Validation of v${form.v.version}`} submitLabel="Record validation" onClose={() => setForm(null)} onSubmit={(fd, k) => api.post(M(`/versions/${form.v.id}/validations`), { outcome: str(fd, 'outcome'), scope: str(fd, 'scope'), findings: optStr(fd, 'findings'), evidenceRef: optStr(fd, 'evidenceRef') }, { idempotencyKey: k })} onDone={res.reload}>
                  <p className="ops-muted">A failed validation rejects the version. A pass lets a third person approve it.</p>
                  <FieldGrid>
                    <Field label="Outcome">
                      <select className="ops-input" name="outcome" defaultValue="PASS">
                        <option value="PASS">Pass</option>
                        <option value="PASS_WITH_FINDINGS">Pass with findings</option>
                        <option value="FAIL">Fail</option>
                      </select>
                    </Field>
                    <Field label="Evidence reference (optional)">
                      <input className="ops-input" name="evidenceRef" maxLength={200} />
                    </Field>
                    <Field label="Scope tested" span={2}>
                      <input className="ops-input" name="scope" required minLength={5} maxLength={300} />
                    </Field>
                    <Field label="Findings (required unless Pass)" span={2}>
                      <textarea className="ops-input" name="findings" maxLength={2000} rows={3} />
                    </Field>
                  </FieldGrid>
                </FormModal>
              )}
              {form?.kind === 'reject' && (
                <FormModal title={`Reject v${form.v.version}`} danger submitLabel="Reject" onClose={() => setForm(null)} onSubmit={(fd) => api.post(M(`/versions/${form.v.id}/reject`), { reason: str(fd, 'reason') })} onDone={res.reload}>
                  <Field label="Reason">
                    <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} rows={3} />
                  </Field>
                </FormModal>
              )}
              {form?.kind === 'retire' && (
                <FormModal title="Retire model" danger submitLabel="Retire" onClose={() => setForm(null)} onSubmit={(fd, k) => api.post(M(`/models/${m.id}/retire`), { reason: str(fd, 'reason') }, { idempotencyKey: k })} onDone={res.reload}>
                  <p className="ops-muted">A retired model can no longer be used. This cannot be undone.</p>
                  <Field label="Reason">
                    <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} rows={3} />
                  </Field>
                </FormModal>
              )}
              {form?.kind === 'usage' && (
                <FormModal
                  title="Log model usage"
                  submitLabel="Log usage"
                  onClose={() => setForm(null)}
                  onSubmit={async (fd, k) => {
                    const out = await apiPost(M(`/models/${m.id}/usage`), { context: str(fd, 'context'), objectRef: optStr(fd, 'objectRef'), note: optStr(fd, 'note') }, k);
                    setWarn(out.warning ?? null);
                  }}
                  onDone={res.reload}
                >
                  <FieldGrid>
                    <Field label="Used for" span={2} hint="For example: NAV pricing for the June close">
                      <input className="ops-input" name="context" required minLength={3} maxLength={200} />
                    </Field>
                    <Field label="Object reference (optional)">
                      <input className="ops-input" name="objectRef" maxLength={60} placeholder="NAV-00012" />
                    </Field>
                    <Field label="Note (optional)">
                      <input className="ops-input" name="note" maxLength={500} />
                    </Field>
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

const apiPost = (path: string, body: unknown, key: string) => apiRequest<{ warning?: string }>('POST', path, body, { idempotencyKey: key });
