import { describe, it, expect } from 'vitest';
import IntegrationsPage from '@/app/(ops)/ops/integrations/page';
import { mountPage } from './_kit';
import { ok, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const adapter = (o: Record<string, unknown> = {}) => ({
  name: 'market-data', label: 'Market data', gap: 'GAP-004', description: 'Prices and FX', flag: 'MARKET_DATA_MODE', mode: 'fake', requiredEnv: ['VENDOR_KEY', 'VENDOR_URL'], missingEnv: ['VENDOR_KEY'], vendorCalls: { quote: 'GET /quote' }, health: { ok: true, detail: 'Simulated provider' }, productionWarning: false, failure: null, calls: 12, errors24h: 1,
  lastCall: { at: '2026-08-26T10:00:00Z', operation: 'refresh', status: 'OK', durationMs: 42 }, lastError: { at: '2026-08-26T09:00:00Z', operation: 'refresh', message: 'Timeout talking to vendor' }, ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/admin-core/integrations': ok([adapter(), adapter({ name: 'kyc', label: 'KYC provider', gap: 'GAP-009', failure: { mode: 'error', remaining: 3 }, health: { ok: false, detail: 'Failing by simulation' }, lastCall: null, lastError: null })]),
  'GET /api/v1/admin-core/integrations/calls': ok([{ id: 'c1', adapter: 'market-data', mode: 'fake', operation: 'refresh', status: 'OK', durationMs: 42, error: null, correlationId: 'corr-1', at: '2026-08-26T10:00:00Z' }]),
  'GET /api/v1/admin-core/integrations/calls/:id': ok({ id: 'c1', adapter: 'market-data', mode: 'fake', operation: 'refresh', status: 'OK', durationMs: 42, error: null, correlationId: 'corr-1', at: '2026-08-26T10:00:00Z', requestHash: 'abc', request: { a: 1 }, result: { b: 2 } }),
  'GET /api/v1/admin-core/integrations/inbox': ok([{ id: 'i1', adapter: 'kyc', kind: 'SCREENING', externalRef: 'EXT-1', status: 'PENDING', payload: { x: 1 }, at: '2026-08-26T10:00:00Z', processedAt: null }]),
  ...o,
});
const ADM = ['admin.settings'];

describe('Integrations: adapters', () => {
  it('lists adapters with mode, health, last call, errors and last error text', async () => {
    await mountPage(<IntegrationsPage />, { perms: ADM, routes: base() });
    expect(await screen.findByText('Market data')).toBeInTheDocument();
    expect(screen.getByText('Timeout talking to vendor')).toBeInTheDocument();
    expect(screen.getByText('failing x3')).toBeInTheDocument();
    expect(screen.getByText('unhealthy')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('refresh · OK · 42 ms')).toBeInTheDocument();
  });
  it('warns when adapters are still simulated in a production build (and not otherwise)', async () => {
    const a = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'GET /api/v1/admin-core/integrations': ok([adapter({ productionWarning: true })]) }) });
    expect(await screen.findByText(/1 adapter\(s\) are still simulated in this production build: Market data/)).toBeInTheDocument();
    a.unmount();
    await mountPage(<IntegrationsPage />, { perms: ADM, routes: base() });
    await screen.findByText('Market data');
    expect(screen.queryByText(/still simulated in this production build/)).not.toBeInTheDocument();
  });
  it('Test call posts and shows pass/fail with duration inline', async () => {
    const { user, api } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'POST /api/v1/admin-core/integrations/:name/test': ok({ name: 'market-data', mode: 'fake', ok: false, durationMs: 31, error: 'Vendor 401' }) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Test call' }))[0]!);
    await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/integrations/market-data/test'));
    expect(await screen.findByText('Test failed in 31 ms: Vendor 401')).toBeInTheDocument();
  });
  it('details show required env vars (missing ones flagged) and the vendor call descriptions', async () => {
    const { user } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base() });
    await user.click((await screen.findAllByRole('button', { name: 'Details' }))[0]!);
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText('VENDOR_KEY (not set)')).toBeInTheDocument();
    expect(within(dlg).getByText('VENDOR_URL')).toBeInTheDocument();
    expect(within(dlg).getByText(/GET \/quote/)).toBeInTheDocument();
  });
  it('ADB-022: failure-simulation copy says 0 fails every call until Clear restores service; Start failing PUTs mode and count; Clear is disabled when not failing', async () => {
    const { user, api } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'PUT /api/v1/admin-core/integrations/:name/failure': ok({}) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Details' }))[0]!);
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/Enter 0 to fail every call until you press Clear, which restores normal service/)).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Clear' })).toBeDisabled();
    await user.clear(within(dlg).getByLabelText(/Number of calls to fail/));
    await user.type(within(dlg).getByLabelText(/Number of calls to fail/), '5');
    await user.click(within(dlg).getByRole('button', { name: 'Start failing' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/admin-core/integrations/market-data/failure'));
    expectBody(req!, { mode: 'error', count: 5 });
    expect(await screen.findByText('Market data: failure simulation on.')).toBeInTheDocument();
  });
  it('a live adapter explains that switching mode is an environment change (no failure simulation)', async () => {
    const { user } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'GET /api/v1/admin-core/integrations': ok([adapter({ mode: 'live' })]) }) });
    await user.click(await screen.findByRole('button', { name: 'Details' }));
    expect(within(screen.getByRole('dialog')).getByText(/environment change \(MARKET_DATA_MODE\) followed by an API and worker restart/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Start failing' })).not.toBeInTheDocument();
  });
  it('"Calls" jumps to the call log filtered by that adapter', async () => {
    const { user, api } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base() });
    await user.click((await screen.findAllByRole('button', { name: 'Calls' }))[1]!);
    await waitFor(() => expect(api.calls('GET /api/v1/admin-core/integrations/calls').at(-1)!.query.get('adapter')).toBe('kyc'));
  });
  it('without admin.settings the page explains and calls nothing; load errors surface', async () => {
    const a = await mountPage(<IntegrationsPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask a System Administrator for the admin.settings permission/)).toBeInTheDocument();
    expectNotCalled(a.api, 'GET /api/v1/admin-core/integrations');
    a.unmount();
    await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'GET /api/v1/admin-core/integrations': fail(500, 'x', 'Registry offline') }) });
    expect(await screen.findByText(/Could not load integrations: Registry offline/)).toBeInTheDocument();
  });
});

describe('Integrations: simulated feeds (ADA-019 / ADB-022 / ADB-024)', () => {
  const runFeed = async (reply: unknown) => {
    const m = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'POST /api/v1/market-data/simulate': reply as never }) });
    await m.user.click(await screen.findByRole('button', { name: 'Market data: prices and FX' }));
    await m.user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Run feed' }));
    return m;
  };
  it('ADA-019: Run feed for market data calls the guarded /market-data/simulate route (not the old admin-core sync) with a key', async () => {
    const { api } = await runFeed(ok({ status: 'COMPLETED', accepted: 20, unchanged: 3, rejected: 0 }, 201));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/market-data/simulate'));
    expectIdempotencyKey(req!);
    expectNotCalled(api, 'POST /api/v1/admin-core/integrations/market-data/sync');
  });
  it('ADB-022: the result is a plain sentence with counts and a pointer to Undo run, not raw JSON', async () => {
    await runFeed(ok({ status: 'COMPLETED', accepted: 20, unchanged: 3, rejected: 0 }, 201));
    expect(await screen.findByText(/Market data feed completed: 20 price\/FX values accepted, 3 unchanged, 0 rejected by the sanity bounds\. The run can be reversed with Undo run under Recent refreshes on the Securities page\./)).toBeInTheDocument();
    expect(screen.queryByText(/\{"/)).not.toBeInTheDocument();
  });
  it('ADB-024: rejected values point to the exceptions list', async () => {
    await runFeed(ok({ status: 'PARTIAL', accepted: 5, unchanged: 0, rejected: 4 }, 201));
    expect(await screen.findByText(/4 rejected by the sanity bounds \(see Securities, Market data feed, Open exceptions\)/)).toBeInTheDocument();
  });
  it('ADA-019: the 409 refusal for non-fake providers is shown instead of being swallowed', async () => {
    await runFeed(fail(409, 'simulation_not_allowed', 'Simulated feeds only run while the market-data provider is the fake one.'));
    expect(await screen.findByText(/Simulated feeds only run while the market-data provider is the fake one/)).toBeInTheDocument();
  });
  it('ADB-022: other feeds report counts in words ("prices created: 3") not raw JSON', async () => {
    const { user, api } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'GET /api/v1/cash/ledgers': ok([{ id: 'l1', ref: 'LED-1', name: 'Operating' }]), 'POST /api/v1/admin-core/integrations/bank-statement/simulate': ok({ linesCreated: 4, openingBalance: '0.00' }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'Bank statement (CAMT.053)' }));
    const dlg = screen.getByRole('dialog');
    await within(dlg).findByRole('option', { name: /LED-1 Operating/ });
    await user.click(within(dlg).getByRole('button', { name: 'Run feed' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/integrations/bank-statement/simulate'));
    expectBody(req!, { ledgerId: 'l1', openingBalance: '0.00' });
    expect(await screen.findByText('Simulate bank statement: lines created: 4, opening balance: 0.00')).toBeInTheDocument();
  });
  it('custodian package: needs a custodian, account reference; posts counterparty, account and currency', async () => {
    const { user, api } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'GET /api/v1/ops/counterparties': ok({ items: [{ id: 'cp1', ref: 'CP-001', name: 'Custody Bank', accounts: ['ACC-1'] }] }), 'POST /api/v1/admin-core/integrations/custodian-feed/simulate': ok({ positions: 2 }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'Custodian day-end package' }));
    const dlg = screen.getByRole('dialog');
    await user.selectOptions(await within(dlg).findByLabelText(/^Custodian/), 'cp1');
    await user.type(within(dlg).getByLabelText(/Account reference/), 'ACC-1');
    await user.click(within(dlg).getByRole('button', { name: 'Run feed' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/integrations/custodian-feed/simulate'));
    expectBody(req!, { counterpartyId: 'cp1', accountRef: 'ACC-1', currency: 'USD' });
  });
});

describe('Integrations: call log and inbox', () => {
  it('call log lists calls; detail opens with the request and result', async () => {
    const { user, api } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Call log' }));
    expect(await screen.findByText('refresh')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Detail' }));
    await waitFor(() => expectCalled(api, 'GET /api/v1/admin-core/integrations/calls/c1'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
  it('call log outcome filter is sent to the API', async () => {
    const { user, api } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Call log' }));
    await screen.findByText('refresh');
    const sel = screen.getByLabelText('Outcome');
    const value = (sel.querySelectorAll('option')[1] as HTMLOptionElement).value;
    await user.selectOptions(sel, value);
    await waitFor(() => expect(api.calls('GET /api/v1/admin-core/integrations/calls').at(-1)!.query.get('status')).toBe(value));
  });
  it('inbox lists what fake adapters would have sent; empty state', async () => {
    const { user } = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Simulated inbox' }));
    expect(await screen.findByText('EXT-1')).toBeInTheDocument();
    const e = await mountPage(<IntegrationsPage />, { perms: ADM, routes: base({ 'GET /api/v1/admin-core/integrations/inbox': ok([]) }) });
    await e.user.click((await screen.findAllByRole('tab', { name: 'Simulated inbox' })).at(-1)!);
    expect(await screen.findByText('Nothing simulated yet.')).toBeInTheDocument();
  });
});
