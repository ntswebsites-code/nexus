import { LegacyPortalPage } from '@matanho/legacy-runtime/server';
import { fragments, manifest } from '@/legacy/manifest';

/**
 * Custodian submissions (trade executions and day-end packages). Not gated by the
 * auth proxy yet; custodian accounts are not part of the role catalogue.
 */
export default function CustodianHomePage() {
  return <LegacyPortalPage portalId="custodian" manifest={manifest} fragments={fragments} />;
}
