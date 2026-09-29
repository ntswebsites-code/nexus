import type { CSSProperties } from 'react';

const transparentBox: CSSProperties = { display: 'contents' };

/**
 * Renders a fragment of original prototype markup verbatim.
 *
 * The wrapper uses `display: contents`, so it generates no layout box and the
 * original CSS (grid/flex/position rules) continues to apply exactly as before.
 * The markup is trusted, build-time content generated from the repository - it
 * never contains user input.
 */
export function LegacyHtml({ html, id }: { html: string; id?: string }) {
  return (
    <div
      id={id}
      style={transparentBox}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
