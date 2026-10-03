import type { NextConfig } from 'next';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// One shared .env at the repository root feeds every portal.
loadEnvConfig(path.resolve(process.cwd(), '../..'));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@matanho/shared', '@matanho/legacy-runtime', '@matanho/portal-kit'],
  poweredByHeader: false,
  // GAP-021: the native console is the landing page; the V56 prototype workspace now lives at /classic
  // and keeps only its live-bridged pages (see src/legacy/bridge/admin-01-retired.js).
  async redirects() {
    return [{ source: '/', destination: '/ops', permanent: false }];
  },
};

export default nextConfig;

