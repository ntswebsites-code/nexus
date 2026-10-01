'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, createApiClient, type InvitationPreview, type PortalId } from '@matanho/shared';
import { AuthCard, ErrorNote, errorMessage } from './AuthCard';

/** `/invite?token=â€¦`: previews the invitation, then creates or links the account. */
export function AcceptInviteForm({ portal, apiUrl }: { portal: PortalId; apiUrl: string }) {
  const api = useMemo(() => createApiClient({ baseUrl: apiUrl }), [apiUrl]);
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(t);
    if (!t) {
      setError('This invitation link is incomplete. Open the link from your invitation email again.');
      setLoading(false);
      return;
    }
    api
      .invitation(t)
      .then(setInvite)
      .catch((e) => setError(errorMessage(e, 'Could not load this invitation.')))
      .finally(() => setLoading(false));
  }, [api]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (!invite?.existingAccount && password !== String(form.get('confirm') ?? '')) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const name = String(form.get('name') ?? '').trim();
      await api.acceptInvitation({ token, password, ...(name ? { name } : {}) });
      window.location.assign('/');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <AuthCard portal={portal} title="Accept invitation">
      {loading ? (
        <p className="mx-muted">Checking invitationâ€¦</p>
      ) : !invite ? (
        <>
          <ErrorNote error={error} />
          <p className="mx-foot">
            <a className="mx-link" href="/login">
              Go to sign in
            </a>
          </p>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <p className="mx-muted">
            You have been invited as <strong>{invite.email}</strong>.{' '}
            {invite.existingAccount
              ? 'This email already has a Matanho account â€” confirm its password to add this access.'
              : 'Choose a password to create your account.'}
          </p>
          {!invite.existingAccount && (
            <label>
              Full name
              <input name="name" defaultValue={invite.name ?? ''} autoComplete="name" maxLength={120} />
            </label>
          )}
          <label>
            {invite.existingAccount ? 'Current password' : 'Password'}
            <input
              name="password"
              type="password"
              autoComplete={invite.existingAccount ? 'current-password' : 'new-password'}
              minLength={invite.existingAccount ? undefined : PASSWORD_MIN_LENGTH}
              required
              autoFocus
            />
          </label>
          {!invite.existingAccount && (
            <label>
              Confirm password
              <input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
            </label>
          )}
          <ErrorNote error={error} />
          <button className="mx-btn primary block" type="submit" disabled={busy}>
            {busy ? 'Acceptingâ€¦' : 'Accept invitation'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
