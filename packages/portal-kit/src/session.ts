'use client';

import { useEffect, useState } from 'react';
import { createApiClient, type AuthUser } from '@matanho/shared';

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

/** The signed-in user (from GET /api/auth/me), or null while loading or when there is no session. */
export function useSessionUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let alive = true;
    createApiClient({ baseUrl: apiUrl() })
      .me()
      .then((res) => {
        if (alive) setUser(res.user);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return user;
}

/** Ends the session on the API, then returns to the portal's sign-in page. */
export async function signOut(): Promise<void> {
  await createApiClient({ baseUrl: apiUrl() })
    .logout()
    .catch(() => undefined);
  window.location.assign('/login');
}

export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || 'U';
}
