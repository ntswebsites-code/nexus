/* DEP-002: served legacy assets vs frozen manifest source (hash comparison). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3100';

const assets = [
  '/legacy/js/v33-rebuild.js',
  '/legacy/js/v56-enhancements.js',
  '/legacy/css/v33-rebuild.css',
  '/legacy/js/bridge/admin-95-recon.js',
  '/legacy/js/bridge/admin-84-data.js',
  '/legacy/js/mx-core.js',
];

async function main() {
  for (const a of assets) {
    const res = await fetch(BASE + a);
    const buf = Buffer.from(await res.arrayBuffer());
    const served = createHash('sha256').update(buf).digest('hex');
    const local = path.join('portals/admin-web/public', a);
    let localHash = 'missing';
    try { localHash = createHash('sha256').update(readFileSync(local)).digest('hex'); } catch { /* missing */ }
    console.log(`${a} -> HTTP ${res.status} ${buf.length}B served=${served.slice(0, 12)} local=${localHash.slice(0, 12)} match=${served === localHash}`);
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
