'use client';

import { api, ops } from '@/ops/api';
import { useSession } from '@/ops/session';
import { ActionButton, Card, Empty, Loaded, PageHeader, StatusBadge, useResource } from '@/ops/ui';

interface InvesteeRequest {
  id: string;
  companyId: string;
  companyName: string;
  companyRef: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  sourcingCategory: string;
  currency: string;
  estimatedAmount: number;
  needBy: string;
  createdByName: string;
  note: string;
}

function money(currency: string, amount: number) {
  return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount || 0)}`;
}

export default function InvesteeRequestsPage() {
  const { can } = useSession();
  const rows = useResource<InvesteeRequest[]>(() => api.get<InvesteeRequest[]>(ops('/investee-requests')), []);
  const decide = (row: InvesteeRequest, status: 'APPROVED' | 'REJECTED' | 'FULFILLED') => (key: string) =>
    api.post(ops(`/investee-requests/${encodeURIComponent(row.companyId)}/${encodeURIComponent(row.id)}/decide`), { status }, { idempotencyKey: key });

  return (
    <>
      <PageHeader
        kicker="Portfolio companies"
        title="Capital and procurement requests"
        subtitle="Companies submit a request from the investee portal. Approve it, reject it, or mark an approved request fulfilled. This records the decision and does not move cash."
      />
      <Card>
        <Loaded res={rows} what="requests">
          {(list) =>
            list.length === 0 ? (
              <Empty>No company requests yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Request</th>
                      <th>Amount</th>
                      <th>Need by</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => (
                      <tr key={`${row.companyId}-${row.id}`}>
                        <td>
                          <strong>{row.companyName}</strong>
                          <span className="ops-sub">{row.companyRef}</span>
                        </td>
                        <td>
                          <strong>{row.title}</strong>
                          <span className="ops-sub">
                            {row.sourcingCategory} · {row.priority} · {row.createdByName}
                          </span>
                        </td>
                        <td>{money(row.currency, row.estimatedAmount)}</td>
                        <td>{row.needBy || '—'}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td>
                          {can('research.edit') && row.status === 'SUBMITTED' && (
                            <>
                              <ActionButton primary label="Approve" confirm={`Approve ${row.title}?`} onRun={decide(row, 'APPROVED')} onDone={rows.reload} />
                              <ActionButton label="Reject" confirm={`Reject ${row.title}?`} onRun={decide(row, 'REJECTED')} onDone={rows.reload} />
                            </>
                          )}
                          {can('research.edit') && row.status === 'APPROVED' && (
                            <ActionButton primary label="Mark fulfilled" confirm={`Mark ${row.title} fulfilled?`} onRun={decide(row, 'FULFILLED')} onDone={rows.reload} />
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
    </>
  );
}
