'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, PORTALS, createApiClient, type AuthUser, type PortalId } from '@matanho/shared';

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

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

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
      await api.login({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        ...(enforcePortalAccess ? { portal } : {}),
      });
      window.location.assign(next());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to reach the sign-in service. Try again shortly.');
      setBusy(false);
    }
  }

  async function onSignOut() {
    setBusy(true);
    await api.logout().catch(() => undefined);
    setUser(null);
    setBusy(false);
  }

  const def = PORTALS[portal];

  return (
    <main className="mx-login">
      <style>{css}</style>
      <section className="mx-card" aria-labelledby="mx-title">
        <div className="mx-brand">matanho</div>
        <div className="mx-eyebrow">{def.name.toUpperCase()}</div>
        <h1 id="mx-title">Sign in</h1>

        {checking ? (
          <p className="mx-muted">Checking session…</p>
        ) : user ? (
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
            {error && (
              <p className="mx-error" role="alert">
                {error}
              </p>
            )}
            <button className="mx-btn primary block" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
        <p className="mx-foot">One Matanho account works across every portal you are authorised to use.</p>
      </section>
    </main>
  );
}

const css = `
.mx-login{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f7fa;color:#000;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.mx-login *{box-sizing:border-box}
.mx-card{width:min(420px,100%);background:#fff;border:1px solid #e1e7ef;border-radius:14px;padding:26px;box-shadow:0 8px 28px rgba(15,34,65,.07)}
.mx-brand{font-size:25px;font-weight:850;letter-spacing:-.055em;margin-bottom:14px}
.mx-eyebrow{font-size:11px;color:#5364a9;letter-spacing:.12em;font-weight:850}
.mx-card h1{font-size:25px;letter-spacing:-.035em;margin:6px 0 16px;font-weight:790}
.mx-card form{display:grid;gap:12px}
.mx-card label{display:grid;gap:5px;font-size:11px;color:#4b586b;font-weight:700}
.mx-card input{border:1px solid #d5dde8;border-radius:8px;min-height:38px;padding:8px 10px;font:inherit;font-size:13px;outline:0}
.mx-card input:focus{border-color:#8297e9;box-shadow:0 0 0 3px rgba(49,88,232,.08)}
.mx-btn{height:38px;border:1px solid #d7dee8;border-radius:9px;padding:0 14px;background:#fff;color:#1d2a3b;font:inherit;font-size:12px;font-weight:760;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.mx-btn.primary{background:linear-gradient(135deg,#3158e8,#4d68e7);border-color:transparent;color:#fff}
.mx-btn.block{width:100%}
.mx-btn:disabled{opacity:.55;cursor:not-allowed}
.mx-actions{display:flex;gap:8px}
.mx-muted{font-size:12px;color:#4d5868;margin:0 0 14px}
.mx-error{margin:0;font-size:12px;color:#a9253e;background:#fff0f3;border:1px solid #edc7cf;border-radius:8px;padding:8px 10px}
.mx-foot{margin:18px 0 0;font-size:11px;color:#6f7b8c;line-height:1.5}
`;
