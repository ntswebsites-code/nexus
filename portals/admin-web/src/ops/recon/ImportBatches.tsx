'use client';

import { useState, type FormEvent } from 'react';
import { api, apiRequest } from '../api';
import { Alert, Card, DateText, Empty, Field, FieldGrid, Loaded, optStr, str, useAction, useResource } from '../ui';
import { recon, useCounterparties } from './common';
import { today, yesterday, type CounterpartImport } from './types';

const FEED_LABEL: Record<CounterpartImport['feed'], string> = { POSITIONS: 'Positions', CORP_ACTIONS: 'Corporate actions', STATEMENT: 'Statement' };

/**
 * Import batches (FR-REC-017): every counterparty source, whether uploaded by staff or pulled by a connector, is one
 * batch with its channel, account, file name, record count, import time and SHA-256. The form pulls a position file from
 * the configured custodian-feed connector into the same pipeline.
 */
export function ImportBatches({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const batches = useResource<CounterpartImport[]>(() => api.get<CounterpartImport[]>(recon('/counterpart-imports')), []);
  const cps = useCounterparties();
  const [cp, setCp] = useState('');
  const action = useAction();
  const [result, setResult] = useState<string | null>(null);
  const accounts = cps.state === 'ok' ? cps.data.find((c) => c.id === cp)?.accounts ?? [] : [];

  async function pull(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { counterpartyId: str(fd, 'counterpartyId'), accountRef: str(fd, 'accountRef'), asOfDate: str(fd, 'asOfDate'), note: optStr(fd, 'note') };
    const r = await action.run((key) => apiRequest<{ batchRef: string; rows: number; connector: string }>('POST', recon('/connector-imports'), body, { idempotencyKey: key }));
    if (r) {
      setResult(`Batch ${r.batchRef}: ${r.rows} row${r.rows === 1 ? '' : 's'} pulled through the ${r.connector} connector.`);
      batches.reload();
      onChanged();
    }
  }

  return (
    <Card title="Import batches" actions={<button className="ops-btn small" type="button" onClick={batches.reload}>Refresh</button>}>
      <p className="ops-muted" style={{ marginTop: 0 }}>Manual uploads and connector pulls share one pipeline, so each source is traceable to its channel and hash.</p>
      <Loaded res={batches} what="import batches">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No import batches yet.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr><th>Batch</th><th>Channel</th><th>Feed</th><th>Account</th><th>Date</th><th>File</th><th className="r">Records</th><th>SHA-256</th><th>Imported</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.ref}</strong>{r.status === 'SUPERSEDED' && <span className="ops-sub">superseded</span>}</td>
                      <td>{r.source === 'CONNECTOR' ? `Connector (${r.connector ?? 'unknown'})` : 'Manual upload'}</td>
                      <td>{FEED_LABEL[r.feed]}<span className="ops-sub">{r.format}</span></td>
                      <td>{r.counterparty.name ?? r.counterparty.id}<span className="ops-sub">{r.accountRef}</span></td>
                      <td><DateText value={r.asOfDate} /></td>
                      <td>{r.filename}</td>
                      <td className="r">{r.recordCount}</td>
                      <td title={r.sha256}><code>{r.sha256.slice(0, 12)}…</code></td>
                      <td>{r.createdByName ?? '—'}<span className="ops-sub"><DateText value={r.createdAt} time /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {canManage ? (
        <form onSubmit={pull} style={{ marginTop: 14 }}>
          <FieldGrid>
            <Field label="Counterparty">
              <select className="ops-input" name="counterpartyId" required value={cp} onChange={(e) => setCp(e.target.value)}>
                <option value="">Choose</option>
                {(cps.state === 'ok' ? cps.data : []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Account">
              {accounts.length > 0 ? (
                <select className="ops-input" name="accountRef" required defaultValue="">
                  <option value="">Choose</option>
                  {accounts.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              ) : (
                <input className="ops-input" name="accountRef" required maxLength={64} />
              )}
            </Field>
            <Field label="Statement date">
              <input className="ops-input" type="date" name="asOfDate" required defaultValue={yesterday()} max={today()} />
            </Field>
            <Field label="Note (optional)">
              <input className="ops-input" name="note" maxLength={500} />
            </Field>
          </FieldGrid>
          <Alert>{action.error}</Alert>
          {result && <Alert kind="ok">{result}</Alert>}
          <button className="ops-btn" type="submit" disabled={action.busy}>{action.busy ? 'Pulling…' : 'Pull positions from the connector'}</button>
        </form>
      ) : (
        <Alert kind="info">Pulling from a connector needs recon.manage.</Alert>
      )}
    </Card>
  );
}
