import { NextResponse, type NextRequest } from 'next/server';
import type { AuthResponse, PortalId } from '@matanho/shared';

/**
 * Optional authentication gate for a portal (Next.js `proxy.ts`).
 *
 * Off by default so the UI mockups open without an account. Turn it on per
 * portal with `REQUIRE_AUTH_PORTALS=admin,investor,...` in the root `.env`.
 * The session itself is always validated by the shared API - this only decides
 * whether to redirect the browser to /login.
 *
 * `turnAwayPortals`: signed-in users holding a role on any of these portals are sent to
 * /access-denied instead (e.g. investor accounts must not open the Investee portal).
 */
export function createPortalProxy(
  portal: PortalId,
  options: { requirePortalRole: boolean; turnAwayPortals?: PortalId[] },
) {
  return async function proxy(request: NextRequest) {
    const gated = (process.env.REQUIRE_AUTH_PORTALS ?? '')
      .split(',')
      .map((s) => s.trim())
      .includes(portal);
    if (!gated) return NextResponse.next();

    const baseCookieName = process.env.SESSION_COOKIE_NAME ?? 'nexus_session';
    // Outside production every portal shares `localhost`, so the API stores the session cookie per portal
    // port (`<name>_<port>`; see backend/api/src/config/cors.ts). Look up this portal's own cookie.
    const hostHeader = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
    const [hostName, hostPort] = hostHeader.split(':');
    const scopedLocally =
      process.env.NODE_ENV !== 'production' &&
      !!hostPort &&
      /^(localhost|127\.0\.0\.1|.+\.localhost)$/i.test(hostName);
    const cookieName = scopedLocally ? `${baseCookieName}_${hostPort}` : baseCookieName;
    // API_INTERNAL_URL lets the server reach the API over a private network
    // (e.g. http://api:4100 in Docker) instead of the public hostname.
    const apiUrl = (
      process.env.API_INTERNAL_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      'http://localhost:4100'
    ).replace(/\/+$/, '');
    const token = request.cookies.get(cookieName)?.value;

    // Behind a reverse proxy request.url carries the internal host (e.g.
    // 127.0.0.1:3100), so rebuild the public origin from the forwarded headers.
    const publicUrl = (path: string) => {
      const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
      const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
      return new URL(path, host ? `${proto ?? request.nextUrl.protocol.replace(':', '')}://${host}` : request.url);
    };

    if (token) {
      try {
        const res = await fetch(`${apiUrl}/api/auth/me`, {
          headers: { cookie: `${baseCookieName}=${token}`, accept: 'application/json' },
          cache: 'no-store',
        });
        if (res.ok) {
          const { user } = (await res.json()) as AuthResponse;
          const turnedAway = (options.turnAwayPortals ?? []).some((p) => user.roles.some((r) => r.portal === p));
          if (turnedAway) return NextResponse.redirect(publicUrl('/access-denied'));
          if (!options.requirePortalRole || user.roles.some((r) => r.portal === portal)) {
            return NextResponse.next();
          }
        }
      } catch {
        // API unreachable -> treat as signed out.
      }
    }

    const login = publicUrl('/login');
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  };
}
