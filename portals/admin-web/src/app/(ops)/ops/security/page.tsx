'use client';

import { useState } from 'react';
import { api, apiRequest, describeError, newIdempotencyKey, v1 } from '@/ops/api';
import { useCan } from '@/ops/session';
import { Alert, Card, Empty, Field, FieldGrid, FormModal, Loaded, PageHeader, formatDateTime, optStr, str, useAction, useResource } from '@/ops/ui';

interface PermissionsRes {
  data: string[];
  protected: string[];
  custom: { code: string; label: string; description: string | null }[];
}
interface SodRules {
  data: { id: string; a: string; b: string; why: string }[];
  blocklist: string[];
  privileged: string[];
}
interface PurgeResult {
  dryRun: boolean;
  sessionsDeleted: number;
  passwordResetsDeleted: number;
  invitationsDeleted: number;
  idempotencyKeysDeleted: number;
  outboxEventsDeleted: number;
  notificationsDeleted: number;
  digestLogsDeleted: number;
  auditRetentionYears: number;
  auditFloor: string;
  documentsEligibleForDisposal: number;
}
interface Runs {
  data: { id: string; startedAt: string; finishedAt: string | null; dryRun: boolean; triggeredBy: string | null; result: PurgeResult | null }[];
  lastScheduledRunAt: string | null;
}

/** Security controls: custom permission codes, the SoD catalogue and the retention purge (GAP-011). */
export default function SecurityPage() {
  const canRbac = useCan('admin.rbac');
  const canSettings = useCan('admin.settings');
  return (
    <>
      <PageHeader kicker="Administration" title="Security controls" subtitle="Permission codes, separation-of-duties catalogue and scheduled retention." />
      {canRbac ? <CustomPermissions /> : <Alert kind="info">Custom permission codes need the admin.rbac permission.</Alert>}
      {canRbac && <SodCatalogue />}
      {canSettings ? <Retention /> : <Alert kind="info">The retention job needs the admin.settings permission.</Alert>}
    </>
  );
}

function CustomPermissions() {
  const res = useResource(() => apiRequest<PermissionsRes>('GET', v1('/admin/permissions')), []);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  return (
    <Card
      title="Custom permission codes"
      actions={
        <button className="ops-btn primary small" type="button" onClick={() => setAdding(true)}>
          Define permission
        </button>
      }
    >
      <p className="ops-muted">
        Codes the platform does not ship with. Define one here, attach it to a role under RBAC &amp; Controls, and check it in new modules. Money and approval permissions are reserved.
      </p>
      <Alert>{error}</Alert>
      <Loaded res={res} what="permissions">
        {(p) =>
          p.custom.length === 0 ? (
            <Empty>No custom permission codes yet.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Label</th>
                    <th>Description</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.custom.map((c) => (
                    <tr key={c.code}>
                      <td>
                        <code>{c.code}</code>
                      </td>
                      <td>{c.label}</td>
                      <td className="ops-muted">{c.description ?? '—'}</td>
                      <td className="r">
                        <button
                          className="ops-btn small danger"
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Remove ${c.code}? Roles must no longer carry it.`)) return;
                            try {
                              await apiRequest('DELETE', v1(`/admin/permissions/${encodeURIComponent(c.code)}`));
                              setError('');
                              res.reload();
                            } catch (e) {
                              setError(describeError(e));
                            }
                          }}
                        >
                          Remove
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
      {adding && (
        <FormModal
          title="Define a permission code"
          kicker="Custom permission"
          submitLabel="Define permission"
          onClose={() => setAdding(false)}
          onSubmit={(fd, key) => api.post(v1('/admin/permissions'), { code: str(fd, 'code').toLowerCase(), label: str(fd, 'label'), description: optStr(fd, 'description') }, { idempotencyKey: key })}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Code" hint="Lowercase area.action, for example vendor.review">
              <input className="ops-input" name="code" required pattern="[a-z][a-z_]+(\.[a-z_]+){1,2}" />
            </Field>
            <Field label="Label">
              <input className="ops-input" name="label" required maxLength={120} />
            </Field>
            <Field label="Description" span={2}>
              <input className="ops-input" name="description" maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function SodCatalogue() {
  const res = useResource(() => apiRequest<SodRules>('GET', v1('/admin-core/sod/rules')), []);
  return (
    <Card title="Separation of duties catalogue">
      <Loaded res={res} what="the SoD rules">
        {(s) => (
          <>
            <p className="ops-muted">
              Platform administrators may never hold these {s.blocklist.length} money and approval permissions; granting any of them needs an independent checker. {s.data.length} permission pairs must not meet in one person or one role.
            </p>
            <details>
              <summary>Blocklist ({s.blocklist.length})</summary>
              <p>
                {s.blocklist.map((p) => (
                  <code key={p} style={{ marginRight: 8, display: 'inline-block' }}>
                    {p}
                  </code>
                ))}
              </p>
            </details>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Permission A</th>
                    <th>Permission B</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {s.data.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>
                        <code>{r.a}</code>
                      </td>
                      <td>
                        <code>{r.b}</code>
                      </td>
                      <td>{r.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loaded>
    </Card>
  );
}

function Retention() {
  const res = useResource(() => apiRequest<Runs>('GET', v1('/admin-core/retention/runs')), []);
  const action = useAction();
  const [last, setLast] = useState<PurgeResult | null>(null);
  const run = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm('Delete expired sessions, tokens, idempotency keys, delivered outbox events and old read notifications now?')) return;
    const r = await action.run(() => apiRequest<{ data: PurgeResult }>('POST', v1('/admin-core/retention/run'), { dryRun }, { idempotencyKey: newIdempotencyKey() }));
    if (r) {
      setLast(r.data);
      res.reload();
    }
  };
  return (
    <Card
      title="Retention purge"
      actions={
        <>
          <button className="ops-btn small" type="button" disabled={action.busy} onClick={() => void run(true)}>
            Dry run
          </button>{' '}
          <button className="ops-btn small danger" type="button" disabled={action.busy} onClick={() => void run(false)}>
            Run now
          </button>
        </>
      }
    >
      <p className="ops-muted">
        The worker runs this once a day using the retention values in Settings. Audit events are never deleted (the audit retention value is reported as a floor) and client documents past retention are only listed for approved disposal.
      </p>
      <Alert>{action.error}</Alert>
      {last && (
        <Alert kind="ok">
          {last.dryRun ? 'Dry run' : 'Purged'}: {last.sessionsDeleted} sessions, {last.passwordResetsDeleted} reset tokens, {last.invitationsDeleted} invitations, {last.idempotencyKeysDeleted} idempotency keys, {last.outboxEventsDeleted} outbox events, {last.notificationsDeleted} notifications. Audit floor {last.auditFloor}; {last.documentsEligibleForDisposal} documents eligible for disposal.
        </Alert>
      )}
      <Loaded res={res} what="retention history">
        {(r) => (
          <>
            <p className="ops-muted">Last scheduled run: {formatDateTime(r.lastScheduledRunAt)}</p>
            {r.data.length === 0 ? (
              <Empty>No runs recorded yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Mode</th>
                      <th>By</th>
                      <th className="r">Sessions</th>
                      <th className="r">Outbox</th>
                      <th className="r">Idempotency keys</th>
                      <th className="r">Notifications</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((x) => (
                      <tr key={x.id}>
                        <td>{formatDateTime(x.startedAt)}</td>
                        <td>{x.dryRun ? 'Dry run' : 'Live'}</td>
                        <td>{x.triggeredBy === 'worker' ? 'Scheduler' : x.triggeredBy ? 'Administrator' : '—'}</td>
                        <td className="r">{x.result?.sessionsDeleted ?? '—'}</td>
                        <td className="r">{x.result?.outboxEventsDeleted ?? '—'}</td>
                        <td className="r">{x.result?.idempotencyKeysDeleted ?? '—'}</td>
                        <td className="r">{x.result?.notificationsDeleted ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}
