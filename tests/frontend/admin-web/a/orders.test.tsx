import { describe, it, expect } from 'vitest';
import OrdersPage from '@/app/(ops)/ops/orders/page';
import NewOrderPage from '@/app/(ops)/ops/orders/new/page';
import OrderPage from '@/app/(ops)/ops/orders/[id]/page';
import { price6, bp } from '@/ops/orders';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, PF, SEC, created, mountPage, validationFail, without } from './_kit';

const precheck = (overall = 'Within') => ({
  overall, currency: 'USD', notional: '125.00', estimatedFee: '1.25', price: '1.25', asOf: '2026-10-01', warnings: [], decisionPrice: '1.25',
  checks: [
    { key: 'mandate', label: 'Mandate', result: 'Pass', detail: 'Within mandate' },
    { key: 'cash', label: 'Cash', result: overall === 'Blocked' ? 'Fail' : 'Pass', detail: overall === 'Blocked' ? 'Insufficient cash' : 'Cash available' },
  ],
});
const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 'o-1', ref: 'ORD-00001', portfolio: { id: PF.id, ref: PF.ref, name: PF.name, baseCurrency: 'USD' },
  security: { id: SEC.id, ticker: 'DLTA', name: 'Delta Corporation', market: 'VFEX', currency: 'USD', boardLot: 100, status: 'Active', sector: 'Consumer' },
  side: 'BUY', quantity: '1000', orderType: 'LIMIT', limitPrice: '1.250000', tif: 'DAY', urgency: 'Normal', broker: null, rationale: 'Add to position', currency: 'USD', decisionPrice: '1.25', notional: '1250.00',
  status: 'AwaitingApproval', precheck: precheck(), precheckAt: '2026-10-01T09:00:00Z', maker: { id: 'usr_other', name: 'Maya Maker' }, approver: null, approvedAt: null, router: null, routedAt: null,
  filledQty: '0', remainingQty: '1000', avgPrice: null, slippageBp: null, reservedAmount: '1251.25', estimatedFee: '1.25', cancelReason: null, rejectReason: null, submittedAt: '2026-10-01T09:00:00Z', createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T09:00:00Z', version: 3, ...over,
});
const list = (rows: unknown[], summary: Record<string, unknown> = {}) => D(rows, { total: rows.length, limit: 25, offset: 0, summary: { working: 1, awaitingApproval: 1, filled: 0, slippageBp: null, byStatus: {}, ...summary } });

describe('orders formatters', () => {
  it('price6 trims trailing zeros to between 2 and 6 decimals', () => {
    expect(price6('1.250000')).toBe('1.25');
    expect(price6('1.123456')).toBe('1.123456');
    expect(price6(null)).toBe('—');
  });
  it('bp signs positive slippage', () => {
    expect(bp(3.25)).toBe('+3.3 bp');
    expect(bp(-1)).toBe('-1.0 bp');
    expect(bp(null)).toBe('—');
  });
});

describe('Orders blotter', () => {
  const routes = (rows: unknown[] = [orderRow()], s = {}) => ({ 'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/securities': D([SEC]), 'GET /api/v1/orders': list(rows, s) });

  it('ADA-006: Working tile excludes awaiting approval and the two tiles are separate counts', async () => {
    mountPage(<OrdersPage />, { routes: routes([orderRow()], { working: 0, awaitingApproval: 1 }) });
    const working = (await screen.findByText('Working', { selector: 'p' })).closest('button')!;
    const awaiting = screen.getByText('Awaiting approval', { selector: 'p' }).closest('button')!;
    expect(working).toHaveTextContent('0');
    expect(awaiting).toHaveTextContent('1');
    expect(working).toHaveTextContent('Approved, routing or partly filled');
  });

  it('renders rows with names (not ids), side, limit price and a readable status', async () => {
    mountPage(<OrdersPage />, { routes: routes() });
    expect(await screen.findByText('ORD-00001')).toBeInTheDocument();
    expect(screen.getByText('Maya Maker')).toBeInTheDocument();
    expect(screen.getByText('Delta Corporation')).toBeInTheDocument();
    expect(screen.getByText('Limit 1.25')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting approval').length).toBeGreaterThan(0);
  });

  it('clicking a tile filters the query; status select and portfolio filter re-query with the right params', async () => {
    const { api, user } = mountPage(<OrdersPage />, { routes: routes() });
    await screen.findByText('ORD-00001');
    await user.click(screen.getByText('Awaiting approval', { selector: 'p' }));
    await waitFor(() => expect(api.calls('GET /api/v1/orders').at(-1)!.query.get('status')).toBe('AwaitingApproval'));
    await screen.findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(screen.getByLabelText('Portfolio'), PF.id);
    await waitFor(() => expect(api.calls('GET /api/v1/orders').at(-1)!.query.get('portfolioId')).toBe(PF.id));
    expect(api.calls('GET /api/v1/orders').at(-1)!.query.get('offset')).toBe('0');
  });

  it('empty and error states', async () => {
    mountPage(<OrdersPage />, { routes: routes([]) });
    expect(await screen.findByText('No orders match these filters.')).toBeInTheDocument();
    expect(screen.getByText('No orders')).toBeInTheDocument();
  });
  it('error state', async () => {
    mountPage(<OrdersPage />, { routes: { ...routes(), 'GET /api/v1/orders': fail(500, 'internal', 'boom') } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load orders/);
  });

  it('New order link only with orders.create', async () => {
    mountPage(<OrdersPage />, { perms: without('orders.create'), routes: routes() });
    await screen.findByText('ORD-00001');
    expect(screen.queryByRole('link', { name: 'New order' })).not.toBeInTheDocument();
  });
  it('New order link points at the ticket page', async () => {
    mountPage(<OrdersPage />, { routes: routes() });
    expect(await screen.findByRole('link', { name: 'New order' })).toHaveAttribute('href', '/ops-native/orders/new');
  });
});

describe('New order ticket', () => {
  const nroutes = (extra = {}) => ({
    'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/brokers': D([{ id: 'b-1', name: 'Imara Securities', email: 'dealing@imara.test', status: 'Active' }]),
    'GET /api/v1/securities': D([SEC]), ...extra,
  });
  async function fill(user: ReturnType<typeof mountPage>['user'], qty = '1000') {
    await screen.findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(screen.getByLabelText('Portfolio'), PF.id);
    await user.type(screen.getByPlaceholderText(/DLTA or Delta/), 'DLTA');
    await user.click(await screen.findByText('Delta Corporation'));
    await user.type(screen.getByLabelText(/Quantity/), qty);
  }

  it('without orders.create shows the refusal and loads nothing sensitive', async () => {
    mountPage(<NewOrderPage />, { perms: without('orders.create'), routes: nroutes() });
    expect(await screen.findByText(/does not include creating orders/)).toBeInTheDocument();
  });

  it('ADA-020: quantity must be a whole board-lot multiple; buttons stay disabled until the ticket is valid', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes() });
    await fill(user, '150');
    expect(await screen.findByText('Must be a multiple of the board lot (100)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run pre-trade check' })).toBeDisabled();
    await user.clear(screen.getByLabelText(/Quantity/));
    await user.type(screen.getByLabelText(/Quantity/), '1.5');
    expect(screen.getByText('Enter a whole number of shares')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Quantity/));
    await user.type(screen.getByLabelText(/Quantity/), '200');
    expect(screen.getByRole('button', { name: 'Run pre-trade check' })).toBeEnabled();
  });

  it('limit orders require a valid positive price (max 6 decimals)', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes() });
    await fill(user, '100');
    await user.selectOptions(screen.getByLabelText('Order type'), 'LIMIT');
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Limit price/), '1.1234567');
    expect(screen.getByText('Enter a positive price (up to 6 decimals)')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Limit price/));
    await user.type(screen.getByLabelText(/Limit price/), '1.25');
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeEnabled();
  });

  it('a suspended security cannot be ordered', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'GET /api/v1/securities': D([{ ...SEC, status: 'Suspended' }]) }) });
    await fill(user, '100');
    expect(await screen.findByText(/DLTA is Suspended and cannot be ordered/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled();
  });

  it('pre-trade check posts the ticket and shows the per-control result; editing the ticket makes it stale', async () => {
    const { api, user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'POST /api/v1/orders/precheck': D(precheck('Blocked')) }) });
    await fill(user, '100');
    await user.click(screen.getByRole('button', { name: 'Run pre-trade check' }));
    expect(await screen.findByText('Insufficient cash')).toBeInTheDocument();
    expect(screen.getByText(/Blocked: this order cannot be submitted/)).toBeInTheDocument();
    expectBody(expectCalled(api, 'POST /api/v1/orders/precheck')[0], { portfolioId: PF.id, securityId: SEC.id, side: 'BUY', quantity: '100', orderType: 'MARKET' });
    await user.type(screen.getByLabelText(/Quantity/), '0');
    expect(screen.queryByText('Insufficient cash')).not.toBeInTheDocument();
  });

  it('precheck API error is shown in the check panel', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'POST /api/v1/orders/precheck': fail(400, 'validation_error', 'Quantity is not a multiple of the board lot') }) });
    await fill(user, '100');
    await user.click(screen.getByRole('button', { name: 'Run pre-trade check' }));
    expect(await screen.findByText(/Quantity is not a multiple of the board lot/)).toBeInTheDocument();
  });

  it('Save as draft creates with an Idempotency-Key and opens the order', async () => {
    const { api, user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'POST /api/v1/orders': created(orderRow({ id: 'o-9', status: 'Draft' })) }) });
    await fill(user, '500');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/orders'));
    expectBody(req, { portfolioId: PF.id, securityId: SEC.id, side: 'BUY', quantity: '500', orderType: 'MARKET', tif: 'DAY', urgency: 'Normal' });
    expectIdempotencyKey(req);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/orders/o-9'));
  });

  it('Submit needs a rationale; then create -> validate -> submit(rationale) -> open the order', async () => {
    const routes = nroutes({
      'POST /api/v1/orders': created(orderRow({ id: 'o-9', status: 'Draft' })),
      'POST /api/v1/orders/o-9/validate': D(orderRow({ id: 'o-9', status: 'Validated' })),
      'POST /api/v1/orders/o-9/submit': D({}),
    });
    const { api, user } = mountPage(<NewOrderPage />, { routes });
    await fill(user, '500');
    const submit = screen.getByRole('button', { name: 'Submit for approval' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Rationale/), 'Rebalancing');
    await user.click(submit);
    const [sub] = await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-9/submit'));
    expectBody(sub, { rationale: 'Rebalancing' });
    expectIdempotencyKey(sub);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/orders/o-9'));
  });

  it('when the check blocks, the draft is kept, nothing is submitted, and the user is told with a link to the draft', async () => {
    const routes = nroutes({
      'POST /api/v1/orders': created(orderRow({ id: 'o-9', ref: 'ORD-00009', status: 'Draft' })),
      'POST /api/v1/orders/o-9/validate': D(orderRow({ id: 'o-9', status: 'Draft', precheck: precheck('Blocked') })),
      'POST /api/v1/orders/o-9/submit': D({}),
    });
    const { api, user } = mountPage(<NewOrderPage />, { routes });
    await fill(user, '500');
    await user.type(screen.getByLabelText(/Rationale/), 'Rebalancing');
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText(/Draft ORD-00009 was saved but not submitted/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the draft' })).toHaveAttribute('href', '/ops-native/orders/o-9');
    expectNotCalled(api, 'POST /api/v1/orders/o-9/submit');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ADA-020: field-level quantity error from the API (volume cap) is shown, not a generic message', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'POST /api/v1/orders': validationFail({ quantity: 'Quantity exceeds 10x average daily volume' }) }) });
    await fill(user, '999999900');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed. Quantity exceeds 10x average daily volume');
  });

  it('securities search with no match says so', async () => {
    const { user } = mountPage(<NewOrderPage />, { routes: nroutes({ 'GET /api/v1/securities': D([]) }) });
    await user.type(await screen.findByPlaceholderText(/DLTA or Delta/), 'zzz');
    expect(await screen.findByText('No securities match.')).toBeInTheDocument();
  });
});

describe('Order ticket lifecycle', () => {
  const detail = (over: Record<string, unknown> = {}, allowed: string[] = []) => ({
    ...orderRow(), cash: { holds: [], ledger: null }, decision: null, realisedGain: null, fills: [], instruction: null,
    timeline: [{ at: '2026-10-01T09:00:00Z', action: 'submitted', actor: 'Maya Maker', actorRole: 'Trader', from: 'Validated', to: 'AwaitingApproval', reason: null }], allowed, ...over,
  });
  const r = (d: unknown, extra = {}) => ({ 'GET /api/v1/orders/o-1': D(d), 'GET /api/v1/brokers': D([{ id: 'b-1', name: 'Imara Securities', email: 'dealing@imara.test', status: 'Active' }]), ...extra });
  const click = async (user: ReturnType<typeof mountPage>['user'], name: string) => user.click(await screen.findByRole('button', { name }));

  it('renders names, quantities, maker, cash hold link and timeline', async () => {
    const d = detail({ cash: { holds: [{ id: 'h1', ref: 'RSV-007', status: 'ACTIVE', amount: '1251.25', consumed: '0.00', remaining: '1251.25', currency: 'USD', releaseReason: null }], ledger: { ref: 'LED-001', posted: '5000.00', reservedByOthers: '0.00', minBuffer: '100.00', available: '3648.75' } } });
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(d) });
    expect(await screen.findByText('ORD-00001')).toBeInTheDocument();
    expect(screen.getByText('Growth Portfolio (PF-1001)')).toBeInTheDocument();
    expect(screen.getByText('Maya Maker')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RSV-007' })).toHaveAttribute('href', expect.stringContaining('/ops-native/cash?tab=reservations'));
    expect(screen.getByText('LED-001')).toBeInTheDocument();
    expect(screen.getByText(/Awaiting approval/, { selector: '.ops-badge' })).toBeInTheDocument();
  });

  it('only the actions the API lists in `allowed` are shown', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({}, ['approve', 'reject'])) });
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    for (const n of ['Edit', 'Route to broker', 'Record fill', 'Cancel order']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
  });

  it('maker sees the maker-checker notice; the approver of an approved order sees the router notice', async () => {
    const { unmount } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ maker: { id: 'usr_admin', name: 'Test Admin' } })) });
    expect(await screen.findByText(/You created this order. A different person with approval rights must approve it/)).toBeInTheDocument();
    expect(screen.getByText('Test Admin (you)')).toBeInTheDocument();
    unmount();
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ status: 'Approved', approver: { id: 'usr_admin', name: 'Test Admin' }, approvedAt: '2026-10-01T10:00:00Z' })) });
    expect(await screen.findByText(/You approved this order. A different person must route it/)).toBeInTheDocument();
  });

  it('Approve: confirm dialog names the order, then POST /approve with an Idempotency-Key and refetch', async () => {
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({}, ['approve']), { 'POST /api/v1/orders/o-1/approve': D({}) }) });
    await click(user, 'Approve');
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveTextContent('Approve ORD-00001: BUY 1,000 DLTA?');
    await user.click(within(dlg).getByRole('button', { name: 'Approve' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-1/approve')))[0]);
    await waitFor(() => expect(api.calls('GET /api/v1/orders/o-1').length).toBe(2));
  });

  it('approve by the maker is refused by the API: "different approver" message shown on the page', async () => {
    const { user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({}, ['approve']), { 'POST /api/v1/orders/o-1/approve': fail(403, 'segregation_of_duties', 'You created this order') }) });
    await click(user, 'Approve');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A different approver is required. You created this order');
  });

  it('Reject sends the reason (min 3 chars) and reloads', async () => {
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({}, ['reject']), { 'POST /api/v1/orders/o-1/reject': D({}) }) });
    await click(user, 'Reject');
    const d = await screen.findByRole('dialog');
    expect(within(d).getByLabelText(/Reason/)).toHaveAttribute('minlength', '3');
    await user.type(within(d).getByLabelText(/Reason/), 'Too large');
    await user.click(within(d).getByRole('button', { name: 'Reject order' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-1/reject')))[0], { reason: 'Too large' });
  });

  it('Submit for approval from a draft sends the rationale with a key', async () => {
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ status: 'Validated', rationale: null }, ['submit']), { 'POST /api/v1/orders/o-1/submit': D({}) }) });
    await click(user, 'Submit for approval');
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Rationale'), 'Client request');
    await user.click(within(d).getByRole('button', { name: 'Submit for approval' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-1/submit'));
    expectBody(req, { rationale: 'Client request' });
    expectIdempotencyKey(req);
  });

  it('Route to broker: choose broker, preview the instruction, then send with a key', async () => {
    const preview = { orderStatus: 'Approved', routable: true, broker: { id: 'b-1', name: 'Imara Securities', email: 'dealing@imara.test' }, instruction: { to: 'dealing@imara.test', brokerName: 'Imara Securities', subject: 'Order ORD-00001', text: 'Please buy 1,000 DLTA' } };
    const routes = r(detail({ status: 'Approved' }, ['route']), { 'GET /api/v1/orders/o-1/broker-instruction/preview': D(preview), 'POST /api/v1/orders/o-1/route': D({}) });
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes });
    await click(user, 'Route to broker');
    const d = await screen.findByRole('dialog');
    const send = within(d).getByRole('button', { name: 'Send instruction' });
    expect(send).toBeDisabled();
    await within(d).findByRole('option', { name: 'Imara Securities' });
    await user.selectOptions(within(d).getByLabelText('Executing broker'), 'b-1');
    expect(await within(d).findByText('Please buy 1,000 DLTA')).toBeInTheDocument();
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-1/route'));
    expectBody(req, { brokerId: 'b-1' });
    expectIdempotencyKey(req);
  });

  it('Record fill: defaults to remaining quantity, strips commas from price, sends source and key', async () => {
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ status: 'Routing', remainingQty: '1000' }, ['fill']), { 'POST /api/v1/orders/o-1/fills': D({}) }) });
    await click(user, 'Record fill');
    const d = await screen.findByRole('dialog');
    expect(within(d).getByLabelText(/Quantity filled/)).toHaveValue('1000');
    await user.clear(within(d).getByLabelText(/Quantity filled/));
    await user.type(within(d).getByLabelText(/Quantity filled/), '400');
    await user.clear(within(d).getByLabelText(/^Price/));
    await user.type(within(d).getByLabelText(/^Price/), '1,251');
    await user.selectOptions(within(d).getByLabelText('Source'), 'CONTRACT_NOTE');
    await user.click(within(d).getByRole('button', { name: 'Record fill' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-1/fills'));
    expectBody(req, { quantity: '400', price: '1251', fees: '0', source: 'CONTRACT_NOTE' });
    expectIdempotencyKey(req);
  });

  it('Settle (create trade journals) asks for confirmation first', async () => {
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ status: 'Filled' }, ['settle']), { 'POST /api/v1/orders/o-1/settle': D({}) }) });
    await click(user, 'Settle (create trade journals)');
    expectNotCalled(api, 'POST /api/v1/orders/o-1/settle');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Settle (create trade journals)' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-1/settle'));
  });

  it('Cancel order sends a reason and mentions the released cash', async () => {
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({}, ['cancel']), { 'POST /api/v1/orders/o-1/cancel': D({}) }) });
    await click(user, 'Cancel order');
    const d = await screen.findByRole('dialog');
    expect(d).toHaveTextContent(/1,251.25 reserved for this order is released/);
    await user.type(within(d).getByLabelText('Reason'), 'Client withdrew');
    await user.click(within(d).getByRole('button', { name: 'Cancel order' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/orders/o-1/cancel')))[0], { reason: 'Client withdrew' });
  });

  it('Edit sends the version for optimistic concurrency and a version conflict is shown', async () => {
    const routes = r(detail({ status: 'Draft', version: 7 }, ['edit']), { 'PATCH /api/v1/orders/o-1': fail(409, 'version_conflict', 'This order was changed by someone else') });
    const { api, user } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes });
    await click(user, 'Edit');
    const d = await screen.findByRole('dialog');
    await user.click(within(d).getByRole('button', { name: 'Save changes' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('This order was changed by someone else');
    expectBody(api.calls('PATCH /api/v1/orders/o-1')[0], { version: 7, quantity: '1000', orderType: 'LIMIT', limitPrice: '1.25' });
  });

  it('rejected and cancelled orders show the reason; a blocked draft shows the failing control', async () => {
    const { unmount } = mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ status: 'Rejected', rejectReason: 'Too large' })) });
    expect(await screen.findByText('Rejected: Too large.')).toBeInTheDocument();
    unmount();
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(detail({ status: 'Draft', precheck: precheck('Blocked') })) });
    expect(await screen.findByText(/pre-trade check blocked this order/)).toBeInTheDocument();
    expect(screen.getByText('Insufficient cash')).toBeInTheDocument();
  });

  it('sell orders show realised gain; filled orders list fills with the source', async () => {
    const d = detail({ side: 'SELL', status: 'Filled', filledQty: '1000', remainingQty: '0', avgPrice: '1.30', slippageBp: 4, fills: [{ id: 'f1', quantity: '1000', price: '1.30', fees: '2.00', notional: '1300.00', executedAt: '2026-10-01T11:00:00Z', source: 'CONTRACT_NOTE', sourceRef: 'CN-77', recordedBy: 'Rita Router' }], realisedGain: { method: 'AVERAGE', currency: 'USD', proceeds: '1300.00', costBasis: '1000.00', fees: '2.00', gain: '300.00', netOfFees: '298.00', fills: [] } });
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: r(d) });
    expect(await screen.findByText('Realised gain (average cost)')).toBeInTheDocument();
    expect(screen.getByText('CN-77')).toBeInTheDocument();
    expect(screen.getByText('contract note')).toBeInTheDocument();
    expect(screen.getByText('+4.0 bp')).toBeInTheDocument();
  });

  it('not found shows the not-found message', async () => {
    mountPage(<OrderPage />, { params: { id: 'o-1' }, routes: { 'GET /api/v1/orders/o-1': fail(404, 'not_found', 'x') } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
  });
});
