import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LegacyRootLayout } from '@matanho/legacy-runtime';
import { manifest } from '@/legacy/manifest';

export const metadata: Metadata = {
  title: manifest.title,
  description: manifest.description,
};

// Matches the original <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function InvestorLayout({ children }: { children: ReactNode }) {
  return <LegacyRootLayout manifest={manifest}>{children}</LegacyRootLayout>;
}
