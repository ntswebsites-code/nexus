import { LegacyPortalPage } from '@matanho/legacy-runtime/server';
import { fragments, manifest } from '@/legacy/manifest';

/**
 * Custodian submissions (trade executions and day-end packages). `/live/custodian-live.js`
 * runs before the prototype: with the `custodian.live` flag on it requires a counterparty
 * sign-in and posts every submission to `/api/v1/custodian`; otherwise it shows the
 * "Demo data" ribbon and the prototype keeps its browser-only records.
 */
const liveManifest = { ...manifest, scripts: ['/live/custodian-live.js', ...manifest.scripts] };

export default function CustodianHomePage() {
  return <LegacyPortalPage portalId="custodian" manifest={liveManifest} fragments={fragments} />;
}
