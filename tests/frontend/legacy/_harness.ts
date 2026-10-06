/**
 * jsdom harness for legacy admin page bridge tests (W0+).
 * Loads markup fragments and optional bridge/prototype scripts with mocked fetch.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { mockApi, type MockApi, raw, ok } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const adminRoot = path.join(repoRoot, 'portals/admin-web');
const bridgePub = path.join(adminRoot, 'public/legacy/js/bridge');
const legacyJs = path.join(adminRoot, 'public/legacy/js');
const markupDir = path.join(adminRoot, 'src/legacy/markup');

export interface LegacyHarnessOptions {
  fragment?: string | 'none';
  bridges?: string[] | 'all' | 'none';
  scripts?: string[];
  routes?: Record<string, unknown>;
  user?: { permissions: string[]; name?: string; email?: string };
}

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Evaluate a legacy script in the jsdom global scope (same as ordered script tags). */
function runScript(code: string) {
  window.eval(code);
}

function bridgeFiles(opt: LegacyHarnessOptions['bridges']): string[] {
  if (opt === 'none') return [];
  if (opt === 'all') {
    return existsSync(bridgePub)
      ? readdirSync(bridgePub).filter((f) => f.endsWith('.js')).sort()
      : [];
  }
  return opt ?? ['mx-core.js', 'admin-00-common.js'];
}

export function loadLegacyHarness(opts: LegacyHarnessOptions = {}): MockApi {
  const fragment = opts.fragment ?? '03-sidebar.html';
  const user = opts.user ?? {
    name: 'Test Admin',
    email: 'admin@test.local',
    permissions: [
      'dashboard.view',
      'portfolio.view',
      'orders.view',
      'research.view',
      'risk.view',
      'reports.view',
      'clients.view',
      'onboarding.view',
      'cash.view',
      'documents.view',
      'operations.view',
      'valuation.view',
      'admin.rbac',
      'admin.settings',
      'audit.view',
    ],
  };

  const api = mockApi({
    'GET /api/auth/me': raw({ user }),
    'GET /api/v1/admin/access-context': ok({
      roles: ['system_admin'],
      role: 'system_admin',
      roleLabels: { system_admin: 'System Administrator' },
      rolePermissions: { system_admin: user.permissions },
    }),
    ...(opts.routes ?? {}),
  });

  (window as unknown as { __MATANHO_API__: string }).__MATANHO_API__ = 'http://localhost:4100';
  if (fragment !== 'none') {
    document.body.innerHTML = readText(path.join(markupDir, fragment));
  }

  for (const f of bridgeFiles(opts.bridges)) runScript(readText(path.join(bridgePub, f)));
  for (const f of opts.scripts ?? []) runScript(readText(path.join(legacyJs, f)));

  return api;
}

export function expectNoOpsConsoleLink(): void {
  expect(document.getElementById('mxOpsLink')).toBeNull();
  expect(document.body.textContent).not.toMatch(/Operations Console/i);
  document.querySelectorAll('a[href],button[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href) expect(href).not.toMatch(/^\/ops(\/|$)/);
  });
}

export function focusedNavPages(): string[] {
  const nav = document.getElementById('sideNav');
  if (!nav) return [];
  return [...nav.querySelectorAll('.nav-item[data-page]:not(.v16-secondary)')]
    .filter((el) => !el.classList.contains('hidden-by-rbac'))
    .map((el) => el.getAttribute('data-page')!)
    .filter(Boolean);
}

/** Minimal prototype globals for shell bridge tests. */
export function stubLegacyShellGlobals() {
  const w = window as unknown as Record<string, unknown>;
  w.state = { role: 'system_admin' };
  w.roleLabels = { system_admin: 'System Administrator' };
  w.navigate = (page: string) => {
    w.__lastNavigate = page;
  };
  w.openDrawer = (opts: { title?: string; body?: string }) => {
    w.__lastDrawer = opts;
    const body = document.getElementById('drawerBody');
    const title = document.getElementById('drawerTitle');
    if (title && opts.title) title.textContent = opts.title;
    if (body && opts.body) body.innerHTML = opts.body;
  };
  w.closeDrawer = () => {
    w.__lastDrawer = null;
  };
  w.v17CloseCommand = () => {
    const b = document.getElementById('v17CommandBackdrop');
    b?.classList.remove('show');
  };
  w.v17OpenCommand = () => {
    const b = document.getElementById('v17CommandBackdrop');
    const i = document.getElementById('v17CommandInput') as HTMLInputElement | null;
    b?.classList.add('show');
    if (i) i.value = '';
    if (typeof w.v17RenderCommands === 'function') (w.v17RenderCommands as (q?: string) => void)('');
  };
  w.v17RenderCommands = (q = '') => {
    const host = document.getElementById('v17CommandList');
    if (host) host.innerHTML = `<div class="v17-command-item">${q || 'static'}</div>`;
  };
}

/** Load shell fragments, run admin boot, dispatch legacy-ready. */
export async function bootLegacyShell(opts: LegacyHarnessOptions = {}): Promise<MockApi> {
  const drawer = readText(path.join(markupDir, '38-detaildrawer.html'));
  const topbar = readText(path.join(markupDir, '05-header-topbar.html'));
  const sidebar = readText(path.join(markupDir, '03-sidebar.html'));
  const user = opts.user ?? {
    name: 'Test Admin',
    email: 'admin@test.local',
    permissions: ['dashboard.view', 'operations.view', 'orders.view'],
  };
  const api = mockApi({
    'GET /api/auth/me': raw({ user }),
    'GET /api/v1/admin/access-context': ok({
      roles: ['system_admin'],
      role: 'system_admin',
      roleLabels: { system_admin: 'System Administrator' },
      rolePermissions: { system_admin: user.permissions },
    }),
    ...(opts.routes ?? {}),
  });
  (window as unknown as { __MATANHO_API__: string }).__MATANHO_API__ = 'http://localhost:4100';
  document.body.innerHTML = sidebar + topbar + drawer;
  stubLegacyShellGlobals();
  for (const f of bridgeFiles(opts.bridges ?? ['mx-core.js', 'admin-00-common.js', 'admin-70-shell.js', 'admin-99-boot.js'])) {
    runScript(readText(path.join(bridgePub, f)));
  }
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="v17-command-backdrop" id="v17CommandBackdrop"><section class="v17-command"><input id="v17CommandInput"><div id="v17CommandList"></div></section></div>',
  );
  const ready = (window as unknown as { __matanhoBridgeReady?: Promise<void> }).__matanhoBridgeReady;
  if (ready) await ready;
  window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
  return api;
}
