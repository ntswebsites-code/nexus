import type { NextConfig } from 'next';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// One shared .env at the repository root feeds every portal.
loadEnvConfig(path.resolve(process.cwd(), '../..'));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@matanho/shared', '@matanho/legacy-runtime'],
  poweredByHeader: false,
};

export default nextConfig;
