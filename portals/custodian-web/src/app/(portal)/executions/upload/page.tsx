'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@matanho/shared';
import { Badge, Card, ControlRow, Empty, Notice, PageHead, Field } from '@/components/ui';
import { can, useMe } from '@/components/Shell';
import { custodian, downloadText, errorText, fmtDateTime, fmtNum, fmtQty, useIdempotencyKey, useLoad } from '@/lib/api';

interface Report {
  valid: boolean;
  rowCount?: number;
  newCount?: number;
  duplicates?: { ref: string; tradeRef: string; status: string }[];
  errors?: { row: number; field?: string; message: string }[];
  control?: Record<string, { declared: string; actual: string; matches: boolean }>;
  totals?: { count: number; quantity: string; notional: string };
  message?: string;
}

interface Batch {
  id: string;
  ref: string;
  fileName: string;
  rowCount: number;
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  controlStatus: string;
  status: string;
  submittedAt: string;
}

const TEMPLATE = 'tradeRef,executionAt,accountRef,ticker,side,quantity,price,currency,settlementDate,broker\n';

export default function BulkUploadPage() {
  const me = useMe();
  const fileRef = useRef<HTMLInputElement>(null);
  const [declared, setDeclared] = useState({ declaredCount: '', declaredQuantity: '', declaredNotional: '' });
  const [report, setReport] = useState<Report | null>(null);
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();
  const batches = useLoad(() => custodian.get<{ items: Batch[] }>('/executions-batches'));
  const allowed = can(me, 'custodian.executions.submit');

  function form(dryRun: boolean) {
    const f = new FormData();
    const file = fileRef.current?.files?.[0];
    if (!file) throw new Error('Choose a CSV file first.');
    f.append('file', file);
    for (const [k, v] of Object.entries(declared)) if (v.trim()) f.append(k, v.trim());
    f.append('dryRun', dryRun ? 'true' : 'false');
    return f;
  }

  async function run(ev: FormEvent | null, dryRun: boolean) {
    ev?.preventDefault();
    setErr(null);
    setDone(null);
    setBusy(true);
    try {
      const body = form(dryRun);
      const r = await custodian.post<Report & { created?: unknown[] }>('/executions/bulk', body, dryRun ? crypto.randomUUID() : key.current());
      if (dryRun) {
        setReport(r);
        setCheckedName(fileRef.current?.files?.[0]?.name ?? null);
      } else {
        key.renew();
        setReport(null);
        setDone(`Uploaded: ${(r as unknown as { created: unknown[] }).created?.length ?? 0} executions stored.`);
        if (fileRef.current) fileRef.current.value = '';
        void batches.reload();
      }
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === 'object') {
        setReport({ ...(e.details as Report), valid: false, message: e.message });
        setCheckedName(fileRef.current?.files?.[0]?.name ?? null);
        if (!dryRun) void batches.reload();
      } else setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return <Notice kind="warn">Your role cannot submit executions.</Notice>;
  return (
    <>
      <PageHead
        title="Bulk upload"
        sub="Upload a CSV of executions. Every row is validated; one bad row or a control total that disagrees rejects the whole file and nothing is stored. Validate first, then upload."
        actions={
          <button type="button" className="cx-btn" onClick={() => downloadText('executions-template.csv', TEMPLATE)}>
            Download CSV template
          </button>
        }
      />
      {err && <Notice kind="error">{err}</Notice>}
      {done && <Notice kind="ok">{done}</Notice>}
      <Card title="File and declared control totals">
        <form onSubmit={(e) => void run(e, true)}>
          <div className="cx-form">
            <div className="full">
              <Field label="Executions CSV" hint={`Accounts you may use: ${me.counterparty.accounts.join(', ')}. Dates as ISO 8601; side BUY or SELL.`}>
                <input ref={fileRef} type="file" accept=".csv,text/csv" required onChange={() => setReport(null)} />
              </Field>
            </div>
            <Field label="Declared row count (optional)">
              <input inputMode="numeric" value={declared.declaredCount} onChange={(e) => setDeclared({ ...declared, declaredCount: e.target.value })} />
            </Field>
            <Field label="Declared total quantity (optional)">
              <input inputMode="decimal" value={declared.declaredQuantity} onChange={(e) => setDeclared({ ...declared, declaredQuantity: e.target.value })} />
            </Field>
            <Field label="Declared total notional (optional)" hint="Single-currency files only">
              <input inputMode="decimal" value={declared.declaredNotional} onChange={(e) => setDeclared({ ...declared, declaredNotional: e.target.value })} />
            </Field>
          </div>
          <p className="cx-actions">
            <button className="cx-btn" disabled={busy}>
              Validate file
            </button>
            <button type="button" className="cx-btn primary" disabled={busy || !report?.valid} onClick={() => void run(null, false)}>
              Upload validated file
            </button>
          </p>
        </form>
      </Card>

      {report && (
        <Card title={`Validation result${checkedName ? `: ${checkedName}` : ''}`}>
          {report.valid ? (
            <Notice kind="ok">
              The file is valid: {report.rowCount} rows, {report.newCount} new
              {report.duplicates?.length ? `, ${report.duplicates.length} already submitted (they will be skipped)` : ''}.
            </Notice>
          ) : (
            <Notice kind="error">{report.message ?? 'The file was rejected.'}</Notice>
          )}
          {report.totals && (
            <p>
              Totals in the file: {report.totals.count} rows, quantity {fmtQty(report.totals.quantity)}, notional {fmtNum(report.totals.notional)}.
            </p>
          )}
          {report.control && Object.keys(report.control).length > 0 && (
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Control</th>
                  <th className="num">Declared</th>
                  <th className="num">In file</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.control).map(([k, c]) => (
                  <ControlRow key={k} label={k} declared={c.declared} received={c.actual} ok={c.matches} />
                ))}
              </tbody>
            </table>
          )}
          {report.errors && report.errors.length > 0 && (
            <div className="cx-table-wrap">
              <table className="cx-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Field</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e, i) => (
                    <tr key={i} className="bad">
                      <td>{e.row}</td>
                      <td>{e.field ?? ''}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title="Recent uploads">
        {batches.data && batches.data.items.length === 0 && <Empty>No bulk uploads yet.</Empty>}
        {batches.data && batches.data.items.length > 0 && (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>File</th>
                  <th className="num">Rows</th>
                  <th className="num">Accepted</th>
                  <th className="num">Duplicates</th>
                  <th>Control totals</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {batches.data.items.map((b) => (
                  <tr key={b.id}>
                    <td>{b.ref}</td>
                    <td>{b.fileName}</td>
                    <td className="num">{b.rowCount}</td>
                    <td className="num">{b.acceptedCount}</td>
                    <td className="num">{b.duplicateCount}</td>
                    <td>{b.controlStatus}</td>
                    <td>
                      <Badge value={b.status} />
                    </td>
                    <td>{fmtDateTime(b.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
