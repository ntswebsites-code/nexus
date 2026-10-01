import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/ops/session';
import { OpsShell } from '@/ops/Shell';
import './ops.css';

export const metadata: Metadata = { title: 'Operations | Matanho Nexus' };

/** Root layout for the native staff operations console (separate from the legacy workspace layout). */
export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="ops-body">
        <SessionProvider>
          <OpsShell>{children}</OpsShell>
        </SessionProvider>
      </body>
    </html>
  );
}
