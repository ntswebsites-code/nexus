'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { confirmEnrolment, confirmStepUp, InvesteeApiError, startEnrolment } from '@/lib/investee/api';

/**
 * Prompts for an authenticator code when signing needs a fresh factor.
 * `enroll` starts TOTP setup first; confirming that code also counts as the step-up.
 */
export function StepUpDialog({
  reason,
  mode,
  onDone,
}: {
  reason: string;
  mode: 'verify' | 'enroll';
  onDone: (confirmed: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'enroll') return;
    let alive = true;
    startEnrolment()
      .then((enrolled) => {
        if (alive) setSecret(enrolled.secret);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof InvesteeApiError ? err.message : 'Could not start two-factor setup.');
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'enroll') await confirmEnrolment(code);
      else await confirmStepUp(code);
      onDone(true);
    } catch (err) {
      setError(err instanceof InvesteeApiError ? err.message : 'That code could not be confirmed.');
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stepUpTitle"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,.45)' }}
    >
      <form
        onSubmit={submit}
        style={{ width: 'min(420px, calc(100vw - 32px))', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 50px rgba(15,23,42,.25)', fontFamily: 'inherit', color: '#111827' }}
      >
        <h2 id="stepUpTitle" style={{ margin: '0 0 6px', fontSize: 17 }}>
          {mode === 'enroll' ? 'Set up two-factor authentication' : "Confirm it's you"}
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#4b5563' }}>
          {mode === 'enroll'
            ? 'Add this key to your authenticator app, then enter the 6-digit code. Signing needs a verified factor.'
            : reason || 'Enter the code from your authenticator app to continue.'}
        </p>
        {mode === 'enroll' && secret && (
          <p style={{ margin: '0 0 14px', fontSize: 14, letterSpacing: 1, wordBreak: 'break-all' }}>
            <code data-testid="mfa-setup-key">{secret}</code>
          </p>
        )}
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          aria-label="Authentication code"
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 20, letterSpacing: 6, textAlign: 'center', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 10 }}
        />
        {error && (
          <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: '#b91c1c' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={() => onDone(false)} disabled={busy} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={busy || (mode === 'enroll' && !secret)} style={{ padding: '8px 14px', borderRadius: 9, border: 0, background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
