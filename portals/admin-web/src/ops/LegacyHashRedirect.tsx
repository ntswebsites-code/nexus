'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Prototype page id (the old `/#reconciliation` style link) -> native console route. */
const PAGE_ROUTES: Record<string, string> = {
  command: '/ops-native/command',
  portfolios: '/ops-native/portfolios',
  'private-markets': '/ops-native/private-markets',
  'portfolio-lab': '/ops-native/portfolio-lab',
  orders: '/ops-native/orders',
  research: '/ops-native/research',
  risk: '/ops-native/risk',
  performance: '/ops-native/performance',
  clients: '/ops-native/clients',
  'investor-services': '/ops-native/investor-services',
  onboarding: '/ops-native/onboarding',
  reports: '/ops-native/reports',
  vault: '/ops-native/vault',
  ibor: '/ops-native/ibor',
  financing: '/ops-native/financing',
  cash: '/ops-native/cash',
  operations: '/ops-native/operations',
  reconciliations: '/ops-native/reconciliation',
  reconciliation: '/ops-native/reconciliation',
  'corporate-actions': '/ops-native/corporate-actions',
  valuation: '/ops-native/nav',
  accounting: '/ops-native/accounting',
  regulatory: '/ops-native/regulatory',
  data: '/ops-native/data',
  'model-governance': '/ops-native/model-governance',
  copilot: '/ops-native/copilot',
  rbac: '/ops-native/rbac',
  settings: '/ops-native/settings',
  audit: '/ops-native/audit',
};

/**
 * Notification emails and in-app links written for the old workspace point at `/#<page>`. `/` now redirects to
 * `/ops` and the browser keeps the fragment, so `/ops#reconciliation` is forwarded to the native page here.
 */
export function LegacyHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const page = window.location.hash.replace(/^#/, '').split(/[/?]/)[0] ?? '';
    const target = PAGE_ROUTES[page];
    if (target && (window.location.pathname === '/ops-native' || window.location.pathname === '/ops')) router.replace(target);
  }, [router]);
  return null;
}
