import { describe, it, expect } from 'vitest';
import PortfoliosPage from '@/app/(ops)/ops/portfolios/page';
import PortfolioPage from '@/app/(ops)/ops/portfolios/[id]/page';
import RiskPage from '@/app/(ops)/ops/risk/page';
import { expectBody, expectCalled, expectIdempotencyKey, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, PF, created, mountPage, without } from './_kit';

describe('Portfolios list', () => {
  const pf = { ...PF, mandate: { maxSingleNamePct: 15 }, warnings: 2, stalePrices: 3 };
  it('shows market value, unvalued and stale-price counts (ADA-008) and the mandate limit wording with an over-limit flag (ADA-007)', async () => {
    mountPage(<PortfoliosPage />, { routes: { 'GET /api/v1/portfolios': D([pf]) } });
    expect(await screen.findByText('Growth Portfolio')).toBeInTheDocument();
    expect(screen.getByText('2 unvalued')).toBeInTheDocument();
    expect(screen.getByText('3 stale prices')).toBeInTheDocument();
    expect(screen.getByText(/75.3% of 15% mandate limit \(over\)/)).toBeInTheDocument();
  });
  it('search and filters re-query the API', async () => {
    const { api, user } = mountPage(<PortfoliosPage />, { routes: { 'GET /api/v1/portfolios': D([pf]) } });
    await screen.findByText('Growth Portfolio');
    await user.type(screen.getByPlaceholderText(/Search name/), 'growth');
    await waitFor(() => expect(api.calls('GET /api/v1/portfolios').at(-1)!.query.get('q')).toBe('growth'));
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'ZWG');
    await waitFor(() => expect(api.calls('GET /api/v1/portfolios').at(-1)!.query.get('currency')).toBe('ZWG'));
  });
  it('empty state', async () => {
    mountPage(<PortfoliosPage />, { routes: { 'GET /api/v1/portfolios': D([]) } });
    expect(await screen.findByText('No portfolios match.')).toBeInTheDocument();
  });
  it('New portfolio posts name, upper-cased currency and only the limits typed; opens the new portfolio', async () => {
    const snap = { portfolio: { id: 'pf-9' } };
    const { api, user } = mountPage(<PortfoliosPage />, { routes: { 'GET /api/v1/portfolios': D([pf]), 'POST /api/v1/portfolios': created(snap) } });
    await user.click(await screen.findByRole('button', { name: 'New portfolio' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Name'), 'Income Fund');
    await user.clear(within(d).getByLabelText('Base currency'));
    await user.type(within(d).getByLabelText('Base currency'), 'zwg');
    await user.type(within(d).getByLabelText('Max single name %'), '12.5');
    await user.click(within(d).getByRole('button', { name: 'Create portfolio' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolios'));
    expectBody(req, { name: 'Income Fund', baseCurrency: 'ZWG', mandate: { maxSingleNamePct: 12.5 } });
    expect((req.body as { mandate: object }).mandate).not.toHaveProperty('maxSectorPct');
    expectIdempotencyKey(req);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/portfolios/pf-9'));
  });
  it('New portfolio is hidden without portfolio.manage', async () => {
    mountPage(<PortfoliosPage />, { perms: without('portfolio.manage'), routes: { 'GET /api/v1/portfolios': D([pf]) } });
    await screen.findByText('Growth Portfolio');
    expect(screen.queryByRole('button', { name: 'New portfolio' })).not.toBeInTheDocument();
  });
});

const snapshot = (over: Record<string, unknown> = {}) => ({
  portfolio: { ...PF, mandate: { maxSingleNamePct: 15, restrictedTickers: ['ECO.ZW'] } }, asOf: '2026-10-01', baseCurrency: 'USD',
  lines: [{ positionId: 'p1', securityId: 's1', ticker: 'DLTA', name: 'Delta Corporation', market: 'VFEX', assetClass: 'Equity', sector: 'Consumer', currency: 'USD', quantity: '1000', avgCost: '1.00', price: '1.25', priceDate: '2026-10-01', marketValue: '1250.00', marketValueBase: '1250.00', unrealisedPnlBase: '250.00', weightPct: '75.30' }],
  cash: [{ currency: 'USD', available: '1834560.00', asOf: '2026-10-01', availableBase: '1834560.00' }],
  totals: { securitiesValueBase: '19801207.69', cashBase: '1834560.00', totalValueBase: '21635767.69', cashPct: '8.48', positionCount: 12 },
  concentration: { largestPositionTicker: 'DLTA', largestPositionPct: '75.30', top5Pct: '90.00', bySector: [{ key: 'Consumer', valueBase: '1', weightPct: '75.30' }], byMarket: [], byAssetClass: [] },
  warnings: [], staleWarnings: ['DLTA price is 27 business days old'], ...over,
});

describe('Portfolio detail', () => {
  const routes = (s = snapshot(), extra = {}) => ({ 'GET /api/v1/portfolios/pf-1': D(s), 'GET /api/v1/portfolios/pf-1/evidence': D([]), 'GET /api/v1/risk/portfolios/pf-1/limits': D({ evaluations: [{ limitId: 'l1', ref: 'LIM-1001', metric: 'SINGLE_NAME_PCT', scopeType: 'FIRM', threshold: '15', value: '75.3', state: 'BREACH', detail: 'over' }] }), ...extra });
  it('ADA-007: shows the firm/portfolio risk limits card with the breach state (needs risk.view)', async () => {
    mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, routes: routes() });
    expect(await screen.findByText('Risk limits (firm and portfolio)')).toBeInTheDocument();
    expect(screen.getByText('LIM-1001')).toBeInTheDocument();
    expect(screen.getByText('Firm-wide')).toBeInTheDocument();
    expect(within(screen.getByText('LIM-1001').closest('tr')!).getByText('breach')).toBeInTheDocument();
  });
  it('ADA-007: without risk.view the card is absent and the limits endpoint is never called', async () => {
    const { api } = mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, perms: without('risk.view'), routes: routes() });
    await screen.findByText('Growth Portfolio');
    expect(api.calls('GET /api/v1/risk/portfolios/pf-1/limits')).toHaveLength(0);
    expect(screen.queryByText('Risk limits (firm and portfolio)')).not.toBeInTheDocument();
  });
  it('ADA-008: stale price warning is shown while the position is still valued', async () => {
    mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, routes: routes() });
    expect(await screen.findByText(/Stale prices \(still valued\): DLTA price is 27 business days old/)).toBeInTheDocument();
  });
  it('shows the mandate limit rows, restricted tickers and positions', async () => {
    mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, routes: routes() });
    expect(await screen.findByText('Max single name')).toBeInTheDocument();
    expect(screen.getByText(/Restricted: ECO.ZW/)).toBeInTheDocument();
    expect(screen.getByText('Delta Corporation')).toBeInTheDocument();
    expect(screen.getByText('USD cash')).toBeInTheDocument();
  });
  it('Edit mandate limits patches with the version, nulls blank limits and upper-cases tickers', async () => {
    const { api, user } = mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, routes: routes(snapshot(), { 'PATCH /api/v1/portfolios/pf-1': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Edit mandate limits' }));
    const d = await screen.findByRole('dialog');
    await user.clear(within(d).getByLabelText(/Max single name/));
    await user.type(within(d).getByLabelText(/Max single name/), '20');
    await user.clear(within(d).getByLabelText(/Restricted tickers/));
    await user.type(within(d).getByLabelText(/Restricted tickers/), 'dlta.zw, eco.zw');
    await user.click(within(d).getByRole('button', { name: 'Save limits' }));
    const [req] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/portfolios/pf-1'));
    expectBody(req, { version: 1, mandate: { maxSingleNamePct: 20, maxSectorPct: null, restrictedTickers: ['DLTA.ZW', 'ECO.ZW'] } });
  });
  it('version conflict on edit is surfaced', async () => {
    const { user } = mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, routes: routes(snapshot(), { 'PATCH /api/v1/portfolios/pf-1': fail(409, 'version_conflict', 'Changed by someone else') }) });
    await user.click(await screen.findByRole('button', { name: 'Edit mandate limits' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Changed by someone else');
  });
  it('404 shows not found', async () => {
    mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, routes: { 'GET /api/v1/portfolios/pf-1': fail(404, 'not_found', 'x') } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
  });
});

const limit = (over: Record<string, unknown> = {}) => ({ id: 'l1', ref: 'LIM-1001', metric: 'SINGLE_NAME_PCT', scopeType: 'FIRM', scopeId: null, scopeName: null, scopeRef: null, threshold: '15.0000', breachAction: 'ALERT', description: 'Firm single name cap', ownerUserId: 'u9', ownerName: 'Olive Owner', status: 'PENDING_APPROVAL', makerId: 'usr_admin', makerName: 'Test Admin', checkerId: null, checkerName: null, approvedAt: null, version: 2, ...over });
const rbase = (limits: unknown[] = [limit()]) => ({
  'GET /api/v1/risk/limits': D(limits), 'GET /api/v1/risk/users': D([{ id: 'usr_admin', name: 'Test Admin', email: 'a@x' }]), 'GET /api/v1/portfolios': D([PF]),
  'GET /api/v1/risk/breaches': D([{ id: 'b1', limitId: 'l1', limitRef: 'LIM-1001', metric: 'SINGLE_NAME_PCT', portfolioId: PF.id, portfolioRef: PF.ref, portfolioName: PF.name, detectedOn: '2026-10-01', value: '75.30', threshold: '15.00', status: 'OPEN', caseId: null, caseRef: null, caseStatus: null, ackByName: null, ackAt: null, ackNote: null }]),
  'GET /api/v1/risk/cases': D([{ id: 'c1', ref: 'CASE-001', type: 'LIMIT_BREACH', description: 'Breach', severity: 'HIGH', status: 'OPEN', ownerUserId: null, ownerName: null, portfolioId: PF.id, portfolioName: PF.name, sourceBreachId: 'b1', resolutionNote: null, createdAt: '2026-10-01T00:00:00Z', version: 1 }]),
  'GET /api/v1/risk/scenarios': D([], { presets: [{ key: 'equity', name: 'Equity crash', description: '-20% equities', shocks: { equityPct: -20, fxPct: 0, ratePctPoints: 0, durationYears: 0, redemptionPct: 0 } }] }),
  'GET /api/v1/risk/runs': D([]),
});

describe('Risk and compliance', () => {
  it('without risk.view/manage shows the refusal', async () => {
    mountPage(<RiskPage />, { perms: without('risk.view', 'risk.manage'), routes: rbase() });
    expect(await screen.findByText(/does not include risk and compliance/)).toBeInTheDocument();
  });
  it('limits tab: SoD, the maker cannot approve their own limit (disabled with reason) and sees "Awaiting another approver"', async () => {
    mountPage(<RiskPage />, { routes: rbase() });
    expect(await screen.findByText('LIM-1001')).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('title', 'You created this limit; a different person must approve it');
    expect(screen.getByText('Awaiting another approver')).toBeInTheDocument();
    expect(screen.getByText('max 15.00%')).toBeInTheDocument();
  });
  it('limits tab: a checker (not the maker) approves via POST /approve', async () => {
    const { api, user } = mountPage(<RiskPage />, { routes: { ...rbase([limit({ makerId: 'someone' , makerName: 'Maya' })]), 'POST /api/v1/risk/limits/l1/approve': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/risk/limits/l1/approve'));
  });
  it('limits tab read-only without risk.manage (no Add limit, no row actions)', async () => {
    mountPage(<RiskPage />, { perms: ['risk.view'], routes: rbase() });
    await screen.findByText('LIM-1001');
    expect(screen.queryByRole('button', { name: 'Add limit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run monitor' })).not.toBeInTheDocument();
  });
  it('Add limit posts a firm-wide draft with a key', async () => {
    const { api, user } = mountPage(<RiskPage />, { routes: { ...rbase(), 'POST /api/v1/risk/limits': created({}) } });
    await user.click(await screen.findByRole('button', { name: 'Add limit' }));
    const d = await screen.findByRole('dialog');
    await user.selectOptions(within(d).getByLabelText('Applies to'), 'FIRM');
    await user.type(within(d).getByLabelText('Threshold (%)'), '12.5');
    await user.click(within(d).getByRole('button', { name: 'Create draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/risk/limits'));
    expectBody(req, { metric: 'SINGLE_NAME_PCT', scopeType: 'FIRM', threshold: 12.5, breachAction: 'ALERT' });
    expectIdempotencyKey(req);
  });
  it('ADA-009: Run monitor posts with a key and the summary banner lists new breaches and already-recorded ones', async () => {
    const summary = { detectedOn: '2026-10-01', portfoliosChecked: 4, limitsEvaluated: 12, newBreaches: [{ caseRef: 'CASE-9', limitRef: 'LIM-1001', portfolioRef: 'PF-1005', severity: 'HIGH' }], alreadyRecorded: 1, warnings: 0 };
    const { api, user } = mountPage(<RiskPage />, { routes: { ...rbase(), 'POST /api/v1/risk/monitor': D(summary) } });
    await user.click(await screen.findByRole('button', { name: 'Run monitor' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/risk/monitor'));
    expectIdempotencyKey(req);
    expect(await screen.findByText(/12 limit checks across 4 portfolios/)).toBeInTheDocument();
    expect(screen.getByText(/LIM-1001 on PF-1005 \(case CASE-9, high\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 already recorded today/)).toBeInTheDocument();
  });
  it('breaches tab: acknowledge posts the note; open case posts the breach id', async () => {
    const { api, user } = mountPage(<RiskPage />, { routes: { ...rbase(), 'POST /api/v1/risk/breaches/b1/acknowledge': D({}), 'POST /api/v1/risk/cases': created({}) } });
    await user.click(await screen.findByRole('tab', { name: 'Breaches' }));
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    let d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Note/), 'Seen');
    await user.click(within(d).getByRole('button', { name: 'Acknowledge' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/risk/breaches/b1/acknowledge')))[0], { note: 'Seen' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Open case' }));
    d = await screen.findByRole('dialog');
    await user.click(within(d).getByRole('button', { name: 'Open case' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/risk/cases'));
    expectBody(req, { type: 'LIMIT_BREACH', severity: 'MEDIUM', sourceBreachId: 'b1' });
  });
  it('breaches empty state points to Run monitor', async () => {
    mountPage(<RiskPage />, { routes: { ...rbase(), 'GET /api/v1/risk/breaches': D([]) } });
    await (await import('@testing-library/user-event')).default.setup().click(await screen.findByRole('tab', { name: 'Breaches' }));
    expect(await screen.findByText(/No breaches recorded/)).toBeInTheDocument();
  });
  it('cases tab lists cases and starts an investigation', async () => {
    const { api, user } = mountPage(<RiskPage />, { routes: { ...rbase(), 'POST /api/v1/risk/cases/c1/transition': D({}) } });
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    expect(await screen.findByText('CASE-001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start investigation' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/risk/cases/c1/transition')))[0], { status: 'INVESTIGATING' });
  });
  it('scenarios tab: preview needs a portfolio, posts shocks, and shows the post-shock result', async () => {
    const result = { asOf: '2026-10-01', baseCurrency: 'USD', shocks: { equityPct: -20, fxPct: 0, ratePctPoints: 0, durationYears: 0, redemptionPct: 0 }, nav: '1000.00', postShockValue: '800.00', loss: '200.00', lossPct: '20.00', impacts: { equity: '-200', rate: '0', fx: '0' }, notes: [], liquidity: { liquidAssets: '500', redemptionAmount: '0', coverage: null, status: 'Within' }, limitChecks: [], status: 'Review', reasons: [], warnings: [] };
    const { api, user } = mountPage(<RiskPage />, { routes: { ...rbase(), 'POST /api/v1/risk/scenarios/preview': D({ results: result }) } });
    await user.click(await screen.findByRole('tab', { name: 'Scenarios' }));
    const preview = await screen.findByRole('button', { name: 'Run (do not save)' });
    expect(preview).toBeDisabled();
    await screen.findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(screen.getByLabelText('Portfolio'), PF.id);
    await user.click(preview);
    expect(await screen.findByText('NAV AFTER SHOCK')).toBeInTheDocument();
    expectBody(expectCalled(api, 'POST /api/v1/risk/scenarios/preview')[0], { portfolioId: PF.id });
  });
});

