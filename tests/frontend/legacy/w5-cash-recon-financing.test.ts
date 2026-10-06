import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLegacyHarness } from './_harness';
import { ok, raw } from '../_helpers/mockApi';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeDir = path.join(repoRoot, 'portals/admin-web/src/legacy/bridge');

describe('W5 cash, recon, financing, corporate-actions bridges', () => {
  it('bridge files exist and reference live API paths', () => {
    expect(existsSync(path.join(bridgeDir, 'admin-94-cash.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-95-recon.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-96-financing.js'))).toBe(true);
    expect(existsSync(path.join(bridgeDir, 'admin-97-corporate-actions.js'))).toBe(true);

    const cash = readFileSync(path.join(bridgeDir, 'admin-94-cash.js'), 'utf8');
    expect(cash).toMatch(/\/api\/v1\/cash\/balances/);
    expect(cash).toMatch(/\/api\/v1\/cash\/journals/);
    expect(cash).toMatch(/\/submit/);
    expect(cash).toMatch(/\/api\/v1\/cash\/expectations/);
    expect(cash).toMatch(/updateReservationButton/);
    expect(cash).toMatch(/statement-imports/);
    expect(cash).toMatch(/saveReservation/);

    const recon = readFileSync(path.join(bridgeDir, 'admin-95-recon.js'), 'utf8');
    expect(recon).toMatch(/\/api\/v1\/recon\/breaks/);
    expect(recon).toMatch(/postBreakAction\(ref, 'assign'/);
    expect(recon).toMatch(/postBreakAction\(ref, 'investigate'/);
    expect(recon).toMatch(/postBreakAction\(ref, 'escalate'/);
    expect(recon).toMatch(/\/api\/v1\/recon\/runs/);
    expect(recon).toMatch(/\/api\/v1\/recon\/signoffs/);
    expect(recon).toMatch(/ensureReconExportButton/);
    expect(recon).toMatch(/streamDownload/);
    expect(recon).toMatch(/openBreakQueryModal/);
    expect(recon).toMatch(/openAcceptCandidateModal/);
    expect(recon).toMatch(/mxReconQuery/);
    expect(recon).not.toMatch(/window\.prompt\('Query subject/);

    const ops = readFileSync(path.join(bridgeDir, 'admin-72-operations.js'), 'utf8');
    expect(ops).toMatch(/function exportRunbook/);
    expect(ops).toMatch(/exportCalendar\('csv'/);
    expect(ops).toMatch(/ensureOpsExportButton/);
    expect(ops).toMatch(/renderCloseGates/);

    const fin = readFileSync(path.join(bridgeDir, 'admin-96-financing.js'), 'utf8');
    expect(fin).toMatch(/\/api\/v1\/financing\/facilities/);
    expect(fin).toMatch(/\/api\/v1\/financing\/calls/);
    expect(fin).toMatch(/'draw'/);
    expect(fin).toMatch(/openFacilityMovementModal/);
    expect(fin).toMatch(/openNewFacilityModal/);
    expect(fin).toMatch(/\/api\/v1\/financing\/summary/);
    expect(fin).toMatch(/clearFinancingKpis/);
    expect(fin).toMatch(/openFacilityLifecycleModal/);
    expect(fin).toMatch(/\/submit/);
    expect(fin).toMatch(/\/approve/);
    expect(fin).toMatch(/mx\.reasonModal/);
    expect(fin).not.toMatch(/window\.prompt\('Dispute reason/);

    expect(recon).toMatch(/clearReconKpis/);
    expect(recon).toMatch(/v33ReconUnmatched/);
    expect(cash).toMatch(/clearCashTiles/);
    expect(cash).toMatch(/updateExpectationButton/);
    expect(cash).toMatch(/openNewReservationModal/);

    const ca = readFileSync(path.join(bridgeDir, 'admin-97-corporate-actions.js'), 'utf8');
    expect(ca).toMatch(/\/api\/v1\/corporate-actions\/events/);
    expect(ca).toMatch(/entitlements\/calculate/);
    expect(ca).toMatch(/'\/process'/);
    expect(ca).toMatch(/openNewEventModal/);
    expect(ca).toMatch(/openCorpActionDrawer/);
    expect(ca).toMatch(/clearCaChrome/);
    expect(ca).toMatch(/patchDeadlineSidebar/);
    expect(ca).toMatch(/\/elections/);
    expect(ca).toMatch(/mx\.reasonModal/);
    expect(ca).not.toMatch(/window\.prompt\('Reason for reversal/);

    expect(recon).toMatch(/accept-candidate/);
    expect(recon).toMatch(/\/query/);
    expect(recon).toMatch(/openReconRulesModal/);
    expect(recon).toMatch(/\/recon\/tolerances/);
    expect(recon).toMatch(/\/recon\/account-map/);
    expect(recon).toMatch(/\/recon\/custody-positions/);
    expect(recon).toMatch(/attachBreakEvidence/);
    expect(recon).toMatch(/reopenBreak/);
    expect(recon).toMatch(/connector-imports/);
    expect(ops).toMatch(/clearOpsChrome/);
    expect(fin).toMatch(/toggleFinancingDemoPanels/);

    const manifest = readFileSync(path.join(repoRoot, 'portals/admin-web/src/legacy/manifest.ts'), 'utf8');
    expect(manifest).toMatch(/admin-94-cash/);
    expect(manifest).toMatch(/admin-95-recon/);
    expect(manifest).toMatch(/admin-96-financing/);
    expect(manifest).toMatch(/admin-97-corporate-actions/);
  });

  it('w5 DATA_HOOKS patch cash, recon, financing and corporate actions scripts', () => {
    const inline = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');
    expect(inline).toMatch(/__mxData\.cashJournals/);
    expect(inline).toMatch(/__mxData\.cashReservations/);
    expect(inline).toMatch(/__mxData\.statementImports/);

    const v12 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/04-v12-user-focused-js.js'), 'utf8');
    expect(v12).toMatch(/matanho-recon-v12/);

    const v6 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/06-inline.js'), 'utf8');
    expect(v6).toMatch(/__mxData\._v15CorpActions/);

    const v33 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v33-rebuild.js'), 'utf8');
    expect(v33).toMatch(/__mxData\._reconBreaks33/);
    expect(v33).toMatch(/__mxData\._facilities33/);

    const v52 = readFileSync(path.join(repoRoot, 'portals/admin-web/public/legacy/js/v52-enhancements.js'), 'utf8');
    expect(v52).toMatch(/__mxData\._fin52/);
  });

  it('cash bridge hydrates reserved and available tiles from balances API', async () => {
    const api = loadLegacyHarness({
      fragment: '20-page-cash.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-94-cash.js'],
      user: {
        name: 'Cash Ops',
        email: 'cash@test.local',
        permissions: ['cash.view'],
      },
      routes: {
        'GET /api/v1/cash/context': ok({ clients: [], portfolios: [], cashAccounts: [], currencies: ['USD'] }),
        'GET /api/v1/cash/balances': ok({
          totals: [{ currency: 'USD', posted: '10000.00', reserved: '2500.00', available: '5500.00', expectedNet: '480.00' }],
          ledgers: [{ currency: 'USD', withdrawable: '5400.00', minBuffer: '500.00' }],
        }),
        'GET /api/v1/cash/journals': ok([]),
        'GET /api/v1/cash/reservations': ok([{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'RELEASED' }]),
        'GET /api/v1/cash/expectations': ok([]),
        'GET /api/v1/cash/statement-imports': ok([]),
      },
    });
    const mx = (window as unknown as { mx: { live: boolean; user: { permissions: string[] }; refresh: (p: string) => Promise<void> } }).mx;
    mx.user = { permissions: ['cash.view'] };
    mx.live = true;
    await mx.refresh('cash');
    const articles = document.querySelectorAll('#page-cash .cash-state-grid article');
    expect(articles[1]?.querySelector('strong')?.textContent).toMatch(/2,500\.00/);
    expect(articles[4]?.querySelector('strong')?.textContent).toMatch(/5,500\.00/);
    expect(document.querySelector('[data-action="view-reservations"]')?.textContent).toBe('2 reservations');
    expect(api.calls('GET /api/v1/cash/balances').length).toBeGreaterThan(0);
  });

  it('saveReservation posts a live cash reservation', async () => {
    const api = loadLegacyHarness({
      fragment: 'none',
      bridges: ['mx-core.js', 'admin-94-cash.js'],
      user: {
        id: 'u-cash',
        name: 'Cash Ops',
        email: 'cash@test.local',
        permissions: ['cash.view', 'cash.reservation'],
      },
      routes: {
        'GET /api/v1/cash/context': ok({ clients: [], portfolios: [{ id: 'p1', name: 'Fund A' }], cashAccounts: [], currencies: ['USD'] }),
        'GET /api/v1/cash/ledgers': ok([{ id: 'l1', ref: 'LED-1', currency: 'USD' }]),
        'GET /api/v1/cash/balances': ok({ totals: [], ledgers: [] }),
        'GET /api/v1/cash/journals': ok([]),
        'GET /api/v1/cash/reservations': ok([]),
        'GET /api/v1/cash/expectations': ok([]),
        'GET /api/v1/cash/statement-imports': ok([]),
        'POST /api/v1/cash/reservations': ok({ ref: 'RSV-1' }),
      },
    });
    document.body.innerHTML =
      '<button data-action="new-cash-journal"></button><button data-action="new-reservation"></button><button data-action="import-statement"></button>' +
      '<select id="cashPortfolioContext"><option value="p1" selected>Fund A</option></select>' +
      '<input id="rsvSource" value="ORD-9">' +
      '<input id="rsvAmount" value="250">' +
      '<select id="rsvPurpose"><option>BUY_SETTLEMENT</option></select>';
    const w = window as unknown as {
      mx: { live: boolean; user: { id: string; permissions: string[] } };
      saveReservation: () => void;
      closeDrawer: () => void;
      switchCashTab: (t: string) => void;
    };
    w.closeDrawer = () => {};
    w.switchCashTab = () => {};
    w.saveReservation = function () {
      throw new Error('prototype should be wrapped');
    };
    w.mx.user = { id: 'u-cash', permissions: ['cash.view', 'cash.reservation'] };
    w.mx.live = true;
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await new Promise((r) => setTimeout(r, 0));
    w.saveReservation();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls('POST /api/v1/cash/reservations').length).toBe(1);
    const body = api.calls('POST /api/v1/cash/reservations')[0]?.body as { ledgerId?: string; amount?: string };
    expect(body.ledgerId).toBe('l1');
    expect(body.amount).toBe('250');
  });

  it('financing bridge posts facility draw with step-up', async () => {
    const api = loadLegacyHarness({
      fragment: '25-page-financing.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-96-financing.js'],
      user: {
        name: 'Treasury',
        email: 'treasury@test.local',
        permissions: ['risk.view', 'financing.manage'],
      },
      routes: {
        'GET /api/v1/financing/facilities': raw({ data: [{ id: 'fac-1', ref: 'FAC-1', name: 'Margin line', lender: 'Bank', limitAmount: '1000000', status: 'ACTIVE', ratePct: '5', margin: { drawn: '0' } }] }),
        'GET /api/v1/financing/calls': raw({ data: [] }),
        'POST /api/v1/financing/facilities/fac-1/draw': raw({ movement: { kind: 'DRAW' } }),
      },
    });
    const w = window as unknown as {
      mx: {
        live: boolean;
        user: { permissions: string[] };
        modal: (o: { actions: { label: string; run: (m: HTMLElement) => unknown }[] }) => void;
        openFacilityMovementModal: (ref: string, kind: string) => void;
      };
    };
    w.mx.live = true;
    w.mx.user = { permissions: ['risk.view', 'financing.manage'] };
    w.mx.modal = function (opts) {
      const m = document.createElement('section');
      m.innerHTML =
        '<div class="v34-modal-body"><form id="mxFinMove"><input name="amount" value="50000"><input name="note" value="Working capital"></form></div>';
      document.body.appendChild(m);
      void opts.actions.find((a) => a.label === 'Post draw')?.run(m);
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await (window as unknown as { mx: { refresh: (p: string) => Promise<void> } }).mx.refresh('financing');
    w.mx.openFacilityMovementModal('FAC-1', 'DRAW');
    await new Promise((r) => setTimeout(r, 120));
    expect(api.calls('POST /api/v1/financing/facilities/fac-1/draw').length).toBe(1);
  });

  it('corporate actions bridge processes event with step-up', async () => {
    const api = loadLegacyHarness({
      fragment: '26-page-corporate-actions.html',
      bridges: ['mx-core.js', 'admin-00-common.js', 'admin-97-corporate-actions.js'],
      user: {
        id: 'u-proc',
        name: 'CA Ops',
        email: 'ca@test.local',
        permissions: ['operations.view', 'corporate_actions.process'],
      },
      routes: {
        'GET /api/v1/corporate-actions/events': raw({ data: [{ id: 'ev-1', ref: 'CA-1', status: 'CONFIRMED', type: 'CASH_DIVIDEND', ticker: 'SIM.ZW', exDate: '2026-01-01' }], summary: {} }),
        'GET /api/v1/corporate-actions/upcoming': raw({ data: [] }),
        'GET /api/v1/corporate-actions/events/ev-1': raw({
          id: 'ev-1',
          ref: 'CA-1',
          status: 'CONFIRMED',
          type: 'CASH_DIVIDEND',
          ticker: 'SIM.ZW',
          exDate: '2026-01-01',
          allowed: { process: true },
        }),
        'POST /api/v1/corporate-actions/events/ev-1/process': raw({ status: 'PROCESSED' }),
      },
    });
    const w = window as unknown as {
      mx: {
        live: boolean;
        user: { id: string; permissions: string[] };
        modal: (o: { actions: { label: string; run: () => unknown }[] }) => void;
        openCorpActionDrawer: (ref: string) => void;
      };
    };
    w.mx.live = true;
    w.mx.user = { id: 'u-proc', permissions: ['operations.view', 'corporate_actions.process'] };
    w.mx.modal = function (opts) {
      void opts.actions.find((a) => a.label === 'Process event')?.run();
    };
    window.dispatchEvent(new CustomEvent('matanho:legacy-ready'));
    await (window as unknown as { mx: { refresh: (p: string) => Promise<void> } }).mx.refresh('corporate-actions');
    await w.mx.openCorpActionDrawer('CA-1');
    await new Promise((r) => setTimeout(r, 120));
    expect(api.calls('POST /api/v1/corporate-actions/events/ev-1/process').length).toBe(1);
  });
});
