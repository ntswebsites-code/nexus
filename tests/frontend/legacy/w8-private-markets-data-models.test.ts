import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W8 private markets, data, model governance bridges', () => {
  it('bridge files reference the expected API paths', () => {
    const pm = readFileSync(path.join(bridgeDir, 'admin-83-private-markets.js'), 'utf8');
    expect(pm).toMatch(/\/api\/v1\/private-markets/);
    expect(pm).toMatch(/\/summary/);
    expect(pm).toMatch(/\+ '\/marks/);
    expect(pm).toMatch(/\+ '\/approve'/);
    expect(pm).toMatch(/\/pipeline/);
    expect(pm).toMatch(/\/lookthrough\/export/);
    expect(pm).toMatch(/\/scenarios/);

    const data = readFileSync(path.join(bridgeDir, 'admin-84-data.js'), 'utf8');
    expect(data).toMatch(/\/api\/v1\/data/);
    expect(data).toMatch(/\+ '\/sources'/);
    expect(data).toMatch(/\+ '\/datasets'/);
    expect(data).toMatch(/\+ '\/run'/);
    expect(data).toMatch(/\+ '\/acknowledge'/);
    expect(data).toMatch(/mx\.renderData/);

    const mg = readFileSync(path.join(bridgeDir, 'admin-85-model-governance.js'), 'utf8');
    expect(mg).toMatch(/\/api\/v1\/model-governance/);
    expect(mg).toMatch(/\/models/);
    expect(mg).toMatch(/\/summary/);
    expect(mg).toMatch(/\+ '\/approve'/);
    expect(mg).toMatch(/\+ '\/submit'/);
  });

  it('w8 DATA_HOOKS patch prototype scripts', () => {
    expect(existsSync(path.join(repoRoot, 'tools/hooks/w8.mjs'))).toBe(true);

    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/06-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\._privateAssets15/);

    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._connections33/);
    expect(v33).toMatch(/__mxData\._models33/);
    expect(v33).toMatch(/mx\.renderData/);

    const v37 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v37-enhancements.js'), 'utf8');
    expect(v37).toMatch(/__mxData\._models37/);
    expect(v37).toMatch(/mx\.strict\('model-governance'\)/);
  });
});
