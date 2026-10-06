import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootLegacyShell } from './_harness';
import { ok, raw } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W1 command, operations, shell bridges', () => {
  it('bridge files exist and reference live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-70-shell.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-71-command.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-72-operations.js'))).toBe(true);
    const shell = readFileSync(path.join(bridgeDir, 'admin-70-shell.js'), 'utf8');
    const command = readFileSync(path.join(bridgeDir, 'admin-71-command.js'), 'utf8');
    const ops = readFileSync(path.join(bridgeDir, 'admin-72-operations.js'), 'utf8');
    expect(shell).toMatch(/\/shell\/search/);
    expect(shell).toMatch(/\/shell\/record/);
    expect(shell).toMatch(/bindRecordLinkDelegation/);
    expect(shell).toMatch(/data-mx-record-kind/);
    expect(shell).toMatch(/hydrateProfile/);
    expect(shell).toMatch(/v17RenderCommands/);
    expect(shell).toMatch(/\/notifications/);
    expect(shell).toMatch(/role-focus/);
    expect(shell).toMatch(/\/dashboard\/today/);
    expect(shell).toMatch(/ops-health/);
    expect(command).toMatch(/\/dashboard\/today/);
    expect(command).toMatch(/generate-investment-pack/);
    expect(command).toMatch(/\/reports\/runs/);
    expect(ops).toMatch(/\/operations\/status/);
    expect(ops).toMatch(/ops-controls\/settlement-fails/);
    expect(ops).toMatch(/renderSettlementFails/);
    expect(ops).toMatch(/\/operations\/tasks/);
    expect(ops).toMatch(/exportRunbook/);
    expect(ops).toMatch(/exportCalendar/);
    expect(ops).toMatch(/format: format/);
    expect(ops).toMatch(/Export XLSX/);
    expect(ops).toMatch(/clearOpsChrome/);
    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-72-operations/);
  });

  it('w1 DATA_HOOKS patch applied to v33-rebuild.js', () => {
    const js = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(js).toMatch(/__mxData\.opsTasks/);
  });

  it('w1 DATA_HOOKS patch command gio charts in 09-v30-chart-engine.js', () => {
    const js = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/09-v30-chart-engine.js'), 'utf8');
    const command = readFileSync(path.join(bridgeDir, 'admin-71-command.js'), 'utf8');
    expect(js).toMatch(/__mxData\._gioAttribution/);
    expect(js).toMatch(/__mxRerenderCommandCharts/);
    expect(js).toMatch(/__mxData\._gioScope/);
    expect(js).toMatch(/__mxData\._gioMiniLiquidity/);
    expect(js).toMatch(/__mxApplyGioScope/);
    expect(command).toMatch(/stashGioCharts/);
    expect(command).toMatch(/buildGioScope/);
    expect(command).toMatch(/operations\/workload/);
  });

  it('command palette loads live search hits and opens record drawer', async () => {
    const api = await bootLegacyShell({
      user: {
        name: 'Shell Tester',
        email: 'shell@test.local',
        permissions: ['dashboard.view', 'orders.view', 'operations.view'],
      },
      routes: {
        'GET /api/v1/shell/me/role-focus': raw({ roles: [{ key: 'dealer', label: 'Dealer' }], role: null }),
        'GET /api/v1/dashboard/today': ok({ asOf: new Date().toISOString(), approvals: { total: 0, items: [] } }),
        'GET /api/v1/operations/status': ok({ asOf: new Date().toISOString(), kpis: { serviceHealth: 'ok' } }),
        'GET /api/v1/notifications': raw({ items: [], unread: 0 }),
        'GET /api/v1/shell/search': ok({
          hits: [{ kind: 'order', kindLabel: 'Order', id: 'o1', ref: 'ORD-1', title: 'ORD-1', status: 'Open', href: '/ops/record/order/o1' }],
        }),
        'GET /api/v1/shell/record/order/o1': ok({
          record: {
            kind: 'order',
            kindLabel: 'Order',
            id: 'o1',
            ref: 'ORD-1',
            title: 'ORD-1',
            status: 'Open',
            route: '/ops/orders',
            fields: [{ label: 'Side', value: 'Buy' }],
          },
          history: [],
        }),
      },
    });

    const w = window as unknown as { v17RenderCommands: (q: string) => void; __lastDrawer?: { title?: string } };
    w.v17RenderCommands('ord');
    await new Promise((r) => setTimeout(r, 220));
    expect(api.calls('GET /api/v1/shell/search').length).toBeGreaterThan(0);
    document.querySelector<HTMLButtonElement>('[data-mx-palette-hit="0"]')?.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('GET /api/v1/shell/record/order/o1').length).toBe(1);
    expect(w.__lastDrawer?.title).toBe('ORD-1');
  });

  it('notification with record link opens shell record drawer', async () => {
    const api = await bootLegacyShell({
      user: { name: 'Shell Tester', email: 'shell@test.local', permissions: ['dashboard.view', 'operations.view', 'orders.view'] },
      routes: {
        'GET /api/v1/shell/me/role-focus': raw({ roles: [{ key: 'dealer', label: 'Dealer' }], role: null }),
        'GET /api/v1/dashboard/today': ok({ asOf: new Date().toISOString(), approvals: { total: 0, items: [] } }),
        'GET /api/v1/operations/status': ok({ asOf: new Date().toISOString(), kpis: { serviceHealth: 'ok' } }),
        'GET /api/v1/notifications': raw({
          items: [{ id: 'n1', title: 'Order ready', body: 'Approve ORD-2', link: '/ops/record/order/o2' }],
          unread: 1,
        }),
        'POST /api/v1/notifications/n1/read': ok({}),
        'GET /api/v1/shell/record/order/o2': ok({
          record: {
            kind: 'order',
            kindLabel: 'Order',
            id: 'o2',
            ref: 'ORD-2',
            title: 'ORD-2',
            status: 'AwaitingApproval',
            route: '/ops/orders',
            fields: [],
          },
          history: null,
        }),
      },
    });
    document.querySelector<HTMLButtonElement>('.notify-btn')?.click();
    await new Promise((r) => setTimeout(r, 0));
    document.querySelector<HTMLButtonElement>('[data-nid="n1"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('GET /api/v1/shell/record/order/o2').length).toBe(1);
    expect((window as unknown as { __lastDrawer?: { title?: string } }).__lastDrawer?.title).toBe('ORD-2');
  });
});
