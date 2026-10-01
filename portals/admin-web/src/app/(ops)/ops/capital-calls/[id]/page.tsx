'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { clientLabel, fundLabel } from '@/ops/lookups';
import { subDecimals, sumDecimals } from '@/ops/money';
import { useSession } from '@/ops/session';
import { EvidenceCard, PaymentModal, PaymentsCard } from '@/ops/settlement';
import type { CallAllocation, CapitalCall, Evidence, Payment } from '@/ops/types';
import {
  ActionButton,
  Alert,
  Card,
  DateText,
  DefinitionList,
  Empty,
  Field,
  FormModal,
  formatDateTime,
  Loaded,
  Money,
  PageHeader,
  StatusBadge,
  str,
  useResource,
} from '@/ops/ui';

export default function CapitalCallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const call = useResource<CapitalCall>(() => api.get<CapitalCall>(ops(`/capital-calls/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/capital-calls">← Capital calls</Link>
      </p>
      <Loaded res={call} what="this capital call">
        {(c) => <CallDetail call={c} reload={call.reload} />}
      </Loaded>
    </>
  );
}

function CallDetail({ call, reload }: { call: CapitalCall; reload: () => void }) {
  const { user, can } = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState<CallAllocation | null>(null);
  const base = ops(`/capital-calls/${encodeURIComponent(call.id)}`);
  const allocations = call.allocations ?? [];
  const payments: Payment[] = call.payments ?? allocations.flatMap((a) => a.payments ?? []);
  const evidence: Evidence[] = call.evidence ?? allocations.flatMap((a) => (a.evidence ?? []).map((e) => ({ allocationId: a.id, ...e })));
  const status = call.status;
  const isMaker = !!call.makerId && call.makerId === user.id;
  const settleable = status === 'ISSUED' || status === 'PARTIALLY_PAID';
  const cancellable = status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'APPROVED';
  const totalPaid = call.amountPaid ?? sumDecimals(allocations.map((a) => a.amountPaid));

  return (
    <>
      <PageHeader
        kicker={`Capital call · ${fundLabel(call)}`}
        title={
          <>
            {call.ref ?? 'Capital call'} {call.callNo != null && <span className="ops-muted">· call no. {call.callNo}</span>} <StatusBadge status={status} />
          </>
        }
        subtitle={call.purpose}
        actions={
          <>
            {status === 'DRAFT' && can('capital.create') && (
              <ActionButton primary label="Submit for approval" onRun={(key) => api.post(`${base}/submit`, {}, { idempotencyKey: key })} onDone={reload} />
            )}
            {status === 'PENDING_APPROVAL' && can('capital.approve') && (
              <>
                <ActionButton
                  primary
                  label="Approve"
                  disabled={isMaker}
                  title={isMaker ? 'You prepared this call. A different approver is required.' : 'Requires a fresh authenticator code'}
                  onRun={(key) => api.post(`${base}/approve`, {}, { idempotencyKey: key })}
                  onDone={reload}
                />
                <button className="ops-btn danger" type="button" onClick={() => setRejecting(true)}>
                  Reject
                </button>
              </>
            )}
            {status === 'APPROVED' && can('capital.create') && (
              <ActionButton
                primary
                label="Issue to LPs"
                confirm="Issue this call? Every allocated LP will see it in their portal and be notified."
                onRun={(key) => api.post(`${base}/issue`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {cancellable && can('capital.create', 'capital.approve') && (
              <button className="ops-btn danger" type="button" onClick={() => setCancelling(true)}>
                Cancel call
              </button>
            )}
          </>
        }
      />

      {status === 'PENDING_APPROVAL' && isMaker && (
        <Alert kind="info">You prepared this call. A different approver is required — ask a colleague with approval rights to review it.</Alert>
      )}
      {call.rejectionReason && status === 'DRAFT' && <Alert kind="warn">Returned by the approver: {call.rejectionReason}</Alert>}
      {status === 'CANCELLED' && <Alert kind="warn">Cancelled{call.cancelReason ? `: ${call.cancelReason}` : ''}.</Alert>}

      <Card title="Call details">
        <DefinitionList
          items={[
            ['Fund', fundLabel(call)],
            ['Total amount', <Money key="t" value={call.totalAmount} currency={call.currency} />],
            ['Paid to date', <Money key="p" value={totalPaid} currency={call.currency} />],
            ['Outstanding', <Money key="o" value={subDecimals(call.totalAmount, totalPaid)} currency={call.currency} />],
            ['Call date', <DateText key="cd" value={call.callDate ?? call.transactionDate ?? call.createdAt} />],
            ['Due date', <DateText key="dd" value={call.dueDate} />],
            ['Allocation', call.allocationMethod ? call.allocationMethod.replace('_', ' ').toLowerCase() : '—'],
            ['Prepared by', call.makerName ?? (isMaker ? 'You' : call.makerId ?? '—')],
            ['Approved by', call.checkerName ?? (call.checkerId ? (call.checkerId === user.id ? 'You' : call.checkerId) : '—')],
            ['Approved', formatDateTime(call.approvedAt)],
            ['Issued', formatDateTime(call.issuedAt)],
          ]}
        />
      </Card>

      <Card title={`Allocations (${allocations.length})`}>
        {allocations.length === 0 ? (
          <Empty>No allocations yet.</Empty>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>LP</th>
                  <th className="r">Commitment</th>
                  <th className="r">Unfunded before</th>
                  <th className="r">Call amount</th>
                  <th className="r">Paid</th>
                  <th className="r">Outstanding</th>
                  <th>Status</th>
                  <th>Acknowledged</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => {
                  const proofs = evidence.filter((e) => e.allocationId === a.id).length;
                  const open = a.status !== 'PAID' && a.status !== 'CANCELLED';
                  return (
                    <tr key={a.id}>
                      <td>
                        {clientLabel(a)}
                        {proofs > 0 && <span className="ops-sub">{proofs} proof{proofs > 1 ? 's' : ''} of payment</span>}
                      </td>
                      <td className="r">
                        <Money value={a.totalCommitmentSnapshot} currency={call.currency} />
                      </td>
                      <td className="r">
                        <Money value={a.uncalledBeforeSnapshot} currency={call.currency} />
                      </td>
                      <td className="r">
                        <Money value={a.callAmount} currency={call.currency} />
                      </td>
                      <td className="r">
                        <Money value={a.amountPaid} currency={call.currency} />
                      </td>
                      <td className="r">
                        <Money value={subDecimals(a.callAmount, a.amountPaid)} currency={call.currency} />
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td>{a.acknowledgedAt ? formatDateTime(a.acknowledgedAt) : <span className="ops-muted">Not yet</span>}</td>
                      <td>
                        {settleable && open && can('capital.settle') && (
                          <button className="ops-btn small" type="button" onClick={() => setPaying(a)}>
                            Record payment
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <td className="r">
                    <Money value={sumDecimals(allocations.map((a) => a.callAmount))} currency={call.currency} />
                  </td>
                  <td className="r">
                    <Money value={sumDecimals(allocations.map((a) => a.amountPaid))} currency={call.currency} />
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="ops-muted" style={{ marginTop: 10 }}>
          An LP acknowledging the call never marks it paid; only a recorded payment does.
        </p>
      </Card>

      <div className="ops-split">
        <PaymentsCard title="Payments received" payments={payments} allocations={allocations} currency={call.currency} />
        <EvidenceCard evidence={evidence} allocations={allocations} />
      </div>

      {paying && (
        <PaymentModal
          mode="payment"
          path={`${base}/allocations/${encodeURIComponent(paying.id)}/payments`}
          allocation={paying}
          due={paying.callAmount}
          currency={call.currency}
          evidence={evidence.filter((e) => e.allocationId === paying.id)}
          onClose={() => setPaying(null)}
          onDone={reload}
        />
      )}
      {rejecting && (
        <FormModal
          kicker="Capital call · review"
          title="Reject and return to the maker"
          submitLabel="Reject"
          danger
          onClose={() => setRejecting(false)}
          onDone={reload}
          onSubmit={(fd, key) => api.post(`${base}/reject`, { reason: str(fd, 'reason') }, { idempotencyKey: key })}
        >
          <Field label="Reason (shown to the maker)">
            <textarea className="ops-input" name="reason" required maxLength={2000} />
          </Field>
        </FormModal>
      )}
      {cancelling && (
        <FormModal
          kicker="Capital call"
          title="Cancel this call"
          subtitle="A cancelled call cannot be reopened."
          submitLabel="Cancel call"
          danger
          onClose={() => setCancelling(false)}
          onDone={reload}
          onSubmit={(fd, key) => api.post(`${base}/cancel`, { reason: str(fd, 'reason') }, { idempotencyKey: key })}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="reason" required maxLength={255} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
