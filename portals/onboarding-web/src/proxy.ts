import { createPortalProxy } from '@matanho/portal-kit/proxy';

// The onboarding application is public. This is a no-op unless "onboarding" is
// explicitly listed in REQUIRE_AUTH_PORTALS.
export const proxy = createPortalProxy('onboarding', { requirePortalRole: false });

export const config = {
  matcher: ['/((?!_next/|legacy/|live/|assets/|login|invite|reset-password|favicon.ico).*)'],
};
