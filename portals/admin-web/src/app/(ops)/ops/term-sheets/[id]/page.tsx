'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ops } from '@/ops/api';
import { useSession } from '@/ops/session';
import type { TermSheet } from '@/ops/types';
import { ActionButton, Alert, Card, DefinitionList, formatDateTime, Loaded, Money, PageHeader, StatusBadge, useResource } from '@/ops/ui';

export default function TermSheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<TermSheet>(() => api.get<TermSheet>(ops(`/term-sheets/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/term-sheets">← Term sheets</Link>
      </p>
      <Loaded res={res} what="this term sheet">
        {(t) => <TermSheetDetail t={t} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function TermSheetDetail({ t, reload }: { t: TermSheet; reload: () => void }) {
  const { user, can } = useSession();
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
