'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { GovernanceFullView } from '@/lib/investee/types';
import { useNative } from './NativeShell';
import { Chip, Section, Stat, Table, btn, input, muted, row, type Tone } from './ui';

const DEFAULT_NOTICE_DAYS = 14;
const OTHER = '__other__';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** BR-218: without a chosen date the decision is due after the matter's notice period (default 14 days). */
export function defaultDue(noticeDays: number, today = new Date()) {
  return isoDay(new Date(today.getTime() + noticeDays * 86400000));
}

/** BR-221 tone: 95% or more on time is healthy, 80% or more needs attention, below is behind. */
export function healthTone(ratio: number | null): Tone {
  if (ratio === null) return 'neutral';
  return ratio >= 95 ? 'good' : ratio >= 80 ? 'warn' : 'bad';
}

const CONSENT_TONE: Record<string, Tone> = { 'Investor review': 'info', Approved: 'good', Declined: 'bad' };

export function GovernanceScreen() {
  const { api, run } = useNative();
  const [view, setView] = useState<GovernanceFullView | null>(null);
  const [f, setF] = useState({ title: '', basis: '', other: '', due: '', note: '' });
  const canRequest = api.isLive('governance.consent');

  const load = useCallback(async () => {
    const out = await run('', () => api.getGovernanceFull());
    if (out) setView(out);
  }, [api, run]);

  useEffect(() => {
    void load();
  }, [load]);

  const matters = view?.reservedMatters ?? [];
  const basis = f.basis === OTHER ? f.other.trim() : f.basis;
  const matter = matters.find((m) => m.name.toLowerCase() === basis.toLowerCase());
  const notice = matter?.noticeDays ?? DEFAULT_NOTICE_DAYS;

  async function request(e: FormEvent) {
    e.preventDefault();
    const out = await run('Consent requested. The fund has been notified.', () =>
      api.requestConsent({ title: f.title.trim(), basis, ...(f.due ? { due: f.due } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) }),
    );
    if (out) {
      setF({ title: '', basis: '', other: '', due: '', note: '' });
      await load();
    }
  }

  if (!view) return <p role="status" style={muted}>Loading...</p>;
  const health = view.metrics.complianceHealth;

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat
          label="Compliance health"
          value={health && health.ratio !== null ? `${health.ratio}%` : 'No obligations due'}
          hint={health && health.due ? `${health.onTime} of ${health.due} reports on time in the last 12 months` : 'No reporting period fell due in the last 12 months'}
          tone={healthTone(health?.ratio ?? null)}
        />
        <Stat label="Consents awaiting the fund" value={view.metrics.pendingConsents} />
        <Stat label="Open board actions" value={view.metrics.openActions} />
        {view.metrics.upcomingMeetings !== undefined && <Stat label="Upcoming board meetings" value={view.metrics.upcomingMeetings} />}
      </div>

      <Section title="Reserved matters">
        <p style={{ ...muted, margin: '0 0 8px' }}>These decisions need investor consent before the company acts. The notice period is the time the fund has to decide.</p>
        <Table
          head={['Matter', 'What it covers', 'Notice period']}
          rows={matters.map((m) => [m.name, m.detail, `${m.noticeDays} day${m.noticeDays === 1 ? '' : 's'}`])}
          empty="No reserved matters are recorded."
        />
      </Section>

      {canRequest && (
        <Section title="Request investor consent">
          <form onSubmit={request}>
            <div style={row}>
              <input aria-label="Consent title" style={{ ...input, flex: '2 1 240px' }} placeholder="What needs consent" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} />
              <select aria-label="Reserved matter" style={input} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} required>
                <option value="">Choose the reserved matter</option>
                {matters.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                <option value={OTHER}>Other</option>
              </select>
              {f.basis === OTHER && <input aria-label="Other basis" style={input} placeholder="Basis" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} required minLength={3} />}
              <input aria-label="Decision needed by" style={input} type="date" min={isoDay(new Date())} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
            </div>
            <textarea aria-label="Note to the fund" style={{ ...input, width: '100%', marginTop: 10, minHeight: 60, boxSizing: 'border-box' }} placeholder="Background for the investors" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <div style={row}>
              <button style={btn} disabled={f.title.trim().length < 3 || basis.length < 3}>Request consent</button>
              {!f.due && basis && (
                <span style={muted}>
                  Without a date the decision is due on {defaultDue(notice)} ({notice} days notice).
                </span>
              )}
            </div>
          </form>
        </Section>
      )}

      <Section title="Consent requests">
        <Table
          head={['Ref', 'Request', 'Basis', 'Submitted', 'Due', 'Status', 'Note']}
          empty="No consent has been requested."
          rows={view.consents.map((c) => [c.id, c.title, c.basis, c.submitted, c.due, <Chip key="s" tone={CONSENT_TONE[c.status] ?? 'neutral'}>{c.status}</Chip>, c.note])}
        />
      </Section>

      <Section title="Governance calendar">
        <Table head={['Due', 'Item', 'Status']} empty="Nothing is scheduled." rows={view.calendar.map((c) => [c.due, c.title, c.status])} />
      </Section>

      <Section title="Board actions" actions={<a href="/workspace" style={{ fontSize: 13, color: '#4f46e5' }}>Manage meetings and actions</a>}>
        <Table head={['Action', 'Owner', 'Due', 'Status']} empty="No board actions." rows={view.actions.map((a) => [a.title, a.owner, a.due, a.status])} />
      </Section>
    </>
  );
}
