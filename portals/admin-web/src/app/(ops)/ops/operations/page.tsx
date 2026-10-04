'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, apiDownload, apiRequest, qs, v1 } from '@/ops/api';
import { CalendarCard, TaskComments, WorkloadCard, type TaskFilter } from '@/ops/opsinsights';
import { AREAS, areaLabel, Bar, STATE_TONE, Tile, moneyFmt, type HandOff, type OpsStatus, type Task, type TaskList } from '@/ops/operations';
import { ReasonModal } from '@/ops/rp';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

type Filter = 'all' | 'due' | 'blocked' | 'scheduled' | 'done';

export default function OperationsPage() {
  const canView = useCan('operations.view');
  // FR-OPS-012: changing tasks needs the action-level permission; operations.view alone reads and comments.
  const canWork = useCan('operations.task.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [chart, setChart] = useState<TaskFilter | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Task | null>(null);
  const status = useResource<OpsStatus>(() => api.get<OpsStatus>(v1('/operations/status')), []);
  const taskQuery = qs({ filter, ownerId: chart?.ownerId, area: chart?.area, dueDate: chart?.dueDate });
  const exportPath = (format: string) => `/api/v1/operations/tasks${qs({ filter, ownerId: chart?.ownerId, area: chart?.area, dueDate: chart?.dueDate, format })}`;
  const tasks = useResource<TaskList>(() => apiRequest<TaskList>('GET', v1(`/operations/tasks${taskQuery}`)), [taskQuery]);
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
          <>
            {canWork && <ActionButton label="Refresh runbook" onRun={(key) => api.post(v1('/operations/tasks/generate'), {}, { idempotencyKey: key })} onDone={reload} />}{' '}
            {/* The export holds exactly the rows the runbook shows under the active filter. */}
            {canView && <ActionButton label="Export CSV" onRun={() => apiDownload(exportPath('csv'), 'runbook.csv')} />}{' '}
            {canView && <ActionButton label="Export XLSX" onRun={() => apiDownload(exportPath('xlsx'), 'runbook.xlsx')} />}{' '}
            {canWork && (
              <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
                + Operations task
              </button>
            )}
          </>
        }
      />

      {notice && <Alert kind="ok">{notice}</Alert>}
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
                {chart && (
                  <p className="ops-muted" role="status">
                    Showing tasks for {chart.label}.{' '}
                    <button type="button" className="ops-btn small" onClick={() => setChart(null)}>
                      Clear chart filter
                    </button>
                  </p>
                )}
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
                                <span className="ops-muted">{x.dependsOn ? `after ${x.dependsOn.ref} · ` : ''}{x.system ? 'generated' : 'manual'} · {x.ref}{x.commentCount ? ` · ${x.commentCount} comment${x.commentCount === 1 ? '' : 's'}` : ''}</span>
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
                    <Link href="/ops/reconciliation">Open reconciliations</Link> <span className="ops-muted">· {s.recon.open} open ({reconSeverityText(s.recon)}), {s.recon.pendingChecker} awaiting checker</span>
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

            <WorkloadCard onFilter={setChart} />
            <CalendarCard />

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
              { area: str(fd, 'area'), title: str(fd, 'title'), detail: optStr(fd, 'detail') ?? null, dueAt: str(fd, 'dueAt'), link: optStr(fd, 'link') ?? null, ...(fd.get('isControl') ? { isControl: true } : {}) },
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
          <label className="ops-check">
            <input type="checkbox" name="isControl" /> Control task: its creator cannot mark it Done, a colleague must
          </label>
        </FormModal>
      )}

      {open && <TaskModal task={open} canWork={canWork} canComment={canView} onClose={() => setOpen(null)} onChanged={(msg) => { setOpen(null); setNotice(msg ?? null); reload(); }} />}
    </>
  );
}

function handOffText(task: Task, verb: string, handOff: HandOff[] | undefined): string {
  const base = `${task.ref} ${verb}.`;
  if (!handOff?.length) return base;
  return `${base} Handed off: ${handOff.map((h) => `${h.ref} is now ${h.state.toLowerCase()} (${h.notified === 'owner' ? 'owner' : 'operations team'} notified)`).join('; ')}.`;
}

function TaskModal({ task, canWork, canComment, onClose, onChanged }: { task: Task; canWork: boolean; canComment: boolean; onClose: () => void; onChanged: (notice?: string) => void }) {
  const { user } = useSession();
  const [asking, setAsking] = useState<'block' | 'cancel' | 'reopen' | null>(null);
  const doneMsg = useRef<string | null>(null);
  // Every action carries its Idempotency-Key (one per user intent, from ActionButton / FormModal).
  const post = (verb: string, key: string, body: Record<string, unknown> = {}) => api.post<{ handOff?: HandOff[] }>(v1(`/operations/tasks/${task.id}/${verb}`), body, { idempotencyKey: key });
  const live = !['DONE', 'CANCELLED'].includes(task.status);
  // BR-063: the creator of a control task cannot mark it Done (the API enforces it; the button says why).
  const selfControl = !!task.isControl && task.createdById === user.id;
  return (
    <>
      <Modal title={`${task.ref} · ${task.title}`} kicker={areaLabel(task.area)} onClose={onClose}>
        <div className="ops-modal-body">
          <p>{task.detail ?? 'No further detail.'}</p>
          <p className="ops-muted">
            Due {formatDateTime(task.dueAt)} · status {task.status.toLowerCase().replace(/_/g, ' ')} · {task.system ? 'generated by the system' : 'manual'}
            {task.isControl ? ' · control task' : ''}
            {task.dependsOn ? ` · depends on ${task.dependsOn.ref} (${task.dependsOn.status.toLowerCase()})` : ''}
          </p>
          {task.blockedReason && <Alert kind="warn">Blocked: {task.blockedReason}</Alert>}
          {task.completedAt && <p className="ops-muted">Completed {formatDateTime(task.completedAt)} by {task.completedByName ?? 'System'}</p>}
          <TaskComments taskId={task.id} canWork={canComment} />
          {canWork && selfControl && live && <Alert kind="info">You created this control task, so a colleague has to mark it Done.</Alert>}
        </div>
        <footer className="ops-modal-foot">
          <div className="ops-actions">
            {task.link && (
              <Link className="ops-btn" href={task.link}>
                Open workspace
              </Link>
            )}
            {canWork && live && task.status !== 'IN_PROGRESS' && <ActionButton label="Start" onRun={(key) => post('start', key)} onDone={() => onChanged(`${task.ref} started.`)} />}
            {canWork && live && (
              <ActionButton
                label="Complete"
                primary
                disabled={selfControl}
                title={selfControl ? 'You created this control task; a colleague must complete it (BR-063)' : undefined}
                onRun={async (key) => {
                  const r = await post('complete', key);
                  doneMsg.current = handOffText(task, 'completed', r?.handOff);
                }}
                onDone={() => onChanged(doneMsg.current ?? `${task.ref} completed.`)}
              />
            )}
            {canWork && live && task.status !== 'BLOCKED' && (
              <button className="ops-btn" type="button" onClick={() => setAsking('block')}>
                Block
              </button>
            )}
            {canWork && live && (
              <button className="ops-btn danger" type="button" onClick={() => setAsking('cancel')}>
                Cancel task
              </button>
            )}
            {canWork && !live && (
              <button className="ops-btn" type="button" onClick={() => setAsking('reopen')}>
                Reopen
              </button>
            )}
            <button className="ops-btn" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </footer>
      </Modal>
      {asking === 'block' && <ReasonModal title={`Block ${task.ref}`} submitLabel="Block task" hint="Why is it blocked? Recorded in the audit trail" onClose={() => setAsking(null)} onSubmit={(reason, key) => post('block', key, { reason })} onDone={() => onChanged(`${task.ref} blocked.`)} />}
      {asking === 'cancel' && (
        <ReasonModal
          title={`Cancel ${task.ref}`}
          submitLabel="Cancel task"
          danger
          hint="Reason for cancelling. Tasks waiting on it are handed off"
          onClose={() => setAsking(null)}
          onSubmit={async (reason, key) => {
            const r = await post('cancel', key, { reason });
            doneMsg.current = handOffText(task, 'cancelled', r?.handOff);
          }}
          onDone={() => onChanged(doneMsg.current ?? `${task.ref} cancelled.`)}
        />
      )}
      {asking === 'reopen' && <ReasonModal title={`Reopen ${task.ref}`} submitLabel="Reopen task" onClose={() => setAsking(null)} onSubmit={(reason, key) => post('reopen', key, { reason })} onDone={() => onChanged(`${task.ref} reopened.`)} />}
    </>
  );
}

/** "3 critical, 5 high": `recon.high` already folds critical into high, so show the real split when the API sends it. */
function reconSeverityText(recon: { high: number; open: number } & { bySeverity?: Record<string, number> }): string {
  const sev = recon.bySeverity;
  if (!sev) return `${recon.high} critical or high`;
  const parts = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].filter((k) => (sev[k] ?? 0) > 0).map((k) => `${sev[k]} ${k.toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'none high';
}
