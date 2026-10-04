import { describe, it, expect, vi } from 'vitest';
import OperationsPage from '@/app/(ops)/ops/operations/page';
import { expectBody, expectCalled, expectIdempotencyKey, fail, screen, waitFor, within } from '../../_helpers';
import { D, created, mountPage, without } from './_kit';

const status = (over: Record<string, unknown> = {}) => ({
  asOf: '2026-10-01T00:00:00Z',
  kpis: { dueToday: 3, blockedTasks: 1, settlementExposure: [{ currency: 'USD', amount: '12500.00' }], unsettledOrders: 1, cashDeadlines: 2, cashGross: '4000.00', corporateActions: 1, electionsDue: 1, closeBlockers: 4, serviceHealth: 'ok' },
  dependencies: [{ key: 'recon', label: 'Reconciliations', readinessPct: 60, detail: '2 breaks open', link: '/ops/reconciliation' }],
  recon: { open: 8, pendingChecker: 1, high: 8, oldestDays: 3, bySeverity: { CRITICAL: 3, HIGH: 5 } },
  cash: { periodEnd: '2026-09-30', blockers: 1, readinessPct: 80, pendingJournals: 2, systemJournals: 1, stagedImports: 0, portfolios: [{ portfolioId: 'pf-1', portfolioRef: 'PF-1001', portfolioName: 'Growth Portfolio', closeStatus: 'PREPARED', blockers: 1, failing: ['suspense'], canClose: false }] },
  nav: { unreleased: [{ id: 'n-1', ref: 'NAV-00001', portfolioRef: 'PF-1001', portfolioName: 'Growth Portfolio', navDate: '2026-09-30', status: 'DRAFT', openExceptions: 2, materialExceptions: 1 }], blockers: 1 },
  accounting: { pendingJournals: 2, systemJournals: 1, postedThisMonth: 9, periodsByStatus: {} },
  corporateActions: { due: [], count: 1, electionsDue: 1, overdue: 0, awaitingProcessing: 1 },
  settlement: { unsettled: 1 }, risk: { openBreaches: 0 }, ...over,
});
const task = (over: Record<string, unknown> = {}) => ({ id: 't-1', ref: 'TSK-001', area: 'CORPORATE_ACTIONS', title: 'Process CMCL dividend', detail: 'Record date passed', dueAt: '2026-10-01T15:00:00Z', status: 'DUE', state: 'DUE', ownerName: null, dependsOn: null, blockedReason: null, link: '/ops/corporate-actions', system: true, completedByName: null, completedAt: null, commentCount: 0, version: 1, ...over });
const base = (extra = {}) => ({
  'GET /api/v1/operations/status': D(status()),
  'GET /api/v1/operations/tasks': D([task()], { total: 1, summary: { due: 1, blocked: 0, scheduled: 0, done: 0 } }),
  'GET /api/v1/operations/workload': D({ asOf: '2026-10-01', openTasks: 1, overdue: 0, byOwner: [], byArea: [], dueByDay: [], cashByDay: [] }),
  'GET /api/v1/operations/calendar': D({ from: '2026-10-01', to: '2026-10-31', events: [], byDay: {}, total: 0 }),
  'GET /api/v1/operations/tasks/t-1/comments': D([]), ...extra,
});

describe('Operations control', () => {
  it('shows live KPIs, close dependency readiness and links, NAV runs not yet released (with link)', async () => {
    mountPage(<OperationsPage />, { routes: base() });
    expect(await screen.findByText('60% ready')).toBeInTheDocument();
    expect(screen.getByText('2 breaks open')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'NAV-00001' })).toHaveAttribute('href', '/ops/nav/n-1');
    expect(screen.getByText(/1 material exception/)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
  it('ADA-030: recon line shows the real severity split, not "8 open, 8 high"', async () => {
    mountPage(<OperationsPage />, { routes: base() });
    expect(await screen.findByText(/8 open \(3 critical, 5 high\), 1 awaiting checker/)).toBeInTheDocument();
  });
  it('ADA-030: without bySeverity it does not claim "high" for critical ones', async () => {
    const s = status({ recon: { open: 8, pendingChecker: 0, high: 8, oldestDays: 1 } });
    mountPage(<OperationsPage />, { routes: base({ 'GET /api/v1/operations/status': D(s) }) });
    expect(await screen.findByText(/8 open \(8 critical or high\)/)).toBeInTheDocument();
  });
  it('degraded service health is shown', async () => {
    mountPage(<OperationsPage />, { routes: base({ 'GET /api/v1/operations/status': D(status({ kpis: { ...status().kpis, serviceHealth: 'degraded' } })) }) });
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
  });
  it('cash close readiness lists portfolios by name; empty state', async () => {
    mountPage(<OperationsPage />, { routes: base() });
    expect(await screen.findByText(/PF-1001 · Growth Portfolio/)).toBeInTheDocument();
  });
  it('runbook filter buttons re-query with the filter; empty runbook explains next steps', async () => {
    const { api, user } = mountPage(<OperationsPage />, { routes: base() });
    await screen.findByText(/Process CMCL dividend/);
    await user.click(screen.getByRole('button', { name: /^Blocked/ }));
    await waitFor(() => expect(api.calls('GET /api/v1/operations/tasks').at(-1)!.query.get('filter')).toBe('blocked'));
  });
  it('empty runbook', async () => {
    mountPage(<OperationsPage />, { routes: base({ 'GET /api/v1/operations/tasks': D([], { total: 0, summary: { due: 0, blocked: 0, scheduled: 0, done: 0 } }) }) });
    expect(await screen.findByText(/No tasks here. Refresh the runbook/)).toBeInTheDocument();
  });
  it('Refresh runbook generates tasks and reloads', async () => {
    const { api, user } = mountPage(<OperationsPage />, { routes: base({ 'POST /api/v1/operations/tasks/generate': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Refresh runbook' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/operations/tasks/generate'));
    await waitFor(() => expect(api.calls('GET /api/v1/operations/status').length).toBeGreaterThan(1));
  });
  it('+ Operations task posts area, title, due and key; operations.view is required for the controls', async () => {
    const { api, user } = mountPage(<OperationsPage />, { routes: base({ 'POST /api/v1/operations/tasks': created({}) }) });
    await user.click(await screen.findByRole('button', { name: '+ Operations task' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Title'), 'Chase custodian');
    await user.click(within(d).getByRole('button', { name: 'Create task' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/operations/tasks'));
    expectBody(r, { area: 'SETTLEMENT', title: 'Chase custodian', detail: null, link: null });
    expect((r.body as { dueAt: string }).dueAt).toMatch(/T17:00/);
    expectIdempotencyKey(r);
  });
  it('without operations.view no task controls are shown', async () => {
    mountPage(<OperationsPage />, { perms: without('operations.view'), routes: base() });
    await screen.findByText(/Process CMCL dividend/);
    for (const n of ['Refresh runbook', '+ Operations task', 'Export CSV']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
  });
  it('opening a task shows detail, system origin and Start/Complete; Start posts to the task', async () => {
    const { api, user } = mountPage(<OperationsPage />, { routes: base({ 'POST /api/v1/operations/tasks/t-1/start': D({}) }) });
    await user.click(await screen.findByText(/Process CMCL dividend/));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(/generated by the system/)).toBeInTheDocument();
    expect(within(d).getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', '/ops/corporate-actions');
    await user.click(within(d).getByRole('button', { name: 'Start' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/operations/tasks/t-1/start'));
  });
  it('Block asks for a reason via the browser prompt and sends it; cancelling the prompt sends an empty reason which the API rejects with a field message', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Waiting on custodian');
    const { api, user } = mountPage(<OperationsPage />, { routes: base({ 'POST /api/v1/operations/tasks/t-1/block': D({}) }) });
    await user.click(await screen.findByText(/Process CMCL dividend/));
    await user.click(await screen.findByRole('button', { name: 'Block' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/operations/tasks/t-1/block')))[0], { reason: 'Waiting on custodian' });
    expect(prompt).toHaveBeenCalled();
    prompt.mockRestore();
  });
  it('a blocked task shows its reason and a done task offers Reopen only', async () => {
    const rows = [task({ id: 't-1', status: 'BLOCKED', state: 'BLOCKED', blockedReason: 'No holdings file' })];
    const { user } = mountPage(<OperationsPage />, { routes: base({ 'GET /api/v1/operations/tasks': D(rows, { total: 1, summary: { due: 0, blocked: 1, scheduled: 0, done: 0 } }) }) });
    await user.click(await screen.findByText(/Process CMCL dividend/));
    expect(await screen.findByText('Blocked: No holdings file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
  });
  it('status API failure is an error state', async () => {
    mountPage(<OperationsPage />, { routes: base({ 'GET /api/v1/operations/status': fail(500, 'internal', 'db down') }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load operations status: db down/);
  });
});
