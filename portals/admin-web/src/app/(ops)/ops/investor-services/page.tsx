'use client';

import { useState } from 'react';
import { asList, coGet, coPost, coPut, hrs, NoAccess, rawGet, StaffSelect, Tabs, Tile, Tone, type StaffUser } from '@/ops/clientops';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

interface Req {
  id: string;
  clientRef: string;
  client: string;
  type: string;
  priority: string;
  title: string;
  detail: string | null;
  status: string;
  assignee: string | null;
  assigneeId: string | null;
  slaDueAt: string | null;
  sla: string;
  createdAt: string;
  ageHours: number;
}
interface Summary {
  open: number;
  unassigned: number;
  breached: number;
  atRisk: number;
  byType: Record<string, number>;
  byAssignee: Record<string, number>;
  avgResolutionHours: number | null;
  slaMetPct: number | null;
}
interface Policy { id: string; requestType: string; priority: string; targetHours: number }
interface Detail { request: Req; events: { at: string; title: string; detail: string | null; by: string | null }[] }

const TYPES = ['Query', 'Statement request', 'Transfer', 'Redemption', 'Account change', 'Tax document', 'Complaint', 'Other'];

export default function InvestorServicesPage() {
  const canView = useCan('clients.view');
  const canEdit = useCan('clients.edit');
  const [tab, setTab] = useState<'queue' | 'sla'>('queue');
  const [status, setStatus] = useState('Open,In progress,Waiting on you');
  const [type, setType] = useState('');
  const [sla, setSla] = useState('');
  const [assignee, setAssignee] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const staff = useResource<StaffUser[]>(() => coGet<{ data: StaffUser[] }>('/staff').then(asList), []);
  const summary = useResource<Summary>(() => coGet<Summary>('/services/summary'), []);
  const list = useResource<Req[]>(
    () => coGet<{ data: Req[] }>('/services/requests', { status, type, sla, assignee, q }).then(asList),
    [status, type, sla, assignee, q],
  );
  const clients = useResource<{ id: string; name: string }[]>(() => rawGet<{ data: { id: string; name: string }[] }>('/api/v1/clients').then(asList), []);
  const reload = () => { list.reload(); summary.reload(); };
  if (!canView) return <NoAccess kicker="Clients" title="Investor Services" perm="clients.view" />;
  const staffList = staff.state === 'ok' ? staff.data : [];
  return (
    <>
      <PageHeader
        kicker="Clients"
        title="Investor Services"
        subtitle="Investor queries, transfers, statements and redemption administration with SLA tracking and assignment."
        actions={canEdit ? <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>Log request</button> : undefined}
      />
      <Loaded res={summary} what="service summary">
        {(s) => (
          <div className="ops-tiles">
            <Tile label="Open cases" value={s.open} hint={`${s.unassigned} unassigned`} warn={s.unassigned > 0} />
            <Tile label="SLA breached" value={s.breached} warn={s.breached > 0} />
            <Tile label="At risk" value={s.atRisk} warn={s.atRisk > 0} />
            <Tile label="Avg resolution" value={s.avgResolutionHours === null ? '-' : hrs(Math.round(s.avgResolutionHours))} hint={s.slaMetPct === null ? undefined : `${s.slaMetPct}% closed within SLA`} />
          </div>
        )}
      </Loaded>
      <Tabs tabs={[{ key: 'queue', label: 'Queue' }, { key: 'sla', label: 'SLA policy' }]} value={tab} onChange={setTab} />
      {tab === 'queue' && (
        <Card title="Requests">
          <div className="ops-filters">
            <Field label="Search"><input className="ops-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, title or client" /></Field>
            <Field label="Status">
              <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="Open,In progress,Waiting on you">Active</option>
                <option value="">All</option>
                {['Open', 'In progress', 'Waiting on you', 'Closed'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select className="ops-input" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All</option>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="SLA">
              <select className="ops-input" value={sla} onChange={(e) => setSla(e.target.value)}>
                <option value="">All</option>
                {['Breached', 'At risk', 'On track', 'Closed'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <select className="ops-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Anyone</option>
                <option value="unassigned">Unassigned</option>
                {staffList.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          </div>
          <Loaded res={list} what="requests">
            {(rows) =>
              rows.length === 0 ? <Empty>No requests match.</Empty> : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Request</th><th>Client</th><th>Type</th><th>Status</th><th>Assignee</th><th>Due</th><th>SLA</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                          <td><strong>{r.title}</strong><span className="ops-sub">{r.id} · {r.priority}</span></td>
                          <td>{r.client}<span className="ops-sub">{r.clientRef}</span></td>
                          <td>{r.type}</td>
                          <td><Tone value={r.status} /></td>
                          <td>{r.assignee ?? <Tone value="Unassigned" />}</td>
                          <td>{formatDateTime(r.slaDueAt)}</td>
                          <td><Tone value={r.sla} /></td>
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
      {tab === 'sla' && <SlaPolicy canEdit={canEdit} />}
      {open && <RequestModal id={open} staff={staffList} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={reload} />}
      {creating && (
        <FormModal
          title="Log a request"
          kicker="Investor Services"
          subtitle="The due date comes from the SLA policy for the type and priority."
          submitLabel="Log request"
          onClose={() => setCreating(false)}
          onDone={reload}
          onSubmit={(fd, key) =>
            coPost('/services/requests', { clientId: str(fd, 'clientId'), type: str(fd, 'type'), priority: str(fd, 'priority'), title: str(fd, 'title'), detail: str(fd, 'detail'), assigneeId: optStr(fd, 'assigneeId') }, key)
          }
        >
          <FieldGrid>
            <Field label="Client">
              <select className="ops-input" name="clientId" required>
                <option value="">Choose</option>
                {(clients.state === 'ok' ? clients.data : []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
              </select>
            </Field>
            <Field label="Type"><select className="ops-input" name="type">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Priority"><select className="ops-input" name="priority"><option>Normal</option><option>Time sensitive</option></select></Field>
            <Field label="Assign to"><StaffSelect staff={staffList} name="assigneeId" /></Field>
            <Field label="Title" span={2}><input className="ops-input" name="title" required minLength={3} /></Field>
            <Field label="Details" span={2}><textarea className="ops-input" name="detail" required /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}

function RequestModal({ id, staff, canEdit, onClose, onChanged }: { id: string; staff: StaffUser[]; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const res = useResource<Detail>(() => coGet<Detail>(`/services/requests/${encodeURIComponent(id)}`), [id]);
  const [dlg, setDlg] = useState<'assign' | 'status' | 'note' | 'sla' | null>(null);
  const done = () => { res.reload(); onChanged(); };
  return (
    <Modal title={id} kicker="Investor Services" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="the request">
          {({ request: r, events }) => (
            <>
              <dl className="ops-dl">
                {([['Client', `${r.client} (${r.clientRef})`], ['Type', r.type], ['Priority', r.priority], ['Status', <Tone key="s" value={r.status} />], ['Assignee', r.assignee ?? 'Unassigned'], ['Due', formatDateTime(r.slaDueAt)], ['SLA', <Tone key="l" value={r.sla} />], ['Age', hrs(r.ageHours)]] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              <p><strong>{r.title}</strong></p>
              {r.detail && <p className="ops-muted">{r.detail}</p>}
              {canEdit && r.status !== 'Closed' && (
                <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="ops-btn" type="button" onClick={() => setDlg('assign')}>Assign</button>
                  <button className="ops-btn primary" type="button" onClick={() => setDlg('status')}>Change status</button>
                  <button className="ops-btn" type="button" onClick={() => setDlg('note')}>Add internal note</button>
                  <button className="ops-btn" type="button" onClick={() => setDlg('sla')}>Re-set SLA</button>
                </p>
              )}
              <h3>Timeline</h3>
              {events.length === 0 ? <Empty>No events.</Empty> : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {events.map((e, i) => (
                    <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--ops-line-2)' }}>
                      <strong>{e.title}</strong> <span className="ops-sub">{formatDateTime(e.at)}{e.by ? ` · ${e.by}` : ''}</span>
                      {e.detail && <div className="ops-muted">{e.detail}</div>}
                    </li>
                  ))}
                </ul>
              )}
              {dlg === 'assign' && (
                <FormModal title="Assign request" kicker={r.id} submitLabel="Assign" onClose={() => setDlg(null)} onDone={done}
                  onSubmit={(fd) => coPost(`/services/requests/${r.id}/assign`, { userId: optStr(fd, 'userId') ?? null, note: optStr(fd, 'note') })}>
                  <FieldGrid>
                    <Field label="Staff member"><StaffSelect staff={staff} name="userId" value={r.assigneeId} /></Field>
                    <Field label="Note"><input className="ops-input" name="note" /></Field>
                  </FieldGrid>
                </FormModal>
              )}
              {dlg === 'status' && (
                <FormModal title="Change status" kicker={r.id} subtitle="Investor users are notified. Closing needs the resolution." submitLabel="Update" onClose={() => setDlg(null)} onDone={done}
                  onSubmit={(fd) => coPost(`/services/requests/${r.id}/status`, { status: str(fd, 'status'), note: optStr(fd, 'note'), notifyClient: fd.get('notify') === 'on' })}>
                  <FieldGrid>
                    <Field label="Status"><select className="ops-input" name="status" defaultValue="In progress">{['Open', 'In progress', 'Waiting on you', 'Closed'].filter((s) => s !== r.status).map((s) => <option key={s}>{s}</option>)}</select></Field>
                    <Field label="Notify investor"><input type="checkbox" name="notify" defaultChecked /></Field>
                    <Field label="Note / resolution" span={2}><textarea className="ops-input" name="note" /></Field>
                  </FieldGrid>
                </FormModal>
              )}
              {dlg === 'note' && (
                <FormModal title="Internal note" kicker={r.id} subtitle="Not visible to the investor." submitLabel="Add note" onClose={() => setDlg(null)} onDone={done}
                  onSubmit={(fd) => coPost(`/services/requests/${r.id}/note`, { note: str(fd, 'note') })}>
                  <Field label="Note"><textarea className="ops-input" name="note" required /></Field>
                </FormModal>
              )}
              {dlg === 'sla' && (
                <FormModal title="Re-set SLA" kicker={r.id} submitLabel="Save" onClose={() => setDlg(null)} onDone={done}
                  onSubmit={(fd) => coPost(`/services/requests/${r.id}/sla`, { dueAt: new Date(str(fd, 'dueAt')).toISOString(), reason: str(fd, 'reason') })}>
                  <FieldGrid>
                    <Field label="New due date"><input className="ops-input" type="datetime-local" name="dueAt" required /></Field>
                    <Field label="Reason"><input className="ops-input" name="reason" required minLength={5} /></Field>
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

function SlaPolicy({ canEdit }: { canEdit: boolean }) {
  const res = useResource<{ data: Policy[] }>(() => coGet<{ data: Policy[] }>('/services/sla-policies'), []);
  const [edit, setEdit] = useState<Partial<Policy> | null>(null);
  return (
    <Card title="Service-level targets" actions={canEdit ? <button className="ops-btn" type="button" onClick={() => setEdit({})}>Add / change target</button> : undefined}>
      <Alert kind="info">Targets apply to requests logged from now on. A row for type &quot;*&quot; is the fallback for types without their own target.</Alert>
      <Loaded res={res} what="SLA policy">
        {(r) => (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Request type</th><th>Priority</th><th className="r">Target</th><th /></tr></thead>
              <tbody>
                {r.data.map((p) => (
                  <tr key={p.id}>
                    <td>{p.requestType === '*' ? 'All other types' : p.requestType}</td>
                    <td>{p.priority}</td>
                    <td className="r">{hrs(p.targetHours)} ({p.targetHours}h)</td>
                    <td>{canEdit && <button className="ops-btn small" type="button" onClick={() => setEdit(p)}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
      {edit && (
        <FormModal title="SLA target" kicker="Investor Services" submitLabel="Save target" onClose={() => setEdit(null)} onDone={res.reload}
          onSubmit={(fd) => coPut('/services/sla-policies', { requestType: str(fd, 'requestType'), priority: str(fd, 'priority'), targetHours: Number(str(fd, 'hours')) })}>
          <FieldGrid>
            <Field label="Request type"><select className="ops-input" name="requestType" defaultValue={edit.requestType ?? '*'}><option value="*">All other types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Priority"><select className="ops-input" name="priority" defaultValue={edit.priority ?? 'Normal'}><option>Normal</option><option>Time sensitive</option></select></Field>
            <Field label="Target (hours)"><input className="ops-input" name="hours" type="number" min={1} max={720} defaultValue={edit.targetHours ?? 48} required /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}
