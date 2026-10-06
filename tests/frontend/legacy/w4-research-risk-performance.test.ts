import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegacyHarness } from './_harness';
import { ok } from '../_helpers/mockApi';

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
    expect(research).toMatch(/\/decisions/);
    expect(research).toMatch(/\/ratify/);
    expect(research).toMatch(/openIcQueueDrawer/);
    expect(research).toMatch(/clearResearchChrome/);
    expect(research).toMatch(/openFilingImportModal/);
    expect(research).toMatch(/\/issuers\/.*\/filings/);

    const risk = readFileSync(path.join(bridgeDir, 'admin-92-risk.js'), 'utf8');
    expect(risk).toMatch(/\/api\/v1\/risk\/limits/);
    expect(risk).toMatch(/\/submit/);
    expect(risk).toMatch(/runLimitAction/);
    expect(risk).toMatch(/clearRiskChrome/);
    expect(risk).toMatch(/toggleRiskDemoPanels/);
    expect(risk).toMatch(/\/api\/v1\/risk\/cases/);
    expect(risk).toMatch(/scenarios\/preview/);
    expect(risk).toMatch(/compliance-report/);
    expect(risk).toMatch(/streamDownload/);

    const perf = readFileSync(path.join(bridgeDir, 'admin-93-performance.js'), 'utf8');
    expect(perf).toMatch(/\/api\/v1\/performance\/summary/);
    expect(perf).toMatch(/attribution\/export/);
    expect(perf).toMatch(/streamDownload/);
    expect(perf).toMatch(/\/periods/);
    expect(perf).toMatch(/\/lock/);
    expect(perf).toMatch(/handleOfficialReturnAction/);
    expect(perf).toMatch(/clearPerformanceChrome/);
    expect(perf).toMatch(/openMethodologyModal/);
    expect(perf).toMatch(/togglePerformanceDemoPanels/);
    expect(perf).toMatch(/openCorrectionModal/);
    expect(perf).toMatch(/\/correct/);
    expect(perf).toMatch(/\/recompute/);
    expect(perf).toMatch(/computeExcessRisk/);
    expect(perf).toMatch(/trackingErrorPct/);
    expect(perf).not.toMatch(/\* 83\.6/);

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

  it('research bridge posts IC votes when live', async () => {
    const api = loadLegacyHarness({
      fragment: 'none',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-91-research.js'],
      user: {
        id: 'u-voter',
        name: 'IC Member',
        email: 'ic@test.local',
        permissions: ['research.view', 'research.edit'],
      },
      routes: {
        'POST /api/v1/research/decisions/d1/vote': ok({ ref: 'ICD-1' }),
      },
    });
    const w = window as unknown as {
      mx: { live: boolean; user: { id: string; permissions: string[] }; data: Record<string, unknown> };
    };
    w.mx.live = true;
    w.mx.user = { id: 'u-voter', permissions: ['research.view', 'research.edit'] };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await (window as unknown as { mx: { post: (p: string, b: unknown) => Promise<unknown> } }).mx.post(
      '/api/v1/research/decisions/d1/vote',
      { vote: 'FOR' },
    );
    expect(api.calls('POST /api/v1/research/decisions/d1/vote').length).toBe(1);
  });

  it('risk bridge posts new case intake', async () => {
    const api = loadLegacyHarness({
      fragment: '12-page-risk.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-92-risk.js'],
      user: {
        id: 'u-risk',
        name: 'Risk Ops',
        email: 'risk@test.local',
        permissions: ['risk.view', 'risk.manage'],
      },
      routes: {
        'GET /api/v1/portfolios': ok([]),
        'GET /api/v1/risk/breaches': ok([]),
        'GET /api/v1/risk/cases': ok([]),
        'GET /api/v1/risk/portfolios/*/limits': ok({ evaluations: [] }),
        'GET /api/v1/risk/limits': ok([]),
        'POST /api/v1/risk/cases': ok({ ref: 'RC-1' }),
      },
    });
    const w = window as unknown as {
      mx: { live: boolean; user: { id: string; permissions: string[] }; modal: (o: { actions: { run: (m: HTMLElement) => unknown }[] }) => void };
    };
    w.mx.live = true;
    w.mx.user = { id: 'u-risk', permissions: ['risk.view', 'risk.manage'] };
    w.mx.modal = function (opts) {
      const shell = document.createElement('div');
      shell.innerHTML =
        '<form id="mxRiskCase"><input name="type" value="MANUAL"><textarea name="description">Manual review of issuer concentration</textarea><select name="severity"><option>MEDIUM</option></select></form>';
      document.body.appendChild(shell);
      void opts.actions.find((a) => a.label === 'Create case')?.run(shell);
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    document.querySelector('[data-risk-new-case="true"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('POST /api/v1/risk/cases').length).toBe(1);
  });

  it('performance bridge recomputes stale draft before lock', async () => {
    const api = loadLegacyHarness({
      fragment: '13-page-performance.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-93-performance.js'],
      user: {
        id: 'u-prep',
        name: 'PBOR Preparer',
        email: 'prep@test.local',
        permissions: ['reports.view', 'reports.create', 'performance.lock'],
      },
      routes: {
        'GET /api/v1/performance/summary': ok([{ portfolioId: 'p1', portfolioName: 'Fund A', periodStart: '2026-01-01', periodEnd: '2026-03-31' }]),
        'GET /api/v1/performance/returns': ok({ portfolioName: 'Fund A', twrPct: '1.2', benchmarkPct: '1.0', activePct: '0.2', controls: [], controlsPending: 0, series: [] }),
        'GET /api/v1/performance/attribution': ok({ totals: {}, segments: [] }),
        'GET /api/v1/performance/periods': ok([{ id: 'per-1', ref: 'PER-1', periodStart: '2026-01-01', periodEnd: '2026-03-31', twrPct: '1.2' }]),
        'GET /api/v1/performance/periods/per-1': ok({
          id: 'per-1',
          ref: 'PER-1',
          makerId: 'u-prep',
          periodStart: '2026-01-01',
          periodEnd: '2026-03-31',
          twrPct: '1.2',
          canLock: false,
          controlsPending: 0,
          stale: true,
        }),
        'POST /api/v1/performance/periods/per-1/recompute': ok({ ref: 'PER-1', stale: false }),
        'POST /api/v1/performance/periods/per-1/lock': ok({ ref: 'PER-1', status: 'LOCKED' }),
      },
    });
    const w = window as unknown as {
      mx: { live: boolean; user: { id: string; permissions: string[] }; refresh: (page: string) => Promise<void> };
    };
    w.mx.live = true;
    w.mx.user = { id: 'u-locker', permissions: ['reports.view', 'reports.create', 'performance.lock'] };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await w.mx.refresh('performance');
    document.querySelector('[data-action="lock-official-return"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    expect(api.calls('POST /api/v1/performance/periods/per-1/recompute').length).toBe(1);
  });

  it('performance bridge locks draft period when checker is ready', async () => {
    const api = loadLegacyHarness({
      fragment: '13-page-performance.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-93-performance.js'],
      user: {
        id: 'u-locker',
        name: 'PBOR Checker',
        email: 'pbor@test.local',
        permissions: ['reports.view', 'performance.lock'],
      },
      routes: {
        'GET /api/v1/performance/summary': ok([{ portfolioId: 'p1', portfolioName: 'Fund A', periodStart: '2026-01-01', periodEnd: '2026-03-31' }]),
        'GET /api/v1/performance/returns': ok({ portfolioName: 'Fund A', twrPct: '1.2', benchmarkPct: '1.0', activePct: '0.2', controls: [], controlsPending: 0 }),
        'GET /api/v1/performance/attribution': ok({ totals: {}, segments: [] }),
        'GET /api/v1/performance/periods': ok([{ id: 'per-1', ref: 'PER-1', periodStart: '2026-01-01', periodEnd: '2026-03-31', twrPct: '1.2' }]),
        'GET /api/v1/performance/periods/per-1': ok({
          id: 'per-1',
          ref: 'PER-1',
          makerId: 'u-maker',
          periodStart: '2026-01-01',
          periodEnd: '2026-03-31',
          twrPct: '1.2',
          canLock: true,
          controlsPending: 0,
          stale: false,
        }),
        'POST /api/v1/performance/periods/per-1/lock': ok({ ref: 'PER-1', status: 'LOCKED' }),
      },
    });
    const w = window as unknown as {
      mx: {
        live: boolean;
        user: { id: string; permissions: string[] };
        modal: (o: { actions: { label: string; run: (m: HTMLElement) => unknown }[] }) => void;
        post: (url: string, body: unknown, opts?: { stepUp?: boolean }) => Promise<unknown>;
        refresh: (page: string) => Promise<void>;
      };
    };
    w.mx.live = true;
    w.mx.user = { id: 'u-locker', permissions: ['reports.view', 'performance.lock'] };
    const origPost = w.mx.post.bind(w.mx);
    w.mx.post = function (url, body, opts) {
      return origPost(url, body, opts);
    };
    w.mx.modal = function (opts) {
      const shell = document.createElement('div');
      shell.innerHTML = '<form id="mxPerfLock"><input name="note" value="Certified"></form>';
      document.body.appendChild(shell);
      void opts.actions.find((a) => a.label === 'Lock official return')?.run(shell);
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await w.mx.refresh('performance');
    document.querySelector('[data-action="lock-official-return"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    expect(api.calls('GET /api/v1/performance/periods').length).toBeGreaterThan(0);
    expect(api.calls('POST /api/v1/performance/periods/per-1/lock').length).toBe(1);
  });
});
