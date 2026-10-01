'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '@matanho/shared';
import { apiRequest, OpsError } from './api';

interface SessionState {
  user: AuthUser;
  can: (...anyOf: string[]) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Shorthand: true when the signed-in user holds any of the permission codes. */
export function useCan(...anyOf: string[]): boolean {
  return useSession().can(...anyOf);
}

/**
 * Loads the admin session (`GET /api/auth/me`, the same cookie as the legacy workspace).
 * Signed-out users go to /login; users without an admin role see a refusal.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ok'; user: AuthUser } | { kind: 'denied' } | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    apiRequest<{ user: AuthUser; mfa?: string }>('GET', '/api/auth/me')
      .then((res) => {
        if (!alive) return;
        if (res.mfa) {
          redirectToLogin();
          return;
        }
        if (!res.user.roles.some((r) => r.portal === 'admin')) setState({ kind: 'denied' });
        else setState({ kind: 'ok', user: res.user });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof OpsError && e.status === 401) redirectToLogin();
        else setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load your session.' });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="ops-splash" role="status">
        <div className="ops-brand-big">matanho</div>
        <div className="ops-spin" aria-hidden="true" />
        <div className="ops-splash-label">LOADING OPERATIONS CONSOLE</div>
      </div>
    );
  }
  if (state.kind === 'denied') {
    return (
      <div className="ops-splash">
        <div className="ops-brand-big">matanho</div>
        <p>Your account does not have access to the staff workspace.</p>
        <a className="ops-btn" href="/login">
          Sign in with a different account
        </a>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="ops-splash">
        <div className="ops-brand-big">matanho</div>
        <p>{state.message}</p>
        <button className="ops-btn" type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const granted = new Set(state.user.permissions);
  const value: SessionState = { user: state.user, can: (...anyOf) => anyOf.some((p) => granted.has(p)) };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function redirectToLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}
