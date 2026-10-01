'use client';

import { api } from './api';
import { clientLabel } from './lookups';
import { compareDecimals, formatMoney, isDecimal, subDecimals } from './money';
import type { Evidence, Payment } from './types';
import { amount, Card, DateText, Empty, Field, FieldGrid, FormModal, formatDateTime, Money, optStr, str } from './ui';

interface AllocationLike {
  id: string;
  clientId: string;
  clientName?: string | null;
  lpLegalNameSnapshot?: string | null;
  amountPaid: string;
}

/**
 * Records a receipt (capital call payment) or a settlement (distribution) against one
 * allocation. Step-up and Idempotency-Key are handled by FormModal + the API client.
 */
export function PaymentModal({
  path,
  allocation,
  due,
  currency,
  evidence,
  mode,
  onClose,
  onDone,
}: {
  path: string;
  allocation: AllocationLike;
  due: string;
  currency: string;
  evidence: Evidence[];
  mode: 'payment' | 'settle';
  onClose: () => void;
  onDone: () => void;
}) {
  const outstanding = subDecimals(due, allocation.amountPaid);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <FormModal
      kicker={mode === 'payment' ? 'Capital call · receipt' : 'Distribution · settlement'}
      title={mode === 'payment' ? `Record payment from ${clientLabel(allocation)}` : `Settle distribution to ${clientLabel(allocation)}`}
      subtitle={
        <>
          Outstanding {formatMoney(outstanding, currency)}. You will be asked to confirm with your authenticator.{' '}
          {mode === 'payment' && 'The person who uploaded the proof cannot also record the payment.'}
        </>
      }
      submitLabel={mode === 'payment' ? 'Record payment' : 'Record settlement'}
      onClose={onClose}
      onDone={onDone}
      onSubmit={async (fd, key) => {
        const value = amount(fd, 'amount');
        if (!isDecimal(value) || compareDecimals(value, '0') <= 0) throw new Error('Enter a positive amount, e.g. 125000.00');
        if (compareDecimals(value, outstanding) > 0) throw new Error(`The amount is more than the outstanding ${formatMoney(outstanding, currency)}.`);
        return api.post(
          path,
          { amount: value, paidAt: str(fd, 'paidAt'), reference: str(fd, 'reference'), evidenceId: optStr(fd, 'evidenceId') },
          { idempotencyKey: key },
        );
      }}
    >
      <FieldGrid>
        <Field label="Amount" hint={`Up to ${formatMoney(outstanding, currency)}`}>
          <input className="ops-input" name="amount" inputMode="decimal" required defaultValue={compareDecimals(outstanding, '0') > 0 ? outstanding.replace(/\.?0+$/, '') : ''} />
        </Field>
        <Field label={mode === 'payment' ? 'Value date received' : 'Payment date'}>
          <input className="ops-input" type="date" name="paidAt" required defaultValue={today} />
        </Field>
        <Field label="Bank reference" span={2}>
          <input className="ops-input" name="reference" required maxLength={80} placeholder="Bank statement reference" />
        </Field>
        {mode === 'payment' && (
          <Field label="Proof of payment" span={2} hint={evidence.length ? undefined : 'The LP has not uploaded any proof for this allocation.'}>
            <select className="ops-input" name="evidenceId" defaultValue="">
              <option value="">No evidence linked</option>
              {evidence.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name ?? e.fileName ?? e.id} · {formatDateTime(e.uploadedAt ?? e.createdAt)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </FieldGrid>
    </FormModal>
  );
}

export function PaymentsCard({
  title,
  payments,
  allocations,
  currency,
}: {
  title: string;
  payments: Payment[];
  allocations: AllocationLike[];
  currency: string;
}) {
  const byId = new Map(allocations.map((a) => [a.id, a]));
  return (
    <Card title={title}>
      {payments.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>LP</th>
                <th>Date</th>
                <th>Reference</th>
                <th>Recorded by</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const a = byId.get(p.allocationId);
                return (
                  <tr key={p.id}>
                    <td>{a ? clientLabel(a) : p.allocationId}</td>
                    <td>
                      <DateText value={p.paidAt ?? p.recordedAt} />
                    </td>
                    <td>{p.bankReference ?? p.reference ?? '—'}</td>
                    <td>{p.recordedByName ?? '—'}</td>
                    <td className="r">
                      <Money value={p.amount} currency={currency} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function EvidenceCard({ evidence, allocations }: { evidence: Evidence[]; allocations: AllocationLike[] }) {
  const byId = new Map(allocations.map((a) => [a.id, a]));
  return (
    <Card title="Proof of payment uploaded by LPs">
      {evidence.length === 0 ? (
        <Empty>No proof of payment uploaded yet.</Empty>
      ) : (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>LP</th>
                <th>File</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => {
                const a = e.allocationId ? byId.get(e.allocationId) : undefined;
                const label = e.name ?? e.fileName ?? e.id;
                return (
                  <tr key={e.id}>
                    <td>{a ? clientLabel(a) : '—'}</td>
                    <td>
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noreferrer">
                          {label}
                        </a>
                      ) : (
                        label
                      )}
                    </td>
                    <td>
                      {formatDateTime(e.uploadedAt ?? e.createdAt)}
                      {e.uploadedByName && <span className="ops-sub">{e.uploadedByName}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
