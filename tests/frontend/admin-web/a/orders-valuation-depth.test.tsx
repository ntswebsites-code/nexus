import { describe, it, expect } from 'vitest';
import NewOrderPage from '@/app/(ops)/ops/orders/new/page';
import OrderPage from '@/app/(ops)/ops/orders/[id]/page';
import NavPage from '@/app/(ops)/ops/nav/page';
import NavRunPage from '@/app/(ops)/ops/nav/[id]/page';
import RiskPage from '@/app/(ops)/ops/risk/page';
import { priceDeviationPct } from '@/ops/orders';
import { contractNoteBody } from '@/ops/order-posttrade';
import { expectBody, expectCalled, expectIdempotencyKey, screen, waitFor, within } from '../../_helpers';
import { D, PF, SEC, created, mountPage, without } from './_kit';

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 'o-1', ref: 'ORD-00001', portfolio: { id: PF.id, ref: PF.ref, name: PF.name, baseCurrency: 'USD' },
  security: { id: SEC.id, ticker: 'DLTA', name: 'Delta Corporation', market: 'VFEX', currency: 'USD', boardLot: 100, status: 'Active', sector: 'Consumer' },
  side: 'BUY', quantity: '1000', orderType: 'LIMIT', limitPrice: '1.250000', stopPrice: null, priceOverrideReason: null, tif: 'DAY', urgency: 'Normal', broker: { id: 'b-1', name: 'Imara Securities' },
  rationale: 'Add to position', currency: 'USD', decisionPrice: '1.25', notional: '1250.00', status: 'Routing', precheck: null, precheckAt: null, maker: { id: 'usr_other', name: 'Maya Maker' },
  approver: { id: 'usr_ap', name: 'Alex Approver' }, approvedAt: '2026-10-01T09:00:00Z', router: { id: 'usr_r', name: 'Rita Router' }, routedAt: '2026-10-01T09:30:00Z', filledQty: '600', remainingQty: '400', avgPrice: '1.262500',
  slippageBp: 100, reservedAmount: '500.00', estimatedFee: '1.25', cancelReason: null, rejectReason: null, submittedAt: '2026-10-01T09:00:00Z', createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T09:00:00Z', version: 5, ...over,
});

// ---------------------------------------------------------------- FR-OMS-018 / FR-OMS-019 ticket

describe('Order ticket: stop limit, price tolerance, resume draft', () => {
  const nroutes = (extra = {}) => ({
    'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/brokers': D([{ id: 'b-1', name: 'Imara Securities', email: 'dealing@imara.test', status: 'Active' }]),
    'GET /api/v1/securities': D([SEC]), 'GET /api/v1/orders': D([]), ...extra,
  });
  async function fill(user: ReturnType<typeof mountPage>['user'], qty = '100') {
    await screen.findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(screen.getByLabelText('Portfolio'), PF.id);
    await user.type(screen.getByPlaceholderText(/DLTA or Delta/), 'DLTA');
    await user.click(await screen.findByText('Delta Corporation'));
    await user.type(screen.getByLabelText(/Quantity/), qty);
  }

  it('priceDeviationPct measures the distance from the last price and ignores unusable input', () => {
    expect(priceDeviationPct('1.5', '1.25')).toBeCloseTo(20, 6);
    expect(priceDeviationPct('1.125', '1.25')).toBeCloseTo(-10, 6);
    expect(priceDeviationPct('', '1.25')).toBeNull();
    expect(priceDeviationPct('1.5', null)).toBeNull();
    expect(priceDeviationPct('abc', '1.25')).toBeNull();
  });

  it('FR-OMS-019: offers each saved draft with a Resume link, and can be dismissed', async () => {
    const drafts = [orderRow({ id: 'd-7', ref: 'ORD-00007', status: 'Draft', side: 'SELL', quantity: '300', orderType: 'STOP_LIMIT' })];
    const { api, user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'GET /api/v1/orders': D(drafts) }) });
    const link = await screen.findByRole('link', { name: 'Resume draft ORD-00007' });
    expect(link).toHaveAttribute('href', '/ops-native/orders/d-7');
    expect(screen.getByText(/Sell 300 DLTA, Stop limit/)).toBeInTheDocument();
    const q = api.calls('GET /api/v1/orders')[0]!.query;
    expect(q.get('status')).toBe('Draft,Validated');
    expect(q.get('mine')).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Start a new order instead' }));
    expect(screen.queryByRole('link', { name: 'Resume draft ORD-00007' })).not.toBeInTheDocument();
  });

  it('FR-OMS-019: no prompt when the maker has no saved drafts', async () => {
    mountPage(<NewOrderPage />, { routes: nroutes() });
    await screen.findByRole('option', { name: /Growth Portfolio/ });
    expect(screen.queryByText(/saved draft/)).not.toBeInTheDocument();
  });

  it('FR-OMS-018: a stop-limit needs a stop price on the trigger side of the limit, shown inline', async () => {
    const { api, user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'POST /api/v1/orders': created(orderRow({ id: 'o-9', status: 'Draft' })) }) });
    await fill(user);
    expect(screen.queryByLabelText(/Stop price/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Order type'), 'STOP_LIMIT');
    await user.type(screen.getByLabelText(/Limit price/), '1.25');
    const save = screen.getByRole('button', { name: 'Save as draft' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText(/Stop price/), '1.30');
    expect(screen.getByText('For a buy stop-limit the stop price must not be above the limit price')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(/Stop price/));
    await user.type(screen.getByLabelText(/Stop price/), '1.20');
    expect(save).toBeEnabled();
    await user.click(save);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/orders'));
    expectBody(req, { orderType: 'STOP_LIMIT', limitPrice: '1.25', stopPrice: '1.20', side: 'BUY' });
    expectIdempotencyKey(req);
  });

  it('FR-OMS-018: a sell stop-limit needs the stop at or above the limit', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes() });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Sell' }));
    await user.selectOptions(screen.getByLabelText('Order type'), 'STOP_LIMIT');
    await user.type(screen.getByLabelText(/Limit price/), '1.25');
    await user.type(screen.getByLabelText(/Stop price/), '1.20');
    expect(screen.getByText('For a sell stop-limit the stop price must not be below the limit price')).toBeInTheDocument();
  });

  it('FR-OMS-018: a limit more than 10% from the last price shows an inline error and asks for an override reason', async () => {
    const { api, user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'POST /api/v1/orders': created(orderRow({ id: 'o-9', status: 'Draft' })) }) });
    await fill(user);
    await user.selectOptions(screen.getByLabelText('Order type'), 'LIMIT');
    await user.type(screen.getByLabelText(/Limit price/), '1.30');
    expect(screen.queryByLabelText(/Price override reason/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeEnabled();
    await user.clear(screen.getByLabelText(/Limit price/));
    await user.type(screen.getByLabelText(/Limit price/), '1.50');
    expect(screen.getByText(/Price is 20\.00% from the last price 1\.25; more than 10% needs an override reason/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled();
    const reason = screen.getByLabelText(/Price override reason/);
    await user.type(reason, 'no');
    expect(screen.getByText(/Give a reason \(at least 5 characters\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled();
    await user.type(reason, ' - client instruction');
    expect(screen.queryByText(/Give a reason \(at least 5 characters\)/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/orders')))[0], { orderType: 'LIMIT', limitPrice: '1.50', priceOverrideReason: 'no - client instruction' });
  });

  it('FR-OMS-018: the server field errors on limitPrice and priceOverrideReason are not lost', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'POST /api/v1/orders': { status: 400, body: { success: false, code: 'bad_request', message: 'Validation failed', error: { code: 'bad_request', message: 'Validation failed', details: [{ path: 'priceOverrideReason', message: 'Give a reason for a price more than 10% from the last price' }] } } } }) });
    await fill(user);
    await user.selectOptions(screen.getByLabelText('Order type'), 'LIMIT');
    await user.type(screen.getByLabelText(/Limit price/), '1.25');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(/priceOverrideReason|Validation failed|Give a reason/);
  });
});

// ---------------------------------------------------------------- FR-OMS-011 post-trade

describe('Order post-trade: allocation, slippage, contract note', () => {
  const posttrade = (over: Record<string, unknown> = {}) => ({
    orderId: 'o-1', ref: 'ORD-00001', status: 'Routing', currency: 'USD', side: 'BUY', decisionPrice: '1.250000',
    allocation: {
      portfolio: { id: PF.id, ref: PF.ref, name: PF.name }, filledQty: '600', orderQty: '1000', sharePct: '60.00', avgPrice: '1.262500', gross: '757.50', fees: '3.00', net: '760.50',
      positionAfter: { quantity: '2600', avgCost: '1.100000', asOf: '2026-10-01' },
      fills: [
        { id: 'f1', executedAt: '2026-10-01T09:40:00.000Z', source: 'MANUAL', quantity: '400', price: '1.260000', fees: '2.00', gross: '504.00', net: '506.00', slippageBp: 80 },
        { id: 'f2', executedAt: '2026-10-01T10:05:00.000Z', source: 'CONTRACT_NOTE', quantity: '200', price: '1.267500', fees: '1.00', gross: '253.50', net: '254.50', slippageBp: 140 },
      ],
    },
    slippage: { decisionPrice: '1.250000', avgPrice: '1.262500', bp: 100, amount: '7.50', worstFillBp: 140 },
    contractNote: { status: 'PARTIAL', lines: [
      { ref: 'TFL-000001', source: 'CONTRACT_NOTE', externalRef: 'CN-77', status: 'MATCHED', breakReason: null, detail: null, quantity: '200', price: '1.267500', fees: '1.00', tradeDate: '2026-10-01', fillId: 'f2', variance: { quantity: '0', price: '0.000000', fees: '0.00' } },
      { ref: 'TFL-000002', source: 'CONTRACT_NOTE', externalRef: 'CN-78', status: 'BREAK', breakReason: 'OVERFILL', detail: 'The line fills 900 but only 400 remains on the order', quantity: '900', price: '1.270000', fees: '0.00', tradeDate: '2026-10-01', fillId: null, variance: null },
    ] },
    settlement: { settled: false, readyToSettle: false, fillsTieToOrder: true }, ...over,
  });
  const detail = (over: Record<string, unknown> = {}, allowed: string[] = ['fill']) => ({
    ...orderRow(over), cash: { holds: [], ledger: null }, decision: null, realisedGain: null, fills: [], instruction: null, timeline: [], allowed,
  });
  const r = (d: unknown, extra: Record<string, unknown> = {}) => ({ 'GET /api/v1/orders/o-1': D(d), 'GET /api/v1/brokers': D([]), 'GET /api/v1/orders/o-1/post-trade': D(posttrade()), ...extra });

  it('shows the allocation by fill, the slippage definition and the contract-note match with its breaks', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail()) });
    expect(await screen.findByText('Allocation')).toBeInTheDocument();
    expect(screen.getByText('600 of 1,000 (60.00%)')).toBeInTheDocument();
    expect(screen.getByText(/2,600 at average cost 1\.10/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Fill allocation' })).toBeInTheDocument();
    expect(screen.getByText('contract note', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getAllByText('+100.0 bp').length).toBeGreaterThan(0);
    expect(screen.getByText(/Positive means worse than the decision price/)).toBeInTheDocument();
    expect(screen.getByText('partial', { selector: '.ops-badge' })).toBeInTheDocument();
    expect(screen.getByText('The line fills 900 but only 400 remains on the order')).toBeInTheDocument();
    expect(screen.getByText('qty 0, price 0.000000, fees 0.00')).toBeInTheDocument();
  });

  it('says so when nothing is filled yet', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail(), { 'GET /api/v1/orders/o-1/post-trade': D(posttrade({ allocation: { ...posttrade().allocation, fills: [], filledQty: '0', avgPrice: null }, contractNote: { status: 'NONE', lines: [] } })) }) });
    expect(await screen.findByText('No fills to allocate yet.')).toBeInTheDocument();
    expect(screen.getByText('No contract note lines refer to this order.')).toBeInTheDocument();
  });

  it('pasted note text is sent to the contract-note endpoint as TEXT with the order broker, then the view reloads', async () => {
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail(), { 'POST /api/v1/trading-feeds/contract-notes': created({ matched: 1, breaks: 0, duplicates: 0, format: 'TEXT' }) }) });
    const read = await screen.findByRole('button', { name: 'Read and match note text' });
    expect(read).toBeDisabled();
    await user.type(screen.getByLabelText('Or paste the note text'), 'Order reference: ORD-00001{enter}Quantity: 100');
    await user.click(read);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/trading-feeds/contract-notes'));
    expectBody(req, { brokerId: 'b-1', format: 'TEXT', filename: 'contract-note.txt' });
    expect(String((req.body as { content: string }).content)).toContain('Order reference: ORD-00001');
    expectIdempotencyKey(req);
    expect(await screen.findByText('Contract note read as TEXT: 1 matched, 0 breaks.')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET /api/v1/orders/o-1/post-trade').length).toBe(2));
  });

  it('a rejected note shows the API reason and leaves the text in place', async () => {
    const { user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail(), { 'POST /api/v1/trading-feeds/contract-notes': { status: 422, body: { success: false, code: 'contract_note_rejected', message: 'No trade fields were found in the note text', error: { code: 'contract_note_rejected', message: 'No trade fields were found in the note text' } } } }) });
    await user.type(await screen.findByLabelText('Or paste the note text'), 'thank you for your business');
    await user.click(screen.getByRole('button', { name: 'Read and match note text' }));
    expect(await screen.findByText(/No trade fields were found/)).toBeInTheDocument();
    expect(screen.getByLabelText('Or paste the note text')).toHaveValue('thank you for your business');
  });

  it('the upload is hidden without orders.route, on an order that is not working, and warns when no broker is set', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, perms: without('orders.route'), routes: r(detail()) });
    await screen.findByText('Allocation');
    expect(screen.queryByText('Read a contract note')).not.toBeInTheDocument();
  });
  it('no broker on the order: asks to choose one', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ broker: null })) });
    expect(await screen.findByText(/Choose the executing broker on the order before reading a contract note/)).toBeInTheDocument();
  });
  it('a filled order shows the post-trade view without the upload', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ status: 'Filled' }, []), { 'GET /api/v1/orders/o-1/post-trade': D(posttrade({ status: 'Filled' })) }) });
    await screen.findByText('Allocation');
    expect(screen.queryByText('Read a contract note')).not.toBeInTheDocument();
  });

  it('contractNoteBody: PDF bytes travel base64, JSON and CSV keep their format, anything else is narrative text', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    const p = contractNoteBody('b-1', 'note.pdf', pdf);
    expect(p.format).toBe('PDF');
    expect(atob(p.content).startsWith('%PDF-1.4')).toBe(true);
    expect(contractNoteBody('b-1', 'x.bin', pdf).format).toBe('PDF');
    expect(contractNoteBody('b-1', 'n.json', '{"trades":[]}').format).toBe('JSON');
    expect(contractNoteBody('b-1', 'n.txt', 'trade_ref,order_ref,ticker,side,quantity,price,trade_date\nT1,ORD-1,X,BUY,1,1,2026-10-01').format).toBe('CSV');
    expect(contractNoteBody('b-1', 'n.csv', 'a,b').format).toBe('CSV');
    expect(contractNoteBody('b-1', 'n.txt', 'Order reference: ORD-1').format).toBe('TEXT');
    expect(contractNoteBody('b-1', 'n.txt', new TextEncoder().encode('Order reference: ORD-1')).format).toBe('TEXT');
  });

  it('shows the stop price and the override reason on the order', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ orderType: 'STOP_LIMIT', limitPrice: '1.500000', stopPrice: '1.400000', priceOverrideReason: 'Client instruction to pay up', status: 'Draft' }, ['edit'])) });
    expect(await screen.findByText('Stop limit')).toBeInTheDocument();
    expect(screen.getByText('1.40 USD')).toBeInTheDocument();
    expect(screen.getByText('Client instruction to pay up')).toBeInTheDocument();
    expect(screen.getByText(/stop 1\.40 limit 1\.50 USD/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- FR-VAL-009 / 015 / 017

const navRun = (over: Record<string, unknown> = {}) => ({
  id: 'n-1', ref: 'NAV-00001', portfolioId: PF.id, portfolioRef: PF.ref, portfolioName: PF.name, fundId: null, fundRef: null, fundName: null, navDate: '2026-10-01', version: 1, stage: 'DONE', status: 'RELEASED', baseCurrency: 'USD',
  marketValue: '9000000.00', cash: '558000.00', accruals: '0.00', fees: '0.00', liabilities: '0.00', feeRatePct: null, nav: '9558000.00', units: null, navPerUnit: null, priceCoverage: '100.0000', positionCount: 12,
  openExceptions: 0, openMaterialExceptions: 0, totalExceptions: 0, makerId: 'u1', makerName: 'Maya Maker', reviewerId: 'u2', reviewerName: 'Rita Reviewer', reviewedAt: '2026-10-01T09:00:00Z', checkerId: 'u3', checkerName: 'Chris Checker', releasedAt: '2026-10-01T10:00:00Z', notes: null, createdAt: '2026-10-01T08:00:00Z', updatedAt: null, ...over,
});
const navDetail = (over: Record<string, unknown> = {}, allowed: Record<string, unknown> = {}) => ({
  ...navRun(), stageBar: [{ key: 'draft', label: 'Draft', state: 'done' }], bridge: [{ key: 'nav', label: 'Net asset value', sign: 0, amount: '9558000.00' }], settings: null, lines: [], exceptions: [], versions: [{ id: 'n-1', ref: 'NAV-00001', version: 1, status: 'RELEASED' }], timeline: [],
  allowed: { recalculate: false, editInputs: false, resolve: false, makerReview: false, makerReviewBlockers: [], release: false, releaseBlocker: null, runBlocker: null, makerBlocker: null, recordExternal: true, ...allowed }, ...over,
});
const external = (over: Record<string, unknown> = {}) => ({ nav: '9552000.00', abor: '9558000.00', variance: '-6000.00', variancePct: '-0.0628', tolerance: '5000.00', state: 'Variance', source: 'Administrator statement', note: 'Month-end pack', recordedByName: 'Fiona Accountant', recordedAt: '2026-10-02T08:00:00Z', ...over });

describe('NAV: permissions, history, policy, external NAV', () => {
  const lroutes = (extra = {}) => ({ 'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/nav/runs': D([navRun()], { total: 1, summary: { byStatus: {}, awaitingRelease: 0, openExceptions: 0, released: 1 } }), ...extra });

  it('FR-VAL-009: New NAV run needs valuation.run on top of valuation.view', async () => {
    mountPage(<NavPage />, { perms: without('valuation.run'), routes: lroutes() });
    await screen.findByText('NAV-00001');
    expect(screen.queryByRole('button', { name: 'New NAV run' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NAV history' })).toBeInTheDocument();
  });

  it('FR-VAL-015: NAV history opens from the page head with prior official NAVs, re-runs, release evidence and the external state', async () => {
    const hist = [
      { ...navRun(), official: true, runsForDate: 2, movePct: '0.4000', moveBasis: 'NAV', previousNavDate: '2026-09-30', packUrl: '/api/v1/nav/runs/n-1/pack', external: external({ state: 'Agree', variance: '-100.00' }) },
      { ...navRun({ id: 'n-0', ref: 'NAV-00000', navDate: '2026-09-30', status: 'SUPERSEDED', version: 1 }), official: false, runsForDate: 1, movePct: null, moveBasis: null, previousNavDate: null, packUrl: '/api/v1/nav/runs/n-0/pack', external: null },
    ];
    const { api, user } = mountPage(<NavPage />, { routes: lroutes({ 'GET /api/v1/nav/history': D(hist) }) });
    await user.click(await screen.findByRole('button', { name: 'NAV history' }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('NAV-00001')).toBeInTheDocument();
    expect(within(dlg).getByText('1 re-run')).toBeInTheDocument();
    expect(within(dlg).getByText('+0.40%')).toBeInTheDocument();
    expect(within(dlg).getAllByText(/Maya Maker \/ Rita Reviewer \/ Chris Checker/).length).toBe(2);
    expect(within(dlg).getByText('Agree (-100.00)')).toBeInTheDocument();
    expect(within(dlg).getAllByRole('link', { name: 'Pack' })[0]).toHaveAttribute('href', '/ops-native/nav/n-1');
    expect(api.calls('GET /api/v1/nav/history')[0]!.query.get('limit')).toBe('60');
  });

  it('FR-VAL-015: NAV history with nothing released says so', async () => {
    const { user } = mountPage(<NavPage />, { routes: lroutes({ 'GET /api/v1/nav/history': D([]) }) });
    await user.click(await screen.findByRole('button', { name: 'NAV history' }));
    expect(await within(await screen.findByRole('dialog')).findByText('No NAV has been released yet.')).toBeInTheDocument();
  });

  const policy = (canEdit = true) => ({
    thresholds: [
      { field: 'staleDays', label: 'Stale price (days)', unit: 'days', help: 'A price older than this at the NAV date raises a stale-price exception.', value: 3, default: 3, custom: false },
      { field: 'externalToleranceAbs', label: 'External NAV tolerance (base currency)', unit: 'amount', help: 'External NAV agrees with ABOR within this amount.', value: 5000, default: 5000, custom: true },
    ],
    priceHierarchy: [{ rank: 1, source: 'Latest price on or before the NAV date', detail: 'The most recent price in the history.' }],
    governance: ['Release needs valuation.release and a fresh authenticator code.'], canEdit,
  });

  it('FR-VAL-015: the valuation policy shows the price hierarchy, thresholds and governance', async () => {
    const { user } = mountPage(<NavPage />, { routes: lroutes({ 'GET /api/v1/nav/policy': D(policy(false)) }) });
    await user.click(await screen.findByRole('button', { name: 'Valuation policy' }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Latest price on or before the NAV date.')).toBeInTheDocument();
    expect(within(dlg).getByText('Stale price (days)')).toBeInTheDocument();
    expect(within(dlg).getByText('customised')).toBeInTheDocument();
    expect(within(dlg).getByText('Release needs valuation.release and a fresh authenticator code.')).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Change thresholds' })).not.toBeInTheDocument();
  });

  it('FR-VAL-015: a releaser changes thresholds with a reason; only changed values are sent', async () => {
    const { api, user } = mountPage(<NavPage />, { routes: lroutes({ 'GET /api/v1/nav/policy': D(policy(true)), 'PUT /api/v1/nav/policy': D({ thresholds: [] }) }) });
    await user.click(await screen.findByRole('button', { name: 'Valuation policy' }));
    await user.click(await screen.findByRole('button', { name: 'Change thresholds' }));
    const dialogs = await screen.findAllByRole('dialog');
    const form = dialogs[dialogs.length - 1]!;
    const stale = within(form).getByLabelText('Stale price (days)');
    await user.clear(stale);
    await user.type(stale, '5');
    await user.type(within(form).getByLabelText('Reason'), 'Tighter staleness window');
    await user.click(within(form).getByRole('button', { name: 'Save thresholds' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/nav/policy'));
    expect(req.body).toEqual({ staleDays: 5, reason: 'Tighter staleness window' });
    expectIdempotencyKey(req);
  });

  it('FR-VAL-017: shows ABOR, external NAV, variance, state and tolerance', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: { 'GET /api/v1/nav/runs/n-1': D(navDetail({ external: external() })) } });
    expect(await screen.findByText('External NAV vs ABOR')).toBeInTheDocument();
    expect(screen.getByText('9,552,000.00 USD')).toBeInTheDocument();
    expect(screen.getByText(/-6,000\.00 USD \(-0\.0628%\)/)).toBeInTheDocument();
    expect(screen.getByText('Variance', { selector: '.ops-badge' })).toBeInTheDocument();
    expect(screen.getByText('5,000.00 USD')).toBeInTheDocument();
    expect(screen.getByText(/differs from the ABOR value by more than the tolerance/)).toBeInTheDocument();
  });

  it('FR-VAL-017: a figure within tolerance reads Agree', async () => {
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: { 'GET /api/v1/nav/runs/n-1': D(navDetail({ external: external({ state: 'Agree', variance: '-100.00', variancePct: '-0.0010' }) })) } });
    expect(await screen.findByText('Agree', { selector: '.ops-badge' })).toBeInTheDocument();
    expect(screen.queryByText(/differs from the ABOR value/)).not.toBeInTheDocument();
  });

  it('FR-VAL-017: records the external figure (commas stripped) with a source and an Idempotency-Key, then reloads', async () => {
    const { api, user } = mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: { 'GET /api/v1/nav/runs/n-1': D(navDetail()), 'PUT /api/v1/nav/runs/n-1/external-nav': D({ id: 'n-1' }) } });
    expect(await screen.findByText(/No external NAV has been recorded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record external NAV' }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText(/External NAV \(USD\)/), '9,552,000.00');
    await user.type(within(dlg).getByLabelText('Source'), 'Administrator statement');
    await user.click(within(dlg).getByRole('button', { name: 'Save external NAV' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/nav/runs/n-1/external-nav'));
    expect(req.body).toEqual({ externalNav: '9552000.00', source: 'Administrator statement', note: null });
    expectIdempotencyKey(req);
    await waitFor(() => expect(api.calls('GET /api/v1/nav/runs/n-1').length).toBe(2));
  });

  it('FR-VAL-009: an auditor sees every action disabled with "Not permitted for Auditor"', async () => {
    const d = navDetail({ status: 'DRAFT', stage: 'review', openExceptions: 1, openMaterialExceptions: 1, totalExceptions: 1, exceptions: [{ id: 'e1', type: 'MISSING_PRICE', securityId: 's1', ticker: 'DLTA', detail: 'No price on file', currentValue: null, referenceValue: null, difference: null, material: true, status: 'OPEN', resolution: null, evidenceRef: null, resolvedByName: null, resolvedAt: null }] },
      { runBlocker: 'Not permitted for Auditor', makerBlocker: 'Not permitted for Auditor', recordExternal: false, makerReviewBlockers: ['Not permitted for Auditor', '1 material exception still open'] });
    mountPage(<NavRunPage />, { params: { id: 'n-1' }, routes: { 'GET /api/v1/nav/runs/n-1': D(d) } });
    await screen.findByText('NAV-00001');
    for (const name of ['Edit inputs', 'Recalculate', 'Maker review', 'Resolve', 'Record external NAV']) {
      const b = screen.getAllByRole('button', { name })[0]!;
      expect(b, name).toBeDisabled();
    }
    expect(screen.getAllByRole('button', { name: 'Edit inputs' })[0]).toHaveAttribute('title', 'Not permitted for Auditor');
    expect(screen.getByRole('button', { name: 'Recalculate' })).toHaveAttribute('title', 'Not permitted for Auditor');
    expect(screen.getByRole('button', { name: 'Resolve' })).toHaveAttribute('title', 'Not permitted for Auditor');
    expect(screen.getByRole('button', { name: 'Maker review' }).getAttribute('title')).toContain('Not permitted for Auditor');
  });
});

// ---------------------------------------------------------------- BR-029

describe('Risk: scenario thresholds (BR-029)', () => {
  const payload = (canEdit: boolean, over: Record<string, unknown> = {}) => ({
    thresholds: { liquidityEscalate: 1, liquidityReview: 1.1, lossEscalatePct: null, lossReviewPct: null, ...over },
    defaults: { liquidityEscalate: 1, liquidityReview: 1.1, lossEscalatePct: null, lossReviewPct: null },
    reference: { liquidityEscalate: 1.25, liquidityReview: 1.5, lossEscalatePct: 8, lossReviewPct: 5, note: 'SRD BR-029 reference values' }, canEdit,
  });
  const rbase = (extra = {}) => ({
    'GET /api/v1/risk/limits': D([]), 'GET /api/v1/risk/users': D([]), 'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/risk/breaches': D([]), 'GET /api/v1/risk/cases': D([]),
    'GET /api/v1/risk/scenarios': D([], { presets: [] }), 'GET /api/v1/risk/runs': D([]), ...extra,
  });

  it('shows the current thresholds, off for the loss test, and the reference values', async () => {
    const { user } = mountPage(<RiskPage />, { routes: rbase({ 'GET /api/v1/risk/scenario-thresholds': D(payload(false)) }) });
    await user.click(await screen.findByRole('tab', { name: 'Scenarios' }));
    expect(await screen.findByText('Scenario thresholds')).toBeInTheDocument();
    expect(screen.getByText('below 1x')).toBeInTheDocument();
    expect(screen.getByText('below 1.1x')).toBeInTheDocument();
    expect(screen.getAllByText('off').length).toBe(2);
    expect(screen.getByText(/Reference values from the policy: liquidity 1.25x \/ 1.5x, loss 8% \/ 5%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit thresholds' })).not.toBeInTheDocument();
  });

  it('a risk manager edits the thresholds with a reason; an emptied loss field is sent as null', async () => {
    const { api, user } = mountPage(<RiskPage />, { routes: rbase({ 'GET /api/v1/risk/scenario-thresholds': D(payload(true)), 'PUT /api/v1/risk/scenario-thresholds': D(payload(true, { liquidityEscalate: 1.25, liquidityReview: 1.5 })) }) });
    await user.click(await screen.findByRole('tab', { name: 'Scenarios' }));
    await user.click(await screen.findByRole('button', { name: 'Edit thresholds' }));
    const dlg = await screen.findByRole('dialog');
    const esc = within(dlg).getByLabelText('Liquidity coverage: escalate below (x)');
    await user.clear(esc);
    await user.type(esc, '1.25');
    const rev = within(dlg).getByLabelText('Liquidity coverage: review below (x)');
    await user.clear(rev);
    await user.type(rev, '1.5');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Adopt the policy reference values');
    await user.click(within(dlg).getByRole('button', { name: 'Save thresholds' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/risk/scenario-thresholds'));
    expect(req.body).toEqual({ liquidityEscalate: 1.25, liquidityReview: 1.5, lossEscalatePct: null, lossReviewPct: null, reason: 'Adopt the policy reference values' });
    expectIdempotencyKey(req);
  });

  it('blocks a save where escalate is above review, before asking the server', async () => {
    const { user } = mountPage(<RiskPage />, { routes: rbase({ 'GET /api/v1/risk/scenario-thresholds': D(payload(true)) }) });
    await user.click(await screen.findByRole('tab', { name: 'Scenarios' }));
    await user.click(await screen.findByRole('button', { name: 'Edit thresholds' }));
    const dlg = await screen.findByRole('dialog');
    const esc = within(dlg).getByLabelText('Liquidity coverage: escalate below (x)');
    await user.clear(esc);
    await user.type(esc, '2');
    expect(within(dlg).getByText('Escalate coverage must not be above review coverage')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Save thresholds' })).toBeDisabled();
  });
});
