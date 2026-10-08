/**
 * no-demo-data.test.ts
 *
 * jsdom proof that key demo-data root causes are fixed:
 * 1. mx.hydrate is the proper implementation (not overwritten)
 * 2. Cross-bridge functions are exposed globally
 * 3. window.__mxData arrays are initialized before prototype runs
 * 4. Specific bridges call the right API endpoints
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegacyHarness, stubLegacyShellGlobals, bootLegacyShell } from './_harness';
import { ok, raw } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');
const bridgePub = path.join(repoRoot, 'portals/admin-web/public/legacy/js/bridge');
const markupDir = path.join(repoRoot, 'portals/admin-web/src/legacy/markup');
const legacyJs = path.join(repoRoot, 'portals/admin-web/public/legacy/js');

describe('W0 no-demo-data (jsdom)', () => {
  it('mx.hydrate is the proper implementation (not overwritten by duplicate)', () => {
    const core = readFileSync(path.join(bridgePub, 'mx-core.js'), 'utf8');
    const matches = core.match(/mx\.hydrate\s*=\s*function/g) || [];
    expect(matches.length).toBe(1);
    expect(core).toMatch(/hydrators\[page\]\s*=\s*fn/);
  });

  it('renderAudit is exposed globally for cross-bridge access', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-60-access.js'))).toBe(true);
    const src = readFileSync(path.join(bridgeDir, 'admin-60-access.js'), 'utf8');
    expect(src).toMatch(/window\.renderAudit\s*=\s*renderAudit/);
  });

  it('orders bridge initializes window.__mxData._orders before prototype', () => {
    const src = readFileSync(path.join(bridgeDir, 'admin-90-orders.js'), 'utf8');
    expect(src).toMatch(/window\.__mxData\s*=\s*window\.__mxData\s*\|\|\s*\{\}/);
    expect(src).toMatch(/window\.__mxData\._orders/);
    expect(src).toMatch(/mx\.replace\(window\.__mxData\._orders/);
  });

  it('vault bridge initializes window.__mxData._vaultDocs33 before prototype', () => {
    const src = readFileSync(path.join(bridgeDir, 'admin-40-documents.js'), 'utf8');
    expect(src).toMatch(/window\.__mxData\s*=\s*window\.__mxData\s*\|\|\s*\{\}/);
    expect(src).toMatch(/window\.__mxData\._vaultDocs33/);
    expect(src).toMatch(/mx\.replace\(window\.__mxData\._vaultDocs33/);
  });

it('orders page loads API orders via bridge hydration', async () => {
    const drawer = readFileSync(path.join(markupDir, '38-detaildrawer.html'), 'utf8');
    const topbar = readFileSync(path.join(markupDir, '05-header-topbar.html'), 'utf8');
    const sidebar = readFileSync(path.join(markupDir, '03-sidebar.html'), 'utf8');
    const pageFragment = readFileSync(path.join(markupDir, '10-page-orders.html'), 'utf8');

    // Use bootLegacyShell which properly awaits bridge readiness
    const api = await bootLegacyShell({
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-70-shell.js', 'admin-90-orders.js', 'admin-99-boot.js'],
      scripts: ['01-inline.js', 'v33-rebuild.js'],
      user: {
        name: 'Dealer',
        email: 'dealer@test.local',
        permissions: ['orders.view', 'orders.create', 'cash.view', 'dashboard.view', 'operations.view'],
      },
      routes: {
        'GET /api/v1/shell/me/role-focus': ok({ focus: 'orders' }),
        'GET /api/v1/orders': ok([
          { id: 'o-1', ref: 'ORD-001012', status: 'PartiallyFilled', security: 'DLTA.ZW', side: 'Buy', quantity: '1000', limitPrice: '1.25', portfolio: 'Balanced Growth', broker: 'IH', owner: 'N. Dube', createdAt: '2026-08-31T10:00:00Z' },
        ]),
        'GET /api/v1/portfolios': ok([]),
        'GET /api/v1/securities': ok([]),
        'GET /api/v1/brokers': ok([]),
        'GET /api/v1/admin/users': ok([]),
        'GET /api/v1/admin/policy': ok({}),
        'GET /api/v1/admin/settings': ok([]),
        'GET /api/v1/admin/access-context': ok({
          roles: ['dealer'],
          role: 'dealer',
          roleLabels: { dealer: 'Dealer' },
          rolePermissions: { dealer: ['orders.view', 'orders.create', 'cash.view', 'dashboard.view', 'operations.view'] },
        }),
      },
    });

    const pageEl = document.createElement('section');
    pageEl.innerHTML = pageFragment;
    document.body.appendChild(pageEl);

    const w = window as unknown as { mx: { live: boolean; user?: { permissions: string[] } }; navigate?: (page: string) => void };
    w.mx.live = true;
    w.navigate?.('orders');
    await Promise.resolve();
    await Promise.resolve();
    expect(api.calls('GET /api/v1/orders').length).toBeGreaterThanOrEqual(1);
    expect(document.body.innerHTML).not.toMatch(/ORD-492\d\d/);
  });

  it('audit bridge exposes renderAudit and references correct endpoint', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-60-access.js'))).toBe(true);
    const src = readFileSync(path.join(bridgeDir, 'admin-60-access.js'), 'utf8');
    expect(src).toMatch(/window\.renderAudit\s*=\s*renderAudit/);
    expect(src).toMatch(/\/audit-events/);
  });

  it('vault bridge uses documents.view permission and loads /api/v1/documents', () => {
    const src = readFileSync(path.join(bridgeDir, 'admin-40-documents.js'), 'utf8');
    expect(src).toMatch(/mx\.onLoad\(['"]documents\.view['"]/);
    expect(src).toMatch(/\/api\/v1\/documents/);
  });

  it('portfolio-lab bridge uses portfolio-lab hydrate and clears demo KPIs', () => {
    const src = readFileSync(path.join(bridgeDir, 'admin-82-portfolio-lab.js'), 'utf8');
    expect(src).toMatch(/mx\.hydrate\(['"]portfolio-lab['"]/);
    expect(src).toMatch(/clearLabKpis/);
  });
});
