'use client';

import { useEffect, useState } from 'react';
import { api, navigateTo, OnboardingApiError, saveSession } from '@/lib/api';
import { Alert, Shell } from './ui';

/** Ask for a magic link by email. The server always answers the same way (no email enumeration). */
export function ResumePanel() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setState('busy');
        try {
          await api.requestResumeLink(email.trim());
          setState('sent');
        } catch (err) {
          setState('error');
          setMsg(err instanceof OnboardingApiError ? err.message : 'Request failed.');
        }
      }}
    >
      {state === 'sent' ? <Alert kind="ok">If an open application exists for {email}, a one-time link is on its way. It is valid for 24 hours.</Alert> : null}
      {state === 'error' ? <Alert kind="error">{msg}</Alert> : null}
      <label className="field"><span>Email used on the application</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
      <div className="actions"><a className="btn ghost" href="/">Start a new application</a><button className="btn accent" disabled={!valid || state === 'busy'}>{state === 'busy' ? 'Sending...' : 'Email me a link'}</button></div>
    </form>
  );
}

/** /resume?link=<token>: exchanges the one-time link on an explicit click (mail scanners cannot burn it). */
export function ResumePage() {
  const [link, setLink] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLink(new URLSearchParams(window.location.search).get('link'));
    setReady(true);
  }, []);
  async function exchange() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.exchangeLink(link);
      saveSession(r);
      navigateTo('/');
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Could not use this link.');
      setBusy(false);
    }
  }
  return (
    <Shell pill="Resume application">
      <section className="hero single">
        <div className="card start">
          <h1>Resume your application</h1>
          {!ready ? null : link ? (
            <>
              <p className="muted">Continue where you left off. This private link works once.</p>
              {error ? <Alert kind="error">{error}</Alert> : null}
              <div className="actions"><span /><button className="btn accent" disabled={busy} onClick={exchange}>{busy ? 'Opening...' : 'Continue my application'}</button></div>
              {error ? <><hr /><p className="muted">Need a new link?</p><ResumePanel /></> : null}
            </>
          ) : (
            <>
              <p className="muted">Enter the email you applied with and we will send a private link.</p>
              <ResumePanel />
            </>
          )}
        </div>
      </section>
    </Shell>
  );
}
