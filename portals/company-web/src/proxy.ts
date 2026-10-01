import { createPortalProxy } from '@matanho/portal-kit/proxy';

// Sign-in is required when "company" is listed in REQUIRE_AUTH_PORTALS (production sets it).
// Company users have no roles of their own, so any signed-in account may open the portal, except
// accounts that hold an investor role: those are turned away to /access-denied.
export const proxy = createPortalProxy('company', { requirePortalRole: false, turnAwayPortals: ['investor'] });

export const config = {
  matcher: ['/((?!_next/|assets/|investee-portal-v8/|login|invite|reset-password|access-denied|favicon.ico).*)'],
};
