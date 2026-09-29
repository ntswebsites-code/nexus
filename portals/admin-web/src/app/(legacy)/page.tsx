import { LegacyPortalPage } from '@matanho/legacy-runtime/server';
import { fragments, manifest } from '@/legacy/manifest';

/**
 * Nexus admin workspace. Markup lives in src/legacy/markup (one file per region:
 * sidebar, top bar, each workspace page, drawers, modals); styles and scripts
 * in public/legacy. See docs/ARCHITECTURE.md for the bridge design.
 */
export default function AdminHomePage() {
  return <LegacyPortalPage portalId="admin" manifest={manifest} fragments={fragments} />;
}
