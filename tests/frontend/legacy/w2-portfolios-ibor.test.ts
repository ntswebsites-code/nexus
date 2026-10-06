import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W2 portfolios, ibor, portfolio-lab bridges', () => {
  it('bridge files exist and reference live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-80-portfolios.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-81-ibor.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-82-portfolio-lab.js'))).toBe(true);
    const pf = readFileSync(path.join(bridgeDir, 'admin-80-portfolios.js'), 'utf8');
    const ibor = readFileSync(path.join(bridgeDir, 'admin-81-ibor.js'), 'utf8');
    const lab = readFileSync(path.join(bridgeDir, 'admin-82-portfolio-lab.js'), 'utf8');
    expect(pf).toMatch(/\/portfolios/);
    expect(pf).toMatch(/latestTwrPct/);
    expect(pf).toMatch(/\/views/);
    expect(pf).toMatch(/create-portfolio/);
    expect(pf).toMatch(/clearPortfolioChrome/);
    expect(pf).toMatch(/evidenceKind/);
    expect(ibor).toMatch(/\/ibor\/overview/);
    expect(ibor).toMatch(/\/ibor\/ledger/);
    expect(ibor).toMatch(/\/ibor\/refresh/);
    expect(ibor).toMatch(/\/ibor\/reconcile/);
    expect(ibor).toMatch(/\/ibor\/events/);
    expect(ibor).toMatch(/\/ibor\/lots/);
    expect(ibor).toMatch(/clearIborChrome/);
    expect(ibor).toMatch(/applyIborColumnVisibility/);
    expect(ibor).toMatch(/wrapRenderIborColumns/);
    expect(lab).toMatch(/\/portfolio-lab\/whatif/);
    expect(lab).toMatch(/\/portfolio-lab\/rebalances/);
    expect(lab).toMatch(/v33Optimise/);
    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-80-portfolios/);
    expect(manifest).toMatch(/admin-81-ibor/);
    expect(manifest).toMatch(/admin-82-portfolio-lab/);
  });

  it('w2 DATA_HOOKS patch applied to 01-inline.js', () => {
    const js = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');
    expect(js).toMatch(/__mxData\.portfolios/);
    expect(js).toMatch(/__mxData\.institutionalPositions/);
  });
});
