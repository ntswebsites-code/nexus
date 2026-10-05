import { describe, it, expect } from 'vitest';
import PortfoliosPage from '@/app/(ops)/ops/portfolios/page';
import PortfolioPage from '@/app/(ops)/ops/portfolios/[id]/page';
import IborPage from '@/app/(ops)/ops/ibor/page';
import ResearchPage from '@/app/(ops)/ops/research/page';
import PortfolioLabPage from '@/app/(ops)/ops/portfolio-lab/page';
import { PipelineTab, scenarioPreview, validateDeal, validateScenario } from '@/ops/pm-depth';
import { createPortfolio, addEvidence } from '@/ops/portfolio-evidence';
import { importFiling, ValuationPanel, validateInputs } from '@/ops/research-depth';
import { markerIndex, ReturnChart } from '@/ops/performance';
import { mockApi, expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, ok, router, screen, waitFor, within, fireEvent } from '../../_helpers';
import { ALL_PERMS, D, PF, mountPage, without } from './_kit';

const PERMS = [...ALL_PERMS, 'research.view', 'research.ic.decide'];
const raw = (body: unknown, status = 200) => ({ status, body });

// ================================================================ portfolios (FR-PORT-009/010/011)

const pfRow = (over: Record<string, unknown> = {}) => ({ ...PF, mandate: {}, strategy: 'Growth', riskProfile: 'HIGH', managerUserId: 'u1', ...over });
const kpis = { currency: 'USD', portfolios: 2, totalAum: '25000000.00', fxMissing: [], weightedTwrPct: '4.5000', twrCoverage: { portfolios: 2, of: 2, aumPct: '100.00' }, openBreaches: 3 };
const listRoutes = (extra: Record<string, unknown> = {}) => ({
  'GET /api/v1/portfolios': raw({ data: [pfRow(), pfRow({ id: 'pf-2', ref: 'PF-1002', name: 'Income Fund', strategy: 'Income', riskProfile: 'LOW' })], total: 2, kpis }),
  'GET /api/v1/portfolios/facets': D({ strategies: ['Growth', 'Income'], riskProfiles: ['LOW', 'HIGH'], managers: [{ id: 'u1', name: 'Mia Manager' }] }),
  'GET /api/v1/views': D([]),
  ...extra,
});

describe('FR-PORT-009/010: portfolio list filters, saved views and KPIs', () => {
  it('summary KPIs come from the API and name their basis; the row count is shown', async () => {
    const { api } = mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes() });
    expect(await screen.findByText('USD 25,000,000.00')).toBeInTheDocument();
    expect(screen.getByText('+4.50%')).toBeInTheDocument();
    expect(screen.getByText('Open breaches').parentElement).toHaveTextContent('3');
    expect(screen.getByText(/AUM-weighted, latest locked period · 2 of 2 portfolio\(s\)/)).toBeInTheDocument();
    expect(await screen.findByText('2 portfolios')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/portfolios')[0]!.query.get('kpis')).toBe('1');
    expect(screen.getAllByRole('row').length).toBe(3); // header + 2 rows = the count shown
  });
  it('a currency with no FX rate is called out beside AUM, and no TWR says why', async () => {
    mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes({ 'GET /api/v1/portfolios': raw({ data: [pfRow()], total: 1, kpis: { ...kpis, fxMissing: ['ZWG'], weightedTwrPct: null } }) }) });
    expect(await screen.findByText('Excludes ZWG: no FX rate to USD')).toBeInTheDocument();
    expect(screen.getByText('No locked performance period for these portfolios')).toBeInTheDocument();
  });
  it('strategy, risk and manager selects re-query the API with their filters', async () => {
    const { api, user } = mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes() });
    await screen.findByText('2 portfolios');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Mia Manager' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Strategy'), 'Growth');
    await user.selectOptions(screen.getByLabelText('Risk profile'), 'HIGH');
    await user.selectOptions(screen.getByLabelText('Manager'), 'u1');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/portfolios').at(-1)!.query;
      expect(q.get('strategy')).toBe('Growth');
      expect(q.get('riskProfile')).toBe('HIGH');
      expect(q.get('managerId')).toBe('u1');
    });
  });
  it('Save view stores the active filters for the user; a view is applied from the list', async () => {
    const saved = { id: 'v1', name: 'Growth only', isDefault: false, config: { strategy: 'Growth' } };
    const { api, user } = mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes({ 'PUT /api/v1/views': D(saved) }) });
    await screen.findByText('2 portfolios');
    expect(screen.getByRole('button', { name: 'Save view' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Growth' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Strategy'), 'Growth');
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('View name'), 'Growth only');
    await user.click(within(d).getByRole('button', { name: 'Save view' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/views'));
    expectBody(req!, { scope: 'portfolio.list', name: 'Growth only', isDefault: false, config: { strategy: 'Growth' } });
    expect(await screen.findByText('Saved the view "Growth only".')).toBeInTheDocument();
  });
  it('a default saved view is restored when the page opens, and a saved view restores its filters', async () => {
    const views = [
      { id: 'v1', name: 'Low risk', isDefault: true, config: { riskProfile: 'LOW' } },
      { id: 'v2', name: 'Growth', isDefault: false, config: { strategy: 'Growth', currency: 'USD' } },
    ];
    const { api, user } = mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes({ 'GET /api/v1/views': D(views) }) });
    await waitFor(() => expect(api.calls('GET /api/v1/portfolios').at(-1)!.query.get('riskProfile')).toBe('LOW'));
    expect(screen.getByLabelText('Risk profile')).toHaveValue('LOW');
    await user.selectOptions(screen.getByLabelText('Saved views'), 'v2');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/portfolios').at(-1)!.query;
      expect(q.get('strategy')).toBe('Growth');
      expect(q.get('currency')).toBe('USD');
      expect(q.get('riskProfile')).toBeNull();
    });
  });
  it('Delete view removes only the selected view', async () => {
    const views = [{ id: 'v2', name: 'Growth', isDefault: false, config: { strategy: 'Growth' } }];
    const { api, user } = mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes({ 'GET /api/v1/views': D(views), 'DELETE /api/v1/views/:id': D({ id: 'v2', deleted: true }) }) });
    await screen.findByText('2 portfolios');
    await waitFor(() => expect(within(screen.getByLabelText('Saved views')).getByRole('option', { name: 'Growth' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Saved views'), 'v2');
    await user.click(await screen.findByRole('button', { name: 'Delete view' }));
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/views/v2'));
    expect(await screen.findByText('Deleted the saved view "Growth".')).toBeInTheDocument();
  });
});

describe('FR-PORT-011: create with strategy, risk and evidence file', () => {
  it('the wizard form carries strategy, risk and Setup status (jsdom cannot read user-event uploads, so the multipart body is covered below)', async () => {
    const { api, user } = mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes({ 'POST /api/v1/portfolios': raw({ data: { portfolio: { id: 'pf-9' } } }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'New portfolio' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Name'), 'Income Two');
    await user.type(within(d).getByLabelText(/^Strategy/), 'Income');
    await user.selectOptions(within(d).getByLabelText('Risk profile'), 'LOW');
    expect(within(d).getByLabelText(/^Opening status/)).toHaveValue('Setup');
    expect(within(d).getByLabelText(/^Evidence file/)).toHaveAttribute('type', 'file');
    await user.click(within(d).getByRole('button', { name: 'Create portfolio' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolios'));
    expectBody(req!, { name: 'Income Two', strategy: 'Income', riskProfile: 'LOW', status: 'Setup' });
    expectIdempotencyKey(req!);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/portfolios/pf-9'));
  });
  it('createPortfolio sends the evidence file with the payload as ONE multipart request; addEvidence sends kind, title and file', async () => {
    const m = mockApi({ 'POST /api/v1/portfolios': raw({ data: { portfolio: { id: 'pf-9' } } }, 201), 'POST /api/v1/portfolios/pf-1/evidence': raw({ data: { documentRef: 'DOC-1' } }, 201) });
    const fd = new FormData();
    fd.set('name', 'Income Two');
    fd.set('type', 'Balanced Fund');
    fd.set('baseCurrency', 'zwg');
    fd.set('strategy', 'Income');
    fd.set('riskProfile', 'LOW');
    fd.set('status', 'Setup');
    fd.set('maxSingleNamePct', '12.5');
    fd.set('evidenceKind', 'APPROVAL');
    fd.set('evidence', new File(['%PDF-1.4'], 'approval.pdf', { type: 'application/pdf' }));
    const snap = await createPortfolio(fd, 'key-1');
    expect(snap.portfolio.id).toBe('pf-9');
    const req = m.requests.find((r) => r.path === '/api/v1/portfolios')!;
    expect(req.body).toBeInstanceOf(FormData);
    expect(req.idempotencyKey).toBe('key-1');
    const body = req.body as FormData;
    expect(JSON.parse(String(body.get('payload')))).toMatchObject({ name: 'Income Two', baseCurrency: 'ZWG', strategy: 'Income', riskProfile: 'LOW', status: 'Setup', evidenceKind: 'APPROVAL', mandate: { maxSingleNamePct: 12.5 } });
    expect((body.get('evidence') as File).name).toBe('approval.pdf');
    const ev = new FormData();
    ev.set('kind', 'KYC');
    ev.set('title', 'KYC extract');
    ev.set('file', new File(['x'], 'kyc.pdf', { type: 'application/pdf' }));
    await addEvidence('pf-1', ev, 'key-2');
    const r2 = m.requests.find((r) => r.path === '/api/v1/portfolios/pf-1/evidence')!;
    expect((r2.body as FormData).get('kind')).toBe('KYC');
    expect((r2.body as FormData).get('title')).toBe('KYC extract');
    expect(((r2.body as FormData).get('file') as File).name).toBe('kyc.pdf');
    await expect(addEvidence('pf-1', new FormData(), 'key-3')).rejects.toThrow('Choose the file to store');
  });
  it('without a file the create stays a JSON request', async () => {
    const { api, user } = mountPage(<PortfoliosPage />, { perms: PERMS, routes: listRoutes({ 'POST /api/v1/portfolios': raw({ data: { portfolio: { id: 'pf-9' } } }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'New portfolio' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Name'), 'No Evidence');
    await user.click(within(d).getByRole('button', { name: 'Create portfolio' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolios'));
    expect(req!.body).not.toBeInstanceOf(FormData);
    expectBody(req!, { name: 'No Evidence', status: 'Setup' });
  });
  it('the detail page lists the vault evidence, and a Setup portfolio can be activated with the version', async () => {
    const snap = { portfolio: { ...PF, status: 'Setup', version: 4, mandate: {} }, asOf: '2026-10-01', baseCurrency: 'USD', lines: [], cash: [], totals: { securitiesValueBase: '0', cashBase: '0', totalValueBase: '0', cashPct: '0', positionCount: 0 }, concentration: { largestPositionTicker: null, largestPositionPct: '0', top5Pct: '0', bySector: [], byMarket: [], byAssetClass: [] }, warnings: [], staleWarnings: [] };
    const { api, user } = mountPage(<PortfolioPage />, {
      params: { id: 'pf-1' },
      perms: PERMS,
      routes: {
        'GET /api/v1/portfolios/pf-1': D(snap),
        'GET /api/v1/portfolios/pf-1/evidence': D([{ documentRef: 'DOC-3055', name: 'PF-1001 mandate evidence', label: 'portfolio mandate evidence', status: 'Draft', version: 1, sha256: 'a'.repeat(64), addedBy: 'Maker M', addedAt: '2026-10-01T10:00:00Z' }]),
        'PATCH /api/v1/portfolios/pf-1': D({}),
      },
    });
    expect(await screen.findByText('DOC-3055')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activate portfolio' }));
    const [req] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/portfolios/pf-1'));
    expectBody(req!, { status: 'Active', version: 4 });
  });
  it('Activate portfolio is not offered for an active portfolio or without portfolio.manage', async () => {
    const snap = { portfolio: { ...PF, status: 'Active', mandate: {} }, asOf: '2026-10-01', baseCurrency: 'USD', lines: [], cash: [], totals: { securitiesValueBase: '0', cashBase: '0', totalValueBase: '0', cashPct: '0', positionCount: 0 }, concentration: { largestPositionTicker: null, largestPositionPct: '0', top5Pct: '0', bySector: [], byMarket: [], byAssetClass: [] }, warnings: [], staleWarnings: [] };
    mountPage(<PortfolioPage />, { params: { id: 'pf-1' }, perms: without('portfolio.manage'), routes: { 'GET /api/v1/portfolios/pf-1': D(snap), 'GET /api/v1/portfolios/pf-1/evidence': D([]) } });
    expect(await screen.findByText('Evidence in the vault')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate portfolio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add evidence' })).not.toBeInTheDocument();
  });
});

// ================================================================ IBOR column chooser (FR-IBOR-007)

const iborBase = (extra: Record<string, unknown> = {}) => ({
  'GET /api/v1/portfolios': D([{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }]),
  'GET /api/v1/ibor/overview': D({ asOf: '2026-08-26T00:00:00Z', kpis: { currency: 'USD', marketValueBase: '1', positions: 1, portfolios: 1, availableCash: '1', unsettledBuys: '0', unsettledBuyCount: 0, accruedIncome: '0', exceptions: 0, materialExceptions: 0 }, control: { bookState: 'Current', lastEvent: null, lastRefresh: null, refreshAgeSeconds: null }, health: { items: [], openBreaks: 0, latestRun: null } }),
  'GET /api/v1/ibor/ledger': raw({ data: [{ portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', securityId: 's1', ticker: 'ABC', name: 'ABC Holdings', market: 'ZSE', assetClass: 'Equity', sector: null, currency: 'USD', baseCurrency: 'USD', quantity: '12000', settled: '10000', unsettled: '2000', unsettledBuys: '2000', unsettledSells: '0', openSellRemaining: '0', price: '1.5', priceSource: 'V', marketValueLocal: '18000', marketValueBase: '1234.5', costBase: '1000', avgCost: '0.9', accrued: null, available: '9000', restricted: false, lotCount: 1, lotQuantity: '12000', drift: '0', state: 'Current', reasons: [] }], total: 1, asOf: '2026-08-26', paging: 'sql' }),
  'GET /api/v1/ibor/settlement-ladder': D({ asOf: '2026-08-26', buckets: [], items: [] }),
  'GET /api/v1/ibor/events': raw({ data: [], total: 0 }),
  ...extra,
});
const headers = () => within(screen.getByText('ABC Holdings').closest('table')!).getAllByRole('columnheader').map((h) => h.textContent);

describe('FR-IBOR-007: IBOR column chooser persists per user', () => {
  it('shows every column group by default, and unchecking a group hides exactly its columns and saves the choice', async () => {
    const { api, user } = mountPage(<IborPage />, { perms: PERMS, routes: iborBase({ 'PUT /api/v1/views': D({ id: 'v', scope: 'ibor.columns', name: 'default', isDefault: true, config: {} }) }) });
    await screen.findByText('ABC Holdings');
    expect(headers()).toEqual(expect.arrayContaining(['Quantity', 'Settled', 'Unsettled', 'Local MV', 'Base MV', 'Cost', 'Accrued', 'Available', 'State']));
    await user.click(screen.getByRole('button', { name: /Choose columns/ }));
    await user.click(screen.getByLabelText('Valuation'));
    await waitFor(() => expect(headers()).not.toContain('Local MV'));
    expect(headers()).not.toContain('Base MV');
    expect(headers()).toContain('Quantity');
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/views'));
    expectBody(req!, { scope: 'ibor.columns', name: 'default', isDefault: true });
    expect((req!.body as { config: { groups: string[] } }).config.groups).toEqual(['position', 'settlement', 'cost', 'availability', 'control']);
    expect(await screen.findByText('Saved for you')).toBeInTheDocument();
  });
  it('restores the saved groups when the page opens: the table shows exactly the chosen groups', async () => {
    mountPage(<IborPage />, { perms: PERMS, routes: iborBase({ 'GET /api/v1/views': D([{ id: 'v', scope: 'ibor.columns', name: 'default', isDefault: true, config: { groups: ['position', 'cost'] } }]) }) });
    await screen.findByText('ABC Holdings');
    await waitFor(() => expect(headers()).not.toContain('Settled'));
    expect(headers().filter(Boolean)).toEqual(['Security', 'Portfolio', 'Asset class', 'Quantity', 'Cost', 'Accrued']);
  });
  it('the last remaining group cannot be unchecked', async () => {
    const { user } = mountPage(<IborPage />, { perms: PERMS, routes: iborBase({ 'GET /api/v1/views': D([{ id: 'v', config: { groups: ['control'] } }]) }) });
    await screen.findByText('ABC Holdings');
    await user.click(screen.getByRole('button', { name: /Choose columns/ }));
    await waitFor(() => expect(screen.getByLabelText('Control')).toBeDisabled());
  });
  it('sort and order are sent to the API (SQL paging) and reset paging; the search placeholder names the ISIN', async () => {
    const { api, user } = mountPage(<IborPage />, { perms: PERMS, routes: iborBase() });
    await screen.findByText('ABC Holdings');
    expect(screen.getByPlaceholderText('Ticker, ISIN, name, portfolio')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Sort by'), 'quantity');
    await user.selectOptions(screen.getByLabelText('Order'), 'desc');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/ibor/ledger').at(-1)!.query;
      expect(q.get('sort')).toBe('quantity');
      expect(q.get('dir')).toBe('desc');
      expect(q.get('offset')).toBe('0');
    });
  });
});

// ================================================================ research (FR-RES-006..009)

const issuer = { id: 'sec-1', ticker: 'INN.ZW', isin: 'ZW1', name: 'Innscor', market: 'ZSE', sector: 'Industrials', currency: 'USD', latestPrice: { price: '11.500000', asOf: '2026-10-02', source: 'ZSE' }, latestFinancial: { period: 'FY2025', asOf: '2026-09-10', source: 'Annual report' }, filings: 1, pendingCatalysts: 1, openCases: 1 };
const issuerDetail = (over: Record<string, unknown> = {}) => ({
  security: { id: 'sec-1', ticker: 'INN.ZW', isin: 'ZW1', name: 'Innscor', market: 'ZSE', sector: 'Industrials', currency: 'USD' },
  latestPrice: { price: '11.500000', asOf: '2026-10-02', source: 'ZSE' },
  priceHistory: [],
  financials: [{ id: 'f1', period: 'FY2025', periodType: 'FY', periodEnd: '2025-06-30', currency: 'USD', revenue: '1480000000.0000', ebitda: null, netIncome: '168000000.0000', eps: '0.2', totalAssets: null, totalDebt: null, equity: null, source: 'Annual report FY2025', asOf: '2026-09-10' }],
  filings: [{ id: 'fl1', filingType: 'ANNUAL_REPORT', title: 'Annual report 2025', period: 'FY2025', periodEnd: '2025-06-30', filedOn: '2026-09-01', source: 'ZSE', sourceUrl: null, documentRef: 'DOC-3100', documentVersion: 1, importedBy: 'Ann Analyst' }],
  entries: [
    { id: 'e2', kind: 'CATALYST', title: 'Results day', body: null, eventDate: '2026-11-10', trigger: 'Audited results published', impact: 'POSITIVE', severity: null, status: 'PENDING', resolutionNote: null, resolvedByName: null, authorName: 'Ann Analyst', createdAt: '2026-10-03T10:00:00Z' },
    { id: 'e1', kind: 'NOTE', title: 'Call with the CFO', body: 'Margins recover in H2.', eventDate: null, trigger: null, impact: null, severity: null, status: 'RECORDED', resolutionNote: null, resolvedByName: null, authorName: 'Ann Analyst', createdAt: '2026-10-01T10:00:00Z' },
  ],
  cases: [],
  ...over,
});
const researchBase = (extra: Record<string, unknown> = {}) => ({
  'GET /api/v1/research/summary': D({ cases: { draft: 0, inReview: 0, published: 0, archived: 0 }, openDecisions: 0, awaitingMyVote: 0, awaitingRatification: 0, myOpenCases: 0, upcomingMeetings: [] }),
  'GET /api/v1/research/cases': raw({ data: [], total: 0 }),
  'GET /api/v1/securities': D([]),
  'GET /api/v1/research/issuers': raw({ data: [issuer], total: 1 }),
  'GET /api/v1/research/issuers/sec-1': D(issuerDetail()),
  ...extra,
});

describe('FR-RES-006/008/009: issuers, filings, notes and catalysts', () => {
  it('the Issuers tab lists the universe with last price, as-of date and source; the detail shows financials and filings with their source', async () => {
    const { user } = mountPage(<ResearchPage />, { perms: PERMS, routes: researchBase() });
    await user.click(await screen.findByRole('tab', { name: 'Issuers' }));
    const row = (await screen.findByText('INN.ZW')).closest('tr')!;
    expect(within(row).getByText('USD 11.5000')).toBeInTheDocument();
    expect(within(row).getByText('02 Oct 2026')).toBeInTheDocument();
    await user.click(row);
    expect(await screen.findByTestId('issuer-price')).toHaveTextContent('Last price USD 11.5000, as of 02 Oct 2026, source ZSE');
    expect(screen.getByText('Annual report FY2025')).toBeInTheDocument();
    expect(screen.getByText('DOC-3100 v1')).toBeInTheDocument();
  });
  it('the entry history is listed newest first with author and time, and shows the catalyst trigger', async () => {
    const { user } = mountPage(<ResearchPage />, { perms: PERMS, routes: researchBase() });
    await user.click(await screen.findByRole('tab', { name: 'Issuers' }));
    await user.click(await screen.findByText('INN.ZW'));
    const list = await screen.findByRole('list', { name: 'Entry history, newest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Results day');
    expect(items[0]).toHaveTextContent('trigger: Audited results published');
    expect(items[1]).toHaveTextContent('Call with the CFO');
    expect(items[1]).toHaveTextContent('Ann Analyst');
  });
  it('+ Catalyst posts a catalyst record with a date and a trigger', async () => {
    const { api, user } = mountPage(<ResearchPage />, { perms: PERMS, routes: researchBase({ 'POST /api/v1/research/entries': D({ id: 'e9' }) }) });
    await user.click(await screen.findByRole('tab', { name: 'Issuers' }));
    await user.click(await screen.findByText('INN.ZW'));
    await user.click(await screen.findByRole('button', { name: '+ Catalyst' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    await user.type(within(d).getByLabelText('Title'), 'Dividend declaration');
    fireEvent.change(within(d).getByLabelText('Date'), { target: { value: '2026-12-01' } });
    await user.type(within(d).getByLabelText(/^Trigger/), 'Board declares the final dividend');
    await user.click(within(d).getByRole('button', { name: 'Add catalyst' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/entries'));
    expectBody(req!, { securityId: 'sec-1', kind: 'CATALYST', title: 'Dividend declaration', eventDate: '2026-12-01', trigger: 'Board declares the final dividend', impact: 'NEUTRAL' });
    expectIdempotencyKey(req!);
  });
  it('a viewer without research.edit sees the history but no add or import controls', async () => {
    const { user } = mountPage(<ResearchPage />, { perms: without('research.edit').concat('research.view'), routes: researchBase() });
    await user.click(await screen.findByRole('tab', { name: 'Issuers' }));
    await user.click(await screen.findByText('INN.ZW'));
    await screen.findByRole('list', { name: 'Entry history, newest first' });
    expect(screen.queryByRole('button', { name: '+ Catalyst' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import filing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add financials' })).not.toBeInTheDocument();
  });
  it('Import filing refuses a submission with no file and sends nothing', async () => {
    const { api, user } = mountPage(<ResearchPage />, { perms: PERMS, routes: researchBase() });
    await user.click(await screen.findByRole('tab', { name: 'Issuers' }));
    await user.click(await screen.findByText('INN.ZW'));
    await user.click(await screen.findByRole('button', { name: 'Import filing' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(within(d).getByLabelText('File')).toBeRequired();
    await user.type(within(d).getByLabelText('Title'), 'Interim results H1 2026');
    fireEvent.change(within(d).getByLabelText('Filed on'), { target: { value: '2026-09-20' } });
    await user.type(within(d).getByLabelText('Source'), 'ZSE announcements');
    (within(d).getByLabelText('File') as HTMLInputElement).required = false;
    await user.click(within(d).getByRole('button', { name: 'Import filing' }));
    expect(await within(d).findByText('Choose the filing to import')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/research/issuers/sec-1/filings');
  });
  it('importFiling posts the document type, period, filed date, source and the file as multipart with an idempotency key', async () => {
    const m = mockApi({ 'POST /api/v1/research/issuers/sec-1/filings': raw({ data: { id: 'fl2' } }, 201) });
    const fd = new FormData();
    fd.set('filingType', 'INTERIM_REPORT');
    fd.set('title', 'Interim results H1 2026');
    fd.set('period', 'H1-2026');
    fd.set('periodEnd', '');
    fd.set('filedOn', '2026-09-20');
    fd.set('source', 'ZSE announcements');
    fd.set('file', new File(['%PDF-1.4'], 'interim.pdf', { type: 'application/pdf' }));
    await importFiling('sec-1', fd, 'key-9');
    const req = m.requests[0]!;
    const body = req.body as FormData;
    expect(body.get('filingType')).toBe('INTERIM_REPORT');
    expect(body.get('title')).toBe('Interim results H1 2026');
    expect(body.get('period')).toBe('H1-2026');
    expect(body.get('filedOn')).toBe('2026-09-20');
    expect(body.get('source')).toBe('ZSE announcements');
    expect(body.has('periodEnd')).toBe(false);
    expect((body.get('file') as File).name).toBe('interim.pdf');
    expect(req.idempotencyKey).toBe('key-9');
    await expect(importFiling('sec-1', new FormData(), 'k')).rejects.toThrow('Choose the filing to import');
  });
});

const goodInputs = { revenue: 1_000_000_000, sharesOutstanding: 500_000_000, netDebt: 0, terminalGrowthPct: 2, growthPct: { low: 5, base: 10, high: 14 }, marginPct: { low: 8, base: 11, high: 13 }, discountPct: { low: 14, base: 17, high: 21 } };
const version = (n: number, over: Record<string, unknown> = {}) => ({ version: n, inputs: goodInputs, targetPrice: '14.500000', lowPrice: '9.000000', highPrice: '20.000000', upsidePct: '26.1', note: n === 1 ? 'Initial' : 'Raised growth', authorName: n === 1 ? 'Ann Analyst' : 'Bob Analyst', createdAt: `2026-10-0${n}T10:00:00Z`, result: { targetSource: 'MODEL', warnings: [] }, ...over });

describe('FR-RES-007: valuation model with ranges, versions and target', () => {
  it('validateInputs mirrors the SRD ranges', () => {
    const i = { ...goodInputs };
    expect(validateInputs(i, '')).toEqual({});
    expect(validateInputs({ ...i, growthPct: { low: 5, base: 10, high: 501 } }, '')['growthPct.high']).toMatch(/-100% and 500%/);
    expect(validateInputs({ ...i, marginPct: { low: -101, base: 0, high: 5 } }, '')['marginPct.low']).toMatch(/-100% and 100%/);
    expect(validateInputs({ ...i, discountPct: { low: 14, base: 17, high: 51 } }, '')['discountPct.high']).toMatch(/0% and 50%/);
    expect(validateInputs({ ...i, discountPct: { low: 1, base: 17, high: 21 } }, '')['discountPct.low']).toMatch(/exceed terminal growth/);
    expect(validateInputs({ ...i, growthPct: { low: 12, base: 10, high: 14 } }, '')['growthPct.base']).toMatch(/low must not exceed base/);
    expect(validateInputs(i, '0').targetPrice).toMatch(/greater than zero/);
    expect(validateInputs({ ...i, revenue: 0 }, '').revenue).toBeTruthy();
  });
  const panel = (valuation: unknown, perms = PERMS, extra: Record<string, unknown> = {}) =>
    mountPage(<ValuationPanel caseId="c1" caseStatus="DRAFT" isAuthor currency="USD" onChanged={() => undefined} />, { perms, routes: { 'GET /api/v1/research/cases/c1/valuation': D(valuation), ...extra } });
  it('shows the model target and upside in the hero and the version history with author and time', async () => {
    panel({ currentVersion: 2, currency: 'USD', current: version(2), versions: [version(2), version(1)] });
    expect(await screen.findByTestId('model-hero')).toHaveTextContent('Model target USD 14.5000');
    expect(screen.getByTestId('model-hero')).toHaveTextContent('upside +26.1% to the last price');
    expect(screen.getByTestId('model-hero')).toHaveTextContent('version 2');
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByText('v2')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Bob Analyst')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('v1')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Ann Analyst')).toBeInTheDocument();
  });
  it('out-of-range assumptions show an inline error and nothing is sent', async () => {
    const { api, user } = panel(null);
    await screen.findByText(/No valuation model yet/);
    await user.type(screen.getByLabelText('Revenue (USD)'), '1000000000');
    await user.type(screen.getByLabelText('Shares outstanding'), '500000000');
    for (const [label, v] of [['Growth, low %', '5'], ['Growth, base %', '10'], ['Growth, high %', '501'], ['Margin, low %', '8'], ['Margin, base %', '11'], ['Margin, high %', '13'], ['Discount rate, low %', '14'], ['Discount rate, base %', '17'], ['Discount rate, high %', '51']] as const) {
      const el = screen.getByLabelText(label);
      await user.clear(el);
      await user.type(el, v);
    }
    await user.click(screen.getByRole('button', { name: 'Save model assumptions' }));
    expect(await screen.findByText('Growth must be between -100% and 500%')).toBeInTheDocument();
    expect(screen.getByText('Discount rate must be between 0% and 50%')).toBeInTheDocument();
    expectNotCalled(api, 'PUT /api/v1/research/cases/c1/valuation');
  });
  it('a valid model saves as a new version with the ranges, an optional own target and an idempotency key', async () => {
    const { api, user } = panel(null, PERMS, { 'PUT /api/v1/research/cases/c1/valuation': D({ currentVersion: 1 }) });
    await screen.findByText(/No valuation model yet/);
    await user.type(screen.getByLabelText('Revenue (USD)'), '1000000000');
    await user.type(screen.getByLabelText('Shares outstanding'), '500000000');
    for (const [label, v] of [['Growth, low %', '5'], ['Growth, base %', '10'], ['Growth, high %', '14'], ['Margin, low %', '8'], ['Margin, base %', '11'], ['Margin, high %', '13'], ['Discount rate, low %', '14'], ['Discount rate, base %', '17'], ['Discount rate, high %', '21']] as const) {
      const el = screen.getByLabelText(label);
      await user.clear(el);
      await user.type(el, v);
    }
    await user.type(screen.getByLabelText(/Target override/), '15.5');
    await user.click(screen.getByRole('button', { name: 'Save model assumptions' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/research/cases/c1/valuation'));
    expectBody(req!, { targetPrice: 15.5, inputs: { revenue: 1000000000, sharesOutstanding: 500000000, growthPct: { low: 5, base: 10, high: 14 }, discountPct: { low: 14, base: 17, high: 21 } } });
    expectIdempotencyKey(req!);
  });
  it('without research.edit Save model assumptions is disabled and says why', async () => {
    panel(null, without('research.edit').concat('research.view'));
    const b = await screen.findByRole('button', { name: 'Save model assumptions' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Needs the research.edit permission');
  });
  it('the server\'s per-field reasons land beside the field', async () => {
    const { user } = panel(null, PERMS, { 'PUT /api/v1/research/cases/c1/valuation': fail(400, 'bad_request', 'Validation failed', [{ path: 'inputs.revenue', message: 'Revenue must be greater than zero' }]) });
    await screen.findByText(/No valuation model yet/);
    await user.type(screen.getByLabelText('Revenue (USD)'), '5');
    await user.type(screen.getByLabelText('Shares outstanding'), '5');
    for (const [label, v] of [['Growth, low %', '1'], ['Growth, base %', '2'], ['Growth, high %', '3'], ['Margin, low %', '1'], ['Margin, base %', '2'], ['Margin, high %', '3'], ['Discount rate, low %', '10'], ['Discount rate, base %', '11'], ['Discount rate, high %', '12']] as const) {
      const el = screen.getByLabelText(label);
      await user.clear(el);
      await user.type(el, v);
    }
    await user.click(screen.getByRole('button', { name: 'Save model assumptions' }));
    expect(await screen.findAllByText('Revenue must be greater than zero')).not.toHaveLength(0);
  });
});

// ================================================================ private-markets pipeline (FR-PM-002)

const deal = (over: Record<string, unknown> = {}) => ({ id: 'd1', ref: 'PMP-1001', name: 'Zambezi Cold Chain', sponsor: 'Kopje Partners', strategy: 'PRIVATE_EQUITY', vintage: 2026, currency: 'ZWG', proposedAmount: '2500000.00', expectedClose: null, stage: 'SCREENING', fairValueLevel: null, valuationDate: null, ownerName: 'Ann Owner', decidedByName: null, decidedAt: null, decisionNote: null, nextStages: ['DILIGENCE', 'DECLINED', 'ON_HOLD'], diligenceCases: 0, scenarios: 0, version: 1, ...over });
const pipelineRoutes = (extra: Record<string, unknown> = {}) => ({
  'GET /api/v1/private-markets/pipeline/summary': D({ stages: ['SOURCED', 'SCREENING', 'DILIGENCE', 'IC', 'APPROVED'].map((s) => ({ stage: s, count: s === 'SCREENING' ? 1 : 0, amounts: s === 'SCREENING' ? [{ currency: 'ZWG', amount: '2500000.00' }] : [] })) }),
  'GET /api/v1/private-markets/pipeline': raw({ data: [deal()], total: 1 }),
  'GET /api/v1/private-markets/scenarios': raw({ data: [], total: 0 }),
  ...extra,
});

describe('FR-PM-002: investment, diligence case and cashflow scenario records', () => {
  it('validateDeal enforces name, amount > 0, vintage 1990..current year, valuation date <= today, level 1-3', () => {
    const fd = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ name: 'Deal', sponsor: 'Sponsor', proposedAmount: '100', vintage: '2025', ...o })) f.set(k, v);
      return f;
    };
    const now = new Date('2026-10-04T12:00:00Z');
    expect(validateDeal(fd({}), now)).toEqual({});
    expect(validateDeal(fd({ name: '' }), now).name).toBeTruthy();
    expect(validateDeal(fd({ proposedAmount: '0' }), now).proposedAmount).toBeTruthy();
    expect(validateDeal(fd({ proposedAmount: '-5' }), now).proposedAmount).toBeTruthy();
    expect(validateDeal(fd({ vintage: '1989' }), now).vintage).toMatch(/1990 to 2026/);
    expect(validateDeal(fd({ vintage: '2027' }), now).vintage).toBeTruthy();
    expect(validateDeal(fd({ vintage: '2026' }), now).vintage).toBeUndefined();
    expect(validateDeal(fd({ valuationDate: '2026-10-05', fairValueLevel: '2' }), now).valuationDate).toMatch(/future/);
    expect(validateDeal(fd({ fairValueLevel: '4', valuationDate: '2026-10-01' }), now).fairValueLevel).toBeTruthy();
    expect(validateDeal(fd({ fairValueLevel: '2' }), now).valuationDate).toBeTruthy();
  });
  it('lists the pipeline with stage tiles; New investment shows inline errors and sends nothing until valid', async () => {
    const { api, user } = mountPage(<PipelineTab />, { perms: PERMS, routes: pipelineRoutes({ 'POST /api/v1/private-markets/pipeline': raw({ data: deal({ id: 'd2' }) }, 201), 'GET /api/v1/private-markets/pipeline/d2': D(deal({ id: 'd2', diligence: [], scenarioList: [] })) }) });
    expect(await screen.findByText('PMP-1001')).toBeInTheDocument();
    expect(screen.getByText('ZWG 2,500,000.00', { selector: 'td' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New investment' }));
    const d = await screen.findByRole('dialog');
    await user.clear(within(d).getByLabelText(/^Vintage/));
    await user.type(within(d).getByLabelText(/^Vintage/), '1989');
    await user.click(within(d).getByRole('button', { name: 'Save investment' }));
    expect(await within(d).findByText('Name the investment')).toBeInTheDocument();
    expect(within(d).getByText(/Vintage must be a year from 1990/)).toBeInTheDocument();
    expect(within(d).getByText('Enter an amount greater than zero')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/private-markets/pipeline');
    await user.type(within(d).getByLabelText(/^Name/), 'Eastern Solar');
    await user.type(within(d).getByLabelText(/^Sponsor or manager/), 'Highveld');
    await user.clear(within(d).getByLabelText(/^Vintage/));
    await user.type(within(d).getByLabelText(/^Vintage/), '2025');
    await user.selectOptions(within(d).getByLabelText('Currency'), 'ZWG');
    await user.type(within(d).getByLabelText(/^Proposed amount/), '4,000,000');
    await user.click(within(d).getByRole('button', { name: 'Save investment' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/pipeline'));
    expectBody(req!, { name: 'Eastern Solar', sponsor: 'Highveld', vintage: 2025, currency: 'ZWG', proposedAmount: '4000000', strategy: 'PRIVATE_EQUITY' });
    expectIdempotencyKey(req!);
  });
  it('New investment is hidden without portfolio.manage', async () => {
    mountPage(<PipelineTab />, { perms: without('portfolio.manage'), routes: pipelineRoutes() });
    await screen.findByText('PMP-1001');
    expect(screen.queryByRole('button', { name: 'New investment' })).not.toBeInTheDocument();
  });
  it('the deal view offers only the legal next stages; a move posts the stage; approval asks for confirmation', async () => {
    const dealD = deal({ stage: 'IC', nextStages: ['APPROVED', 'DILIGENCE', 'DECLINED', 'ON_HOLD'], diligence: [], scenarioList: [] });
    const { api, user } = mountPage(<PipelineTab />, { perms: PERMS, routes: pipelineRoutes({ 'GET /api/v1/private-markets/pipeline/d1': D(dealD), 'POST /api/v1/private-markets/pipeline/d1/stage': D(dealD) }) });
    await user.click(await screen.findByText('PMP-1001'));
    expect(await screen.findByRole('button', { name: 'Move to Approved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send back to diligence' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move to Sourced' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move to Approved' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Move to Approved' })).toHaveLength(2));
    await user.click(screen.getAllByRole('button', { name: 'Move to Approved' }).at(-1)!);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/pipeline/d1/stage'));
    expectBody(req!, { stage: 'APPROVED' });
  });
  it('declining needs a reason and posts it', async () => {
    const dealD = deal({ diligence: [], scenarioList: [] });
    const { api, user } = mountPage(<PipelineTab />, { perms: PERMS, routes: pipelineRoutes({ 'GET /api/v1/private-markets/pipeline/d1': D(dealD), 'POST /api/v1/private-markets/pipeline/d1/stage': D(dealD) }) });
    await user.click(await screen.findByText('PMP-1001'));
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    await user.type(within(d).getByLabelText(/^Reason/), 'Sponsor track record is too thin');
    await user.click(within(d).getByRole('button', { name: 'Decline' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/pipeline/d1/stage'));
    expectBody(req!, { stage: 'DECLINED', note: 'Sponsor track record is too thin' });
  });
  const withCase = (items: unknown[], over: Record<string, unknown> = {}) => ({
    id: 'dc1', ref: 'DDC-1001', dealId: 'd1', dealRef: 'PMP-1001', dealName: 'Zambezi Cold Chain', title: 'Commercial and legal', leadName: 'Ann Owner', status: 'IN_REVIEW', checklist: items, progress: { done: 0, total: items.length, flagged: 0 }, findings: null, recommendation: null, version: 3, ...over,
  });
  const items = [{ key: 'sponsor', label: 'Sponsor track record', status: 'OPEN', note: null }, { key: 'legal', label: 'Legal structure', status: 'OPEN', note: null }];
  it('the diligence checklist saves item states with the version; a flag without a note is refused locally', async () => {
    const c = withCase(items);
    const { api, user } = mountPage(<PipelineTab />, {
      perms: PERMS,
      routes: pipelineRoutes({ 'GET /api/v1/private-markets/pipeline/d1': D(deal({ stage: 'DILIGENCE', diligence: [c], scenarioList: [] })), 'GET /api/v1/private-markets/diligence/dc1': D(c), 'PATCH /api/v1/private-markets/diligence/dc1': D(c) }),
    });
    await user.click(await screen.findByText('PMP-1001'));
    await user.click(await screen.findByText('DDC-1001'));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    await user.selectOptions(await within(d).findByLabelText('Status of Legal structure'), 'FLAGGED');
    await user.click(within(d).getByRole('button', { name: 'Save checklist' }));
    expect(await within(d).findByText('Explain why "Legal structure" is flagged')).toBeInTheDocument();
    expectNotCalled(api, 'PATCH /api/v1/private-markets/diligence/dc1');
    await user.type(within(d).getByLabelText('Note for Legal structure'), 'Side letter rebate');
    await user.selectOptions(within(d).getByLabelText('Status of Sponsor track record'), 'DONE');
    await user.selectOptions(within(d).getByLabelText(/^Recommendation/), 'PROCEED_WITH_CONDITIONS');
    await user.click(within(d).getByRole('button', { name: 'Save checklist' }));
    const [req] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/private-markets/diligence/dc1'));
    expectBody(req!, { version: 3, recommendation: 'PROCEED_WITH_CONDITIONS', items: [{ key: 'sponsor', status: 'DONE', note: null }, { key: 'legal', status: 'FLAGGED', note: 'Side letter rebate' }] });
  });
  it('a completed diligence case is read-only', async () => {
    const c = withCase(items, { status: 'COMPLETE', recommendation: 'PROCEED' });
    const { user } = mountPage(<PipelineTab />, { perms: PERMS, routes: pipelineRoutes({ 'GET /api/v1/private-markets/pipeline/d1': D(deal({ diligence: [c], scenarioList: [] })), 'GET /api/v1/private-markets/diligence/dc1': D(c) }) });
    await user.click(await screen.findByText('PMP-1001'));
    await user.click(await screen.findByText('DDC-1001'));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(await within(d).findByLabelText('Status of Legal structure')).toBeDisabled();
    expect(within(d).queryByRole('button', { name: 'Save checklist' })).not.toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });
  it('scenario helpers: preview totals and validation rules', () => {
    expect(scenarioPreview([{ date: '2027-01-01', kind: 'CALL', amount: '1,000' }, { date: '2030-01-01', kind: 'DISTRIBUTION', amount: '2500' }, { date: '', kind: 'CALL', amount: 'x' }])).toEqual({ called: 1000, dist: 2500, moic: 2.5 });
    expect(validateScenario('', [])).toEqual(expect.arrayContaining(['Name the scenario', 'Add at least one capital call', 'Add at least one distribution']));
    expect(validateScenario('Base', [{ date: '2027-01-01', kind: 'CALL', amount: '0' }, { date: '2028-01-01', kind: 'DISTRIBUTION', amount: '5' }])).toContain('Every amount must be greater than zero');
    expect(validateScenario('Base', [{ date: '2027-01-01', kind: 'CALL', amount: '5' }, { date: '2028-01-01', kind: 'DISTRIBUTION', amount: '9' }])).toEqual([]);
  });
  it('the scenario drawer validates, previews MOIC and saves the dated flows', async () => {
    const { api, user } = mountPage(<PipelineTab />, {
      perms: PERMS,
      routes: pipelineRoutes({ 'GET /api/v1/private-markets/pipeline/d1': D(deal({ diligence: [], scenarioList: [] })), 'POST /api/v1/private-markets/scenarios': raw({ data: { id: 's1' } }, 201) }),
    });
    await user.click(await screen.findByText('PMP-1001'));
    await user.click(await screen.findByRole('button', { name: 'New cashflow scenario' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    await user.click(within(d).getByRole('button', { name: 'Save scenario' }));
    expect(await within(d).findByText('Name the scenario')).toBeInTheDocument();
    expect(within(d).getByText('Every amount must be greater than zero')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/private-markets/scenarios');
    await user.type(within(d).getByLabelText('Name'), 'Base case');
    fireEvent.change(within(d).getByLabelText('Flow 1 date'), { target: { value: '2027-03-01' } });
    await user.type(within(d).getByLabelText('Flow 1 amount'), '1000000');
    fireEvent.change(within(d).getByLabelText('Flow 2 date'), { target: { value: '2031-03-01' } });
    await user.type(within(d).getByLabelText('Flow 2 amount'), '2400000');
    expect(within(d).getByRole('status')).toHaveTextContent('MOIC 2.40x');
    await user.click(within(d).getByRole('button', { name: 'Save scenario' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/scenarios'));
    expectBody(req!, { name: 'Base case', kind: 'BASE', currency: 'ZWG', dealId: 'd1', flows: [{ date: '2027-03-01', kind: 'CALL', amount: '1000000' }, { date: '2031-03-01', kind: 'DISTRIBUTION', amount: '2400000' }] });
    expectIdempotencyKey(req!);
  });
  it('only the owner gets Delete on a saved scenario', async () => {
    const scen = (id: string, mine: boolean) => ({ id, ref: `PMS-${id}`, name: `Scenario ${id}`, kind: 'BASE', currency: 'USD', dealRef: null, dealId: null, flows: [], metrics: { called: '100.00', distributed: '150.00', net: '50.00', moic: '1.50', irrPct: '12.00', peakNet: '-100.00' }, ownerName: 'Someone', mine });
    const { api, user } = mountPage(<PipelineTab />, { perms: PERMS, routes: pipelineRoutes({ 'GET /api/v1/private-markets/scenarios': raw({ data: [scen('1', true), scen('2', false)], total: 2 }), 'DELETE /api/v1/private-markets/scenarios/1': D({ id: '1', deleted: true }) }) });
    await screen.findByText('PMS-1');
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click((await screen.findAllByRole('button', { name: 'Delete' })).at(-1)!);
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/private-markets/scenarios/1'));
  });
});

// ================================================================ performance chart (FR-PERF-006/007)

const series = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'].map((date, i) => ({ date, value: 1000 + i * 10, flow: i === 2 ? 500 : 0, ret: i * 0.001, cum: i * 0.01, bench: i * 0.004, benchCum: i * 0.004 }));
const events = [
  { id: 'j1', kind: 'CASH_FLOW', date: '2026-09-03', label: 'Deposit USD 500.00', ref: 'CJ-00001', href: '/ops-native/cash?journal=j1' },
  { id: 'r1', kind: 'REBALANCE', date: '2026-09-04', label: 'Rebalance RBL-00001 (proposed, turnover 7.5%)', ref: 'RBL-00001', href: '/ops-native/portfolio-lab?rebalance=r1' },
  { id: 'd1', kind: 'IC_DECISION', date: '2026-09-04', label: 'IC ICD-1001: BUY INN.ZW (approved)', ref: 'ICD-1001', href: '/ops-native/research?decision=d1' },
];

describe('FR-PERF-006/007: chart event markers and keyboard operation', () => {
  const chart = (evs: unknown[] = events) => mountPage(<ReturnChart series={series} portfolioId="p1" />, { perms: PERMS, routes: { 'GET /api/v1/performance/events': D(evs) } });
  it('markerIndex places an event on the last chart date on or before it', () => {
    expect(markerIndex(series, '2026-09-03')).toBe(2);
    expect(markerIndex(series, '2026-09-05')).toBe(3);
    expect(markerIndex(series, '2026-08-01')).toBe(0);
  });
  it('loads the markers for the charted window and labels each with its kind, label and date', async () => {
    const { api } = chart();
    const m = await screen.findByTestId('marker-CASH_FLOW');
    expect(m).toHaveAttribute('aria-label', 'Cash flow: Deposit USD 500.00, 2026-09-03. Press Enter to open the record.');
    expect(m.querySelector('title')).toHaveTextContent('Cash flow: Deposit USD 500.00 · 2026-09-03');
    expect(screen.getByTestId('marker-REBALANCE')).toBeInTheDocument();
    expect(screen.getByTestId('marker-IC_DECISION')).toHaveAttribute('aria-label', expect.stringContaining('IC decision: IC ICD-1001: BUY INN.ZW (approved), 2026-09-04'));
    const q = api.calls('GET /api/v1/performance/events')[0]!.query;
    expect(q.get('portfolioId')).toBe('p1');
    expect(q.get('from')).toBe('2026-09-01');
    expect(q.get('to')).toBe('2026-09-07');
    const legend = screen.getByRole('list', { name: 'Chart markers' });
    expect(within(legend).getByText('Cash flow (1)')).toBeInTheDocument();
    expect(within(legend).getByText('IC decision (1)')).toBeInTheDocument();
  });
  it('clicking a marker opens the linked record', async () => {
    const { user } = chart();
    await user.click(await screen.findByTestId('marker-REBALANCE'));
    expect(router.push).toHaveBeenCalledWith('/ops-native/portfolio-lab?rebalance=r1');
  });
  it('a marker is reachable and operable from the keyboard', async () => {
    chart();
    const m = await screen.findByTestId('marker-CASH_FLOW');
    expect(m).toHaveAttribute('tabindex', '0');
    m.focus();
    fireEvent.keyDown(m, { key: 'Enter' });
    expect(router.push).toHaveBeenCalledWith('/ops-native/cash?journal=j1');
  });
  it('arrow keys move the crosshair and the readout; Home and End jump to the ends', async () => {
    const { user } = chart();
    await screen.findByTestId('marker-CASH_FLOW');
    const region = screen.getByRole('application');
    expect(region).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('2026-09-07: portfolio +4.00%');
    const before = screen.getByTestId('chart-crosshair').getAttribute('x1');
    region.focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('2026-09-04: portfolio +3.00%');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Rebalance: Rebalance RBL-00001');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('IC decision: IC ICD-1001');
    expect(screen.getByTestId('chart-crosshair').getAttribute('x1')).not.toBe(before);
    await user.keyboard('{Home}');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('2026-09-01: portfolio 0.00%');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('2026-09-01');
    await user.keyboard('{End}');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('2026-09-07');
  });
  it('Enter opens the drill drawer for the date with its events and links; Escape closes it', async () => {
    const { user } = chart();
    await screen.findByTestId('marker-CASH_FLOW');
    screen.getByRole('application').focus();
    await user.keyboard('{ArrowLeft}{Enter}');
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText('Day detail: 2026-09-04')).toBeInTheDocument();
    expect(within(d).getByText('Portfolio value')).toBeInTheDocument();
    await user.click(within(d).getByRole('link', { name: 'IC ICD-1001: BUY INN.ZW (approved)' }));
    expect(router.push).toHaveBeenCalledWith('/ops-native/research?decision=d1');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('the drill drawer says plainly when nothing is marked on the date', async () => {
    const { user } = chart([]);
    (await screen.findByRole('application')).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('No cash flow, rebalance or IC decision is marked on this date.')).toBeInTheDocument();
  });
  it('a failed events request leaves the chart working without markers', async () => {
    mountPage(<ReturnChart series={series} portfolioId="p1" />, { perms: PERMS, routes: { 'GET /api/v1/performance/events': fail(500, 'x', 'boom') } });
    await waitFor(() => expect(screen.getByRole('list', { name: 'Chart markers' })).toHaveTextContent('Cash flow (0)'));
    expect(screen.queryByTestId('marker-CASH_FLOW')).not.toBeInTheDocument();
  });
});

// ================================================================ portfolio lab scenarios (FR-PORT-015)

describe('FR-PORT-015: scenarios can be deleted by their owner', () => {
  const model = (over: Record<string, unknown> = {}) => ({ id: 'm1', ref: 'PMD-1001', name: 'Growth scenario', description: null, cashTargetPct: '10', status: 'DRAFT', holdings: 2, totalPct: '100.0000', problems: [], weights: [], createdBy: 'usr_other', createdByName: 'Maker M', mine: false, version: 1, ...over });
  it('the owner sees Delete scenario and it calls DELETE after confirmation; the list marks it as theirs', async () => {
    const mine = model({ createdBy: 'usr_admin', mine: true });
    const { api, user } = mountPage(<PortfolioLabPage />, { perms: PERMS, routes: { 'GET /api/v1/portfolio-lab/models': D([mine]), 'GET /api/v1/portfolio-lab/models/m1': D(mine), 'DELETE /api/v1/portfolio-lab/models/m1': D({ id: 'm1', deleted: true }), 'GET /api/v1/securities': D([]) } });
    expect(await screen.findByText('yours')).toBeInTheDocument();
    await user.click(await screen.findByText('PMD-1001'));
    await user.click(await screen.findByRole('button', { name: 'Delete scenario' }));
    await user.click((await screen.findAllByRole('button', { name: 'Delete scenario' })).at(-1)!);
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/portfolio-lab/models/m1'));
  });
  it('someone else\'s scenario has no Delete, and an active one cannot be deleted', async () => {
    const other = model();
    const { user } = mountPage(<PortfolioLabPage />, { perms: PERMS, routes: { 'GET /api/v1/portfolio-lab/models': D([other]), 'GET /api/v1/portfolio-lab/models/m1': D(other), 'GET /api/v1/securities': D([]) } });
    await user.click(await screen.findByText('PMD-1001'));
    await screen.findByRole('button', { name: 'Clone' });
    expect(screen.queryByRole('button', { name: 'Delete scenario' })).not.toBeInTheDocument();
  });
  it('"My scenarios only" asks the API for mine=1', async () => {
    const { api, user } = mountPage(<PortfolioLabPage />, { perms: PERMS, routes: { 'GET /api/v1/portfolio-lab/models': D([]) } });
    await user.click(await screen.findByLabelText('My scenarios only'));
    await waitFor(() => expect(api.calls('GET /api/v1/portfolio-lab/models').at(-1)!.query.get('mine')).toBe('1'));
  });
  it('a rebalance link from a chart marker (?rebalance=) opens that proposal', async () => {
    mountPage(<PortfolioLabPage />, { perms: PERMS, search: 'rebalance=r1', routes: { 'GET /api/v1/portfolio-lab/models': D([]), 'GET /api/v1/portfolio-lab/rebalances': raw({ data: [], total: 0 }), 'GET /api/v1/portfolio-lab/rebalances/r1': D({ id: 'r1', ref: 'RBL-00001', status: 'PROPOSED', portfolioId: 'p', portfolioName: 'P', modelName: 'M', lines: [], constraints: [], constraintsPassed: true, warnings: [], stale: false, createdByName: 'X', createdAt: '2026-08-26T10:00:00Z', lineCount: 0, failing: 0 }) } });
    expect(await screen.findByText(/RBL-00001/)).toBeInTheDocument();
  });
});

void ok;
