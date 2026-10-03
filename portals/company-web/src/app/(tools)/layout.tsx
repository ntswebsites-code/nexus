import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Matanho | Workspace' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function ToolsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f3f6fb' }}>{children}</body>
    </html>
  );
}
