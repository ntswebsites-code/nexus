'use client';

import { useState } from 'react';
import { api, newIdempotencyKey, ops, qs } from '@/ops/api';
import { useSession } from '@/ops/session';
import { ActionButton, Card, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

interface BankChange {
  id: string;
  clientName: string;
  clientRef: string;
  bankName: string;
  accountName: string | null;
  accountNumberMasked: string;
  fundName: string | null;
  currency: string | null;
  status: string;
  submittedAt: string;
}

const PENDING = 'Pending verification';
const UNDER = 'Under verification';

export default function BankInstructionsPage() {
  const { can } = useSession();
  const [status, setStatus] = useState(PENDING);
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const rows = useResource<BankChange[]>(() => api.get<BankChange[]>(ops(`/bank-instructions${qs({ status })}`)), [status]);

  return (
    <>
      <PageHeader
        kicker="Counterparties · bank instructions"
        title="LP bank instructions"
        subtitle="An LP change stays pending until someone records the call-back. A different person then activates it. The previous instruction for that fund is superseded."
      />
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {[PENDING, UNDER, 'Active', 'Rejected', 'Superseded'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Card>
        <Loaded res={rows} what="bank instructions">
          {(list) =>
            list.length === 0 ? (
              <Empty>No bank instructions match this filter.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>LP</th>
                      <th>Bank</th>
                      <th>Account</th>
                      <th>Fund</th>
                      <th>Submitted</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.clientName}</strong>
                          <span className="ops-sub">{row.clientRef}</span>
                        </td>
                        <td>
                          {row.bankName}
                          {row.currency && <span className="ops-sub">{row.currency}</span>}
                        </td>
                        <td>
                          {row.accountNumberMasked}
                          {row.accountName && <span className="ops-sub">{row.accountName}</span>}
                        </td>
                        <td>{row.fundName ?? 'All funds'}</td>
                        <td>{formatDateTime(row.submittedAt)}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td>
                          {row.status === PENDING && can('clients.edit') && (
                            <button className="ops-btn small" type="button" onClick={() => setVerifyId(row.id)}>
                              Record call-back
                            </button>
                          )}
                          {row.status === UNDER && can('cash.approve') && (
                            <ActionButton
                              primary
                              label="Activate"
                              confirm="Activate this instruction and supersede the previous one for the same fund?"
                              onRun={(key) => api.post(ops(`/bank-instructions/${encodeURIComponent(row.id)}/approve`), {}, { idempotencyKey: key })}
                              onDone={rows.reload}
                            />
                          )}
                          {(row.status === PENDING || row.status === UNDER) && (can('clients.edit') || can('cash.approve')) && (
                            <button className="ops-btn small" type="button" onClick={() => setRejectId(row.id)}>
                              Reject
                            </button>
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
      {verifyId && (
        <FormModal
          kicker="Call-back"
          title="Record verification call"
          subtitle="Confirm you spoke to a number already on file. You will not be able to activate this instruction yourself."
          submitLabel="Record call-back"
          onClose={() => setVerifyId(null)}
          onDone={rows.reload}
          onSubmit={(fd) =>
            api.post(
              ops(`/bank-instructions/${encodeURIComponent(verifyId)}/verify`),
              { callbackNote: str(fd, 'callbackNote') },
              { idempotencyKey: newIdempotencyKey() },
            )
          }
        >
          <FieldGrid>
            <Field label="What was confirmed" span={2}>
              <textarea className="ops-input" name="callbackNote" required minLength={3} maxLength={500} placeholder="Spoke to the authorised signatory. Account name and bank confirmed." />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {rejectId && (
        <FormModal
          kicker="Reject"
          title="Reject bank instruction"
          subtitle="The LP keeps their current active instruction."
          submitLabel="Reject"
          onClose={() => setRejectId(null)}
          onDone={rows.reload}
          onSubmit={(fd) =>
            api.post(
              ops(`/bank-instructions/${encodeURIComponent(rejectId)}/reject`),
              { reason: str(fd, 'reason') },
              { idempotencyKey: newIdempotencyKey() },
            )
          }
        >
          <FieldGrid>
            <Field label="Reason" span={2}>
              <textarea className="ops-input" name="reason" required minLength={3} maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
