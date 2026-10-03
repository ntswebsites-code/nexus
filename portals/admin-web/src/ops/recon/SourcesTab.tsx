'use client';

import { useState, type FormEvent } from 'react';
import { api, apiRequest, apiUpload, qs } from '../api';
import { Alert, Card, DateText, Empty, Field, FieldGrid, Loaded, optStr, str, useAction, useResource, ConfirmDialog } from '../ui';
import { recon, useCounterparties } from './common';
import { FAMILIES, TOLERANCE_FIELDS, familyLabel, today, yesterday, type EffectiveTolerances, type FeedReceipt, type Tolerance } from './types';

/** What a run of this family on this date would use, and where each value comes from (BR-067). */
export function EffectiveTolerancePreview({ family, asOf, counterpartyId }: { family: string; asOf: string; counterpartyId: string }) {
  const res = useResource<EffectiveTolerances>(
    () => api.get<EffectiveTolerances>(recon(`/tolerances/effective${qs({ family, asOf, counterpartyId })}`)),
    [family, asOf, counterpartyId],
  );
  const fields = TOLERANCE_FIELDS.filter((f) => f.families.includes(family as never));
  if (!fields.length) return null;
  return (
    <div className="ops-muted" style={{ margin: '8px 0 12px' }}>
      {res.state === 'ok'
        ? fields.map((f) => (
            <div key={f.key}>
              <strong>{f.label}</strong>: {String(res.data.tolerances[f.key])} <span className="ops-sub" style={{ display: 'inline' }}>({res.data.sources[f.key]})</span>
            </div>
          ))
        : 'Loading the configured tolerances…'}
    </div>
  );
}

type FeedKind = 'positions' | 'ca';

function FeedForm({ kind, onDone }: { kind: FeedKind; onDone: () => void }) {
  const cps = useCounterparties();
  const [cp, setCp] = useState('');
  const action = useAction();
  const [result, setResult] = useState<string | null>(null);
  const accounts = cps.state === 'ok' ? cps.data.find((c) => c.id === cp)?.accounts ?? [] : [];
  const path = kind === 'positions' ? '/custody-positions' : '/custody-ca-notices';
  const help =
    kind === 'positions'
      ? 'CSV columns: ticker, quantity, isin (optional). One row per security; the file replaces any earlier file for the same account and date.'
      : 'CSV columns: ticker, ex_date, pay_date, quantity, cash_amount, currency, type (optional), external_ref (optional). Every row must pay on the file date.';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get('file');
    const csv = optStr(fd, 'csv');
    const out = new FormData();
    for (const k of ['counterpartyId', 'accountRef', 'asOfDate', 'note']) {
      const v = optStr(fd, k);
      if (v) out.append(k, v);
    }
    if (file instanceof File && file.size > 0) out.append('file', file, file.name);
    else if (csv) out.append('csv', csv);
    const r = await action.run((key) => apiUpload<{ rows: number; replaced: boolean; data: { version: number; sha256: string } }>('POST', recon(path), out, { idempotencyKey: key }));
    if (r) {
      setResult(`${r.rows} row${r.rows === 1 ? '' : 's'} ${r.replaced ? 'replaced the earlier file' : 'received'} (version ${r.data.version}, SHA-256 ${r.data.sha256.slice(0, 12)}…).`);
      form.reset();
      setCp('');
      onDone();
    }
  }

  return (
    <form onSubmit={submit}>
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
        <Field label={kind === 'positions' ? 'Statement date' : 'Pay date'}>
          <input className="ops-input" type="date" name="asOfDate" required defaultValue={yesterday()} max={today()} />
        </Field>
        <Field label="CSV file" hint={help}>
          <input className="ops-input" type="file" name="file" accept=".csv,text/csv,text/plain" />
        </Field>
      </FieldGrid>
      <Field label="Or paste CSV" hint="Used when no file is chosen.">
        <textarea className="ops-input" name="csv" rows={3} placeholder={kind === 'positions' ? 'ticker,quantity\nOKZ.ZW,100000' : 'ticker,ex_date,pay_date,quantity,cash_amount,currency'} />
      </Field>
      <Field label="Note (optional)">
        <input className="ops-input" name="note" maxLength={500} />
      </Field>
      <Alert>{action.error}</Alert>
      {result && <Alert kind="ok">{result}</Alert>}
      <button className="ops-btn primary" type="submit" disabled={action.busy}>{action.busy ? 'Uploading…' : kind === 'positions' ? 'Upload custody positions' : 'Upload corporate-action file'}</button>
    </form>
  );
}

function ToleranceForm({ onDone }: { onDone: () => void }) {
  const cps = useCounterparties();
  const [family, setFamily] = useState('TRADES');
  const action = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body: Record<string, unknown> = { family, effectiveFrom: str(fd, 'effectiveFrom'), counterpartyId: optStr(fd, 'counterpartyId') ?? null, note: optStr(fd, 'note') };
    for (const f of TOLERANCE_FIELDS.filter((x) => x.families.includes(family as never))) {
      const v = optStr(fd, f.key);
      if (v) body[f.key] = v;
    }
    const ok = await action.run((key) => api.post(recon('/tolerances'), body, { idempotencyKey: key }));
    if (ok) {
      form.reset();
      onDone();
    }
  }
  return (
    <form onSubmit={submit} style={{ marginTop: 14 }}>
      <FieldGrid>
        <Field label="Family">
          <select className="ops-input" value={family} onChange={(e) => setFamily(e.target.value)}>
            {FAMILIES.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Counterparty" hint="Blank: applies to every counterparty.">
          <select className="ops-input" name="counterpartyId" defaultValue="">
            <option value="">All counterparties</option>
            {(cps.state === 'ok' ? cps.data : []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Effective from" hint="Today or later. Earlier runs keep the values they were run with.">
          <input className="ops-input" type="date" name="effectiveFrom" required defaultValue={today()} min={today()} />
        </Field>
        {TOLERANCE_FIELDS.filter((f) => f.families.includes(family as never)).map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <input className="ops-input" name={f.key} inputMode="decimal" required />
          </Field>
        ))}
      </FieldGrid>
      <Field label="Reason (optional)">
        <input className="ops-input" name="note" maxLength={500} />
      </Field>
      <Alert>{action.error}</Alert>
      <button className="ops-btn primary" type="submit" disabled={action.busy} title="Needs recon.signoff; asks for your authentication code">{action.busy ? 'Saving…' : 'Set tolerance'}</button>
    </form>
  );
}

const show = (t: Tolerance) =>
  TOLERANCE_FIELDS.filter((f) => t[f.key] !== null && t[f.key] !== undefined)
    .map((f) => `${f.label.replace(/ \(.*\)/, '')} ${t[f.key]}`)
    .join(' · ');

/** Custodian source files (positions, corporate actions) with their receipts, and the effective-dated tolerance table. */
export function SourcesTab({ canManage, canSign }: { canManage: boolean; canSign: boolean }) {
  const feeds = useResource<FeedReceipt[]>(() => api.get<FeedReceipt[]>(recon('/feeds')), []);
  const tols = useResource<Tolerance[]>(() => api.get<Tolerance[]>(recon('/tolerances')), []);
  const del = useAction();
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  return (
    <>
      {withdrawId && (
        <ConfirmDialog
          title="Withdraw tolerance change"
          message="Withdraw this tolerance change?"
          confirmLabel="Withdraw"
          danger
          onCancel={() => setWithdrawId(null)}
          onConfirm={async () => {
            const id = withdrawId;
            setWithdrawId(null);
            await del.run(() => apiRequest('DELETE', recon(`/tolerances/${id}`)));
            tols.reload();
          }}
        />
      )}
      <Card title="Custodian position file">
        {canManage ? <FeedForm kind="positions" onDone={feeds.reload} /> : <Alert kind="info">Uploading source files needs recon.manage.</Alert>}
      </Card>
      <Card title="Custodian corporate-action file">
        {canManage ? <FeedForm kind="ca" onDone={feeds.reload} /> : <Alert kind="info">Uploading source files needs recon.manage.</Alert>}
      </Card>
      <Card title="Source receipts" actions={<button className="ops-btn small" type="button" onClick={feeds.reload}>Refresh</button>}>
        <Loaded res={feeds} what="source receipts">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No custodian files received yet. A positions or corporate-action run stays SOURCE_MISSING until its file arrives.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr><th>Date</th><th>Feed</th><th>Account</th><th className="r">Rows</th><th>Version</th><th>SHA-256</th><th>Received</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td><DateText value={r.asOfDate} /></td>
                        <td>{r.feed === 'POSITIONS' ? 'Positions' : 'Corporate actions'}</td>
                        <td>{r.counterparty.name ?? r.counterparty.id}<span className="ops-sub">{r.accountRef}</span></td>
                        <td className="r">{r.rowCount}</td>
                        <td>v{r.version}</td>
                        <td title={r.sha256}><code>{r.sha256.slice(0, 12)}…</code></td>
                        <td>{r.receivedByName ?? '—'}<span className="ops-sub"><DateText value={r.receivedAt} time /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      <Card title="Tolerances (effective-dated)" actions={<button className="ops-btn small" type="button" onClick={tols.reload}>Refresh</button>}>
        <p className="ops-muted" style={{ marginTop: 0 }}>
          A run uses, per field, the newest row in force on its date: counterparty-specific first, then global, then the built-in default. A change takes effect from its date and never alters earlier runs.
        </p>
        <Loaded res={tols} what="tolerances">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No tolerance configuration yet; the built-in defaults apply.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr><th>Family</th><th>Scope</th><th>Effective from</th><th>Values</th><th>Set by</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id}>
                        <td>{familyLabel(t.family)}</td>
                        <td>{t.counterparty?.name ?? 'All counterparties'}</td>
                        <td><DateText value={t.effectiveFrom} />{t.status === 'FUTURE' && <span className="ops-sub">not yet in force</span>}</td>
                        <td>{show(t)}{t.note && <span className="ops-sub">{t.note}</span>}</td>
                        <td>{t.createdByName ?? '—'}</td>
                        <td>
                          {canSign && t.status === 'FUTURE' && (
                            <button
                              className="ops-btn small danger"
                              type="button"
                              disabled={del.busy}
                              onClick={async () => {
                                setWithdrawId(t.id);
                              }}
                            >
                              Withdraw
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
        <Alert>{del.error}</Alert>
        {canSign ? <ToleranceForm onDone={tols.reload} /> : <Alert kind="info">Changing tolerances needs recon.signoff.</Alert>}
      </Card>
    </>
  );
}
