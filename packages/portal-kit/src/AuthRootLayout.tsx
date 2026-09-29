import type { ReactNode } from 'react';

/**
 * Root layout for the auth routes (/login). Deliberately separate from the
 * portal's own root layout so the sign-in page never inherits the prototype's
 * global stylesheets.
 */
export function AuthRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
