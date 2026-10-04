import { describe, it, expect } from 'vitest';
import IborPage from '@/app/(ops)/ops/ibor/page';
import PositionPage from '@/app/(ops)/ops/ibor/position/page';
import { qty, qtyFine, signed, money2, ageText } from '@/ops/ibor';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, router, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const pos = (over: Record<string, unknown> = {}) => ({
  portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', securityId: 's1', ticker: 'ABC', name: 'ABC Holdings',
  market: 'ZSE', assetClass: 'Equity', sector: 'Banks', currency: 'ZWG', baseCurrency: 'USD', quantity: '12000', settled: '10000', unsettled: '2000',
  unsettledBuys: '2000', unsettledSells: '0', openSellRemaining: '0', price: '1.5', priceSource: 'VENDOR', marketValueLocal: '18000', marketValueBase: '1234.5',
  costBase: '1000', avgCost: '0.9', accrued: null, available: '9000', restricted: false, lotCount: 2, lotQuantity: '12000', drift: '0', state: 'Current', reasons: [], ...over,
});
const overview = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-08-26T00:00:00Z',
  kpis: { currency: 'USD', marketValueBase: '5500000.5', positions: 14, portfolios: 3, availableCash: '120000', unsettledBuys: '4500', unsettledBuyCount: 2, accruedIncome: '300', exceptions: 3, materialExceptions: 1 },
  control: { bookState: 'Review', lastEvent: { ref: 'IEV-0001', type: 'FILL', summary: 's', at: '2026-08-26T10:00:00Z' }, lastRefresh: null, refreshAgeSeconds: null },
  health: { items: [{ key: 'a', title: 'Holdings recon', ok: false, detail: 'No run' }, { key: 'b', title: 'Lots tie out', ok: true, detail: 'Fine' }], openBreaks: 1, latestRun: null },
  ...over,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/portfolios': ok([{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }, { id: 'p2', ref: 'PF-2', name: 'Zim Equity' }]),
  'GET /api/v1/ibor/overview': ok(overview()),
  'GET /api/v1/ibor/ledger': raw({ data: [pos(), pos({ securityId: 's2', ticker: 'XYZ', name: 'XYZ Ltd', state: 'Review', reasons: ['Drift of 5'], restricted: true })], total: 2, asOf: '2026-08-26' }),
  'GET /api/v1/ibor/settlement-ladder': ok({ asOf: '2026-08-26', buckets: [{ bucket: 'T+1', flows: [{ currency: 'USD', netCash: '-4500', buys: 2, sells: 0 }] }, { bucket: 'T+2', flows: [] }], items: [{ fillId: 'f1', orderId: 'o1', orderRef: 'ORD-1001', portfolioId: 'p1', portfolioName: 'B', ticker: 'ABC', side: 'BUY', quantity: '100', price: '1', currency: 'USD', netCash: '-4500', executedOn: null, settlesOn: '2026-08-27', bucket: 'T+1' }] }),
  'GET /api/v1/ibor/events': raw({ data: [{ id: 'e1', ref: 'IEV-0001', type: 'FILL', portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', securityId: 's1', ticker: 'ABC', quantityDelta: '100', price: '1', effectiveDate: '2026-08-26', sourceType: 'FILL', summary: 'Fill booked', detail: null, createdAt: '2026-08-26T10:00:00Z' }], total: 1 }),
  ...o,
});

describe('IBOR page', () => {
  it('renders overview tiles with currency, ledger rows with real fields (not raw ids) and unsettled ladder', async () => {
    await mountPage(<IborPage />, { routes: base() });
    expect(await screen.findByText('USD 5,500,000.50')).toBeInTheDocument();
    expect(screen.getByText('Unsettled buys').nextSibling).toHaveTextContent('USD 4,500.00');
    expect(await screen.findByText('ABC Holdings')).toBeInTheDocument();
    const row = screen.getByText('XYZ Ltd').closest('tr')!;
    expect(within(row).getByText('Review')).toHaveAttribute('title', 'Drift of 5');
    expect(within(row).getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByText('p1')).not.toBeInTheDocument();
    expect(screen.getByText('1–2 of 2 position(s)')).toBeInTheDocument();
    expect(await screen.findByText('Nothing settling')).toBeInTheDocument();
    expect(screen.getByText('2 buy / 0 sell')).toBeInTheDocument();
  });
  it('ADB-002: Book state tile names failing checks with a "need attention" framing; exceptions tile adds failing checks', async () => {
    await mountPage(<IborPage />, { routes: base() });
    expect(await screen.findByText('1 check(s) need attention: Holdings recon')).toBeInTheDocument();
    expect(screen.getByText(/plus 1 failing book check\(s\)/)).toBeInTheDocument();
  });
  it('ADB-002: all passing says controls are clear', async () => {
    await mountPage(<IborPage />, { routes: base({ 'GET /api/v1/ibor/overview': ok(overview({ health: { items: [{ key: 'a', title: 'T', ok: true, detail: '' }], openBreaks: 0, latestRun: null }, control: { bookState: 'Current', lastEvent: null, lastRefresh: null, refreshAgeSeconds: null } })) }) });
    expect(await screen.findByText('All controls clear')).toBeInTheDocument();
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });
  it('ADB-003: tile shows reporting currency; missing FX turns it into an incomplete warning', async () => {
    await mountPage(<IborPage />, {
      routes: base({ 'GET /api/v1/ibor/overview': ok(overview({ kpis: { ...overview().kpis, fxMissing: ['ZWG/USD'] } })) }),
    });
    expect(await screen.findByText('Incomplete: no FX rate for ZWG/USD; those amounts are excluded')).toBeInTheDocument();
  });
  it('ADB-003: single base scope tile (ZWG) reads in that currency', async () => {
    await mountPage(<IborPage />, { routes: base({ 'GET /api/v1/ibor/overview': ok(overview({ kpis: { ...overview().kpis, currency: 'ZWG' } })) }) });
    expect(await screen.findByText('ZWG 5,500,000.50')).toBeInTheDocument();
    expect(screen.getByText('Every position converted to ZWG')).toBeInTheDocument();
  });
  it('ADB-001: Refresh and Reconcile buttons are present but disabled with the permission named, for a user without them', async () => {
    const { api } = await mountPage(<IborPage />, { perms: ['portfolio.view'], routes: base() });
    const refresh = await screen.findByRole('button', { name: 'Refresh IBOR' });
    const rec = screen.getByRole('button', { name: 'Reconcile positions' });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('title', 'Needs the portfolio.manage permission');
    expect(rec).toBeDisabled();
    expect(rec).toHaveAttribute('title', 'Needs the recon.manage permission');
    expect(screen.getByText('Refresh IBOR needs portfolio.manage')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/ibor/refresh');
  });
  it('ADB-001: Reconcile is disabled with "Pick a portfolio first" until a portfolio is chosen, then posts portfolioId with an idempotency key', async () => {
    const { user, api } = await mountPage(<IborPage />, {
      routes: base({ 'POST /api/v1/ibor/reconcile': ok({ run: { ref: 'REC-0007', status: 'BREAKS_FOUND', breaks: 2 } }) }),
    });
    const rec = await screen.findByRole('button', { name: 'Reconcile positions' });
    expect(rec).toBeDisabled();
    expect(rec).toHaveAttribute('title', 'Pick a portfolio first');
    await user.selectOptions(screen.getByLabelText('Portfolio'), 'p1');
    await waitFor(() => expect(rec).toBeEnabled());
    expect(rec).toHaveAttribute('title', 'Runs the holdings reconciliation for this portfolio');
    await user.click(rec);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ibor/reconcile'));
    expectBody(req!, { portfolioId: 'p1' });
    expectIdempotencyKey(req!);
    expect(await screen.findByText('Holdings reconciliation REC-0007: breaks found, 2 break(s).')).toBeInTheDocument();
    // portfolio filter was sent to the data endpoints
    expect(api.calls('GET /api/v1/ibor/ledger').some((r) => r.query.get('portfolioId') === 'p1')).toBe(true);
  });
  it('FR-IBOR-004: Refresh IBOR queues a job, shows queued / running / complete, then reports counts and reloads the data', async () => {
    const result = { ref: 'IRF-0001', status: 'EXCEPTIONS', positionCount: 14, marketValueBase: '1', eventsIngested: 3, lotsOpened: 2, adjustments: 1, exceptions: [{ portfolio: 'PF-1', ticker: 'ABC', issue: 'drift 5' }] };
    const job = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'j1', status, requestedAt: '2026-08-26T10:00:00Z', startedAt: null, finishedAt: null, durationMs: null, snapshotId: null, result: null, error: null, ...extra });
    const { user, api } = await mountPage(<IborPage />, {
      routes: base({
        'POST /api/v1/ibor/refresh': ok(job('QUEUED')),
        'GET /api/v1/ibor/refresh-jobs/j1': ok(job('SUCCEEDED', { startedAt: '2026-08-26T10:00:01Z', finishedAt: '2026-08-26T10:00:02Z', durationMs: 40, snapshotId: 's1', result })),
      }),
    });
    await screen.findByText('ABC Holdings');
    const before = api.calls('GET /api/v1/ibor/ledger').length;
    await user.click(screen.getByRole('button', { name: 'Refresh IBOR' }));
    expect(await screen.findByText('Refresh: queued')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Queued…' })).toBeDisabled();
    const [req] = expectCalled(api, 'POST /api/v1/ibor/refresh');
    expect(req!.body).toEqual({ async: true });
    expectIdempotencyKey(req!);
    expect(await screen.findByText('Refresh: complete', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('IRF-0001: 3 event(s) ingested, 2 lot(s) opened, 1 adjustment(s), 1 exception(s): ABC drift 5.')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET /api/v1/ibor/ledger').length).toBeGreaterThan(before));
    expect(screen.getByRole('button', { name: 'Refresh IBOR' })).toBeEnabled();
  }, 15000);
  it('FR-IBOR-004: a failed job shows failed with the reason and does not reload', async () => {
    const { user } = await mountPage(<IborPage />, {
      routes: base({
        'POST /api/v1/ibor/refresh': ok({ id: 'j2', status: 'RUNNING', requestedAt: '2026-08-26T10:00:00Z', startedAt: '2026-08-26T10:00:01Z', finishedAt: null, durationMs: null, snapshotId: null, result: null, error: null }),
        'GET /api/v1/ibor/refresh-jobs/j2': ok({ id: 'j2', status: 'FAILED', requestedAt: '2026-08-26T10:00:00Z', startedAt: null, finishedAt: null, durationMs: null, snapshotId: null, result: null, error: 'Price feed unavailable' }),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Refresh IBOR' }));
    expect(await screen.findByText('Refresh: running')).toBeInTheDocument();
    expect(await screen.findByText('Refresh: failed', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Price feed unavailable/)).toBeInTheDocument();
  }, 15000);
  it('FR-IBOR-004: a refresh still running when the page opens is picked up', async () => {
    await mountPage(<IborPage />, {
      routes: base({ 'GET /api/v1/ibor/refresh-jobs': ok([{ id: 'j3', status: 'RUNNING', requestedAt: '2026-08-26T10:00:00Z', startedAt: '2026-08-26T10:00:01Z', finishedAt: null, durationMs: null, snapshotId: null, result: null, error: null }]) }),
    });
    expect(await screen.findByText('Refresh: running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
  });
  it('a refresh failure shows the API message and does not reload', async () => {
    const { user } = await mountPage(<IborPage />, { routes: base({ 'POST /api/v1/ibor/refresh': fail(409, 'conflict', 'A refresh is already running') }) });
    await user.click(await screen.findByRole('button', { name: 'Refresh IBOR' }));
    expect(await screen.findByText(/A refresh is already running/)).toBeInTheDocument();
  });
  it('filters send query params and reset paging; Open navigates to the position with ids', async () => {
    const { user, api } = await mountPage(<IborPage />, { routes: base() });
    await screen.findByText('ABC Holdings');
    await user.type(screen.getByPlaceholderText('Ticker, ISIN, name, portfolio'), 'abc');
    await user.selectOptions(screen.getByLabelText('Asset class'), 'Equity');
    await user.selectOptions(screen.getByLabelText('Data state'), 'Review');
    await waitFor(() => {
      const last = api.calls('GET /api/v1/ibor/ledger').at(-1)!;
      expect(last.query.get('q')).toBe('abc');
      expect(last.query.get('assetClass')).toBe('Equity');
      expect(last.query.get('state')).toBe('Review');
      expect(last.query.get('offset')).toBe('0');
      expect(last.query.get('limit')).toBe('50');
    });
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/ops\/ibor\/position\?portfolioId=p1&securityId=s1/));
  });
  it('empty ledger and events tab states; events tab lists lineage', async () => {
    const { user } = await mountPage(<IborPage />, { routes: base({ 'GET /api/v1/ibor/ledger': raw({ data: [], total: 0, asOf: '2026-08-26' }) }) });
    expect(await screen.findByText('No positions match these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Book events & lineage' }));
    expect(await screen.findByText('IEV-0001')).toBeInTheDocument();
    expect(screen.getByText('Fill booked')).toBeInTheDocument();
    expect(screen.getAllByText('Fill').length).toBeGreaterThan(0);
  });
  it('pagination: Next requests offset 50', async () => {
    const many = Array.from({ length: 50 }, (_, i) => pos({ securityId: `s${i}`, ticker: `T${i}`, name: `N${i}` }));
    const { user, api } = await mountPage(<IborPage />, { routes: base({ 'GET /api/v1/ibor/ledger': raw({ data: many, total: 120, asOf: '2026-08-26' }) }) });
    expect(await screen.findByText('1–50 of 120 position(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.calls('GET /api/v1/ibor/ledger').at(-1)!.query.get('offset')).toBe('50'));
  });
  it('without portfolio.view the screen explains and fetches nothing sensitive', async () => {
    await mountPage(<IborPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the portfolio.view permission/)).toBeInTheDocument();
  });
  it('API failure on the overview shows an error, not a blank page (and 501 shows not available)', async () => {
    await mountPage(<IborPage />, { routes: base({ 'GET /api/v1/ibor/overview': fail(500, 'internal', 'Book unavailable') }) });
    expect(await screen.findByText(/Could not load the book overview: Book unavailable/)).toBeInTheDocument();
  });
  it('the portfolioId query parameter preselects the portfolio', async () => {
    window.history.pushState({}, '', '/ops/ibor?portfolioId=p2');
    const { api } = await mountPage(<IborPage />, { routes: base() });
    await waitFor(() => expect(api.calls('GET /api/v1/ibor/settlement-ladder').some((r) => r.query.get('portfolioId') === 'p2')).toBe(true));
    window.history.pushState({}, '', '/');
  });
});

describe('IBOR helpers', () => {
  it('formatters', () => {
    expect(qty('12000')).toBe('12,000');
    expect(qtyFine('10.500000')).toBe('10.5');
    expect(qtyFine('0.000000')).toBe('0');
    expect(qtyFine(null)).toBe('—');
    expect(signed('0')).toBe('—');
    expect(signed('100')).toBe('+100');
    expect(signed('-100')).toBe('-100');
    expect(money2('1234.567')).toBe('1,234.57');
    expect(ageText(null)).toBe('never');
    expect(ageText(30)).toBe('30s ago');
    expect(ageText(600)).toBe('10 min ago');
    expect(ageText(7200)).toBe('2 h ago');
    expect(ageText(3 * 86400)).toBe('3 d ago');
  });
});

describe('IBOR position detail', () => {
  const detail = {
    position: pos(),
    lots: [{ id: 'l1', securityId: 's1', ticker: 'ABC', name: 'ABC', openedOn: '2026-05-01', originalQty: '10000', remainingQty: '9000.5', unitCost: '0.9', costRemaining: '8100.45', currency: 'ZWG', sourceType: 'OPENING', sourceId: 'x', status: 'OPEN', closedOn: null }],
    lotSummary: { openLots: 1, openQuantity: '9000.5', averageCost: '0.9' },
    unsettledFills: [{ id: 'f1', orderRef: 'ORD-1001', side: 'BUY', status: 'FILLED', quantity: '2000', price: '1.5', executedAt: '2026-08-25T10:00:00Z' }],
    events: [], history: [{ asOf: '2026-08-26', quantity: '12000', avgCost: '0.9' }], orders: [{ id: 'o1', ref: 'ORD-1001', side: 'BUY', status: 'FILLED', quantity: '2000', filledQty: '2000' }],
    reconciliation: [{ id: 'b1', ref: 'BRK-1', label: 'Qty differs by 5', status: 'OPEN', severity: 'HIGH', difference: '5' }],
  };
  it('without ids shows guidance and makes no request', async () => {
    window.history.pushState({}, '', '/ops/ibor/position');
    const { api } = await mountPage(<PositionPage />);
    expect(await screen.findByText('Open a position from the IBOR position ledger.')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/ibor/position')).toHaveLength(0);
  });
  it('loads the position by ids, shows tiles, tabs (lots, recon, history), links to orders', async () => {
    window.history.pushState({}, '', '/ops/ibor/position?portfolioId=p1&securityId=s1&asOf=2026-08-20');
    const { user, api } = await mountPage(<PositionPage />, { routes: { 'GET /api/v1/ibor/position': ok(detail) } });
    expect(await screen.findByRole('heading', { name: /ABC/ })).toBeInTheDocument();
    const [req] = expectCalled(api, 'GET /api/v1/ibor/position');
    expect(Object.fromEntries(req!.query)).toMatchObject({ portfolioId: 'p1', securityId: 's1', asOf: '2026-08-20' });
    expect(screen.getByText('USD 1,234.50')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /IBOR & Positions/ })).toHaveAttribute('href', '/ops/ibor?portfolioId=p1');
    await user.click(screen.getByRole('tab', { name: 'Lots & settlement' }));
    expect(await screen.findByText('9,000.5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ORD-1001' })).toHaveAttribute('href', '/ops/orders/o1');
    await user.click(screen.getByRole('tab', { name: 'Reconciliation' }));
    expect(await screen.findByText('Qty differs by 5')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('No events for this position yet.')).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });
  it('404 for an unknown position shows Not found', async () => {
    window.history.pushState({}, '', '/ops/ibor/position?portfolioId=p1&securityId=zz');
    await mountPage(<PositionPage />, { routes: { 'GET /api/v1/ibor/position': fail(404, 'not_found', 'No position') } });
    expect(await screen.findByText(/Not found/)).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });
});
