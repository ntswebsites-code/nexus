import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpPerformanceScreen } from '@/components/lp-portal/screens/lp-performance-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, within, expectCalled, expectNotCalled, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, FUND_PE, FUND_OE, useNodeBlob } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);
// recharts cannot lay out in jsdom; the numbers and tables are what is verified here
vi.mock('recharts', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, ResponsiveContainer: ({ children }: { children?: unknown }) => null };
});

const PERF = {
  asOfDate: '2026-06-30', valuationStatus: 'FINAL', period: 'SI', calculationDate: '2026-07-01', version: '1', sourceModule: 'valuation', reportingCurrency: 'USD', approvedBy: 'cfo',
  metrics: { totalCommitment: '5000000.00', paidIn: '3000000.00', distributions: '750000.00', currentNav: '4420000.00', netIrr: '0.1420', tvpi: '1.7233', dpi: '0.2500', rvpi: '1.4733' },
  byFund: [], benchmark: null,
  openEndedMetrics: { ytdReturn: '0.0412', navPerUnit: '1.2500', unitsHeld: '2080000.0000', accountValue: '2600000.00' },
};
const BYFUND = {
  asOfDate: '2026-06-30', valuationStatus: 'FINAL',
  funds: [
    { fundId: FUND_PE.fundId, fundName: 'Growth Fund I', netIrr: '0.1420', tvpi: '1.7233', dpi: '0.25', rvpi: '1.47', nav: '1820000.00', paidIn: '3000000.00', distributions: '750000.00', operatingModel: 'PRIVATE_CAPITAL', structure: 'PRIVATE_CAPITAL' },
    // open-ended: no IRR/TVPI. Must render a dash, never 0.0% / 0.00x
    { fundId: FUND_OE.fundId, fundName: 'Balanced Growth Fund', netIrr: null, tvpi: null, dpi: null, rvpi: null, nav: '2600000.00', paidIn: '0', distributions: '0', operatingModel: 'OPEN_ENDED', structure: 'OPEN_ENDED' },
  ],
};
const HISTORY = { asOfDate: '2026-06-30', valuationStatus: 'FINAL', range: 'SI', points: [{ date: '2026-03-31', label: 'Q1', nav: '4000000', paidIn: '2500000', distributions: '500000' }] };
const BENCH = { metric: 'NET_IRR', asOfDate: '2026-06-30', valuationStatus: 'UNAVAILABLE', configured: false, series: [], note: null };
const STATEMENTS = { asOfDate: '2026-06-30', items: [{ period: '2026-Q2', periodStart: '2026-04-01', periodEnd: '2026-06-30', downloadUrl: '/x', format: 'PDF' }, { period: '2026-Q1', periodStart: '2026-01-01', periodEnd: '2026-03-31', downloadUrl: '/y', format: 'PDF' }] };

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/performance`]: ok(PERF),
    [`GET ${API}/performance/history`]: ok(HISTORY),
    [`GET ${API}/performance/by-fund`]: ok(BYFUND),
    [`GET ${API}/performance/benchmarks`]: ok(BENCH),
    [`GET ${API}/statements`]: ok(STATEMENTS),
    [`GET ${API}/statements/:period/download`]: ok({}),
    [`GET ${API}/performance/report/download`]: ok({ jobId: 'job-1', status: 'QUEUED', createdAt: '2026-07-01T00:00:00Z' }),
    [`GET ${API}/jobs/:id`]: ok({ jobId: 'job-1', jobType: 'PERF', status: 'COMPLETED', createdAt: '2026-07-01T00:00:00Z' }),
    [`GET ${API}/reports/:id/download`]: ok({}),
    ...over,
  } as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
});
const ready = () => screen.findByText('Performance by Fund');

describe('Performance', () => {
  it('shows fund names (not ids) and a dash for open-ended multiples; PERF-1 never 0.0% / 0.00x for an absent measure', async () => {
    const api = liveApi(routes());
    renderLp(<LpPerformanceScreen />);
    await ready();
    const table = within((await screen.findByText('Growth Fund I')).closest('table') as HTMLElement);
    const oe = within(table.getByText('Balanced Growth Fund').closest('tr') as HTMLElement);
    expect(oe.queryByText(/0\.0%|0\.00x/)).not.toBeInTheDocument();
    expect(oe.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    const pe = within(table.getByText('Growth Fund I').closest('tr') as HTMLElement);
    expect(pe.getByText(/14\.2/)).toBeInTheDocument();
    expect(pe.getByText(/1\.72x/)).toBeInTheDocument();
    expect(screen.queryByText(FUND_PE.fundId)).not.toBeInTheDocument();
    expectNoUnmocked();
    expect(api.calls(`GET ${API}/performance`).length).toBeGreaterThanOrEqual(1);
  });

  it('LPC-025: "View All Funds" goes to /lp-portal/performance (the non-existent investments page is gone)', async () => {
    liveApi(routes());
    renderLp(<LpPerformanceScreen />);
    await ready();
    const link = screen.getByRole('link', { name: /View All Funds/ });
    expect(link).toHaveAttribute('href', '/lp-portal/performance');
    expect(document.querySelector('a[href*="/lp-portal/investments"]')).toBeNull();
  });

  it('load failure shows the error with Try Again that refetches', async () => {
    let broken = true;
    const api = liveApi(routes({ [`GET ${API}/performance`]: () => (broken ? fail(500, 'INTERNAL', 'Performance unavailable') : ok(PERF)) }));
    const { user } = renderLp(<LpPerformanceScreen />);
    expect(await screen.findByText(/Performance unavailable/)).toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    await ready();
    expect(api.calls(`GET ${API}/performance`).length).toBeGreaterThanOrEqual(2);
  });

  it('statement download: first period preselected, period in the URL path, success toast', async () => {
    useNodeBlob();
    const api = liveApi(routes());
    const { user } = renderLp(<LpPerformanceScreen />);
    await ready();
    const btn = await screen.findByRole('button', { name: 'Download Statement' });
    await waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Statement downloaded'));
    const [r] = expectCalled(api, `GET ${API}/statements/:period/download`);
    expect(r.path).toContain('/statements/2026-Q2/download');
  });

  it('statement download failure surfaces the API message', async () => {
    useNodeBlob();
    liveApi(routes({ [`GET ${API}/statements/:period/download`]: fail(403, 'LP_FORBIDDEN', 'You do not have download permission') }));
    const { user } = renderLp(<LpPerformanceScreen />);
    await ready();
    const btn = await screen.findByRole('button', { name: 'Download Statement' });
    await user.click(btn);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You do not have download permission'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('no statements available: the statement control is not offered', async () => {
    liveApi(routes({ [`GET ${API}/statements`]: ok({ asOfDate: '2026-06-30', items: [] }) }));
    renderLp(<LpPerformanceScreen />);
    await ready();
    expect(screen.queryByRole('button', { name: 'Download Statement' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Report' })).toBeInTheDocument();
  });

  it('performance report: requests the job, polls until COMPLETED, downloads by job id', async () => {
    useNodeBlob();
    const api = liveApi(routes());
    const { user } = renderLp(<LpPerformanceScreen />);
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Download Report' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Performance report downloaded'));
    expectCalled(api, `GET ${API}/performance/report/download`);
    expectCalled(api, `GET ${API}/jobs/:id`);
    expect(expectCalled(api, `GET ${API}/reports/:id/download`)[0].path).toContain('/reports/job-1/download');
  });

  it('performance report job FAILED shows its error message and downloads nothing', async () => {
    const api = liveApi(routes({ [`GET ${API}/jobs/:id`]: ok({ jobId: 'job-1', jobType: 'PERF', status: 'FAILED', errorMessage: 'No approved valuation', createdAt: 'x' }) }));
    const { user } = renderLp(<LpPerformanceScreen />);
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Download Report' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No approved valuation'));
    expectNotCalled(api, `GET ${API}/reports/:id/download`);
  });
});
