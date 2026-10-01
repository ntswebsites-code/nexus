import { createPortalProxy } from '@matanho/portal-kit/proxy';

// Sign-in is required when "investor" is listed in REQUIRE_AUTH_PORTALS (production sets it).
// The user must also hold a role on the investor portal.
export const proxy = createPortalProxy('investor', { requirePortalRole: true });

export const config = {
  matcher: ['/((?!_next/|assets/|login|invite|reset-password|favicon.ico|new_logo.png).*)'],
};
