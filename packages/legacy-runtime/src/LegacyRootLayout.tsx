import type { ReactNode } from 'react';
import type { LegacyManifest } from './types';

const bootCss = `
html:not([data-legacy-ready]) body > :not(#mx-boot){visibility:hidden}
html[data-legacy-ready] #mx-boot{display:none}
#mx-boot{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:#f5f7fb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0e1d32}
#mx-boot .mx-boot-inner{display:grid;justify-items:center;gap:14px}
#mx-boot .mx-boot-brand{font-size:28px;font-weight:850;letter-spacing:-.055em}
#mx-boot .mx-boot-spin{width:22px;height:22px;border:2.5px solid #d5dde8;border-top-color:#3158e8;border-radius:50%;animation:mx-boot-spin .7s linear infinite}
#mx-boot .mx-boot-label{font-size:11px;color:#6f7b8c;letter-spacing:.08em;font-weight:700}
@keyframes mx-boot-spin{to{transform:rotate(360deg)}}
`;

/**
 * Root layout for a legacy portal: reproduces the original `<html>` attributes
 * and links the original stylesheets in their original cascade order.
 *
 * Until the prototype scripts finish, a branded splash hides the empty markup
 * so visitors never see a half-built page.
 */
export function LegacyRootLayout({
  manifest,
  children,
}: {
  manifest: LegacyManifest;
  children: ReactNode;
}) {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
  return (
    <html lang={manifest.lang} {...manifest.htmlAttributes} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `window.__MATANHO_API__=${JSON.stringify(apiUrl)};` }} />
        <style dangerouslySetInnerHTML={{ __html: bootCss }} />
        {manifest.styles.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body suppressHydrationWarning>
        <div id="mx-boot" role="status" aria-live="polite">
          <div className="mx-boot-inner">
            <div className="mx-boot-brand">matanho</div>
            <div className="mx-boot-spin" aria-hidden="true" />
            <div className="mx-boot-label">LOADING WORKSPACE</div>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
