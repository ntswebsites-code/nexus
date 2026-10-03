'use client';

import { useState } from 'react';
import { api, qs } from '../api';
import { Alert, Card, DateText, Empty, FormModal, Field, Loaded, optStr, useResource } from '../ui';
import { recon, reconFull, Tone, useCounterparties } from './common';
import { FAMILIES, yesterday, type Readiness, type Signoff } from './types';

export function SignoffTab({ canSign, stamp, onOpenBreak, onChanged }: { canSign: boolean; stamp: number; onOpenBreak: (id: string) => void; onChanged: () => void }) {
  const [family, setFamily] = useState('TRADES');
  const [date, setDate] = useState(yesterday());
  const [cp, setCp] = useState('');
  const [signing, setSigning] = useState(false);
  const cps = useCounterparties();
  const ready = useResource<Readiness>(() => api.get<Readiness>(recon(`/signoffs/readiness${qs({ family, asOf: date, counterpartyId: cp })}`)), [family, date, cp, stamp]);
  const history = useResource<Signoff[]>(() => api.get<Signoff[]>(recon('/signoffs?limit=30')), []);

  const refresh = () => {
    ready.reload();
    history.reload();
    onChanged();
  };

  return (
    <>
      <Card title="Daily sign-off">
        <p className="ops-muted" style={{ marginTop: 0 }}>
          One independent checker signs each family and date. Sign-off is blocked while a Critical or High break is open or a scheduled source is missing, and it cannot be done by the person who ran the matching or resolved a break. It asks for your authentication code.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <select className="ops-input" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Family" style={{ maxWidth: 200 }}>
            {FAMILIES.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <input className="ops-input" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ maxWidth: 170 }} />
          <select className="ops-input" value={cp} onChange={(e) => setCp(e.target.value)} aria-label="Counterparty" style={{ maxWidth: 220 }}>
            <option value="">All counterparties</option>
            {(cps.state === 'ok' ? cps.data : []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <Loaded res={ready} what="sign-off readiness">
          {(r) => (
            <>
              {r.signedOff ? (
                <Alert kind="ok">Signed off by {r.signedOff.signedByName ?? 'a checker'} on <DateText value={r.signedOff.signedAt} time />.</Alert>
              ) : r.ready ? (
                <Alert kind="ok">Ready to sign: no Critical or High breaks are open and every scheduled source has arrived.{r.openOther ? ` ${r.openOther} lower-severity break(s) remain open and are carried forward.` : ''}</Alert>
              ) : (
                <Alert kind="warn">Not ready: {r.reasons.join('; ')}.</Alert>
              )}
              {r.runs.length > 0 && (
                <p className="ops-muted">
                  Runs: {r.runs.map((x) => `${x.ref} (${x.status.toLowerCase().replace(/_/g, ' ')}, ${x.runByName ?? '?'})`).join(', ')}
                </p>
              )}
              {r.openMaterial.length > 0 && (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Blocking break</th><th>Detail</th><th>Severity</th><th>Status</th></tr></thead>
                    <tbody>
                      {r.openMaterial.map((b) => (
                        <tr key={b.id}>
                          <td><button className="ops-btn small" type="button" onClick={() => onOpenBreak(b.id)}>{b.ref}</button></td>
                          <td>{b.label}</td>
                          <td><Tone value={b.severity} /></td>
                          <td><Tone value={b.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {r.missingSources.length > 0 && (
                <Alert kind="warn">Missing day-end package: {r.missingSources.map((m) => `${m.counterpartyRef}/${m.accountRef}`).join(', ')}.</Alert>
              )}
              {!r.independent && !r.signedOff && <Alert kind="info">You ran this matching or resolved one of its breaks, so a different person must sign it off.</Alert>}
              <div style={{ marginTop: 10 }}>
                <button className="ops-btn primary" type="button" disabled={!canSign || !r.canSign || !!r.signedOff} onClick={() => setSigning(true)} title={canSign ? undefined : 'Your role does not include recon.signoff'}>
                  Sign off {FAMILIES.find((f) => f.key === family)?.label.toLowerCase()} for {date}
                </button>
              </div>
              {signing && (
                <FormModal
                  kicker="Daily sign-off"
                  title={`Sign off ${FAMILIES.find((f) => f.key === family)?.label} for ${date}`}
                  subtitle="This records you as the independent checker. You will be asked for your authentication code."
                  submitLabel="Sign off"
                  onClose={() => setSigning(false)}
                  onDone={refresh}
                  onSubmit={(fd) => reconFull('POST', '/signoffs', { family, asOfDate: date, counterpartyId: cp || null, note: optStr(fd, 'note') })}
                >
                  <Field label="Note (optional)">
                    <input className="ops-input" name="note" maxLength={500} />
                  </Field>
                </FormModal>
              )}
            </>
          )}
        </Loaded>
      </Card>

      <Card title="Sign-off history" actions={<button className="ops-btn small" type="button" onClick={history.reload}>Refresh</button>}>
        <Loaded res={history} what="sign-offs">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No days have been signed off yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Date</th><th>Family</th><th>Scope</th><th>Signed by</th><th>Note</th></tr></thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id}>
                        <td><DateText value={s.asOfDate} /></td>
                        <td>{s.familyLabel}</td>
                        <td>{s.counterparty?.name ?? 'All counterparties'}</td>
                        <td>{s.signedByName ?? '—'}<span className="ops-sub"><DateText value={s.signedAt} time /></span></td>
                        <td>{s.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
    </>
  );
}
