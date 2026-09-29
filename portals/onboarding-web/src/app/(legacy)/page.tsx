import { LegacyPortalPage } from '@matanho/legacy-runtime/server';
import { fragments, manifest } from '@/legacy/manifest';

/**
 * Public onboarding application. Intentionally open to anonymous applicants;
 * it is not gated by the auth proxy.
 */
export default function OnboardingHomePage() {
  return <LegacyPortalPage portalId="onboarding" manifest={manifest} fragments={fragments} />;
}
