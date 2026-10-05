'use client';

import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { useCan } from '@/ops/session';
import type { DayEndPackage } from '@/ops/types';
import { Card, DateText, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, Money, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

interface CounterpartyOption {
  id: string;
  ref: string;
  name: string;
}

interface SubmissionPayload {
  dayEnds?: DayEndPackage[];
}

export default function CustodianPage() {
  const canReview = useCan('custodian.review');
  const [reviewing, setReviewing] = useState<DayEndPackage | null>(null);
  const [inviting, setInviting] = useState(false);
  const subs = useResource<DayEndPackage[]>(async () => {
    const payload = await api.get<SubmissionPayload | DayEndPackage[]>(ops('/custodian/submissions'));
    const dayEnds = Array.isArray(payload) ? payload : payload.dayEnds ?? [];
    return dayEnds.map((p) => ({
      ...p,
      counterpartyName: p.counterpartyName ?? p.counterparty?.name ?? null,
    }));
  }, []);
  const parties = useResource<CounterpartyOption[]>(async () => {
    const payload = await api.get<{ items?: CounterpartyOption[] } | CounterpartyOption[]>(ops('/custodian/counterparties'));
    return Array.isArray(payload) ? payload : payload.items ?? [];
  }, []);

  return (
    <>
      <PageHeader
        kicker="Counterparties · J7"
        title="Custodian submissions"
        subtitle="Day-end packages submitted by custodians. Accept a package the counterparty has approved, or invite a user for a counterparty."
        actions={
          canReview && (
            <button className="ops-btn primary" type="button" onClick={() => setInviting(true)}>
              Invite user
            </button>
          )
        }
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
                        <td className="r">
                          {p.tradeCount}
                          {typeof (p as { executionsReceived?: number }).executionsReceived === 'number' && (
                            <span className="ops-sub">{(p as { executionsReceived?: number }).executionsReceived} executions received</span>
                          )}
                        </td>
                        <td>
                          {formatDateTime(p.submittedAt)}
                          {p.submittedByName && <span className="ops-sub">{p.submittedByName}</span>}
                        </td>
                        <td>
                          <StatusBadge status={p.status} />
                          {p.reviewNote && <span className="ops-sub">{p.reviewNote}</span>}
                        </td>
                        <td>
                          {canReview && p.status === 'Approved' && (
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
            <Field label="Note" span={2} hint="Required when rejecting">
              <textarea className="ops-input" name="note" maxLength={2000} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {inviting && (
        <FormModal
          kicker="Custodian access"
          title="Invite a counterparty user"
          subtitle="They accept the invitation, set a password, and enrol an authenticator before submitting."
          submitLabel="Send invitation"
          onClose={() => setInviting(false)}
          onSubmit={(fd, key) =>
            api.post(
              ops('/custodian/users'),
              { counterpartyId: str(fd, 'counterpartyId'), email: str(fd, 'email'), name: str(fd, 'name') || undefined, role: str(fd, 'role') },
              { idempotencyKey: key },
            )
          }
        >
          <FieldGrid>
            <Field label="Counterparty" span={2}>
              <select className="ops-input" name="counterpartyId" required defaultValue="">
                <option value="" disabled>
                  Select
                </option>
                {(parties.state === 'ok' ? parties.data : []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.ref})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input className="ops-input" name="name" maxLength={120} />
            </Field>
            <Field label="Work email">
              <input className="ops-input" name="email" type="email" required />
            </Field>
            <Field label="Role" span={2}>
              <select className="ops-input" name="role" defaultValue="submitter">
                <option value="submitter">Submitter</option>
                <option value="approver">Approver</option>
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
