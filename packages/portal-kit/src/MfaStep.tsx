'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { ApiClient, MfaEnrollResponse } from '@matanho/shared';
import { ErrorNote, errorMessage } from './AuthCard';

/**
 * Second sign-in step. `verify` asks for a code from an enrolled authenticator;
 * `enroll` first shows a new TOTP secret (required by the MFA policy).
 */
export function MfaStep({
  api,
  mode,
  onDone,
  onCancel,
}: {
  api: ApiClient;
  mode: 'verify' | 'enroll';
  onDone: () => void;
  onCancel: () => void;
}) {
  const [enrolment, setEnrolment] = useState<MfaEnrollResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'enroll') return;
    api
      .mfaEnroll()
      .then(setEnrolment)
      .catch((e) => setError(errorMessage(e, 'Could not start two-factor set-up.')));
  }, [api, mode]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s+/g, '');
    try {
      await api.mfaVerify(code);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {mode === 'enroll' ? (
        <>
          <p className="mx-muted">
            Two-factor authentication is required for this portal. Add this key to your authenticator app
            (Microsoft Authenticator, Google Authenticator, 1Password…), then enter the 6-digit code it shows.
          </p>
          {enrolment ? (
            <>
              <code className="mx-secret">{enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <a className="mx-link" href={enrolment.otpauthUri}>
                Open in authenticator app
              </a>
            </>
          ) : (
            !error && <p className="mx-muted">Preparing a new key…</p>
          )}
        </>
      ) : (
        <p className="mx-muted">Enter the 6-digit code from your authenticator app.</p>
      )}
      <label>
        Authentication code
        <input
          className="mx-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
        />
      </label>
      <ErrorNote error={error} />
      <button className="mx-btn primary block" type="submit" disabled={busy || (mode === 'enroll' && !enrolment)}>
        {busy ? 'Verifying…' : 'Verify'}
      </button>
      <button className="mx-link" type="button" onClick={onCancel}>
        Use a different account
      </button>
    </form>
  );
}
