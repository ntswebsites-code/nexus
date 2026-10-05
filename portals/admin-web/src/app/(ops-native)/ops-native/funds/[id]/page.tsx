'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { FundFields, fundPayload } from '@/ops/FundForm';
import { ClientSelect, clientLabel } from '@/ops/lookups';
import { isDecimal, sumDecimals } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { Fund, FundCommitment } from '@/ops/types';
import {
  amount,
  Card,
  DateText,
  DefinitionList,
  Empty,
  Field,
  FieldGrid,
  FormModal,
  Loaded,
  Money,
  optStr,
  PageHeader,
  StatusBadge,
  str,
  useResource,
} from '@/ops/ui';

export default function FundDetailPage() {
  const { id } = useParams<{ id: string }>();
  const fund = useResource<Fund>(() => api.get<Fund>(ops(`/funds/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops-native/funds">← Funds</Link>
      </p>
      <Loaded res={fund} what="this fund">
        {(f) => <FundDetail fund={f} reload={fund.reload} />}
      </Loaded>
    </>
  );
}

function FundDetail({ fund, reload }: { fund: Fund; reload: () => void }) {
  const canManage = useCan('funds.manage');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [restating, setRestating] = useState(false);
  const [editingCommitment, setEditingCommitment] = useState<FundCommitment | null>(null);
  const commitments = fund.commitments ?? [];
  const active = commitments.filter((c) => c.status !== 'CLOSED');

  return (
    <>
      <PageHeader
        kicker={`Fund · ${fund.ref ?? fund.shortName}`}
        title={
          <>
            {fund.name} <StatusBadge status={fund.status ?? 'Active'} />
          </>
        }
        subtitle={fund.operatingModel === 'OPEN_ENDED' ? 'Open-ended fund' : 'Private capital fund'}
        actions={
          canManage && (
            <>
              <button className="ops-btn" type="button" onClick={() => setEditing(true)}>
                Edit fund
              </button>
              {(fund.valuationStatus === 'FINAL' || fund.valuationStatus === 'RESTATED') && (
                <button className="ops-btn" type="button" onClick={() => setRestating(true)}>
                  Restate valuation
                </button>
              )}
              <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>
                Add commitment
              </button>
            </>
          )
        }
      />
      <Card title="Fund master">
        <DefinitionList
          items={[
            ['Short name', fund.shortName],
            ['Currency', fund.currency],
            ['Vintage', fund.vintage ?? '—'],
            ['Public reference', fund.publicReference ?? '—'],
            ['Default share class', fund.defaultShareClass ?? '—'],
            ['LP portal', fund.portalVisible === false ? 'Hidden' : 'Visible'],
            ['NAV per unit', fund.navPerUnit ?? '—'],
            ['Total NAV', fund.totalNav != null ? <Money key="nav" value={fund.totalNav} currency={fund.currency} /> : '—'],
            ['Valuation', fund.valuationStatus ?? '—'],
            ['As of', <DateText key="asof" value={fund.asOfDate} />],
          ]}
        />
      </Card>
      <Card title={`Commitments (${commitments.length})`}>
        {commitments.length === 0 ? (
          <Empty>No commitments yet. Capital calls are allocated against active commitments.</Empty>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>LP</th>
                  <th>Account ref</th>
                  <th>Effective</th>
                  <th className="r">Commitment</th>
                  <th className="r">Called</th>
                  <th className="r">Unfunded</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {commitments.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {clientLabel(c)}
                      {(c.clientRef ?? c.client?.ref) && <span className="ops-sub">{c.clientRef ?? c.client?.ref}</span>}
                    </td>
                    <td>{c.investorAccountRef ?? '—'}</td>
                    <td>
                      <DateText value={c.effectiveDate} />
                    </td>
                    <td className="r">
                      <Money value={c.commitmentAmount} currency={c.currency} />
                    </td>
                    <td className="r">{c.calledToDate != null ? <Money value={c.calledToDate} currency={c.currency} /> : '—'}</td>
                    <td className="r">{c.unfunded != null ? <Money value={c.unfunded} currency={c.currency} /> : '—'}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      {canManage && (
                        <button className="ops-btn small" type="button" onClick={() => setEditingCommitment(c)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Active commitments</td>
                  <td className="r">
                    <Money value={sumDecimals(active.map((c) => c.commitmentAmount))} currency={fund.currency} />
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <FormModal
          kicker="Fund master"
          title={`Edit ${fund.shortName}`}
          submitLabel="Save changes"
          onClose={() => setEditing(false)}
          onDone={reload}
          onSubmit={(fd, key) =>
            api.patch(ops(`/funds/${encodeURIComponent(fund.id)}`), { ...fundPayload(fd), version: fund.version }, { idempotencyKey: key })
          }
        >
          <FundFields fund={fund} />
        </FormModal>
      )}
      {restating && (
        <FormModal
          kicker={`Valuation · ${fund.shortName}`}
          title="Restate valuation"
          submitLabel="Restate"
          onClose={() => setRestating(false)}
          onDone={reload}
          onSubmit={(fd, key) => {
            const reason = str(fd, 'reason');
            if (reason.trim().length < 10) throw new Error('Give a reason of at least 10 characters.');
            return api.post(
              ops(`/funds/${encodeURIComponent(fund.id)}/restate`),
              { reason, navPerUnit: optStr(fd, 'navPerUnit'), totalNav: optStr(fd, 'totalNav'), asOfDate: optStr(fd, 'asOfDate'), version: fund.version },
              { idempotencyKey: key },
            );
          }}
        >
          <p>Investors see the valuation labelled RESTATED and are notified with your reason. A restatement is audited and cannot return to an estimate.</p>
          <FieldGrid>
            <Field label="Reason" span={2}>
              <textarea className="ops-input" name="reason" rows={3} required minLength={10} maxLength={500} />
            </Field>
            <Field label="Restated NAV per unit (optional)">
              <input className="ops-input" name="navPerUnit" inputMode="decimal" />
            </Field>
            <Field label="Restated total NAV (optional)">
              <input className="ops-input" name="totalNav" inputMode="decimal" />
            </Field>
            <Field label="As of (optional)">
              <input className="ops-input" name="asOfDate" type="date" />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {adding && (
        <FormModal
          kicker={`Commitment · ${fund.shortName}`}
          title="Add commitment"
          submitLabel="Add commitment"
          onClose={() => setAdding(false)}
          onDone={reload}
          onSubmit={(fd, key) => {
            const value = amount(fd, 'commitmentAmount');
            if (!isDecimal(value)) throw new Error('Enter the commitment as a number, e.g. 10000000.00');
            return api.post(
              ops(`/funds/${encodeURIComponent(fund.id)}/commitments`),
              {
                clientId: str(fd, 'clientId'),
                commitmentAmount: value,
                currency: optStr(fd, 'currency')?.toUpperCase(),
                effectiveDate: optStr(fd, 'effectiveDate'),
                investorAccountRef: optStr(fd, 'investorAccountRef'),
                status: str(fd, 'status'),
              },
              { idempotencyKey: key },
            );
          }}
        >
          <FieldGrid>
            <Field label="Client (LP)" span={2}>
              <ClientSelect name="clientId" required />
            </Field>
            <Field label="Commitment amount">
              <input className="ops-input" name="commitmentAmount" inputMode="decimal" required />
            </Field>
            <Field label="Currency">
              <input className="ops-input" name="currency" maxLength={3} defaultValue={fund.currency} />
            </Field>
            <Field label="Effective date">
              <input className="ops-input" type="date" name="effectiveDate" />
            </Field>
            <Field label="Investor account ref">
              <input className="ops-input" name="investorAccountRef" maxLength={64} />
            </Field>
            <Field label="Status">
              <select className="ops-input" name="status" defaultValue="ACTIVE">
                <option value="ACTIVE">Active</option>
                <option value="PENDING">Pending</option>
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {editingCommitment && (
        <FormModal
          kicker={`Commitment · ${clientLabel(editingCommitment)}`}
          title="Edit commitment"
          submitLabel="Save changes"
          onClose={() => setEditingCommitment(null)}
          onDone={reload}
          onSubmit={(fd, key) => {
            const value = amount(fd, 'commitmentAmount');
            if (!isDecimal(value)) throw new Error('Enter the commitment as a number, e.g. 10000000.00');
            return api.patch(
              ops(`/commitments/${encodeURIComponent(editingCommitment.id)}`),
              {
                commitmentAmount: value,
                effectiveDate: optStr(fd, 'effectiveDate'),
                investorAccountRef: optStr(fd, 'investorAccountRef'),
                status: str(fd, 'status'),
                version: editingCommitment.version,
              },
              { idempotencyKey: key },
            );
          }}
        >
          <FieldGrid>
            <Field label="Commitment amount">
              <input className="ops-input" name="commitmentAmount" inputMode="decimal" required defaultValue={editingCommitment.commitmentAmount} />
            </Field>
            <Field label="Effective date">
              <input className="ops-input" type="date" name="effectiveDate" defaultValue={editingCommitment.effectiveDate?.slice(0, 10) ?? ''} />
            </Field>
            <Field label="Investor account ref">
              <input className="ops-input" name="investorAccountRef" maxLength={64} defaultValue={editingCommitment.investorAccountRef ?? ''} />
            </Field>
            <Field label="Status">
              <select className="ops-input" name="status" defaultValue={editingCommitment.status}>
                <option value="ACTIVE">Active</option>
                <option value="PENDING">Pending</option>
                <option value="CLOSED">Closed</option>
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
