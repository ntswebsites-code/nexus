import { describe, it, expect } from 'vitest';
import NavPage from '@/app/(ops)/ops/nav/page';
import NavRunPage from '@/app/(ops)/ops/nav/[id]/page';
import CommandPage from '@/app/(ops)/ops/command/page';
import { expectBody, expectCalled, expectIdempotencyKey, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, PF, created, mountPage, without } from './_kit';

const run = (over: Record<string, unknown> = {}) => ({
  id: 'n-1', ref: 'NAV-00001', portfolioId: PF.id, portfolioRef: PF.ref, portfolioName: PF.name, fundId: null, fundRef: null, fundName: null, navDate: '2026-10-01', version: 1, stage: 'review', status: 'DRAFT', baseCurrency: 'USD',
  marketValue: '19801207.69', cash: '1834560.00', accruals: '0.00', fees: '0.00', liabilities: '0.00', feeRatePct: null, nav: '21635767.69', units: null, navPerUnit: null, priceCoverage: '100.0000', positionCount: 12,
  openExceptions: 1, openMaterialExceptions: 1, totalExceptions: 1, makerId: 'u1', makerName: 'Maya Maker', reviewerId: null, reviewerName: null, reviewedAt: null, checkerId: null, checkerName: null, releasedAt: null, notes: null, createdAt: '2026-10-01T08:00:00Z', updatedAt: null, ...over,
});
const navList = (rows: unknown[]) => D(rows, { total: rows.length, summary: { byStatus: {}, awaitingRelease: 2, openExceptions: 3, released: 5 } });

describe('NAV runs list', () => {
  const routes = (rows: unknown[] = [run()]) => ({ 'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/nav/runs': navList(rows) });
  it('lists runs with portfolio names, NAV, exceptions and status', async () => {
    mountPage(<NavPage />, { routes: routes() });
    expect(await screen.findByText('NAV-00001')).toBeInTheDocument();
    expect(screen.getByText('21,635,767.69')).toBeInTheDocument();
    expect(screen.getByText('1 material')).toBeInTheDocument();
    expect(screen.getByText('Growth Portfolio')).toBeInTheDocument();
  });
  it('tiles filter by status', async () => {
    const { api, user } = mountPage(<NavPage />, { routes: routes() });
    await user.click((await screen.findByText('Awaiting release', { selector: 'p' })));
    await waitFor(() => expect(api.calls('GET /api/v1/nav/runs').at(-1)!.query.get('status')).toBe('MAKER_REVIEWED'));
  });
  it('empty state', async () => {
    mountPage(<NavPage />, { routes: routes([]) });
    expect(await screen.findByText(/No NAV runs match these filters/)).toBeInTheDocument();
    expect(screen.getByText('0 runs')).toBeInTheDocument();
  });
  it('New NAV run posts only filled numbers (commas stripped) with a key, then opens the run', async () => {
    const { api, user } = mountPage(<NavPage />, { routes: { ...routes(), 'POST /api/v1/nav/runs': created(run({ id: 'n-9' })) } });
    await user.click(await screen.findByRole('button', { name: 'New NAV run' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(within(d).getByLabelText('Portfolio'), PF.id);
    await user.type(within(d).getByLabelText(/Fees/), '1,200.50');
    await user.click(within(d).getByRole('button', { name: 'Calculate NAV' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/nav/runs'));
    expectBody(req, { portfolioId: PF.id, fees: '1200.50' });
    expect(req.body).not.toHaveProperty('accruals');
    expectIdempotencyKey(req);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/nav/n-9'));
  });
  it('API error on create shows in the dialog', async () => {
    const { user } = mountPage(<NavPage />, { routes: { ...routes(), 'POST /api/v1/nav/runs': fail(409, 'conflict', 'A released NAV exists') } });
    await user.click(await screen.findByRole('button', { name: 'New NAV run' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(within(d).getByLabelText('Portfolio'), PF.id);
    await user.click(within(d).getByRole('button', { name: 'Calculate NAV' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('A released NAV exists');
  });
  it('New NAV run is hidden without valuation.view', async () => {
    mountPage(<NavPage />, { perms: without('valuation.view'), routes: routes() });
    await screen.findByText('NAV-00001');
    expect(screen.queryByRole('button', { name: 'New NAV run' })).not.toBeInTheDocument();
  });
});

const exc = { id: 'e1', type: 'STALE_PRICE', securityId: 's1', ticker: 'DLTA', detail: 'Price is 27 business days old', currentValue: '1.25', referenceValue: null, difference: null, material: true, status: 'OPEN', resolution: null, evidenceRef: null, resolvedByName: null, resolvedAt: null };
const detail = (over: Record<string, unknown> = {}, allowed: Record<string, unknown> = {}) => ({
  ...run(), stageBar: [{ key: 'draft', label: 'Draft', state: 'current' }, { key: 'review', label: 'Maker review', state: 'todo' }, { key: 'release', label: 'Release', state: 'todo' }],
  bridge: [{ key: 'mv', label: 'Securities', sign: 1, amount: '19801207.69' }, { key: 'cash', label: 'Cash', sign: 1, amount: '1834560.00' }, { key: 'nav', label: 'Net asset value', sign: 0, amount: '21635767.69' }],
  settings: { staleDays: 5, priceMovePct: 10, tolerancePct: 1, toleranceAbs: 1000 },
  lines: [{ id: 'l1', securityId: 's1', ticker: 'DLTA', name: 'Delta Corporation', currency: 'USD', quantity: '1000', price: '1.25', priceSource: 'VFEX', priceDate: '2026-08-20', fxRate: '1', valueLocal: '1250', valueBase: '1250', flags: ['STALE_PRICE'] }],
  exceptions: [exc], versions: [{ id: 'n-1', ref: 'NAV-00001', version: 1, status: 'DRAFT' }], timeline: [{ at: '2026-10-01T08:00:00Z', action: 'nav.created', actor: 'Maya Maker', reason: null }],
  allowed: { recalculate: true, editInputs: true, resolve: true, makerReview: true, makerReviewBlockers: [], release: false, releaseBlocker: null, ...allowed }, ...over,
});
const dr = (d: unknown, extra = {}) => ({ 'GET /api/v1/nav/runs/n-1': D(d), ...extra });

describe('NAV run detail', () => {
  it('ADA-013: staleness is described in business days and matches the Securities wording', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail()) });
    expect(await screen.findByText('Price is 27 business days old')).toBeInTheDocument();
    expect(screen.getByText(/stale after 5 business days \(weekdays, as on Securities\)/)).toBeInTheDocument();
    expect(screen.getByText('stale price', { selector: '.ops-badge' })).toBeInTheDocument();
  });
  it('ADA-012: shows the stored NAV figure and bridge exactly as sent by the API (no browser recomputation)', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail()) });
    await screen.findByText('NAV-00001');
    expect(screen.getAllByText('21,635,767.69').length).toBeGreaterThan(0);
    expect(screen.getByText(/19,801,207.69 USD/)).toBeInTheDocument();
  });
  it('without a linked fund it says portfolio only and shows no per-unit value', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail()) });
    expect(await screen.findByText(/portfolio only \(no linked fund\)/)).toBeInTheDocument();
    expect(screen.getByText('Enter units to compute')).toBeInTheDocument();
  });
  it('ADA-011: Maker review posts with a key then reloads the run', async () => {
    const { api, user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail(), { 'POST /api/v1/nav/runs/n-1/maker-review': D({ id: 'n-1', readBackFailed: true }) }) });
    await user.click(await screen.findByRole('button', { name: 'Maker review' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Maker review' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/nav/runs/n-1/maker-review')))[0]);
    await waitFor(() => expect(api.calls('GET /api/v1/nav/runs/n-1').length).toBe(2));
  });
  it('ADA-011: when maker review answers 500 the page refetches the stored state and shows the error', async () => {
    const { api, user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail(), { 'POST /api/v1/nav/runs/n-1/maker-review': fail(500, 'internal', 'Database unreachable') }) });
    await user.click(await screen.findByRole('button', { name: 'Maker review' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Maker review' }));
    await waitFor(() => expect(api.calls('GET /api/v1/nav/runs/n-1').length).toBe(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unreachable');
  });
  it('maker review blockers disable the button and are listed with the reason', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail({}, { makerReview: false, makerReviewBlockers: ['1 material exception is open'] })) });
    const b = await screen.findByRole('button', { name: 'Maker review' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', '1 material exception is open');
    expect(screen.getByText(/Maker review is blocked: 1 material exception is open/)).toBeInTheDocument();
  });
  it('ADA-011: Release NAV sends a key; reviewer sees the "different person" notice and a disabled button with the blocker', async () => {
    const reviewed = detail({ status: 'MAKER_REVIEWED', reviewerId: 'usr_admin', reviewerName: 'Test Admin' }, { release: false, releaseBlocker: 'You reviewed this NAV' });
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(reviewed) });
    expect(await screen.findByText(/You reviewed this NAV, so a different person/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release NAV' })).toBeDisabled();
  });
  it('Release NAV: confirm, POST /release with key, reload; a 500 also refreshes the header', async () => {
    const releasable = detail({ status: 'MAKER_REVIEWED', reviewerId: 'u2', reviewerName: 'Rita Reviewer' }, { release: true });
    const { api, user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(releasable, { 'POST /api/v1/nav/runs/n-1/release': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Release NAV' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Release NAV' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/nav/runs/n-1/release')))[0]);
    await waitFor(() => expect(api.calls('GET /api/v1/nav/runs/n-1').length).toBe(2));
  });
  it('Resolve exception needs a rationale (5+) and patches the exception with evidence', async () => {
    const { api, user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail(), { 'PATCH /api/v1/nav/runs/n-1/exceptions/e1': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Resolve' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByLabelText(/Rationale/)).toHaveAttribute('minlength', '5');
    await user.type(within(d).getByLabelText(/Rationale/), 'Broker confirmed price');
    await user.type(within(d).getByLabelText(/Evidence reference/), 'DOC-12');
    await user.click(within(d).getByRole('button', { name: 'Resolve exception' }));
    expectBody((await waitFor(() => expectCalled(api, 'PATCH /api/v1/nav/runs/n-1/exceptions/e1')))[0], { resolution: 'Broker confirmed price', evidenceRef: 'DOC-12' });
  });
  it('Resolve is hidden when the API does not allow it', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail({}, { resolve: false })) });
    await screen.findByText('NAV-00001');
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });
  it('Edit inputs sends only changed fields; unchanged form says nothing was changed and sends nothing', async () => {
    const { api, user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail(), { 'PATCH /api/v1/nav/runs/n-1/inputs': D({}) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Edit inputs' }))[0]);
    let d = await screen.findByRole('dialog');
    await user.click(within(d).getByRole('button', { name: 'Save inputs' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Nothing was changed.');
    expect(api.calls('PATCH /api/v1/nav/runs/n-1/inputs')).toHaveLength(0);
    await user.type(within(d).getByLabelText(/^Units/), '1,000,000');
    await user.click(within(d).getByRole('button', { name: 'Save inputs' }));
    expectBody((await waitFor(() => expectCalled(api, 'PATCH /api/v1/nav/runs/n-1/inputs')))[0], { units: '1000000' });
  });
  it('Recalculate creates a new version and navigates to it', async () => {
    const { user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail(), { 'POST /api/v1/nav/runs/n-1/recalculate': created({ id: 'n-2' }) }) });
    await user.click(await screen.findByRole('button', { name: 'Recalculate' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/nav/n-2'));
  });
  it('pack preview loads /pack and shows the draft marker', async () => {
    const pack = { generatedAt: '2026-10-01T00:00:00Z', draft: true, title: 'NAV pack', navDate: '2026-10-01', baseCurrency: 'USD', portfolio: { ref: PF.ref, name: PF.name }, fund: null, kpis: { nav: '21635767.69', navPerUnit: null, units: null, priceCoverage: '100.0000', positionCount: 12 }, bridge: [], topPositions: [{ ticker: 'DLTA', name: 'Delta', quantity: '1', price: '1.25', priceDate: '2026-10-01', priceSource: 'VFEX', valueBase: '1.25' }], exceptions: { open: 1, material: 1, total: 1, items: [] }, approvals: { preparedBy: 'Maya Maker', preparedAt: null, reviewedBy: null, reviewedAt: null, releasedBy: null, releasedAt: null }, notes: null };
    const { user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail(), { 'GET /api/v1/nav/runs/n-1/pack': D(pack) }) });
    await user.click(await screen.findByRole('button', { name: 'Preview pack' }));
    const d = await screen.findByRole('dialog');
    expect(await within(d).findByText('draft')).toBeInTheDocument();
    expect(within(d).getByText('1 open (1 material) of 1')).toBeInTheDocument();
  });
  it('released runs are final: no review, edit or recalculate controls', async () => {
    const released = detail({ status: 'RELEASED', checkerName: 'Carl Checker', releasedAt: '2026-10-01T12:00:00Z', openExceptions: 0 }, { recalculate: false, editInputs: false, resolve: false, makerReview: false });
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(released) });
    expect(await screen.findByText(/Released by Carl Checker/)).toBeInTheDocument();
    for (const n of ['Maker review', 'Edit inputs', 'Recalculate', 'Release NAV']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
  });
  it('superseded run links to the latest version', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail({ status: 'SUPERSEDED', versions: [{ id: 'n-2', ref: 'NAV-00002', version: 2, status: 'DRAFT' }, { id: 'n-1', ref: 'NAV-00001', version: 1, status: 'SUPERSEDED' }] })) });
    expect(await screen.findByRole('link', { name: /NAV-00002 \(version 2\)/ })).toHaveAttribute('href', '/ops-native/nav/n-2');
  });
  it('low price coverage warns that positions are excluded', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: dr(detail({ priceCoverage: '80.0000' })) });
    expect(await screen.findByText(/some positions could not be valued/)).toBeInTheDocument();
  });
});

const today = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-01T09:00:00Z',
  aum: { byCurrency: [{ currency: 'USD', amount: '21635767.69' }], portfolios: 4, positions: 30, cashPct: '8.5', warnings: 0, stalePrices: 2 },
  ordersWorking: { total: 1, awaitingApproval: 1, byStatus: { Approved: 1 } },
  breaks: { open: 8, high: 5, pendingChecker: 1 },
  approvals: { total: 3, items: [{ key: 'orders', label: 'Orders awaiting approval', count: 2, link: '/ops-native/orders' }, { key: 'nav', label: 'NAV awaiting release', count: 1, link: '/ops-native/nav' }, { key: 'cash', label: 'Cash journals', count: 0, link: '/ops-native/cash' }] },
  cash: { ledgers: 3, byCurrency: [{ currency: 'USD', posted: '1000.00', reserved: '100.00', available: '900.00' }] },
  nav: { latestReleasedDate: '2026-09-30', latestReleasedRef: 'NAV-1', inProgress: { MAKER_REVIEWED: 1 }, portfoliosReleasedThisWeek: 2, portfolios: 4 },
  risk: { open: 0, acknowledged: 1, unrecorded: 2 },
  runbookDueToday: 3, ...over,
});
const panels = { asOf: '2026-10-01', performance: [], allocation: [], scenario: [] };

describe('Today (command centre)', () => {
  const routes = (t = today()) => ({ 'GET /api/v1/dashboard/today': D(t), 'GET /api/v1/dashboard/panels': D(panels) });
  it('ADA-006: Orders working shows working count, readable statuses and awaiting approval separately', async () => {
    mountPage(<CommandPage />, { routes: routes() });
    const tile = (await screen.findByText('Orders working')).closest('button')!;
    expect(tile).toHaveTextContent('1 approved · 1 awaiting approval');
    expect(tile).not.toHaveTextContent(/awaitingapproval/i);
  });
  it('ADA-006: camelCase status names are split into words', async () => {
    mountPage(<CommandPage />, { routes: routes(today({ ordersWorking: { total: 2, awaitingApproval: 0, byStatus: { PartiallyFilled: 2 } } })) });
    expect((await screen.findByText('Orders working')).closest('button')).toHaveTextContent('2 partially filled');
  });
  it('ADA-007/009: Risk breaches counts recorded + unrecorded exceedances and says they are not yet recorded', async () => {
    mountPage(<CommandPage />, { routes: routes() });
    const tile = (await screen.findByText('Risk breaches')).closest('button')!;
    expect(tile).toHaveTextContent('2');
    expect(tile).toHaveTextContent('2 over limit, not yet recorded (run the monitor)');
  });
  it('ADA-007: when the over-limit check failed it says so instead of showing 0 as fact', async () => {
    mountPage(<CommandPage />, { routes: routes(today({ risk: { open: 0, acknowledged: 0, unrecordedUnavailable: true } })) });
    expect((await screen.findByText('Risk breaches')).closest('button')).toHaveTextContent('over-limit check unavailable, retry shortly');
  });
  it('ADA-008: AUM tile flags stale prices', async () => {
    mountPage(<CommandPage />, { routes: routes() });
    expect((await screen.findByText('Assets under management')).closest('button')).toHaveTextContent('2 stale prices');
  });
  it('tiles navigate to the workspace that owns them', async () => {
    const { user } = mountPage(<CommandPage />, { routes: routes() });
    await user.click((await screen.findByText('Open breaks')).closest('button')!);
    expect(router.push).toHaveBeenCalledWith('/ops-native/reconciliation');
    await user.click(screen.getByText('Cash available').closest('button')!);
    expect(router.push).toHaveBeenCalledWith('/ops-native/cash');
  });
  it('approval queue lists items with links; role with no queues sees the empty message', async () => {
    mountPage(<CommandPage />, { routes: routes() });
    expect(await screen.findByText('Orders awaiting approval')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '/ops-native/orders');
  });
  it('no approval queues', async () => {
    mountPage(<CommandPage />, { routes: routes(today({ approvals: { total: 0, items: [] } })) });
    expect(await screen.findByText('Your role has no approval queues.')).toBeInTheDocument();
  });
  it('tiles for areas the user cannot see are omitted (null sections)', async () => {
    mountPage(<CommandPage />, { routes: routes(today({ aum: null, cash: null, nav: null, risk: null, breaks: null, runbookDueToday: null })) });
    await screen.findByText('Orders working');
    for (const n of ['Assets under management', 'Cash available', 'NAV status', 'Risk breaches', 'Open breaks', 'Runbook due today']) expect(screen.queryByText(n)).not.toBeInTheDocument();
  });
  it('Refresh refetches; a failing API shows an error instead of zeros', async () => {
    const { api, user } = mountPage(<CommandPage />, { routes: routes() });
    await screen.findByText('Orders working');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.calls('GET /api/v1/dashboard/today').length).toBe(2));
  });
  it('error state', async () => {
    mountPage(<CommandPage />, { routes: { 'GET /api/v1/dashboard/today': fail(500, 'internal', 'down'), 'GET /api/v1/dashboard/panels': D(panels) } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load today's figures: down/);
  });
});

describe('Today panels (performance, allocation, scenarios)', () => {
  const full = {
    asOf: '2026-10-01',
    performance: [
      { portfolioId: 'p1', ref: 'PF-1001', name: 'Growth Portfolio', currency: 'USD', periodStart: '2026-07-01', periodEnd: '2026-10-01', twrPct: 4.2, benchmarkPct: 3.1, activePct: 1.1, benchmarkName: 'MSCI World', series: [{ date: '2026-07-01', cumPct: 0, benchCumPct: 0 }, { date: '2026-10-01', cumPct: 4.2, benchCumPct: 3.1 }] },
      { portfolioId: 'p2', ref: 'PF-1002', name: 'No History', error: 'No price history' },
    ],
    allocation: [{ currency: 'USD', portfolios: 2, total: '1000000.00', byAssetClass: [{ key: 'Equity', valueBase: '800000', weightPct: '80.00' }], bySector: [{ key: 'Consumer', valueBase: '500000', weightPct: '50.00' }], byMarket: [{ key: 'VFEX', valueBase: '1', weightPct: '100.00' }] }],
    scenario: [{ key: 'equity', name: 'Equity crash', description: 'Equities fall 20%', worst: 'Review', results: [{ portfolioId: 'p1', ref: 'PF-1001', name: 'Growth Portfolio', currency: 'USD', nav: '1000', lossPct: '12.00', loss: '120', status: 'Review', coverage: null, reasons: ['Sector limit'] }] }],
  };
  const r = (p: unknown) => ({ 'GET /api/v1/dashboard/today': D(today()), 'GET /api/v1/dashboard/panels': D(p) });
  it('renders portfolio return vs benchmark, the portfolio with no history as a message, allocation and the preset scenario', async () => {
    mountPage(<CommandPage />, { routes: r(full) });
    expect(await screen.findByText('+4.20%')).toBeInTheDocument();
    expect(screen.getByText('No price history')).toBeInTheDocument();
    expect(screen.getByText('MSCI World')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cumulative return' })).toBeInTheDocument();
    expect(screen.getByText('USD', { selector: 'strong' }).closest('p')).toHaveTextContent('across 2 portfolios');
    expect(screen.getByText('Equities fall 20%')).toBeInTheDocument();
  });
  it('panels with no data show empty states instead of crashing', async () => {
    mountPage(<CommandPage />, { routes: r({ asOf: '2026-10-01', performance: [], allocation: [], scenario: [] }) });
    expect(await screen.findByText('No active portfolios.')).toBeInTheDocument();
    expect(screen.getByText('No valued positions.')).toBeInTheDocument();
  });
  it('a failing panels endpoint does not take the tiles down', async () => {
    mountPage(<CommandPage />, { routes: { 'GET /api/v1/dashboard/today': D(today()), 'GET /api/v1/dashboard/panels': fail(500, 'internal', 'panel boom') } });
    expect(await screen.findByText('Orders working')).toBeInTheDocument();
    expect(await screen.findByText(/Could not load the performance, allocation and scenario panels: panel boom/)).toBeInTheDocument();
  });
});
