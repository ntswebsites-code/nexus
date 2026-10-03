'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Prototype page id (the old `/#reconciliation` style link) -> native console route. */
const PAGE_ROUTES: Record<string, string> = {
  command: '/ops/command',
  portfolios: '/ops/portfolios',
  'private-markets': '/ops/private-markets',
  'portfolio-lab': '/ops/portfolio-lab',
  orders: '/ops/orders',
  research: '/ops/research',
  risk: '/ops/risk',
  performance: '/ops/performance',
  clients: '/ops/clients',
  'investor-services': '/ops/investor-services',
  onboarding: '/ops/onboarding',
  reports: '/ops/reports',
  vault: '/ops/vault',
  ibor: '/ops/ibor',
  financing: '/ops/financing',
  cash: '/ops/cash',
  operations: '/ops/operations',
  reconciliations: '/ops/reconciliation',
  reconciliation: '/ops/reconciliation',
  'corporate-actions': '/ops/corporate-actions',
  valuation: '/ops/nav',
  accounting: '/ops/accounting',
  regulatory: '/ops/regulatory',
  data: '/ops/data',
  'model-governance': '/ops/model-governance',
  copilot: '/ops/copilot',
  rbac: '/ops/rbac',
  settings: '/ops/settings',
  audit: '/ops/audit',
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
    if (target && window.location.pathname === '/ops') router.replace(target);
  }, [router]);
  return null;
}
