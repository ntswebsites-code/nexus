'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { money2, PeriodStatusBadge, type PeriodDetail } from '@/ops/accounting';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Field, FormModal, formatDate, formatDateTime, Loaded, PageHeader, str, useResource } from '@/ops/ui';

export default function PeriodPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<PeriodDetail>(() => api.get<PeriodDetail>(v1(`/accounting/periods/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops-native/accounting">← Accounting &amp; Close</Link>
      </p>
      <Loaded res={res} what="this period">
        {(p) => <Detail p={p} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ p, reload }: { p: PeriodDetail; reload: () => void }) {
  const canClose = useCan('accounting.close');
  const canReopen = useCan('accounting.reopen');
  const [reopening, setReopening] = useState(false);
  const base = v1(`/accounting/periods/${encodeURIComponent(p.id)}`);
  const closed = p.status === 'CLOSED';

  return (
    <>
      <PageHeader
        kicker={`Period close · ${p.portfolioName ?? ''}`}
        title={
          <>
            {p.month} <PeriodStatusBadge status={p.status} />
          </>
        }
        subtitle={
          <>
            {formatDate(p.periodStart)} to {formatDate(p.periodEnd)}
          </>
        }
        actions={
          <>
            {p.status === 'OPEN' && <ActionButton label="Start close" confirm={`Mark ${p.month} as closing? Posting stays possible until the period is closed.`} onRun={(key) => api.post(`${base}/start-close`, {}, { idempotencyKey: key })} onDone={reload} />}
            {!closed && canClose && (
              <ActionButton
                label="Close period"
                primary
                disabled={!p.canClose}
                title={p.canClose ? 'Requires a fresh authenticator code' : `${p.blockers.length} blocker${p.blockers.length === 1 ? '' : 's'} to clear first`}
                confirm={`Close ${p.month}? No journal can be dated in a closed period.`}
                onRun={(key) => api.post(`${base}/close`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {closed && canReopen && (
              <button className="ops-btn danger" type="button" onClick={() => setReopening(true)}>
                Reopen
              </button>
            )}
          </>
        }
      />

      {closed ? (
        <Alert kind="ok">
          Closed by {p.closedByName ?? 'an approver'} on {formatDateTime(p.closedAt)}. Posting into this period is locked.
        </Alert>
      ) : p.blockers.length > 0 ? (
        <Alert kind="warn">The period cannot be closed yet. {p.blockers.length} blocker{p.blockers.length === 1 ? '' : 's'} listed below.</Alert>
      ) : (
        <Alert kind="info">Every check passes. The period can be closed by someone with the accounting.close permission.</Alert>
      )}
      {p.reopenReason && !closed && (
        <Alert kind="info">
          Reopened by {p.reopenedByName ?? 'an approver'} on {formatDateTime(p.reopenedAt)}: {p.reopenReason}
        </Alert>
      )}

      <Card title="Close checklist">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <tbody>
              {p.checklist.map((c) => (
                <tr key={c.key}>
                  <td style={{ width: 90 }}>
                    <span className={`ops-badge ${c.ok ? 'green' : 'red'}`}>{c.ok ? 'Pass' : 'Blocked'}</span>
                  </td>
                  <td>
                    <strong>{c.label}</strong>
                    <span className="ops-sub">{c.detail}</span>
                    {c.blockers.map((b) => (
                      <span key={b} className="ops-sub" style={{ color: 'var(--ops-red, #b42318)' }}>
                        {b}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Trial balance at period end">
        <DefinitionList
          items={[
            ['Total debits', money2(p.trialBalance.totalDebit)],
            ['Total credits', money2(p.trialBalance.totalCredit)],
            ['In balance', p.trialBalance.balanced ? 'Yes' : 'No'],
            ['Unposted journals in the period', String(p.unpostedJournals)],
          ]}
        />
      </Card>

      {reopening && (
        <FormModal
          title={`Reopen ${p.month}`}
          kicker="Period close"
          subtitle="Reopening unlocks posting into this month. The reason is recorded in the audit trail and a fresh authenticator code is required."
          submitLabel="Reopen period"
          danger
          onClose={() => setReopening(false)}
          onSubmit={(fd) => api.post(`${base}/reopen`, { reason: str(fd, 'reason') })}
          onDone={reload}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
