import { LegacyPortalPage } from '@matanho/legacy-runtime/server';
import { fragments, manifest } from '@/legacy/manifest';

/** Original V56 admin workspace at `/` (alias `/classic`). */
export default function AdminHomePage() {
  return <LegacyPortalPage portalId="admin" manifest={manifest} fragments={fragments} />;
}
