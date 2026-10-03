'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { ACTION_LABEL, CashBadge, label, money2, side, type CashJournalDetail } from '@/ops/cash';
import { CashJournalForm } from '@/ops/CashJournalForm';
import type { PortfolioSummary } from '@/ops/types';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FormModal, formatDate, formatDateTime, Loaded, PageHeader, str, useResource } from '@/ops/ui';

export default function CashJournalPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<CashJournalDetail>(() => api.get<CashJournalDetail>(v1(`/cash/journals/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/cash">← Cash &amp; Ledgers</Link>
      </p>
      <Loaded res={res} what="this journal">
        {(j) => <Detail j={j} reload={res.reload} />}
      </Loaded>
    </>
  );
}

type Dialog = 'edit' | 'return' | 'reject' | 'discard' | 'reverse' | null;

function Detail({ j, reload }: { j: CashJournalDetail; reload: () => void }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  const base = v1(`/cash/journals/${encodeURIComponent(j.id)}`);
  const close = () => setDialog(null);
  const reasonForm = (title: string, path: string, submitLabel: string, withDate = false) => (
    <FormModal
      title={title}
      kicker={j.ref}
      submitLabel={submitLabel}
      danger
      onClose={close}
      onSubmit={(fd) => api.post<CashJournalDetail>(`${base}/${path}`, { reason: str(fd, 'reason'), ...(withDate && str(fd, 'entryDate') ? { entryDate: str(fd, 'entryDate') } : {}) })}
      onDone={(r) => (path === 'reverse' ? router.push(`/ops/cash/journals/${encodeURIComponent((r as CashJournalDetail).id)}`) : reload())}
    >
      <Field label="Reason" hint="Recorded in the audit trail">
        <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
      </Field>
      {withDate && (
        <Field label="Reversal date" hint="Defaults to today; must be in an open cash period and not before the original">
          <input className="ops-input" type="date" name="entryDate" min={j.entryDate} />
        </Field>
      )}
    </FormModal>
  );

  return (
    <>
      <PageHeader
        kicker={`Cash journal · ${j.portfolioName ?? ''}`}
        title={
          <>
            {j.ref} <CashBadge status={j.status} />
          </>
        }
        subtitle={
          <>
            {formatDate(j.entryDate)} · {j.currency} · {label(j.purpose)} · {j.description}
          </>
        }
        actions={
          <>
            {j.allowed.edit && (
              <button className="ops-btn" type="button" onClick={() => setDialog('edit')}>
                Edit draft
              </button>
            )}
            {j.allowed.submit && <ActionButton label="Submit for approval" primary confirm={`Submit ${j.ref}? A different person with approval authority will post it.`} onRun={(key) => api.post(`${base}/submit`, {}, { idempotencyKey: key })} onDone={reload} />}
            {j.status === 'PENDING_APPROVAL' && (
              <ActionButton
                label="Approve and post"
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
            {j.allowed.reject && (
              <button className="ops-btn danger" type="button" onClick={() => setDialog('reject')}>
                Reject
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

      {j.status === 'POSTED' && !j.reversalOfRef && <Alert kind="ok">Posted by {j.postedByName ?? 'an approver'} on {formatDateTime(j.postedAt)}. This journal is final; correct it by reversal.</Alert>}
      {j.status === 'REVERSED' && (
        <Alert kind="info">
          Reversed{j.reversedByRef ? (
            <>
              {' '}
              by <Link href={`/ops/cash/journals/${j.reversedById}`}>{j.reversedByRef}</Link>
            </>
          ) : null}
          : {j.reverseReason}
        </Alert>
      )}
      {j.reversalOfRef && (
        <Alert kind="info">
          This journal reverses <Link href={`/ops/cash/journals/${j.reversalOfId}`}>{j.reversalOfRef}</Link> with the debits and credits swapped.
        </Alert>
      )}
      {j.status === 'REJECTED' && <Alert>Rejected: {j.rejectReason}. This journal is read-only.</Alert>}
      {j.status === 'PENDING_APPROVAL' && !j.allowed.post && j.allowed.postBlocker && <Alert kind="info">Posting is not available to you: {j.allowed.postBlocker}.</Alert>}
      {j.periodClosed && j.status !== 'POSTED' && j.status !== 'REVERSED' && <Alert kind="warn">Cash for this date is closed. Redate the journal into an open period or reopen the close.</Alert>}

      <Card title="Lines">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Ledger</th>
                <th>Kind</th>
                <th>Memo</th>
                <th className="r">Debit</th>
                <th className="r">Credit</th>
              </tr>
            </thead>
            <tbody>
              {j.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.ledgerRef}</strong> {l.ledgerName}
                  </td>
                  <td>{label(l.ledgerKind)}</td>
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
            ['Source event', j.sourceRef ?? '—'],
            ['Evidence reference', j.evidenceRef ?? '—'],
            ['Created by (maker)', j.makerName ?? '—'],
            ['Approved by (checker)', j.postedByName ? `${j.postedByName}, ${formatDateTime(j.postedAt)}` : 'Not posted'],
            ['Linked reservation', j.reservationId ? 'Consumed on posting' : '—'],
            ['Linked expectation', j.expectationId ? 'Settled on posting' : '—'],
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

      {dialog === 'edit' && portfolios.state === 'ok' && <CashJournalForm entity={j.portfolioId} portfolios={portfolios.data} existing={j} onClose={close} onDone={() => reload()} />}
      {dialog === 'return' && reasonForm('Return to creator', 'return', 'Return')}
      {dialog === 'reject' && reasonForm('Reject journal', 'reject', 'Reject')}
      {dialog === 'discard' && reasonForm('Discard journal', 'discard', 'Discard')}
      {dialog === 'reverse' && reasonForm('Reverse journal', 'reverse', 'Post reversal', true)}
    </>
  );
}
