'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '@/ops/api';
import { NOTIFICATIONS_PATH, ago, useOpenNotification, type NotificationItem } from '@/ops/shell/NotificationBell';
import { Alert, Card, Empty, Field, Loaded, PageHeader, formatDateTime, useAction, useResource } from '@/ops/ui';

interface Page {
  items: NotificationItem[];
  unread: number;
  page: number;
  pageSize: number;
  total: number;
}

interface Prefs {
  digest: 'off' | 'daily' | 'weekly';
  types: { type: string; label: string; critical: boolean; channels: { in_app: boolean; email: boolean } }[];
}

const SIZE = 20;

/** Full notification list (paged) and the user's delivery preferences: bell, email and daily or weekly digest. */
export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData((await api.get<Page>(`${NOTIFICATIONS_PATH}?page=${page}&pageSize=${SIZE}${unreadOnly ? '&unread=1' : ''}`)) as unknown as Page);
      setError('');
    } catch (e) {
      setError(describeError(e));
    }
  }, [page, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useOpenNotification(() => void load());
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        kicker="Account"
        title="Notifications"
        subtitle="Approvals, breaches and breaks addressed to you."
        actions={
          <>
            <label className="ops-check">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} /> Unread only
            </label>{' '}
            <button
              className="ops-btn"
              type="button"
              disabled={!data?.unread}
              onClick={async () => {
                await api.post(`${NOTIFICATIONS_PATH}/read-all`).catch(() => undefined);
                void load();
              }}
            >
              Mark all read
            </button>
          </>
        }
      />
      <Alert>{error}</Alert>
      <Card>
        {!data && !error && <div className="ops-loading">Loading notifications…</div>}
        {data && data.items.length === 0 && <Empty>{unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}</Empty>}
        {data && data.items.length > 0 && (
          <>
            <div className="ops-pop-list">
              {data.items.map((n) => (
                <button key={n.id} type="button" className={`ops-notif${n.readAt ? '' : ' unread'}`} onClick={() => void open(n)}>
                  <span className="ops-notif-title">{n.title}</span>
                  {n.body && <span className="ops-notif-body">{n.body}</span>}
                  <small title={formatDateTime(n.createdAt)}>{ago(n.createdAt)}</small>
                </button>
              ))}
            </div>
            <div className="ops-pager">
              <button className="ops-btn small" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="ops-muted">
                Page {data.page} of {pages} · {data.total} notification{data.total === 1 ? '' : 's'}
              </span>
              <button className="ops-btn small" type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </Card>
      <Preferences />
    </>
  );
}

function Preferences() {
  const res = useResource(() => api.get<Prefs>(`${NOTIFICATIONS_PATH}/preferences`) as unknown as Promise<Prefs>, []);
  return (
    <Loaded res={res} what="your preferences">
      {(p) => <PrefsForm initial={p} onSaved={res.reload} />}
    </Loaded>
  );
}

function PrefsForm({ initial, onSaved }: { initial: Prefs; onSaved: () => void }) {
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const toggle = (type: string, channel: 'in_app' | 'email') =>
    setPrefs((cur) => ({ ...cur, types: cur.types.map((t) => (t.type === type ? { ...t, channels: { ...t.channels, [channel]: !t.channels[channel] } } : t)) }));

  return (
    <Card title="Delivery preferences" actions={saved ? <span className="ops-muted">Saved</span> : undefined}>
      <p className="ops-muted">
        Critical alerts (risk breaches, access change requests) always reach you through the channel set by your administrators and ignore these choices.
      </p>
      <Field label="Email digest" hint="With a digest, email notifications are bundled into one message each morning (or Monday) instead of sent one by one.">
        <select className="ops-input" value={prefs.digest} onChange={(e) => setPrefs({ ...prefs, digest: e.target.value as Prefs['digest'] })}>
          <option value="off">Send each email immediately</option>
          <option value="daily">Daily digest</option>
          <option value="weekly">Weekly digest (Monday)</option>
        </select>
      </Field>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Notification</th>
              <th>Bell</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {prefs.types.map((t) => (
              <tr key={t.type}>
                <td>
                  {t.label} {t.critical && <span className="ops-badge amber">critical</span>}
                </td>
                <td>
                  <input type="checkbox" aria-label={`${t.label} in the bell`} checked={t.channels.in_app} disabled={t.critical} onChange={() => toggle(t.type, 'in_app')} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${t.label} by email`} checked={t.channels.email} disabled={t.critical} onChange={() => toggle(t.type, 'email')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <button
          className="ops-btn primary"
          type="button"
          disabled={action.busy}
          onClick={async () => {
            setSaved(false);
            const ok = await action.run(() =>
              api
                .put(`${NOTIFICATIONS_PATH}/preferences`, {
                  digest: prefs.digest,
                  preferences: prefs.types.flatMap((t) => [
                    { type: t.type, channel: 'in_app', enabled: t.channels.in_app },
                    { type: t.type, channel: 'email', enabled: t.channels.email },
                  ]),
                })
                .then(() => true),
            );
            if (ok) {
              setSaved(true);
              onSaved();
            }
          }}
        >
          Save preferences
        </button>
      </p>
      <Alert>{action.error}</Alert>
    </Card>
  );
}
