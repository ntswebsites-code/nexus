'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, describeError } from '../api';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Page {
  items: NotificationItem[];
  unread: number;
  page: number;
  pageSize: number;
  total: number;
}

export const NOTIFICATIONS_PATH = '/api/v1/notifications';

export function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Opens a notification's link inside the console (relative links only). */
export function useOpenNotification(afterRead?: () => void) {
  const router = useRouter();
  return useCallback(
    async (n: NotificationItem) => {
      if (!n.readAt) {
        await api.post(`${NOTIFICATIONS_PATH}/${n.id}/read`).catch(() => undefined);
        afterRead?.();
      }
      if (n.link && n.link.startsWith('/')) router.push(n.link);
    },
    [router, afterRead],
  );
}

/** Bell with unread count and the latest items; refreshes every minute and whenever it is opened. */
export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet());
      setError('');
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, load]);

  const openItem = useOpenNotification(() => void load());

  return (
    <div className="ops-pop-wrap" ref={box}>
      <button className="ops-icon-btn" type="button" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {!!data?.unread && <span className="ops-icon-badge">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="ops-pop ops-notif-pop" role="dialog" aria-label="Notifications">
          <div className="ops-pop-head">
            <strong>Notifications</strong>
            <button
              className="ops-btn small"
              type="button"
              disabled={!data?.unread}
              onClick={async () => {
                await api.post(`${NOTIFICATIONS_PATH}/read-all`).catch(() => undefined);
                void load();
              }}
            >
              Mark all read
            </button>
          </div>
          {error && <div className="ops-pop-note ops-error-text">{error}</div>}
          {data && data.items.length === 0 && <div className="ops-pop-note">Nothing yet. Approvals, breaches and breaks will appear here.</div>}
          <div className="ops-pop-list">
            {data?.items.map((n) => (
              <button key={n.id} type="button" className={`ops-notif${n.readAt ? '' : ' unread'}`} onClick={() => void openItem(n).then(() => setOpen(false))}>
                <span className="ops-notif-title">{n.title}</span>
                {n.body && <span className="ops-notif-body">{n.body}</span>}
                <small>{ago(n.createdAt)}</small>
              </button>
            ))}
          </div>
          <div className="ops-pop-foot">
            <button
              className="ops-btn small"
              type="button"
              onClick={() => {
                setOpen(false);
                router.push('/ops/notifications');
              }}
            >
              View all and preferences
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function apiGet() {
  return api.get<Page>(`${NOTIFICATIONS_PATH}?pageSize=8`) as unknown as Promise<Page>;
}
