'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ops, qs } from '@/ops/api';
import { AllocationEditor, type ExplicitAllocation } from '@/ops/AllocationEditor';
import { FundSelect, fundLabel } from '@/ops/lookups';
import { isDecimal } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { CapitalCall } from '@/ops/types';
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

export default function CapitalCallsPage() {
  const router = useRouter();
  const canCreate = useCan('capital.create');
  const [fundId, setFundId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const calls = useResource<CapitalCall[]>(() => api.get<CapitalCall[]>(ops(`/capital-calls${qs({ fundId, status })}`)), [fundId, status]);

  return (
    <>
      <PageHeader
        kicker="Fund operations · J3"
        title="Capital calls"
        subtitle="Draft a call, allocate it pro rata to unfunded commitments, have a second person approve and issue it, then record LP payments."
        actions={
          canCreate && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New capital call
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
        <Loaded res={calls} what="capital calls">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No capital calls match these filters.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Call</th>
                      <th>Fund</th>
                      <th>Due</th>
                      <th className="r">Total</th>
                      <th className="r">Paid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => router.push(`/ops-native/capital-calls/${encodeURIComponent(c.id)}`)}>
                        <td>
                          <strong>{c.ref ?? c.id.slice(0, 8)}</strong>
                          {c.callNo != null && <span className="ops-sub">Call no. {c.callNo}</span>}
                        </td>
                        <td>{fundLabel(c)}</td>
                        <td>
                          <DateText value={c.dueDate} />
                        </td>
                        <td className="r">
                          <Money value={c.totalAmount} currency={c.currency} />
                        </td>
                        <td className="r">{c.amountPaid != null ? <Money value={c.amountPaid} currency={c.currency} /> : '—'}</td>
                        <td>
                          <StatusBadge status={c.status} />
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
        <CreateCallModal
          onClose={() => setCreating(false)}
          onCreated={(c) => (c?.id ? router.push(`/ops-native/capital-calls/${encodeURIComponent(c.id)}`) : calls.reload())}
        />
      )}
    </>
  );
}

function CreateCallModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CapitalCall | undefined) => void }) {
  const [fundId, setFundId] = useState('');
  const [method, setMethod] = useState<'PRO_RATA' | 'EXPLICIT'>('PRO_RATA');
  const [total, setTotal] = useState('');
  const [explicit, setExplicit] = useState<{ rows: ExplicitAllocation[]; valid: boolean }>({ rows: [], valid: false });
  const [showWire, setShowWire] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <FormModal
      wide
      kicker="Capital call · draft"
      title="New capital call"
      subtitle="Saved as a draft. Nothing is sent to LPs until a second person approves and the call is issued."
      submitLabel="Save draft"
      onClose={onClose}
      disabled={method === 'EXPLICIT' && !explicit.valid}
      onSubmit={async (fd) => {
        const totalAmount = amount(fd, 'totalAmount');
        if (!isDecimal(totalAmount)) throw new Error('Enter the total amount as a number, e.g. 2500000.00');
        const wire = showWire
          ? {
              bank: optStr(fd, 'wireBank'),
              accountName: optStr(fd, 'wireAccountName'),
              accountNumber: optStr(fd, 'wireAccountNumber'),
              abaRouting: optStr(fd, 'wireRouting'),
              reference: optStr(fd, 'wireReference'),
            }
          : undefined;
        return api.post<CapitalCall>(ops('/capital-calls'), {
          fundId: str(fd, 'fundId'),
          callDate: str(fd, 'callDate'),
          dueDate: str(fd, 'dueDate'),
          purpose: str(fd, 'purpose'),
          totalAmount,
          allocationMethod: method,
          ...(method === 'EXPLICIT' ? { allocations: explicit.rows } : {}),
          ...(wire ? { wire } : {}),
        });
      }}
      onDone={(r) => onCreated(r as CapitalCall | undefined)}
    >
      <FieldGrid>
        <Field label="Fund">
          <FundSelect name="fundId" required onChange={setFundId} />
        </Field>
        <Field label="Total amount" hint="Decimal, in the fund currency">
          <input className="ops-input" name="totalAmount" inputMode="decimal" required value={total} onChange={(e) => setTotal(e.target.value.replace(/,/g, ''))} />
        </Field>
        <Field label="Call date">
          <input className="ops-input" type="date" name="callDate" required defaultValue={today} />
        </Field>
        <Field label="Due date">
          <input className="ops-input" type="date" name="dueDate" required />
        </Field>
        <Field label="Purpose" span={2}>
          <textarea className="ops-input" name="purpose" required maxLength={2000} placeholder="e.g. Follow-on investment in Portfolio Co. and management fees for Q4" />
        </Field>
        <Field label="Allocation method" span={2}>
          <div className="ops-actions">
            <label className="ops-check">
              <input type="radio" name="allocationMethod" checked={method === 'PRO_RATA'} onChange={() => setMethod('PRO_RATA')} /> Pro rata to unfunded commitments
            </label>
            <label className="ops-check">
              <input type="radio" name="allocationMethod" checked={method === 'EXPLICIT'} onChange={() => setMethod('EXPLICIT')} /> Explicit amounts per LP
            </label>
          </div>
        </Field>
      </FieldGrid>
      {method === 'EXPLICIT' && (
        <div style={{ marginTop: 12 }}>
          <AllocationEditor fundId={fundId} total={total} onChange={(rows, valid) => setExplicit({ rows, valid })} />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <label className="ops-check">
          <input type="checkbox" checked={showWire} onChange={(e) => setShowWire(e.target.checked)} /> Override the fund&apos;s default wire instructions
        </label>
        {showWire && (
          <div style={{ marginTop: 10 }}>
            <FieldGrid>
              <Field label="Bank">
                <input className="ops-input" name="wireBank" />
              </Field>
              <Field label="Account name">
                <input className="ops-input" name="wireAccountName" />
              </Field>
              <Field label="Account number">
                <input className="ops-input" name="wireAccountNumber" autoComplete="off" />
              </Field>
              <Field label="Routing / SWIFT">
                <input className="ops-input" name="wireRouting" />
              </Field>
              <Field label="Payment reference" span={2}>
                <input className="ops-input" name="wireReference" />
              </Field>
            </FieldGrid>
          </div>
        )}
      </div>
    </FormModal>
  );
}
