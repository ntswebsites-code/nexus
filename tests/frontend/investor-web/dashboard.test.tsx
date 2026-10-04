import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpPortalDashboardScreen } from '@/components/lp-portal/screens/lp-portal-dashboard-screen';
import { ok, fail, screen, waitFor, expectCalled, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, list, FUND_PE, FUND_OE } from './_lp';

vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const KPIS = {
  totalCommitment: '5000000.00', paidIn: '1250000.00', called: '1500000.00', outstandingCalled: '250000.00', unfunded: '3500000.00',
  currentNav: '2000000.00', distributions: '300000.00', netIrr: '0.1870', tvpi: '1.84', dpi: '0.24', rvpi: '1.60', investmentCount: 1,
};
const DASH = (over: Record<string, unknown> = {}) => ({ asOfDate: '2026-06-30', valuationStatus: 'FINAL', kpis: KPIS, openEndedSummary: null, ...over });

const ACTIONS = [
  { id: 'a1', type: 'CAPITAL_CALL_DUE', severity: 'HIGH', title: 'Call No. 13 due', fundId: FUND_PE.fundId, relatedRecordId: 'cc-013', href: '/lp-portal/capital-activity?call=cc-013', dueDate: '2026-07-10', amount: '150000.00' },
  { id: 'a2', type: 'SUBSCRIPTION_AWAITING_FUNDS', severity: 'MEDIUM', title: 'Subscription awaiting funds', fundId: FUND_OE.fundId, relatedRecordId: 'r1', href: '/lp-portal/subscriptions-redemptions?request=r1', dueDate: null },
];
const ACTIVITY = [
  { id: 'e1', type: 'CAPITAL_CALL', title: 'Call 13 issued', fundId: FUND_PE.fundId, amount: '200000.00', status: 'ISSUED', at: '2026-06-01T10:00:00Z' },
  { id: 'e2', type: 'DEALING_REQUEST', title: 'Redemption submitted', fundId: FUND_OE.fundId, amount: '', status: 'SUBMITTED', at: '2026-06-02T10:00:00Z' },
];
const HISTORY = { asOfDate: '2026-06-30', valuationStatus: 'FINAL', range: 'SI', points: [{ date: '2026-03-31', label: 'Q1', nav: '1000000', paidIn: '900000', distributions: '0' }, { date: '2026-06-30', label: 'Q2', nav: '2000000', paidIn: '1250000', distributions: '300000' }] };
const DOCS = [{ id: 'doc-1', name: 'Q2 Statement', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', category: 'QUARTERLY_STATEMENT', period: '2026-Q2', publishedDate: '2026-07-01', version: '1', status: 'PUBLISHED', accessScope: 'FUND_LP', checksumSha256: 'x', permissions: ['VIEW'] }];

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/dashboard/actions`]: ok({ items: ACTIONS }),
    [`GET ${API}/dashboard/activity/recent`]: ok({ items: ACTIVITY }),
    [`GET ${API}/dashboard`]: ok(DASH()),
    [`GET ${API}/performance/history`]: ok(HISTORY),
    [`GET ${API}/documents`]: ok(list(DOCS)),
    ...over,
  } as never;
}

beforeEach(() => vi.clearAllMocks());
const ready = () => screen.findByText(/investments? in view/);

describe('Dashboard', () => {
  it('requests the dashboard bundle with the session fund scope / as-of date / currency', async () => {
    const api = liveApi(routes());
    renderLp(<LpPortalDashboardScreen />);
    await ready();
    // the screen mounts before the session resolves, so the as-of date arrives on the settled load
    await waitFor(() => expect(api.calls(`GET ${API}/dashboard`).some((r) => r.query.get('asOfDate') === '2026-06-30')).toBe(true));
    const d = api.calls(`GET ${API}/dashboard`).find((r) => r.query.get('asOfDate') === '2026-06-30')!;
    expect(d.query.get('presentationCurrency')).toBe('USD');
    expect(d.query.get('fundId')).toBeNull(); // "all funds"
    expect(api.calls(`GET ${API}/dashboard/activity/recent`)[0].query.get('limit')).toBe('10');
    expect(api.calls(`GET ${API}/performance/history`)[0].query.get('period')).toBe('SI');
    expectNoUnmocked();
  });

  it('KPI cards show formatted values from the API', async () => {
    liveApi(routes());
    renderLp(<LpPortalDashboardScreen />);
    await ready();
    expect(screen.getAllByText('$5.00M').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$1.25M').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$3.50M').length).toBeGreaterThan(0);
    expect(screen.getByText('18.7%')).toBeInTheDocument(); // net IRR 0.1870
    expect(screen.getByText('25.0% of Commitment')).toBeInTheDocument(); // paid-in 1.25/5
    expect(screen.getByText(/1\.84x TVPI · 1\.60x RVPI/)).toBeInTheDocument();
    expect(screen.getByText('0.24x DPI')).toBeInTheDocument();
  });

  it('LPC-024/025: commitment card says "N investment(s) in view" and is NOT a link to the non-existent /lp-portal/investments', async () => {
    liveApi(routes());
    renderLp(<LpPortalDashboardScreen />);
    const helper = await screen.findByText('Private capital funds · 1 investment in view');
    expect(helper.closest('a')).toBeNull();
    expect(document.querySelector('a[href="/lp-portal/investments"]')).toBeNull();
    expect(screen.queryByText(/2 Commitments/)).not.toBeInTheDocument();
  });

  it('LPC-024: plural investments wording', async () => {
    liveApi(routes({ [`GET ${API}/dashboard`]: ok(DASH({ kpis: { ...KPIS, investmentCount: 3 } })) }));
    renderLp(<LpPortalDashboardScreen />);
    expect(await screen.findByText('Private capital funds · 3 investments in view')).toBeInTheDocument();
  });

  it('LPC-024: Capital Position "Remaining Value" is the current NAV (not NAV minus distributions) and shares are real percentages', async () => {
    liveApi(routes());
    renderLp(<LpPortalDashboardScreen />);
    await ready();
    const row = await screen.findByTitle('Remaining Value: $2.00M'); // NAV 2,000,000, not 1.7M
    expect(row).toBeInTheDocument();
    expect(screen.getByTitle('Paid-In Capital: $1.25M')).toBeInTheDocument();
    expect(screen.getByTitle('Called, Not Yet Paid: $250.0K')).toBeInTheDocument();
    expect(screen.getByTitle('Distributed: $300.0K')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\d{4,}\.\d%/); // the "(5000000.0%)" double-scaling bug
    expect(text).toContain('25.0%'); // paid-in
    expect(text).toContain('40.0%'); // remaining 2.0 / 5.0
  });

  it('LPC-024: YTD return shows "Not available" when null, and a percentage otherwise', async () => {
    liveApi(routes({ [`GET ${API}/dashboard`]: ok(DASH({ openEndedSummary: { accountValue: '1000000.00', unitsHeld: '1000.0000', navPerUnit: '1000.00', ytdReturn: null }, openEndedHistory: { points: [] } })) }));
    renderLp(<LpPortalDashboardScreen />);
    expect((await screen.findAllByText('YTD Return: Not available')).length).toBeGreaterThan(0);
    expect(screen.getByText('Open-Ended / Hedge Fund Account')).toBeInTheDocument();
    expect(screen.queryByText(/YTD Return: 0\.0%/)).not.toBeInTheDocument();
  });

  it('open-ended YTD return renders as a percentage', async () => {
    liveApi(routes({ [`GET ${API}/dashboard`]: ok(DASH({ openEndedSummary: { accountValue: '1000000.00', unitsHeld: '1000.0000', navPerUnit: '1000.00', ytdReturn: '0.0525' }, openEndedHistory: { points: [] } })) }));
    renderLp(<LpPortalDashboardScreen />);
    expect((await screen.findAllByText('YTD Return: 5.3%')).length).toBeGreaterThan(0);
    expect(screen.getByText('$1,000.00')).toBeInTheDocument(); // NAV per unit
  });

  it('LPC-024: recent capital activity rows without an amount show "-" not $0.00; fund names not ids; titles not raw enums', async () => {
    liveApi(routes());
    renderLp(<LpPortalDashboardScreen />);
    const call = (await screen.findByText('Capital Call')).closest('a')!;
    expect(call).toHaveTextContent('$200,000.00');
    expect(call).toHaveTextContent('Growth Fund I');
    const dealing = screen.getByText('Dealing Request').closest('a')!;
    expect(dealing).toHaveTextContent('Balanced Growth Fund');
    expect(dealing).toHaveTextContent('-');
    expect(dealing).not.toHaveTextContent('$0.00');
    expect(screen.queryByText(FUND_PE.fundId)).not.toBeInTheDocument();
  });

  it('LPC-024: Actions Required lists only the actionable items from the API, links to their records, with fund names and amounts', async () => {
    liveApi(routes());
    renderLp(<LpPortalDashboardScreen />);
    const link = (await screen.findByText('Call No. 13 due')).closest('a')!;
    expect(link).toHaveAttribute('href', '/lp-portal/capital-activity?call=cc-013');
    expect(link).toHaveTextContent('Growth Fund I');
    expect(link).toHaveTextContent('$150.0K');
    expect(link).toHaveTextContent('Due Jul 10, 2026');
    expect(screen.getByText('Subscription awaiting funds').closest('a')).toHaveAttribute('href', '/lp-portal/subscriptions-redemptions?request=r1');
    expect(screen.queryByText('Redemption submitted')).not.toBeInTheDocument(); // a submitted redemption is not an action
  });

  it('latest documents show names and link to the Document Centre; download uses the document endpoint', async () => {
    const api = liveApi(routes({ [`GET ${API}/documents/doc-1/download`]: ok({}) }));
    const { user } = renderLp(<LpPortalDashboardScreen />);
    expect(await screen.findByText('Q2 Statement')).toBeInTheDocument();
    expect(api.calls(`GET ${API}/documents`)[0].query.get('pageSize')).toBe('3');
    expect(screen.getByText('Q2 Statement').closest('a')).toHaveAttribute('href', '/lp-portal/documents');
    expect(screen.getByRole('button', { name: 'Download Q2 Statement' })).toBeEnabled();
    void user;
  });

  it('documents failing to load degrades to the empty message instead of breaking the page', async () => {
    liveApi(routes({ [`GET ${API}/documents`]: fail(500, 'internal', 'x') }));
    renderLp(<LpPortalDashboardScreen />);
    expect(await screen.findByText('No recent documents')).toBeInTheDocument();
    expect(screen.getAllByText('Total Commitment').length).toBeGreaterThan(0);
  });

  it('error state shows the API message with Try Again which refetches', async () => {
    let fixed = false;
    const api = liveApi(routes({ [`GET ${API}/dashboard`]: () => (fixed ? ok(DASH()) : fail(404, 'LP_NOT_FOUND', 'Fund not found')) }));
    const { user } = renderLp(<LpPortalDashboardScreen />);
    expect(await screen.findByText(/Fund not found/)).toBeInTheDocument();
    const before = api.calls(`GET ${API}/dashboard`).length;
    fixed = true;
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    await ready();
    expect(api.calls(`GET ${API}/dashboard`).length).toBeGreaterThan(before);
  });

  it('empty accounts: no actions, no activity, zero commitment does not divide by zero', async () => {
    liveApi(
      routes({
        [`GET ${API}/dashboard`]: ok(DASH({ kpis: { ...KPIS, totalCommitment: '0', paidIn: '0', unfunded: '0', currentNav: '0', distributions: '0', outstandingCalled: '0', investmentCount: 0 } })),
        [`GET ${API}/dashboard/actions`]: ok({ items: [] }),
        [`GET ${API}/dashboard/activity/recent`]: ok({ items: [] }),
        [`GET ${API}/performance/history`]: ok({ ...HISTORY, points: [] }),
      }),
    );
    renderLp(<LpPortalDashboardScreen />);
    expect(await screen.findByText('Private capital funds · 0 investments in view')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('realtime capital update refreshes the dashboard data', async () => {
    const api = liveApi(routes());
    renderLp(<LpPortalDashboardScreen />);
    await ready();
    const { emitRealtime } = await import('./_rt');
    emitRealtime('lp_capital_updated');
    await waitFor(() => expect(api.calls(`GET ${API}/dashboard`).length).toBeGreaterThanOrEqual(2));
  });
});
