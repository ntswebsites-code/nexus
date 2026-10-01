'use client';

import { useState, type FormEvent } from 'react';
import { confirmStepUp, InvesteeApiError } from '@/lib/investee/api';

/**
 * Prompts for a fresh authenticator code when the API answers `401 step_up_required`
 * (signing). Resolves the pending call with true once `/api/auth/mfa/step-up` accepts the code.
 */
export function StepUpDialog({ reason, onDone }: { reason: string; onDone: (confirmed: boolean) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await confirmStepUp(code);
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
        style={{ width: 'min(380px, calc(100vw - 32px))', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 50px rgba(15,23,42,.25)', fontFamily: 'inherit', color: '#111827' }}
      >
        <h2 id="stepUpTitle" style={{ margin: '0 0 6px', fontSize: 17 }}>Confirm it&apos;s you</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#4b5563' }}>{reason || 'Enter the code from your authenticator app to continue.'}</p>
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
        {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: '#b91c1c' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={() => onDone(false)} disabled={busy} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={busy} style={{ padding: '8px 14px', borderRadius: 9, border: 0, background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
