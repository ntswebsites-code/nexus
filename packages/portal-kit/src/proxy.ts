import { NextResponse, type NextRequest } from 'next/server';
import type { AuthResponse, PortalId } from '@matanho/shared';

/**
 * Optional authentication gate for a portal (Next.js `proxy.ts`).
 *
 * Off by default so the UI mockups open without an account. Turn it on per
 * portal with `REQUIRE_AUTH_PORTALS=admin,investor,...` in the root `.env`.
 * The session itself is always validated by the shared API - this only decides
 * whether to redirect the browser to /login.
 */
export function createPortalProxy(portal: PortalId, options: { requirePortalRole: boolean }) {
  return async function proxy(request: NextRequest) {
    const gated = (process.env.REQUIRE_AUTH_PORTALS ?? '')
      .split(',')
      .map((s) => s.trim())
      .includes(portal);
    if (!gated) return NextResponse.next();

    const cookieName = process.env.SESSION_COOKIE_NAME ?? 'nexus_session';
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
    const token = request.cookies.get(cookieName)?.value;

    if (token) {
      try {
        const res = await fetch(`${apiUrl}/api/auth/me`, {
          headers: { cookie: `${cookieName}=${token}`, accept: 'application/json' },
          cache: 'no-store',
        });
        if (res.ok) {
          const { user } = (await res.json()) as AuthResponse;
          if (!options.requirePortalRole || user.roles.some((r) => r.portal === portal)) {
            return NextResponse.next();
          }
        }
      } catch {
        // API unreachable -> treat as signed out.
      }
    }

    const login = new URL('/login', request.url);
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  };
}
