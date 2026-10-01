'use client';

import { useState } from 'react';
import { api, ops, qs } from '@/ops/api';
import { clientLabel, fundLabel } from '@/ops/lookups';
import { formatDecimal, isDecimal } from '@/ops/money';
import { useSession } from '@/ops/session';
import type { DealingRequest } from '@/ops/types';
import {
  ActionButton,
  Alert,
  amount,
  Card,
  DateText,
  DefinitionList,
  Empty,
  Field,
  FieldGrid,
  FormModal,
  formatDateTime,
  Loaded,
  Money,
  optStr,
  PageHeader,
  StatusBadge,
  str,
  useResource,
} from '@/ops/ui';

const STATUSES = ['SUBMITTED', 'COMPLIANCE_REVIEW', 'AWAITING_FUNDS', 'AWAITING_NAV', 'UNDER_REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);

export default function DealingPage() {
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requests = useResource<DealingRequest[]>(() => api.get<DealingRequest[]>(ops(`/dealing/requests${qs({ status })}`)), [status]);
  const selected = requests.state === 'ok' ? requests.data.find((r) => r.id === selectedId) ?? null : null;

  return (
    <>
      <PageHeader
        kicker="Dealing · J4"
        title="Dealing queue"
        subtitle="LP subscriptions and redemptions. Operations accepts and processes a request at the dealing NAV; a different person approves it."
      />
      <div className="ops-filters">
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
      <div className="ops-split">
        <Card>
          <Loaded res={requests} what="the dealing queue">
            {(rows) =>
              rows.length === 0 ? (
                <Empty>No dealing requests match this filter.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>LP · fund</th>
                        <th className="r">Amount / units</th>
                        <th>Dealing date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className={`clickable${r.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(r.id)}>
                          <td>
                            <strong>{r.ref ?? r.id.slice(0, 8)}</strong>
                            <span className="ops-sub">{r.requestType.toLowerCase()}</span>
                          </td>
                          <td>
                            {clientLabel(r)}
                            <span className="ops-sub">{fundLabel(r)}</span>
                          </td>
                          <td className="r">{quantity(r)}</td>
                          <td>
                            <DateText value={r.requestedDealingDate} />
                          </td>
                          <td>
                            <StatusBadge status={r.status} />
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
        {selected ? (
          <RequestPanel key={`${selected.id}:${selected.status}`} r={selected} reload={requests.reload} />
        ) : (
          <Card>
            <Empty>Select a request to review it.</Empty>
          </Card>
        )}
      </div>
    </>
  );
}

function quantity(r: DealingRequest) {
  if (r.inputMode === 'FULL' || r.redemptionMode === 'FULL') return 'Full holding';
  if (r.amount != null) return <Money value={r.amount} currency={r.currency} />;
  if (r.units != null) return `${formatDecimal(r.units, 4)} units`;
  return '—';
}

function RequestPanel({ r, reload }: { r: DealingRequest; reload: () => void }) {
  const { user, can } = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const base = ops(`/dealing/requests/${encodeURIComponent(r.id)}`);
  const s = r.status;
  const isProcessor = !!r.processedById && r.processedById === user.id;
  const canAccept = (s === 'SUBMITTED' || s === 'COMPLIANCE_REVIEW') && can('dealing.process');
  const canProcess = (s === 'AWAITING_FUNDS' || s === 'UNDER_REVIEW') && can('dealing.process');
  const canApprove = s === 'AWAITING_NAV' && can('dealing.approve');
  const canReject = !TERMINAL.has(s) && can('dealing.process', 'dealing.approve');

  return (
    <div>
      <Card
        title={`${r.requestType === 'REDEMPTION' ? 'Redemption' : 'Subscription'} ${r.ref ?? ''}`}
        actions={
          <>
            {canAccept && <ActionButton primary label="Accept" onRun={(key) => api.post(`${base}/accept`, {}, { idempotencyKey: key })} onDone={reload} />}
            {canProcess && (
              <button className="ops-btn primary" type="button" onClick={() => setProcessing(true)}>
                Process at NAV
              </button>
            )}
            {canApprove && (
              <ActionButton
                primary
                label="Approve"
                disabled={isProcessor}
                title={isProcessor ? 'You processed this request. A different approver is required.' : 'Requires a fresh authenticator code'}
                onRun={(key) => api.post(`${base}/approve`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {canReject && (
              <button className="ops-btn danger" type="button" onClick={() => setRejecting(true)}>
                Reject
              </button>
            )}
          </>
        }
      >
        {canApprove && isProcessor && <Alert kind="info">You processed this request. A different approver is required.</Alert>}
        {r.rejectionReason && <Alert kind="warn">Rejected: {r.rejectionReason}</Alert>}
        <DefinitionList
          items={[
            ['Status', <StatusBadge key="s" status={s} />],
            ['LP', clientLabel(r)],
            ['Fund', fundLabel(r)],
            ['Share class', r.shareClassCode ?? '—'],
            ['Requested', quantity(r)],
            ['Dealing date', <DateText key="d" value={r.requestedDealingDate} />],
            ['Submitted', formatDateTime(r.createdAt)],
            ['Submitted by', r.submittedByName ?? '—'],
            ['Dealing NAV / unit', r.dealingNavPerUnit ? formatDecimal(r.dealingNavPerUnit, 6) : '—'],
            ['Units allocated', r.unitsAllocated ? formatDecimal(r.unitsAllocated, 4) : '—'],
            ['Notes', r.notes ?? '—'],
          ]}
        />
      </Card>
      {processing && (
        <FormModal
          kicker="Dealing · process"
          title="Process at the dealing NAV"
          subtitle="Records the NAV used and the units. A different person approves afterwards."
          submitLabel="Process"
          onClose={() => setProcessing(false)}
          onDone={reload}
          onSubmit={(fd, key) => {
            const nav = amount(fd, 'navPerUnit');
            if (!isDecimal(nav)) throw new Error('Enter the dealing NAV per unit as a number.');
            return api.post(
              `${base}/process`,
              { navPerUnit: nav, notes: optStr(fd, 'notes') },
              { idempotencyKey: key },
            );
          }}
        >
          <FieldGrid>
            <Field label="Dealing NAV per unit" hint="Units are calculated from this NAV.">
              <input className="ops-input" name="navPerUnit" inputMode="decimal" required />
            </Field>
            <Field label="Notes" span={2}>
              <textarea className="ops-input" name="notes" maxLength={2000} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {rejecting && (
        <FormModal
          kicker="Dealing"
          title="Reject this request"
          subtitle="The LP sees the reason in their portal."
          submitLabel="Reject"
          danger
          onClose={() => setRejecting(false)}
          onDone={reload}
          onSubmit={(fd, key) => api.post(`${base}/reject`, { reason: str(fd, 'reason') }, { idempotencyKey: key })}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="reason" required maxLength={255} />
          </Field>
        </FormModal>
      )}
    </div>
  );
}
