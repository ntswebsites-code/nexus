import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Matanho | Documents to sign' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function EsignLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f5f8fc' }}>{children}</body>
    </html>
  );
}
