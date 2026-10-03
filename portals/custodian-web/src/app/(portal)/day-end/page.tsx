'use client';

import { useState, type FormEvent } from 'react';
import { Badge, Card, ControlRow, Empty, Field, Loading, Modal, Notice, PageHead } from '@/components/ui';
import { can, useMe } from '@/components/Shell';
import { custodian, errorText, fmtDate, fmtDateTime, fmtNum, todayIso, useIdempotencyKey, useLoad, type Controls, type DayEnd } from '@/lib/api';

interface Detail {
  package: DayEnd;
  controls: Controls;
  review: { decision: string; note: string | null; at: string } | null;
}
interface TotalsRow {
  accountRef: string;
  currency: string | null;
  executions: number;
  quantity: string;
  notional: string;
  packages: { ref: string; status: string; currency: string }[];
}

export default function DayEndPage() {
  const me = useMe();
  const list = useLoad(() => custodian.get<{ items: DayEnd[] }>('/day-end'));
  const [modal, setModal] = useState<null | { kind: 'new'; supersede?: DayEnd } | { kind: 'detail'; row: DayEnd }>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const canPrepare = can(me, 'custodian.dayend.submit');
  const canApprove = can(me, 'custodian.dayend.approve');

  async function act(row: DayEnd, action: 'submit' | 'approve') {
    setFlash(null);
    try {
      await custodian.post(`/day-end/${row.id}/${action}`, {});
      setFlash({ kind: 'ok', text: action === 'submit' ? `${row.ref} submitted. An approver in your organisation must approve it.` : `${row.ref} approved and sent to Matanho for reconciliation.` });
      void list.reload();
    } catch (e) {
      setFlash({ kind: 'error', text: errorText(e) });
    }
  }

  return (
    <>
      <PageHead
        title="Day-end packages"
        sub="Closing cash, holdings value and control totals per account and date. The preparer submits; a different approver confirms; Matanho then reviews it for reconciliation."
        actions={
          canPrepare && (
            <button type="button" className="cx-btn primary" onClick={() => setModal({ kind: 'new' })}>
              New day-end package
            </button>
          )
        }
      />
      {flash && <Notice kind={flash.kind}>{flash.text}</Notice>}
      <Card>
        <Loading loading={list.loading && !list.data} error={list.error} />
        {list.data && list.data.items.length === 0 && <Empty>No day-end packages yet.</Empty>}
        {list.data && list.data.items.length > 0 && (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Ccy</th>
                  <th className="num">Closing cash</th>
                  <th className="num">Holdings value</th>
                  <th className="num">Trades</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.ref}</td>
                    <td>{fmtDate(p.statementDate)}</td>
                    <td>{p.accountRef}</td>
                    <td>{p.currency}</td>
                    <td className="num">{fmtNum(p.closingCash)}</td>
                    <td className="num">{fmtNum(p.holdingsMv)}</td>
                    <td className="num">{p.tradeCount}</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td className="cx-actions">
                      <button type="button" className="cx-btn sm" onClick={() => setModal({ kind: 'detail', row: p })}>
                        Controls and history
                      </button>
                      {canPrepare && p.status === 'Draft' && p.submittedById === me.user.id && (
                        <button type="button" className="cx-btn sm primary" onClick={() => void act(p, 'submit')}>
                          Submit
                        </button>
                      )}
                      {canApprove && me.role === 'approver' && p.status === 'Received' && p.submittedById !== me.user.id && (
                        <button type="button" className="cx-btn sm primary" onClick={() => void act(p, 'approve')}>
                          Approve
                        </button>
                      )}
                      {canPrepare && ['Received', 'Approved', 'Accepted'].includes(p.status) && (
                        <button type="button" className="cx-btn sm" onClick={() => setModal({ kind: 'new', supersede: p })}>
                          Supersede
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
      {modal?.kind === 'new' && (
        <NewPackage
          supersede={modal.supersede}
          accounts={me.counterparty.accounts}
          onClose={() => setModal(null)}
          onDone={(warnings) => {
            setModal(null);
            setFlash(warnings.length ? { kind: 'warn', text: `Draft saved. ${warnings.join('; ')}. Submit only one of them.` } : { kind: 'ok', text: 'Draft saved. Submit it when the control totals agree.' });
            void list.reload();
          }}
        />
      )}
      {modal?.kind === 'detail' && <PackageDetail row={modal.row} onClose={() => setModal(null)} />}
    </>
  );
}

function PackageDetail({ row, onClose }: { row: DayEnd; onClose: () => void }) {
  const d = useLoad(() => custodian.get<Detail>(`/day-end/${row.id}`));
  const h = useLoad(() => custodian.get<{ events: { action: string; reason: string | null; by: string; at: string }[] }>(`/day-end/${row.id}/history`));
  const p = d.data?.package ?? row;
  return (
    <Modal title={`${row.ref}: ${row.accountRef}, ${fmtDate(row.statementDate)}`} onClose={onClose} wide>
      <Loading loading={d.loading} error={d.error} />
      {d.data && (
        <>
          <p>
            <Badge value={p.status} /> Declared trade count {p.tradeCount}. File: {p.file ? `${p.file.name} (${Math.round(p.file.size / 1024)} KB)` : 'none (statement feed)'}.
          </p>
          {p.sha256 && (
            <p className="cx-mono" style={{ wordBreak: 'break-all' }}>
              SHA-256 {p.sha256}
            </p>
          )}
          {d.data.review && (
            <Notice kind={d.data.review.decision.toLowerCase().includes('reject') ? 'error' : 'ok'}>
              Matanho review: {d.data.review.decision}
              {d.data.review.note ? `. ${d.data.review.note}` : ''} ({fmtDateTime(d.data.review.at)})
            </Notice>
          )}
          <h3>Control totals against executions received</h3>
          <table className="cx-table">
            <thead>
              <tr>
                <th>Control</th>
                <th className="num">Declared</th>
                <th className="num">Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <ControlRow label="Trade count" declared={String(d.data.controls.tradeCount)} received={String(d.data.controls.executionsReceived)} ok={d.data.controls.matches} />
              {d.data.controls.quantity && <ControlRow label="Quantity" declared={d.data.controls.quantity.declared} received={d.data.controls.quantity.received} ok={d.data.controls.quantity.matches} />}
              {d.data.controls.notional && <ControlRow label="Notional" declared={d.data.controls.notional.declared} received={d.data.controls.notional.received} ok={d.data.controls.notional.matches} />}
            </tbody>
          </table>
        </>
      )}
      <h3>History</h3>
      <ul className="cx-timeline">
        {h.data?.events.map((e, i) => (
          <li key={i}>
            <strong>{e.action}</strong>
            {e.reason ? `: ${e.reason}` : ''}
            <br />
            <small>
              {e.by}, {fmtDateTime(e.at)}
            </small>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function NewPackage({ supersede, accounts, onClose, onDone }: { supersede?: DayEnd; accounts: string[]; onClose: () => void; onDone: (warnings: string[]) => void }) {
  const [d, setD] = useState({
    statementDate: supersede?.statementDate ?? todayIso(),
    accountRef: supersede?.accountRef ?? accounts[0] ?? '',
    currency: supersede?.currency ?? 'USD',
    closingCash: supersede?.closingCash ?? '',
    holdingsMv: supersede?.holdingsMv ?? '',
    tradeCount: String(supersede?.tradeCount ?? ''),
    tradeQuantity: supersede?.tradeQuantity ?? '',
    tradeNotional: supersede?.tradeNotional ?? '',
    note: '',
    supersedeReason: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [totals, setTotals] = useState<TotalsRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();
  const set = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }));

  async function loadTotals() {
    setErr(null);
    try {
      const r = await custodian.get<{ items: TotalsRow[] }>(`/control-totals?date=${d.statementDate}`);
      setTotals(r.items);
      const row = r.items.find((t) => t.accountRef === d.accountRef && (t.currency === d.currency || t.currency === null));
      if (row) setD((x) => ({ ...x, tradeCount: String(row.executions), tradeQuantity: row.executions ? row.quantity : '', tradeNotional: row.executions ? row.notional : '' }));
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!file) return setErr('Attach the official day-end file.');
    setBusy(true);
    setErr(null);
    const f = new FormData();
    for (const [k, v] of Object.entries(d)) if (String(v).trim()) f.append(k, String(v).trim());
    if (supersede) f.append('supersedesId', supersede.id);
    f.append('file', file);
    try {
      const r = await custodian.post<{ warnings?: string[] }>('/day-end', f, key.current());
      key.renew();
      onDone(r.warnings ?? []);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={supersede ? `Supersede ${supersede.ref}` : 'New day-end package'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {err && <Notice kind="error">{err}</Notice>}
        <div className="cx-form">
          <Field label="Statement date">
            <input required type="date" max={todayIso()} value={d.statementDate} disabled={!!supersede} onChange={(e) => set('statementDate', e.target.value)} />
          </Field>
          <Field label="Account">
            <select value={d.accountRef} disabled={!!supersede} onChange={(e) => set('accountRef', e.target.value)}>
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="Currency">
            <select value={d.currency} disabled={!!supersede} onChange={(e) => set('currency', e.target.value)}>
              {['USD', 'ZWG', 'ZAR'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Closing cash">
            <input required inputMode="decimal" value={d.closingCash} onChange={(e) => set('closingCash', e.target.value)} />
          </Field>
          <Field label="Holdings market value">
            <input required inputMode="decimal" value={d.holdingsMv} onChange={(e) => set('holdingsMv', e.target.value)} />
          </Field>
          <Field label="Trade count">
            <input required inputMode="numeric" value={d.tradeCount} onChange={(e) => set('tradeCount', e.target.value)} />
          </Field>
          <Field label="Total quantity (control)" hint="Optional; checked against executions received">
            <input inputMode="decimal" value={d.tradeQuantity} onChange={(e) => set('tradeQuantity', e.target.value)} />
          </Field>
          <Field label="Total notional (control)" hint="Optional; in the package currency">
            <input inputMode="decimal" value={d.tradeNotional} onChange={(e) => set('tradeNotional', e.target.value)} />
          </Field>
          <Field label="Official day-end file" hint="Stored encrypted; the SHA-256 is computed by the server">
            <input required type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          {supersede && (
            <div className="full">
              <Field label="Reason for superseding">
                <input required maxLength={255} value={d.supersedeReason} onChange={(e) => set('supersedeReason', e.target.value)} />
              </Field>
            </div>
          )}
          <div className="full">
            <Field label="Note (optional)">
              <input maxLength={2000} value={d.note} onChange={(e) => set('note', e.target.value)} />
            </Field>
          </div>
        </div>
        <p className="cx-actions">
          <button type="button" className="cx-btn" onClick={() => void loadTotals()}>
            Fill control totals from executions received
          </button>
          <button className="cx-btn primary" disabled={busy}>
            Save draft
          </button>
        </p>
        {totals && (
          <table className="cx-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Ccy</th>
                <th className="num">Executions</th>
                <th className="num">Quantity</th>
                <th className="num">Notional</th>
                <th>Packages</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t, i) => (
                <tr key={i}>
                  <td>{t.accountRef}</td>
                  <td>{t.currency ?? ''}</td>
                  <td className="num">{t.executions}</td>
                  <td className="num">{fmtNum(t.quantity, 2)}</td>
                  <td className="num">{fmtNum(t.notional)}</td>
                  <td>{t.packages.map((p) => `${p.ref} (${p.status})`).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>
    </Modal>
  );
}
