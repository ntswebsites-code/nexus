import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { InvesteePortal } from '@/components/InvesteePortal';

export const metadata: Metadata = {
  title: 'Matanho | Investee Portal',
  description: 'Reporting, KPIs, term sheets and capital requests for Matanho portfolio companies.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function InvesteeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <InvesteePortal />
        <div hidden>{children}</div>
      </body>
    </html>
  );
}
