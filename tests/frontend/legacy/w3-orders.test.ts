import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegacyHarness } from './_harness';
import { ok } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');
const markupDir = path.join(repoRoot, 'portals/admin-web/src/legacy/markup');

describe('W3 orders bridge', () => {
  it('bridge file exists and references live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-90-orders.js'))).toBe(true);
    const orders = readFileSync(path.join(bridgeDir, 'admin-90-orders.js'), 'utf8');
    expect(orders).toMatch(/\/api\/v1\/orders/);
    expect(orders).toMatch(/broker-instruction\/preview/);
    expect(orders).toMatch(/\/approve/);
    expect(orders).toMatch(/\/route/);
    expect(orders).toMatch(/\/fills/);
    expect(orders).toMatch(/\/cancel/);
    expect(orders).toMatch(/\/reject/);
    expect(orders).toMatch(/\/settle/);
    expect(orders).toMatch(/rejectLiveOrder/);
    expect(orders).toMatch(/settleLiveOrder/);
    expect(orders).toMatch(/patchOrderDrawerCash/);
    expect(orders).toMatch(/patchOrderDrawerPostTrade/);
    expect(orders).toMatch(/\/post-trade/);
    expect(orders).toMatch(/buildOrderModalBody/);
    expect(orders).toMatch(/renderLivePostTradeTab/);
    expect(orders).toMatch(/clearOrdersKpis/);
    expect(orders).toMatch(/openOrderImportModal/);
    expect(orders).toMatch(/STOP_LIMIT/);
    expect(orders).toMatch(/submitTicket37/);
    expect(orders).toMatch(/priceOverrideReason/);
    expect(orders).toMatch(/\/precheck/);
    expect(orders).toMatch(/refreshCash/);
    expect(orders).toMatch(/export-orders/);
    expect(orders).toMatch(/streamDownload/);
    expect(orders).toMatch(/format: 'xlsx'/);
    expect(orders).toMatch(/v33SubmitOrder/);
    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-90-orders/);
  });

  it('order drawer loads cash reservation from order detail API', async () => {
    const drawer = readFileSync(path.join(markupDir, '38-detaildrawer.html'), 'utf8');
    const api = loadLegacyHarness({
      fragment: '10-page-orders.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-90-orders.js'],
      user: {
        name: 'Dealer',
        email: 'dealer@test.local',
        permissions: ['orders.view', 'orders.create', 'cash.view'],
      },
      routes: {
        'GET /api/v1/orders/o-live': ok({
          id: 'o-live',
          ref: 'ORD-LIVE',
          version: 3,
          currency: 'USD',
          reservedAmount: '15000.00',
          allowed: ['cancel'],
          cash: { holds: [], ledger: { ref: 'BANK-USD', posted: '100000.00', available: '85000.00', reservedByOthers: '0.00', minBuffer: '0.00' } },
          precheck: { checks: [{ key: 'cash', result: 'Pass', detail: 'ok' }] },
        }),
      },
    });
    document.body.insertAdjacentHTML('beforeend', drawer);
    const w = window as unknown as {
      mx: { live: boolean; user: { permissions: string[] } };
      openOrderDrawer: (o: { id: string; apiId: string }) => void;
      closeDrawer: () => void;
    };
    w.mx.user = { permissions: ['orders.view', 'orders.create', 'cash.view'] };
    w.mx.live = true;
    w.closeDrawer = () => {};
    w.openOrderDrawer = function (o) {
      document.getElementById('drawerBody')!.innerHTML =
        '<div class="order360-snapshot"></div><div class="order360-toolbar-actions"></div><div class="order360-control-table"><div></div><div><b class="pass"></b><small></small></div></div>';
      (window as unknown as { __protoOrder?: unknown }).__protoOrder = o;
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await Promise.resolve(w.openOrderDrawer({ id: 'ORD-LIVE', apiId: 'o-live' }));
    expect(api.calls('GET /api/v1/orders/o-live').length).toBe(1);
    const reserved = document.querySelector('[data-mx-cash-reserved] strong');
    expect(reserved?.textContent).toMatch(/USD 15,000\.00/);
    expect(document.querySelector('[data-mx-cancel-order]')).toBeTruthy();
  });

  it('order drawer injects reject and settle actions from allowed list', async () => {
    const drawer = readFileSync(path.join(markupDir, '38-detaildrawer.html'), 'utf8');
    loadLegacyHarness({
      fragment: '10-page-orders.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-90-orders.js'],
      user: {
        name: 'Approver',
        email: 'approver@test.local',
        permissions: ['orders.view', 'orders.approve', 'orders.route'],
      },
      routes: {
        'GET /api/v1/orders/o-reject': ok({
          id: 'o-reject',
          ref: 'ORD-REJ',
          version: 2,
          currency: 'USD',
          reservedAmount: '0',
          allowed: ['reject'],
        }),
        'GET /api/v1/orders/o-settle': ok({
          id: 'o-settle',
          ref: 'ORD-SET',
          version: 4,
          currency: 'USD',
          reservedAmount: '0',
          allowed: ['settle'],
        }),
      },
    });
    document.body.insertAdjacentHTML('beforeend', drawer);
    const w = window as unknown as {
      mx: { live: boolean; user: { permissions: string[] } };
      openOrderDrawer: (o: { id: string; apiId: string }) => Promise<void>;
      closeDrawer: () => void;
    };
    w.mx.user = { permissions: ['orders.view', 'orders.approve', 'orders.route'] };
    w.mx.live = true;
    w.closeDrawer = () => {};
    w.openOrderDrawer = function () {
      document.getElementById('drawerBody')!.innerHTML =
        '<div class="order360-snapshot"></div><div class="order360-toolbar-actions"></div>';
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await w.openOrderDrawer({ id: 'ORD-REJ', apiId: 'o-reject' });
    expect(document.querySelector('[data-mx-reject-order]')).toBeTruthy();
    await w.openOrderDrawer({ id: 'ORD-SET', apiId: 'o-settle' });
    expect(document.querySelector('[data-mx-settle-order]')).toBeTruthy();
  });

  it('order drawer loads post-trade panel for filled orders', async () => {
    const drawer = readFileSync(path.join(markupDir, '38-detaildrawer.html'), 'utf8');
    loadLegacyHarness({
      fragment: '10-page-orders.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-90-orders.js'],
      user: {
        name: 'Dealer',
        email: 'dealer@test.local',
        permissions: ['orders.view', 'orders.route'],
      },
      routes: {
        'GET /api/v1/orders/o-fill': ok({
          id: 'o-fill',
          ref: 'ORD-FILL',
          version: 2,
          status: 'Filled',
          currency: 'USD',
          quantity: '1000',
          filledQty: '1000',
          decisionPrice: '1.25',
          reservedAmount: '0',
          allowed: ['settle'],
          broker: { id: 'brk-1', name: 'ABC Securities' },
        }),
        'GET /api/v1/orders/o-fill/post-trade': ok({
          orderId: 'o-fill',
          ref: 'ORD-FILL',
          status: 'Filled',
          currency: 'USD',
          side: 'BUY',
          decisionPrice: '1.25',
          allocation: {
            portfolio: { id: 'p1', ref: 'PF-1', name: 'Growth Mandate' },
            filledQty: '1000',
            orderQty: '1000',
            sharePct: '100',
            avgPrice: '1.26',
            gross: '1260.00',
            fees: '5.00',
            net: '1265.00',
            positionAfter: null,
            fills: [{ id: 'f1', executedAt: '2026-10-05T14:00:00Z', source: 'FIX', quantity: '1000', price: '1.26', fees: '5.00', gross: '1260.00', net: '1265.00', slippageBp: 8 }],
          },
          slippage: { decisionPrice: '1.25', avgPrice: '1.26', bp: 8, amount: '10.00', worstFillBp: 8 },
          contractNote: { status: 'MATCHED', lines: [{ ref: 'TFL-1', source: 'BROKER', externalRef: 'BR-99', status: 'MATCHED', breakReason: null, detail: null, quantity: '1000', price: '1.26', fees: '5.00', tradeDate: '2026-10-05', fillId: 'f1', variance: null }] },
          settlement: { settled: false, readyToSettle: true, fillsTieToOrder: true },
        }),
      },
    });
    document.body.insertAdjacentHTML('beforeend', drawer);
    const w = window as unknown as {
      mx: { live: boolean; user: { permissions: string[] } };
      openOrderDrawer: (o: { id: string; apiId: string }) => Promise<void>;
      closeDrawer: () => void;
    };
    w.mx.user = { permissions: ['orders.view', 'orders.route'] };
    w.mx.live = true;
    w.closeDrawer = () => {};
    w.openOrderDrawer = function () {
      document.getElementById('drawerBody')!.innerHTML =
        '<div class="order360-snapshot"></div><div class="order360-toolbar-actions"></div><div class="workspace-360-pane" data-order-pane="posttrade"><div class="order360-posttrade-grid"><section class="workspace-360-card"><div class="order360-fill"><div><span>Filled</span><strong>0 / 0</strong><b>0%</b></div><i><u style="width:0%"></u></i></div><div class="order360-mini-grid"><div><span>Average</span><strong>—</strong></div><div><span>Decision</span><strong>—</strong></div><div><span>Slippage</span><strong>—</strong></div><div><span>Residual</span><strong>—</strong></div></div></section><section class="workspace-360-card"><div class="order360-settle-summary"><div><span>Allocation</span><strong>—</strong></div><div><span>Settlement</span><strong>—</strong></div></div><div class="order360-checklist"><div class="pending"><i>4</i><span><strong>External confirmation</strong><small>Broker/custodian evidence completes reconciliation</small></span></div></div></section></div></div>';
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await w.openOrderDrawer({ id: 'ORD-FILL', apiId: 'o-fill' });
    expect(document.querySelector('[data-mx-contract-note]')).toBeTruthy();
    const slip = document.querySelector('.order360-mini-grid div:nth-child(3) strong');
    expect(slip?.textContent).toMatch(/8\.0 bps/);
  });

  it('w3 DATA_HOOKS patch applied to orders scripts', () => {
    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\._orders/);
    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._v33Orders/);
    const v56 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v56-enhancements.js'), 'utf8');
    expect(v56).toMatch(/mx\.strict\('orders'\)/);
  });
});
