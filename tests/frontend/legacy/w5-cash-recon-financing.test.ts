import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W5 cash, recon, financing, corporate-actions bridges', () => {
  it('bridge files exist and reference live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-94-cash.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-95-recon.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-96-financing.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-97-corporate-actions.js'))).toBe(true);

    const cash = readFileSync(path.join(bridgeDir, 'admin-94-cash.js'), 'utf8');
    expect(cash).toMatch(/\/api\/v1\/cash\/balances/);
    expect(cash).toMatch(/\/api\/v1\/cash\/journals/);
    expect(cash).toMatch(/statement-imports/);

    const recon = readFileSync(path.join(bridgeDir, 'admin-95-recon.js'), 'utf8');
    expect(recon).toMatch(/\/api\/v1\/recon\/breaks/);
    expect(recon).toMatch(/\/api\/v1\/recon\/runs/);
    expect(recon).toMatch(/\/api\/v1\/recon\/signoffs/);

    const fin = readFileSync(path.join(bridgeDir, 'admin-96-financing.js'), 'utf8');
    expect(fin).toMatch(/\/api\/v1\/financing\/facilities/);
    expect(fin).toMatch(/margin-calls/);

    const ca = readFileSync(path.join(bridgeDir, 'admin-97-corporate-actions.js'), 'utf8');
    expect(ca).toMatch(/\/api\/v1\/corporate-actions\/events/);
    expect(ca).toMatch(/entitlements\/calculate/);

    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-94-cash/);
    expect(manifest).toMatch(/admin-95-recon/);
    expect(manifest).toMatch(/admin-96-financing/);
    expect(manifest).toMatch(/admin-97-corporate-actions/);
  });

  it('w5 DATA_HOOKS patch cash, recon, financing and corporate actions scripts', () => {
    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\.cashJournals/);
    expect(inline).toMatch(/__mxData\.cashReservations/);
    expect(inline).toMatch(/__mxData\.statementImports/);

    const v12 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/04-v12-user-focused-js.js'), 'utf8');
    expect(v12).toMatch(/matanho-recon-v12/);

    const v6 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/06-inline.js'), 'utf8');
    expect(v6).toMatch(/__mxData\._v15CorpActions/);

    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._reconBreaks33/);
    expect(v33).toMatch(/__mxData\._facilities33/);

    const v52 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v52-enhancements.js'), 'utf8');
    expect(v52).toMatch(/__mxData\._fin52/);
  });
});
