'use client';

import { useState } from 'react';
import { api, apiRequest, v1 } from '@/ops/api';
import { useCan } from '@/ops/session';
import { dayOf, full, SimpleTable, Tiles, Tone, when } from '@/ops/suite';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, Loaded, optStr, str, useResource } from '@/ops/ui';

/** R4-9 panels for the Data Fabric page: rule schedules, the exception work queue and dataset lineage. */
const D = (p: string) => v1(`/data${p}`);

interface Schedule {
  id: string;
  ruleId: string;
  ruleKey: string | null;
  ruleName: string | null;
  dataset: string | null;
  severity: string | null;
  cadence: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunRef: string | null;
  lastStatus: string | null;
  due: boolean;
}
interface QueueRow {
  id: string;
  ruleKey: string;
  dataset: string;
  severity: string;
  recordKey: string;
  detail: string;
  status: string;
  createdAt: string;
  ownerId: string | null;
  owner: string | null;
  dueOn: string | null;
  overdue: boolean;
  escalationLevel: number;
}
interface Staff {
  id: string;
  name: string;
}
interface Graph {
  nodes: { key: string; label: string; feed: boolean; rules: number; failing: number; openExceptions: number; downstream: number; upstream: number }[];
  edges: { id: string; from: string; to: string; kind: string; description: string | null }[];
}
interface Impact {
  dataset: string;
  upstream: string[];
  downstream: string[];
  upstreamOpenExceptions: { dataset: string; openExceptions: number }[];
}

export function AutomationTab() {
  return (
    <>
      <SchedulesPanel />
      <QueuePanel />
      <LineagePanel />
    </>
  );
}

function SchedulesPanel() {
  const canManage = useCan('data.manage');
  const res = useResource(() => full<{ data: Schedule[]; cadences: string[] }>(D('/schedules')), []);
  const rules = useResource(() => full<{ data: { id: string; key: string; name: string }[] }>(D('/rules')), []);
  const [adding, setAdding] = useState(false);
  return (
    <Card
      title="Scheduled rule runs"
      actions={
        canManage && (
          <>
            <ActionButton label="Run due now" onRun={() => api.post(D('/schedules/run-due'), {})} onDone={res.reload} />
            <button className="ops-btn primary" onClick={() => setAdding(true)}>
              Schedule a rule
            </button>
          </>
        )
      }
    >
      <p className="ops-muted">The worker runs each scheduled rule when it falls due and announces failures to data managers. A switched-off feature flag (Settings, Scheduled data-quality runs) pauses all of them.</p>
      <Loaded res={res}>
        {(r) =>
          r.data.length === 0 ? (
            <Empty>No rule is scheduled.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Cadence</th>
                    <th>Next run</th>
                    <th>Last run</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {r.data.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.ruleName}
                        <span className="ops-sub">
                          {s.ruleKey} - {s.dataset}
                        </span>
                      </td>
                      <td>{s.cadence}</td>
                      <td>
                        {s.enabled ? when(s.nextRunAt) : 'Paused'}
                        {s.due && <span className="ops-sub">due now</span>}
                      </td>
                      <td>
                        {when(s.lastRunAt)}
                        <span className="ops-sub">{s.lastRunRef}</span>
                      </td>
                      <td>{s.lastStatus ? <Tone value={s.lastStatus} /> : '-'}</td>
                      <td>
                        {canManage && (
                          <>
                            <ActionButton
                              label={s.enabled ? 'Pause' : 'Resume'}
                              onRun={() => api.put(D(`/rules/${s.ruleId}/schedule`), { cadence: s.cadence, enabled: !s.enabled })}
                              onDone={res.reload}
                            />
                            <ActionButton label="Remove" danger confirm="Remove this schedule?" onRun={() => apiRequest('DELETE', D(`/rules/${s.ruleId}/schedule`))} onDone={res.reload} />
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {adding && (
        <FormModal
          title="Schedule a rule"
          submitLabel="Save schedule"
          onClose={() => setAdding(false)}
          onSubmit={(fd, k) => api.put(D(`/rules/${str(fd, 'ruleId')}/schedule`), { cadence: str(fd, 'cadence'), enabled: true }, { idempotencyKey: k })}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Rule">
              <select className="ops-input" name="ruleId" required>
                {rules.state === 'ok' &&
                  rules.data.data.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.key} - {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Cadence">
              <select className="ops-input" name="cadence" defaultValue="DAILY">
                {(res.state === 'ok' ? res.data.cadences : ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function QueuePanel() {
  const canManage = useCan('data.manage');
  const [filter, setFilter] = useState('');
  const res = useResource(() => full<{ data: QueueRow[] }>(D(`/exception-queue${filter ? `?${filter}=1` : ''}`)), [filter]);
  const staff = useResource(() => full<{ data: Staff[] }>(D('/staff')), []);
  const [assign, setAssign] = useState<QueueRow | null>(null);
  return (
    <Card title="Exception work queue">
      <div className="ops-filters">
        <Field label="Show">
          <select className="ops-input" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All open</option>
            <option value="mine">Assigned to me</option>
            <option value="overdue">Overdue</option>
            <option value="unowned">Unowned</option>
          </select>
        </Field>
      </div>
      <Loaded res={res}>
        {(r) =>
          r.data.length === 0 ? (
            <Empty>No open exceptions match.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Record</th>
                    <th>Severity</th>
                    <th>Owner</th>
                    <th>Due</th>
                    <th>Escalation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {r.data.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.ruleKey}
                        <span className="ops-sub">{e.dataset}</span>
                      </td>
                      <td>
                        {e.recordKey}
                        <span className="ops-sub">{e.detail}</span>
                      </td>
                      <td>
                        <Tone value={e.severity} />
                      </td>
                      <td>{e.owner ?? 'Unowned'}</td>
                      <td>
                        {dayOf(e.dueOn)}
                        {e.overdue && <span className="ops-sub">overdue</span>}
                      </td>
                      <td>{e.escalationLevel ? `Level ${e.escalationLevel}` : '-'}</td>
                      <td>{canManage && <button className="ops-btn" onClick={() => setAssign(e)}>Assign</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {assign && (
        <FormModal
          title={`Assign ${assign.ruleKey} ${assign.recordKey}`}
          submitLabel="Assign"
          onClose={() => setAssign(null)}
          onSubmit={(fd, k) => api.post(D(`/exceptions/${assign.id}/assign`, ), { ownerId: str(fd, 'ownerId'), dueOn: optStr(fd, 'dueOn'), note: optStr(fd, 'note') }, { idempotencyKey: k })}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Owner">
              <select className="ops-input" name="ownerId" required defaultValue={assign.ownerId ?? ''}>
                <option value="" disabled>
                  Choose
                </option>
                {staff.state === 'ok' && staff.data.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Due date">
              <input className="ops-input" type="date" name="dueOn" />
            </Field>
            <Field label="Note" span={2}>
              <input className="ops-input" name="note" maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function LineagePanel() {
  const canManage = useCan('data.manage');
  const res = useResource(() => full<{ data: Graph }>(D('/lineage')), []);
  const [focus, setFocus] = useState('');
  const impact = useResource(() => (focus ? full<{ data: Impact }>(D(`/lineage/impact?dataset=${encodeURIComponent(focus)}`)) : Promise.resolve(null)), [focus]);
  const [adding, setAdding] = useState(false);
  return (
    <Card
      title="Dataset lineage"
      actions={canManage && <button className="ops-btn primary" onClick={() => setAdding(true)}>Add link</button>}
    >
      <Loaded res={res}>
        {(r) => (
          <>
            <Tiles
              items={[
                { label: 'Datasets', value: r.data.nodes.length },
                { label: 'Links', value: r.data.edges.length },
                { label: 'With failing rules', value: r.data.nodes.filter((n) => n.failing > 0).length, tone: r.data.nodes.some((n) => n.failing > 0) ? 'red' : 'green' },
              ]}
            />
            {r.data.edges.length === 0 ? (
              <Empty>No lineage recorded.</Empty>
            ) : (
              <SimpleTable
                columns={['From', 'Relationship', 'To', 'Note']}
                rows={r.data.edges.map((e) => [e.from, e.kind.toLowerCase(), e.to, e.description ?? ''])}
              />
            )}
            <div className="ops-filters">
              <Field label="Impact of a problem in">
                <select className="ops-input" value={focus} onChange={(e) => setFocus(e.target.value)}>
                  <option value="">Choose a dataset</option>
                  {r.data.nodes.map((n) => (
                    <option key={n.key} value={n.key}>
                      {n.label}
                      {n.openExceptions ? ` (${n.openExceptions} open)` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {focus && (
              <Loaded res={impact}>
                {(i) =>
                  i ? (
                    <Alert kind="info">
                      Downstream (affected): {i.data.downstream.join(', ') || 'none'}. Upstream (possible causes): {i.data.upstream.join(', ') || 'none'}.
                      {i.data.upstreamOpenExceptions.length > 0 && ` Open upstream exceptions: ${i.data.upstreamOpenExceptions.map((u) => `${u.dataset} ${u.openExceptions}`).join(', ')}.`}
                    </Alert>
                  ) : null
                }
              </Loaded>
            )}
            {adding && (
              <FormModal
                title="Add lineage link"
                submitLabel="Add"
                onClose={() => setAdding(false)}
                onSubmit={(fd, k) => api.post(D('/lineage'), { fromDataset: str(fd, 'fromDataset'), toDataset: str(fd, 'toDataset'), kind: str(fd, 'kind'), description: optStr(fd, 'description') }, { idempotencyKey: k })}
                onDone={res.reload}
              >
                <FieldGrid>
                  <Field label="From">
                    <select className="ops-input" name="fromDataset" required>
                      {r.data.nodes.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
                    </select>
                  </Field>
                  <Field label="To">
                    <select className="ops-input" name="toDataset" required>
                      {r.data.nodes.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Relationship">
                    <select className="ops-input" name="kind" defaultValue="FEEDS">
                      <option>FEEDS</option>
                      <option>DERIVES</option>
                      <option>VALIDATES</option>
                    </select>
                  </Field>
                  <Field label="Note" span={2}>
                    <input className="ops-input" name="description" maxLength={300} />
                  </Field>
                </FieldGrid>
              </FormModal>
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}
