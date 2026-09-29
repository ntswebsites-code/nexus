import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LegacyRootLayout } from '@matanho/legacy-runtime';
import { manifest } from '@/legacy/manifest';

export const metadata: Metadata = {
  title: manifest.title,
  description: manifest.description,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <LegacyRootLayout manifest={manifest}>{children}</LegacyRootLayout>;
}
