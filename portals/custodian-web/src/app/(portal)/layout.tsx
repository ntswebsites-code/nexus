import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Matanho | Custodian Portal',
  description: 'Executions, day-end packages, statements and holdings for Matanho custodians and counterparties.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
