'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FORECAST_INPUT_METRICS,
  type ForecastCells,
  type ForecastInputMetric,
  type ForecastPnlMonth,
  type ForecastVersionDetail,
  type ForecastWorkingView,
} from '@/lib/investee/types';
import { InvesteeApiError } from '@/lib/investee/api';
import { useNative } from './NativeShell';
import { Chip, Section, Table, btn, ghost, input, muted, n, row, td, th } from './ui';

const INPUT_LABELS: Record<(typeof FORECAST_INPUT_METRICS)[number], string> = {
  merchantRevenue: 'Merchant revenue',
  enterpriseRevenue: 'Enterprise revenue',
  otherRevenue: 'Other revenue',
  processingCosts: 'Processing costs',
  supportLosses: 'Support and fraud losses',
  salesMarketing: 'Sales and marketing',
  productEngineering: 'Product and engineering',
  generalAdmin: 'General and admin',
  operatingCash: 'Operating cash flow (blank = EBITDA)',
  capex: 'Capital expenditure',
  financing: 'Financing in (out)',
  openingCash: 'Opening cash (first month only)',
  minimumCash: 'Minimum cash',
};

const PNL_ROWS: [keyof ForecastPnlMonth, string][] = [
  ['totalRevenue', 'Total revenue'],
  ['grossProfit', 'Gross profit'],
  ['ebitda', 'EBITDA'],
  ['ebitdaMargin', 'EBITDA margin %'],
  ['openingCash', 'Opening cash'],
  ['operatingCash', 'Operating cash'],
  ['capex', 'Capex'],
  ['financing', 'Financing'],
  ['closingCash', 'Closing cash'],
  ['minimumCash', 'Minimum cash'],
  ['liquidityHeadroom', 'Liquidity headroom'],
];

const SCENARIOS = ['Base case', 'Upside', 'Downside'];
const key = (metric: string, month: string) => `${metric}|${month}`;

export function ForecastsScreen() {
  const { api, run } = useNative();
  const [view, setView] = useState<ForecastWorkingView | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [scenario, setScenario] = useState('');
  const [version, setVersion] = useState<ForecastVersionDetail | null>(null);
  const [stale, setStale] = useState(false);
  const canSave = api.isLive('forecast.save');
  const canLock = api.isLive('workspace');

  const load = useCallback(async () => {
    const out = await run('', () => api.getForecastWorking());
    if (out) {
      setView(out);
      setScenario(out.scenario);
      setEdits({});
      setStale(false);
    }
  }, [api, run]);

  useEffect(() => {
    void load();
  }, [load]);

  const forecastMonths = useMemo(() => (view?.months ?? []).filter((m) => m.stage !== 'actual-locked'), [view]);
  const locked = useMemo(() => new Set([...(view?.lockedPeriods ?? []), ...(view?.months ?? []).filter((m) => m.locked).map((m) => m.key)]), [view]);
  const firstMonth = view?.pnl.firstForecastMonth ?? forecastMonths[0]?.key;
  const dirty = Object.keys(edits).length > 0 || (view !== null && scenario !== view.scenario);

  const cellValue = (metric: ForecastInputMetric, month: string) => {
    const k = key(metric, month);
    if (k in edits) return edits[k]!;
    const v = view?.cells[metric]?.[month];
    return v === undefined || v === null ? '' : String(v);
  };

  async function save() {
    if (!view) return;
    const cells: ForecastCells = {};
    for (const [k, raw] of Object.entries(edits)) {
      if (raw.trim() === '') continue;
      const [metric, month] = k.split('|') as [ForecastInputMetric, string];
      (cells[metric] ??= {})[month] = Number(raw);
    }
    try {
      const out = await api.saveForecastCells({ ...(scenario !== view.scenario ? { scenario } : {}), cells, baseVersion: view.workingVersion });
      setView(out);
      setScenario(out.scenario);
      setEdits({});
      await run(`Working version ${out.workingVersion} saved`, async () => out);
    } catch (e) {
      if (e instanceof InvesteeApiError && e.code === 'version_conflict') setStale(true);
      await run('', async () => {
        throw e;
      });
    }
  }

  async function submit() {
    const out = await run('Forecast submitted. The fund can now see this version; later edits start the next working version.', () => api.submitForecastVersion());
    if (out) {
      setView(out);
      setEdits({});
    }
  }

  async function openVersion(no: number) {
    const out = await run('', () => api.getForecastVersion(no));
    if (out) setVersion(out);
  }

  async function toggleLock(month: string, isLocked: boolean) {
    if (await run(isLocked ? 'Month unlocked' : 'Month locked', () => api.workspace('POST', isLocked ? '/forecast/unlock' : '/forecast/lock', { periods: [month] }))) await load();
  }

  if (!view) return <p role="status" style={muted}>Loading...</p>;

  return (
    <>
      <Section
        title="Working forecast"
        actions={
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip tone="info">Working version {view.workingVersion}</Chip>
            <Chip>{view.latestSubmittedVersion ? `Last submitted: version ${view.latestSubmittedVersion}` : 'Nothing submitted yet'}</Chip>
          </span>
        }
      >
        {stale && (
          <p role="alert" style={{ fontSize: 13, color: '#991b1b', margin: '0 0 8px' }}>
            Someone submitted this forecast while you were editing. <button type="button" style={ghost} onClick={() => void load()}>Reload the working version</button>
          </p>
        )}
        <div style={row}>
          <label style={{ fontSize: 13 }}>
            Scenario{' '}
            <select aria-label="Scenario" style={input} value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={!canSave}>
              {SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {canSave && (
            <>
              <button type="button" style={btn} onClick={() => void save()} disabled={!dirty || stale}>Save working version</button>
              <button type="button" style={ghost} onClick={() => void submit()} disabled={dirty}>Submit version {view.workingVersion} to the fund</button>
            </>
          )}
        </div>
        {dirty && <p style={{ ...muted, marginTop: 6 }}>Save your changes before submitting.</p>}
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Input</th>
                {forecastMonths.map((m) => (
                  <th key={m.key} style={th}>
                    {m.label}
                    {locked.has(m.key) && <span style={{ display: 'block', color: '#92400e' }}>locked</span>}
                    {canLock && (
                      <button type="button" style={{ ...ghost, padding: '1px 6px', fontSize: 11, marginTop: 2 }} onClick={() => void toggleLock(m.key, locked.has(m.key))} aria-label={`${locked.has(m.key) ? 'Unlock' : 'Lock'} ${m.label}`}>
                        {locked.has(m.key) ? 'Unlock' : 'Lock'}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...td, color: '#6b7280' }}>Reported revenue (actual)</td>
                {forecastMonths.map((m) => <td key={m.key} style={{ ...td, color: '#6b7280' }}>{view.actuals[m.key] !== undefined && view.actuals[m.key] !== null ? n(view.actuals[m.key]!) : ''}</td>)}
              </tr>
              {FORECAST_INPUT_METRICS.map((metric) => (
                <tr key={metric}>
                  <td style={td}>{INPUT_LABELS[metric]}</td>
                  {forecastMonths.map((m) => {
                    const readOnly = !canSave || stale || locked.has(m.key) || (metric === 'openingCash' && m.key !== firstMonth);
                    return (
                      <td key={m.key} style={{ ...td, padding: 3 }}>
                        {metric === 'openingCash' && m.key !== firstMonth ? (
                          <span style={muted}>carried</span>
                        ) : (
                          <input
                            aria-label={`${INPUT_LABELS[metric]} ${m.label}`}
                            type="number"
                            step="any"
                            style={{ ...input, width: 92, padding: '4px 6px', background: readOnly ? '#f9fafb' : '#fff' }}
                            value={cellValue(metric, m.key)}
                            readOnly={readOnly}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [key(metric, m.key)]: e.target.value }))}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={muted}>Opening cash is entered for the first forecast month only; later months start from the previous closing cash. Locked months cannot be edited.</p>
      </Section>

      <Section title="P&L and cash roll-forward (calculated by Matanho)">
        <PnlTable months={forecastMonths.map((m) => ({ key: m.key, label: m.label }))} pnl={view.pnl} />
      </Section>

      <Section title="Submitted versions">
        <Table
          head={['Version', 'Scenario', 'Submitted', 'Fingerprint', '']}
          empty="No version has been submitted yet."
          rows={view.submittedVersions.map((v) => [
            `Version ${v.versionNo}`,
            v.scenario,
            v.submittedAt.slice(0, 16).replace('T', ' '),
            <code key="h" title={v.sha256}>{v.sha256.slice(0, 12)}</code>,
            <button key="v" style={ghost} onClick={() => void openVersion(v.versionNo)}>View</button>,
          ])}
        />
        {version && (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Version {version.versionNo} ({version.scenario}) as submitted</h3>
            {version.data.pnl ? (
              <PnlTable months={Object.keys(version.data.pnl.months).sort().map((k) => ({ key: k, label: k }))} pnl={version.data.pnl} />
            ) : (
              <p style={muted}>This version has no stored P&L.</p>
            )}
            <div style={row}><button type="button" style={ghost} onClick={() => setVersion(null)}>Close</button></div>
          </div>
        )}
      </Section>
    </>
  );
}

function PnlTable({ months, pnl }: { months: { key: string; label: string }[]; pnl: { months: Record<string, ForecastPnlMonth>; annual: ForecastPnlMonth } }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={th}>Line</th>
            {months.map((m) => <th key={m.key} style={th}>{m.label}</th>)}
            <th style={th}>Annual</th>
          </tr>
        </thead>
        <tbody>
          {PNL_ROWS.map(([k, label]) => (
            <tr key={k}>
              <td style={td}>{label}</td>
              {months.map((m) => {
                const v = pnl.months[m.key]?.[k];
                const warn = k === 'liquidityHeadroom' && typeof v === 'number' && v < 0;
                return <td key={m.key} style={{ ...td, color: warn ? '#991b1b' : undefined, fontWeight: warn ? 600 : undefined }}>{typeof v === 'number' ? n(v) : ''}</td>;
              })}
              <td style={{ ...td, fontWeight: 600 }}>{n(pnl.annual[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
