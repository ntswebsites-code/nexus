'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ops, qs } from '@/ops/api';
import { AllocationEditor, type ExplicitAllocation } from '@/ops/AllocationEditor';
import { FundSelect, fundLabel } from '@/ops/lookups';
import { compareDecimals, isDecimal, subDecimals, toScaled } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { Distribution } from '@/ops/types';
import {
  amount,
  Card,
  DateText,
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

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
const DISTRIBUTION_TYPES = ['RETURN_OF_CAPITAL', 'REALISATION_PROCEEDS', 'DIVIDEND', 'INTEREST', 'INCOME', 'OTHER'];

export default function DistributionsPage() {
  const router = useRouter();
  const canCreate = useCan('distributions.create');
  const [fundId, setFundId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const rows = useResource<Distribution[]>(() => api.get<Distribution[]>(ops(`/distributions${qs({ fundId, status })}`)), [fundId, status]);

  return (
    <>
      <PageHeader
        kicker="Fund operations · J3"
        title="Distributions"
        subtitle="Draft a distribution, allocate it to LPs, have a second person approve and issue it, then record each settlement."
        actions={
          canCreate && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New distribution
            </button>
          )
        }
      />
      <div className="ops-filters">
        <Field label="Fund">
          <FundSelect name="fundFilter" allowAll="All funds" onChange={setFundId} />
        </Field>
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Card>
        <Loaded res={rows} what="distributions">
          {(list) =>
            list.length === 0 ? (
              <Empty>No distributions match these filters.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Distribution</th>
                      <th>Fund</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th className="r">Gross</th>
                      <th className="r">Net to LPs</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((d) => (
                      <tr key={d.id} className="clickable" onClick={() => router.push(`/ops/distributions/${encodeURIComponent(d.id)}`)}>
                        <td>
                          <strong>{d.ref ?? d.id.slice(0, 8)}</strong>
                        </td>
                        <td>{fundLabel(d)}</td>
                        <td>
                          <DateText value={d.distributionDate} />
                        </td>
                        <td>{d.type.replace(/_/g, ' ').toLowerCase()}</td>
                        <td className="r">
                          <Money value={d.grossAmount} currency={d.currency} />
                        </td>
                        <td className="r">
                          <Money value={d.netToLps} currency={d.currency} />
                        </td>
                        <td>
                          <StatusBadge status={d.status} />
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
      {creating && (
        <CreateDistributionModal
          onClose={() => setCreating(false)}
          onCreated={(d) => (d?.id ? router.push(`/ops/distributions/${encodeURIComponent(d.id)}`) : rows.reload())}
        />
      )}
    </>
  );
}

function CreateDistributionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (d: Distribution | undefined) => void }) {
  const [fundId, setFundId] = useState('');
  const [method, setMethod] = useState<'PRO_RATA' | 'EXPLICIT'>('PRO_RATA');
  const [gross, setGross] = useState('');
  const [carry, setCarry] = useState('');
  const [adjust, setAdjust] = useState('');
  const [explicit, setExplicit] = useState<{ rows: ExplicitAllocation[]; valid: boolean }>({ rows: [], valid: false });
  const net = isDecimal(gross || 'x') ? subDecimals(subDecimals(gross, carry || '0'), adjust || '0') : '';

  return (
    <FormModal
      wide
      kicker="Distribution · draft"
      title="New distribution"
      subtitle="Saved as a draft. LPs see nothing until a second person approves and it is issued."
      submitLabel="Save draft"
      onClose={onClose}
      disabled={method === 'EXPLICIT' && !explicit.valid}
      onSubmit={async (fd) => {
        const grossAmount = amount(fd, 'grossAmount');
        const carryAmount = amount(fd, 'carryAmount') || '0';
        const adjustmentsAmount = amount(fd, 'adjustmentsAmount') || '0';
        if (![grossAmount, carryAmount, adjustmentsAmount].every(isDecimal)) throw new Error('Amounts must be plain numbers, e.g. 1500000.00');
        if (toScaled(net) <= BigInt(0)) throw new Error('The net amount to LPs must be positive.');
        return api.post<Distribution>(ops('/distributions'), {
          fundId: str(fd, 'fundId'),
          distributionDate: str(fd, 'distributionDate'),
          type: str(fd, 'type'),
          grossAmount,
          carryAmount,
          adjustmentsAmount,
          notes: optStr(fd, 'notes'),
          allocationMethod: method,
          ...(method === 'EXPLICIT' ? { allocations: explicit.rows } : {}),
        });
      }}
      onDone={(r) => onCreated(r as Distribution | undefined)}
    >
      <FieldGrid>
        <Field label="Fund">
          <FundSelect name="fundId" required onChange={setFundId} />
        </Field>
        <Field label="Distribution date">
          <input className="ops-input" type="date" name="distributionDate" required />
        </Field>
        <Field label="Type">
          <select className="ops-input" name="type" defaultValue="RETURN_OF_CAPITAL">
            {DISTRIBUTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gross amount">
          <input className="ops-input" name="grossAmount" inputMode="decimal" required value={gross} onChange={(e) => setGross(e.target.value.replace(/,/g, ''))} />
        </Field>
        <Field label="Carried interest">
          <input className="ops-input" name="carryAmount" inputMode="decimal" value={carry} onChange={(e) => setCarry(e.target.value.replace(/,/g, ''))} placeholder="0" />
        </Field>
        <Field label="Adjustments" hint={net ? `Net to LPs: ${net.replace(/(\.\d{2})\d+$/, '$1')}` : undefined}>
          <input className="ops-input" name="adjustmentsAmount" inputMode="decimal" value={adjust} onChange={(e) => setAdjust(e.target.value.replace(/,/g, ''))} placeholder="0" />
        </Field>
        <Field label="Notes" span={2}>
          <textarea className="ops-input" name="notes" maxLength={4000} />
        </Field>
        <Field label="Allocation method" span={2}>
          <div className="ops-actions">
            <label className="ops-check">
              <input type="radio" checked={method === 'PRO_RATA'} onChange={() => setMethod('PRO_RATA')} /> Pro rata
            </label>
            <label className="ops-check">
              <input type="radio" checked={method === 'EXPLICIT'} onChange={() => setMethod('EXPLICIT')} /> Explicit amounts per LP
            </label>
          </div>
        </Field>
      </FieldGrid>
      {method === 'EXPLICIT' && (
        <div style={{ marginTop: 12 }}>
          {net && compareDecimals(net, '0') > 0 ? (
            <AllocationEditor fundId={fundId} total={net} onChange={(r, valid) => setExplicit({ rows: r, valid })} />
          ) : (
            <p className="ops-muted">Enter the gross amount first; explicit amounts must add up to the net amount to LPs.</p>
          )}
        </div>
      )}
    </FormModal>
  );
}
