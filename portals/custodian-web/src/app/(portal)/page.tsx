'use client';

import { Badge, Card, Empty, Loading, PageHead, Stat } from '@/components/ui';
import { can, useMe } from '@/components/Shell';
import { custodian, fmtDate, fmtDateTime, fmtNum, fmtQty, useLoad, type DayEnd, type Execution } from '@/lib/api';

interface Dashboard {
  counterparty: { ref: string; name: string; accounts: string[] };
  executions: Record<string, number>;
  submittedToday: number;
  draftPackages: number;
  unreadNotifications: number;
  awaitingApproval: DayEnd[];
  rejectedPackages: DayEnd[];
  exceptions: Execution[];
  lastStatement: { filename: string; statementDate: string | null; at: string } | null;
  feed: { mode: string };
}

export default function DashboardPage() {
  const me = useMe();
  const { data, error, loading } = useLoad(() => custodian.get<Dashboard>('/dashboard'));
  if (!data) return <Loading loading={loading} error={error} />;
  const n = (k: string) => data.executions[k] ?? 0;
  const open = n('Exception') + n('Queried');
  return (
    <>
      <PageHead
        title={data.counterparty.name}
        sub={`Reference ${data.counterparty.ref}. Accounts: ${data.counterparty.accounts.join(', ') || 'none configured'}. Statement channel: ${data.feed.mode}.`}
        actions={
          can(me, 'custodian.executions.submit') && (
            <a className="cx-btn primary" href="/executions?new=1">
              Submit executions
            </a>
          )
        }
      />
      <div className="cx-grid">
        <Stat label="Submitted today" value={data.submittedToday} href="/executions" />
        <Stat label="Received" value={n('Received')} href="/executions?status=Received" />
        <Stat label="Matched" value={n('Matched')} tone="ok" href="/executions?status=Matched" />
        <Stat label="Exceptions and queries" value={open} tone={open ? 'bad' : ''} href="/executions?status=Exception" />
        <Stat label="Packages awaiting approval" value={data.awaitingApproval.length} tone={data.awaitingApproval.length ? 'warn' : ''} href="/day-end" />
        <Stat label="Unread notifications" value={data.unreadNotifications} href="/notifications" />
      </div>

      {data.draftPackages > 0 && (
        <Card title="Drafts">
          <p>
            You have {data.draftPackages} day-end draft{data.draftPackages === 1 ? '' : 's'} not yet submitted. <a href="/day-end">Open day-end</a>.
          </p>
        </Card>
      )}

      <Card title="Executions needing attention" actions={<a href="/executions?status=Exception">All exceptions</a>}>
        {data.exceptions.length === 0 ? (
          <Empty>No exceptions or queries from Matanho operations.</Empty>
        ) : (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Trade reference</th>
                  <th>Account</th>
                  <th>Security</th>
                  <th className="num">Quantity</th>
                  <th className="num">Price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.exceptions.map((e) => (
                  <tr key={e.id}>
                    <td>{e.ref}</td>
                    <td>{e.tradeRef}</td>
                    <td>{e.accountRef}</td>
                    <td>
                      {e.side} {e.ticker}
                    </td>
                    <td className="num">{fmtQty(e.quantity)}</td>
                    <td className="num">
                      {fmtNum(e.price, 4)} {e.currency}
                    </td>
                    <td>
                      <Badge value={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Day-end packages awaiting approval">
        {data.awaitingApproval.length === 0 ? (
          <Empty>Nothing waiting for approval.</Empty>
        ) : (
          <ul>
            {data.awaitingApproval.map((p) => (
              <li key={p.id}>
                <a href="/day-end">{p.ref}</a>: {p.accountRef}, {fmtDate(p.statementDate)}, {p.currency}, submitted {fmtDateTime(p.submittedAt)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.rejectedPackages.length > 0 && (
        <Card title="Rejected by Matanho">
          <ul>
            {data.rejectedPackages.map((p) => (
              <li key={p.id}>
                {p.ref} ({p.accountRef}, {fmtDate(p.statementDate)}): {p.review?.note ?? 'no note given'}. Supersede it from <a href="/day-end">Day-end</a>.
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Latest statement">
        {data.lastStatement ? (
          <p>
            {data.lastStatement.filename}, statement date {data.lastStatement.statementDate ? fmtDate(data.lastStatement.statementDate) : 'n/a'}, loaded {fmtDateTime(data.lastStatement.at)}.
          </p>
        ) : (
          <Empty>
            No statement has been loaded yet. <a href="/statements">Upload a statement</a>.
          </Empty>
        )}
      </Card>
    </>
  );
}
