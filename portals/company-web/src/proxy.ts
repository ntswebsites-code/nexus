import { createPortalProxy } from '@matanho/portal-kit/proxy';

// No-op unless "company" is listed in REQUIRE_AUTH_PORTALS (see .env.example).
export const proxy = createPortalProxy('company', { requirePortalRole: false });

export const config = {
  matcher: ['/((?!_next/|login|favicon.ico).*)'],
};
