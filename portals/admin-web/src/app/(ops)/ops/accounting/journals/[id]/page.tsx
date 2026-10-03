'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { ACTION_LABEL, JournalStatusBadge, money2, PeriodStatusBadge, side, TYPE_LABEL, type JournalDetail } from '@/ops/accounting';
import { JournalForm } from '@/ops/JournalForm';
import type { PortfolioSummary } from '@/ops/types';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FormModal, formatDate, formatDateTime, Loaded, PageHeader, str, useResource } from '@/ops/ui';

export default function JournalPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<JournalDetail>(() => api.get<JournalDetail>(v1(`/accounting/journals/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/accounting">← Accounting &amp; Close</Link>
      </p>
      <Loaded res={res} what="this journal">
        {(j) => <Detail j={j} reload={res.reload} />}
      </Loaded>
    </>
  );
}

type Dialog = 'edit' | 'return' | 'discard' | 'reverse' | null;

function Detail({ j, reload }: { j: JournalDetail; reload: () => void }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  const base = v1(`/accounting/journals/${encodeURIComponent(j.id)}`);
  const close = () => setDialog(null);
  const reasonForm = (label: string, path: string, submitLabel: string, withDate = false) => (
    <FormModal
      title={label}
      kicker={j.ref}
      submitLabel={submitLabel}
      danger
      onClose={close}
      onSubmit={(fd) => api.post<JournalDetail>(`${base}/${path}`, { reason: str(fd, 'reason'), ...(withDate && str(fd, 'entryDate') ? { entryDate: str(fd, 'entryDate') } : {}) })}
      onDone={(r) => (path === 'reverse' ? router.push(`/ops/accounting/journals/${encodeURIComponent((r as JournalDetail).id)}`) : reload())}
    >
      <Field label="Reason" hint="Recorded in the audit trail">
        <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
      </Field>
      {withDate && (
        <Field label="Reversal date" hint="Defaults to today; must be in an open period and not before the original">
          <input className="ops-input" type="date" name="entryDate" min={j.entryDate} />
        </Field>
      )}
    </FormModal>
  );

  return (
    <>
      <PageHeader
        kicker={`Journal · ${j.portfolioName ?? ''}`}
        title={
          <>
            {j.ref} <JournalStatusBadge status={j.status} />
          </>
        }
        subtitle={
          <>
            {formatDate(j.entryDate)} · {j.currency} · {j.description}
          </>
        }
        actions={
          <>
            {j.allowed.edit && (
              <button className="ops-btn" type="button" onClick={() => setDialog('edit')}>
                Edit draft
              </button>
            )}
            {j.allowed.submit && <ActionButton label="Submit for approval" primary confirm={`Submit ${j.ref}? A different person with posting authority will post it.`} onRun={(key) => api.post(`${base}/submit`, {}, { idempotencyKey: key })} onDone={reload} />}
            {j.status === 'PENDING_APPROVAL' && (
              <ActionButton
                label="Post journal"
                primary
                disabled={!j.allowed.post}
                title={j.allowed.post ? 'Requires a fresh authenticator code' : (j.allowed.postBlocker ?? undefined)}
                confirm={`Post ${j.ref}? Posted journals cannot be edited; they can only be reversed.`}
                onRun={(key) => api.post(`${base}/post`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {j.allowed.returnToMaker && (
              <button className="ops-btn" type="button" onClick={() => setDialog('return')}>
                Return to creator
              </button>
            )}
            {j.allowed.discard && (
              <button className="ops-btn danger" type="button" onClick={() => setDialog('discard')}>
                Discard
              </button>
            )}
            {j.allowed.reverse && (
              <button className="ops-btn danger" type="button" onClick={() => setDialog('reverse')}>
                Reverse
              </button>
            )}
          </>
        }
      />

      {j.status === 'POSTED' && <Alert kind="ok">Posted by {j.postedByName ?? 'a poster'} on {formatDateTime(j.postedAt)}. This journal is final; correct it by reversal.</Alert>}
      {j.status === 'REVERSED' && (
        <Alert kind="info">
          Reversed{j.reversedByRef ? (
            <>
              {' '}
              by <Link href={`/ops/accounting/journals/${j.reversedById}`}>{j.reversedByRef}</Link>
            </>
          ) : null}
          : {j.reverseReason}
        </Alert>
      )}
      {j.reversalOfRef && (
        <Alert kind="info">
          This journal reverses <Link href={`/ops/accounting/journals/${j.reversalOfId}`}>{j.reversalOfRef}</Link> with the debits and credits swapped.
        </Alert>
      )}
      {j.status === 'PENDING_APPROVAL' && !j.allowed.post && j.allowed.postBlocker && <Alert kind="info">Posting is not available to you: {j.allowed.postBlocker}.</Alert>}
      {j.periodStatus === 'CLOSED' && j.status !== 'POSTED' && j.status !== 'REVERSED' && <Alert kind="warn">The period for this date is closed. Redate the journal into an open period or reopen the period.</Alert>}

      <Card title="Lines">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Memo</th>
                <th className="r">Debit</th>
                <th className="r">Credit</th>
              </tr>
            </thead>
            <tbody>
              {j.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.accountCode}</strong> {l.accountName}
                  </td>
                  <td>{TYPE_LABEL[l.accountType] ?? l.accountType}</td>
                  <td>{l.memo ?? ''}</td>
                  <td className="r">{side(l.debit)}</td>
                  <td className="r">{side(l.credit)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 800 }}>
                <td colSpan={3}>Total</td>
                <td className="r">{money2(j.totalDebit)}</td>
                <td className="r">{money2(j.totalCredit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Control">
        <DefinitionList
          items={[
            ['Created by', j.makerName ?? '—'],
            ['Posted by', j.postedByName ? `${j.postedByName}, ${formatDateTime(j.postedAt)}` : 'Not posted'],
            ['Period', j.periodId ? <>{j.periodStatus && <PeriodStatusBadge status={j.periodStatus} />} <Link href={`/ops/accounting/periods/${j.periodId}`}>Open period</Link></> : 'No period opened for this date'],
          ]}
        />
      </Card>

      <Card title="History">
        {j.timeline.length === 0 ? (
          <Empty>No events yet.</Empty>
        ) : (
          <ul className="ops-timeline">
            {j.timeline.map((t, i) => (
              <li key={i}>
                <strong>{ACTION_LABEL[t.action] ?? t.action}</strong> · {t.actor} · {formatDateTime(t.at)}
                {t.reason && <span className="ops-sub">{t.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog === 'edit' && portfolios.state === 'ok' && <JournalForm entity={j.portfolioId} portfolios={portfolios.data} existing={j} onClose={close} onDone={() => reload()} />}
      {dialog === 'return' && reasonForm('Return to creator', 'return', 'Return')}
      {dialog === 'discard' && reasonForm('Discard journal', 'discard', 'Discard')}
      {dialog === 'reverse' && reasonForm('Reverse journal', 'reverse', 'Post reversal', true)}
    </>
  );
}
