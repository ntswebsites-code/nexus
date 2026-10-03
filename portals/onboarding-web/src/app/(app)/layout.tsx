import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Matanho | Investor Application',
  description: 'Apply to invest with Matanho: institutional and individual onboarding with secure document upload and live status tracking.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
