'use client';

import { useState, type ChangeEvent } from 'react';
import { api, apiRequest } from '../api';
import { formatDecimal, formatMoney } from '../money';
import { ActionButton, Alert, Card, DateText, Empty, Field, FieldGrid, Loaded, useAction, useResource } from '../ui';
import { risk, Tone, usePortfolioOptions } from './common';
import { metricShort, type Preset, type RiskRun, type RiskScenario, type ScenarioResult, type Shocks } from './types';

const BLANK: Shocks = { equityPct: 0, fxPct: 0, ratePctPoints: 0, durationYears: 1, redemptionPct: 0 };
type FormShocks = Record<keyof Shocks, string>;
const toForm = (s: Shocks): FormShocks => ({
  equityPct: String(s.equityPct),
  fxPct: String(s.fxPct),
  ratePctPoints: String(s.ratePctPoints),
  durationYears: String(s.durationYears),
  redemptionPct: String(s.redemptionPct),
});
const fromForm = (f: FormShocks): Shocks => ({
  equityPct: Number(f.equityPct || 0),
  fxPct: Number(f.fxPct || 0),
  ratePctPoints: Number(f.ratePctPoints || 0),
  durationYears: Number(f.durationYears || 0),
  redemptionPct: Number(f.redemptionPct || 0),
});
const summary = (s: Shocks) =>
  [
    s.equityPct && `equity ${s.equityPct}%`,
    s.fxPct && `ZWG ${s.fxPct > 0 ? '-' : '+'}${Math.abs(s.fxPct)}%`,
    s.ratePctPoints && `rates ${s.ratePctPoints > 0 ? '+' : ''}${s.ratePctPoints}pp (dur ${s.durationYears}y)`,
    s.redemptionPct && `redemptions ${s.redemptionPct}%`,
  ]
    .filter(Boolean)
    .join(', ') || 'no shock';

interface ScenarioPayload {
  data: RiskScenario[];
  presets: Preset[];
}

export function ScenariosTab({ canManage }: { canManage: boolean }) {
  const list = useResource<ScenarioPayload>(() => apiRequest<ScenarioPayload>('GET', '/api/v1/risk/scenarios'), []);
  const runs = useResource<RiskRun[]>(() => api.get<RiskRun[]>(risk('/runs?limit=20')), []);
  const portfolios = usePortfolioOptions();
  const [form, setForm] = useState<FormShocks>(toForm(BLANK));
  const [name, setName] = useState('');
  const [portfolioId, setPortfolioId] = useState('');
  const [shown, setShown] = useState<{ title: string; result: ScenarioResult } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const preview = useAction();
  const save = useAction();
  const set = (k: keyof Shocks) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const portfolioName = (id: string) => (portfolios.state === 'ok' ? portfolios.data.find((p) => p.id === id)?.name : undefined) ?? 'portfolio';

  async function doPreview() {
    setSaved(null);
    const r = await preview.run(() => api.post<{ results: ScenarioResult }>(risk('/scenarios/preview'), { portfolioId, shocks: fromForm(form) }));
    if (r) setShown({ title: `What-if on ${portfolioName(portfolioId)} (not saved)`, result: r.results });
  }

  async function doSave(andRun: boolean) {
    setSaved(null);
    const created = await save.run((key) => api.post<RiskScenario>(risk('/scenarios'), { name: name.trim(), shocks: fromForm(form) }, { idempotencyKey: key }));
    if (!created) return;
    setSaved(`Saved “${created.name}”.`);
    list.reload();
    if (andRun) await runSaved(created, portfolioId);
  }

  async function runSaved(s: RiskScenario, pid: string) {
    const r = await api.post<RiskRun>(risk(`/scenarios/${s.id}/run`), { portfolioId: pid });
    setShown({ title: `${s.name} on ${r.portfolioName ?? portfolioName(pid)} (stored run)`, result: r.results });
    runs.reload();
    list.reload();
  }

  const noPortfolio = !portfolioId;

  return (
    <>
      <Card title="Scenario lab">
        <p className="ops-muted" style={{ marginTop: 0 }}>
          Deterministic stress test of a portfolio at its latest prices. Equity shock applies to equity-like holdings, the FX shock to ZWG against USD, the rate shock to fixed income through the duration, and redemptions to
          liquidity coverage. The result is judged against the active limits.
        </p>
        <Loaded res={list} what="presets">
          {(p) => (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="ops-muted" style={{ alignSelf: 'center' }}>
                Presets:
              </span>
              {p.presets.map((pr) => (
                <button
                  key={pr.key}
                  className="ops-btn small"
                  type="button"
                  title={pr.description}
                  onClick={() => {
                    setForm(toForm(pr.shocks));
                    setName(pr.name.replace(/\s*:.*/, ' (copy)'));
                  }}
                >
                  {pr.key === 'liquidity' ? 'Liquidity' : pr.key === 'equity' ? 'Equity' : 'FX'}
                </button>
              ))}
              <button className="ops-btn small" type="button" onClick={() => setForm(toForm(BLANK))}>
                Clear
              </button>
            </div>
          )}
        </Loaded>
        <FieldGrid>
          <Field label="Portfolio" span={2}>
            <select className="ops-input" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
              <option value="">Choose a portfolio…</option>
              {portfolios.state === 'ok' &&
                portfolios.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.baseCurrency})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Equity move (%)" hint="-20 = equities fall 20%">
            <input className="ops-input" type="number" step="0.1" min={-100} max={100} value={form.equityPct} onChange={set('equityPct')} />
          </Field>
          <Field label="ZWG depreciation vs USD (%)" hint="25 = ZWG loses 25%">
            <input className="ops-input" type="number" step="0.1" min={-50} max={99} value={form.fxPct} onChange={set('fxPct')} />
          </Field>
          <Field label="Rate move (percentage points)" hint="+2 = +200 bp, fixed income only">
            <input className="ops-input" type="number" step="0.05" min={-20} max={50} value={form.ratePctPoints} onChange={set('ratePctPoints')} />
          </Field>
          <Field label="Duration (years)" hint="Used for the rate shock">
            <input className="ops-input" type="number" step="0.1" min={0} max={30} value={form.durationYears} onChange={set('durationYears')} />
          </Field>
          <Field label="Redemptions (% of NAV)">
            <input className="ops-input" type="number" step="0.1" min={0} max={100} value={form.redemptionPct} onChange={set('redemptionPct')} />
          </Field>
          <Field label="Name (to save)">
            <input className="ops-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Equity -30% and ZWG -25%" />
          </Field>
        </FieldGrid>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="ops-btn primary" type="button" disabled={noPortfolio || preview.busy} onClick={doPreview}>
            {preview.busy ? 'Running…' : 'Run (do not save)'}
          </button>
          {canManage && (
            <>
              <button className="ops-btn" type="button" disabled={name.trim().length < 2 || save.busy} onClick={() => doSave(false)}>
                Save scenario
              </button>
              <button className="ops-btn" type="button" disabled={name.trim().length < 2 || noPortfolio || save.busy} onClick={() => doSave(true)}>
                Save and run
              </button>
            </>
          )}
        </div>
        <Alert>{preview.error ?? save.error}</Alert>
        <Alert kind="ok">{saved}</Alert>
      </Card>

      {shown && <ResultCard title={shown.title} result={shown.result} />}

      <Card title="Saved scenarios">
        <Loaded res={list} what="scenarios">
          {(p) =>
            p.data.length === 0 ? (
              <Empty>No saved scenarios.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Shocks</th>
                      <th className="r">Runs</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.data.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                          <span className="ops-sub">{s.preset ? 'built-in preset' : `by ${s.createdByName ?? '—'}`}</span>
                        </td>
                        <td>{summary(s.shocks)}</td>
                        <td className="r">{s.runCount}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="ops-btn small" type="button" onClick={() => { setForm(toForm(s.shocks)); setName(s.preset ? `${s.name} (copy)` : s.name); }}>
                              Load into form
                            </button>
                            {canManage && (
                              <ActionButton
                                label="Run on selected portfolio"
                                primary
                                disabled={noPortfolio}
                                title={noPortfolio ? 'Choose a portfolio in the form above first' : undefined}
                                onRun={() => runSaved(s, portfolioId)}
                              />
                            )}
                            {canManage && !s.preset && s.runCount === 0 && (
                              <ActionButton label="Delete" danger confirm={`Delete scenario “${s.name}”?`} onRun={() => apiRequest('DELETE', `/api/v1/risk/scenarios/${s.id}`)} onDone={list.reload} />
                            )}
                          </div>
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

      <Card title="Recent runs">
        <Loaded res={runs} what="runs">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No stored runs yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Scenario</th>
                      <th>Portfolio</th>
                      <th className="r">Loss</th>
                      <th className="r">Liquidity cover</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => setShown({ title: `${r.scenarioName} on ${r.portfolioName ?? 'portfolio'} (run ${r.createdAt.slice(0, 16).replace('T', ' ')})`, result: r.results })}>
                        <td>
                          <DateText value={r.createdAt} time />
                          <span className="ops-sub">{r.runByName}</span>
                        </td>
                        <td>{r.scenarioName}</td>
                        <td>{r.portfolioName}</td>
                        <td className="r">{formatDecimal(r.results.lossPct, 2)}%</td>
                        <td className="r">{r.results.liquidity.coverage ? `${formatDecimal(r.results.liquidity.coverage, 2)}x` : '—'}</td>
                        <td>
                          <Tone value={r.results.status} />
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

export function ResultCard({ title, result: r }: { title: string; result: ScenarioResult }) {
  const money = (v: string) => formatMoney(v, r.baseCurrency);
  const loss = Number(r.loss);
  return (
    <Card title={title} actions={<Tone value={r.status} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Kpi label="NAV before" value={money(r.nav)} />
        <Kpi label="NAV after shock" value={money(r.postShockValue)} />
        <Kpi label={loss >= 0 ? 'Loss' : 'Gain'} value={`${money(r.loss.replace('-', ''))} (${formatDecimal(r.lossPct.replace('-', ''), 2)}%)`} />
        <Kpi label="Liquidity coverage" value={r.liquidity.coverage ? `${formatDecimal(r.liquidity.coverage, 2)}x` : 'no redemption shock'} sub={`liquid ${money(r.liquidity.liquidAssets)} vs redemption ${money(r.liquidity.redemptionAmount)}`} />
      </div>
      {r.reasons.length > 0 && <Alert kind={r.status === 'Escalate' ? 'error' : 'warn'}>{r.reasons.join('. ')}.</Alert>}
      {r.reasons.length === 0 && <Alert kind="ok">Within all active limits and liquidity coverage is adequate.</Alert>}
      {r.notes.map((n) => (
        <Alert key={n} kind="info">
          {n}
        </Alert>
      ))}
      {r.warnings.length > 0 && <Alert kind="warn">Valuation gaps (excluded from the figures): {r.warnings.join('; ')}</Alert>}
      <div className="ops-table-wrap" style={{ marginTop: 10 }}>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th className="r">Value change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Equity shock</td>
              <td className="r">{money(r.impacts.equity)}</td>
            </tr>
            <tr>
              <td>Interest-rate shock</td>
              <td className="r">{money(r.impacts.rate)}</td>
            </tr>
            <tr>
              <td>FX shock (ZWG vs USD)</td>
              <td className="r">{money(r.impacts.fx)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {r.limitChecks.length > 0 && (
        <div className="ops-table-wrap" style={{ marginTop: 10 }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Limit after the shock</th>
                <th className="r">Value</th>
                <th className="r">Threshold</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {r.limitChecks.map((c) => (
                <tr key={c.ref}>
                  <td>
                    {c.ref} {metricShort(c.metric)}
                  </td>
                  <td className="r">{formatDecimal(c.value, 2)}%</td>
                  <td className="r">{formatDecimal(c.threshold, 2)}%</td>
                  <td>
                    <Tone value={c.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ops-muted" style={{ marginBottom: 0 }}>
        As of {r.asOf}. Shocks: {summary(r.shocks)}.
      </p>
    </Card>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="ops-kicker">{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
      {sub && <div className="ops-sub">{sub}</div>}
    </div>
  );
}
