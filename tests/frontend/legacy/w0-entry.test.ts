import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectNoOpsConsoleLink, focusedNavPages, loadLegacyHarness } from './_harness';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('W0 legacy entry tripwires', () => {
  it('sidebar has 28 workspace pages and no Operations Console link', () => {
    loadLegacyHarness({ fragment: '03-sidebar.html', bridges: 'none' });
    const pages = [...document.querySelectorAll('.nav-item[data-page]')].map((el) => el.getAttribute('data-page'));
    expect(pages).toHaveLength(28);
    expectNoOpsConsoleLink();
    expect(document.body.innerHTML).not.toMatch(/Open the new workspace/i);
  });

  it('system_admin focus set matches rolePrimary', () => {
    loadLegacyHarness({ fragment: '03-sidebar.html', bridges: 'none' });
    const nav = document.getElementById('sideNav');
    const primary = ['command', 'data', 'model-governance', 'rbac', 'settings', 'audit'];
    nav?.classList.add('v16-focused');
    nav?.querySelectorAll('.nav-item[data-page]').forEach((b) => {
      b.classList.toggle('v16-secondary', !primary.includes(b.getAttribute('data-page')!));
    });
    expect(focusedNavPages().sort()).toEqual(primary.sort());
  });

  it('admin-00-common exposes streamDownload and reasonModal helpers', () => {
    const js = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/bridge/admin-00-common.js'), 'utf8');
    expect(js).toMatch(/mx\.streamDownload/);
    expect(js).toMatch(/mx\.reasonModal/);
  });

  it('mx-core exposes hydrate, gate, strict and list helpers', () => {
    loadLegacyHarness({ fragment: '03-sidebar.html', bridges: ['mx-core.js'] });
    const mx = (window as unknown as { mx: Record<string, unknown> }).mx;
    expect(typeof mx.hydrate).toBe('function');
    expect(typeof mx.gate).toBe('function');
    expect(typeof mx.strict).toBe('function');
    expect(typeof mx.list).toBe('function');
    expect(typeof mx.uuid).toBe('function');
  });

  it('next.config serves prototype at / and redirects /ops to /ops-native', () => {
    const cfg = readFileSync(path.join(repoRoot, 'portals/admin-web/next.config.ts'), 'utf8');
    expect(cfg).not.toMatch(/destination:\s*'\/ops',/);
    expect(cfg).toMatch(/\/classic.*destination:\s*'\//);
    expect(cfg).toMatch(/\/ops\/:path\*.*\/ops-native\/:path\*/);
  });

  it('admin-01-retired.js is removed from bridge sources', () => {
    const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');
    const boot = readFileSync(path.join(bridgeDir, 'admin-99-boot.js'), 'utf8');
    expect(boot).not.toMatch(/mxOpsLink/);
    expect(existsSync(path.join(bridgeDir, 'admin-01-retired.js'))).toBe(false);
  });

  it('shell bridge hydrates topbar profile from signed-in user', async () => {
    const { bootLegacyShell } = await import('./_harness');
    const { ok, raw } = await import('../_helpers/mockApi');
    await bootLegacyShell({
      user: { name: 'Ada Admin', email: 'ada@test.local', permissions: ['dashboard.view', 'operations.view'] },
      routes: {
        'GET /api/v1/shell/me/role-focus': raw({ roles: [{ key: 'system_admin', label: 'System Administrator' }], role: null }),
        'GET /api/v1/dashboard/today': ok({
          asOf: new Date().toISOString(),
          approvals: { total: 2, items: [] },
          ordersWorking: { total: 1, awaitingApproval: 1 },
        }),
        'GET /api/v1/operations/status': ok({ asOf: new Date().toISOString(), kpis: { serviceHealth: 'ok' } }),
        'GET /api/v1/notifications': raw({ items: [], unread: 0 }),
      },
    });
    expect(document.querySelector('.profile-copy strong')?.textContent).toBe('Ada Admin');
    expect(document.querySelector('.profile-button .avatar')?.textContent).toBe('AA');
    expect(document.body.textContent).not.toMatch(/Tendai Moyo/);
  });
});
