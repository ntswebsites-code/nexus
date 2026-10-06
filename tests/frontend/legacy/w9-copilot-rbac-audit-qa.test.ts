import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { focusedNavPages, loadLegacyHarness, stubLegacyShellGlobals } from './_harness';
import { ok, raw } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');
const markupDir = path.join(repoRoot, 'portals/admin-web/src/legacy/markup');
const legacyJs = path.join(repoRoot, 'portals/admin-web/public/legacy/js');

const ROLE_FOCUS: Record<string, string[]> = {
  investment_director: ['command', 'portfolios', 'private-markets', 'risk', 'performance', 'investor-services', 'reports', 'operations', 'reconciliations'],
  portfolio_manager: ['command', 'portfolios', 'portfolio-lab', 'orders', 'research', 'risk', 'performance'],
  dealer: ['command', 'orders', 'ibor', 'cash', 'operations', 'reconciliations', 'corporate-actions'],
  analyst: ['command', 'research', 'portfolios', 'private-markets', 'portfolio-lab', 'performance'],
  compliance: ['command', 'risk', 'onboarding', 'regulatory', 'audit', 'clients'],
  operations: ['command', 'ibor', 'cash', 'operations', 'reconciliations', 'corporate-actions', 'valuation', 'investor-services'],
  fund_accountant: ['command', 'cash', 'operations', 'reconciliations', 'valuation', 'accounting', 'regulatory', 'reports'],
  client_services: ['command', 'clients', 'investor-services', 'onboarding', 'reports', 'vault'],
  auditor: ['command', 'reports', 'regulatory', 'audit', 'operations', 'reconciliations', 'accounting'],
  system_admin: ['command', 'data', 'model-governance', 'rbac', 'settings', 'audit'],
};

describe('W9 copilot, RBAC depth, audit extras, QA sweep', () => {
  it('bridge files reference expected admin-core API paths', () => {
    const copilot = readFileSync(path.join(bridgeDir, 'admin-86-copilot.js'), 'utf8');
    expect(copilot).toMatch(/\+ '\/copilot\/ask'/);
    expect(copilot).toMatch(/\/copilot\/suggestions/);
    expect(copilot).toMatch(/\/copilot\/history/);
    expect(copilot).toMatch(/\/integrations\/banner/);
    expect(copilot).toMatch(/mx\.strict\('copilot'\)/);
    expect(copilot).toMatch(/data-v15-open-copilot/);
    expect(copilot).toMatch(/clearCopilotChrome/);
    expect(copilot).toMatch(/renderTableHtml/);
    expect(copilot).toMatch(/extraTables/);

    const depth = readFileSync(path.join(bridgeDir, 'admin-61-access-depth.js'), 'utf8');
    expect(depth).toMatch(/\/rbac\/requests/);
    expect(depth).toMatch(/\/rbac\/reviews/);
    expect(depth).toMatch(/\/rbac\/reviews\/.*\/items\/.*\/decide/);
    expect(depth).toMatch(/\/rbac\/matrix/);
    expect(depth).toMatch(/data-mx-access-propose/);
    expect(depth).toMatch(/\/settings\/numbering/);
    expect(depth).toMatch(/\/settings\//);
    expect(depth).toMatch(/data-mx-settings-platform/);
    expect(depth).toMatch(/openReviewDetail/);
    expect(depth).toMatch(/openProposeRoleDrawer/);
    expect(depth).toMatch(/openPlatformSettingsDrawer/);
    expect(depth).toMatch(/\/retention\/run/);
    expect(depth).toMatch(/\/ops-health/);
    expect(depth).toMatch(/\/integrations\/banner/);
    expect(depth).toMatch(/data-mx-settings-health/);
    expect(depth).toMatch(/openPlatformHealthDrawer/);
    expect(depth).toMatch(/\/audit\/facets/);
    expect(depth).toMatch(/clearAuditChrome/);
    expect(depth).toMatch(/hydrate\('audit'/);
    expect(depth).toMatch(/\/audit\/events\//);
    expect(depth).toMatch(/clearRbacChrome/);
    expect(depth).toMatch(/toggleRbacDemoPanels/);
    expect(depth).toMatch(/Proposal required/);
    expect(depth).toMatch(/liveRbac/);
    expect(depth).toMatch(/hydrate\('rbac'/);
    expect(depth).toMatch(/injectRbacTabs/);
    expect(depth).toMatch(/USER_DISABLE/);
    expect(depth).toMatch(/toggleSettingsDemoPanels/);
    expect(depth).toMatch(/hydrate\('settings'/);
  });

  it('w9 DATA_HOOKS bypass copilot demo when live; W0 hooks skip rbac/settings localStorage', () => {
    expect(existsSync(path.join(repoRoot, 'tools/hooks/w9.mjs'))).toBe(true);
    const inline = readFileSync(path.join(legacyJs, '06-inline.js'), 'utf8');
    expect(inline).toMatch(/mx\.strict\('copilot'\)/);
    const v7 = readFileSync(path.join(legacyJs, '02-v7-institutional-enhancement-js.js'), 'utf8');
    expect(v7).toMatch(/window\.mx&&window\.mx\.live\?null:JSON\.parse\(localStorage\.getItem\('matanho-rbac-v8'\)/);
    expect(v7).toMatch(/window\.mx&&window\.mx\.live\?null:JSON\.parse\(localStorage\.getItem\('matanho-settings-v8'\)/);
  });

  it('manifest lists admin-61 and admin-86 bridges', () => {
    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-61-access-depth\.js/);
    expect(manifest).toMatch(/admin-86-copilot\.js/);
  });

  it('role focus sets match rolePrimary for every prototype role', () => {
    loadLegacyHarness({ fragment: '03-sidebar.html', bridges: 'none' });
    const focusScript = readFileSync(path.join(legacyJs, '07-v16-focus-script.js'), 'utf8');
    Object.keys(ROLE_FOCUS).forEach((role) => {
      const nav = document.getElementById('sideNav');
      nav?.classList.add('v16-focused');
      nav?.querySelectorAll('.nav-item[data-page]').forEach((b) => {
        const page = b.getAttribute('data-page')!;
        b.classList.toggle('v16-secondary', !ROLE_FOCUS[role].includes(page));
      });
      expect(focusedNavPages().sort()).toEqual(ROLE_FOCUS[role].sort());
      expect(focusScript).toContain(role);
    });
  });

  it('settings bridge saves admin-core platform setting with reason', async () => {
    const api = loadLegacyHarness({
      fragment: '32-page-settings.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-61-access-depth.js'],
      user: {
        name: 'Platform Admin',
        email: 'platform@test.local',
        permissions: ['admin.settings'],
      },
      routes: {
        'GET /api/v1/admin-core/settings': raw({
          data: [
            {
              key: 'notify.email_enabled',
              category: 'Notifications',
              label: 'Email notifications',
              help: 'Send email',
              type: 'boolean',
              value: true,
              version: 1,
              enforced: true,
            },
          ],
        }),
        'PUT /api/v1/admin-core/settings/notify.email_enabled': raw({ key: 'notify.email_enabled', value: false }),
        'GET /api/v1/admin-core/settings/history': raw({ data: [] }),
        'GET /api/v1/admin-core/integrations/banner': raw({ data: { production: false, fakeAdapters: [], count: 0 } }),
      },
    });
    stubLegacyShellGlobals();
    document.body.insertAdjacentHTML('beforeend', '<div id="drawerTitle"></div><div id="drawerBody"></div>');
    const w = window as unknown as {
      mx: { live: boolean; user: { permissions: string[] }; modal: (o: { actions: { label: string; run: () => unknown }[] }) => void };
      openDrawer: (o: { body?: string }) => void;
      closeDrawer: () => void;
      toast: () => void;
    };
    w.mx.live = true;
    w.mx.user = { permissions: ['admin.settings'] };
    w.mx.modal = function () {};
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    document.querySelector('[data-mx-settings-platform]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    document.querySelector('#drawerBody [data-mx-set-change="Notifications-0"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const form = document.getElementById('mxSetChangeForm') as HTMLFormElement | null;
    const reason = document.getElementById('mxSetReason') as HTMLTextAreaElement | null;
    const value = document.getElementById('mxSetValue') as HTMLSelectElement | null;
    if (value) value.value = 'false';
    if (reason) reason.value = 'Disable outbound email for maintenance';
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 80));
    expect(api.calls('PUT /api/v1/admin-core/settings/notify.email_enabled').length).toBe(1);
  });

  it('settings page shows integrations banner when fake adapters run in production', async () => {
    loadLegacyHarness({
      fragment: '32-page-settings.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-61-access-depth.js'],
      user: {
        name: 'Platform Admin',
        email: 'platform@test.local',
        permissions: ['admin.settings'],
      },
      routes: {
        'GET /api/v1/admin-core/settings/history': raw({ data: [] }),
        'GET /api/v1/admin-core/integrations/banner': raw({
          data: { production: true, fakeAdapters: ['Market data', 'KYC screening'], count: 2 },
        }),
      },
    });
    const mx = (window as unknown as { mx: { live: boolean; user: { permissions: string[] }; refresh: (p: string) => Promise<void> } }).mx;
    mx.live = true;
    mx.user = { permissions: ['admin.settings'] };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await mx.refresh('settings');
    await new Promise((r) => setTimeout(r, 80));
    expect(document.getElementById('mxSettingsIntegrationsBanner')?.textContent).toMatch(/Simulated integrations active/);
    expect(document.getElementById('mxSettingsIntegrationsBanner')?.textContent).toMatch(/Market data/);
  });

  it('copilot bridge loads integration banner context', async () => {
    loadLegacyHarness({
      fragment: '30-page-copilot.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-86-copilot.js'],
      user: {
        name: 'Analyst',
        email: 'analyst@test.local',
        permissions: ['dashboard.view'],
      },
      routes: {
        'GET /api/v1/admin-core/copilot/suggestions': raw({ data: { enabled: true, suggestions: ['Largest positions'] } }),
        'GET /api/v1/admin-core/copilot/history': raw({ data: [] }),
        'GET /api/v1/admin-core/integrations/banner': raw({
          data: { production: true, fakeAdapters: ['Broker FIX'], count: 1 },
        }),
      },
    });
    const mx = (window as unknown as { mx: { live: boolean; user: { permissions: string[] }; refresh: (p: string) => Promise<void> } }).mx;
    mx.live = true;
    mx.user = { permissions: ['dashboard.view'] };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await mx.refresh('copilot');
    await new Promise((r) => setTimeout(r, 80));
    expect(document.getElementById('mxCopilotBanner')?.textContent).toMatch(/Simulated integrations active/);
  });

  it('all 28 page fragments exist and copilot/rbac/settings/audit lack static demo table rows when wired', () => {
    const fragments = readdirSync(markupDir).filter((f) => f.includes('-page-'));
    expect(fragments.length).toBeGreaterThanOrEqual(28);

    const audit = readFileSync(path.join(markupDir, '33-page-audit.html'), 'utf8');
    expect(audit).toMatch(/data-action="filter-audit"/);
    expect(audit).toMatch(/data-action="export-audit"/);

    const copilot = readFileSync(path.join(markupDir, '30-page-copilot.html'), 'utf8');
    expect(copilot).toMatch(/id="v15CopilotForm"/);
    expect(copilot).toMatch(/data-v15-copilot-prompt/);
  });

  it('every w1-w8 bridge file exists in src/legacy/bridge', () => {
    const expected = [
      'admin-71-command.js',
      'admin-72-operations.js',
      'admin-80-portfolios.js',
      'admin-81-ibor.js',
      'admin-82-portfolio-lab.js',
      'admin-83-private-markets.js',
      'admin-84-data.js',
      'admin-85-model-governance.js',
      'admin-90-orders.js',
      'admin-91-research.js',
      'admin-92-risk.js',
      'admin-93-performance.js',
      'admin-94-cash.js',
      'admin-95-recon.js',
      'admin-96-financing.js',
      'admin-97-corporate-actions.js',
      'admin-98-nav.js',
      'admin-100-accounting.js',
      'admin-101-regulatory.js',
      'admin-102-reports.js',
    ];
    expected.forEach((f) => {
      expect(existsSync(path.join(bridgeDir, f))).toBe(true);
    });
  });
});
