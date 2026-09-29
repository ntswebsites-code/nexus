import { LegacyPortalPage } from '@matanho/legacy-runtime/server';
import { fragments, manifest } from '@/legacy/manifest';

/** Investor portal. Markup: src/legacy/markup, styles/scripts: public/legacy. */
export default function InvestorHomePage() {
  return <LegacyPortalPage portalId="investor" manifest={manifest} fragments={fragments} />;
}
