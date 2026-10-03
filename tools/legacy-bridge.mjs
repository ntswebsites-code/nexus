#!/usr/bin/env node
/**
 * Legacy data bridge installer (SRD Phase 1, "legacy data bridge").
 *
 *   node tools/legacy-bridge.mjs            # all legacy portals
 *   node tools/legacy-bridge.mjs --only admin
 *   node tools/legacy-bridge.mjs --check    # verify, write nothing (exit 1 if out of date)
 *
 * For each legacy portal it
 *   1. copies the shared bridge core (packages/legacy-runtime/bridge/mx-core.js)
 *      and the portal bridge (portals/<p>/src/legacy/bridge/*.js) to
 *      public/legacy/js/bridge/ - LegacyScripts runs these before the prototype;
 *   2. lists them first in src/legacy/manifest.ts;
 *   3. applies DATA_HOOKS: minimal edits that make a prototype data declaration
 *      read live API data from `window.__mxData` first and keep its original
 *      demo literal as the fallback (signed out / API unavailable).
 *
 * Every hook is idempotent (skipped when already applied) and fails loudly when
 * the prototype text it targets no longer exists. tools/extract-legacy.mjs calls
 * `applyBridge` after re-extracting, so hooks survive a fresh extraction.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(root, 'packages', 'legacy-runtime', 'bridge', 'mx-core.js');
const BRIDGE_URL = '/legacy/js/bridge/';

/** `L(key, literalStart)` -> read window.__mxData[key] first, else the prototype literal. */
const live = (key) => `window.__mxData&&window.__mxData.${key}||`;
/** Published benchmark series for the chart range when it lines up with the portfolio series. */
const liveBench =
  '(window.__mxData&&window.__mxData.benchSets&&window.__mxData.benchSets[range]&&window.__mxData.benchSets[range].length===data.length?window.__mxData.benchSets[range]:data.map(([x,y])=>[x,y*.836]))';

export const DATA_HOOKS = {
  admin: {
    '01-inline.js': [
      ['const clients = [', `const clients = ${live('clients')}[`],
      ['const cashAccounts = [', `const cashAccounts = ${live('cashAccounts')}[`],
      ['let documents = [', `let documents = ${live('documents')}[`],
      // Role context comes from the signed-in user's real roles (GET /api/v1/admin/access-context).
      ["role: 'investment_director',", `role: ${live('role')}'investment_director',`],
      ['const roleLabels = {', `const roleLabels = ${live('roleLabels')}{`],
      ['const rolePermissions = {', `const rolePermissions = ${live('rolePermissions')}{`],
    ],
    '02-v7-institutional-enhancement-js.js': [
      ['let rbacUsersV8=[', `let rbacUsersV8=${live('rbacUsers')}[`],
      ['let accessPolicyV8={', `let accessPolicyV8=${live('accessPolicy')}{`],
      // Server-held RBAC and settings replace the prototype's browser copies.
      [
        "const r=JSON.parse(localStorage.getItem('matanho-rbac-v8')||'null');",
        "const r=window.mx&&window.mx.live?null:JSON.parse(localStorage.getItem('matanho-rbac-v8')||'null');",
      ],
      [
        "const st=JSON.parse(localStorage.getItem('matanho-settings-v8')||'null');",
        "const st=window.mx&&window.mx.live?null:JSON.parse(localStorage.getItem('matanho-settings-v8')||'null');",
      ],
    ],
    'v34-enhancements.js': [
      ['const serviceRelationships=[', `const serviceRelationships=${live('serviceRelationships')}[`],
      ['const serviceTasks=[', `const serviceTasks=${live('serviceTasks')}[`],
    ],
    '03-v10-branding-kyc-js.js': [
      // Profile edits are pushed to the API as well as the prototype's local store.
      ['function saveClientsV10(){try{', 'function saveClientsV10(){window.mx&&window.mx.saveClients&&window.mx.saveClients(clients);try{'],
    ],
    'v35-enhancements.js': [
      // Server-derived gates/state override the values the prototype computes locally.
      ['digital:true,applicant:a.applicant||{}}})}', 'digital:true,applicant:a.applicant||{},...(a.v35||{})}})}'],
      // With live data the queue shows real cases only (seed cases are demo content).
      [
        'kycCases35=[...dynamic,...seedCases35.filter(x=>!seen.has(x.id))]',
        'kycCases35=[...dynamic,...(window.mx&&window.mx.live?[]:seedCases35.filter(x=>!seen.has(x.id)))]',
      ],
      // Evidence preview streams the encrypted original from the API.
      [
        'stored=await getEvidenceBlob35(e.docKey)',
        'stored=(window.mx&&window.mx.fetchEvidence?await window.mx.fetchEvidence(c,e):null)||await getEvidenceBlob35(e.docKey)',
      ],
    ],
  },
  onboarding: {},
};

const PORTAL_DIRS = {
  admin: 'portals/admin-web',
  onboarding: 'portals/onboarding-web',
};

/**
 * Portals whose prototype runs without the bridge: the V65 pages (onboarding, custodian) show
 * their own demo data until their bridges are rewritten for the new markup. The old bridge sources
 * stay in src/legacy/bridge for reference.
 */
const DISABLED = new Set(['onboarding']);

function bridgeFiles(portalDir) {
  const dir = path.join(root, portalDir, 'src', 'legacy', 'bridge');
  const own = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];
  return [{ name: 'mx-core.js', src: CORE }, ...own.map((name) => ({ name, src: path.join(dir, name) }))];
}

function patchText(file, text, hooks) {
  let out = text.replace(/\r\n/g, '\n');
  let changed = false;
  for (const [from, to] of hooks) {
    if (out.includes(to)) continue;
    if (!out.includes(from)) throw new Error(`Bridge hook for ${file} no longer matches: ${from.slice(0, 80)}`);
    out = out.replace(from, () => to);
    changed = true;
  }
  return { out, changed };
}

function updateManifest(manifestPath, urls) {
  const src = readFileSync(manifestPath, 'utf8');
  const m = /("scripts":\s*\[)([\s\S]*?)(\])/.exec(src);
  if (!m) throw new Error(`No scripts array in ${manifestPath}`);
  const existing = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((u) => !u.startsWith(BRIDGE_URL));
  const next = [...urls, ...existing];
  const body = '\n' + next.map((u) => `    ${JSON.stringify(u)}`).join(',\n') + '\n  ';
  const out = src.slice(0, m.index) + m[1] + body + m[3] + src.slice(m.index + m[0].length);
  return { out, changed: out !== src };
}

/** Installs the bridge into one portal. Returns the list of files that changed. */
export function applyBridge(portal, { check = false } = {}) {
  const portalDir = PORTAL_DIRS[portal];
  if (!portalDir) throw new Error(`Unknown legacy portal ${portal}`);
  const pub = path.join(root, portalDir, 'public', 'legacy', 'js');
  const manifestPath = path.join(root, portalDir, 'src', 'legacy', 'manifest.ts');
  const changed = [];

  if (DISABLED.has(portal)) {
    if (existsSync(path.join(pub, 'bridge'))) {
      changed.push(path.relative(root, path.join(pub, 'bridge')));
      if (!check) rmSync(path.join(pub, 'bridge'), { recursive: true, force: true });
    }
    const { out, changed: mc } = updateManifest(manifestPath, []);
    if (mc) {
      changed.push(path.relative(root, manifestPath));
      if (!check) writeFileSync(manifestPath, out);
    }
    return changed;
  }

  mkdirSync(path.join(pub, 'bridge'), { recursive: true });
  const files = bridgeFiles(portalDir);
  for (const f of files) {
    const dest = path.join(pub, 'bridge', f.name);
    const same = existsSync(dest) && readFileSync(dest).equals(readFileSync(f.src));
    if (!same) {
      changed.push(path.relative(root, dest));
      if (!check) copyFileSync(f.src, dest);
    }
  }

  for (const [file, hooks] of Object.entries(DATA_HOOKS[portal] ?? {})) {
    const target = path.join(pub, file);
    const { out, changed: c } = patchText(file, readFileSync(target, 'utf8'), hooks);
    if (c) {
      changed.push(path.relative(root, target));
      if (!check) writeFileSync(target, out);
    }
  }

  const { out, changed: mc } = updateManifest(manifestPath, files.map((f) => BRIDGE_URL + f.name));
  if (mc) {
    changed.push(path.relative(root, manifestPath));
    if (!check) writeFileSync(manifestPath, out);
  }
  return changed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  let dirty = false;
  for (const portal of Object.keys(PORTAL_DIRS)) {
    if (only && only !== portal) continue;
    const changed = applyBridge(portal, { check });
    dirty ||= changed.length > 0;
    console.log(`${portal}: ${changed.length ? (check ? 'out of date: ' : 'updated: ') + changed.join(', ') : 'up to date'}`);
  }
  if (check && dirty) process.exit(1);
}
