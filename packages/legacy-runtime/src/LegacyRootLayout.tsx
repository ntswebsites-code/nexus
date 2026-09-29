import type { ReactNode } from 'react';
import type { LegacyManifest } from './types';

/**
 * Root layout for a legacy portal: reproduces the original `<html>` attributes
 * and links the original stylesheets in their original cascade order.
 */
export function LegacyRootLayout({
  manifest,
  children,
}: {
  manifest: LegacyManifest;
  children: ReactNode;
}) {
  return (
    <html lang={manifest.lang} {...manifest.htmlAttributes} suppressHydrationWarning>
      <head>
        {manifest.styles.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
