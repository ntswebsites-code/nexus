import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W4 research, risk, performance bridges', () => {
  it('bridge files exist and reference live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-91-research.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-92-risk.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-93-performance.js'))).toBe(true);

    const research = readFileSync(path.join(bridgeDir, 'admin-91-research.js'), 'utf8');
    expect(research).toMatch(/\/api\/v1\/research\/cases/);
    expect(research).toMatch(/\/valuation/);
    expect(research).toMatch(/\/entries/);

    const risk = readFileSync(path.join(bridgeDir, 'admin-92-risk.js'), 'utf8');
    expect(risk).toMatch(/\/api\/v1\/risk\/limits/);
    expect(risk).toMatch(/scenarios\/preview/);
    expect(risk).toMatch(/compliance-report/);

    const perf = readFileSync(path.join(bridgeDir, 'admin-93-performance.js'), 'utf8');
    expect(perf).toMatch(/\/api\/v1\/performance\/summary/);
    expect(perf).toMatch(/attribution\/export/);
    expect(perf).toMatch(/\/periods/);

    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-91-research/);
    expect(manifest).toMatch(/admin-92-risk/);
    expect(manifest).toMatch(/admin-93-performance/);
  });

  it('w4 DATA_HOOKS patch applied to research, risk and performance scripts', () => {
    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\._research/);

    const v7 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/02-v7-institutional-enhancement-js.js'), 'utf8');
    expect(v7).toMatch(/__mxData\._equityResearch/);
    expect(v7).toMatch(/__mxData\._researchNotes/);

    const v37 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v37-enhancements.js'), 'utf8');
    expect(v37).toMatch(/__mxData\._riskLimits37/);

    const v8 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/08-inline.js'), 'utf8');
    expect(v8).toMatch(/__mxData\._v17PerfRows/);
  });
});
