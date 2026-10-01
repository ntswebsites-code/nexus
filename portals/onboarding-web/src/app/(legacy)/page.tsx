import { LegacyPortalPage } from '@matanho/legacy-runtime/server';
import { fragments, manifest } from '@/legacy/manifest';

/**
 * Public onboarding application. Intentionally open to anonymous applicants;
 * it is not gated by the auth proxy. `/live/onboarding-live.js` runs before the
 * prototype and connects it to the public applications API when the
 * `onboarding.live` flag is on (otherwise it shows the "Demo data" ribbon).
 */
const liveManifest = { ...manifest, scripts: ['/live/onboarding-live.js', ...manifest.scripts] };

export default function OnboardingHomePage() {
  return <LegacyPortalPage portalId="onboarding" manifest={liveManifest} fragments={fragments} />;
}
