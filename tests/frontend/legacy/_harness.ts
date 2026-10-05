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
  fragment?: string;
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
  document.body.innerHTML = readText(path.join(markupDir, fragment));

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
