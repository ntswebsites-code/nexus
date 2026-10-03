'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { CaStatusBadge, money2, OPTION_LABEL, shares, signed, terms, TYPE_LABEL, type CaDetail, type CaEntitlement } from '@/ops/corporate-actions';
import { useSession } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, PageHeader, useResource } from '@/ops/ui';

export default function CorporateActionPage() {
  const { id } = useParams<{ id: string }>();
  const ev = useResource<CaDetail>(() => api.get<CaDetail>(v1(`/corporate-actions/events/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/corporate-actions">← Corporate actions</Link>
      </p>
      <Loaded res={ev} what="this corporate action">
        {(e) => <Detail ev={e} reload={ev.reload} />}
      </Loaded>
    </>
  );
}

type Dialog = 'edit' | 'cancel' | { elect: CaEntitlement } | null;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ops-tile">
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </div>
  );
}

const clean = (v: string) => v.replace(/,/g, '').trim();

function Detail({ ev: e, reload }: { ev: CaDetail; reload: () => void }) {
  const { user } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const base = v1(`/corporate-actions/events/${encodeURIComponent(e.id)}`);
  const close = () => setDialog(null);
  const done = () => {
    close();
    reload();
  };
  const closed = e.status === 'PROCESSED' || e.status === 'CANCELLED';
  const hasCash = e.entitlements.some((x) => Number(x.cashAmount) !== 0);
  const hasShares = e.entitlements.some((x) => Number(x.sharesDelta) !== 0);

  return (
    <>
      <PageHeader
        kicker={`Corporate action · ${TYPE_LABEL[e.type] ?? e.type}`}
        title={
          <>
            {e.ref} {e.ticker} <CaStatusBadge status={e.status} />
          </>
        }
        subtitle={
          <>
            {e.securityName} · {terms(e)}
          </>
        }
        actions={
          <>
            {e.allowed.edit && (
              <button className="ops-btn" type="button" onClick={() => setDialog('edit')}>
                Edit terms
              </button>
            )}
            {!closed && (
              <ActionButton
                label={e.entitlementsAt ? 'Recalculate entitlements' : 'Calculate entitlements'}
                disabled={!e.allowed.calculate}
                title={e.allowed.calculateBlocker ?? 'Reads each portfolio position at the record date'}
                onRun={(key) => api.post(`${base}/entitlements/calculate`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {e.allowed.confirm && (
              <ActionButton
                label="Confirm"
                primary
                confirm={`Confirm ${e.ref}? The terms can no longer be edited, and someone else can then process it.`}
                onRun={(key) => api.post(`${base}/confirm`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {e.status === 'CONFIRMED' && (
              <ActionButton
                label="Process"
                primary
                disabled={!e.allowed.process}
                title={e.allowed.process ? 'Requires a fresh authenticator code' : (e.allowed.processBlocker ?? undefined)}
                confirm={`Process ${e.ref}? This applies ${hasCash ? `net cash of ${money2(e.totals.netCash)} ${e.currency}` : ''}${hasCash && hasShares ? ' and ' : ''}${hasShares ? 'the share changes' : ''} to the portfolio books. It cannot be undone.`}
                onRun={(key) => api.post(`${base}/process`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {e.allowed.cancel && (
              <button className="ops-btn danger" type="button" onClick={() => setDialog('cancel')}>
                Cancel action
              </button>
            )}
          </>
        }
      />

      {e.status === 'CANCELLED' && <Alert kind="warn">Cancelled on {formatDateTime(e.cancelledAt)}: {e.cancelReason}</Alert>}
      {e.status === 'PROCESSED' && (
        <Alert kind="ok">
          Processed by {e.processedByName ?? 'a second person'} on {formatDateTime(e.processedAt)}
          {e.processing?.effectiveDate ? `, effective ${formatDate(e.processing.effectiveDate)}` : ''}. {e.processing?.applied ?? 0} portfolio{e.processing?.applied === 1 ? '' : 's'} updated.
          {e.processing?.clamped ? ` ${e.processing.clamped} had sold down since the record date, so the change was limited to what they hold.` : ''}
        </Alert>
      )}
      {e.status === 'CONFIRMED' && !e.allowed.process && e.allowed.processBlocker && <Alert kind="info">{e.allowed.processBlocker}.</Alert>}
      {e.status === 'CONFIRMED' && e.allowed.process && <Alert kind="info">Ready to process. {e.makerId === user.id ? '' : 'A fresh authenticator code is required.'}</Alert>}
      {!closed && e.allowed.calculateBlocker && <Alert kind="info">{e.allowed.calculateBlocker}. Entitlements are calculated once it has.</Alert>}

      <div className="ops-tiles">
        <Tile label="Ex-date" value={formatDate(e.exDate)} hint={`Record ${formatDate(e.recordDate)}`} />
        <Tile label="Pay date" value={formatDate(e.payDate)} hint={e.electionDeadline ? `Elect by ${formatDate(e.electionDeadline)}` : 'No election'} />
        <Tile label="Entitled portfolios" value={String(e.entitlementCount)} hint={e.elective ? `${e.electedCount} elected` : e.entitlementsAt ? `Calculated ${formatDateTime(e.entitlementsAt)}` : 'Not calculated'} />
        <Tile label={`Net cash (${e.currency})`} value={e.entitlementCount ? signed(e.totals.netCash) : '—'} hint={e.entitlementCount ? `Tax ${money2(e.totals.tax)}` : undefined} />
        {hasShares && <Tile label="Share change" value={e.entitlementCount ? `${Number(e.totals.sharesDelta) > 0 ? '+' : ''}${shares(e.totals.sharesDelta)}` : '—'} hint={e.type === 'MERGER' ? `Plus ${shares(e.totals.targetShares)} ${e.targetTicker ?? ''}` : undefined} />}
      </div>

      <Card title={`Entitlements at the record date (${e.entitlements.length})`}>
        {e.entitlements.length === 0 ? (
          <Empty>{e.entitlementsAt ? 'No portfolio held this security at the record date.' : 'Not calculated yet. Calculate once the record date has passed.'}</Empty>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Portfolio</th>
                  <th className="r">Held</th>
                  {e.elective && <th>Election</th>}
                  <th className="r">Gross</th>
                  <th className="r">Tax</th>
                  <th className="r">Net cash</th>
                  <th className="r">Shares</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {e.entitlements.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.portfolioName}</strong>
                      <span className="ops-sub">{x.portfolioRef}</span>
                    </td>
                    <td className="r">{shares(x.quantity)}</td>
                    {e.elective && (
                      <td>
                        {x.option ? (OPTION_LABEL[x.option] ?? x.option) : '—'}
                        <span className="ops-sub">{x.elected ? `Elected by ${x.electedByName ?? 'staff'}` : x.defaulted ? 'Default applied' : 'Default if no election'}</span>
                      </td>
                    )}
                    <td className="r">{money2(x.grossAmount)}</td>
                    <td className="r">{money2(x.taxAmount)}</td>
                    <td className="r">{signed(x.cashAmount)}</td>
                    <td className="r">
                      {Number(x.sharesDelta) === 0 && Number(x.targetShares) === 0 ? '—' : `${Number(x.sharesDelta) > 0 ? '+' : ''}${shares(x.sharesDelta)}`}
                      {Number(x.targetShares) > 0 && <span className="ops-sub">+{shares(x.targetShares)} {e.targetTicker}</span>}
                      {Number(x.fraction) > 0 && <span className="ops-sub">fraction {Number(x.fraction)} not paid</span>}
                    </td>
                    <td>
                      <span className={`ops-badge ${x.status === 'APPLIED' ? 'green' : 'grey'}`}>{x.status.toLowerCase()}</span>
                      {x.note && <span className="ops-sub">{x.note}</span>}
                    </td>
                    <td className="r">
                      {e.allowed.elect && x.status === 'PENDING' && (
                        <button className="ops-btn small" type="button" onClick={() => setDialog({ elect: x })}>
                          Record election
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {e.entitlements.length > 0 && e.status !== 'PROCESSED' && <p className="ops-muted">Unelected holders get the default option when the action is processed. Positions sold after the record date still receive the entitlement; the change is limited to what is held.</p>}
      </Card>

      <Card title="Terms and controls">
        <DefinitionList
          items={[
            ['Security', `${e.ticker} · ${e.securityName}`],
            ['Type', TYPE_LABEL[e.type] ?? e.type],
            ['Terms', terms(e)],
            ['Currency', e.currency],
            ['Default option', e.defaultOption ? (OPTION_LABEL[e.defaultOption] ?? e.defaultOption) : '—'],
            ['Created by', `${e.makerName ?? '—'} · ${formatDateTime(e.createdAt)}`],
            ['Confirmed by', e.confirmedByName ? `${e.confirmedByName} · ${formatDateTime(e.confirmedAt)}` : '—'],
            ['Processed by', e.processedByName ? `${e.processedByName} · ${formatDateTime(e.processedAt)}` : '—'],
            ['Notes', e.description ?? '—'],
          ]}
        />
      </Card>

      <Card title="History">
        {e.timeline.length === 0 ? (
          <Empty>No history yet.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {e.timeline.map((t, i) => (
              <li key={i}>
                <strong>{t.action.replace('corp_action.', '').replace(/_/g, ' ')}</strong> · {t.actor} · {formatDateTime(t.at)}
                {t.reason ? <span className="ops-sub">{t.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog === 'edit' && <EditDialog ev={e} base={base} onClose={close} onDone={done} />}
      {dialog === 'cancel' && (
        <FormModal
          title={`Cancel ${e.ref}`}
          kicker="Corporate action"
          subtitle="Nothing is applied to the books. The reason is kept in the audit trail."
          submitLabel="Cancel action"
          danger
          onClose={close}
          onDone={done}
          onSubmit={(fd, key) => api.post(`${base}/cancel`, { reason: String(fd.get('reason') ?? '').trim() }, { idempotencyKey: key })}
        >
          <FieldGrid>
            <Field label="Reason" span={2} hint="Required, 5 or more characters">
              <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={1000} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {typeof dialog === 'object' && dialog && 'elect' in dialog && (
        <FormModal
          title={`Election: ${dialog.elect.portfolioName ?? ''}`}
          kicker={e.ref}
          subtitle={`${shares(dialog.elect.quantity)} held at the record date. Elections close ${e.electionDeadline ? formatDate(e.electionDeadline) : ''}; after that the default applies.`}
          submitLabel="Record election"
          onClose={close}
          onDone={done}
          onSubmit={(fd) => api.put(`${base}/elections`, { portfolioId: dialog.elect.portfolioId, option: String(fd.get('option') ?? '') })}
        >
          <FieldGrid>
            <Field label="Option" span={2}>
              <select className="ops-input" name="option" defaultValue={dialog.elect.option ?? e.options[0]}>
                {e.options.map((o) => (
                  <option key={o} value={o}>
                    {OPTION_LABEL[o] ?? o}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}

function EditDialog({ ev: e, base, onClose, onDone }: { ev: CaDetail; base: string; onClose: () => void; onDone: () => void }) {
  const f = (fd: FormData, n: string) => String(fd.get(n) ?? '').trim();
  return (
    <FormModal
      title={`Edit ${e.ref}`}
      kicker="Corporate action"
      subtitle="Only an announced action can be edited. Changing the terms clears any calculated entitlements."
      submitLabel="Save terms"
      wide
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd) => {
        const body: Record<string, unknown> = {};
        for (const k of ['exDate', 'recordDate', 'payDate'] as const) if (f(fd, k) && f(fd, k) !== e[k]) body[k] = f(fd, k);
        if (e.elective && f(fd, 'electionDeadline') !== (e.electionDeadline ?? '')) body.electionDeadline = f(fd, 'electionDeadline') || null;
        for (const k of ['rate', 'ratioNew', 'ratioOld'] as const) {
          const v = clean(f(fd, k));
          if (fd.has(k) && v !== (e[k] ?? '') && (v || e[k])) body[k] = v || null;
        }
        if (fd.has('withholdingPct') && clean(f(fd, 'withholdingPct')) && Number(clean(f(fd, 'withholdingPct'))) !== Number(e.withholdingPct)) body.withholdingPct = clean(f(fd, 'withholdingPct'));
        if (f(fd, 'description') !== (e.description ?? '')) body.description = f(fd, 'description') || null;
        if (Object.keys(body).length === 0) return Promise.reject(new Error('Nothing was changed.'));
        return api.patch(base, body);
      }}
    >
      <FieldGrid>
        <Field label="Ex-date">
          <input className="ops-input" type="date" name="exDate" defaultValue={e.exDate} required />
        </Field>
        <Field label="Record date">
          <input className="ops-input" type="date" name="recordDate" defaultValue={e.recordDate} required />
        </Field>
        <Field label="Pay date">
          <input className="ops-input" type="date" name="payDate" defaultValue={e.payDate} required />
        </Field>
        {e.elective && (
          <Field label="Election deadline">
            <input className="ops-input" type="date" name="electionDeadline" defaultValue={e.electionDeadline ?? ''} required />
          </Field>
        )}
        {e.type !== 'STOCK_SPLIT' && e.type !== 'BONUS_ISSUE' && (
          <Field label={e.type === 'RIGHTS_ISSUE' ? 'Subscription price per share' : 'Cash per share'}>
            <input className="ops-input" name="rate" inputMode="decimal" defaultValue={e.rate ?? ''} />
          </Field>
        )}
        {e.type !== 'CASH_DIVIDEND' && (
          <>
            <Field label="New shares">
              <input className="ops-input" name="ratioNew" inputMode="decimal" defaultValue={e.ratioNew ?? ''} />
            </Field>
            <Field label="For every held">
              <input className="ops-input" name="ratioOld" inputMode="decimal" defaultValue={e.ratioOld ?? ''} />
            </Field>
          </>
        )}
        {(e.type === 'CASH_DIVIDEND' || e.type === 'SCRIP_DIVIDEND') && (
          <Field label="Withholding tax, %">
            <input className="ops-input" name="withholdingPct" inputMode="decimal" defaultValue={e.withholdingPct} />
          </Field>
        )}
        <Field label="Notes" span={2}>
          <textarea className="ops-input" name="description" rows={2} maxLength={1000} defaultValue={e.description ?? ''} />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}
