'use client';

import { useState } from 'react';
import { api, apiDownload, qs } from '../api';
import { Alert, Card, Empty, Field, formatDateTime, Loaded, useResource } from '../ui';
import { Tone, risk, usePortfolioOptions } from './common';

interface ReportLine {
  portfolioRef: string;
  portfolioName: string;
  limitRef: string;
  metric: string;
  metricLabel: string;
  scope: string;
  breachAction: string;
  threshold: string;
  value: string;
  headroom: string;
  state: string;
  recordedBreach: string | null;
}
interface ComplianceReport {
  asOf: string;
  generatedAt: string;
  summary: { portfolios: number; limitsChecked: number; breaches: number; warnings: number };
  lines: ReportLine[];
  problems: string[];
}

/**
 * Compliance report (FR-RSK-013): the limit book against live positions as of a date, for one portfolio or all. The same
 * evaluation drives the pre-trade check, so the figures equal the limit book at that time. Print uses the browser's print
 * dialog (the page hides its chrome in print); download is CSV or XLSX. Each generation is audited by the API.
 */
export function ComplianceReportTab() {
  const portfolios = usePortfolioOptions();
  const [asOf, setAsOf] = useState('');
  const [portfolioId, setPortfolioId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const res = useResource<ComplianceReport>(() => api.get<ComplianceReport>(risk(`/compliance-report${qs({ asOf, portfolioId, format: 'json' })}`)), [asOf, portfolioId]);
  const download = (format: 'csv' | 'xlsx') =>
    void apiDownload(risk(`/compliance-report${qs({ asOf, portfolioId, format })}`), `compliance-report.${format}`).then(() => setError(null), (e: Error) => setError(e.message));

  return (
    <Card
      title="Compliance report"
      actions={
        <span className="ops-actions no-print">
          <button className="ops-btn" type="button" onClick={() => window.print()}>Print</button>
          <button className="ops-btn" type="button" onClick={() => download('csv')}>Download CSV</button>
          <button className="ops-btn" type="button" onClick={() => download('xlsx')}>Download XLSX</button>
        </span>
      }
    >
      <div className="ops-filters no-print">
        <Field label="As of">
          <input className="ops-input" type="date" value={asOf} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        <Field label="Portfolio">
          <select className="ops-input" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
            <option value="">All active portfolios</option>
            {(portfolios.state === 'ok' ? portfolios.data : []).map((p) => (
              <option key={p.id} value={p.id}>{p.ref} · {p.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <Alert>{error}</Alert>
      <Loaded res={res} what="the compliance report">
        {(r) => (
          <>
            <p className="ops-muted">
              As of {r.asOf}, generated {formatDateTime(r.generatedAt)}: {r.summary.limitsChecked} limit checks over {r.summary.portfolios} portfolio{r.summary.portfolios === 1 ? '' : 's'}, {r.summary.breaches} breach{r.summary.breaches === 1 ? '' : 'es'}, {r.summary.warnings} warning{r.summary.warnings === 1 ? '' : 's'}.
            </p>
            {r.problems.map((p) => (
              <Alert key={p} kind="warn">{p}</Alert>
            ))}
            {r.lines.length === 0 ? (
              <Empty>No active limits apply to the selection.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr><th>Portfolio</th><th>Limit</th><th>Metric</th><th>Scope</th><th className="r">Threshold %</th><th className="r">Measured %</th><th className="r">Headroom %</th><th>State</th><th>Recorded breach</th></tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={`${l.portfolioRef}-${l.limitRef}`}>
                        <td>{l.portfolioRef}<span className="ops-sub">{l.portfolioName}</span></td>
                        <td>{l.limitRef}</td>
                        <td>{l.metricLabel}<span className="ops-sub">{l.breachAction}</span></td>
                        <td>{l.scope}</td>
                        <td className="r">{l.threshold}</td>
                        <td className="r">{l.value}</td>
                        <td className="r">{l.headroom}</td>
                        <td><Tone value={l.state} /></td>
                        <td>{l.recordedBreach ?? ''}</td>
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
  );
}
