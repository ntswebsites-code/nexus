'use client';

import { useState } from 'react';
import { api, apiRequest, qs, v1 } from '../api';
import { ActionButton, Alert, Card, DateText, Empty, Loaded, useResource } from '../ui';
import { Tone, useCounterparties, usePortfolioOptions } from '../recon/common';
import { today, type GatesResponse, type PullResponse, type SettlementFailsResponse } from './types';

const oc = (path: string) => v1(`/ops-controls${path}`);

// ------------------------------------------------------------------ settlement fails

export function SettlementFailsTab({ canManage, stamp, onChanged }: { canManage: boolean; stamp: number; onChanged: () => void }) {
  const [asOf, setAsOf] = useState(today());
  const [showAll, setShowAll] = useState(false);
  const res = useResource<SettlementFailsResponse>(() => apiRequest<SettlementFailsResponse>('GET', oc(`/settlement-fails${qs({ asOf, status: showAll ? 'all' : 'open' })}`)), [asOf, showAll, stamp]);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <Card
        title="Settlement fails"
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="ops-input" type="date" value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value)} aria-label="As of" style={{ maxWidth: 160 }} />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include cleared
            </label>
            <ActionButton
              label="Refresh detection"
              disabled={!canManage}
              title={canManage ? 'Runs the settlement-fails matching for the date' : 'Your role does not include recon.manage'}
              onRun={async (key) => {
                const r = await apiRequest<{ data: { ref: string; breakCount: number; matchedCount: number } }>('POST', v1('/recon/runs'), { family: 'SETTLEMENT_FAILS', asOfDate: asOf }, { idempotencyKey: key });
                setMsg(`${r.data.ref}: ${r.data.matchedCount} on time or settled, ${r.data.breakCount} failing.`);
              }}
              onDone={onChanged}
            />
          </div>
        }
      >
        <p className="ops-muted" style={{ marginTop: 0 }}>
          Filled orders that have not settled after their expected settlement date (the custodian's date, else trade date plus two days) plus the grace days. Each fail is a break on the reconciliation register: work it from the Reconciliations page. Critical and High fails block NAV release.
        </p>
        {msg && <Alert kind="ok">{msg}</Alert>}
        <Loaded res={res} what="settlement fails">
          {({ data, summary }) => (
            <>
              {summary.stale && <Alert kind="warn">{summary.lastRun ? `The last detection ran for ${summary.lastRun.asOfDate}, so the list may be out of date.` : 'Detection has not run yet.'} Use "Refresh detection".</Alert>}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
                <div><strong>{summary.open}</strong><div className="ops-muted">open fails</div></div>
                <div><strong>{summary.material}</strong><div className="ops-muted">Critical or High</div></div>
                <div><strong>{summary.oldestDaysLate}d</strong><div className="ops-muted">oldest</div></div>
                {summary.byBucket.map((b) => (
                  <div key={b.key}><strong>{b.count}</strong><div className="ops-muted">{b.key} days late</div></div>
                ))}
              </div>
              {summary.byCounterparty.length > 0 && (
                <p className="ops-muted">By counterparty: {summary.byCounterparty.map((c) => `${c.key} (${c.count})`).join(', ')}. By security: {summary.byTicker.map((c) => `${c.key} (${c.count})`).join(', ')}.</p>
              )}
              {data.length === 0 ? (
                <Empty>No settlement fails for this date.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Order</th><th>Security</th><th className="r">Quantity</th><th>Traded</th><th>Expected</th><th className="r">Days late</th><th>Counterparty</th><th>Portfolio</th><th>Severity</th><th>Break</th></tr></thead>
                    <tbody>
                      {data.map((f) => (
                        <tr key={f.id}>
                          <td>{f.orderRef}<span className="ops-sub">{f.side}</span></td>
                          <td>{f.ticker}</td>
                          <td className="r">{f.quantity}</td>
                          <td><DateText value={f.tradeDate} /></td>
                          <td><DateText value={f.expectedSettlement} /><span className="ops-sub">{f.expectedFrom}</span></td>
                          <td className="r">{f.daysLate}</td>
                          <td>{f.counterparty?.name ?? '—'}<span className="ops-sub">{f.account ?? ''}</span></td>
                          <td>{f.portfolio?.name ?? '—'}</td>
                          <td><Tone value={f.severity} /></td>
                          <td><a href={`/ops-native/reconciliation?break=${f.id}`}>{f.ref}</a><span className="ops-sub"><Tone value={f.status} />{f.owner ? ` ${f.owner}` : ''}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ close gates

export function GatesTab() {
  const portfolios = usePortfolioOptions();
  const [portfolioId, setPortfolioId] = useState('');
  const [periodEnd, setPeriodEnd] = useState(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0)).toISOString().slice(0, 10));
  const [type, setType] = useState<'cash' | 'accounting'>('cash');
  const res = useResource<GatesResponse | null>(() => (portfolioId ? api.get<GatesResponse>(oc(`/close-gates${qs({ portfolioId, periodEnd, type })}`)) : Promise.resolve(null)), [portfolioId, periodEnd, type]);

  return (
    <Card title="Period-close gates">
      <p className="ops-muted" style={{ marginTop: 0 }}>
        The cash and accounting period closes refuse to close until the period-end NAV is released and the reconciliation families are signed off, and list every blocker. This shows the same gates ahead of time.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="ops-input" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} aria-label="Portfolio" style={{ maxWidth: 260 }}>
          <option value="">Choose a portfolio</option>
          {(portfolios.state === 'ok' ? portfolios.data : []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input className="ops-input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Period end" style={{ maxWidth: 170 }} />
        <select className="ops-input" value={type} onChange={(e) => setType(e.target.value as 'cash' | 'accounting')} aria-label="Close" style={{ maxWidth: 160 }}>
          <option value="cash">Cash close</option>
          <option value="accounting">Accounting close</option>
        </select>
      </div>
      <Loaded res={res} what="gates">
        {(g) =>
          !g ? (
            <Empty>Choose a portfolio and the period end.</Empty>
          ) : (
            <>
              {!g.enabled && <Alert kind="info">The close gates are switched off by the policy close_gates.</Alert>}
              <Alert kind={g.canClose ? 'ok' : 'warn'}>{g.canClose ? 'These gates are clear. The close can still be blocked by its own checklist.' : `${g.blockers.length} blocker${g.blockers.length === 1 ? '' : 's'} on these gates.`}</Alert>
              {g.items.map((i) => (
                <div key={i.key} style={{ marginBottom: 10 }}>
                  <strong>{i.label}</strong> <Tone value={i.ok ? 'MATCHED' : 'BREAKS'} />
                  <div className="ops-muted">{i.detail}</div>
                  {i.blockers.length > 0 && (
                    <ul style={{ margin: '4px 0 0 18px' }}>
                      {i.blockers.map((b) => (<li key={b}>{b}</li>))}
                    </ul>
                  )}
                </div>
              ))}
            </>
          )
        }
      </Loaded>
    </Card>
  );
}

// ------------------------------------------------------------------ positions through the adapter

export function PositionsPullTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const cps = useCounterparties();
  const [cp, setCp] = useState('');
  const [date, setDate] = useState(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  const [out, setOut] = useState<PullResponse | null>(null);

  return (
    <Card title="Custody positions from the custodian feed">
      <p className="ops-muted" style={{ marginTop: 0 }}>
        Reads the custodian's statement for the date through the custodian-feed integration (file drop, fake or live, as configured), stores the position quantities as a source receipt, and matches them against the book in the positions-vs-custody reconciliation. Pulling the same positions again changes nothing.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="ops-input" value={cp} onChange={(e) => setCp(e.target.value)} aria-label="Counterparty" style={{ maxWidth: 240 }}>
          <option value="">All mapped custodians</option>
          {(cps.state === 'ok' ? cps.data : []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <input className="ops-input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ maxWidth: 170 }} />
        <ActionButton
          label="Pull positions and match"
          primary
          disabled={!canManage}
          title={canManage ? undefined : 'Your role does not include recon.manage'}
          onRun={async (key) => {
            const r = await apiRequest<{ data: PullResponse }>('POST', oc('/custody-positions/pull'), { asOfDate: date, counterpartyId: cp || undefined, run: true }, { idempotencyKey: key });
            setOut(r.data);
          }}
          onDone={onChanged}
        />
      </div>
      {out && (
        <>
          <Alert kind="info">Adapter: {out.adapter}. {out.run ? `Run ${out.run.ref}: ${out.run.matchedCount} matched, ${out.run.breakCount} break${out.run.breakCount === 1 ? '' : 's'}.` : out.runError ? `Matching did not run: ${out.runError}` : 'Matching was not run.'}</Alert>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Custodian</th><th>Account</th><th>Result</th><th className="r">Positions</th><th>Note</th></tr></thead>
              <tbody>
                {out.results.map((r) => (
                  <tr key={`${r.counterpartyRef}${r.accountRef}`}>
                    <td>{r.counterpartyRef}</td>
                    <td>{r.accountRef}</td>
                    <td><Tone value={r.status === 'received' || r.status === 'unchanged' ? 'MATCHED' : r.status === 'error' ? 'BREAKS' : 'SOURCE_MISSING'} /> {r.status.replace(/_/g, ' ')}</td>
                    <td className="r">{r.rows ?? '—'}</td>
                    <td>{r.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
