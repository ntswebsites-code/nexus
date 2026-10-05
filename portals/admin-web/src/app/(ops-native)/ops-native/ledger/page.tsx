'use client';

import { useState } from 'react';
import { api, apiDownload, apiRequest, qs, v1 } from '@/ops/api';
import { AccessDenied, DataTable, label, m2, ReasonModal, Tag, Tile } from '@/ops/rp';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, optStr, PageHeader, str, useResource } from '@/ops/ui';

const L = (p: string) => v1(`/ledger${p}`);

interface Stamp {
  rate: string;
  rateDate: string | null;
  source: string;
  version: number;
  reportingAmount: string;
}
interface Line {
  entryId: string;
  entryType: string;
  txnDate: string;
  currency: string;
  amount: string;
  description: string;
  status: string;
  lineKind: 'ENTRY' | 'CORRECTION';
  stamp: Stamp | null;
  reportingAmount: string | null;
  clientRef: string | null;
  clientName: string | null;
  fundRef: string | null;
  fundName: string | null;
  correctsEntryId?: string;
}
interface LedgerPage {
  data: Line[];
  total: number;
  summary: { reporting: string; entries: number; unstamped: number; reportingTotal: string; byCurrency: { currency: string; total: string }[] };
}
interface Correction {
  id: string;
  ref: string;
  entryId: string;
  kind: 'FX_RESTAMP' | 'AMOUNT_ADJUSTMENT';
  currency: string;
  reportingCurrency: string;
  newRate: string | null;
  newRateDate: string | null;
  adjustmentAmount: string | null;
  reason: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  makerName: string | null;
  checkerName: string | null;
  decisionNote: string | null;
  createdAt: string;
  entry: { description: string; amount: string; txnDate: string } | null;
}

interface Filters {
  from: string;
  to: string;
  currency: string;
  stamped: string;
  reporting: string;
}

export default function LedgerPage() {
  const { can } = useSession();
  const canCorrect = useCan('ledger.correct');
  const canApprove = useCan('ledger.approve');
  const [f, setF] = useState<Filters>({ from: '', to: '', currency: '', stamped: '', reporting: 'USD' });
  const [propose, setPropose] = useState<Line | null>(null);
  const [rejecting, setRejecting] = useState<Correction | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const filt = qs({ from: f.from, to: f.to, currency: f.currency.toUpperCase(), stamped: f.stamped, reporting: f.reporting });
  const view = useResource<LedgerPage>(async () => {
    return apiRequest<LedgerPage>('GET', L(`/${filt}${filt ? '&' : '?'}limit=200`));
  }, [filt]);
  const corrs = useResource<Correction[]>(() => api.get<Correction[]>(L('/corrections')), []);

  if (!can('ledger.view')) return <AccessDenied kicker="Cash" title="Ledger and FX stamps" perm="ledger.view" />;

  const reload = () => {
    view.reload();
    corrs.reload();
  };

  return (
    <>
      <PageHeader
        kicker="Cash"
        title="Ledger and FX stamps"
        subtitle="The ledger is derived from calls, receipts, distributions and dealing requests and is never edited. Each entry is stamped once with the FX rate and date used for the reporting currency; a correction is proposed by one person, approved by another, and shown as its own line."
        actions={
          <>
            <button className="ops-btn" type="button" onClick={() => void apiDownload(L(`/export${qs({ from: f.from, to: f.to, currency: f.currency.toUpperCase(), stamped: f.stamped, reporting: f.reporting, format: 'csv' })}`), 'ledger.csv').catch((e: Error) => setExportErr(e.message))}>
              Export CSV
            </button>
            <button className="ops-btn" type="button" onClick={() => void apiDownload(L(`/export${qs({ from: f.from, to: f.to, currency: f.currency.toUpperCase(), stamped: f.stamped, reporting: f.reporting, format: 'xlsx' })}`), 'ledger.xlsx').catch((e: Error) => setExportErr(e.message))}>
              Export XLSX
            </button>
          </>
        }
      />
      <Alert>{exportErr}</Alert>

      <Card title="Filters">
        <FieldGrid>
          <Field label="From"><input className="ops-input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><input className="ops-input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Currency"><input className="ops-input" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} placeholder="All" /></Field>
          <Field label="Reporting currency"><input className="ops-input" maxLength={3} value={f.reporting} onChange={(e) => setF({ ...f, reporting: e.target.value.toUpperCase() || 'USD' })} /></Field>
          <Field label="FX stamp">
            <select className="ops-input" value={f.stamped} onChange={(e) => setF({ ...f, stamped: e.target.value })}>
              <option value="">All</option>
              <option value="yes">Stamped</option>
              <option value="no">Not stamped</option>
            </select>
          </Field>
        </FieldGrid>
      </Card>

      <Loaded res={view} what="the ledger">
        {(v) => (
          <>
            <div className="ops-tiles">
              <Tile label="Entries" value={v.summary.entries} />
              <Tile label="Awaiting an FX stamp" value={v.summary.unstamped} hint="Entries not in the reporting currency" />
              <Tile label={`Total in ${v.summary.reporting}`} value={m2(v.summary.reportingTotal)} />
            </div>
            <Card
              title={`Entries (${v.total})`}
              actions={
                <ActionButton
                  label="Stamp unstamped entries"
                  requires="ledger.correct"
                  disabled={v.summary.unstamped === 0}
                  title="Looks up the rate at or before each entry's date; existing stamps are never touched"
                  onRun={(key) => api.post(L('/stamp'), { reporting: f.reporting, ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) }, { idempotencyKey: key })}
                  onDone={reload}
                />
              }
            >
              {v.data.length === 0 ? (
                <Empty>No ledger entries match these filters.</Empty>
              ) : (
                <DataTable head={['Date', 'Type', 'Client', 'Fund', 'Description', 'Ccy', 'Amount', `In ${v.summary.reporting}`, 'FX stamp', '']}>
                  {v.data.map((l) => (
                    <tr key={l.entryId}>
                      <td>{formatDate(l.txnDate)}</td>
                      <td><Tag value={l.lineKind === 'CORRECTION' ? 'CORRECTION' : l.entryType} /></td>
                      <td>{l.clientName ?? l.clientRef ?? ''}</td>
                      <td>{l.fundName ?? l.fundRef ?? ''}</td>
                      <td>{l.description}</td>
                      <td>{l.currency}</td>
                      <td className="r">{m2(l.amount)}</td>
                      <td className="r">{l.reportingAmount ? m2(l.reportingAmount) : 'No stamp'}</td>
                      <td>{l.stamp ? `${l.stamp.rate} on ${formatDate(l.stamp.rateDate)} (v${l.stamp.version}, ${label(l.stamp.source)})` : l.currency === v.summary.reporting ? 'Not needed' : '—'}</td>
                      <td>{canCorrect && l.lineKind === 'ENTRY' && <button className="ops-btn small" type="button" onClick={() => setPropose(l)}>Propose correction</button>}</td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>
          </>
        )}
      </Loaded>

      <Card title="Corrections">
        <Loaded res={corrs} what="corrections">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No corrections have been proposed.</Empty>
            ) : (
              <DataTable head={['Ref', 'Entry', 'Kind', 'Change', 'Reason', 'Status', 'Proposed by', '']}>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.ref}</strong></td>
                    <td>{c.entry?.description ?? c.entryId}</td>
                    <td>{c.kind === 'FX_RESTAMP' ? 'FX restamp' : 'Amount adjustment'}</td>
                    <td>{c.kind === 'FX_RESTAMP' ? `${c.newRate} on ${formatDate(c.newRateDate)}` : `${m2(c.adjustmentAmount)} ${c.currency}`}</td>
                    <td>{c.reason}{c.decisionNote ? <span className="ops-sub">{c.decisionNote}</span> : null}</td>
                    <td><Tag value={c.status} /></td>
                    <td>{c.makerName ?? ''}<span className="ops-sub">{formatDateTime(c.createdAt)}</span></td>
                    <td>
                      {c.status === 'PENDING_APPROVAL' && (
                        <span className="ops-actions">
                          <ActionButton label="Approve" primary requires="ledger.approve" title={canApprove ? 'Needs a different person from the proposer and a step-up code' : undefined} onRun={(key) => api.post(L(`/corrections/${c.id}/approve`), {}, { idempotencyKey: key })} onDone={reload} />
                          <button className="ops-btn danger" type="button" disabled={!canApprove} title={canApprove ? undefined : 'Needs ledger.approve'} onClick={() => setRejecting(c)}>Reject</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )
          }
        </Loaded>
      </Card>

      {rejecting && <ReasonModal title={`Reject ${rejecting.ref}`} submitLabel="Reject" danger onClose={() => setRejecting(null)} onSubmit={(reason, key) => api.post(L(`/corrections/${rejecting.id}/reject`), { reason }, { idempotencyKey: key })} onDone={() => { setRejecting(null); reload(); }} />}
      {propose && <ProposeModal line={propose} reporting={f.reporting} onClose={() => setPropose(null)} onDone={() => { setPropose(null); reload(); }} />}
    </>
  );
}

function ProposeModal({ line, reporting, onClose, onDone }: { line: Line; reporting: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'FX_RESTAMP' | 'AMOUNT_ADJUSTMENT'>(line.currency === reporting ? 'AMOUNT_ADJUSTMENT' : 'FX_RESTAMP');
  return (
    <FormModal
      title={`Propose a correction to ${line.description}`}
      submitLabel="Submit for approval"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd, key) =>
        api.post(
          L('/corrections'),
          kind === 'FX_RESTAMP'
            ? { entryId: line.entryId, kind, reporting, newRate: str(fd, 'newRate'), newRateDate: str(fd, 'newRateDate'), reason: str(fd, 'reason') }
            : { entryId: line.entryId, kind, reporting, adjustmentAmount: str(fd, 'adjustmentAmount'), reason: optStr(fd, 'reason') ?? '' },
          { idempotencyKey: key },
        )
      }
    >
      <FieldGrid>
        <Field label="Kind">
          <select className="ops-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {line.currency !== reporting && <option value="FX_RESTAMP">FX restamp at a stated rate</option>}
            <option value="AMOUNT_ADJUSTMENT">Amount adjustment (separate line)</option>
          </select>
        </Field>
        {kind === 'FX_RESTAMP' ? (
          <>
            <Field label={`New rate (${line.currency} to ${reporting})`}><input className="ops-input" name="newRate" inputMode="decimal" required /></Field>
            <Field label="Rate date"><input className="ops-input" type="date" name="newRateDate" required /></Field>
          </>
        ) : (
          <Field label={`Adjustment (${line.currency}, signed)`}><input className="ops-input" name="adjustmentAmount" inputMode="decimal" required /></Field>
        )}
        <Field label="Reason" hint="Recorded in the audit trail" span={2}>
          <textarea className="ops-input" name="reason" rows={3} minLength={5} maxLength={500} required />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}
