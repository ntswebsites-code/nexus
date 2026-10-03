import { createPortalProxy } from '@matanho/portal-kit/proxy';

// Sign-in is required when "custodian" is listed in REQUIRE_AUTH_PORTALS (production sets it).
// The account must also hold a role on the custodian portal (submitter or approver).
export const proxy = createPortalProxy('custodian', { requirePortalRole: true });

export const config = {
  matcher: ['/((?!_next/|assets/|login|invite|reset-password|access-denied|favicon.ico).*)'],
};
