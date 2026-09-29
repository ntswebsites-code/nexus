import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LegacyHtml } from './LegacyHtml';
import { LegacyScripts } from './LegacyScripts';
import type { LegacyManifest } from './types';

/**
 * Reads the generated markup fragments (src/legacy/markup/*.html) of the
 * calling portal and joins them in document order. Runs on the server only.
 * Fragments are contiguous slices of the original body, so the result is
 * byte-identical to the original markup.
 */
export function loadLegacyMarkup(
  fragments: readonly { readonly file: string }[],
  dir = path.join(process.cwd(), 'src', 'legacy', 'markup'),
): string {
  return fragments.map((f) => readFileSync(path.join(dir, f.file), 'utf8')).join('');
}

/** Complete legacy page: original markup + ordered original scripts. */
export function LegacyPortalPage({
  portalId,
  manifest,
  fragments,
}: {
  portalId: string;
  manifest: LegacyManifest;
  fragments: readonly { readonly file: string }[];
}) {
  return (
    <>
      <LegacyHtml html={loadLegacyMarkup(fragments)} />
      <LegacyScripts portalId={portalId} scripts={manifest.scripts} />
    </>
  );
}
