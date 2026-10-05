import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W1 command, operations, shell bridges', () => {
  it('bridge files exist and reference live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-70-shell.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-71-command.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-72-operations.js'))).toBe(true);
    const shell = readFileSync(path.join(bridgeDir, 'admin-70-shell.js'), 'utf8');
    const command = readFileSync(path.join(bridgeDir, 'admin-71-command.js'), 'utf8');
    const ops = readFileSync(path.join(bridgeDir, 'admin-72-operations.js'), 'utf8');
    expect(shell).toMatch(/\/shell\/search/);
    expect(shell).toMatch(/\/notifications/);
    expect(shell).toMatch(/role-focus/);
    expect(command).toMatch(/\/dashboard\/today/);
    expect(command).toMatch(/generate-investment-pack/);
    expect(command).toMatch(/\/reports\/runs/);
    expect(ops).toMatch(/\/operations\/status/);
    expect(ops).toMatch(/\/operations\/tasks/);
    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-72-operations/);
  });

  it('w1 DATA_HOOKS patch applied to v33-rebuild.js', () => {
    const js = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(js).toMatch(/__mxData\.opsTasks/);
  });
});
