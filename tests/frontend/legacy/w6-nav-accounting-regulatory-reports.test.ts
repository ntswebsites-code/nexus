import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W6 NAV, accounting, regulatory, reports bridges', () => {
  it('bridge files exist and reference live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-98-nav.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-100-accounting.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-101-regulatory.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-102-reports.js'))).toBe(true);

    const nav = readFileSync(path.join(bridgeDir, 'admin-98-nav.js'), 'utf8');
    expect(nav).toMatch(/\/api\/v1\/nav\/runs/);
    expect(nav).toMatch(/maker-review/);
    expect(nav).toMatch(/\/release/);

    const acct = readFileSync(path.join(bridgeDir, 'admin-100-accounting.js'), 'utf8');
    expect(acct).toMatch(/\/api\/v1\/accounting\/journals/);
    expect(acct).toMatch(/\/api\/v1\/accounting\/periods/);
    expect(acct).toMatch(/\/api\/v1\/reports\/runs/);

    const reg = readFileSync(path.join(bridgeDir, 'admin-101-regulatory.js'), 'utf8');
    expect(reg).toMatch(/\/api\/v1\/regulatory\/calendar/);
    expect(reg).toMatch(/\/api\/v1\/regulatory\/filings/);

    const reports = readFileSync(path.join(bridgeDir, 'admin-102-reports.js'), 'utf8');
    expect(reports).toMatch(/\/api\/v1\/reports\/runs/);
    expect(reports).toMatch(/\/api\/v1\/reports\/catalogue/);
    expect(reports).toMatch(/previewReport/);

    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-98-nav/);
    expect(manifest).toMatch(/admin-100-accounting/);
    expect(manifest).toMatch(/admin-101-regulatory/);
    expect(manifest).toMatch(/admin-102-reports/);
  });

  it('w6 DATA_HOOKS patch NAV, regulatory and report scripts', () => {
    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._reportRows33/);
    expect(v33).toMatch(/__mxData\._obligations33/);

    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\._reportsInline/);

    const v34 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v34-enhancements.js'), 'utf8');
    expect(v34).toMatch(/__mxData\._reportData34/);

    const v49 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v49-enhancements.js'), 'utf8');
    expect(v49).toMatch(/__mxData\._navState49/);
  });
});
