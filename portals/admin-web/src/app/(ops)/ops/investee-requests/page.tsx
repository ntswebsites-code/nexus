'use client';

import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { CompanySelect } from '@/ops/lookups';
import { useSession } from '@/ops/session';
import { ActionButton, Card, Empty, Field, FieldGrid, FormModal, Loaded, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

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
  hoursPending?: number | null;
  slaBreached?: boolean;
  poRef?: string | null;
}

interface Tranche {
  currency: string;
  configured: boolean;
  source: string;
  committed: number;
  reserved: number;
  available: number;
  approvedThisQuarter: number;
  totalApproved: number;
}

interface GovernanceConsent {
  id: string;
  companyId: string;
  companyName: string;
  companyRef: string;
  title: string;
  basis: string;
  submitted: string;
  due: string;
  owner: string;
  status: string;
  note: string;
}

type DecisionStatus = 'APPROVED' | 'REJECTED' | 'FULFILLED' | 'RFQ_SENT';

function money(currency: string, amount: number) {
  return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount || 0)}`;
}

/** FR-CMP-035, BR-270: committed, reserved, available and approved figures for one company's investment tranche. */
function TranchePanel() {
  const { can } = useSession();
  const [companyId, setCompanyId] = useState('');
  const [editing, setEditing] = useState(false);
  const ledger = useResource<Tranche | null>(
    () => (companyId ? api.get<Tranche>(ops(`/investee-requests/tranche/${encodeURIComponent(companyId)}`)) : Promise.resolve(null)),
    [companyId],
  );
  return (
    <Card title="Investment tranche">
      <div onChange={(e) => setCompanyId((e.target as unknown as HTMLSelectElement).value)}>
        <CompanySelect name="trancheCompany" />
      </div>
      {!companyId && <Empty>Select a company to see its committed, reserved and available tranche.</Empty>}
      {companyId && (
        <Loaded res={ledger} what="the tranche">
          {(t) =>
            t && (
              <>
                <dl className="ops-dl">
                  <dt>Committed</dt>
                  <dd>{money(t.currency, t.committed)}</dd>
                  <dt>Reserved</dt>
                  <dd>{money(t.currency, t.reserved)}</dd>
                  <dt>Available</dt>
                  <dd>{money(t.currency, t.available)}</dd>
                  <dt>Approved this quarter</dt>
                  <dd>{money(t.currency, t.approvedThisQuarter)}</dd>
                  <dt>Approved to date</dt>
                  <dd>{money(t.currency, t.totalApproved)}</dd>
                </dl>
                {!t.configured && <p className="ops-muted">No tranche is on record, so over-draw is not checked for this company. Set the committed amount to switch the control on.</p>}
                {t.source === 'term_sheets' && t.configured && <p className="ops-muted">Committed is the total of executed term sheets. Set an amount to override it.</p>}
                {can('research.edit') && (
                  <button className="ops-btn" type="button" onClick={() => setEditing(true)}>
                    Set committed amount
                  </button>
                )}
                {editing && (
                  <FormModal
                    kicker="Investment tranche"
                    title="Set committed amount"
                    subtitle="Requests above the available amount are refused with the standard over-draw message."
                    submitLabel="Save"
                    onClose={() => setEditing(false)}
                    onSubmit={(fd, key) => {
                      const value = Number(str(fd, 'amount').replace(/,/g, ''));
                      if (!Number.isFinite(value) || value < 0) throw new Error('Enter an amount of zero or more.');
                      return api.put(ops(`/investee-requests/tranche/${encodeURIComponent(companyId)}`), { totalCommittedAmount: value }, { idempotencyKey: key });
                    }}
                    onDone={() => {
                      setEditing(false);
                      ledger.reload();
                    }}
                  >
                    <FieldGrid>
                      <Field label={`Total committed (${t.currency})`}>
                        <input className="ops-input" name="amount" inputMode="decimal" required defaultValue={String(t.committed)} />
                      </Field>
                    </FieldGrid>
                  </FormModal>
                )}
              </>
            )
          }
        </Loaded>
      )}
    </Card>
  );
}

/** Asks for the text a decision needs (a return reason, a purchase order reference), then posts it. */
function DecisionModal({ row, mode, onClose, onDone }: { row: InvesteeRequest; mode: 'RETURNED' | 'CONVERTED_TO_PO'; onClose: () => void; onDone: () => void }) {
  const returning = mode === 'RETURNED';
  return (
    <FormModal
      kicker={row.title}
      title={returning ? 'Return to the company' : 'Convert to purchase order'}
      subtitle={returning ? 'The company is told what to change and can resubmit once the request differs from this version.' : 'Record the purchase order raised from the RFQ.'}
      submitLabel={returning ? 'Return' : 'Convert'}
      onClose={onClose}
      onSubmit={(fd, key) =>
        api.post(
          ops(`/investee-requests/${encodeURIComponent(row.companyId)}/${encodeURIComponent(row.id)}/decide`),
          returning ? { status: mode, note: str(fd, 'note') } : { status: mode, poRef: str(fd, 'poRef') },
          { idempotencyKey: key },
        )
      }
      onDone={onDone}
    >
      <FieldGrid>
        {returning ? (
          <Field label="Reason" span={2}>
            <textarea className="ops-input" name="note" rows={3} required maxLength={2000} />
          </Field>
        ) : (
          <Field label="Purchase order reference">
            <input className="ops-input" name="poRef" required maxLength={40} />
          </Field>
        )}
      </FieldGrid>
    </FormModal>
  );
}

export default function InvesteeRequestsPage() {
  const { can } = useSession();
  const [modal, setModal] = useState<null | { row: InvesteeRequest; mode: 'RETURNED' | 'CONVERTED_TO_PO' }>(null);
  const rows = useResource<InvesteeRequest[]>(() => api.get<InvesteeRequest[]>(ops('/investee-requests')), []);
  const consents = useResource<GovernanceConsent[]>(() => api.get<GovernanceConsent[]>(ops('/investee-requests/consents')), []);
  const decide = (row: InvesteeRequest, status: DecisionStatus) => (key: string) =>
    api.post(ops(`/investee-requests/${encodeURIComponent(row.companyId)}/${encodeURIComponent(row.id)}/decide`), { status }, { idempotencyKey: key });
  const decideConsent = (row: GovernanceConsent, status: 'Approved' | 'Declined') => (key: string) =>
    api.post(ops(`/investee-requests/consents/${encodeURIComponent(row.companyId)}/${encodeURIComponent(row.id)}/decide`), { status }, { idempotencyKey: key });

  return (
    <>
      <PageHeader
        kicker="Portfolio companies"
        title="Capital and procurement requests"
        subtitle="Companies submit a capital or procurement request, and a governance consent, from the investee portal. Record the decision here. Neither action moves cash."
      />
      {modal && (
        <DecisionModal
          row={modal.row}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            rows.reload();
          }}
        />
      )}
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
                          {row.slaBreached && <span className="ops-sub ops-error-text">{`Waiting ${row.hoursPending ?? 48}h, past the 48 hour SLA`}</span>}
                          {row.poRef && <span className="ops-sub">{`PO ${row.poRef}`}</span>}
                        </td>
                        <td>
                          {can('research.edit') && row.status === 'SUBMITTED' && (
                            <>
                              <ActionButton primary label="Approve" confirm={`Approve ${row.title}?`} onRun={decide(row, 'APPROVED')} onDone={rows.reload} />
                              <ActionButton label="Reject" confirm={`Reject ${row.title}?`} onRun={decide(row, 'REJECTED')} onDone={rows.reload} />
                              <button className="ops-btn" type="button" onClick={() => setModal({ row, mode: 'RETURNED' })}>
                                Return
                              </button>
                            </>
                          )}
                          {can('research.edit') && row.status === 'APPROVED' && (
                            <>
                              <ActionButton label="Send RFQ" confirm={`Record the RFQ for ${row.title} as sent?`} onRun={decide(row, 'RFQ_SENT')} onDone={rows.reload} />
                              <ActionButton primary label="Mark fulfilled" confirm={`Mark ${row.title} fulfilled?`} onRun={decide(row, 'FULFILLED')} onDone={rows.reload} />
                            </>
                          )}
                          {can('research.edit') && row.status === 'RFQ_SENT' && (
                            <button className="ops-btn primary" type="button" onClick={() => setModal({ row, mode: 'CONVERTED_TO_PO' })}>
                              Convert to PO
                            </button>
                          )}
                          {can('research.edit') && row.status === 'CONVERTED_TO_PO' && (
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
      <TranchePanel />
      <Card title="Governance consents">
        <Loaded res={consents} what="consents">
          {(list) =>
            list.length === 0 ? (
              <Empty>No consent requests yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Matter</th>
                      <th>Due</th>
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
                            {row.basis} · {row.owner}
                          </span>
                        </td>
                        <td>{row.due || '—'}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td>
                          {can('research.edit') && row.status === 'Investor review' && (
                            <>
                              <ActionButton primary label="Approve" confirm={`Approve ${row.title}?`} onRun={decideConsent(row, 'Approved')} onDone={consents.reload} />
                              <ActionButton label="Decline" confirm={`Decline ${row.title}?`} onRun={decideConsent(row, 'Declined')} onDone={consents.reload} />
                            </>
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
