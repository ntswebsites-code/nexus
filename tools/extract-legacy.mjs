#!/usr/bin/env node
/**
 * One-off migration tool: converts the original static Matanho prototype
 * (single HTML files + versioned enhancement scripts/styles) into the assets
 * consumed by the Next.js portals.
 *
 *   node tools/extract-legacy.mjs                # extract admin, onboarding, custodian
 *   node tools/extract-legacy.mjs --only admin
 *   node tools/extract-legacy.mjs --analyze admin  # print structure, write nothing
 *   node tools/extract-legacy.mjs --rev <git-rev>  # source revision (default: root commit)
 *
 * The originals are read from git history (default: the repository's first
 * commit) so the tool is repeatable even after the static files have been
 * removed from the working tree.
 *
 * Nothing is rewritten except:
 *   - the six identical inline base64 copies of the Matanho logo are replaced by
 *     one shared file (public/assets/matanho-logo.png);
 *   - <script>/<style>/<link> tags are moved out of the markup into separate
 *     files, preserving their exact document order.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';
import { applyBridge } from './legacy-bridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORTALS = {
  admin: {
    source: 'index.html',
    outDir: 'portals/admin-web',
    // Extra files referenced by relative <script src>/<link href> live at repo root in the source revision.
    fragments: 'auto',
  },
  // V65 prototype pages are read from the working tree (legacy-static/v65), not git history.
  onboarding: { source: 'public-onboarding.html', sourceDir: 'legacy-static/v65', outDir: 'portals/onboarding-web', fragments: 'single' },
  custodian: { source: 'custodian-portal.html', sourceDir: 'legacy-static/v65', outDir: 'portals/custodian-web', fragments: 'single' },
};

// ---------------------------------------------------------------- CLI ------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? true);
};
const analyze = flag('--analyze');
const only = analyze && analyze !== true ? analyze : flag('--only');
const rev =
  flag('--rev') ||
  execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split('\n')[0];

const git = (file, encoding = 'utf8') =>
  execFileSync('git', ['show', `${rev}:${file}`], { cwd: root, encoding, maxBuffer: 1 << 28 });

/** Reads a source file for a portal: from `cfg.sourceDir` when set, otherwise from git at `rev`. */
const reader = (cfg) => (file) => (cfg.sourceDir ? readFileSync(path.join(root, cfg.sourceDir, file), 'utf8') : git(file));

// ------------------------------------------------------------ scanning -----
const TOKEN = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi;

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

function scan(html) {
  /** @type {{kind:'script'|'style'|'link', start:number, end:number, open:string, body:string}[]} */
  const items = [];
  TOKEN.lastIndex = 0;
  for (let m; (m = TOKEN.exec(html)); ) {
    const text = m[0];
    if (text.startsWith('<!--')) continue;
    const lower = text.slice(0, 7).toLowerCase();
    if (lower.startsWith('<script')) {
      const open = /^<script\b[^>]*>/i.exec(text)[0];
      items.push({ kind: 'script', start: m.index, end: m.index + text.length, open, body: text.slice(open.length, text.lastIndexOf('</')) });
    } else if (lower.startsWith('<style')) {
      const open = /^<style\b[^>]*>/i.exec(text)[0];
      items.push({ kind: 'style', start: m.index, end: m.index + text.length, open, body: text.slice(open.length, text.lastIndexOf('</')) });
    } else {
      items.push({ kind: 'link', start: m.index, end: m.index + text.length, open: text, body: '' });
    }
  }
  return items;
}

function stripRanges(text, ranges) {
  let out = '';
  let pos = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    out += text.slice(pos, r.start);
    pos = r.end;
  }
  return out + text.slice(pos);
}

// ----------------------------------------------------------- logo dedupe ---
const LOGO_RE = /data:image\/png;base64,[A-Za-z0-9+/=]{2000,}/g;
const LOGO_PUBLIC_URL = '/assets/matanho-logo.png';
const LOGO_JS_EXPR = '${window.__MATANHO_LOGO__}';

function extractLogo(html) {
  const found = html.match(LOGO_RE) ?? [];
  const unique = [...new Set(found)];
  if (unique.length > 1) throw new Error(`Expected one unique logo, found ${unique.length}`);
  return unique[0];
}

function pngFromDataUri(uri) {
  return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
}

// ------------------------------------------------- defect patches ---------
/**
 * Minimal, documented fixes for defects in the ORIGINAL prototype that stop it
 * from running at all. They change no visible text, layout or behaviour.
 *
 * v53-client-portal.js: `simplify()` is registered as a MutationObserver
 * callback on document.body (childList + subtree) and unconditionally assigns
 * `textContent`. Every assignment replaces a text node, which queues another
 * mutation record, which re-runs `simplify()` -> an endless microtask loop that
 * freezes the tab (reproducible on the untouched original client-portal.html).
 * Writing only when the value actually differs makes it converge after one pass
 * while producing exactly the same final text.
 */
const PATCHES = {
  'v53-client-portal.js': [
    [
      "function simplify(){\n",
      "function setText(el,t){if(el&&el.textContent!==t)el.textContent=t}\nfunction simplify(){\n",
    ],
    [
      "const inv=$('.nav-btn[data-page=\"investments\"] span');if(inv)inv.textContent='Portfolio';",
      "const inv=$('.nav-btn[data-page=\"investments\"] span');setText(inv,'Portfolio');",
    ],
    [
      "const msg=$('.nav-btn[data-page=\"messages\"] span');if(msg)msg.textContent='Support';",
      "const msg=$('.nav-btn[data-page=\"messages\"] span');setText(msg,'Support');",
    ],
    [
      "const top=$('#topContext');if(top)top.textContent='Published relationship view';",
      "const top=$('#topContext');setText(top,'Published relationship view');",
    ],
    [
      "if(eye)eye.textContent='INVESTOR PORTAL';if(h)h.textContent='Your portfolio, clearly.';if(p)p.textContent='See published performance, upcoming capital actions and documents without the operational detail used by the investment team.'",
      "setText(eye,'INVESTOR PORTAL');setText(h,'Your portfolio, clearly.');setText(p,'See published performance, upcoming capital actions and documents without the operational detail used by the investment team.')",
    ],
    [
      "if(mb)mb.lastChild.textContent='Portfolio';",
      "if(mb)setText(mb.lastChild,'Portfolio');",
    ],
    [
      "b.dataset.go='messages'",
      "if(b.dataset.go!=='messages')b.dataset.go='messages'",
    ],
  ],
};

function applyPatches(name, text) {
  const list = PATCHES[name];
  if (!list) return text;
  let out = text.replace(/\r\n/g, '\n');
  for (const [from, to] of list) {
    if (!out.includes(from)) throw new Error(`Patch for ${name} no longer matches: ${from.slice(0, 60)}`);
    out = out.replace(from, () => to);
  }
  return out;
}

// ----------------------------------------------------------- main ----------
function processPortal(id, cfg) {
  const read = reader(cfg);
  const origin = cfg.sourceDir ?? `@ ${rev.slice(0, 7)}`;
  const html = read(cfg.source);
  const logo = extractLogo(html);
  const items = scan(html);

  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  const bodyClose = html.lastIndexOf('</body>');
  const bodyStart = bodyOpen.index + bodyOpen[0].length;

  const headHtml = html.slice(0, bodyOpen.index);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(headHtml)?.[1]?.trim() ?? '';
  const description = attr(/<meta\b[^>]*name=["']description["'][^>]*>/i.exec(headHtml)?.[0] ?? '', 'content');
  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? '<html>';
  const lang = attr(htmlTag, 'lang') ?? 'en';
  const htmlAttributes = {};
  for (const m of htmlTag.matchAll(/\s(data-[\w-]+)\s*=\s*"([^"]*)"/g)) htmlAttributes[m[1]] = m[2];

  const styles = [];
  const scripts = [];
  const ranges = [];
  let styleN = 0;
  let scriptN = 0;

  for (const it of items) {
    if (it.kind === 'link') {
      if (!/rel=["']?stylesheet/i.test(it.open)) continue;
      const href = attr(it.open, 'href');
      if (!href || /^https?:/i.test(href)) {
        if (href) styles.push({ type: 'remote', href });
      } else {
        styles.push({ type: 'file', file: href });
      }
      if (it.start >= bodyStart && it.end <= bodyClose) ranges.push(it);
    } else if (it.kind === 'style') {
      styles.push({ type: 'inline', name: `${String(++styleN).padStart(2, '0')}-${attr(it.open, 'id') ?? 'inline'}`, css: it.body });
      if (it.start >= bodyStart && it.end <= bodyClose) ranges.push(it);
    } else if (it.kind === 'script') {
      const type = attr(it.open, 'type');
      if (type && !/javascript|module/i.test(type)) continue; // data blocks etc.
      const src = attr(it.open, 'src');
      if (src) scripts.push({ type: 'file', file: src });
      else scripts.push({ type: 'inline', name: `${String(++scriptN).padStart(2, '0')}-${attr(it.open, 'id') ?? 'inline'}`, js: it.body });
      if (it.start >= bodyStart && it.end <= bodyClose) ranges.push(it);
    }
  }

  const markup = stripRanges(html.slice(bodyStart, bodyClose), ranges.map((r) => ({ start: r.start - bodyStart, end: r.end - bodyStart })));
  const fragments = splitFragments(id, markup, cfg.fragments);

  if (analyze) {
    console.log(`\n=== ${id} (${cfg.source}) ${origin}`);
    console.log(`title: ${title}\nlang: ${lang} attrs: ${JSON.stringify(htmlAttributes)}\nbody markup: ${markup.length} chars`);
    console.log(`styles (${styles.length}):`, styles.map((s) => (s.type === 'inline' ? `inline:${s.name}(${s.css.length})` : s.file ?? s.href)).join(', '));
    console.log(`scripts (${scripts.length}):`, scripts.map((s) => (s.type === 'inline' ? `inline:${s.name}(${s.js.length})` : s.file)).join(', '));
    console.log(`fragments (${fragments.length}):`);
    for (const f of fragments) console.log(`  ${f.file.padEnd(46)} ${String(f.html.length).padStart(8)}  ${f.label}`);
    return;
  }

  // ---------------------------------------------------------------- write
  const out = path.join(root, cfg.outDir);
  const legacyPublic = path.join(out, 'public', 'legacy');
  const legacySrc = path.join(out, 'src', 'legacy');
  rmSync(legacyPublic, { recursive: true, force: true });
  rmSync(path.join(legacySrc, 'markup'), { recursive: true, force: true });
  mkdirSync(path.join(legacyPublic, 'css'), { recursive: true });
  mkdirSync(path.join(legacyPublic, 'js'), { recursive: true });
  mkdirSync(path.join(legacySrc, 'markup'), { recursive: true });

  const noLogo = (t, replacement) => (logo ? t.split(logo).join(replacement) : t);
  const styleUrls = [];
  const scriptUrls = [];

  for (const s of styles) {
    if (s.type === 'remote') styleUrls.push(s.href);
    else if (s.type === 'file') {
      const name = path.basename(s.file);
      writeFileSync(path.join(legacyPublic, 'css', name), noLogo(read(s.file), LOGO_PUBLIC_URL));
      styleUrls.push(`/legacy/css/${name}`);
    } else {
      const name = `${s.name}.css`;
      writeFileSync(path.join(legacyPublic, 'css', name), noLogo(s.css, LOGO_PUBLIC_URL));
      styleUrls.push(`/legacy/css/${name}`);
    }
  }

  // Runtime constant used by scripts that generate printable documents.
  if (logo && id === 'admin') {
    writeFileSync(
      path.join(legacyPublic, 'js', '00-runtime-config.js'),
      "window.__MATANHO_LOGO__ = window.location.origin + '" + LOGO_PUBLIC_URL + "';\n",
    );
    scriptUrls.push('/legacy/js/00-runtime-config.js');
  }
  for (const s of scripts) {
    if (s.type === 'file') {
      const name = path.basename(s.file);
      writeFileSync(path.join(legacyPublic, 'js', name), applyPatches(name, noLogo(read(s.file), LOGO_JS_EXPR)));
      scriptUrls.push(`/legacy/js/${name}`);
    } else {
      const name = `${s.name}.js`;
      writeFileSync(path.join(legacyPublic, 'js', name), noLogo(s.js, LOGO_JS_EXPR));
      scriptUrls.push(`/legacy/js/${name}`);
    }
  }

  if (Array.isArray(cfg.extraScripts)) {
    const extrasDir = path.join(out, 'src', 'legacy', 'extras');
    for (const name of cfg.extraScripts) {
      const src = path.join(extrasDir, name);
      writeFileSync(path.join(legacyPublic, 'js', name), readFileSync(src));
      scriptUrls.push(`/legacy/js/${name}`);
    }
  }

  if (logo) {
    mkdirSync(path.join(out, 'public', 'assets'), { recursive: true });
    writeFileSync(path.join(out, 'public', 'assets', 'matanho-logo.png'), pngFromDataUri(logo));
  }
  for (const f of fragments) writeFileSync(path.join(legacySrc, 'markup', f.file), noLogo(f.html, LOGO_PUBLIC_URL));

  const manifest = { lang, htmlAttributes, title, ...(description ? { description } : {}), styles: styleUrls, scripts: scriptUrls };
  writeFileSync(
    path.join(legacySrc, 'manifest.ts'),
    `// GENERATED by tools/extract-legacy.mjs from ${cfg.source} ${origin}. Do not edit by hand.\n` +
      `import type { LegacyManifest } from '@matanho/legacy-runtime';\n\n` +
      `export const manifest: LegacyManifest = ${JSON.stringify(manifest, null, 2)};\n\n` +
      `/** Markup fragments, in document order (files under ./markup). */\n` +
      `export const fragments = ${JSON.stringify(fragments.map((f) => ({ file: f.file, label: f.label })), null, 2)} as const;\n`,
  );
  console.log(`${id}: ${styleUrls.length} stylesheets, ${scriptUrls.length} scripts, ${fragments.length} markup fragments -> ${cfg.outDir}`);
  // Re-install the live-data bridge (scripts + recorded data hooks) on the fresh output.
  const bridged = applyBridge(id);
  console.log(`${id}: bridge installed (${bridged.length} files)`);
}

// ------------------------------------------------- markup fragmenting -----
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'fragment';
}

// Layout wrappers that are cut open so each logical region (sidebar, topbar,
// every page section ...) becomes its own source file. The pieces are
// contiguous slices of the original markup, so concatenating them in order
// reproduces the original body byte-for-byte (the DOM is identical).
const WRAPPERS = new Set(['div#appShell', 'main.main-area', 'div.app', 'main.main', 'div.content']);

function describe(node) {
  const a = Object.fromEntries((node.attrs ?? []).map((x) => [x.name, x.value]));
  const cls = a.class ? a.class.split(/\s+/)[0] : '';
  return { key: `${node.tagName}${a.id ? `#${a.id}` : cls ? `.${cls}` : ''}`, id: a.id, tag: node.tagName, cls };
}

function splitFragments(id, markup, mode) {
  if (mode === 'single') return [{ file: '01-body.html', label: 'body', html: markup }];

  const doc = parseFragment(markup, { sourceCodeLocationInfo: true });
  const marks = new Map(); // offset -> label

  const visit = (nodes) => {
    const elements = nodes.filter((n) => n.tagName && n.sourceCodeLocation);
    for (const n of elements) {
      const d = describe(n);
      const isWrapper = WRAPPERS.has(d.key) || WRAPPERS.has(`${d.tag}.${d.cls}`);
      const base = d.id ?? `${d.tag}${d.cls ? `-${d.cls}` : ''}`;
      marks.set(n.sourceCodeLocation.startOffset, isWrapper ? `${base}-open` : base);
      if (isWrapper) {
        visit(n.childNodes);
        const kids = n.childNodes.filter((c) => c.tagName && c.sourceCodeLocation);
        if (kids.length) marks.set(kids.at(-1).sourceCodeLocation.endOffset, `${d.id ?? d.tag}-end`);
      }
    }
  };
  visit(doc.childNodes);

  const offsets = [...marks.keys()].sort((a, b) => a - b);
  const pieces = offsets.map((start, i) => ({
    label: marks.get(start),
    // The first piece also owns any leading whitespace before the first element.
    html: markup.slice(i === 0 ? 0 : start, offsets[i + 1] ?? markup.length),
  }));

  const named = pieces.map((p, i) => ({
    file: `${String(i + 1).padStart(2, '0')}-${slug(p.label)}.html`,
    label: p.label,
    html: p.html,
  }));
  if (named.map((n) => n.html).join('') !== markup) throw new Error(`Fragment split of ${id} is not lossless`);
  return named;
}

for (const [id, cfg] of Object.entries(PORTALS)) {
  if (only && only !== id) continue;
  processPortal(id, cfg);
}
