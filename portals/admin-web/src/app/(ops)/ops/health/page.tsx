'use client';

import { useState } from 'react';
import { api, apiRequest, v1 } from '@/ops/api';
import { Badge } from '@/ops/admin-core';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FormModal, formatDateTime, Loaded, PageHeader, str, useResource } from '@/ops/ui';

/**
 * Platform health (R4-1, GAP-023): worker heartbeats, outbox backlog and dead letters, scheduled-job lateness, and the
 * alerts raised from them. Permission admin.settings. Alerts are also pushed to holders of that permission as
 * notifications (critical ones by email).
 */

interface Alert_ {
  id: string;
  key: string;
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  detail: string | null;
  status: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  version: number;
}
interface Health {
  status: 'OK' | 'WARNING' | 'CRITICAL';
  checkedAt: string;
  heartbeatStaleSeconds: number;
  liveWorkers: number;
  workers: { instanceId: string; host: string | null; live: boolean; startedAt: string; lastBeatAt: string; lastTickMs: number; ticks: number; lastHandled: number; lastError: string | null }[];
  outbox: { pending: number; oldestPendingSeconds: number; dead: number; maxAttempts: number; byType: { type: string; count: number }[] };
  jobs: { name: string; lastRunAt: string | null; nextRunAt: string }[];
  alerts: Alert_[];
}
interface DeadRow {
  id: string;
  type: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
interface DeadPage {
  data: DeadRow[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE = 20;
const tone = (s: string) => (s === 'CRITICAL' || s === 'red' ? 'red' : s === 'WARNING' ? 'amber' : 'green');

export default function HealthPage() {
  const can = useCan('admin.settings');
  const res = useResource<Health>(() => api.get<Health>(v1('/admin-core/ops-health')), []);
  const [note, setNote] = useState('');
  const [ack, setAck] = useState<Alert_ | null>(null);
  if (!can) {
    return (
      <>
        <PageHeader kicker="Administration" title="Platform health" />
        <Alert>Your role does not include platform settings. Ask a System Administrator for the admin.settings permission.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader kicker="Administration" title="Platform health" subtitle="Is the worker alive, is the outbox draining, are scheduled jobs on time. Alerts reach administrators as notifications." />
      <Alert kind="ok">{note}</Alert>
      <Loaded res={res} what="platform health">
        {(h) => (
          <>
            <Card
              title={
                <>
                  Overall <Badge tone={tone(h.status)}>{h.status.toLowerCase()}</Badge>
                </>
              }
              actions={<ActionButton label="Check now" onRun={(k) => api.post(v1('/admin-core/ops-health/evaluate'), {}, { idempotencyKey: k })} onDone={res.reload} />}
            >
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div className="ops-muted">Live workers</div>
                  <strong>{h.liveWorkers}</strong>
                </div>
                <div>
                  <div className="ops-muted">Outbox waiting</div>
                  <strong>{h.outbox.pending}</strong>
                  {h.outbox.pending > 0 && <span className="ops-muted"> oldest {Math.round(h.outbox.oldestPendingSeconds / 60)} min</span>}
                </div>
                <div>
                  <div className="ops-muted">Dead letters</div>
                  <strong>{h.outbox.dead}</strong>
                </div>
                <div>
                  <div className="ops-muted">Checked</div>
                  <strong>{formatDateTime(h.checkedAt)}</strong>
                </div>
              </div>
            </Card>

            <Card title={`Open alerts (${h.alerts.length})`}>
              {h.alerts.length === 0 ? (
                <Empty>No open alerts.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Alert</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Since</th>
                        <th className="r">Seen</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {h.alerts.map((a) => (
                        <tr key={a.id}>
                          <td>
                            {a.title}
                            <div className="ops-muted">{a.detail}</div>
                          </td>
                          <td>
                            <Badge tone={tone(a.severity)}>{a.severity.toLowerCase()}</Badge>
                          </td>
                          <td>{a.status.toLowerCase()}</td>
                          <td>{formatDateTime(a.firstSeenAt)}</td>
                          <td className="r">{a.occurrences}</td>
                          <td className="r">
                            {a.status === 'OPEN' && (
                              <button className="ops-btn" type="button" onClick={() => setAck(a)}>
                                Acknowledge
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Workers">
              {h.workers.length === 0 ? (
                <Empty>No worker has reported in yet.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Instance</th>
                        <th>State</th>
                        <th>Last heartbeat</th>
                        <th className="r">Last tick (ms)</th>
                        <th className="r">Ticks</th>
                        <th className="r">Last handled</th>
                        <th>Last error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.workers.map((w) => (
                        <tr key={w.instanceId}>
                          <td>
                            {w.instanceId}
                            <div className="ops-muted">{w.host}</div>
                          </td>
                          <td>{w.live ? <Badge tone="green">live</Badge> : <Badge tone="red">stopped</Badge>}</td>
                          <td>{formatDateTime(w.lastBeatAt)}</td>
                          <td className="r">{w.lastTickMs}</td>
                          <td className="r">{w.ticks}</td>
                          <td className="r">{w.lastHandled}</td>
                          <td>{w.lastError ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Outbox by event type (waiting)">
              {h.outbox.byType.length === 0 ? (
                <Empty>The outbox is empty.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th className="r">Waiting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.outbox.byType.map((b) => (
                        <tr key={b.type}>
                          <td>{b.type}</td>
                          <td className="r">{b.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <DeadLetters maxAttempts={h.outbox.maxAttempts} onChanged={() => res.reload()} setNote={setNote} />

            <Card title="Scheduled jobs">
              {h.jobs.length === 0 ? (
                <Empty>No scheduled job has run yet.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Last run</th>
                        <th>Next run</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.jobs.map((j) => (
                        <tr key={j.name}>
                          <td>{j.name}</td>
                          <td>{j.lastRunAt ? formatDateTime(j.lastRunAt) : '—'}</td>
                          <td>{formatDateTime(j.nextRunAt)}</td>
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
      {ack && (
        <FormModal
          title={`Acknowledge: ${ack.title}`}
          submitLabel="Acknowledge"
          onClose={() => setAck(null)}
          onDone={() => {
            setNote('Alert acknowledged.');
            res.reload();
          }}
          onSubmit={(fd, key) => api.post(v1(`/admin-core/ops-health/alerts/${ack.id}/ack`), { note: str(fd, 'note'), version: ack.version }, { idempotencyKey: key })}
        >
          <Field label="Note">
            <textarea className="ops-input" name="note" required minLength={3} maxLength={500} />
          </Field>
        </FormModal>
      )}
    </>
  );
}

/** Dead-lettered outbox events, paged in SQL (`?page=&pageSize=`). */
function DeadLetters({ maxAttempts, onChanged, setNote }: { maxAttempts: number; onChanged: () => void; setNote: (s: string) => void }) {
  const [page, setPage] = useState(1);
  const [discard, setDiscard] = useState<DeadRow | null>(null);
  const res = useResource<DeadPage>(() => apiRequest<DeadPage>('GET', v1(`/admin-core/ops-health/outbox/dead?page=${page}&pageSize=${PAGE}`)), [page]);
  const done = (msg: string) => {
    setNote(msg);
    res.reload();
    onChanged();
  };
  return (
    <Card title="Dead letters">
      <Loaded res={res} what="dead letters">
        {(d) =>
          d.total === 0 ? (
            <Empty>No event has exhausted its {maxAttempts} attempts.</Empty>
          ) : (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Type</th>
                      <th className="r">Attempts</th>
                      <th>Last error</th>
                      <th>Queued</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((e) => (
                      <tr key={e.id}>
                        <td>{e.id}</td>
                        <td>{e.type}</td>
                        <td className="r">{e.attempts}</td>
                        <td style={{ maxWidth: 360 }}>{e.lastError ?? '—'}</td>
                        <td>{formatDateTime(e.createdAt)}</td>
                        <td className="r">
                          <ActionButton label="Retry" onRun={(k) => api.post(v1(`/admin-core/ops-health/outbox/${e.id}/retry`), {}, { idempotencyKey: k })} onDone={() => done(`Event ${e.id} queued for retry.`)} />{' '}
                          <button className="ops-btn danger" type="button" onClick={() => setDiscard(e)}>
                            Discard
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="ops-btn" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <span className="ops-muted">
                  Page {d.page} of {Math.max(1, Math.ceil(d.total / d.pageSize))} ({d.total} events)
                </span>
                <button className="ops-btn" type="button" disabled={page * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>
                  Next
                </button>
              </div>
            </>
          )
        }
      </Loaded>
      {discard && (
        <FormModal
          danger
          title={`Discard event ${discard.id}`}
          subtitle="The event is retired without running. The record is kept and the action is audited."
          submitLabel="Discard"
          onClose={() => setDiscard(null)}
          onDone={() => done(`Event ${discard.id} discarded.`)}
          onSubmit={(fd, key) => api.post(v1(`/admin-core/ops-health/outbox/${discard.id}/discard`), { note: str(fd, 'note') }, { idempotencyKey: key })}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="note" required minLength={3} maxLength={300} />
          </Field>
        </FormModal>
      )}
    </Card>
  );
}
