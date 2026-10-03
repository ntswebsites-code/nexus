'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, apiRequest, v1 } from '@/ops/api';
import { AREAS, areaLabel, Bar, STATE_TONE, Tile, moneyFmt, type OpsStatus, type Task, type TaskList } from '@/ops/operations';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, optStr, PageHeader, str, useResource } from '@/ops/ui';

type Filter = 'all' | 'due' | 'blocked' | 'scheduled' | 'done';

export default function OperationsPage() {
  const canWork = useCan('operations.view');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Task | null>(null);
  const status = useResource<OpsStatus>(() => api.get<OpsStatus>(v1('/operations/status')), []);
  const tasks = useResource<TaskList>(() => apiRequest<TaskList>('GET', v1(`/operations/tasks?filter=${filter}`)), [filter]);
  const reload = () => {
    status.reload();
    tasks.reload();
  };

  return (
    <>
      <PageHeader
        kicker="Today's operating day · deadlines · dependencies · hand-offs"
        title="Operations Control"
        subtitle="A control tower over settlement, cash, corporate actions, valuation and close. Status is read live from each control workspace; runbook tasks are saved, owned and audited."
        actions={
          canWork && (
            <>
              <ActionButton label="Refresh runbook" onRun={() => api.post(v1('/operations/tasks/generate'))} onDone={reload} />{' '}
              <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
                + Operations task
              </button>
            </>
          )
        }
      />

      <Loaded res={status} what="operations status">
        {(s) => (
          <>
            <div className="ops-tiles">
              <Tile label="Due today" value={s.kpis.dueToday} hint={`${s.kpis.blockedTasks} blocked`} />
              <Tile label="Settlement exposure" value={s.kpis.settlementExposure.length ? s.kpis.settlementExposure.map((e) => moneyFmt(e.amount, e.currency)).join(' · ') : '0.00'} hint={`${s.kpis.unsettledOrders} unsettled order${s.kpis.unsettledOrders === 1 ? '' : 's'}`} />
              <Tile label="Cash deadlines" value={s.kpis.cashDeadlines} hint={`${moneyFmt(s.kpis.cashGross)} gross expected today or overdue`} />
              <Tile label="Corporate actions" value={s.kpis.corporateActions} hint={`${s.kpis.electionsDue} election${s.kpis.electionsDue === 1 ? '' : 's'} due`} />
              <Tile label="Close blockers" value={s.kpis.closeBlockers} hint="Cash close, NAV exceptions, high-severity breaks" />
              <Tile label="Service health" value={s.kpis.serviceHealth === 'ok' ? 'Live' : 'Degraded'} hint="Database connectivity" />
            </div>

            <div className="ops-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
              <Card title="Today's runbook">
                <div className="ops-filters">
                  {(['all', 'due', 'blocked', 'scheduled', 'done'] as Filter[]).map((f) => (
                    <button key={f} type="button" className={`ops-btn small${filter === f ? ' primary' : ''}`} onClick={() => setFilter(f)}>
                      {f[0]!.toUpperCase() + f.slice(1)}
                      {tasks.state === 'ok' && f !== 'all' && f === filter ? ` (${tasks.data.total})` : ''}
                    </button>
                  ))}
                </div>
                <Loaded res={tasks} what="runbook tasks">
                  {(t) =>
                    t.data.length === 0 ? (
                      <Empty>No tasks here. Refresh the runbook to generate tasks from live conditions, or add one.</Empty>
                    ) : (
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>Due</th>
                            <th>State</th>
                            <th>Task</th>
                            <th>Owner</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.data.map((x) => (
                            <tr key={x.id} onClick={() => setOpen(x)} style={{ cursor: 'pointer' }}>
                              <td>{formatDateTime(x.dueAt)}</td>
                              <td>
                                <span className={`ops-badge ${STATE_TONE[x.state] ?? 'grey'}`}>{x.state.toLowerCase()}</span>
                              </td>
                              <td>
                                <strong>{areaLabel(x.area)}</strong> · {x.title}
                                <br />
                                <span className="ops-muted">{x.dependsOn ? `after ${x.dependsOn.ref} · ` : ''}{x.system ? 'generated' : 'manual'} · {x.ref}</span>
                              </td>
                              <td>{x.ownerName ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  }
                </Loaded>
              </Card>

              <Card title="Close dependencies">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                  {s.dependencies.map((d) => (
                    <Link key={d.key} href={d.link} className="ops-tile" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <p style={{ textTransform: 'uppercase', fontSize: 10, fontWeight: 800, letterSpacing: '0.07em' }}>{d.label}</p>
                      <h3 style={{ fontSize: 22, margin: '4px 0' }}>{d.readinessPct}% ready</h3>
                      <Bar pct={d.readinessPct} />
                      <p style={{ marginTop: 6 }}>{d.detail}</p>
                    </Link>
                  ))}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 8 }}>
                  <li>
                    <Link href="/ops/reconciliation">Open reconciliations</Link> <span className="ops-muted">· {s.recon.open} open, {s.recon.high} high, {s.recon.pendingChecker} awaiting checker</span>
                  </li>
                  <li>
                    <Link href="/ops/nav">Open NAV and valuation</Link> <span className="ops-muted">· {s.nav.unreleased.length} unreleased, {s.nav.blockers} material exception{s.nav.blockers === 1 ? '' : 's'}</span>
                  </li>
                  <li>
                    <Link href="/ops/corporate-actions">Corporate actions</Link> <span className="ops-muted">· {s.corporateActions.electionsDue} election(s) due, {s.corporateActions.awaitingProcessing} ready to process</span>
                  </li>
                  <li>
                    <Link href="/ops/accounting">Accounting</Link> <span className="ops-muted">· {s.accounting.pendingJournals} pending journal(s), {s.accounting.systemJournals} from the system</span>
                  </li>
                </ul>
              </Card>
            </div>

            <Card title={`Cash close readiness${s.cash.periodEnd ? ` · period ending ${s.cash.periodEnd}` : ''}`}>
              {s.cash.portfolios.length === 0 ? (
                <Empty>No active portfolios.</Empty>
              ) : (
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Portfolio</th>
                      <th>Close</th>
                      <th>Blockers</th>
                      <th>Failing controls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.cash.portfolios.map((p) => (
                      <tr key={p.portfolioId}>
                        <td>
                          {p.portfolioRef} · {p.portfolioName}
                        </td>
                        <td>{p.closeStatus.replace(/_/g, ' ').toLowerCase()}</td>
                        <td>{p.blockers}</td>
                        <td>{p.failing.length ? p.failing.join('; ') : 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="NAV runs not yet released">
              {s.nav.unreleased.length === 0 ? (
                <Empty>Every NAV run is released.</Empty>
              ) : (
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Portfolio</th>
                      <th>NAV date</th>
                      <th>Status</th>
                      <th>Open exceptions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.nav.unreleased.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link href={`/ops/nav/${r.id}`}>{r.ref}</Link>
                        </td>
                        <td>{r.portfolioName ?? r.portfolioRef}</td>
                        <td>{r.navDate}</td>
                        <td>{r.status.replace(/_/g, ' ').toLowerCase()}</td>
                        <td>
                          {r.openExceptions} ({r.materialExceptions} material)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </Loaded>

      {creating && (
        <FormModal
          title="New operations task"
          kicker="Runbook"
          submitLabel="Create task"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) =>
            api.post(
              v1('/operations/tasks'),
              { area: str(fd, 'area'), title: str(fd, 'title'), detail: optStr(fd, 'detail') ?? null, dueAt: str(fd, 'dueAt'), link: optStr(fd, 'link') ?? null },
              { idempotencyKey: key },
            )
          }
          onDone={reload}
        >
          <FieldGrid>
            <Field label="Area">
              <select className="ops-input" name="area" defaultValue="SETTLEMENT">
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {areaLabel(a)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due (UTC)">
              <input className="ops-input" name="dueAt" type="datetime-local" required defaultValue={`${new Date().toISOString().slice(0, 10)}T17:00`} />
            </Field>
          </FieldGrid>
          <Field label="Title">
            <input className="ops-input" name="title" required minLength={3} maxLength={200} />
          </Field>
          <Field label="Detail">
            <textarea className="ops-input" name="detail" maxLength={1000} rows={3} />
          </Field>
          <Field label="Link (optional /ops/ path)">
            <input className="ops-input" name="link" placeholder="/ops/cash" />
          </Field>
        </FormModal>
      )}

      {open && <TaskModal task={open} canWork={canWork} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function TaskModal({ task, canWork, onClose, onChanged }: { task: Task; canWork: boolean; onClose: () => void; onChanged: () => void }) {
  const act = (verb: string, body: Record<string, unknown> = {}) => () => api.post(v1(`/operations/tasks/${task.id}/${verb}`), body);
  const ask = (q: string) => window.prompt(q, '') ?? '';
  const live = !['DONE', 'CANCELLED'].includes(task.status);
  return (
    <FormModal title={`${task.ref} · ${task.title}`} kicker={areaLabel(task.area)} submitLabel="Close" onClose={onClose} onSubmit={async () => undefined}>
      <p>{task.detail ?? 'No further detail.'}</p>
      <p className="ops-muted">
        Due {formatDateTime(task.dueAt)} · status {task.status.toLowerCase().replace(/_/g, ' ')} · {task.system ? 'generated by the system' : 'manual'}
        {task.dependsOn ? ` · depends on ${task.dependsOn.ref} (${task.dependsOn.status.toLowerCase()})` : ''}
      </p>
      {task.blockedReason && <Alert kind="warn">Blocked: {task.blockedReason}</Alert>}
      {task.completedAt && <p className="ops-muted">Completed {formatDateTime(task.completedAt)} by {task.completedByName ?? 'System'}</p>}
      <div className="ops-actions">
        {task.link && (
          <Link className="ops-btn" href={task.link}>
            Open workspace
          </Link>
        )}
        {canWork && live && task.status !== 'IN_PROGRESS' && <ActionButton label="Start" onRun={act('start')} onDone={onChanged} />}
        {canWork && live && <ActionButton label="Complete" primary onRun={act('complete')} onDone={onChanged} />}
        {canWork && live && task.status !== 'BLOCKED' && <ActionButton label="Block" onRun={() => api.post(v1(`/operations/tasks/${task.id}/block`), { reason: ask('Why is it blocked? (5+ characters)') })} onDone={onChanged} />}
        {canWork && live && <ActionButton label="Cancel task" danger onRun={() => api.post(v1(`/operations/tasks/${task.id}/cancel`), { reason: ask('Reason for cancelling (5+ characters)') })} onDone={onChanged} />}
        {canWork && !live && <ActionButton label="Reopen" onRun={() => api.post(v1(`/operations/tasks/${task.id}/reopen`), { reason: ask('Reason for reopening (5+ characters)') })} onDone={onChanged} />}
      </div>
    </FormModal>
  );
}
