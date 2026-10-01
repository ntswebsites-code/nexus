'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { clientLabel, fundLabel } from '@/ops/lookups';
import { subDecimals, sumDecimals } from '@/ops/money';
import { useSession } from '@/ops/session';
import { PaymentModal, PaymentsCard } from '@/ops/settlement';
import type { Distribution, DistributionAllocation, Payment } from '@/ops/types';
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

export default function DistributionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<Distribution>(() => api.get<Distribution>(ops(`/distributions/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/distributions">← Distributions</Link>
      </p>
      <Loaded res={res} what="this distribution">
        {(d) => <DistributionDetail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function DistributionDetail({ d, reload }: { d: Distribution; reload: () => void }) {
  const { user, can } = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [settling, setSettling] = useState<DistributionAllocation | null>(null);
  const base = ops(`/distributions/${encodeURIComponent(d.id)}`);
  const allocations = d.allocations ?? [];
  const payments: Payment[] = d.payments ?? allocations.flatMap((a) => a.payments ?? []);
  const isMaker = !!d.makerId && d.makerId === user.id;
  const status = d.status;
  const settleable = status === 'ISSUED' || status === 'PARTIALLY_PAID';
  const cancellable = status === 'DRAFT' || status === 'PENDING_APPROVAL' || status === 'APPROVED';
  const paid = sumDecimals(allocations.map((a) => a.amountPaid));

  return (
    <>
      <PageHeader
        kicker={`Distribution · ${fundLabel(d)}`}
        title={
          <>
            {d.ref ?? 'Distribution'} <StatusBadge status={status} />
          </>
        }
        subtitle={`${d.type.replace(/_/g, ' ').toLowerCase()} · ${new Date(d.distributionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
        actions={
          <>
            {status === 'DRAFT' && can('distributions.create') && (
              <ActionButton primary label="Submit for approval" onRun={(key) => api.post(`${base}/submit`, {}, { idempotencyKey: key })} onDone={reload} />
            )}
            {status === 'PENDING_APPROVAL' && can('distributions.approve') && (
              <>
                <ActionButton
                  primary
                  label="Approve"
                  disabled={isMaker}
                  title={isMaker ? 'You prepared this distribution. A different approver is required.' : 'Requires a fresh authenticator code'}
                  onRun={(key) => api.post(`${base}/approve`, {}, { idempotencyKey: key })}
                  onDone={reload}
                />
                <button className="ops-btn danger" type="button" onClick={() => setRejecting(true)}>
                  Reject
                </button>
              </>
            )}
            {status === 'APPROVED' && can('distributions.approve') && (
              <ActionButton
                primary
                label="Issue to LPs"
                confirm="Issue this distribution? Every allocated LP will see it in their portal."
                onRun={(key) => api.post(`${base}/issue`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {cancellable && can('distributions.create', 'distributions.approve') && (
              <button className="ops-btn danger" type="button" onClick={() => setCancelling(true)}>
                Cancel
              </button>
            )}
          </>
        }
      />
      {status === 'PENDING_APPROVAL' && isMaker && <Alert kind="info">You prepared this distribution. A different approver is required.</Alert>}
      {d.rejectionReason && status === 'DRAFT' && <Alert kind="warn">Returned by the approver: {d.rejectionReason}</Alert>}

      <Card title="Distribution details">
        <DefinitionList
          items={[
            ['Fund', fundLabel(d)],
            ['Gross amount', <Money key="g" value={d.grossAmount} currency={d.currency} />],
            ['Carried interest', <Money key="c" value={d.carryAmount ?? '0'} currency={d.currency} />],
            ['Adjustments', <Money key="a" value={d.adjustmentsAmount ?? '0'} currency={d.currency} />],
            ['Net to LPs', <Money key="n" value={d.netToLps} currency={d.currency} />],
            ['Settled to date', <Money key="s" value={paid} currency={d.currency} />],
            ['Prepared by', d.makerName ?? (isMaker ? 'You' : d.makerId ?? '—')],
            ['Approved by', d.checkerName ?? d.checkerId ?? '—'],
            ['Issued', formatDateTime(d.issuedAt)],
            ['Notes', d.notes ?? '—'],
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
                  <th className="r">Gross share</th>
                  <th className="r">Adjustments</th>
                  <th className="r">Net share</th>
                  <th className="r">Settled</th>
                  <th>Status</th>
                  <th>Paid</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <td>{clientLabel(a)}</td>
                    <td className="r">
                      <Money value={a.commitmentSnapshot} currency={d.currency} />
                    </td>
                    <td className="r">
                      <Money value={a.grossShare} currency={d.currency} />
                    </td>
                    <td className="r">
                      <Money value={a.adjustments} currency={d.currency} />
                    </td>
                    <td className="r">
                      <Money value={a.shareAmount} currency={d.currency} />
                    </td>
                    <td className="r">
                      <Money value={a.amountPaid} currency={d.currency} />
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td>
                      <DateText value={a.paidAt} />
                    </td>
                    <td>
                      {settleable && a.status !== 'PAID' && a.status !== 'CANCELLED' && can('distributions.settle') && (
                        <button className="ops-btn small" type="button" onClick={() => setSettling(a)}>
                          Settle
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="r">
                    <Money value={sumDecimals(allocations.map((a) => a.shareAmount))} currency={d.currency} />
                  </td>
                  <td className="r">
                    <Money value={paid} currency={d.currency} />
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <PaymentsCard title="Settlements recorded" payments={payments} allocations={allocations} currency={d.currency} />

      {settling && (
        <PaymentModal
          mode="settle"
          path={`${base}/allocations/${encodeURIComponent(settling.id)}/settle`}
          allocation={settling}
          due={settling.shareAmount}
          currency={d.currency}
          evidence={[]}
          onClose={() => setSettling(null)}
          onDone={reload}
        />
      )}
      {rejecting && (
        <FormModal
          kicker="Distribution · review"
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
          kicker="Distribution"
          title="Cancel this distribution"
          submitLabel="Cancel distribution"
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
      <p className="ops-muted">Outstanding to LPs: {subDecimals(d.netToLps, paid) === '0.0000' ? 'none' : <Money value={subDecimals(d.netToLps, paid)} currency={d.currency} />}</p>
    </>
  );
}
