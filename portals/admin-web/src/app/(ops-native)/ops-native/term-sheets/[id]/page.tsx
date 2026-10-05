'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { useSession } from '@/ops/session';
import type { TermSheet, TermSheetVersion } from '@/ops/types';
import { ActionButton, Alert, Card, DefinitionList, Field, FieldGrid, FormModal, formatDateTime, Loaded, Money, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

const AMENDABLE = ['ISSUED', 'VIEWED', 'SIGNED_BY_COMPANY', 'DECLINED', 'REJECTED_BY_FUND'];
const VOIDABLE = ['SIGNED_BY_COMPANY', 'COUNTERSIGNED'];

export default function TermSheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<TermSheet>(() => api.get<TermSheet>(ops(`/term-sheets/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops-native/term-sheets">← Term sheets</Link>
      </p>
      <Loaded res={res} what="this term sheet">
        {(t) => <TermSheetDetail t={t} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function TermSheetDetail({ t, reload }: { t: TermSheet; reload: () => void }) {
  const { user, can } = useSession();
  const router = useRouter();
  const [reasonFor, setReasonFor] = useState<null | 'reject' | 'void' | 'amend'>(null);
  const history = useResource<TermSheetVersion[]>(
    () => (t.parentId || t.status === 'SUPERSEDED' ? api.get<TermSheetVersion[]>(ops(`/term-sheets/${encodeURIComponent(t.id)}/history`)) : Promise.resolve([])),
    [t.id, t.status, t.parentId],
  );
  const base = ops(`/term-sheets/${encodeURIComponent(t.id)}`);
  const s = t.status;
  const isMaker = !!t.createdById && t.createdById === user.id;
  const pending = s === 'PENDING_APPROVAL' || s === 'SUBMITTED';
  const keyTerms = Array.isArray(t.keyTerms) ? (t.keyTerms as unknown[]).map((k) => (typeof k === 'string' ? k : JSON.stringify(k))) : [];

  return (
    <>
      <PageHeader
        kicker={`Term sheet · ${t.companyName ?? t.company?.name ?? t.companyId}`}
        title={
          <>
            {t.title} <StatusBadge status={s} />
          </>
        }
        subtitle={`${t.ref ?? ''}${t.versionNo ? ` · version ${t.versionNo}` : ''}`}
        actions={
          <>
            {s === 'DRAFT' && can('term_sheets.create') && (
              <ActionButton primary label="Submit for approval" onRun={(key) => api.post(`${base}/submit`, {}, { idempotencyKey: key })} onDone={reload} />
            )}
            {pending && can('term_sheets.approve') && (
              <ActionButton
                primary
                label="Approve"
                disabled={isMaker}
                title={isMaker ? 'You prepared this term sheet. A different approver is required.' : 'Requires a fresh authenticator code'}
                onRun={(key) => api.post(`${base}/approve`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {s === 'SIGNED_BY_COMPANY' && can('term_sheets.approve') && (
              <ActionButton
                primary
                label="Countersign"
                disabled={t.issuedById === user.id || t.createdById === user.id}
                title="Requires a fresh authenticator code. The person who issued the sheet cannot countersign it."
                confirm="Countersign this term sheet for the fund?"
                onRun={(key) => api.post(`${base}/countersign`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {s === 'COUNTERSIGNED' && can('term_sheets.approve') && (
              <ActionButton
                primary
                label="Mark executed"
                title="A different person from the countersigner must do this."
                confirm="Mark this term sheet executed?"
                onRun={(key) => api.post(`${base}/execute`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {s === 'SIGNED_BY_COMPANY' && can('term_sheets.approve') && (
              <button className="ops-btn danger" type="button" title="Requires a fresh authenticator code" onClick={() => setReasonFor('reject')}>
                Reject for the fund
              </button>
            )}
            {VOIDABLE.includes(s) && can('term_sheets.approve') && (
              <button className="ops-btn danger" type="button" title="Requires a fresh authenticator code" onClick={() => setReasonFor('void')}>
                Void
              </button>
            )}
            {AMENDABLE.includes(s) && can('term_sheets.create', 'term_sheets.approve') && (
              <button className="ops-btn" type="button" title="Creates the next version as a draft" onClick={() => setReasonFor('amend')}>
                Amend
              </button>
            )}
            {s === 'APPROVED' && can('term_sheets.create', 'term_sheets.approve') && (
              <ActionButton
                primary
                label="Issue to company"
                confirm="Issue this term sheet? The company's signatories will see it in the Investee portal."
                onRun={(key) => api.post(`${base}/issue`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
          </>
        }
      />
      {pending && isMaker && <Alert kind="info">You prepared this term sheet. A different approver is required.</Alert>}
      {t.closeReason && (s === 'REJECTED_BY_FUND' || s === 'VOIDED' || s === 'SUPERSEDED') && <Alert kind="warn">{`${s === 'SUPERSEDED' ? 'Superseded' : s === 'VOIDED' ? 'Voided' : 'Rejected by the fund'}: ${t.closeReason}`}</Alert>}
      {t.amendmentReason && <Alert kind="info">{`Amendment of an earlier version: ${t.amendmentReason}`}</Alert>}
      {reasonFor && (
        <FormModal
          kicker="Term sheet"
          title={reasonFor === 'reject' ? 'Reject for the fund' : reasonFor === 'void' ? 'Void term sheet' : 'Amend term sheet'}
          subtitle={reasonFor === 'amend' ? 'The current version is superseded and a new draft version is created for editing.' : 'The company is told and the reason is recorded.'}
          submitLabel={reasonFor === 'reject' ? 'Reject' : reasonFor === 'void' ? 'Void' : 'Create amendment'}
          onClose={() => setReasonFor(null)}
          onSubmit={(fd, key) => api.post<TermSheet>(`${base}/${reasonFor}`, { reason: str(fd, 'reason') }, { idempotencyKey: key })}
          onDone={(r) => {
            const next = r as TermSheet | undefined;
            setReasonFor(null);
            if (reasonFor === 'amend' && next?.id) router.push(`/ops-native/term-sheets/${encodeURIComponent(next.id)}`);
            else reload();
          }}
        >
          <FieldGrid>
            <Field label="Reason" span={2}>
              <textarea className="ops-input" name="reason" rows={3} required minLength={3} maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      <Card title="Terms">
        <DefinitionList
          items={[
            ['Company', t.companyName ?? t.company?.name ?? t.companyId],
            ['Investment', <Money key="i" value={t.investmentAmount} currency={t.currency} />],
            ['Valuation', <Money key="v" value={t.valuation} currency={t.currency} />],
            ['Equity', `${t.equityPercentage}%`],
            ['Prepared by', t.createdByName ?? (isMaker ? 'You' : t.createdById ?? '—')],
            ['Approved by', t.approvedByName ?? t.approvedById ?? '—'],
            ['Issued', formatDateTime(t.issuedAt)],
            ['Viewed by company', formatDateTime(t.viewedAt)],
            ['Signed', formatDateTime(t.signedAt)],
          ]}
        />
      </Card>
      <Loaded res={history} what="the version history">
        {(versions) =>
          versions.length > 1 ? (
            <Card title="Versions">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {versions.map((v) => (
                  <li key={v.id}>
                    {v.id === t.id ? <strong>{`v${v.versionNo} ${v.ref}`}</strong> : <Link href={`/ops-native/term-sheets/${encodeURIComponent(v.id)}`}>{`v${v.versionNo} ${v.ref}`}</Link>} <StatusBadge status={v.status} />
                    {v.amendmentReason ? <span className="ops-sub"> {v.amendmentReason}</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null
        }
      </Loaded>
      <div className="ops-split">
        <Card title="Key terms">
          {keyTerms.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {keyTerms.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          ) : (
            <p className="ops-muted">None recorded.</p>
          )}
        </Card>
        <Card title="Conditions and timeline">
          <p className="ops-pre">{t.conditions || '—'}</p>
          <p className="ops-pre ops-muted" style={{ marginTop: 10 }}>
            {t.timeline || ''}
          </p>
        </Card>
      </div>
    </>
  );
}
