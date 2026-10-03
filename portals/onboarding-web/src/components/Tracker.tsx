'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, loadSession, OnboardingApiError, type EvidenceRow, type Meta, type Session, type TrackerStatus } from '@/lib/api';
import { Alert, fmtDate, Shell } from './ui';
import { EvidenceCard } from './EvidenceCard';
import { ResumePanel } from './ResumePanel';

/** Applicant status tracker with the "request more information" loop-back (upload + reply). */
export function Tracker() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (s: Session) => {
    try {
      const [st, app] = await Promise.all([api.status(s.id, s.token), api.get(s.id, s.token)]);
      setStatus(st);
      setEvidence(app.evidence);
      setError(null);
    } catch (e) {
      setError(e instanceof OnboardingApiError && e.status === 404 ? 'expired' : 'We could not load your status. Retrying...');
    }
  }, []);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    setReady(true);
    api.meta().then(setMeta).catch(() => undefined);
    if (s) void load(s);
  }, [load]);

  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => void load(session), 30_000);
    return () => clearInterval(t);
  }, [session, load]);

  async function sendReply() {
    if (!session || !reply.trim()) return;
    setSending(true);
    setNote(null);
    try {
      await api.reply(session.id, session.token, reply.trim());
      setReply('');
      setNote('Your reply has been sent to our Compliance team.');
      await load(session);
    } catch (e) {
      setNote(e instanceof OnboardingApiError ? e.message : 'Reply failed.');
    } finally {
      setSending(false);
    }
  }

  if (!ready) return <Shell><p className="muted pad">Loading...</p></Shell>;
  if (!session || error === 'expired') {
    return (
      <Shell pill="Application status">
        <section className="hero single">
          <div className="card start">
            <h1>Check your application</h1>
            <p className="muted">This browser has no saved application. Ask for a private link by email.</p>
            <ResumePanel />
          </div>
        </section>
      </Shell>
    );
  }
  if (!status) return <Shell pill="Application status">{error ? <Alert kind="error">{error}</Alert> : <p className="muted pad">Loading your status...</p>}</Shell>;
  if (!status.submitted) {
    return (
      <Shell pill="Application status">
        <section className="card success">
          <h1>Your application is still a draft</h1>
          <p className="muted">Finish and submit it to start the review.</p>
          <a className="btn accent" href="/">Continue application</a>
        </section>
      </Shell>
    );
  }

  const req = status.requested;
  const accept = meta?.acceptedFileTypes ?? ['application/pdf', 'image/png', 'image/jpeg'];
  return (
    <Shell pill="Application status">
      <section className="hero">
        <div>
          <div className="eyebrow">Application {status.ref}</div>
          <h1>{status.stage.label}</h1>
          <p className="muted">{status.submittedAt ? `Submitted ${fmtDate(status.submittedAt)}.` : ''} Compliance makes the final decision; this page updates automatically.</p>
        </div>
      </section>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <ol className="tracker" aria-label="Progress">
        {status.steps.map((s) => (
          <li key={s.key} className={s.current ? 'current' : s.done ? 'done' : ''} aria-current={s.current ? 'step' : undefined}>
            <b>{s.done ? '✓' : ''}</b>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      {req ? (
        <section className="card needs">
          <div className="eyebrow">Action needed</div>
          <h2>We need a little more information</h2>
          {req.message ? <blockquote>{req.message}</blockquote> : null}
          {req.dueAt ? <p className="muted">Please respond by {fmtDate(req.dueAt)}.</p> : null}
          {req.slots.length ? (
            <div className="docs">
              {req.slots.map((s) => (
                <EvidenceCard key={s.key} slot={s.key} label={s.label} required row={evidence.find((r) => r.slot === s.key)} session={session} maxMb={meta?.maxUploadMb ?? 10} accept={accept} onUploaded={() => void load(session)} />
              ))}
            </div>
          ) : (
            <p className="muted">All requested documents have been received. Compliance has been notified.</p>
          )}
          <label className="field wide">
            <span>Reply to Compliance <em>optional</em></span>
            <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000} />
          </label>
          {note ? <p className="muted" role="status">{note}</p> : null}
          <button className="btn accent" disabled={sending || !reply.trim()} onClick={sendReply}>{sending ? 'Sending...' : 'Send reply'}</button>
        </section>
      ) : null}

      <section className="card">
        <h2>Updates</h2>
        {status.updates.length ? (
          <ul className="timeline">
            {[...status.updates].reverse().map((u, i) => (
              <li key={i}><time>{fmtDate(u.at)}</time><strong>{u.title}</strong>{u.detail ? <p>{u.detail}</p> : null}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No updates yet.</p>
        )}
      </section>
    </Shell>
  );
}
