import type { NextConfig } from 'next';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// One shared .env at the repository root feeds every portal.
loadEnvConfig(path.resolve(process.cwd(), '../..'));

// The LP portal keeps its screens under /lp-portal. The site root and the screens that were merged
// into others in the design still resolve.
const merged: Array<[string, string]> = [
  ['/lp-portal/capital-calls', '/lp-portal/capital-activity?tab=calls'],
  ['/lp-portal/distributions', '/lp-portal/capital-activity?tab=distributions'],
  ['/lp-portal/dealing', '/lp-portal/subscriptions-redemptions'],
  ['/lp-portal/vault', '/lp-portal/documents'],
  ['/lp-portal/ledger', '/lp-portal/account-activity'],
  ['/lp-portal/messages', '/lp-portal/requests?tab=messages'],
  ['/lp-portal/colleagues', '/lp-portal/organisation'],
  ['/lp-portal/reports', '/lp-portal/documents?category=Fund%20Reports'],
  ['/lp-portal/investments/commitment', '/lp-portal#capital-position'],
  ['/lp-portal/investments/capital-account', '/lp-portal/account-activity?structure=private-capital'],
  ['/lp-portal/investments/investor-account', '/lp-portal#open-ended-account'],
  ['/lp-portal/investments/holdings', '/lp-portal/account-activity?structure=open-ended'],
  ['/lp-portal/investments', '/lp-portal'],
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@matanho/shared', '@matanho/portal-kit'],
  poweredByHeader: false,
  async redirects() {
    return [
      { source: '/', destination: '/lp-portal', permanent: false },
      ...merged.map(([source, destination]) => ({ source, destination, permanent: false })),
    ];
  },
};

export default nextConfig;
