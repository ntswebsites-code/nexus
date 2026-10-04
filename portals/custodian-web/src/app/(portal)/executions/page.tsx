'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Card, Empty, Field, Loading, Modal, Notice, PageHead } from '@/components/ui';
import { can, useMe } from '@/components/Shell';
import { custodian, errorText, fmtDate, fmtDateTime, fmtNum, fmtQty, useIdempotencyKey, useInitialParam, useLoad, type Execution, type StatusEvent } from '@/lib/api';

const STATUSES = ['Received', 'Matched', 'Exception', 'Queried', 'Superseded'];
const CURRENCIES = ['USD', 'ZWG', 'ZAR'];

type Draft = Record<string, string>;
const blank = (account: string): Draft => ({ tradeRef: '', executionAt: new Date().toISOString().slice(0, 16), accountRef: account, ticker: '', isin: '', side: 'BUY', quantity: '', price: '', currency: 'USD', settlementDate: '', broker: '', note: '' });

export default function ExecutionsPage() {
  const me = useMe();
  const [initStatus, ready] = useInitialParam('status');
  const [initNew] = useInitialParam('new');
  const [status, setStatus] = useState('');
  const [account, setAccount] = useState('');
  const [modal, setModal] = useState<null | { kind: 'new' } | { kind: 'amend' | 'cancel' | 'history'; row: Execution }>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const canSubmit = can(me, 'custodian.executions.submit');

  useEffect(() => {
    if (initStatus) setStatus(initStatus);
    if (initNew && canSubmit) setModal({ kind: 'new' });
  }, [initStatus, initNew, canSubmit]);

  const list = useLoad(
    () => custodian.get<{ items: Execution[] }>(`/executions?${new URLSearchParams({ ...(status ? { status } : {}), ...(account ? { accountRef: account } : {}) })}`),
    [status, account, ready],
  );
  const done = (msg: string) => {
    setModal(null);
    setFlash(msg);
    void list.reload();
  };

  return (
    <>
      <PageHead
        title="Executions"
        sub="Trade executions your organisation has reported. Received, queried and exception items can be amended or cancelled until a day-end package for the account and date is approved."
        actions={
          canSubmit && (
            <>
              <a className="cx-btn" href="/executions/upload">
                Bulk upload
              </a>
              <button type="button" className="cx-btn primary" onClick={() => setModal({ kind: 'new' })}>
                New execution
              </button>
            </>
          )
        }
      />
      {!canSubmit && <Notice kind="info">Your access is read-only: your role cannot submit, amend or cancel executions. An approver in your organisation can change your access under Users and roles.</Notice>}
      {flash && <Notice kind="ok">{flash}</Notice>}
      <Card>
        <div className="cx-filters">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Account">
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All</option>
              {me.counterparty.accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
        </div>
        <Loading loading={list.loading && !list.data} error={list.error} />
        {list.data && list.data.items.length === 0 && <Empty>No executions match.</Empty>}
        {list.data && list.data.items.length > 0 && (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Trade reference</th>
                  <th>Executed</th>
                  <th>Account</th>
                  <th>Trade</th>
                  <th className="num">Quantity</th>
                  <th className="num">Price</th>
                  <th>Settles</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((e) => (
                  <tr key={e.id}>
                    <td>{e.ref}</td>
                    <td>{e.tradeRef}</td>
                    <td>{fmtDateTime(e.executionAt)}</td>
                    <td>{e.accountRef}</td>
                    <td>
                      {e.side} {e.ticker}
                    </td>
                    <td className="num">{fmtQty(e.quantity)}</td>
                    <td className="num">
                      {fmtNum(e.price, 4)} {e.currency}
                    </td>
                    <td>{e.settlementDate ? fmtDate(e.settlementDate) : ''}</td>
                    <td>
                      <Badge value={e.status} />
                      {e.amendCount > 0 && <small> amended {e.amendCount}x</small>}
                    </td>
                    <td className="cx-actions">
                      <button type="button" className="cx-btn sm" onClick={() => setModal({ kind: 'history', row: e })}>
                        History
                      </button>
                      {canSubmit && e.amendable && (
                        <>
                          <button type="button" className="cx-btn sm" onClick={() => setModal({ kind: 'amend', row: e })}>
                            Amend
                          </button>
                          <button type="button" className="cx-btn sm danger" onClick={() => setModal({ kind: 'cancel', row: e })}>
                            Cancel
                          </button>
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
      {modal?.kind === 'new' && <NewExecution accounts={me.counterparty.accounts} onClose={() => setModal(null)} onDone={() => done('Execution submitted. It is now with Matanho operations for matching.')} />}
      {modal?.kind === 'amend' && <Amend row={modal.row} accounts={me.counterparty.accounts} onClose={() => setModal(null)} onDone={() => done(`${modal.row.ref} amended and returned to the matching queue.`)} />}
      {modal?.kind === 'cancel' && <Cancel row={modal.row} onClose={() => setModal(null)} onDone={() => done(`${modal.row.ref} cancelled.`)} />}
      {modal?.kind === 'history' && <History row={modal.row} onClose={() => setModal(null)} />}
    </>
  );
}

function inputs(d: Draft, set: (k: string, v: string) => void, accounts: string[], lockRef = false) {
  const f = (k: string) => ({ value: d[k] ?? '', onChange: (e: { target: { value: string } }) => set(k, e.target.value) });
  return (
    <div className="cx-form">
      {!lockRef && (
        <Field label="Trade reference">
          <input required maxLength={64} {...f('tradeRef')} />
        </Field>
      )}
      <Field label="Executed at" hint="Harare time of your trade confirmation">
        <input required type="datetime-local" {...f('executionAt')} />
      </Field>
      <Field label="Account">
        <select required {...f('accountRef')}>
          {accounts.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </Field>
      <Field label="Ticker">
        <input required maxLength={32} {...f('ticker')} />
      </Field>
      <Field label="ISIN (optional)">
        <input maxLength={12} {...f('isin')} />
      </Field>
      <Field label="Side">
        <select {...f('side')}>
          <option>BUY</option>
          <option>SELL</option>
        </select>
      </Field>
      <Field label="Quantity">
        <input required inputMode="decimal" {...f('quantity')} />
      </Field>
      <Field label="Price">
        <input required inputMode="decimal" {...f('price')} />
      </Field>
      <Field label="Currency">
        <select {...f('currency')}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Settlement date (optional)">
        <input type="date" {...f('settlementDate')} />
      </Field>
      <Field label="Broker (optional)">
        <input maxLength={120} {...f('broker')} />
      </Field>
      <Field label="Note (optional)">
        <input maxLength={2000} {...f('note')} />
      </Field>
    </div>
  );
}

const toIso = (local: string) => (local.length === 16 ? new Date(local).toISOString() : local);

function NewExecution({ accounts, onClose, onDone }: { accounts: string[]; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<Draft>(() => blank(accounts[0] ?? ''));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await custodian.post('/executions', { executions: [{ ...d, executionAt: toIso(d.executionAt!) }] }, key.current());
      key.renew();
      onDone();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Modal title="New execution" onClose={onClose} wide>
      <form onSubmit={submit}>
        {err && <Notice kind="error">{err}</Notice>}
        {inputs(d, (k, v) => setD({ ...d, [k]: v }), accounts)}
        <p className="cx-actions">
          <button className="cx-btn primary" disabled={busy}>
            Submit execution
          </button>
        </p>
      </form>
    </Modal>
  );
}

function Amend({ row, accounts, onClose, onDone }: { row: Execution; accounts: string[]; onClose: () => void; onDone: () => void }) {
  const orig: Draft = {
    executionAt: new Date(row.executionAt).toISOString().slice(0, 16),
    accountRef: row.accountRef,
    ticker: row.ticker,
    isin: row.isin ?? '',
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    currency: row.currency,
    settlementDate: row.settlementDate ?? '',
    broker: row.broker ?? '',
    note: row.note ?? '',
  };
  const [d, setD] = useState<Draft>(orig);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const patch: Record<string, string> = {};
    for (const k of Object.keys(orig)) if (d[k] !== orig[k]) patch[k] = k === 'executionAt' ? toIso(d[k]!) : d[k]!;
    if (!Object.keys(patch).length) return setErr('Change at least one field.');
    setBusy(true);
    setErr(null);
    try {
      await custodian.patch(`/executions/${row.id}`, { ...patch, reason }, key.current());
      key.renew();
      onDone();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Modal title={`Amend ${row.ref} (${row.tradeRef})`} onClose={onClose} wide>
      <form onSubmit={submit}>
        {err && <Notice kind="error">{err}</Notice>}
        {inputs(d, (k, v) => setD({ ...d, [k]: v }), accounts, true)}
        <div className="cx-form" style={{ marginTop: 12 }}>
          <div className="full">
            <Field label="Reason for the amendment" hint="Recorded in the audit trail and shown to Matanho operations">
              <input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        </div>
        <p className="cx-actions">
          <button className="cx-btn primary" disabled={busy}>
            Save amendment
          </button>
        </p>
      </form>
    </Modal>
  );
}

function Cancel({ row, onClose, onDone }: { row: Execution; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await custodian.post(`/executions/${row.id}/cancel`, { reason }, key.current());
      key.renew();
      onDone();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Modal title={`Cancel ${row.ref} (${row.tradeRef})`} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <Notice kind="error">{err}</Notice>}
        <Notice kind="warn">The execution leaves the matching queue. The trade reference cannot be reused.</Notice>
        <Field label="Reason for the cancellation">
          <input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="cx-actions">
          <button className="cx-btn danger" disabled={busy}>
            Cancel execution
          </button>
        </p>
      </form>
    </Modal>
  );
}

function History({ row, onClose }: { row: Execution; onClose: () => void }) {
  const h = useLoad(() => custodian.get<{ events: StatusEvent[] }>(`/executions/${row.id}/history`));
  return (
    <Modal title={`History of ${row.ref} (${row.tradeRef})`} onClose={onClose}>
      <Loading loading={h.loading} error={h.error} />
      <ul className="cx-timeline">
        {h.data?.events.map((e) => (
          <li key={e.id}>
            <strong>{e.action}</strong> {e.fromStatus ? `${e.fromStatus} to ` : ''}
            {e.toStatus}
            {e.reason ? `: ${e.reason}` : ''}
            <br />
            <small>
              {e.by}, {fmtDateTime(e.at)}
              {e.changes ? `. Changed: ${Object.keys(e.changes).join(', ')}` : ''}
            </small>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
