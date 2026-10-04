'use client';

import { useState } from 'react';
import { ApiError } from '@matanho/shared';
import { Badge, Card, Empty, Field, Loading, Modal, Notice, PageHead } from '@/components/ui';
import { can, useMe } from '@/components/Shell';
import { custodian, downloadText, errorText, fmtDate, fmtDateTime, fmtNum, fmtQty, useIdempotencyKey, useLoad } from '@/lib/api';

type Format = 'CSV' | 'MT940' | 'JSON';
interface FileRow {
  id: string;
  adapter: string;
  filename: string;
  format: string;
  accountRef: string | null;
  statementDate: string | null;
  currency: string | null;
  closingCash: string | null;
  tradesImported: number;
  tradesSkipped: number;
  holdingsCount: number;
  dayEndRef: string | null;
  status: string;
  warnings: string[];
  error: string | null;
  createdAt: string;
}
interface Holding {
  accountRef: string;
  statementDate: string;
  ticker: string;
  isin: string | null;
  quantity: string;
  price: string | null;
  marketValue: string | null;
  currency: string;
}
interface Check {
  format: string;
  problems: string[];
  statements: { accountRef: string; statementDate: string; currency: string | null; closingCash: string | null; holdings: number; holdingsMv: string; trades: number; newTrades: number; duplicateTrades: number; warnings: string[] }[];
}

export default function StatementsPage() {
  const me = useMe();
  const canUpload = can(me, 'custodian.dayend.submit');
  const feed = useLoad(() => custodian.get<{ mode: string; adapterError: string | null; files: FileRow[]; statements: { id: string; accountRef: string; statementDate: string; closingCash: string | null; tradeCount: number }[] }>('/statements'));
  const [account, setAccount] = useState('');
  const holdings = useLoad(() => custodian.get<{ date: string | null; items: Holding[] }>(`/holdings${account ? `?accountRef=${encodeURIComponent(account)}` : ''}`), [account]);
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [format, setFormat] = useState<Format | ''>('');
  const [check, setCheck] = useState<Check | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<FileRow | null>(null);
  const key = useIdempotencyKey();
  const body = () => ({ filename, content: text, ...(format ? { format } : {}) });

  async function pick(f: File | undefined) {
    setCheck(null);
    setOk(null);
    setErr(null);
    if (!f) return;
    if (f.size > 1_000_000) return setErr('The file is larger than 1 MB.');
    setFilename(f.name);
    setText(await f.text());
  }

  async function validate() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      setCheck(await custodian.post<Check>('/statements/validate', body()));
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === 'object') {
        const d = e.details as { problems?: string[]; statements?: Check['statements'] };
        setCheck({ format: format || 'auto', problems: d.problems ?? [e.message], statements: d.statements ?? [] });
      } else setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    setBusy(true);
    setErr(null);
    try {
      const r = await custodian.post<{ data: { statements: { tradesImported: number; holdings: number; dayEndRef: string | null }[] } }>('/statements', body(), key.current());
      key.renew();
      const s = r.data.statements;
      setOk(`Loaded ${s.length} statement${s.length === 1 ? '' : 's'}: ${s.reduce((n, x) => n + x.tradesImported, 0)} new trades, ${s.reduce((n, x) => n + x.holdings, 0)} holdings lines, day-end packages ${s.map((x) => x.dayEndRef).filter(Boolean).join(', ') || 'none'} awaiting approval.`);
      setCheck(null);
      setText('');
      setFilename('');
      void feed.reload();
      void holdings.reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function template(f: Format) {
    try {
      const t = await custodian.get<{ data: { filename: string; content: string } }>(`/statements/template/${f}`);
      downloadText(t.data.filename, t.data.content, 'text/plain');
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <>
      <PageHead
        title="Statements and holdings"
        sub={`Upload your custodian statement (CSV, MT940 or JSON). Trades, closing cash and holdings are loaded and a day-end package is created for approval. Statement channel: ${feed.data?.mode ?? '...'}.`}
        actions={(['CSV', 'MT940', 'JSON'] as Format[]).map((f) => (
          <button key={f} type="button" className="cx-btn sm" onClick={() => void template(f)}>
            {f} template
          </button>
        ))}
      />
      {err && <Notice kind="error">{err}</Notice>}
      {ok && <Notice kind="ok">{ok}</Notice>}
      {feed.data?.adapterError && <Notice kind="warn">{feed.data.adapterError}</Notice>}
      {!canUpload && <Notice kind="info">Your access is read-only: your role cannot upload statements. You can still see the files and holdings below.</Notice>}
      {canUpload && (
        <Card title="Upload a statement">
          <div className="cx-form">
            <Field label="Statement file">
              <input type="file" accept=".csv,.json,.sta,.mt940,.txt" onChange={(e) => void pick(e.target.files?.[0])} />
            </Field>
            <Field label="Format" hint="Detected from the content when left blank">
              <select value={format} onChange={(e) => setFormat(e.target.value as Format | '')}>
                <option value="">Detect</option>
                <option>CSV</option>
                <option>MT940</option>
                <option>JSON</option>
              </select>
            </Field>
          </div>
          <p className="cx-actions">
            <button type="button" className="cx-btn" disabled={busy || !text} onClick={() => void validate()}>
              Validate
            </button>
            <button type="button" className="cx-btn primary" disabled={busy || !check || check.problems.length > 0} onClick={() => void upload()}>
              Upload validated statement
            </button>
          </p>
          {check && check.problems.length > 0 && (
            <Notice kind="error">
              The statement was rejected:
              <ul>
                {check.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
          {check && check.problems.length === 0 && <Notice kind="ok">The statement is valid ({check.format}). Review the summary, then upload.</Notice>}
          {check && check.statements.length > 0 && (
            <div className="cx-table-wrap">
              <table className="cx-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Date</th>
                    <th>Ccy</th>
                    <th className="num">Closing cash</th>
                    <th className="num">Holdings</th>
                    <th className="num">Holdings value</th>
                    <th className="num">Trades (new)</th>
                    <th>Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {check.statements.map((s, i) => (
                    <tr key={i}>
                      <td>{s.accountRef}</td>
                      <td>{fmtDate(s.statementDate)}</td>
                      <td>{s.currency ?? ''}</td>
                      <td className="num">{s.closingCash ? fmtNum(s.closingCash) : ''}</td>
                      <td className="num">{s.holdings}</td>
                      <td className="num">{fmtNum(s.holdingsMv)}</td>
                      <td className="num">
                        {s.trades} ({s.newTrades})
                      </td>
                      <td>{s.warnings.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title="Statement files">
        <Loading loading={feed.loading && !feed.data} error={feed.error} />
        {feed.data && feed.data.files.length === 0 && <Empty>No statement files yet.</Empty>}
        {feed.data && feed.data.files.length > 0 && (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Format</th>
                  <th>Account</th>
                  <th>Date</th>
                  <th className="num">Trades</th>
                  <th className="num">Holdings</th>
                  <th>Day-end</th>
                  <th>Status</th>
                  <th>Loaded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {feed.data.files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.filename}</td>
                    <td>{f.format}</td>
                    <td>{f.accountRef ?? ''}</td>
                    <td>{f.statementDate ? fmtDate(f.statementDate) : ''}</td>
                    <td className="num">
                      {f.tradesImported}
                      {f.tradesSkipped ? ` (+${f.tradesSkipped} skipped)` : ''}
                    </td>
                    <td className="num">{f.holdingsCount}</td>
                    <td>{f.dayEndRef ?? ''}</td>
                    <td>
                      <Badge value={f.status} />
                      {f.error && <small> {f.error}</small>}
                    </td>
                    <td>{fmtDateTime(f.createdAt)}</td>
                    <td>
                      {f.status === 'Imported' && (
                        <button type="button" className="cx-btn sm" onClick={() => setView(f)}>
                          Holdings
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title={`Latest holdings${holdings.data?.date ? ` (statement of ${fmtDate(holdings.data.date)})` : ''}`}
        actions={
          <select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {me.counterparty.accounts.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        }
      >
        <HoldingsTable items={holdings.data?.items ?? []} />
      </Card>
      {view && <FileHoldings file={view} onClose={() => setView(null)} />}
    </>
  );
}

function HoldingsTable({ items }: { items: Holding[] }) {
  if (!items.length) return <Empty>No holdings reported yet.</Empty>;
  return (
    <div className="cx-table-wrap">
      <table className="cx-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Security</th>
            <th>ISIN</th>
            <th className="num">Quantity</th>
            <th className="num">Price</th>
            <th className="num">Market value</th>
            <th>Ccy</th>
          </tr>
        </thead>
        <tbody>
          {items.map((h) => (
            <tr key={`${h.accountRef}-${h.statementDate}-${h.ticker}`}>
              <td>{h.accountRef}</td>
              <td>{h.ticker}</td>
              <td>{h.isin ?? ''}</td>
              <td className="num">{fmtQty(h.quantity)}</td>
              <td className="num">{h.price ? fmtNum(h.price, 4) : ''}</td>
              <td className="num">{h.marketValue ? fmtNum(h.marketValue) : ''}</td>
              <td>{h.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileHoldings({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const r = useLoad(() => custodian.get<{ holdings: Holding[] }>(`/statements/files/${file.id}`));
  return (
    <Modal title={`Holdings in ${file.filename}`} onClose={onClose} wide>
      <Loading loading={r.loading} error={r.error} />
      {file.warnings.length > 0 && <Notice kind="warn">{file.warnings.join('; ')}</Notice>}
      {r.data && <HoldingsTable items={r.data.holdings} />}
    </Modal>
  );
}
