'use client';

import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import {
  Badge,
  downloadCsv,
  StatusPill,
  type ChangeRequest,
  type Matrix,
  type ReviewDetail,
  type ReviewRow,
  type RoleRow,
  type SodReport,
  type SodScan,
  type StaffUser,
  type StepUpPolicy,
} from '@/ops/admin-core';
import { TabBar } from '@/ops/recon/common';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

type Tab = 'matrix' | 'staff' | 'requests' | 'reviews' | 'sod' | 'stepup';
const AC = (p: string) => v1(`/admin-core${p}`);

export default function RbacPage() {
  const can = useCan('admin.rbac');
  const [tab, setTab] = useState<Tab>('matrix');
  if (!can) {
    return (
      <>
        <PageHeader kicker="Administration" title="RBAC & Controls" />
        <Alert>Your role does not include access administration. Ask a System Administrator for the admin.rbac permission.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        kicker="Administration"
        title="RBAC & Controls"
        subtitle="Who can do what. Granting a privileged permission, or the System Administrator role, needs an independent checker; every change is audited."
      />
      <TabBar
        tabs={[
          { key: 'matrix', label: 'Role matrix' },
          { key: 'staff', label: 'Staff access' },
          { key: 'requests', label: 'Change requests' },
          { key: 'reviews', label: 'Access reviews' },
          { key: 'sod', label: 'Segregation of duties' },
          { key: 'stepup', label: 'Step-up policy' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'matrix' && <MatrixTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'reviews' && <ReviewsTab />}
      {tab === 'sod' && <SodTab />}
      {tab === 'stepup' && <StepUpTab />}
    </>
  );
}

const postRequest = (body: Record<string, unknown>, key: string) => api.post<ChangeRequest>(AC('/rbac/requests'), body, { idempotencyKey: key });

function outcome(r: unknown): string {
  const x = r as ChangeRequest | undefined;
  if (!x) return '';
  return x.status === 'APPLIED' ? `${x.ref} applied.` : `${x.ref} is waiting for an independent approver.`;
}

// ================================================================ matrix

function MatrixTab() {
  const res = useResource<Matrix>(() => api.get<Matrix>(AC('/rbac/matrix')), []);
  const roles = useResource<{ data: RoleRow[] } | RoleRow[]>(() => api.get<RoleRow[]>(v1('/admin/roles')), []);
  const [edit, setEdit] = useState<RoleRow | null>(null);
  const [note, setNote] = useState('');
  const roleRows = roles.state === 'ok' ? ((Array.isArray(roles.data) ? roles.data : roles.data.data) ?? []) : [];
  return (
    <Loaded res={res} what="the role matrix">
      {(m) => (
        <>
          <Alert kind="info">{m.privilegedRule} Privileged permissions are marked with a dot.</Alert>
          <Alert kind="ok">{note}</Alert>
          <Card title={`Roles (${m.roles.length})`}>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th className="r">Users</th>
                    <th className="r">Permissions</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {m.roles.map((r) => (
                    <tr key={r.key}>
                      <td>
                        {r.label} <span className="ops-muted">{r.key}</span> {r.locked && <Badge tone="grey">locked</Badge>} {r.custom && <Badge tone="blue">custom</Badge>}
                      </td>
                      <td className="r">{r.users}</td>
                      <td className="r">{r.permissionCount}</td>
                      <td className="r">
                        <button className="ops-btn" type="button" disabled={r.locked || r.key === 'system_admin'} onClick={() => setEdit(roleRows.find((x) => x.key === r.key) ?? null)}>
                          Propose change
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Permission matrix">
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {m.roles.map((r) => (
                      <th key={r.key} title={r.label} style={{ fontSize: 10 }}>
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.areas.map((a) => (
                    <FragmentArea key={a.area} area={a} roles={m.roles} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {edit && (
            <RolePermissionsModal
              role={edit}
              areas={m.areas}
              onClose={() => setEdit(null)}
              onDone={(r) => {
                setNote(outcome(r));
                res.reload();
                roles.reload();
              }}
            />
          )}
        </>
      )}
    </Loaded>
  );
}

function FragmentArea({ area, roles }: { area: Matrix['areas'][number]; roles: Matrix['roles'] }) {
  return (
    <>
      <tr>
        <td colSpan={roles.length + 1} style={{ background: '#f4f6f9', fontWeight: 800, textTransform: 'uppercase', fontSize: 11 }}>
          {area.area}
        </td>
      </tr>
      {area.permissions.map((p) => (
        <tr key={p.code}>
          <td>
            {p.code} {p.privileged && <span title="Privileged: needs an independent checker" style={{ color: '#b42318' }}>●</span>}
          </td>
          {roles.map((r) => (
            <td key={r.key} style={{ textAlign: 'center' }}>
              {p.roles.includes(r.key) ? '✓' : ''}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function RolePermissionsModal({ role, areas, onClose, onDone }: { role: RoleRow; areas: Matrix['areas']; onClose: () => void; onDone: (r: unknown) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(role.permissions));
  const toggle = (code: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const added = [...sel].filter((p) => !role.permissions.includes(p));
  const removed = role.permissions.filter((p) => !sel.has(p));
  return (
    <FormModal
      wide
      title={`Propose change: ${role.label}`}
      kicker="Access change request"
      subtitle="Adding a privileged permission waits for an independent approver. Other changes apply at once."
      submitLabel="Submit change"
      disabled={!added.length && !removed.length}
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd, key) => postRequest({ kind: 'ROLE_PERMISSIONS', roleKey: role.key, permissions: [...sel], reason: str(fd, 'reason') }, key)}
    >
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #e3e8ef', padding: 10, marginBottom: 10 }}>
        {areas.map((a) => (
          <div key={a.area} style={{ marginBottom: 8 }}>
            <strong style={{ textTransform: 'uppercase', fontSize: 11 }}>{a.area}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {a.permissions.map((p) => (
                <label key={p.code} style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={sel.has(p.code)} onChange={() => toggle(p.code)} /> {p.code}
                  {p.privileged && <span style={{ color: '#b42318' }}> ●</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="ops-muted">
        Adding {added.length}: {added.join(', ') || 'none'}. Removing {removed.length}: {removed.join(', ') || 'none'}.
      </p>
      <Field label="Reason (recorded in the audit trail)">
        <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} />
      </Field>
    </FormModal>
  );
}

// ================================================================ staff

function StaffTab() {
  const users = useResource<StaffUser[]>(() => api.get<StaffUser[]>(v1('/admin/users')), []);
  const roles = useResource<RoleRow[]>(() => api.get<RoleRow[]>(v1('/admin/roles')), []);
  const { user: me } = useSession();
  const [target, setTarget] = useState<StaffUser | null>(null);
  const [disable, setDisable] = useState<StaffUser | null>(null);
  const [note, setNote] = useState('');
  const roleList = roles.state === 'ok' ? roles.data : [];
  const label = (k: string) => roleList.find((r) => r.key === k)?.label ?? k;
  return (
    <>
      <Alert kind="ok">{note}</Alert>
      <Card title="Staff and role assignments">
        <Loaded res={users} what="staff">
          {(list) =>
            list.length === 0 ? (
              <Empty>No staff accounts.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Roles</th>
                      <th>Access</th>
                      <th>MFA</th>
                      <th>Last sign-in</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.name}
                          <div className="ops-muted">{u.email}</div>
                        </td>
                        <td>{u.roles.map(label).join(', ') || '—'}</td>
                        <td>
                          <Badge tone={u.access === 'Disabled' ? 'red' : u.access === 'Privileged' ? 'amber' : u.access === 'Invited' ? 'blue' : 'green'}>{u.access.toLowerCase()}</Badge>
                        </td>
                        <td>{u.mfa ? <Badge tone="green">enrolled</Badge> : <Badge tone="amber">none</Badge>}</td>
                        <td>{u.last}</td>
                        <td className="r">
                          {!u.id.startsWith('invite:') && (
                            <>
                              <button className="ops-btn" type="button" onClick={() => setTarget(u)}>
                                Change roles
                              </button>{' '}
                              <button className="ops-btn danger" type="button" disabled={u.id === me.id || u.access === 'Disabled'} onClick={() => setDisable(u)}>
                                Disable
                              </button>
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
        <div style={{ marginTop: 12 }}>
          <button
            className="ops-btn"
            type="button"
            onClick={() => downloadCsv('/api/v1/admin/access-review.csv', 'access-review.csv').catch((e: Error) => setNote(e.message))}
          >
            Export access listing (CSV)
          </button>
        </div>
      </Card>
      {target && (
        <FormModal
          title={`Change roles: ${target.name}`}
          kicker="Access change request"
          subtitle="Gaining System Administrator or a role with privileged permissions waits for an independent approver."
          submitLabel="Submit change"
          onClose={() => setTarget(null)}
          onDone={(r) => {
            setNote(outcome(r));
            users.reload();
          }}
          onSubmit={(fd, key) => {
            const picked = roleList.filter((r) => fd.get(`role:${r.key}`)).map((r) => r.key);
            return postRequest({ kind: 'USER_ROLES', userId: target.id, roles: picked, reason: str(fd, 'reason') }, key);
          }}
        >
          <FieldGrid>
            {roleList.map((r) => (
              <label key={r.key} style={{ fontSize: 13 }}>
                <input type="checkbox" name={`role:${r.key}`} defaultChecked={target.roles.includes(r.key)} /> {r.label}
              </label>
            ))}
          </FieldGrid>
          <Field label="Reason">
            <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} />
          </Field>
        </FormModal>
      )}
      {disable && (
        <FormModal
          danger
          title={`Disable ${disable.name}`}
          kicker="Access change request"
          subtitle="Ends their sessions immediately once applied."
          submitLabel="Disable account"
          onClose={() => setDisable(null)}
          onDone={(r) => {
            setNote(outcome(r));
            users.reload();
          }}
          onSubmit={(fd, key) => postRequest({ kind: 'USER_DISABLE', userId: disable.id, reason: str(fd, 'reason') }, key)}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} />
          </Field>
        </FormModal>
      )}
    </>
  );
}

// ================================================================ requests

function describe(r: ChangeRequest): string {
  if (r.kind === 'USER_ROLES') return `Roles: ${((r.before?.roles as string[]) ?? []).join(', ') || 'none'} → ${((r.proposal.roles as string[]) ?? []).join(', ')}`;
  if (r.kind === 'USER_DISABLE') return 'Disable account';
  const before = (r.before?.permissions as string[]) ?? [];
  const next = (r.proposal.permissions as string[]) ?? [];
  const add = next.filter((p) => !before.includes(p));
  const rem = before.filter((p) => !next.includes(p));
  return `Permissions +${add.length}${add.length ? ` (${add.join(', ')})` : ''}, −${rem.length}${rem.length ? ` (${rem.join(', ')})` : ''}`;
}

function RequestsTab() {
  const [status, setStatus] = useState('');
  const res = useResource<ChangeRequest[]>(() => api.get<ChangeRequest[]>(AC(`/rbac/requests${status ? `?status=${status}` : ''}`)), [status]);
  const { user: me } = useSession();
  const [reject, setReject] = useState<ChangeRequest | null>(null);
  const [open, setOpen] = useState<ChangeRequest | null>(null);
  return (
    <Card title="Access change requests">
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPLIED">Applied</option>
            <option value="REJECTED">Rejected</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </Field>
      </div>
      <Loaded res={res} what="requests">
        {(list) =>
          list.length === 0 ? (
            <Empty>No requests.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Target</th>
                    <th>Change</th>
                    <th>Requested by</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const mine = r.requestedBy === me.id;
                    return (
                      <tr key={r.id}>
                        <td>
                          <button className="ops-btn small" type="button" onClick={() => setOpen(r)}>
                            {r.ref}
                          </button>
                          <div className="ops-muted">{formatDateTime(r.requestedAt)}</div>
                        </td>
                        <td>
                          {r.targetLabel} <span className="ops-muted">{r.targetType}</span>
                        </td>
                        <td style={{ maxWidth: 360 }}>
                          {r.privileged && <Badge tone="red">privileged</Badge>} {r.fromReview && <Badge tone="blue">review</Badge>} {describe(r)}
                        </td>
                        <td>{r.requestedByName}</td>
                        <td>
                          <StatusPill status={r.status} />
                        </td>
                        <td className="r">
                          {r.status === 'PENDING' && (
                            <>
                              {mine ? (
                                <ActionButton label="Withdraw" onRun={(k) => api.post(AC(`/rbac/requests/${r.id}/withdraw`), {}, { idempotencyKey: k })} onDone={res.reload} />
                              ) : (
                                <>
                                  <ActionButton primary label="Approve" confirm={`Approve ${r.ref} and apply it now?`} onRun={(k) => api.post(AC(`/rbac/requests/${r.id}/approve`), {}, { idempotencyKey: k })} onDone={res.reload} />{' '}
                                  <button className="ops-btn danger" type="button" onClick={() => setReject(r)}>
                                    Reject
                                  </button>
                                </>
                              )}
                            </>
                          )}
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
      {reject && (
        <FormModal
          danger
          title={`Reject ${reject.ref}`}
          submitLabel="Reject"
          onClose={() => setReject(null)}
          onDone={res.reload}
          onSubmit={(fd, key) => api.post(AC(`/rbac/requests/${reject.id}/reject`), { note: str(fd, 'note') }, { idempotencyKey: key })}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="note" required minLength={3} maxLength={500} />
          </Field>
        </FormModal>
      )}
      {open && (
        <Modal title={open.ref} kicker="Access change request" onClose={() => setOpen(null)}>
          <div className="ops-modal-body">
            <DefinitionList
              items={[
                ['Target', `${open.targetLabel} (${open.targetType})`],
                ['Kind', open.kind.replace(/_/g, ' ').toLowerCase()],
                ['Privileged because', open.privilegedBy?.join(', ') || 'not privileged'],
                ['Reason', open.reason],
                ['Requested', `${open.requestedByName}, ${formatDateTime(open.requestedAt)}`],
                ['Decision', open.decidedByName ? `${open.decidedByName}, ${formatDateTime(open.decidedAt)}` : 'Waiting'],
                ['Decision note', open.decisionNote],
              ]}
            />
            <p style={{ marginTop: 12 }}>{describe(open)}</p>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ================================================================ reviews

function ReviewsTab() {
  const list = useResource<ReviewRow[]>(() => api.get<ReviewRow[]>(AC('/rbac/reviews')), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const inThirty = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  if (openId) return <ReviewDetailView id={openId} onBack={() => { setOpenId(null); list.reload(); }} />;
  return (
    <Card
      title="Access review campaigns"
      actions={
        <button className="ops-btn primary" type="button" onClick={() => setCreate(true)}>
          Start review
        </button>
      }
    >
      <Loaded res={list} what="access reviews">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No access reviews yet. Start one to have every active staff account certified or revoked.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Review</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th className="r">Pending</th>
                    <th className="r">Certified</th>
                    <th className="r">Revoke</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button className="ops-btn small" type="button" onClick={() => setOpenId(r.id)}>
                          {r.ref}
                        </button>{' '}
                        {r.title}
                      </td>
                      <td>
                        {formatDate(r.dueDate)} {r.overdue && <Badge tone="red">overdue</Badge>}
                      </td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                      <td className="r">{r.counts.pending}</td>
                      <td className="r">{r.counts.certified}</td>
                      <td className="r">{r.counts.revoke}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {create && (
        <FormModal
          title="Start access review"
          kicker="Recertification"
          subtitle="Snapshots every active staff account. Reviewers cannot certify their own access."
          submitLabel="Start review"
          onClose={() => setCreate(false)}
          onDone={(r) => {
            list.reload();
            setOpenId((r as ReviewDetail).id);
          }}
          onSubmit={(fd, key) => api.post<ReviewDetail>(AC('/rbac/reviews'), { title: str(fd, 'title'), dueDate: str(fd, 'dueDate') }, { idempotencyKey: key })}
        >
          <FieldGrid>
            <Field label="Title" span={2}>
              <input className="ops-input" name="title" required minLength={3} maxLength={160} defaultValue="Staff access recertification" />
            </Field>
            <Field label="Due date">
              <input className="ops-input" name="dueDate" type="date" required defaultValue={inThirty} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function ReviewDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const res = useResource<ReviewDetail>(() => api.get<ReviewDetail>(AC(`/rbac/reviews/${id}`)), [id]);
  const [revoke, setRevoke] = useState<string | null>(null);
  return (
    <Loaded res={res} what="the review">
      {(r) => (
        <Card
          title={`${r.ref}: ${r.title}`}
          actions={
            <>
              <button className="ops-btn" type="button" onClick={onBack}>
                Back
              </button>{' '}
              {r.status === 'OPEN' && (
                <ActionButton
                  primary
                  label="Complete review"
                  disabled={r.counts.pending > 0}
                  title={r.counts.pending ? `${r.counts.pending} still need a decision` : undefined}
                  confirm="Complete this review? Revoked users get a disable request for an independent approver."
                  onRun={(k) => api.post(AC(`/rbac/reviews/${r.id}/complete`), {}, { idempotencyKey: k })}
                  onDone={res.reload}
                />
              )}
            </>
          }
        >
          <p className="ops-muted">
            Due {formatDate(r.dueDate)} · {r.counts.pending} pending, {r.counts.certified} certified, {r.counts.revoke} to revoke · opened by {r.openedBy}
          </p>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Roles</th>
                  <th className="r">Permissions</th>
                  <th>MFA</th>
                  <th>Decision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.userName}
                      <div className="ops-muted">{i.email}</div>
                    </td>
                    <td>{i.roles.map((x) => x.label).join(', ')}</td>
                    <td className="r">{i.permissionCount}</td>
                    <td>{i.mfaEnrolled ? <Badge tone="green">enrolled</Badge> : <Badge tone="amber">none</Badge>}</td>
                    <td>
                      <StatusPill status={i.decision} />
                      {i.note && <div className="ops-muted">{i.note}</div>}
                      {i.request && <div className="ops-muted">{i.request.ref} {i.request.status.toLowerCase()}</div>}
                    </td>
                    <td className="r">
                      {r.status === 'OPEN' && (
                        <>
                          <ActionButton label="Certify" onRun={(k) => api.post(AC(`/rbac/reviews/${r.id}/items/${i.id}/decide`), { decision: 'CERTIFIED' }, { idempotencyKey: k })} onDone={res.reload} />{' '}
                          <button className="ops-btn danger" type="button" onClick={() => setRevoke(i.id)}>
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {revoke && (
            <FormModal
              danger
              title="Revoke access"
              subtitle="A disable request is raised for an independent approver when the review completes."
              submitLabel="Mark for revocation"
              onClose={() => setRevoke(null)}
              onDone={res.reload}
              onSubmit={(fd, key) => api.post(AC(`/rbac/reviews/${r.id}/items/${revoke}/decide`), { decision: 'REVOKE', note: optStr(fd, 'note') }, { idempotencyKey: key })}
            >
              <Field label="Why should access be revoked?">
                <textarea className="ops-input" name="note" required maxLength={500} />
              </Field>
            </FormModal>
          )}
        </Card>
      )}
    </Loaded>
  );
}

// ================================================================ SoD

function SodTab() {
  const report = useResource<SodReport>(() => api.get<SodReport>(AC('/rbac/sod')), []);
  const scan = useResource<SodScan>(() => api.get<SodScan>(v1('/admin/sod-scan')), []);
  return (
    <>
      <Card title="Control scan" actions={<button className="ops-btn" type="button" onClick={() => { report.reload(); scan.reload(); }}>Rescan</button>}>
        <Loaded res={scan} what="the control scan">
          {(s) => (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {s.findings.map((f, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  <Badge tone={f.severity === 'block' ? 'red' : f.severity === 'warn' ? 'amber' : 'green'}>{f.severity === 'ok' ? 'ok' : f.severity === 'block' ? 'blocking' : 'warning'}</Badge> <strong>{f.title}</strong>: {f.detail} <span className="ops-muted">({f.action})</span>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>
      <Loaded res={report} what="the conflict report">
        {(r) => (
          <>
            <Card title={`Conflicts by user (${r.summary.users})`}>
              {r.userConflicts.length === 0 ? (
                <Empty>No active user holds a conflicting permission pair.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Roles</th>
                        <th>Conflicts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.userConflicts.map((u) => (
                        <tr key={u.userId}>
                          <td>
                            {u.name}
                            <div className="ops-muted">{u.email}</div>
                          </td>
                          <td>{u.roles.join(', ')}</td>
                          <td>
                            {u.hits.map((h) => (
                              <div key={h.rule}>
                                <code>{h.a}</code> + <code>{h.b}</code> <span className="ops-muted">{h.why}</span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title={`Conflicts inside a role (${r.summary.roles})`}>
              {r.roleConflicts.length === 0 ? (
                <Empty>No role bundles a conflicting pair.</Empty>
              ) : (
                r.roleConflicts.map((x) => (
                  <div key={x.key} style={{ marginBottom: 8 }}>
                    <strong>{x.label}</strong>
                    {x.hits.map((h) => (
                      <div key={h.rule}>
                        <code>{h.a}</code> + <code>{h.b}</code> <span className="ops-muted">{h.why}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </Card>
            <Card title={`Rule set (${r.rules.length})`}>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <tbody>
                    {r.rules.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <code>{x.a}</code> + <code>{x.b}</code>
                        </td>
                        <td>{x.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ops-muted">Monetary permissions that System Administrators must never hold: {r.protectedMonetary.join(', ')}.</p>
            </Card>
          </>
        )}
      </Loaded>
    </>
  );
}

// ================================================================ step-up

function StepUpTab() {
  const res = useResource<StepUpPolicy>(() => api.get<StepUpPolicy>(AC('/rbac/step-up')), []);
  return (
    <Loaded res={res} what="the step-up policy">
      {(p) => (
        <>
          <Card title="Policy">
            <DefinitionList
              items={[
                ['MFA mandatory', p.mfaRequired ? <Badge tone="green">yes</Badge> : <Badge tone="amber">no</Badge>],
                ['Step-up window', `${p.windowMinutes} minutes`],
                ['Idle session timeout', `${p.sessionIdleMinutes} minutes`],
                ['Staff with an authenticator', `${p.enrolment.enrolled} of ${p.enrolment.staff}`],
              ]}
            />
            <p className="ops-muted" style={{ marginTop: 10 }}>
              {p.note} MFA and the idle timeout are changed under Settings.
            </p>
          </Card>
          <Card title="Actions that need a fresh code">
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Action</th>
                    <th>Permission</th>
                  </tr>
                </thead>
                <tbody>
                  {p.actions.map((a, i) => (
                    <tr key={i}>
                      <td>{a.area}</td>
                      <td>{a.action}</td>
                      <td>
                        <code>{a.permission}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Loaded>
  );
}
