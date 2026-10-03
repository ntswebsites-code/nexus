'use client';

import { useState } from 'react';
import { Card, Empty, Loading, Notice, PageHead } from '@/components/ui';
import { errorText, fmtDateTime, platform, useLoad, type Notice as NoticeRow } from '@/lib/api';

export default function NotificationsPage() {
  const n = useLoad(() => platform.get<{ items: NoticeRow[]; unread: number }>('/notifications?pageSize=100'));
  const [err, setErr] = useState<string | null>(null);

  async function mark(path: string) {
    setErr(null);
    try {
      await platform.post(path);
      await n.reload();
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <>
      <PageHead
        title="Notifications"
        sub="Day-end approvals, review outcomes, exceptions and access changes for your organisation."
        actions={
          <button type="button" className="cx-btn" disabled={!n.data?.unread} onClick={() => void mark('/notifications/read-all')}>
            Mark all read
          </button>
        }
      />
      {err && <Notice kind="error">{err}</Notice>}
      <Card>
        <Loading loading={n.loading && !n.data} error={n.error} />
        {n.data && n.data.items.length === 0 && <Empty>You have no notifications.</Empty>}
        {n.data && n.data.items.length > 0 && (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <tbody>
                {n.data.items.map((x) => (
                  <tr key={x.id} className={x.readAt ? '' : 'cx-unread'}>
                    <td>
                      {x.title}
                      {x.body && (
                        <>
                          <br />
                          <small>{x.body}</small>
                        </>
                      )}
                    </td>
                    <td>{fmtDateTime(x.createdAt)}</td>
                    <td>
                      {!x.readAt && (
                        <button type="button" className="cx-btn sm" onClick={() => void mark(`/notifications/${x.id}/read`)}>
                          Mark read
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
    </>
  );
}
