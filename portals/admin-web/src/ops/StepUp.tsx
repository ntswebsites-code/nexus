'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiRequest, describeError, setStepUpHandler } from './api';

/**
 * TOTP confirmation for money actions. Registered as the API client's step-up handler:
 * on `401 step_up_required` it asks for a code, posts it to `/api/v1/auth/mfa/step-up`,
 * and resolves true so the original request is retried once with the same Idempotency-Key.
 */
export function StepUpHost() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    setStepUpHandler(() => {
      if (pending.current) return pending.current;
      pending.current = new Promise<boolean>((resolve) => {
        resolver.current = (ok) => {
          pending.current = null;
          resolver.current = null;
          setOpen(false);
          resolve(ok);
        };
        setError(null);
        setBusy(false);
        setOpen(true);
      });
      return pending.current;
    });
    return () => setStepUpHandler(null);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest('POST', '/api/v1/auth/mfa/step-up', { code }, { noStepUp: true });
      resolver.current?.(true);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="ops-modal-backdrop" role="presentation">
      <form className="ops-modal narrow" role="dialog" aria-modal="true" aria-labelledby="ops-stepup-title" onSubmit={onSubmit}>
        <header className="ops-modal-head">
          <div>
            <div className="ops-kicker">CONFIRM WITH TWO-FACTOR</div>
            <h2 id="ops-stepup-title">Confirm this action</h2>
            <p>Enter the 6-digit code from your authenticator app. The action runs once you confirm.</p>
          </div>
        </header>
        <div className="ops-modal-body">
          <input
            className="ops-input ops-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            autoFocus
            aria-label="Authentication code"
          />
          {error && <p className="ops-error-text">{error}</p>}
        </div>
        <footer className="ops-modal-foot">
          <button className="ops-btn" type="button" onClick={() => resolver.current?.(false)} disabled={busy}>
            Cancel
          </button>
          <button className="ops-btn primary" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Confirm'}
          </button>
        </footer>
      </form>
    </div>
  );
}
