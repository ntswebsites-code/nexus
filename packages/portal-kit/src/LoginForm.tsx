'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PORTALS, createApiClient, type AuthUser, type PortalId } from '@matanho/shared';
import { AuthCard, ErrorNote, errorMessage, safeNext } from './AuthCard';
import { MfaStep } from './MfaStep';

export interface LoginFormProps {
  portal: PortalId;
  /** Base URL of the shared API (NEXT_PUBLIC_API_URL). */
  apiUrl: string;
  /**
   * Ask the API to verify the account holds a role in this portal. Disable for
   * portals that have no role catalog yet (onboarding, company) so any valid
   * account can still sign in through the shared auth system.
   */
  enforcePortalAccess?: boolean;
}

type Step = 'password' | 'forgot' | 'forgot-sent' | { mfa: 'verify' | 'enroll' };

/**
 * Sign-in for a portal. Every portal renders this same form and talks to the
 * same shared API, so one account works everywhere the user has access.
 */
export function LoginForm({ portal, apiUrl, enforcePortalAccess = true }: LoginFormProps) {
  const api = useMemo(() => createApiClient({ baseUrl: apiUrl }), [apiUrl]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('password');

  // `/login?forgot=1` (linked from the reset page) opens the request-a-reset-link step directly.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('forgot')) setStep('forgot');
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => alive && setUser(r.user))
      .catch(() => undefined)
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [api]);

  const next = () => safeNext(new URLSearchParams(window.location.search).get('next'));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const r = await api.login({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        ...(enforcePortalAccess ? { portal } : {}),
      });
      if (r.mfa) {
        setStep({ mfa: r.mfa });
        setBusy(false);
        return;
      }
      window.location.assign(next());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function onForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword(String(new FormData(event.currentTarget).get('email') ?? ''), portal);
      setStep('forgot-sent');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    setBusy(true);
    await api.logout().catch(() => undefined);
    setUser(null);
    setStep('password');
    setBusy(false);
  }

  const def = PORTALS[portal];
  const hasAccess = !enforcePortalAccess || (user?.roles.some((r) => r.portal === portal) ?? false);

  if (typeof step === 'object') {
    return (
      <AuthCard portal={portal} title={step.mfa === 'enroll' ? 'Set up two-factor' : 'Two-factor check'}>
        <MfaStep api={api} mode={step.mfa} onDone={() => window.location.assign(next())} onCancel={onSignOut} />
      </AuthCard>
    );
  }

  if (step === 'forgot' || step === 'forgot-sent') {
    // The reset form needs no session; show it even while an account is signed in elsewhere.
    return (
      <AuthCard portal={portal} title="Reset password">
        {step === 'forgot-sent' ? (
          <p className="mx-ok">If that email belongs to an active account, a reset link is on its way. It is valid for one hour.</p>
        ) : (
          <form onSubmit={onForgot}>
            <p className="mx-muted">Enter your account email and we will send you a link to choose a new password.</p>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required autoFocus />
            </label>
            <ErrorNote error={error} />
            <button className="mx-btn primary block" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <p className="mx-foot">
          <button className="mx-link" type="button" onClick={() => (setError(null), setStep('password'))}>
            Back to sign in
          </button>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard portal={portal} title="Sign in">
      {checking ? (
        <p className="mx-muted">Checking session…</p>
      ) : user && hasAccess ? (
        <>
          <p className="mx-muted">
            Signed in as <strong>{user.email}</strong>.
          </p>
          <div className="mx-actions">
            <a className="mx-btn primary" href={next()}>
              Continue
            </a>
            <button className="mx-btn" onClick={onSignOut} disabled={busy} type="button">
              Sign out
            </button>
          </div>
        </>
      ) : user && !hasAccess ? (
        <>
          <p className="mx-muted">
            Signed in as <strong>{user.email}</strong>, but this account does not have access to the {def.name}.
          </p>
          <p className="mx-muted">Sign in with a different account that is authorised for this portal.</p>
          <div className="mx-actions">
            <button className="mx-btn primary" onClick={onSignOut} disabled={busy} type="button">
              Sign in with a different account
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate={false}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required autoFocus />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <ErrorNote error={error} />
          <button className="mx-btn primary block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button className="mx-link" type="button" onClick={() => (setError(null), setStep('forgot'))}>
            Forgot password?
          </button>
        </form>
      )}
    </AuthCard>
  );
}
