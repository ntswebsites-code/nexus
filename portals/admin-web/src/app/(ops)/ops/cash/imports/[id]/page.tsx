'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { ACTION_LABEL, CashBadge, money2, type ImportDetail } from '@/ops/cash';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FormModal, formatDate, formatDateTime, Loaded, PageHeader, str, useResource } from '@/ops/ui';

export default function StatementImportPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<ImportDetail>(() => api.get<ImportDetail>(v1(`/cash/statement-imports/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/cash">← Cash &amp; Ledgers</Link>
      </p>
      <Loaded res={res} what="this statement import">
        {(i) => <Detail i={i} reload={res.reload} />}
      </Loaded>
    </>
  );
}

type Line = ImportDetail['lines'][number];

function Detail({ i, reload }: { i: ImportDetail; reload: () => void }) {
  const canApprove = useCan('cash.journal.approve');
  const canImport = useCan('cash.import');
  const [rejecting, setRejecting] = useState(false);
  const [matching, setMatching] = useState<Line | null>(null);
  const [ignoring, setIgnoring] = useState<Line | null>(null);
  const base = v1(`/cash/statement-imports/${encodeURIComponent(i.id)}`);
  const committed = i.status === 'COMMITTED';
  return (
    <>
      <PageHeader
        kicker={`Statement import · ${i.portfolioName ?? ''}`}
        title={
          <>
            {i.ref} <CashBadge status={i.status} />
          </>
        }
        subtitle={`${i.ledgerName} · ${formatDate(i.statementFrom)} to ${formatDate(i.statementTo)} · ${i.filename}`}
        actions={
          <>
            {i.status === 'STAGED' && canApprove && (
              <ActionButton
                label="Commit evidence"
                primary
                disabled={!i.allowed.commit}
                title={i.allowed.commit ? 'Requires a fresh authenticator code' : (i.allowed.commitBlocker ?? undefined)}
                confirm={`Commit ${i.ref}? The reviewed staging version becomes immutable external evidence and matching starts.`}
                onRun={(key) => api.post(`${base}/commit`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {i.allowed.reject && canImport && (
              <button className="ops-btn danger" type="button" onClick={() => setRejecting(true)}>
                Reject
              </button>
            )}
          </>
        }
      />
      {i.status === 'STAGED' && !i.allowed.commit && i.allowed.commitBlocker && <Alert kind="info">Commit is not available to you: {i.allowed.commitBlocker}.</Alert>}
      {i.status === 'REJECTED' && <Alert>Rejected: {i.rejectReason}</Alert>}
      {committed && i.unmatchedLines > 0 && <Alert kind="warn">{i.unmatchedLines} line{i.unmatchedLines === 1 ? '' : 's'} not matched to a posted journal. Unmatched lines older than 5 days block the period close.</Alert>}

      <Card title="Arithmetic">
        <DefinitionList
          items={[
            ['Opening balance', `${money2(i.openingBalance)} ${i.currency ?? ''}`],
            ['Closing balance', `${money2(i.closingBalance)} ${i.currency ?? ''}`],
            ['Lines', String(i.lineCount)],
            ['Variance (opening + movements − closing)', money2(i.variance)],
            ['Uploaded by', i.makerName ?? '—'],
            ['Committed by', i.checkerName ?? '—'],
          ]}
        />
      </Card>

      <Card title="Staged lines">
        {i.lines.length === 0 ? (
          <Empty>No lines.</Empty>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Value date</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th className="r">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {i.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.lineNo}</td>
                    <td>{formatDate(l.valueDate)}</td>
                    <td>{l.reference ?? ''}</td>
                    <td>
                      {l.description ?? ''}
                      {l.note && <span className="ops-sub">{l.note}</span>}
                    </td>
                    <td className="r">{money2(l.amount)}</td>
                    <td>
                      <CashBadge status={committed ? l.status : 'STAGED'} />
                      {l.matchedJournalId && (
                        <span className="ops-sub">
                          <Link href={`/ops/cash/journals/${l.matchedJournalId}`}>Journal</Link>
                        </span>
                      )}
                    </td>
                    <td>
                      {committed && l.status === 'UNMATCHED' && (
                        <>
                          {canImport && (
                            <button className="ops-btn small" type="button" onClick={() => setMatching(l)}>
                              Match
                            </button>
                          )}{' '}
                          {canApprove && (
                            <button className="ops-btn small" type="button" onClick={() => setIgnoring(l)}>
                              Write off
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="History">
        {i.timeline.length === 0 ? (
          <Empty>No events yet.</Empty>
        ) : (
          <ul className="ops-timeline">
            {i.timeline.map((t, k) => (
              <li key={k}>
                <strong>{ACTION_LABEL[t.action] ?? t.action}</strong> · {t.actor} · {formatDateTime(t.at)}
                {t.reason && <span className="ops-sub">{t.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {rejecting && (
        <FormModal title="Reject statement" kicker={i.ref} submitLabel="Reject" danger onClose={() => setRejecting(false)} onSubmit={(fd) => api.post(`${base}/reject`, { reason: str(fd, 'reason') })} onDone={reload}>
          <Field label="Reason">
            <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
          </Field>
        </FormModal>
      )}
      {matching && (
        <FormModal
          title={`Match line ${matching.lineNo}`}
          kicker={i.ref}
          subtitle={`${formatDate(matching.valueDate)} · ${money2(matching.amount)}. Enter the posted journal that moved exactly this amount on the ledger (reference such as CJ-00012).`}
          submitLabel="Match"
          onClose={() => setMatching(null)}
          onSubmit={(fd) => api.post(v1(`/cash/statement-lines/${matching.id}/match`), { journalId: str(fd, 'journalId') })}
          onDone={reload}
        >
          <Field label="Journal reference">
            <input className="ops-input" name="journalId" required maxLength={36} placeholder="CJ-00001" />
          </Field>
        </FormModal>
      )}
      {ignoring && (
        <FormModal
          title={`Write off line ${ignoring.lineNo}`}
          kicker={i.ref}
          subtitle="Removes the line from the open items. Needs a different person from the uploader."
          submitLabel="Write off"
          danger
          onClose={() => setIgnoring(null)}
          onSubmit={(fd) => api.post(v1(`/cash/statement-lines/${ignoring.id}/ignore`), { note: str(fd, 'note') })}
          onDone={reload}
        >
          <Field label="Explanation">
            <textarea className="ops-input" name="note" rows={3} required minLength={5} maxLength={255} />
          </Field>
        </FormModal>
      )}
    </>
  );
}
