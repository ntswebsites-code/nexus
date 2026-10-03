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

/**
 * Security headers (NFR-SEC-013). The CSP keeps 'unsafe-inline' for scripts and styles because Next.js emits inline
 * bootstrap scripts and the legacy-runtime pages use inline handlers; everything else is locked to this origin and the API.
 * frame-ancestors 'none' blocks clickjacking. Kept identical across portals (copy, not import: this file runs before
 * workspace packages are transpiled).
 */
function securityHeaders(extra: { script?: string[]; frame?: string[] } = {}) {
  const dev = process.env.NODE_ENV !== 'production';
  const api = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} ${(extra.script ?? []).join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api}${dev ? ' ws://localhost:* http://localhost:*' : ''} ${(extra.script ?? []).join(' ')}`.trim(),
    `frame-src 'self' blob: data: ${api} ${(extra.frame ?? []).join(' ')}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@matanho/shared', '@matanho/portal-kit'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  async redirects() {
    return [
      { source: '/', destination: '/lp-portal', permanent: false },
      ...merged.map(([source, destination]) => ({ source, destination, permanent: false })),
    ];
  },
};

export default nextConfig;
