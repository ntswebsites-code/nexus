import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PortalSwitch } from '@/components/PortalSwitch';

export const metadata: Metadata = {
  title: 'Matanho | Investee Portal',
  description: 'Reporting, KPIs, term sheets and capital requests for Matanho portfolio companies.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function InvesteeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <PortalSwitch>{children}</PortalSwitch>
      </body>
    </html>
  );
}
