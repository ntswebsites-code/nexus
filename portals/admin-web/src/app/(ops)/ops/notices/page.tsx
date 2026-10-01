'use client';

import { useState } from 'react';
import { api, ops, qs } from '@/ops/api';
import { ClientSelect, FundSelect } from '@/ops/lookups';
import { useSession } from '@/ops/session';
import type { LpNotice, LpNoticeReceipt } from '@/ops/types';
import {
  ActionButton,
  Alert,
  Card,
  DefinitionList,
  Empty,
  Field,
  FieldGrid,
  FormModal,
  formatDateTime,
  Loaded,
  optStr,
  PageHeader,
  StatusBadge,
  str,
  useResource,
} from '@/ops/ui';

const CATEGORIES = ['GENERAL', 'CAPITAL_CALL', 'REPORT', 'POLICY'];
const TARGETS: Record<string, string> = { ALL: 'All LPs', FUND: 'LPs in one fund', ORG: 'One LP organisation', USER: 'One LP user' };

export default function NoticesPage() {
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const notices = useResource<LpNotice[]>(() => api.get<LpNotice[]>(ops(`/notices${qs({ status })}`)), [status]);
  const selected = notices.state === 'ok' ? notices.data.find((n) => n.id === selectedId) ?? null : null;

  return (
    <>
      <PageHeader
        kicker="Fund operations · J2"
        title="LP notices"
        subtitle="Targeted notices to LPs. A notice is prepared, approved by a second person, then published; receipts show who opened and acknowledged it."
        actions={
          can('notices.create') && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New notice
            </button>
          )
        }
      />
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'WITHDRAWN', 'EXPIRED'].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ops-split">
        <Card>
          <Loaded res={notices} what="LP notices">
            {(rows) =>
              rows.length === 0 ? (
                <Empty>No notices match this filter.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Notice</th>
                        <th>Audience</th>
                        <th>Published</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((n) => (
                        <tr key={n.id} className={`clickable${n.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(n.id)}>
                          <td>
                            <strong>{n.title}</strong>
                            <span className="ops-sub">
                              {n.ref ? `${n.ref} · ` : ''}
                              {n.category.replace(/_/g, ' ').toLowerCase()}
                            </span>
                          </td>
                          <td>{audience(n)}</td>
                          <td>{formatDateTime(n.publishedAt)}</td>
                          <td>
                            <StatusBadge status={n.status} />
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
        {selected ? (
          <NoticePanel key={selected.id} notice={selected} reload={notices.reload} />
        ) : (
          <Card>
            <Empty>Select a notice to review, approve, publish or see its receipts.</Empty>
          </Card>
        )}
      </div>
      {creating && <CreateNoticeModal onClose={() => setCreating(false)} onDone={notices.reload} />}
    </>
  );
}

function audience(n: LpNotice): string {
  switch (n.targetType) {
    case 'FUND':
      return `Fund: ${n.fundName ?? n.fundId ?? '—'}`;
    case 'ORG':
      return `LP: ${n.clientName ?? n.clientId ?? '—'}`;
    case 'USER':
      return `User: ${n.userId ?? '—'}`;
    default:
      return 'All LPs';
  }
}

function NoticePanel({ notice, reload }: { notice: LpNotice; reload: () => void }) {
  const { user, can } = useSession();
  const base = ops(`/notices/${encodeURIComponent(notice.id)}`);
  const isMaker = !!notice.createdById && notice.createdById === user.id;
  const s = notice.status;
  const receipts = useResource<LpNoticeReceipt[]>(
    () => (s === 'DRAFT' ? Promise.resolve([]) : api.get<LpNoticeReceipt[]>(`${base}/receipts`)),
    [notice.id, s],
  );

  return (
    <div>
      <Card
        title={notice.title}
        actions={
          <>
            {s === 'DRAFT' && can('notices.create') && (
              <ActionButton primary label="Submit for approval" onRun={(key) => api.post(`${base}/submit`, {}, { idempotencyKey: key })} onDone={reload} />
            )}
            {(s === 'PENDING_APPROVAL' || s === 'SUBMITTED') && can('notices.publish') && (
              <ActionButton
                primary
                label="Approve"
                disabled={isMaker}
                title={isMaker ? 'You prepared this notice. A different approver is required.' : undefined}
                onRun={(key) => api.post(`${base}/approve`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {s === 'APPROVED' && can('notices.publish') && (
              <ActionButton
                primary
                label="Publish"
                confirm="Publish this notice? LPs in the audience will see it and be notified."
                onRun={(key) => api.post(`${base}/publish`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {s === 'PUBLISHED' && can('notices.publish') && (
              <ActionButton
                danger
                label="Withdraw"
                confirm="Withdraw this notice from the LP portal?"
                onRun={(key) => api.post(`${base}/withdraw`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
          </>
        }
      >
        {(s === 'PENDING_APPROVAL' || s === 'SUBMITTED') && isMaker && <Alert kind="info">You prepared this notice. A different approver is required.</Alert>}
        <DefinitionList
          items={[
            ['Status', <StatusBadge key="s" status={s} />],
            ['Category', notice.category.replace(/_/g, ' ').toLowerCase()],
            ['Audience', audience(notice)],
            ['Acknowledgement', notice.requiresAcknowledgement ? 'Required' : 'Not required'],
            ['Published', formatDateTime(notice.publishedAt)],
            ['Expires', formatDateTime(notice.expiresAt)],
            ['Prepared by', notice.createdByName ?? (isMaker ? 'You' : notice.createdById ?? '—')],
          ]}
        />
        <div style={{ marginTop: 14 }}>
          <p className="ops-pre">{notice.body}</p>
        </div>
      </Card>
      {s !== 'DRAFT' && (
        <Card title="Receipts">
          <Loaded res={receipts} what="receipts">
            {(rows) =>
              rows.length === 0 ? (
                <Empty>No receipts yet.</Empty>
              ) : (
                <>
                  <p className="ops-muted">
                    {rows.filter((r) => r.openedAt).length} of {rows.length} opened · {rows.filter((r) => r.acknowledgedAt).length} acknowledged
                  </p>
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th>Recipient</th>
                          <th>Delivered</th>
                          <th>Opened</th>
                          <th>Acknowledged</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td>
                              {r.userName ?? r.userEmail ?? r.userId}
                              <span className="ops-sub">{r.clientName ?? r.clientId}</span>
                            </td>
                            <td>{formatDateTime(r.deliveredAt)}</td>
                            <td>{formatDateTime(r.openedAt)}</td>
                            <td>{formatDateTime(r.acknowledgedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            }
          </Loaded>
        </Card>
      )}
    </div>
  );
}

function CreateNoticeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState('ALL');
  return (
    <FormModal
      wide
      kicker="LP notice · draft"
      title="New notice"
      subtitle="Saved as a draft. It is published only after a second person approves it."
      submitLabel="Save draft"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd, key) => {
        const expires = optStr(fd, 'expiresAt');
        return api.post(
          ops('/notices'),
          {
            title: str(fd, 'title'),
            body: str(fd, 'body'),
            category: str(fd, 'category'),
            targetType: target,
            fundId: target === 'FUND' ? str(fd, 'fundId') : undefined,
            clientId: target === 'ORG' ? str(fd, 'clientId') : undefined,
            userId: target === 'USER' ? str(fd, 'userId') : undefined,
            requiresAcknowledgement: fd.get('requiresAcknowledgement') === 'on',
            expiresAt: expires ? new Date(expires).toISOString() : undefined,
          },
          { idempotencyKey: key },
        );
      }}
    >
      <FieldGrid>
        <Field label="Title" span={2}>
          <input className="ops-input" name="title" required maxLength={512} />
        </Field>
        <Field label="Message" span={2}>
          <textarea className="ops-input" name="body" required rows={6} />
        </Field>
        <Field label="Category">
          <select className="ops-input" name="category" defaultValue="GENERAL">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Audience">
          <select className="ops-input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {Object.entries(TARGETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {target === 'FUND' && (
          <Field label="Fund" span={2}>
            <FundSelect name="fundId" required />
          </Field>
        )}
        {target === 'ORG' && (
          <Field label="LP organisation" span={2}>
            <ClientSelect name="clientId" required />
          </Field>
        )}
        {target === 'USER' && (
          <Field label="LP user id" span={2} hint="The user's account id (from Clients & Accounts → portal users).">
            <input className="ops-input" name="userId" required />
          </Field>
        )}
        <Field label="Expires (optional)">
          <input className="ops-input" type="datetime-local" name="expiresAt" />
        </Field>
        <Field label="Acknowledgement">
          <label className="ops-check">
            <input type="checkbox" name="requiresAcknowledgement" defaultChecked /> LPs must acknowledge this notice
          </label>
        </Field>
      </FieldGrid>
    </FormModal>
  );
}
