'use client';

import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { useCan } from '@/ops/session';
import type { DayEndPackage } from '@/ops/types';
import { Card, DateText, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, Money, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

export default function CustodianPage() {
  const canReview = useCan('custodian.review');
  const [reviewing, setReviewing] = useState<DayEndPackage | null>(null);
  const subs = useResource<DayEndPackage[]>(() => api.get<DayEndPackage[]>(ops('/custodian/submissions')), []);

  return (
    <>
      <PageHeader
        kicker="Counterparties · J7"
        title="Custodian submissions"
        subtitle="Day-end packages submitted by custodians. Accept a package to release it to reconciliation, or reject it with a note."
      />
      <Card>
        <Loaded res={subs} what="custodian submissions">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No submissions yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Counterparty</th>
                      <th>Account</th>
                      <th>Statement date</th>
                      <th className="r">Closing cash</th>
                      <th className="r">Holdings MV</th>
                      <th className="r">Trades</th>
                      <th>Submitted</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.ref ?? p.id.slice(0, 8)}</strong>
                          {p.sha256 && <span className="ops-sub" title={p.sha256}>sha256 {p.sha256.slice(0, 12)}…</span>}
                        </td>
                        <td>{p.counterpartyName ?? p.counterparty?.name ?? p.counterpartyId}</td>
                        <td>{p.accountRef}</td>
                        <td>
                          <DateText value={p.statementDate} />
                        </td>
                        <td className="r">
                          <Money value={p.closingCash} currency={p.currency} />
                        </td>
                        <td className="r">
                          <Money value={p.holdingsMv} currency={p.currency} />
                        </td>
                        <td className="r">{p.tradeCount}</td>
                        <td>
                          {formatDateTime(p.submittedAt)}
                          {p.submittedByName && <span className="ops-sub">{p.submittedByName}</span>}
                        </td>
                        <td>
                          <StatusBadge status={p.status} />
                          {p.reviewNote && <span className="ops-sub">{p.reviewNote}</span>}
                        </td>
                        <td>
                          {canReview && p.status === 'Received' && (
                            <button className="ops-btn small" type="button" onClick={() => setReviewing(p)}>
                              Review
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
      {reviewing && (
        <FormModal
          kicker={`Day-end package · ${reviewing.ref ?? ''}`}
          title="Review day-end package"
          subtitle={`${reviewing.accountRef} · ${new Date(reviewing.statementDate).toLocaleDateString('en-GB')}`}
          submitLabel="Record decision"
          onClose={() => setReviewing(null)}
          onDone={subs.reload}
          onSubmit={(fd, key) =>
            api.post(
              ops(`/custodian/day-end/${encodeURIComponent(reviewing.id)}/review`),
              { decision: str(fd, 'decision'), note: str(fd, 'note') },
              { idempotencyKey: key },
            )
          }
        >
          <FieldGrid>
            <Field label="Decision" span={2}>
              <select className="ops-input" name="decision" defaultValue="ACCEPT">
                <option value="ACCEPT">Accept</option>
                <option value="REJECT">Reject (exception)</option>
              </select>
            </Field>
            <Field label="Note" span={2}>
              <textarea className="ops-input" name="note" required maxLength={2000} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
