import { createPortalProxy } from '@matanho/portal-kit/proxy';

// No-op unless "admin" is listed in REQUIRE_AUTH_PORTALS (see .env.example).
export const proxy = createPortalProxy('admin', { requirePortalRole: true });

export const config = {
  matcher: ['/((?!_next/|legacy/|assets/|login|invite|reset-password|favicon.ico).*)'],
};
