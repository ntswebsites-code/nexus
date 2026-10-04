import { describe, it, expect } from 'vitest';
import SecuritiesPage from '@/app/(ops)/ops/securities/page';
import { StepUpHost } from '@/ops/StepUp';
import { mountPage } from './_kit';
import { ok, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const sec = (o: Record<string, unknown> = {}) => ({ id: 's1', ticker: 'ABC', name: 'ABC Holdings', market: 'ZSE', sector: 'Banks', assetClass: 'Equity', currency: 'ZWG', status: 'ACTIVE', latestPrice: { price: '1.5000', priceDate: '2026-08-26T00:00:00Z', source: 'VENDOR' }, changePct: '-0.5', history: [{ priceDate: '2026-08-25T00:00:00Z', price: '1.5075', source: 'VENDOR' }], ...o });
const md = (o: Record<string, unknown> = {}) => ({
  provider: 'fake', scheduler: true, staleAfterBusinessDays: 3,
  sources: [{ source: 'ZSE', label: 'ZSE daily', url: 'https://zse.example', note: '', lastAttemptAt: null, lastSuccessAt: '2026-08-26T10:00:00Z', lastStatus: 'OK', lastError: null, lastCount: 40, consecutiveFailures: 0, backoffUntil: null, stale: false }],
  runs: [{ revertible: true, id: 'run1', trigger: 'MANUAL', scope: 'ALL', status: 'OK', startedAt: '2026-08-26T10:00:00Z', accepted: 20, rejected: 2, errors: 0, skipped: 1 }, { revertible: false, id: 'run0', trigger: 'SCHEDULED', scope: 'EOD', status: 'REVERTED', startedAt: '2026-08-25T10:00:00Z', accepted: 5, rejected: 0, errors: 0, skipped: 0 }],
  securities: [{ id: 's1', ticker: 'ABC', market: 'ZSE', currency: 'ZWG', price: '1.5', priceDate: '2026-08-26', priceSource: 'VENDOR', ageBusinessDays: 40, stale: true, publicSource: true, provenance: { source: 'ZSE', url: 'u', fetchedAt: '2026-08-26T10:00:00Z', rawHash: 'abcdef0123456789', status: 'ACCEPTED', reason: null } }, { id: 's2', ticker: 'XYZ', market: 'OTC', currency: 'USD', price: null, priceDate: null, priceSource: null, ageBusinessDays: null, stale: true, publicSource: false, provenance: null }],
  fx: [{ pair: 'ZWG/USD', rate: '0.037', rateDate: '2026-08-26', source: 'RBZ', ageBusinessDays: 40 }],
  exceptions: [{ id: 'ex1', refType: 'PRICE', ticker: 'ABC', source: 'ZSE', status: 'REJECTED', reason: 'Move of 94% exceeds 40%', url: 'u', fetchedAt: '2026-08-26T10:00:00Z', seenCount: 2, rawValue: '0.09' }], ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/securities': ok([sec(), sec({ id: 's2', ticker: 'XYZ', name: 'XYZ Ltd', market: 'OTC', currency: 'USD', latestPrice: null, changePct: null })]),
  'GET /api/v1/securities/:id': ok(sec()),
  'GET /api/v1/market-data/status': ok(md()),
  ...o,
});
const VIEW = ['portfolio.view'];
const MANAGE = ['portfolio.view', 'portfolio.manage'];

describe('Securities and prices', () => {
  it('lists instruments with price, change and date; missing price shows a dash', async () => {
    await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText('ABC Holdings')).toBeInTheDocument();
    expect(screen.getAllByText('1.5000').length).toBeGreaterThan(0);
    expect(screen.getByText('-0.50%')).toBeInTheDocument();
    const xyz = screen.getByText('XYZ Ltd').closest('tr')!;
    expect(within(xyz).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
  it('search and market filters reach the API', async () => {
    const { user, api } = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    await screen.findByText('ABC Holdings');
    await user.type(screen.getByPlaceholderText(/Search ticker, name, ISIN or sector/), 'abc');
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'ZSE');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/securities').at(-1)!.query;
      expect(q.get('q')).toBe('abc');
      expect(q.get('market')).toBe('ZSE');
    });
  });
  it('Set price only for portfolio.manage; posts date, comma-free price, MANUAL source and a key', async () => {
    const v = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    await screen.findByText('ABC Holdings');
    expect(screen.queryByRole('button', { name: 'Set price' })).not.toBeInTheDocument();
    v.unmount();
    const { user, api } = await mountPage(<SecuritiesPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/securities/:id/prices': ok({}, 201) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Set price' }))[0]!);
    const dlg = screen.getByRole('dialog');
    const price = within(dlg).getByLabelText(/^Price \(ZWG\)/);
    expect(price).toHaveValue('1.5000');
    await user.clear(price);
    await user.type(price, '1,600.25');
    await user.click(within(dlg).getByRole('button', { name: 'Save price' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/securities/s1/prices'));
    expect(req!.body).toMatchObject({ price: '1600.25', source: 'MANUAL' });
    expectIdempotencyKey(req!);
  });
  it('the price date input cannot be in the future', async () => {
    const { user } = await mountPage(<SecuritiesPage />, { perms: MANAGE, routes: base() });
    await user.click((await screen.findAllByRole('button', { name: 'Set price' }))[0]!);
    expect(within(screen.getByRole('dialog')).getByLabelText(/Price date/)).toHaveAttribute('max', new Date().toISOString().slice(0, 10));
  });
  it('clicking a row opens price history with source', async () => {
    const { user, api } = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByText('ABC Holdings'));
    expect(await screen.findByText('Price history')).toBeInTheDocument();
    expectCalled(api, 'GET /api/v1/securities/ABC');
    expect(await screen.findByText('1.5075')).toBeInTheDocument();
  });
  it('empty and error states', async () => {
    const a = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base({ 'GET /api/v1/securities': ok([]) }) });
    expect(await screen.findByText('No securities match.')).toBeInTheDocument();
    a.unmount();
    await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base({ 'GET /api/v1/securities': fail(500, 'x', 'Master data down') }) });
    expect(await screen.findByText(/Could not load securities: Master data down/)).toBeInTheDocument();
  });
});

describe('Market data feed panel', () => {
  it('ADA-008: warns with the count of stale or missing prices and the policy age; stale rows are labelled with their age or "no price"', async () => {
    await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText(/2 of 2 securities have a stale or missing price \(older than 3 business days\)/)).toBeInTheDocument();
    expect(screen.getByText('stale 40d')).toBeInTheDocument();
    expect(screen.getByText('no price')).toBeInTheDocument();
    expect(screen.getByText('no free public source: use manual price or a paid feed')).toBeInTheDocument();
  });
  it('ADA-008: no stale banner when every price is fresh; "stale only" filter narrows the table', async () => {
    const fresh = md({ securities: [{ id: 's1', ticker: 'ABC', market: 'ZSE', currency: 'ZWG', price: '1.5', priceDate: '2026-10-01', priceSource: 'VENDOR', ageBusinessDays: 1, stale: false, publicSource: true, provenance: null }] });
    const a = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base({ 'GET /api/v1/market-data/status': ok(fresh) }) });
    await screen.findByText('Market data feed');
    await waitFor(() => expect(screen.queryByText(/have a stale or missing price/)).not.toBeInTheDocument());
    await a.user.click(screen.getByLabelText(/stale only/));
    expect(await screen.findByText('No stale prices.')).toBeInTheDocument();
  });
  it('provider note: fake provider is labelled test data; sources show freshness and errors', async () => {
    await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base({ 'GET /api/v1/market-data/status': ok(md({ sources: [{ source: 'ZSE', label: 'ZSE daily', url: '', note: '', lastAttemptAt: null, lastSuccessAt: null, lastStatus: 'ERROR', lastError: 'HTTP 503', lastCount: 0, consecutiveFailures: 3, backoffUntil: '2026-08-26T12:00:00Z', stale: true }] })) }) });
    expect(await screen.findByText(/test data only/)).toBeInTheDocument();
    expect(screen.getByText('HTTP 503')).toBeInTheDocument();
    expect(screen.getByText('never')).toBeInTheDocument();
    expect(screen.getByText(/Backing off until .* after 3 failures/)).toBeInTheDocument();
  });
  it('Refresh now posts the chosen scope without force and shows a result summary; hidden without portfolio.manage', async () => {
    const v = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    await screen.findByText('Market data feed');
    expect(screen.queryByRole('button', { name: 'Refresh now' })).not.toBeInTheDocument();
    v.unmount();
    const { user, api } = await mountPage(<SecuritiesPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/market-data/refresh': ok({ provider: 'fake', scope: 'FX', status: 'PARTIAL', accepted: 2, unchanged: 1, rejected: 3, errors: 0, skipped: 4, overridden: 1, stale: 0, message: 'Some values rejected' }) }) });
    await user.selectOptions(await screen.findByLabelText('Refresh scope'), 'FX');
    await user.click(screen.getByRole('button', { name: 'Refresh now' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/market-data/refresh'));
    expectBody(req!, { scope: 'FX', force: false });
    expect(await screen.findByText(/Refresh partial: 2 updated, 1 unchanged, 3 rejected, 0 errors, 4 skipped \(no public source\), 1 kept manual\. Some values rejected/)).toBeInTheDocument();
  });
  it('ADA-019: rejected wild moves are shown as exceptions with reason and raw value; managers can acknowledge', async () => {
    const { user, api } = await mountPage(<SecuritiesPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/market-data/exceptions/:id/acknowledge': ok({}) }) });
    expect(await screen.findByText('Move of 94% exceeds 40%')).toBeInTheDocument();
    expect(screen.getByText(/PRICE raw "0\.09"/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/market-data/exceptions/ex1/acknowledge'));
  });
  it('provenance drawer shows every value with status, source page and a short hash', async () => {
    const { user } = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base({ 'GET /api/v1/market-data/securities/:t/provenance': ok({ ticker: 'ABC', rows: [{ id: 'p1', source: 'ZSE', url: 'https://zse.example/abc', fetchedAt: '2026-08-26T10:00:00Z', rawHash: 'abcdef0123456789', rawValue: '1.5', priceDate: '2026-08-26', value: '1.5', previousValue: '1.4', status: 'ACCEPTED', reason: null, seenCount: 1 }] }) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Provenance' }))[0]!);
    expect(await screen.findByText('https://zse.example/abc')).toBeInTheDocument();
    expect(screen.getByText('abcdef0123…')).toBeInTheDocument();
    expect(screen.getByText('1.4000')).toBeInTheDocument();
  });
  it('ADB-024: Undo run only on revertible runs and for managers; reverted runs show their status', async () => {
    const v = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    await screen.findByText('Recent refreshes');
    expect(screen.queryByRole('button', { name: 'Undo run' })).not.toBeInTheDocument();
    v.unmount();
    await mountPage(<SecuritiesPage />, { perms: MANAGE, routes: base() });
    expect(await screen.findAllByRole('button', { name: 'Undo run' })).toHaveLength(1);
    expect(screen.getByText('REVERTED'.toLowerCase())).toBeInTheDocument();
  });
  it('ADB-024: Undo needs a reason of 5+ characters (button disabled until then), sends it, then reloads', async () => {
    const { user, api } = await mountPage(<SecuritiesPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/market-data/runs/:id/undo': ok({ reverted: true }) }) });
    await user.click(await screen.findByRole('button', { name: 'Undo run' }));
    const dlg = screen.getByRole('dialog');
    const go = within(dlg).getByRole('button', { name: 'Undo run' });
    expect(go).toBeDisabled();
    await user.type(within(dlg).getByLabelText(/^Reason/), 'abc');
    expect(go).toBeDisabled();
    await user.type(within(dlg).getByLabelText(/^Reason/), 'de wrong feed');
    expect(go).toBeEnabled();
    await user.click(go);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/market-data/runs/run1/undo'));
    expectBody(req!, { reason: 'abcde wrong feed' });
    await waitFor(() => expect(api.calls('GET /api/v1/market-data/status').length).toBeGreaterThan(1));
  });
  it('ADB-024: undo refusals (superseded / prices in use) are shown in the dialog and it stays open', async () => {
    const { user } = await mountPage(<SecuritiesPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/market-data/runs/:id/undo': fail(409, 'run_superseded', 'A later run changed these prices') }) });
    await user.click(await screen.findByRole('button', { name: 'Undo run' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Wrong feed used');
    await user.click(within(dlg).getByRole('button', { name: 'Undo run' }));
    expect(await within(dlg).findByText(/A later run changed these prices/)).toBeInTheDocument();
  });
  it('ADB-024: Undo requires step-up: the TOTP modal appears, and after the code the SAME undo request is retried', async () => {
    let n = 0;
    const { user, api } = await mountPage(
      <>
        <SecuritiesPage />
        <StepUpHost />
      </>,
      {
        perms: MANAGE,
        routes: base({
          'POST /api/v1/market-data/runs/:id/undo': () => (++n === 1 ? fail(401, 'step_up_required', 'Confirm with your authenticator') : ok({ reverted: true })),
          'POST /api/v1/auth/mfa/step-up': ok({}),
        }),
      },
    );
    await user.click(await screen.findByRole('button', { name: 'Undo run' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Wrong feed used');
    await user.click(within(dlg).getByRole('button', { name: 'Undo run' }));
    await user.type(await screen.findByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.calls('POST /api/v1/market-data/runs/run1/undo')).toHaveLength(2));
    expectBody(api.calls('POST /api/v1/market-data/runs/run1/undo')[1]!, { reason: 'Wrong feed used' });
    expectCalled(api, 'POST /api/v1/auth/mfa/step-up');
  });
  it('FX table and empty sections', async () => {
    await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText('ZWG/USD')).toBeInTheDocument();
    expect(screen.getByText('0.037000')).toBeInTheDocument();
  });
  it('empty exceptions and runs messages; status load failure', async () => {
    const a = await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base({ 'GET /api/v1/market-data/status': ok(md({ exceptions: [], runs: [], fx: [] })) }) });
    expect(await screen.findByText('No open exceptions.')).toBeInTheDocument();
    expect(screen.getByText('No refresh has run yet.')).toBeInTheDocument();
    expect(screen.getByText('No FX rates stored.')).toBeInTheDocument();
    a.unmount();
    await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base({ 'GET /api/v1/market-data/status': fail(500, 'x', 'Status unavailable') }) });
    expect(await screen.findByText(/Could not load market data status: Status unavailable/)).toBeInTheDocument();
    expectNotCalled((await mountPage(<SecuritiesPage />, { perms: VIEW, routes: base() })).api, 'POST /api/v1/market-data/refresh');
  });
});
