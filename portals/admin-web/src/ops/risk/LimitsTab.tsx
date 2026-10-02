'use client';

import { useState } from 'react';
import { api, apiRequest } from '../api';
import { formatDecimal } from '../money';
import { useSession } from '../session';
import { ActionButton, Card, DateText, Empty, Field, FieldGrid, FormModal, Loaded, optStr, str, useResource } from '../ui';
import { risk, Tone, usePortfolioOptions, UserSelect, useStaffUsers } from './common';
import { isFloor, METRICS, metricShort, type RiskLimit } from './types';

export function LimitsTab({ canManage }: { canManage: boolean }) {
  const { user } = useSession();
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RiskLimit | null>(null);
  const [retiring, setRetiring] = useState<RiskLimit | null>(null);
  const [returning, setReturning] = useState<RiskLimit | null>(null);
  const res = useResource<RiskLimit[]>(() => api.get<RiskLimit[]>(risk(`/limits${status ? `?status=${status}` : ''}`)), [status]);
  const users = useStaffUsers();
  const portfolios = usePortfolioOptions();

  return (
    <>
      <Card
        title="Risk limits"
        actions={
          <>
            <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" style={{ maxWidth: 190 }}>
              <option value="">All statuses</option>
              {['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED'].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </select>
            {canManage && (
              <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>
                Add limit
              </button>
            )}
          </>
        }
      >
        <p className="ops-muted" style={{ marginTop: 0 }}>
          A new limit starts as a draft. Once submitted, a different person with risk management rights must approve it with two-factor confirmation.
          Only draft limits can be edited; to change an active limit, retire it and create a new one.
        </p>
        <Loaded res={res} what="limits">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No limits yet.{canManage ? ' Use Add limit to create the first one.' : ''}</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Limit</th>
                      <th>Scope</th>
                      <th className="r">Threshold</th>
                      <th>On breach</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Maker / checker</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => {
                      const isMaker = l.makerId === user.id;
                      return (
                        <tr key={l.id}>
                          <td>
                            <strong>{l.ref}</strong> {metricShort(l.metric)}
                            {l.description && <span className="ops-sub">{l.description}</span>}
                          </td>
                          <td>{l.scopeName ?? '—'}</td>
                          <td className="r">
                            {isFloor(l.metric) ? 'min ' : 'max '}
                            {formatDecimal(l.threshold, 2)}%
                          </td>
                          <td>{l.breachAction.toLowerCase()}</td>
                          <td>{l.ownerName ?? '—'}</td>
                          <td>
                            <Tone value={l.status} />
                            {l.approvedAt && (
                              <span className="ops-sub">
                                approved <DateText value={l.approvedAt} />
                              </span>
                            )}
                          </td>
                          <td>
                            {l.makerName ?? '—'}
                            <span className="ops-sub">{l.checkerName ? `checked by ${l.checkerName}` : 'not yet approved'}</span>
                          </td>
                          <td>
                            {canManage && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {l.status === 'DRAFT' && (
                                  <>
                                    <button className="ops-btn small" type="button" onClick={() => setEditing(l)}>
                                      Edit
                                    </button>
                                    <ActionButton label="Submit" primary onRun={() => api.post(risk(`/limits/${l.id}/submit`))} onDone={res.reload} />
                                    <ActionButton
                                      label="Delete"
                                      danger
                                      confirm={`Delete draft limit ${l.ref}?`}
                                      onRun={() => apiRequest('DELETE', `/api/v1/risk/limits/${l.id}`)}
                                      onDone={res.reload}
                                    />
                                  </>
                                )}
                                {l.status === 'PENDING_APPROVAL' && (
                                  <>
                                    <ActionButton
                                      label="Approve"
                                      primary
                                      disabled={isMaker}
                                      title={isMaker ? 'You created this limit; a different person must approve it' : 'Approve with two-factor confirmation'}
                                      onRun={() => api.post(risk(`/limits/${l.id}/approve`))}
                                      onDone={res.reload}
                                    />
                                    <button className="ops-btn small" type="button" onClick={() => setReturning(l)}>
                                      Return to draft
                                    </button>
                                  </>
                                )}
                                {l.status === 'ACTIVE' && (
                                  <button className="ops-btn small" type="button" onClick={() => setRetiring(l)}>
                                    Retire
                                  </button>
                                )}
                              </div>
                            )}
                            {canManage && l.status === 'PENDING_APPROVAL' && isMaker && <span className="ops-sub">Awaiting another approver</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>

      {(adding || editing) && (
        <FormModal
          kicker="Risk limit"
          title={editing ? `Edit ${editing.ref}` : 'Add limit'}
          subtitle="Saved as a draft. Submit it for approval when it is ready."
          submitLabel={editing ? 'Save changes' : 'Create draft'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSubmit={(fd, key) => {
            const scope = str(fd, 'scope');
            const body = {
              metric: str(fd, 'metric'),
              scopeType: scope === 'FIRM' ? 'FIRM' : 'PORTFOLIO',
              scopeId: scope === 'FIRM' ? null : scope,
              threshold: Number(str(fd, 'threshold')),
              breachAction: str(fd, 'breachAction'),
              ownerUserId: optStr(fd, 'ownerUserId'),
              description: optStr(fd, 'description') ?? null,
            };
            if (editing) return api.patch(risk(`/limits/${editing.id}`), { ...body, ownerUserId: body.ownerUserId ?? editing.ownerUserId, version: editing.version });
            return api.post(risk('/limits'), { ...body, scopeId: body.scopeId ?? undefined, description: body.description ?? undefined }, { idempotencyKey: key });
          }}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Metric" span={2} hint="Cash floor is a minimum; every other metric is a maximum.">
              <select className="ops-input" name="metric" required defaultValue={editing?.metric ?? 'SINGLE_NAME_PCT'}>
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Applies to">
              <select className="ops-input" name="scope" required defaultValue={editing ? (editing.scopeType === 'FIRM' ? 'FIRM' : editing.scopeId ?? '') : ''}>
                <option value="" disabled>
                  Choose…
                </option>
                <option value="FIRM">All portfolios (firm-wide)</option>
                {portfolios.state === 'ok' &&
                  portfolios.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Threshold (%)">
              <input className="ops-input" name="threshold" type="number" step="0.01" min={0.01} max={100} required defaultValue={editing ? Number(editing.threshold) : undefined} />
            </Field>
            <Field label="On breach">
              <select className="ops-input" name="breachAction" defaultValue={editing?.breachAction ?? 'ALERT'}>
                <option value="ALERT">Alert the owner</option>
                <option value="ESCALATE">Escalate</option>
                <option value="BLOCK">Block orders that worsen it</option>
              </select>
            </Field>
            <Field label="Owner" hint="Notified on breach. Defaults to you.">
              {users.state === 'ok' ? <UserSelect name="ownerUserId" users={users.data} defaultValue={editing?.ownerUserId ?? user.id} /> : <input className="ops-input" disabled placeholder="Loading…" />}
            </Field>
            <Field label="Description" span={2}>
              <input className="ops-input" name="description" maxLength={500} defaultValue={editing?.description ?? ''} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}

      {retiring && (
        <FormModal
          kicker="Risk limit"
          title={`Retire ${retiring.ref}`}
          subtitle="A retired limit stops being monitored. This cannot be undone; create a new limit to bring it back."
          submitLabel="Retire limit"
          danger
          onClose={() => setRetiring(null)}
          onSubmit={(fd) => api.post(risk(`/limits/${retiring.id}/retire`), { reason: str(fd, 'reason') })}
          onDone={res.reload}
        >
          <Field label="Reason">
            <input className="ops-input" name="reason" required minLength={3} maxLength={500} />
          </Field>
        </FormModal>
      )}

      {returning && (
        <FormModal
          kicker="Risk limit"
          title={`Return ${returning.ref} to draft`}
          submitLabel="Return to draft"
          onClose={() => setReturning(null)}
          onSubmit={(fd) => api.post(risk(`/limits/${returning.id}/reject`), { reason: str(fd, 'reason') })}
          onDone={res.reload}
        >
          <Field label="Reason">
            <input className="ops-input" name="reason" required minLength={3} maxLength={500} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
