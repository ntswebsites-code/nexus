import { describe, it, expect, vi, beforeEach } from 'vitest';
import PerformancePage from '@/app/(ops)/ops/performance/page';
import PeriodPage from '@/app/(ops)/ops/performance/[id]/page';
import { pct, plainPct, bpsText, tone } from '@/ops/performance';
import { mountPage } from './_kit';
import { setParams } from './_params';
import { ok, raw, fail, screen, within, waitFor, router, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

vi.mock('next/navigation', async () => {
  const m = (await import('../../_helpers/next-mocks')).navigationMock;
  const p = await import('./_params');
  return { ...m, useParams: () => p.params.current };
});
beforeEach(() => setParams({}));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const row = (over: Record<string, unknown> = {}) => ({
  portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', benchmarkName: 'MSCI ACWI', periodStart: '2026-01-01', periodEnd: daysAgo(1),
  twrPct: '4.25', benchmarkPct: '3.10', activePct: '1.15', baseCurrency: 'USD', lastOfficial: { ref: 'PRD-1001', periodEnd: '2026-06-30' }, ...over,
});
const returns = (over: Record<string, unknown> = {}) => ({
  portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', periodStart: '2026-01-01', periodEnd: '2026-08-26', startValue: '1000', endValue: '1042.5', netFlows: '0', twrPct: '4.25', benchmarkPct: '3.1', activePct: '1.15', dayCount: 237, baseCurrency: 'USD',
  benchmark: { id: 'b1', code: 'ACWI', name: 'MSCI ACWI' }, series: [{ date: '2026-01-02', value: 1000, flow: 0, ret: 0, cum: 0, bench: 0, benchCum: 0 }, { date: '2026-01-03', value: 1010, flow: 0, ret: 0.01, cum: 0.01, bench: 0.005, benchCum: 0.005 }],
  issues: { missingPrice: [], missingFx: [], stale: [], gapDays: 0 },
  controls: [{ key: 'ibor', title: 'IBOR control', description: 'd', state: 'warn', detail: 'No holdings reconciliation run' }, { key: 'val', title: 'Valuation control', description: 'd', state: 'done', detail: 'ok' }],
  controlsPending: 1, navCheck: { ref: 'NAV-1001', nav: '1042.50', computed: '1042.10', diffPct: '0.04' }, method: 'Daily geometric chaining', ...over,
});
const bm = [
  { id: 'b1', code: 'ACWI', name: 'MSCI ACWI', status: 'ACTIVE', totalWeightPct: '100', constituents: [{ id: 'c1', securityId: 's1', ticker: 'ABC', name: 'ABC', sector: 'Banks', weightPct: '60' }, { id: 'c2', securityId: 's2', ticker: 'XYZ', name: 'XYZ', sector: 'Tech', weightPct: '40' }] },
  { id: 'b2', code: 'LIB3', name: 'USD LIBOR + 3%', status: 'ACTIVE', totalWeightPct: '0', constituents: [] },
];
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/performance/summary': raw({ data: [row(), row({ portfolioId: 'p2', portfolioName: 'Platinum', benchmarkName: 'USD LIBOR + 3%', benchmarkPct: null, activePct: null })] }),
  'GET /api/v1/performance/benchmarks': ok(bm),
  'GET /api/v1/performance/returns': ok(returns()),
  'GET /api/v1/performance/attribution': ok({ ...returns(), segments: [{ sector: 'Banks', avgWeightPct: '60', benchWeightPct: '55', allocationBps: 3.2, selectionBps: -1.1, interactionBps: 0.2, totalBps: 2.3, portfolioReturnPct: '5', benchmarkReturnPct: '4' }], totals: { allocationBps: 3.2, selectionBps: -1.1, interactionBps: 0.2, explainedBps: 2.3, activeBps: 115, unexplainedBps: 112.7 }, contributions: [{ securityId: 's1', ticker: 'ABC', name: 'ABC Holdings', sector: 'Banks', avgWeightPct: '60', returnPct: '5', contributionBps: 300, benchWeightPct: '55', startValue: '1', endValue: '2' }] }),
  'GET /api/v1/performance/periods': raw({ data: [{ id: 'per1', ref: 'PRD-1001', portfolioId: 'p1', version: 2, status: 'LOCKED', official: true, twrPct: '4.2', benchmarkPct: '3', activePct: '1.2', periodStart: '2026-01-01', periodEnd: '2026-06-30', makerName: 'Maker M', checkerName: 'Checker C' }], total: 1 }),
  ...o,
});

describe('Performance page', () => {
  it('lists TWR per portfolio, defaults to the first portfolio, shows tabs and tiles with real fields', async () => {
    const { api } = await mountPage(<PerformancePage />, { routes: base() });
    expect(await screen.findByText('Balanced Growth Fund', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getAllByText('+4.25%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PRD-1001 to 30 Jun 2026').length).toBe(2);
    await waitFor(() => expectCalled(api, 'GET /api/v1/performance/returns'));
    expect(api.calls('GET /api/v1/performance/returns')[0]!.query.get('portfolioId')).toBe('p1');
    expect(await screen.findByText('USD 1,042.50')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Official-return controls' })).toBeInTheDocument();
  });
  it('ADB-006: stale price history shows an amber banner with the gap; fresh data shows none', async () => {
    const stale = row({ periodEnd: '2026-08-26' });
    await mountPage(<PerformancePage />, { routes: base({ 'GET /api/v1/performance/summary': raw({ data: [stale] }) }) });
    expect(await screen.findByText(/Price history ends 26 Aug 2026, \d+ days before today/)).toBeInTheDocument();
  });
  it('ADB-006: no banner when the series is current', async () => {
    await mountPage(<PerformancePage />, { routes: base() });
    await screen.findByText('Balanced Growth Fund', { selector: 'strong' });
    expect(screen.queryByText(/Price history ends/)).not.toBeInTheDocument();
  });
  it('ADB-006: period form hints say to confirm dates and that end cannot be in the future', async () => {
    const { user } = await mountPage(<PerformancePage />, { routes: base() });
    await user.click(await screen.findByRole('button', { name: 'Prepare official period' }));
    expect(screen.getByText("Pre-filled from the portfolio's price history; confirm both dates")).toBeInTheDocument();
    expect(screen.getByText('Cannot be in the future')).toBeInTheDocument();
    const end = screen.getByLabelText(/Period end/) as HTMLInputElement;
    expect(end.max).toBe(new Date().toISOString().slice(0, 10));
  });
  it('ADB-006: benchmark column explains "No composition" instead of a bare dash', async () => {
    await mountPage(<PerformancePage />, { routes: base() });
    const el = await screen.findByText('No composition');
    expect(el).toHaveAttribute('title', expect.stringContaining('no constituent composition loaded'));
  });
  it('ADB-005: controls tab shows warning controls with evidence text and pending count; NAV cross-check', async () => {
    const { user } = await mountPage(<PerformancePage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Official-return controls' }));
    expect(await screen.findByText('1 control(s) still to clear')).toBeInTheDocument();
    expect(screen.getByText('No holdings reconciliation run')).toBeInTheDocument();
    expect(screen.getByLabelText('Needs attention')).toBeInTheDocument();
    expect(screen.getByLabelText('Done')).toBeInTheDocument();
    expect(screen.getByText(/NAV-1001 1,042.50 vs computed 1,042.10 \(0.04% apart\)/)).toBeInTheDocument();
  });
  it('attribution tab: Brinson rows in bps; no-benchmark empty state; contributions drill to positions and orders', async () => {
    const { user } = await mountPage(<PerformancePage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Allocation & selection' }));
    expect((await screen.findAllByText('+3.2 bps')).length).toBeGreaterThan(0);
    expect(screen.getByText('Linking, trading and timing')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Contributions' }));
    expect(await screen.findByText('ABC Holdings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Positions' })).toHaveAttribute('href', expect.stringContaining('/ops-native/ibor/position?portfolioId=p1&securityId=s1'));
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/ops-native/orders?q=ABC');
  });
  it('attribution tab explains when no benchmark composition exists', async () => {
    const { user } = await mountPage(<PerformancePage />, { routes: base({ 'GET /api/v1/performance/attribution': ok({ ...returns(), benchmark: null, segments: [], totals: {}, contributions: [] }) }) });
    await user.click(await screen.findByRole('tab', { name: 'Allocation & selection' }));
    expect(await screen.findByText(/No benchmark composition is attached/)).toBeInTheDocument();
  });
  it('returns warnings for missing price / FX / stale are listed', async () => {
    await mountPage(<PerformancePage />, { routes: base({ 'GET /api/v1/performance/returns': ok(returns({ issues: { missingPrice: ['ABC'], missingFx: ['ZWG'], stale: ['XYZ'], gapDays: 3 } })) }) });
    expect(await screen.findByText(/No price: ABC\./)).toBeInTheDocument();
    expect(screen.getByText(/No FX rate: ZWG\./)).toBeInTheDocument();
  });
  it('Prepare official period posts the dates with an idempotency key and opens the new period', async () => {
    const { user, api } = await mountPage(<PerformancePage />, { routes: base({ 'POST /api/v1/performance/periods': ok({ id: 'per9' }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'Prepare official period' }));
    const dlg = screen.getByRole('dialog');
    const s = within(dlg).getByLabelText(/Period start/) as HTMLInputElement;
    await user.clear(s);
    await user.type(s, '2026-02-01');
    await user.click(within(dlg).getByRole('button', { name: 'Prepare draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/performance/periods'));
    expectBody(req!, { portfolioId: 'p1', periodStart: '2026-02-01' });
    expectIdempotencyKey(req!);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/performance/per9'));
  });
  it('prepare errors (e.g. future date) show in the dialog and keep it open', async () => {
    const { user } = await mountPage(<PerformancePage />, { routes: base({ 'POST /api/v1/performance/periods': fail(400, 'validation_error', 'Validation failed', undefined) }) });
    await user.click(await screen.findByRole('button', { name: 'Prepare official period' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Prepare draft' }));
    expect(await screen.findByText(/Validation failed/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('without reports.create there is no Prepare button; without reports.view the screen explains', async () => {
    await mountPage(<PerformancePage />, { perms: ['reports.view'], routes: base() });
    await screen.findByText('Balanced Growth Fund', { selector: 'strong' });
    expect(screen.queryByRole('button', { name: 'Prepare official period' })).not.toBeInTheDocument();
  });
  it('without reports.view the screen explains', async () => {
    await mountPage(<PerformancePage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the reports.view permission/)).toBeInTheDocument();
  });
  it('date filters are sent to the summary; empty summary shows an empty state', async () => {
    const { user, api } = await mountPage(<PerformancePage />, { routes: base({ 'GET /api/v1/performance/summary': raw({ data: [] }) }) });
    expect(await screen.findByText('No portfolios yet.')).toBeInTheDocument();
    const to = screen.getByLabelText(/^To/);
    await user.type(to, '2026-05-01');
    await waitFor(() => expect(api.calls('GET /api/v1/performance/summary').at(-1)!.query.get('to')).toBe('2026-05-01'));
  });
  it('periods tab lists official periods with maker and checker names; benchmarks tab lists compositions', async () => {
    const { user } = await mountPage(<PerformancePage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Periods' }));
    expect(await screen.findByText('Maker M')).toBeInTheDocument();
    expect(screen.getByText('Checker C')).toBeInTheDocument();
    expect(screen.getByText('official')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Benchmarks' }));
    expect(await screen.findByText('ABC 60.0% · XYZ 40.0%')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });
  it('composition editor: Save disabled until weights total 100, then PUTs weights as strings', async () => {
    const { user, api } = await mountPage(<PerformancePage />, {
      routes: base({
        'GET /api/v1/securities': ok([{ id: 's1', ticker: 'ABC', name: 'ABC' }, { id: 's2', ticker: 'XYZ', name: 'XYZ' }]),
        'PUT /api/v1/performance/benchmarks/:id/constituents': ok({}),
      }),
    });
    await user.click(await screen.findByRole('tab', { name: 'Benchmarks' }));
    await user.click((await screen.findAllByRole('button', { name: 'Edit composition' }))[0]!);
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText('Total 100.0000%')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Save composition' })).toBeEnabled();
    const w = within(dlg).getAllByLabelText('Weight percent')[1]!;
    await user.clear(w);
    await user.type(w, '30');
    expect(within(dlg).getByText(/Total 90\.0000% \(must be 100\)/)).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Save composition' })).toBeDisabled();
    await user.type(within(dlg).getByLabelText(/Cash sleeve/), '10');
    expect(within(dlg).getByRole('button', { name: 'Save composition' })).toBeEnabled();
    await user.click(within(dlg).getByRole('button', { name: 'Save composition' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/performance/benchmarks/b1/constituents'));
    expect(req!.body).toEqual({ constituents: [{ securityId: 's1', weightPct: '60' }, { securityId: 's2', weightPct: '30' }, { securityId: null, sector: 'Cash', weightPct: '10' }] });
    expectIdempotencyKey(req!);
  });
  it('new benchmark posts code and name', async () => {
    const { user, api } = await mountPage(<PerformancePage />, { routes: base({ 'POST /api/v1/performance/benchmarks': ok({ id: 'b3' }, 201) }) });
    await user.click(await screen.findByRole('tab', { name: 'Benchmarks' }));
    await user.click(await screen.findByRole('button', { name: 'New benchmark' }));
    await user.type(screen.getByLabelText(/^Code/), 'NEW1');
    await user.type(screen.getByLabelText(/^Name/), 'New bench');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/performance/benchmarks'));
    expectBody(req!, { code: 'NEW1', name: 'New bench' });
  });
  it('helpers format percentages, bps and tone', () => {
    expect(pct('1.5')).toBe('+1.50%');
    expect(pct('-0.5')).toBe('-0.50%');
    expect(pct(null)).toBe('—');
    expect(plainPct('12.345', 1)).toBe('12.3%');
    expect(bpsText(-4.25)).toBe('-4.3 bps');
    expect(bpsText(null)).toBe('—');
    expect(tone('0')).toBeUndefined();
    expect(tone(1)).toContain('green');
    expect(tone(-1)).toContain('red');
  });
});

describe('Performance period detail', () => {
  const period = (o: Record<string, unknown> = {}) => ({
    id: 'per1', ref: 'PRD-1002', portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', benchmarkId: 'b1', periodStart: '2026-01-01', periodEnd: '2026-06-30', version: 1, status: 'DRAFT', official: false,
    makerId: 'usr_admin', makerName: 'Test Admin', checkerId: null, checkerName: null, lockedAt: null, lockNote: null, supersedesId: null, correctionReason: null, createdAt: '2026-07-01T10:00:00Z',
    startValue: '1000', endValue: '1050', netFlows: '0', twrPct: '5', benchmarkPct: null, activePct: null, dayCount: 180, baseCurrency: 'USD',
    series: [], attribution: null, contributions: null, controls: [{ key: 'ibor', title: 'IBOR control', description: 'd', state: 'warn', detail: 'No holdings reconciliation run' }], controlsPending: 1, navCheck: null,
    stale: false, dataHash: 'abcdef0123456789abcdef', canLock: false, ...o,
  });
  const go = (p: Record<string, unknown>, perms: string[]) => {
    setParams({ id: 'per1' });
    return mountPage(<PeriodPage />, { perms, routes: { 'GET /api/v1/performance/periods/:id': ok(p), 'POST /api/v1/performance/periods/:id/lock': ok({}), 'POST /api/v1/performance/periods/:id/recompute': ok({}), 'POST /api/v1/performance/periods/:id/correct': ok({ id: 'per2' }) } });
  };
  it('maker cannot lock: button disabled with the SoD reason (maker-checker)', async () => {
    await go(period(), ['reports.create']);
    await screen.findByText('PRD-1002', { exact: false });
    expect(screen.getAllByText('You prepared this period, so a different person must lock it.').length).toBeGreaterThan(0);
  });
  it('a different user holding performance.lock with all controls clear can lock; lock posts note with key', async () => {
    const p = period({ makerId: 'someone-else', controlsPending: 0, controls: [{ key: 'ibor', title: 'IBOR control', description: 'd', state: 'done', detail: 'ok' }] });
    const { user, api } = await go(p, ['reports.create', 'performance.lock']);
    const lock = await screen.findByRole('button', { name: 'Lock official return' });
    expect(lock).toBeEnabled();
    await user.click(lock);
    await user.type(screen.getByLabelText('Note'), 'Reviewed');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lock as Official' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/performance/periods/per1/lock'));
    expectBody(req!, { note: 'Reviewed' });
    expectIdempotencyKey(req!);
    await waitFor(() => expect(api.calls('GET /api/v1/performance/periods/per1').length).toBeGreaterThan(1)); // reload
  });
  it('ADB-005: pending controls block locking with the count; stale draft says recompute first', async () => {
    await go(period({ makerId: 'o' }), ['performance.lock']);
    const lock = await screen.findByRole('button', { name: 'Lock official return' });
    expect(lock).toBeDisabled();
    expect(lock.getAttribute('title')).toMatch(/control/i);
    expect(screen.getByText('Official-return controls: 1 to clear')).toBeInTheDocument();
  });
  it('stale draft: recompute first', async () => {
    await go(period({ makerId: 'o', stale: true }), ['performance.lock', 'reports.create']);
    expect((await screen.findAllByText(/Recompute it first/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Recompute' })).toBeEnabled();
  });
  it('locked period offers Start correction with a required reason; superseded is read-only', async () => {
    const { user, api } = await go(period({ status: 'LOCKED', official: true, checkerName: 'C', lockedAt: '2026-07-02T00:00:00Z' }), ['reports.create']);
    await user.click(await screen.findByRole('button', { name: 'Start correction' }));
    const reason = screen.getByLabelText(/Reason/);
    expect(reason).toBeRequired();
    await user.type(reason, 'Fee accrual missed');
    await user.click(screen.getByRole('button', { name: 'Create correction draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/performance/periods/per1/correct'));
    expectBody(req!, { reason: 'Fee accrual missed' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/performance/per2'));
  });
  it('superseded shows the read-only notice; locked shows Official label', async () => {
    await go(period({ status: 'SUPERSEDED' }), ['reports.create']);
    expect(await screen.findByText(/A later version replaced this period/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start correction' })).not.toBeInTheDocument();
  });
  it('unknown period shows not found; no request body leaks', async () => {
    setParams({ id: 'nope' });
    const { api } = await mountPage(<PeriodPage />, { routes: { 'GET /api/v1/performance/periods/:id': fail(404, 'not_found', 'Period not found') } });
    expect(await screen.findByText(/Not found/)).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/performance/periods/nope/lock');
  });
});
