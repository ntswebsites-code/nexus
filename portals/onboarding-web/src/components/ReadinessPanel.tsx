'use client';

import { useState } from 'react';
import { api, OnboardingApiError, type ReadinessView } from '@/lib/api';

const tone = (band: string) => (band === 'LOW' ? 'good' : band === 'Pending' ? '' : 'warn');

export function ReadinessPanel({
  session,
  readiness,
  onRefresh,
}: {
  session: { id: string; token: string };
  readiness: ReadinessView | null;
  onRefresh: () => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runTriage() {
    setRunning(true);
    setErr(null);
    try {
      await api.triage(session.id, session.token);
      await onRefresh();
    } catch (e) {
      setErr(e instanceof OnboardingApiError ? e.message : 'Pre-screen could not run.');
    } finally {
      setRunning(false);
    }
  }

  const score = readiness?.score ?? 0;
  const band = readiness?.riskBand ?? 'Pending';

  return (
    <aside className="readiness" aria-label="Application readiness">
      <div className="readiness-head">
        <div className="eyebrow">AI ATS · Assisted triage</div>
        <h3>Application readiness</h3>
        <p className="muted">Completeness and risk declarations. External watchlist screening remains provider-controlled.</p>
      </div>
      <div className="score">
        <div className="score-top">
          <div>
            <span>Readiness score</span>
            <strong data-testid="readiness-score">{score}%</strong>
          </div>
          <span className={`chip ${tone(band)}`} data-testid="readiness-risk">{band === 'Pending' ? 'Risk pending' : `${band} review risk`}</span>
        </div>
        <div className="score-bar"><i style={{ width: `${score}%` }} /></div>
      </div>
      <ul className="check-list">
        {(readiness?.checks ?? []).map((c) => (
          <li key={c.name} className={`check-row ${c.state}`}>
            <span className="check-icon" aria-hidden>{c.state === 'good' ? '✓' : c.state === 'warn' ? '!' : '•'}</span>
            <span>
              <strong>{c.name}</strong>
              <small>{c.detail}</small>
            </span>
            <em>{c.right}</em>
          </li>
        ))}
      </ul>
      {err ? <p className="err" role="alert">{err}</p> : null}
      <button type="button" className="btn small" disabled={running} onClick={() => void runTriage()}>
        {running ? 'Running pre-screen...' : readiness?.triageRun ? 'Re-run AI pre-screen' : 'Run AI-assisted pre-screen'}
      </button>
      {readiness?.triage ? (
        <p className="muted triage-note">
          Last pre-screen: {readiness.triage.flags.length ? `${readiness.triage.flags.length} flag(s)` : 'no flags'} · {readiness.triage.model}
        </p>
      ) : (
        <p className="muted triage-note">Pre-screen is advisory only and does not replace Compliance review.</p>
      )}
    </aside>
  );
}
