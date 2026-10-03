'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { CashBadge, type CloseDetail } from '@/ops/cash';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Field, FormModal, formatDate, formatDateTime, Loaded, PageHeader, str, useResource } from '@/ops/ui';

export default function CashClosePage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<CloseDetail>(() => api.get<CloseDetail>(v1(`/cash/period-closes/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/cash">← Cash &amp; Ledgers</Link>
      </p>
      <Loaded res={res} what="this close">
        {(c) => <Detail c={c} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ c, reload }: { c: CloseDetail; reload: () => void }) {
  const canClose = useCan('cash.close');
  const canApprove = useCan('cash.journal.approve');
  const [reopening, setReopening] = useState(false);
  const base = v1(`/cash/period-closes/${encodeURIComponent(c.id)}`);
  return (
    <>
      <PageHeader
        kicker={`Cash close · ${c.portfolioName ?? ''}`}
        title={
          <>
            Up to {formatDate(c.periodEnd)} <CashBadge status={c.status} />
          </>
        }
        subtitle="Close is blocked until every control is explainable. The pre-check lists all blockers at once."
        actions={
          <>
            {c.status === 'PREPARED' && canApprove && <ActionButton label="Approve as checker" primary confirm="Approve this close? You must not be the person who prepared it." onRun={(key) => api.post(`${base}/approve`, {}, { idempotencyKey: key })} onDone={reload} />}
            {c.status !== 'CLOSED' && canClose && (
              <ActionButton
                label="Close period"
                primary
                disabled={!c.canClose}
                title={c.canClose ? 'Requires a fresh authenticator code' : 'Clear every blocker first'}
                confirm="Close this cash period? No journal can then be dated in it until it is reopened."
                onRun={(key) => api.post(`${base}/close`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {c.status === 'CLOSED' && canClose && (
              <button className="ops-btn danger" type="button" onClick={() => setReopening(true)}>
                Reopen
              </button>
            )}
          </>
        }
      />
      {c.status === 'CLOSED' ? (
        <Alert kind="ok">Closed by {c.closedByName ?? 'a closer'} on {formatDateTime(c.closedAt)}. Journals dated in this period are refused.</Alert>
      ) : c.blockers.length ? (
        <Alert kind="warn">Close blocked: {c.blockers.length} blocker{c.blockers.length === 1 ? '' : 's'}.</Alert>
      ) : (
        <Alert kind="ok">Every control passes. The period can be closed.</Alert>
      )}
      {c.reopenReason && c.status !== 'CLOSED' && <Alert kind="info">Previously reopened: {c.reopenReason}</Alert>}

      <Card title="Pre-check">
        <ul className="ops-timeline">
          {c.checklist.map((it) => (
            <li key={it.key}>
              <span className={`ops-badge ${it.ok ? 'green' : 'red'}`}>{it.ok ? 'Pass' : 'Blocked'}</span> <strong>{it.label}</strong>
              <span className="ops-sub">{it.detail}</span>
              {it.blockers.map((b, k) => (
                <span className="ops-sub" key={k}>
                  {b}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Control">
        <DefinitionList
          items={[
            ['Prepared by', c.preparedByName ?? '—'],
            ['Approved by (checker)', c.approvedByName ?? 'Pending'],
            ['Closed by', c.closedByName ?? '—'],
          ]}
        />
      </Card>

      {reopening && (
        <FormModal title="Reopen cash period" kicker={formatDate(c.periodEnd)} submitLabel="Reopen" danger onClose={() => setReopening(false)} onSubmit={(fd) => api.post(`${base}/reopen`, { reason: str(fd, 'reason') })} onDone={reload}>
          <Field label="Reason" hint="Recorded in the audit trail; the approval is cleared">
            <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
