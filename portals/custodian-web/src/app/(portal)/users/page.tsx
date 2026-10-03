'use client';

import { useState, type FormEvent } from 'react';
import { Badge, Card, Field, Loading, Modal, Notice, PageHead } from '@/components/ui';
import { custodian, errorText, fmtDateTime, useIdempotencyKey, useLoad } from '@/lib/api';

interface Person {
  userId: string;
  name: string | null;
  email: string;
  role: 'submitter' | 'approver';
  status: 'active' | 'inactive';
  lastLoginAt: string | null;
  you: boolean;
}

export default function UsersPage() {
  const users = useLoad(() => custodian.get<{ canManage: boolean; items: Person[] }>('/users'));
  const [invite, setInvite] = useState({ email: '', name: '', role: 'submitter' });
  const [change, setChange] = useState<null | { person: Person; role: string; status: string }>(null);
  const [reason, setReason] = useState('');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inviteKey = useIdempotencyKey();
  const changeKey = useIdempotencyKey();

  async function sendInvite(ev: FormEvent) {
    ev.preventDefault();
    setFlash(null);
    try {
      await custodian.post('/users/invite', { email: invite.email, role: invite.role, ...(invite.name ? { name: invite.name } : {}) }, inviteKey.current());
      inviteKey.renew();
      setFlash({ kind: 'ok', text: `Invitation sent to ${invite.email}. It is valid for 7 days.` });
      setInvite({ email: '', name: '', role: 'submitter' });
    } catch (e) {
      setFlash({ kind: 'error', text: errorText(e) });
    }
  }

  async function saveChange(ev: FormEvent) {
    ev.preventDefault();
    if (!change) return;
    setFlash(null);
    const patch: Record<string, string> = { reason };
    if (change.role !== change.person.role) patch.role = change.role;
    if (change.status !== change.person.status) patch.status = change.status;
    try {
      await custodian.patch(`/users/${change.person.userId}`, patch, changeKey.current());
      changeKey.renew();
      setFlash({ kind: 'ok', text: `Access updated for ${change.person.email}.` });
      setChange(null);
      setReason('');
      void users.reload();
    } catch (e) {
      setFlash({ kind: 'error', text: errorText(e) });
    }
  }

  const manage = users.data?.canManage;
  return (
    <>
      <PageHead title="Users and roles" sub="Submitters prepare executions and day-end packages. Approvers also approve day-end packages (never their own) and manage this list." />
      {flash && <Notice kind={flash.kind}>{flash.text}</Notice>}
      <Card title="People with access">
        <Loading loading={users.loading && !users.data} error={users.error} />
        {users.data && (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((p) => (
                  <tr key={p.userId}>
                    <td>
                      {p.name ?? ''} {p.you && <small>(you)</small>}
                    </td>
                    <td>{p.email}</td>
                    <td>{p.role}</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td>{p.lastLoginAt ? fmtDateTime(p.lastLoginAt) : 'never'}</td>
                    <td>
                      {manage && !p.you && (
                        <button type="button" className="cx-btn sm" onClick={() => setChange({ person: p, role: p.role, status: p.status })}>
                          Change access
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
      {manage && (
        <Card title="Invite a colleague">
          <form onSubmit={sendInvite}>
            <div className="cx-form">
              <Field label="Email">
                <input required type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              </Field>
              <Field label="Name (optional)">
                <input maxLength={120} value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
              </Field>
              <Field label="Role">
                <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                  <option value="submitter">Submitter</option>
                  <option value="approver">Approver</option>
                </select>
              </Field>
            </div>
            <p className="cx-actions">
              <button className="cx-btn primary">Send invitation</button>
            </p>
          </form>
        </Card>
      )}
      {change && (
        <Modal title={`Change access for ${change.person.email}`} onClose={() => setChange(null)}>
          <form onSubmit={saveChange}>
            <div className="cx-form">
              <Field label="Role">
                <select value={change.role} onChange={(e) => setChange({ ...change, role: e.target.value })}>
                  <option value="submitter">Submitter</option>
                  <option value="approver">Approver</option>
                </select>
              </Field>
              <Field label="Status">
                <select value={change.status} onChange={(e) => setChange({ ...change, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <div className="full">
                <Field label="Reason" hint="Recorded in the audit trail">
                  <input required minLength={3} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              </div>
            </div>
            <p className="cx-actions">
              <button className="cx-btn primary">Save</button>
            </p>
          </form>
        </Modal>
      )}
    </>
  );
}
