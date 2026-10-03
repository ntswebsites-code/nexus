'use client';

import { useState } from 'react';
import { api } from '../api';
import { Card, DateText, Empty, Loaded, useResource } from '../ui';
import { recon, Tone } from './common';
import { SEVERITIES, type Overview, type Source } from './types';

export function OverviewTab({ onOpenBreaks }: { onOpenBreaks: (filter: { family?: string; severity?: string }) => void }) {
  const [asOf, setAsOf] = useState('');
  const ov = useResource<Overview>(() => api.get<Overview>(recon(`/overview${asOf ? `?asOf=${asOf}` : ''}`)), [asOf]);
  const src = useResource<Source[]>(() => api.get<Source[]>(recon(`/sources${asOf ? `?asOf=${asOf}` : ''}`)), [asOf]);

  return (
    <>
      <Card
        title={
          <>
            Match rate by family
            {ov.state === 'ok' && (
              <span className="ops-sub" style={{ display: 'inline', marginLeft: 8 }}>
                as of <DateText value={ov.data.asOfDate} />
              </span>
            )}
          </>
        }
        actions={
          <input className="ops-input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="Reconciliation date" style={{ maxWidth: 170 }} />
        }
      >
        <Loaded res={ov} what="reconciliation overview">
          {(o) => (
            <>
              <div className="ops-tiles">
                {o.families.map((f) => (
                  <button key={f.family} type="button" className="ops-tile" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => onOpenBreaks({ family: f.family })}>
                    <h3>{f.label}</h3>
                    <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--ops-ink)' }}>{f.matchRate === null ? '—' : `${f.matchRate.toFixed(1)}%`}</p>
                    <p>
                      {f.runs === 0 ? 'No run for this date' : `${f.matched} matched, ${f.breaks} breaks in ${f.runs} run${f.runs === 1 ? '' : 's'}`}
                    </p>
                    <div className="ops-tile-meta">
                      {f.openBreaks} open {f.signedOff ? '· signed off' : f.sourceMissing ? '· source missing' : ''}
                    </div>
                  </button>
                ))}
              </div>
              <h3 style={{ margin: '4px 0 8px', fontSize: 13 }}>Open breaks by severity</h3>
              <div className="ops-tiles">
                {SEVERITIES.map((s) => (
                  <button key={s} type="button" className="ops-tile" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => onOpenBreaks({ severity: s })}>
                    <h3>
                      <Tone value={s} />
                    </h3>
                    <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--ops-ink)' }}>{o.openBySeverity[s] ?? 0}</p>
                  </button>
                ))}
                <div className="ops-tile">
                  <h3>Overdue</h3>
                  <p style={{ fontSize: 22, fontWeight: 800, color: o.overdue ? 'var(--ops-red)' : 'var(--ops-ink)' }}>{o.overdue}</p>
                  <p>Critical, or older than 3 days</p>
                </div>
              </div>
            </>
          )}
        </Loaded>
      </Card>

      <Card title="Source health" actions={<button className="ops-btn small" type="button" onClick={src.reload}>Refresh</button>}>
        <p className="ops-muted" style={{ marginTop: 0 }}>
          Counterparty submissions for the date. A mapped account with no day-end package is a source gap: it blocks the daily sign-off for the cash, holdings and count families.
        </p>
        <Loaded res={src} what="sources">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No counterparties are set up yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Counterparty</th>
                      <th>Accounts</th>
                      <th>Last day-end</th>
                      <th className="r">Executions</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.counterpartyId}>
                        <td>
                          <strong>{s.name}</strong>
                          <span className="ops-sub">{s.ref} · {s.type.toLowerCase()}{s.status !== 'ACTIVE' ? ` · ${s.status.toLowerCase()}` : ''}</span>
                        </td>
                        <td>
                          {s.accounts.length === 0 ? '—' : s.accounts.map((a) => (
                            <div key={a.accountRef}>
                              {a.accountRef} {a.dayEndReceived ? '✓' : '✗'}
                              <span className="ops-sub">{a.portfolio ? `→ ${a.portfolio.name}` : 'not mapped to a portfolio'}</span>
                            </div>
                          ))}
                        </td>
                        <td>
                          {s.lastDayEnd ? (
                            <>
                              <DateText value={s.lastDayEnd.statementDate} />
                              <span className="ops-sub">{s.lastDayEnd.ref}</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="r">{s.executionsToday}</td>
                        <td>
                          {s.status !== 'ACTIVE' ? <Tone value="CLOSED" /> : s.missingSource ? <Tone value="SOURCE_MISSING" /> : <Tone value="CLEAN" />}
                          {s.unmappedAccounts.length > 0 && <span className="ops-sub">{s.unmappedAccounts.length} unmapped</span>}
                        </td>
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
