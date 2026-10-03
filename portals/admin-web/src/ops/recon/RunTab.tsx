'use client';

import { useState, type FormEvent } from 'react';
import { api, apiRequest } from '../api';
import { Alert, Card, DateText, Empty, Field, FieldGrid, Loaded, optStr, str, useAction, useResource } from '../ui';
import { recon, reconFull, Tone, useCounterparties, usePortfolioOptions } from './common';
import { EffectiveTolerancePreview } from './SourcesTab';
import { FAMILIES, TOLERANCE_FIELDS, yesterday, type AccountMapRow, type ReconRun, type RunResult } from './types';

export function RunTab({ canManage, onOpenBreak, onChanged }: { canManage: boolean; onOpenBreak: (id: string) => void; onChanged: () => void }) {
  const cps = useCounterparties();
  const pfs = usePortfolioOptions();
  const runs = useResource<ReconRun[]>(() => api.get<ReconRun[]>(recon('/runs?limit=25')), []);
  const maps = useResource<AccountMapRow[]>(() => api.get<AccountMapRow[]>(recon('/account-map')), []);
  const [result, setResult] = useState<RunResult | null>(null);
  const [family, setFamily] = useState('TRADES');
  const [asOf, setAsOf] = useState(yesterday());
  const [cpSel, setCpSel] = useState('');
  const action = useAction();
  const mapAction = useAction();
  const [mapCp, setMapCp] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const tolerances: Record<string, string> = {};
    for (const k of TOLERANCE_FIELDS.map((f) => f.key)) {
      const v = optStr(fd, `tol_${k}`);
      if (v) tolerances[k] = v;
    }
    const r = await action.run((key) =>
      reconFull<RunResult>(
        'POST',
        '/runs',
        {
          family: str(fd, 'family'),
          asOfDate: str(fd, 'asOfDate'),
          counterpartyId: optStr(fd, 'counterpartyId') ?? null,
          portfolioId: optStr(fd, 'portfolioId') ?? null,
          ...(Object.keys(tolerances).length ? { tolerances } : {}),
        },
        key,
      ),
    );
    if (r) {
      setResult(r);
      runs.reload();
      onChanged();
    }
  }

  async function saveMap(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ok = await mapAction.run(() => apiRequest('PUT', recon('/account-map'), { counterpartyId: str(fd, 'counterpartyId'), accountRef: str(fd, 'accountRef'), portfolioId: str(fd, 'portfolioId') }));
    if (ok) {
      form.reset();
      setMapCp('');
      maps.reload();
    }
  }

  const accountsOfSelected = cps.state === 'ok' ? cps.data.find((c) => c.id === mapCp)?.accounts ?? [] : [];

  return (
    <>
      <Card title="Run matching">
        {!canManage ? (
          <Alert kind="info">Your role can view reconciliations but not run matching (recon.manage).</Alert>
        ) : (
          <form onSubmit={submit}>
            <FieldGrid>
              <Field label="Family">
                <select className="ops-input" name="family" value={family} onChange={(e) => setFamily(e.target.value)}>
                  {FAMILIES.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date">
                <input className="ops-input" type="date" name="asOfDate" required value={asOf} onChange={(e) => setAsOf(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field label="Counterparty" hint="Blank: every mapped counterparty.">
                <select className="ops-input" name="counterpartyId" value={cpSel} onChange={(e) => setCpSel(e.target.value)}>
                  <option value="">All counterparties</option>
                  {(cps.state === 'ok' ? cps.data : []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Portfolio" hint="Blank: every mapped portfolio.">
                <select className="ops-input" name="portfolioId" defaultValue="">
                  <option value="">All portfolios</option>
                  {(pfs.state === 'ok' ? pfs.data : []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              {TOLERANCE_FIELDS.filter((f) => f.families.includes(family as never)).map((f) => (
                <Field key={f.key} label={`${f.label}: override for this run`} hint={`${f.hint} Blank uses the effective-dated configuration shown below.`}>
                  <input className="ops-input" name={`tol_${f.key}`} inputMode="decimal" placeholder="configured" />
                </Field>
              ))}
            </FieldGrid>
            <EffectiveTolerancePreview family={family} asOf={asOf} counterpartyId={cpSel} />
            <p className="ops-muted">
              Safe to repeat: one run exists per family, date, counterparty and portfolio. Re-running keeps each break's workflow, clears items that now agree and reopens a closed item whose difference changed.
            </p>
            <Alert>{action.error}</Alert>
            <button className="ops-btn primary" type="submit" disabled={action.busy}>
              {action.busy ? 'Matching…' : 'Run matching'}
            </button>
          </form>
        )}
        {result && (
          <div style={{ marginTop: 14 }}>
            <Alert kind={result.data.status === 'CLEAN' ? 'ok' : 'warn'}>
              {result.data.ref} ({result.rerun ? `re-run #${result.data.runCount}` : 'new run'}): {result.data.matchedCount} matched, {result.data.breakCount} break{result.data.breakCount === 1 ? '' : 's'}
              {result.data.matchRate !== null ? `, match rate ${result.data.matchRate.toFixed(1)}%` : ''}.
              {(result.data.summary?.missingSources?.length ?? 0) > 0 && ` Source gap: ${result.data.summary!.missingSources!.map((m) => `${m.counterpartyRef}/${m.accountRef}`).join(', ')} has no source file for this date (day-end package, custody positions or corporate-action file).`}
              {(result.data.summary?.unmappedAccounts?.length ?? 0) > 0 && ` ${result.data.summary!.unmappedAccounts!.length} counterparty account(s) are not mapped to a portfolio and were skipped.`}
            </Alert>
            {result.breaks.length > 0 && (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <tbody>
                    {result.breaks.map((b) => (
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
          </div>
        )}
      </Card>

      <Card title="Recent runs" actions={<button className="ops-btn small" type="button" onClick={runs.reload}>Refresh</button>}>
        <Loaded res={runs} what="runs">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No matching runs yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Family</th>
                      <th>Date</th>
                      <th>Scope</th>
                      <th className="r">Matched</th>
                      <th className="r">Breaks</th>
                      <th className="r">Open</th>
                      <th>Status</th>
                      <th>Last run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.ref}</strong><span className="ops-sub">{r.runCount} run{r.runCount === 1 ? '' : 's'}</span></td>
                        <td>{r.familyLabel}</td>
                        <td><DateText value={r.asOfDate} /></td>
                        <td>{r.counterparty?.name ?? 'All counterparties'}<span className="ops-sub">{r.portfolio?.name ?? 'All portfolios'}</span></td>
                        <td className="r">{r.matchedCount}</td>
                        <td className="r">{r.breakCount}</td>
                        <td className="r">{r.openBreaks}</td>
                        <td><Tone value={r.status} /></td>
                        <td>{r.runByName ?? '—'}<span className="ops-sub"><DateText value={r.updatedAt} time /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>

      <Card title="Account mapping">
        <p className="ops-muted" style={{ marginTop: 0 }}>
          Custodian accounts are matched to the portfolio they hold. Only mapped accounts are reconciled.
        </p>
        <Loaded res={maps} what="mappings">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No accounts mapped yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr><th>Counterparty</th><th>Account</th><th>Portfolio</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id}>
                        <td>{m.counterparty.name}<span className="ops-sub">{m.counterparty.ref}</span></td>
                        <td>{m.accountRef}</td>
                        <td>{m.portfolio.name}<span className="ops-sub">{m.portfolio.ref}</span></td>
                        <td>
                          {canManage && (
                            <button
                              className="ops-btn small danger"
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`Stop reconciling ${m.accountRef}?`)) return;
                                await mapAction.run(() => apiRequest('DELETE', recon(`/account-map/${m.id}`)));
                                maps.reload();
                              }}
                            >
                              Remove
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
        {canManage && (
          <form onSubmit={saveMap} style={{ marginTop: 14 }}>
            <FieldGrid>
              <Field label="Counterparty">
                <select className="ops-input" name="counterpartyId" required value={mapCp} onChange={(e) => setMapCp(e.target.value)}>
                  <option value="">Choose</option>
                  {(cps.state === 'ok' ? cps.data : []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Account">
                {accountsOfSelected.length > 0 ? (
                  <select className="ops-input" name="accountRef" required defaultValue="">
                    <option value="">Choose</option>
                    {accountsOfSelected.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                ) : (
                  <input className="ops-input" name="accountRef" required maxLength={64} />
                )}
              </Field>
              <Field label="Portfolio">
                <select className="ops-input" name="portfolioId" required defaultValue="">
                  <option value="">Choose</option>
                  {(pfs.state === 'ok' ? pfs.data : []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            </FieldGrid>
            <Alert>{mapAction.error}</Alert>
            <button className="ops-btn" type="submit" disabled={mapAction.busy}>Save mapping</button>
          </form>
        )}
      </Card>
    </>
  );
}
