import { describe, it, expect } from 'vitest';
import SecuritiesPage from '@/app/(ops)/ops/securities/page';
import { expectBody, expectCalled, expectIdempotencyKey, fail, screen, waitFor, within } from '../../_helpers';
import { D, SEC, created, mountPage, without } from './_kit';

const mdStatus = (over: Record<string, unknown> = {}) => ({
  provider: 'public', scheduler: true, staleAfterBusinessDays: 5,
  sources: [{ source: 'ZSE', label: 'ZSE end of day', url: 'https://zse.test', note: '', lastAttemptAt: null, lastSuccessAt: '2026-10-01T10:00:00Z', lastStatus: 'OK', lastError: null, lastCount: 20, consecutiveFailures: 0, backoffUntil: null, stale: false }],
  runs: [{ revertible: true, id: 'run-1', trigger: 'MANUAL', scope: 'EOD', status: 'OK', startedAt: '2026-10-01T10:00:00Z', accepted: 3, rejected: 1, errors: 0, skipped: 0 }],
  securities: [
    { id: 'sec-1', ticker: 'DLTA', market: 'VFEX', currency: 'USD', price: '1.25', priceDate: '2026-08-20', priceSource: 'ZSE', ageBusinessDays: 27, stale: true, publicSource: true, provenance: null },
    { id: 'sec-2', ticker: 'ECO', market: 'ZSE', currency: 'ZWG', price: '5.00', priceDate: '2026-10-01', priceSource: 'ZSE', ageBusinessDays: 0, stale: false, publicSource: true, provenance: null },
  ],
  fx: [],
  exceptions: [{ id: 'x1', refType: 'PRICE', ticker: 'DLTA', source: 'ZSE', status: 'OPEN', reason: 'Price moved -94%', url: 'https://zse.test', fetchedAt: '2026-10-01T10:00:00Z', seenCount: 1, rawValue: '0.07' }],
  ...over,
});
const feedStatus = { mode: 'fake', live: { configured: false, requiredEnv: [], missingEnv: [], note: '' }, formats: ['CSV'], counterparties: [], files: [] };
const sroutes = (extra = {}) => ({ 'GET /api/v1/securities': D([SEC]), 'GET /api/v1/market-data/status': D(mdStatus()), 'GET /api/v1/custodian-feed/status': D(feedStatus), ...extra });

describe('Securities and market data', () => {
  it('lists instruments and filters by market through the API', async () => {
    const { api, user } = mountPage(<SecuritiesPage />, { routes: sroutes() });
    expect(await screen.findByText('Delta Corporation')).toBeInTheDocument();
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'VFEX');
    await waitFor(() => expect(api.calls('GET /api/v1/securities').at(-1)!.query.get('market')).toBe('VFEX'));
  });

  it('Set price posts date, comma-stripped price and MANUAL source with a key', async () => {
    const { api, user } = mountPage(<SecuritiesPage />, { routes: sroutes({ 'POST /api/v1/securities/sec-1/prices': created({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Set price' }));
    const d = await screen.findByRole('dialog');
    await user.clear(within(d).getByLabelText(/Price \(USD\)/));
    await user.type(within(d).getByLabelText(/Price \(USD\)/), '1,300.50');
    await user.click(within(d).getByRole('button', { name: 'Save price' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/securities/sec-1/prices'));
    expectBody(req, { price: '1300.50', source: 'MANUAL' });
    expectIdempotencyKey(req);
  });

  it('Set price is hidden without portfolio.manage', async () => {
    mountPage(<SecuritiesPage />, { perms: without('portfolio.manage'), routes: sroutes() });
    await screen.findByText('Delta Corporation');
    expect(screen.queryByRole('button', { name: 'Set price' })).not.toBeInTheDocument();
  });

  it('ADA-008: market data panel flags stale prices with count and business-day limit; stale-only filter works', async () => {
    const { user } = mountPage(<SecuritiesPage />, { routes: sroutes() });
    expect(await screen.findByText(/1 of 2 securities have a stale or missing price \(older than 5 business days\)/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/stale only/));
    expect(screen.queryByText('ECO')).not.toBeInTheDocument();
  });

  it('Refresh now posts the scope and reports counts', async () => {
    const result = { provider: 'public', scope: 'ALL', status: 'OK', accepted: 3, unchanged: 1, rejected: 0, errors: 0, skipped: 2, overridden: 0, stale: 1 };
    const { api, user } = mountPage(<SecuritiesPage />, { routes: sroutes({ 'POST /api/v1/market-data/refresh': D(result) }) });
    await user.click(await screen.findByRole('button', { name: 'Refresh now' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/market-data/refresh')))[0], { scope: 'ALL', force: false });
    expect(await screen.findByText(/Refresh ok: 3 updated, 1 unchanged/)).toBeInTheDocument();
  });

  it('ADB-024: a revertible run can be undone only with a reason of 5+ characters', async () => {
    const { api, user } = mountPage(<SecuritiesPage />, { routes: sroutes({ 'POST /api/v1/market-data/runs/run-1/undo': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Undo run' }));
    const d = await screen.findByRole('dialog');
    const go = within(d).getByRole('button', { name: 'Undo run' });
    expect(go).toBeDisabled();
    await user.type(within(d).getByLabelText(/Reason/), 'abc');
    expect(go).toBeDisabled();
    await user.type(within(d).getByLabelText(/Reason/), 'de bad prices');
    await user.click(go);
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/market-data/runs/run-1/undo')))[0], { reason: 'abcde bad prices' });
  });

  it('ADB-024: undo refusal from the API is shown in the dialog', async () => {
    const { user } = mountPage(<SecuritiesPage />, { routes: sroutes({ 'POST /api/v1/market-data/runs/run-1/undo': fail(409, 'conflict', 'A NAV already used these prices') }) });
    await user.click(await screen.findByRole('button', { name: 'Undo run' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Reason/), 'wrong feed');
    await user.click(within(d).getByRole('button', { name: 'Undo run' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent(/A NAV already used these prices/);
  });

  it('ADB-024: exceptions list shows the rejected price reason and Acknowledge posts', async () => {
    const { api, user } = mountPage(<SecuritiesPage />, { routes: sroutes({ 'POST /api/v1/market-data/exceptions/x1/acknowledge': D({}) }) });
    expect(await screen.findByText('Price moved -94%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/market-data/exceptions/x1/acknowledge'));
  });

  it('status endpoint failure is an error message, not a crash of the securities list', async () => {
    mountPage(<SecuritiesPage />, { routes: sroutes({ 'GET /api/v1/market-data/status': fail(500, 'internal', 'feed down') }) });
    expect(await screen.findByText('Delta Corporation')).toBeInTheDocument();
    expect(await screen.findByText(/Could not load market data status: feed down/)).toBeInTheDocument();
  });
});
