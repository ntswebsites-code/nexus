import { describe, it, expect } from 'vitest';
import PortfolioLabPage from '@/app/(ops)/ops/portfolio-lab/page';
import { mountPage } from './_kit';
import { ok, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const model = (o: Record<string, unknown> = {}) => ({
  id: 'm1', ref: 'PMD-1001', name: 'Balanced Core', description: 'Core mix', cashTargetPct: '5', status: 'DRAFT', holdings: 2, totalPct: '100.0100', problems: ['Weights total 100.0100%, not 100%'],
  createdBy: 'usr_other', createdByName: 'Maker M', version: 3,
  weights: [{ securityId: 's1', ticker: 'ABC', name: 'ABC Holdings', sector: 'Banks', targetPct: '60' }, { securityId: 's2', ticker: 'XYZ', name: 'XYZ Ltd', sector: 'Tech', targetPct: '35.01' }], ...o,
});
const line = (o: Record<string, unknown> = {}) => ({
  securityId: 's1', ticker: 'ABC', name: 'ABC Holdings', side: 'BUY', quantity: '1000', price: '1.5', currency: 'USD', currentPct: '10', targetPct: '20', afterPct: '19.9', notionalBase: '1500', checkResult: 'Fail',
  checks: { result: 'Fail', preTrade: [{ key: 'cash', label: 'Cash', result: 'Fail', detail: 'only 0.00 is free' }], limits: [{ ref: 'LIM-1', metric: 'Single name', state: 'BREACH', value: '21', threshold: '20', worsened: true, breachAction: 'BLOCK' }] }, ...o,
});
const preview = (o: Record<string, unknown> = {}) => ({
  portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', modelId: 'm1', modelRef: 'PMD-1001', modelName: 'Balanced Core', baseCurrency: 'USD', totalValueBase: '1000000', turnoverPct: '12.5', cashAfterPct: '4.2', cashAfterBase: '42000',
  warnings: [], constraints: [{ key: 'k', label: 'Max single name', limit: '20%', value: '19.9%', state: 'Pass', detail: 'ok' }], constraintsPassed: true, lines: [line(), line({ securityId: 's2', ticker: 'XYZ', side: 'SELL', checkResult: 'Review', checks: { result: 'Review', preTrade: [], limits: [] } })], ...o,
});
const rebal = (o: Record<string, unknown> = {}) => ({
  id: 'r1', ref: 'RBL-1001', status: 'PROPOSED', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', modelRef: 'PMD-1001', modelName: 'Balanced Core', baseCurrency: 'USD', totalValueBase: '1000000', turnoverPct: '12.5', cashAfterPct: '4.2', driftThresholdPct: '0.5',
  constraints: [], constraintsPassed: true, warnings: [], stale: false, createdByName: 'Maker M', createdAt: '2026-08-26T10:00:00Z', lines: [line({ checkResult: 'Pass', orderRef: null })], lineCount: 1, failing: 0, ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/portfolio-lab/models': ok([model(), model({ id: 'm2', ref: 'PMD-1002', name: 'Growth', status: 'ACTIVE', problems: [], totalPct: '100' })]),
  'GET /api/v1/portfolio-lab/models/:id': ok(model()),
  'GET /api/v1/portfolios': ok([{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }]),
  'GET /api/v1/securities': ok([{ id: 's1', ticker: 'ABC', name: 'ABC Holdings' }, { id: 's2', ticker: 'XYZ', name: 'XYZ Ltd' }]),
  'GET /api/v1/portfolio-lab/rebalances': ok([rebal({ failing: 2, lineCount: 8, stale: true })]),
  'GET /api/v1/portfolio-lab/rebalances/:id': ok(rebal()),
  ...o,
});

describe('Portfolio Construction: models', () => {
  it('ADB-023: lists PMD- refs (not MDL-) with the author name and status', async () => {
    await mountPage(<PortfolioLabPage />, { routes: base() });
    expect(await screen.findByText('PMD-1001')).toBeInTheDocument();
    expect(screen.getByText('PMD-1002')).toBeInTheDocument();
    expect(screen.queryByText(/MDL-/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Maker M').length).toBeGreaterThan(0);
  });
  it('ADB-007/008: the list row flags a draft whose weights total != 100% with a Check tag and the first problem', async () => {
    await mountPage(<PortfolioLabPage />, { routes: base() });
    const row = (await screen.findByText('PMD-1001')).closest('tr')!;
    expect(within(row).getByText('check')).toBeInTheDocument();
    expect(within(row).getByText('Weights total 100.0100%, not 100%')).toBeInTheDocument();
    expect(within(row).getByText('100.0100%')).toBeInTheDocument();
  });
  it('ADB-007/012: without portfolio.manage New model is visible, disabled and says why', async () => {
    await mountPage(<PortfolioLabPage />, { perms: ['portfolio.view'], routes: base() });
    const b = await screen.findByRole('button', { name: 'New model' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Needs the portfolio.manage permission');
  });
  it('ADB-007: model detail shows Edit, Activate, Clone, Retire disabled with the permission reason plus text', async () => {
    const { user } = await mountPage(<PortfolioLabPage />, { perms: ['portfolio.view'], routes: base() });
    await user.click(await screen.findByText('PMD-1001'));
    const dlg = await screen.findByRole('dialog');
    for (const n of ['Edit', 'Activate', 'Clone', 'Retire']) {
      const b = await within(dlg).findByRole('button', { name: n });
      expect(b, n).toBeDisabled();
      expect(b, n).toHaveAttribute('title', 'Needs the portfolio.manage permission');
    }
    expect(within(dlg).getByText('Needs the portfolio.manage permission.')).toBeInTheDocument();
    expect(within(dlg).getByText('Weights total 100.0100%, not 100%')).toBeInTheDocument();
  });
  it('maker-checker: the author cannot activate their own model (sees "A second person activates"); another user can, with confirm + key', async () => {
    const { user } = await mountPage(<PortfolioLabPage />, { routes: base({ 'GET /api/v1/portfolio-lab/models/:id': ok(model({ createdBy: 'usr_admin' })) }) });
    await user.click(await screen.findByText('PMD-1001'));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('A second person activates your model.')).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
  });
  it('another user activates: confirm dialog, POST with idempotency key, list reloads', async () => {
    const { user, api } = await mountPage(<PortfolioLabPage />, { routes: base({ 'POST /api/v1/portfolio-lab/models/m1/activate': ok({}) }) });
    await user.click(await screen.findByText('PMD-1001'));
    const dlg = await screen.findByRole('dialog');
    await user.click(await within(dlg).findByRole('button', { name: 'Activate' }));
    const confirm = screen.getAllByRole('dialog').at(-1)!;
    expect(within(confirm).getByText(/Activate this model\?/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Activate' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolio-lab/models/m1/activate'));
    expectIdempotencyKey(req!);
    await waitFor(() => expect(api.calls('GET /api/v1/portfolio-lab/models').length).toBeGreaterThan(1));
  });
  it('SoD error from the server on Activate is shown with the different-approver wording', async () => {
    const { user } = await mountPage(<PortfolioLabPage />, { routes: base({ 'POST /api/v1/portfolio-lab/models/m1/activate': fail(409, 'segregation_of_duties', 'Author cannot activate') }) });
    await user.click(await screen.findByText('PMD-1001'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Activate' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText('A different approver is required. Author cannot activate')).toBeInTheDocument();
  });
  it('create model: posts name, weights (only rows with a security) and cash target, with key; running total is shown', async () => {
    const { user, api } = await mountPage(<PortfolioLabPage />, { routes: base({ 'POST /api/v1/portfolio-lab/models': ok({ id: 'm9' }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'New model' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Name/), 'Income');
    await user.selectOptions(within(dlg).getByRole('combobox'), 's1');
    const inputs = within(dlg).getAllByRole('textbox');
    const w = inputs.find((i) => (i as HTMLInputElement).value === '' && i.getAttribute('inputmode') === 'decimal')!;
    await user.type(w, '95');
    expect(within(dlg).getByText('95.00% with cash')).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Add holding' }));
    await user.click(within(dlg).getByRole('button', { name: 'Create draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolio-lab/models'));
    expectBody(req!, { name: 'Income', cashTargetPct: '0', weights: [{ securityId: 's1', targetPct: '95' }] });
    expectIdempotencyKey(req!);
  });
  it('edit sends the model version (optimistic concurrency); retire requires a reason and posts it', async () => {
    const { user, api } = await mountPage(<PortfolioLabPage />, {
      routes: base({ 'PATCH /api/v1/portfolio-lab/models/m1': ok({}), 'POST /api/v1/portfolio-lab/models/m1/retire': ok({}) }),
    });
    await user.click(await screen.findByText('PMD-1001'));
    const dlg = await screen.findByRole('dialog');
    await user.click(await within(dlg).findByRole('button', { name: 'Edit' }));
    const edit = screen.getAllByRole('dialog').at(-1)!;
    await user.click(within(edit).getByRole('button', { name: 'Save draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/portfolio-lab/models/m1'));
    expectBody(req!, { version: 3, name: 'Balanced Core' });
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Retire' }));
    const reason = screen.getByLabelText(/Reason/);
    expect(reason).toBeRequired();
    await user.type(reason, 'Superseded by Growth');
    await user.click(screen.getAllByRole('button', { name: 'Retire' }).at(-1)!);
    const [r2] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolio-lab/models/m1/retire'));
    expectBody(r2!, { reason: 'Superseded by Growth' });
  });
  it('empty list and load failure states', async () => {
    const { unmount } = await mountPage(<PortfolioLabPage />, { routes: base({ 'GET /api/v1/portfolio-lab/models': ok([]) }) });
    expect(await screen.findByText('No models yet.')).toBeInTheDocument();
    unmount();
    await mountPage(<PortfolioLabPage />, { routes: base({ 'GET /api/v1/portfolio-lab/models': fail(500, 'x', 'DB down') }) });
    expect(await screen.findByText(/Could not load models: DB down/)).toBeInTheDocument();
  });
  it('without portfolio.view: access denied naming the permission, nothing fetched', async () => {
    const { api } = await mountPage(<PortfolioLabPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the portfolio.view permission/)).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/portfolio-lab/models');
  });
});

describe('Portfolio Construction: what-if and proposals', () => {
  const openWhatIf = async (routes: Record<string, unknown>, perms?: string[]) => {
    const m = await mountPage(<PortfolioLabPage />, { routes: base({ 'GET /api/v1/portfolio-lab/models': ok([model({ id: 'm1', status: 'ACTIVE', problems: [] })]), ...routes }), perms });
    await m.user.click(await screen.findByRole('tab', { name: 'What-if rebalance' }));
    return m;
  };
  it('Run what-if is disabled until portfolio and model are chosen; posts body; shows tiles', async () => {
    const { user, api } = await openWhatIf({ 'POST /api/v1/portfolio-lab/whatif': ok(preview()) });
    const run = screen.getByRole('button', { name: 'Run what-if' });
    expect(run).toBeDisabled();
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'p1');
    await user.selectOptions(screen.getAllByRole('combobox')[1]!, 'm1');
    await user.click(run);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolio-lab/whatif'));
    expectBody(req!, { portfolioId: 'p1', modelId: 'm1', driftThresholdPct: '0.5', keepUnmodelled: false });
    expect(await screen.findByText('USD 1,000,000.00')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
  });
  it('ADB-008: Mandate tile is labelled whole book and a separate Trade checks tile counts failing trades, with a banner', async () => {
    const { user } = await openWhatIf({ 'POST /api/v1/portfolio-lab/whatif': ok(preview()) });
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'p1');
    await user.selectOptions(screen.getAllByRole('combobox')[1]!, 'm1');
    await user.click(screen.getByRole('button', { name: 'Run what-if' }));
    expect(await screen.findByText('Mandate (whole book)')).toBeInTheDocument();
    expect(screen.getByText('Within')).toBeInTheDocument();
    expect(screen.getByText('Trade checks')).toBeInTheDocument();
    expect(screen.getByText('1 fail · 1 review')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 proposed trades fail their own pre-trade or risk checks/)).toBeInTheDocument();
    expect(screen.getByText('Cash: only 0.00 is free')).toBeInTheDocument();
    expect(screen.getByText(/LIM-1 Single name BREACH \(21 vs 20\)/)).toBeInTheDocument();
  });
  it('all trades pass: "All pass" and no banner; empty lines says already within the drift threshold', async () => {
    const { user } = await openWhatIf({ 'POST /api/v1/portfolio-lab/whatif': ok(preview({ lines: [], constraintsPassed: false })) });
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'p1');
    await user.selectOptions(screen.getAllByRole('combobox')[1]!, 'm1');
    await user.click(screen.getByRole('button', { name: 'Run what-if' }));
    expect(await screen.findByText('All pass')).toBeInTheDocument();
    expect(screen.getByText('Breached')).toBeInTheDocument();
    expect(screen.getByText(/already within the drift threshold/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as proposal' })).not.toBeInTheDocument();
  });
  it('what-if API error appears and no preview is shown', async () => {
    const { user } = await openWhatIf({ 'POST /api/v1/portfolio-lab/whatif': fail(400, 'validation_error', 'Validation failed', [{ path: 'modelId', message: 'Model is not active' }]) });
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'p1');
    await user.selectOptions(screen.getAllByRole('combobox')[1]!, 'm1');
    await user.click(screen.getByRole('button', { name: 'Run what-if' }));
    expect(await screen.findByText(/Validation failed/)).toBeInTheDocument();
    expect(screen.queryByText('Proposed trades')).not.toBeInTheDocument();
  });
  it('ADB-007: Save as proposal is disabled with reason for a viewer; for a manager it posts with a key and opens the proposal', async () => {
    const viewer = await openWhatIf({ 'POST /api/v1/portfolio-lab/whatif': ok(preview()) }, ['portfolio.view']);
    await viewer.user.selectOptions(screen.getAllByRole('combobox')[0]!, 'p1');
    await viewer.user.selectOptions(screen.getAllByRole('combobox')[1]!, 'm1');
    await viewer.user.click(screen.getByRole('button', { name: 'Run what-if' }));
    const save = await screen.findByRole('button', { name: 'Save as proposal' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', 'Needs the portfolio.manage permission');
  });
  it('manager saves the proposal', async () => {
    const { user, api } = await openWhatIf({ 'POST /api/v1/portfolio-lab/whatif': ok(preview()), 'POST /api/v1/portfolio-lab/rebalances': ok(rebal(), 201) });
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'p1');
    await user.selectOptions(screen.getAllByRole('combobox')[1]!, 'm1');
    await user.click(screen.getByRole('button', { name: 'Run what-if' }));
    await user.click(await screen.findByRole('button', { name: 'Save as proposal' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolio-lab/rebalances'));
    expectBody(req!, { portfolioId: 'p1', modelId: 'm1' });
    expectIdempotencyKey(req!);
    expect(await screen.findByText(/RBL-1001 · Balanced Growth Fund → Balanced Core/)).toBeInTheDocument();
  });
  it('proposals list: failing counts and stale flag; status filter is sent', async () => {
    const { user, api } = await mountPage(<PortfolioLabPage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Saved proposals' }));
    expect(await screen.findByText('8 (2 failing)')).toBeInTheDocument();
    expect(screen.getByText(/· stale/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'PROPOSED');
    await waitFor(() => expect(api.calls('GET /api/v1/portfolio-lab/rebalances').at(-1)!.query.get('status')).toBe('PROPOSED'));
  });
  it('proposal modal: Create draft orders disabled when stale or mandate breached (with reason); enabled path posts after confirm', async () => {
    const { user, api } = await mountPage(<PortfolioLabPage />, { routes: base({ 'POST /api/v1/portfolio-lab/rebalances/r1/orders': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Saved proposals' }));
    await user.click(await screen.findByText('RBL-1001'));
    const dlg = await screen.findByRole('dialog');
    const create = await within(dlg).findByRole('button', { name: 'Create draft orders' });
    expect(create).toBeEnabled();
    await user.click(create);
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Create draft orders' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolio-lab/rebalances/r1/orders'));
    expectIdempotencyKey(req!);
  });
  it('stale or breached proposals cannot create orders and say why', async () => {
    const { user } = await mountPage(<PortfolioLabPage />, { routes: base({ 'GET /api/v1/portfolio-lab/rebalances/:id': ok(rebal({ stale: true, constraintsPassed: false })) }) });
    await user.click(await screen.findByRole('tab', { name: 'Saved proposals' }));
    await user.click(await screen.findByText('RBL-1001'));
    const create = await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Create draft orders' });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('title', 'The mandate is breached after these trades');
    expect(screen.getByText(/more than a day old/)).toBeInTheDocument();
  });
  it('ADB-007/012: user lacking orders.create sees a disabled Create draft orders naming that permission; Discard needs manage', async () => {
    const { user } = await mountPage(<PortfolioLabPage />, { perms: ['portfolio.view', 'portfolio.manage'], routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Saved proposals' }));
    await user.click(await screen.findByText('RBL-1001'));
    const dlg = await screen.findByRole('dialog');
    const create = await within(dlg).findByRole('button', { name: 'Create draft orders' });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('title', 'Needs the orders.create permission');
    expect(within(dlg).getByText('Creating orders needs the orders.create permission.')).toBeInTheDocument();
  });
  it('discard requires a reason and posts it', async () => {
    const { user, api } = await mountPage(<PortfolioLabPage />, { routes: base({ 'POST /api/v1/portfolio-lab/rebalances/r1/discard': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Saved proposals' }));
    await user.click(await screen.findByText('RBL-1001'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Discard' }));
    await user.type(screen.getByLabelText(/Reason/), 'Prices moved');
    await user.click(screen.getAllByRole('button', { name: 'Discard' }).at(-1)!);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/portfolio-lab/rebalances/r1/discard'));
    expectBody(req!, { reason: 'Prices moved' });
  });
  it('created-orders proposals list their order refs', async () => {
    const { user } = await mountPage(<PortfolioLabPage />, { routes: base({ 'GET /api/v1/portfolio-lab/rebalances/:id': ok(rebal({ status: 'ORDERS_CREATED', lines: [line({ orderRef: 'ORD-2001' }), line({ securityId: 's2', orderRef: 'ORD-2002' })] })) }) });
    await user.click(await screen.findByRole('tab', { name: 'Saved proposals' }));
    await user.click(await screen.findByText('RBL-1001'));
    expect(await screen.findByText(/Draft orders are in Orders: ORD-2001, ORD-2002/)).toBeInTheDocument();
  });
});
