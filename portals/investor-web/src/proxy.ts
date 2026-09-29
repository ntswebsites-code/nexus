import { createPortalProxy } from '@matanho/portal-kit/proxy';

// No-op unless "investor" is listed in REQUIRE_AUTH_PORTALS (see .env.example).
export const proxy = createPortalProxy('investor', { requirePortalRole: true });

export const config = {
  matcher: ['/((?!_next/|legacy/|assets/|login|favicon.ico).*)'],
};
