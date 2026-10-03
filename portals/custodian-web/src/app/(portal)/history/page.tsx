'use client';

import { Badge, Card, Empty, Loading, PageHead } from '@/components/ui';
import { custodian, fmtDateTime, useLoad, type StatusEvent } from '@/lib/api';

export default function HistoryPage() {
  const h = useLoad(() => custodian.get<{ items: StatusEvent[] }>('/history?limit=200'));
  return (
    <>
      <PageHead title="Status history" sub="Every status change on your executions, including matches and exceptions raised by Matanho operations, newest first." />
      <Card>
        <Loading loading={h.loading && !h.data} error={h.error} />
        {h.data && h.data.items.length === 0 && <Empty>No history yet.</Empty>}
        {h.data && h.data.items.length > 0 && (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Execution</th>
                  <th>Trade reference</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>By</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {h.data.items.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDateTime(e.at)}</td>
                    <td>{e.ref ?? ''}</td>
                    <td>{e.tradeRef ?? ''}</td>
                    <td>{e.action}</td>
                    <td>
                      {e.fromStatus ? `${e.fromStatus} to ` : ''}
                      <Badge value={e.toStatus} />
                    </td>
                    <td>{e.by}</td>
                    <td>{e.reason ?? ''}</td>
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
