'use client';

import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useSession } from '../session';
import { ActionButton, Card, DateText, Empty, Field, FieldGrid, FormModal, Loaded, optStr, str, useResource } from '../ui';
import { risk, Tone, usePortfolioOptions, UserSelect, useStaffUsers } from './common';
import type { RiskCase } from './types';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
type Closing = { c: RiskCase; to: 'RESOLVED' | 'CLOSED' };

export function CasesTab({ canManage, initialQuery }: { canManage: boolean; initialQuery?: string }) {
  const { user } = useSession();
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState(initialQuery ?? '');
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<RiskCase | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  useEffect(() => {
    if (initialQuery) setQ(initialQuery);
  }, [initialQuery]);
  const res = useResource<RiskCase[]>(() => api.get<RiskCase[]>(risk(`/cases${qs({ status, severity, mine: mine ? '1' : '', q })}`)), [status, severity, mine, q]);
  const users = useStaffUsers();
  const portfolios = usePortfolioOptions();

  return (
    <>
      <Card
        title="Cases"
        actions={
          canManage && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New case
            </button>
          )
        }
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="ops-input" placeholder="Search ref or description" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 170 }} aria-label="Status">
            <option value="">All statuses</option>
            {['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
          <select className="ops-input" value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ maxWidth: 160 }} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me
          </label>
        </div>
        <Loaded res={res} what="cases">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No cases match.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Description</th>
                      <th>Severity</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.ref}</strong>
                          <span className="ops-sub">{c.type.replace(/_/g, ' ').toLowerCase()}</span>
                          <span className="ops-sub">
                            <DateText value={c.createdAt} />
                          </span>
                        </td>
                        <td style={{ maxWidth: 420 }}>
                          {c.description}
                          {c.portfolioName && <span className="ops-sub">{c.portfolioName}</span>}
                          {c.resolutionNote && <span className="ops-sub">Resolution: {c.resolutionNote}</span>}
                        </td>
                        <td>
                          <Tone value={c.severity} />
                        </td>
                        <td>
                          {c.ownerName ?? 'Unassigned'}
                          {c.ownerUserId === user.id && <span className="ops-sub">you</span>}
                        </td>
                        <td>
                          <Tone value={c.status} />
                        </td>
                        <td>
                          {canManage && c.status !== 'CLOSED' && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="ops-btn small" type="button" onClick={() => setAssigning(c)}>
                                Assign
                              </button>
                              {c.status === 'OPEN' && (
                                <ActionButton label="Start investigation" primary onRun={() => api.post(risk(`/cases/${c.id}/transition`), { status: 'INVESTIGATING' })} onDone={res.reload} />
                              )}
                              {c.status === 'INVESTIGATING' && (
                                <button className="ops-btn small primary" type="button" onClick={() => setClosing({ c, to: 'RESOLVED' })}>
                                  Resolve
                                </button>
                              )}
                              {(c.status === 'INVESTIGATING' || c.status === 'RESOLVED') && (
                                <button className="ops-btn small" type="button" onClick={() => setClosing({ c, to: 'CLOSED' })}>
                                  Close
                                </button>
                              )}
                            </div>
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
      </Card>

      {creating && (
        <FormModal
          kicker="Risk case"
          title="New case"
          submitLabel="Create case"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) =>
            api.post(
              risk('/cases'),
              {
                type: str(fd, 'type') || 'MANUAL',
                severity: str(fd, 'severity'),
                description: str(fd, 'description'),
                portfolioId: optStr(fd, 'portfolioId'),
                ownerUserId: optStr(fd, 'ownerUserId'),
              },
              { idempotencyKey: key },
            )
          }
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Type">
              <select className="ops-input" name="type" defaultValue="MANUAL">
                {['MANUAL', 'RESTRICTED_LIST', 'MANDATE_BREACH', 'BEST_EXECUTION', 'CONFLICT_OF_INTEREST', 'OTHER'].map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity">
              <select className="ops-input" name="severity" defaultValue="MEDIUM">
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Portfolio (optional)">
              <select className="ops-input" name="portfolioId" defaultValue="">
                <option value="">None</option>
                {portfolios.state === 'ok' &&
                  portfolios.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Owner" hint="Defaults to you">
              {users.state === 'ok' ? <UserSelect name="ownerUserId" users={users.data} defaultValue={user.id} /> : <input className="ops-input" disabled placeholder="Loading…" />}
            </Field>
            <Field label="Description" span={2}>
              <textarea className="ops-input" name="description" required minLength={3} maxLength={2000} rows={4} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}

      {assigning && (
        <FormModal
          kicker="Risk case"
          title={`Assign ${assigning.ref}`}
          submitLabel="Assign"
          onClose={() => setAssigning(null)}
          onSubmit={(fd) => api.post(risk(`/cases/${assigning.id}/assign`), { ownerUserId: str(fd, 'ownerUserId') })}
          onDone={res.reload}
        >
          <Field label="Owner">{users.state === 'ok' ? <UserSelect name="ownerUserId" users={users.data} defaultValue={assigning.ownerUserId} required /> : <input className="ops-input" disabled placeholder="Loading…" />}</Field>
        </FormModal>
      )}

      {closing && (
        <FormModal
          kicker="Risk case"
          title={`${closing.to === 'RESOLVED' ? 'Resolve' : 'Close'} ${closing.c.ref}`}
          subtitle={closing.to === 'RESOLVED' ? 'A resolution note is required. The linked breach is marked resolved.' : 'Closed cases are final and cannot be edited.'}
          submitLabel={closing.to === 'RESOLVED' ? 'Resolve case' : 'Close case'}
          onClose={() => setClosing(null)}
          onSubmit={(fd) => api.post(risk(`/cases/${closing.c.id}/transition`), { status: closing.to, note: optStr(fd, 'note') })}
          onDone={res.reload}
        >
          <Field label={closing.c.resolutionNote ? 'Note (optional)' : 'Resolution note'}>
            <textarea className="ops-input" name="note" rows={3} maxLength={2000} required={!closing.c.resolutionNote} minLength={closing.c.resolutionNote ? undefined : 3} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
