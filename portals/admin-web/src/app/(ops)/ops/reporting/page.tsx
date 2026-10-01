'use client';

import { useState } from 'react';
import { api, qs } from '@/ops/api';
import { CompanySelect } from '@/ops/lookups';
import { useCan } from '@/ops/session';
import { ActionButton, Card, Empty, Field, FieldGrid, FormModal, Loaded, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

interface PackItem {
  id: string;
  title: string;
  status: string;
  files: { id: string; name: string; status: string }[];
}

interface ReportingPack {
  id: string;
  uuid: string;
  label: string;
  due: string;
  status: string;
  submittedAt?: string | null;
  reviewNote?: string | null;
  company: { id: string; name: string };
  items?: PackItem[];
}

const STATUSES = ['submitted', 'open', 'returned', 'accepted', 'all'];

export default function ReportingPacksPage() {
  const canReview = useCan('research.edit');
  const [status, setStatus] = useState('submitted');
  const [opening, setOpening] = useState(false);
  const [returning, setReturning] = useState<ReportingPack | null>(null);
  const packs = useResource<ReportingPack[]>(
    () => api.get<ReportingPack[]>(`/api/v1/private-markets/reporting-packs${qs({ status })}`),
    [status],
  );

  return (
    <>
      <PageHeader
        kicker="Portfolio companies · J5"
        title="Reporting packs"
        subtitle="Open a period for a company, then accept or return the pack once they submit it. The reviewer is not the person who submitted."
        actions={
          canReview && (
            <button className="ops-btn primary" type="button" onClick={() => setOpening(true)}>
              Open period
            </button>
          )
        }
      />
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Card>
        <Loaded res={packs} what="reporting packs">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No reporting packs match this status.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Period</th>
                      <th>Due</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.uuid}>
                        <td>
                          <strong>{row.company.name}</strong>
                          <span className="ops-sub">{row.company.id}</span>
                        </td>
                        <td>
                          {row.label}
                          <span className="ops-sub">{row.id}</span>
                        </td>
                        <td>{row.due}</td>
                        <td>{row.items?.length ?? '—'}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td>
                          {canReview && row.status === 'submitted' && (
                            <div className="ops-actions">
                              <ActionButton
                                primary
                                label="Accept"
                                confirm={`Accept the ${row.label} pack from ${row.company.name}?`}
                                onRun={(key) => api.post(`/api/v1/private-markets/reporting-packs/${encodeURIComponent(row.uuid)}/accept`, {}, { idempotencyKey: key })}
                                onDone={packs.reload}
                              />
                              <button className="ops-btn" type="button" onClick={() => setReturning(row)}>
                                Return
                              </button>
                            </div>
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
      {opening && (
        <FormModal
          kicker="Reporting · open period"
          title="Open a reporting period"
          subtitle="The company sees the request and can submit the pack. Opening a period does not accept it."
          submitLabel="Open period"
          onClose={() => setOpening(false)}
          onDone={() => packs.reload()}
          onSubmit={async (fd) =>
            api.post(`/api/v1/private-markets/companies/${encodeURIComponent(str(fd, 'company'))}/periods`, {
              period: str(fd, 'period'),
              due: str(fd, 'due'),
            })
          }
        >
          <FieldGrid>
            <Field label="Company" span={2}>
              <CompanySelect name="company" required />
            </Field>
            <Field label="Period" hint="YYYY-MM">
              <input className="ops-input" name="period" required pattern="\d{4}-(0[1-9]|1[0-2])" placeholder="2026-10" />
            </Field>
            <Field label="Due date">
              <input className="ops-input" type="date" name="due" required />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {returning && (
        <FormModal
          kicker="Reporting · return"
          title={`Return ${returning.label}`}
          subtitle={`${returning.company.name} will see this note and can submit again.`}
          submitLabel="Return pack"
          danger
          onClose={() => setReturning(null)}
          onDone={() => packs.reload()}
          onSubmit={async (fd) =>
            api.post(`/api/v1/private-markets/reporting-packs/${encodeURIComponent(returning.uuid)}/return`, { note: str(fd, 'note') })
          }
        >
          <Field label="What needs to change" span={2}>
            <textarea className="ops-input" name="note" required minLength={3} maxLength={5000} placeholder="The cash-flow statement does not match the bank balance." />
          </Field>
        </FormModal>
      )}
    </>
  );
}
