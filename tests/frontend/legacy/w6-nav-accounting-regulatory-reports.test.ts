import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegacyHarness } from './_harness';
import { ok, raw } from '../_helpers/mockApi';

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
    expect(nav).toMatch(/clearNavKpis/);
    expect(nav).toMatch(/external-nav/);
    expect(nav).toMatch(/openNavInputsModal/);
    expect(nav).toMatch(/downloadNavPack/);
    expect(nav).toMatch(/\/inputs/);
    expect(nav).toMatch(/\/pack/);

    const acct = readFileSync(path.join(bridgeDir, 'admin-100-accounting.js'), 'utf8');
    expect(acct).toMatch(/\/api\/v1\/accounting\/journals/);
    expect(acct).toMatch(/\/api\/v1\/accounting\/periods/);
    expect(acct).toMatch(/trial-balance/);
    expect(acct).toMatch(/updateNavOversight/);
    expect(acct).toMatch(/clearAccountingChrome/);
    expect(acct).toMatch(/openNewJournalModal/);
    expect(acct).toMatch(/\/accounting\/journals/);
    expect(acct).toMatch(/\/nav\/history/);
    expect(acct).toMatch(/\/api\/v1\/reports\/runs/);
    expect(acct).toMatch(/openChartOfAccountsModal/);
    expect(acct).toMatch(/accounts\/default-chart/);
    expect(acct).toMatch(/accounting-chart/);
    expect(acct).toMatch(/mx\.reasonModal/);
    expect(acct).not.toMatch(/window\.prompt\('Return reason/);

    const reg = readFileSync(path.join(bridgeDir, 'admin-101-regulatory.js'), 'utf8');
    expect(reg).toMatch(/\/api\/v1\/regulatory\/calendar/);
    expect(reg).toMatch(/\/api\/v1\/regulatory\/filings/);
    expect(reg).toMatch(/\/evidence/);
    expect(reg).toMatch(/openCreateFilingModal/);
    expect(reg).toMatch(/\/export/);
    expect(reg).toMatch(/\/waive/);
    expect(reg).toMatch(/clearRegKpis/);
    expect(reg).toMatch(/mx\.reasonModal/);
    expect(reg).not.toMatch(/window\.prompt\('Reason for waiving/);
    expect(reg).toMatch(/regulatoryCounts/);

    const reports = readFileSync(path.join(bridgeDir, 'admin-102-reports.js'), 'utf8');
    expect(reports).toMatch(/\/api\/v1\/reports\/runs/);
    expect(reports).toMatch(/\/api\/v1\/reports\/catalogue/);
    expect(reports).toMatch(/\/reports\/schedules/);
    expect(reports).toMatch(/\/distribute/);
    expect(reports).toMatch(/openSchedulesModal/);
    expect(reports).toMatch(/clearReportsKpis/);
    expect(reports).toMatch(/patchReportsKpis/);
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

  it('reports bridge distributes a completed run with step-up', async () => {
    const api = loadLegacyHarness({
      fragment: '17-page-reports.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-102-reports.js'],
      user: {
        name: 'Reports Ops',
        email: 'reports@test.local',
        permissions: ['reports.view', 'reports.approve'],
      },
      routes: {
        'GET /api/v1/reports/runs': raw({
          data: [
            {
              id: 'run-1',
              ref: 'RPT-1',
              status: 'COMPLETED',
              report: 'FACT_SHEET',
              reportName: 'Fact sheet',
              createdAt: '2026-01-01T10:00:00Z',
            },
          ],
        }),
        'GET /api/v1/reports/catalogue': raw({ data: [{ key: 'FACT_SHEET', name: 'Fact sheet' }] }),
        'POST /api/v1/reports/runs/run-1/distribute': raw({ distributed: true }),
      },
    });
    const w = window as unknown as { mx: { live: boolean; user: { permissions: string[] } } };
    w.mx.live = true;
    w.mx.user = { permissions: ['reports.view', 'reports.approve'] };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await new Promise((r) => setTimeout(r, 80));
    const btn = document.createElement('button');
    btn.setAttribute('data-mx-report-distribute', 'RPT-1');
    btn.setAttribute('data-mx-api-id', 'run-1');
    document.body.appendChild(btn);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    expect(api.calls('POST /api/v1/reports/runs/run-1/distribute').length).toBe(1);
  });

  it('reports bridge creates a schedule from the schedules modal', async () => {
    const api = loadLegacyHarness({
      fragment: '17-page-reports.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-102-reports.js'],
      user: {
        name: 'Reports Ops',
        email: 'reports@test.local',
        permissions: ['reports.view', 'reports.create'],
      },
      routes: {
        'GET /api/v1/reports/runs': raw({ data: [] }),
        'GET /api/v1/reports/catalogue': raw({ data: [{ key: 'FACT_SHEET', name: 'Fact sheet' }] }),
        'GET /api/v1/reports/schedules': raw({ data: [] }),
        'GET /api/v1/portfolios': raw({ data: [{ id: 'p1' }] }),
        'POST /api/v1/reports/schedules': raw({ id: 'sch-1', name: 'Monthly facts' }),
      },
    });
    const w = window as unknown as {
      mx: {
        live: boolean;
        user: { permissions: string[] };
        modal: (o: { title?: string; body?: string; actions: { label: string; run: (m: HTMLElement) => unknown }[] }) => void;
      };
    };
    w.mx.live = true;
    w.mx.user = { permissions: ['reports.view', 'reports.create'] };
    w.mx.modal = function (opts) {
      const m = document.createElement('section');
      m.innerHTML = '<div class="v34-modal-body">' + (opts.body || '') + '</div>';
      document.body.appendChild(m);
      const create = opts.actions.find((a) => a.label === 'Create schedule');
      if (create) void create.run(m);
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    document.getElementById('v33ReportSchedule')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    document.getElementById('mxSchedCreate')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    expect(api.calls('POST /api/v1/reports/schedules').length).toBe(1);
  });

  it('regulatory bridge creates a filing from template modal', async () => {
    const api = loadLegacyHarness({
      fragment: '27-page-regulatory.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-101-regulatory.js'],
      user: {
        name: 'Compliance',
        email: 'compliance@test.local',
        permissions: ['reports.view', 'reports.create'],
      },
      routes: {
        'GET /api/v1/regulatory/calendar': raw({ data: [] }),
        'GET /api/v1/regulatory/templates': raw({ data: [{ key: 'AML', name: 'AML summary', regulator: 'FCA' }] }),
        'POST /api/v1/regulatory/filings': raw({ data: { ref: 'REG-99', id: 'f99' } }),
      },
    });
    const w = window as unknown as {
      mx: {
        live: boolean;
        user: { permissions: string[] };
        modal: (o: { actions: { label: string; run: (m: HTMLElement) => unknown }[] }) => void;
      };
    };
    w.mx.live = true;
    w.mx.user = { permissions: ['reports.view', 'reports.create'] };
    w.mx.modal = function (opts) {
      const m = document.createElement('section');
      m.innerHTML =
        '<div class="v34-modal-body"><form id="mxNewFiling"><select name="templateKey"><option value="AML">AML</option></select><input name="notes" value="Q1"></form></div>';
      document.body.appendChild(m);
      void opts.actions.find((a) => a.label === 'Create filing')?.run(m);
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    document.getElementById('v33NewObligation')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    expect(api.calls('POST /api/v1/regulatory/filings').length).toBe(1);
  });
});
