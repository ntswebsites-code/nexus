'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, createApiClient, type PortalId } from '@matanho/shared';
import { AuthCard, ErrorNote, errorMessage } from './AuthCard';

/** `/reset-password?token=…`: sets a new password from an emailed reset link. */
export function ResetPasswordForm({ portal, apiUrl }: { portal: PortalId; apiUrl: string }) {
  const api = useMemo(() => createApiClient({ baseUrl: apiUrl }), [apiUrl]);
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token ?? '', password);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard portal={portal} title="Choose a new password">
      {token === null ? null : done ? (
        <>
          <p className="mx-ok">Your password has been changed. Every other session has been signed out.</p>
          <a className="mx-btn primary block" href="/login">
            Sign in
          </a>
        </>
      ) : !token ? (
        <ErrorNote error="This reset link is incomplete. Request a new one from the sign-in page." />
      ) : (
        <form onSubmit={onSubmit}>
          <label>
            New password
            <input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required autoFocus />
          </label>
          <label>
            Confirm password
            <input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
          </label>
          <ErrorNote error={error} />
          <button className="mx-btn primary block" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
