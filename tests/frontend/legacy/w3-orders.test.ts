import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W3 orders bridge', () => {
  it('bridge file exists and references live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-90-orders.js'))).toBe(true);
    const orders = readFileSync(path.join(bridgeDir, 'admin-90-orders.js'), 'utf8');
    expect(orders).toMatch(/\/api\/v1\/orders/);
    expect(orders).toMatch(/broker-instruction\/preview/);
    expect(orders).toMatch(/\/approve/);
    expect(orders).toMatch(/\/route/);
    expect(orders).toMatch(/\/fills/);
    expect(orders).toMatch(/export-orders/);
    expect(orders).toMatch(/v33SubmitOrder/);
    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-90-orders/);
  });

  it('w3 DATA_HOOKS patch applied to orders scripts', () => {
    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\._orders/);
    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._v33Orders/);
    const v56 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v56-enhancements.js'), 'utf8');
    expect(v56).toMatch(/mx\.strict\('orders'\)/);
  });
});
