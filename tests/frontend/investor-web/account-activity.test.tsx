import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpAccountActivityScreen } from '@/components/lp-portal/screens/lp-account-activity-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, within, expectCalled, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, list, FUND_PE, FUND_OE, useNodeBlob } from './_lp';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() }) }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

// Entry shapes exactly as services/activity.ts emits them.
const entry = (over: Record<string, unknown> = {}) => ({
  entryId: 'alloc-13', entryType: 'CAPITAL_CALL', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', operatingModel: 'PRIVATE_CAPITAL', structure: 'PRIVATE_CAPITAL',
  transactionDate: '2026-05-01', amount: '200000.00', currency: 'USD', description: 'Capital call #13 — 4.00%', status: 'OPEN', ...over,
});
const ENTRIES = [
  entry(),
  entry({ entryId: 'pay-1', entryType: 'CAPITAL_CALL_PAYMENT', transactionDate: '2026-05-10', amount: '50000.00', description: 'Capital call #13 payment received', status: 'POSTED' }),
  entry({ entryId: 'dist-1', entryType: 'DISTRIBUTION', transactionDate: '2026-04-01', amount: '-10000.00', description: 'Distribution DIST-007 declared (dividend)', status: 'PAID' }),
  entry({ entryId: 'dr-1', entryType: 'SUBSCRIPTION', fundId: FUND_OE.fundId, fundName: 'Balanced Growth Fund', operatingModel: 'OPEN_ENDED', structure: 'OPEN_ENDED', transactionDate: '2026-03-01', amount: '25000.00', description: 'Subscription request DR-100', status: 'AWAITING_FUNDS' }),
];

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/account-activity`]: ok(list(ENTRIES)),
    [`GET ${API}/ledger/:id`]: ok({ entryType: 'CAPITAL_CALL', payments: [], documents: [] }),
    [`GET ${API}/account-activity/export`]: ok({}),
    ...over,
  } as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
});
const ready = async () => within(await screen.findByRole('table')).findByText('Subscription request DR-100');

describe('Account activity', () => {
  it('renders every entry from the API with fund names, descriptions and title-cased statuses (no raw enum, no id)', async () => {
    const api = liveApi(routes());
    renderLp(<LpAccountActivityScreen />);
    await ready();
    const t = within(screen.getByRole('table'));
    expect(t.getByText('Capital call #13 payment received')).toBeInTheDocument();
    expect(t.getByText('Distribution DIST-007 declared (dividend)')).toBeInTheDocument();
    expect(t.getAllByText('Growth Fund I').length).toBeGreaterThan(0);
    expect(t.getByText('Awaiting Funds')).toBeInTheDocument();
    expect(t.queryByText('AWAITING_FUNDS')).not.toBeInTheDocument();
    expect(t.queryByText(FUND_PE.fundId)).not.toBeInTheDocument();
    expect(api.calls(`GET ${API}/account-activity`)[0].query.get('pageSize')).toBe('100');
    expectNoUnmocked();
  });

  it('first row is selected by default and its ledger entry is fetched by id', async () => {
    const api = liveApi(routes());
    renderLp(<LpAccountActivityScreen />);
    await ready();
    await waitFor(() => expectCalled(api, `GET ${API}/ledger/:id`));
    expect(api.calls(`GET ${API}/ledger/:id`)[0].path).toMatch(/\/ledger\/alloc-13$/);
  });

  it('ledger detail failure toasts the API message', async () => {
    liveApi(routes({ [`GET ${API}/ledger/:id`]: fail(404, 'LP_NOT_FOUND', 'Ledger entry not found') }));
    renderLp(<LpAccountActivityScreen />);
    await ready();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ledger entry not found'));
  });

  it('structure filter from the URL shows only that structure', async () => {
    liveApi(routes());
    renderLp(<LpAccountActivityScreen initialStructure="open-ended" />);
    const t = within(await screen.findByRole('table'));
    await t.findByText('Subscription request DR-100');
    expect(t.queryByText('Capital call #13 payment received')).not.toBeInTheDocument();
  });

  it('empty result renders no rows and no crash', async () => {
    liveApi(routes({ [`GET ${API}/account-activity`]: ok(list([])) }));
    renderLp(<LpAccountActivityScreen />);
    expect(await screen.findByText('Account Activity')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Subscription request DR-100')).not.toBeInTheDocument());
  });

  it('list failure shows the error with Retry that refetches', async () => {
    let broken = true; // the screen loads twice on mount (before/after the session), so fail by state, not by call count
    const api = liveApi(routes({ [`GET ${API}/account-activity`]: () => (broken ? fail(500, 'INTERNAL', 'Activity unavailable') : ok(list(ENTRIES))) }));
    const { user } = renderLp(<LpAccountActivityScreen />);
    expect(await screen.findByText(/Activity unavailable/)).toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(api.calls(`GET ${API}/account-activity`).length).toBeGreaterThanOrEqual(2);
  });

  it.each([['Export CSV', 'csv', 'CSV exported.'], ['Export Excel', 'xlsx', 'EXCEL exported.'], ['Export PDF', 'pdf', 'PDF exported.']])('%s requests format=%s and toasts', async (label, fmt, msg) => {
    useNodeBlob();
    const api = liveApi(routes());
    const { user } = renderLp(<LpAccountActivityScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(msg));
    expect(expectCalled(api, `GET ${API}/account-activity/export`)[0].query.get('format')).toBe(fmt);
  });

  it('export failure surfaces the API message', async () => {
    useNodeBlob();
    liveApi(routes({ [`GET ${API}/account-activity/export`]: fail(403, 'LP_FORBIDDEN', 'No export permission') }));
    const { user } = renderLp(<LpAccountActivityScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No export permission'));
  });
});
