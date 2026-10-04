import { describe, it, expect, vi } from 'vitest';
import ReportsPage from '@/app/(ops)/ops/reports/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const defs = [
  { key: 'HOLDINGS', name: 'Holdings report', description: 'Positions at a date', category: 'Portfolio', paramSpec: [{ name: 'portfolioId', label: 'Portfolio', type: 'portfolio', required: true }, { name: 'asOf', label: 'As of', type: 'date', required: false }], runs: 3, lastRunAt: '2026-08-20T10:00:00Z' },
  { key: 'FACT_SHEET', name: 'Fund fact sheet', description: 'LP fact sheet', category: 'Fund', paramSpec: [{ name: 'fundId', label: 'Fund', type: 'fund', required: true }], runs: 1, lastRunAt: null },
];
const run = (o: Record<string, unknown> = {}) => ({ id: 'run1', ref: 'RPT-1001', report: 'FACT_SHEET', reportName: 'Fund fact sheet', title: 'Fact sheet Growth Fund', format: 'PDF', status: 'COMPLETED', params: { fundId: 'abcdef12-3456-7890' }, rowCount: 14, sha256: 'x', error: null, requestedBy: 'Rita R', createdAt: '2026-08-20T10:00:00Z', hasFile: true, distributedAt: null, distributedBy: null, scheduleId: null, deliveredAt: null, deliveryNote: null, ...o });
const sched = (o: Record<string, unknown> = {}) => ({ id: 'sc1', name: 'Monthly fact sheet', report: 'FACT_SHEET', reportName: 'Fund fact sheet', format: 'PDF', frequency: 'MONTHLY', nextRunOn: '2026-10-03T00:00:00.000Z', lastRunAt: null, active: true, rolling: 'PREVIOUS_MONTH', recipients: ['a@x.test'], emailAttach: true, lpDeliver: false, lpDeliverApprovedBy: null, createdBy: 'Rita R', ...o });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/reports/lookups': ok({ funds: [{ id: 'f1', ref: 'FND-1', name: 'Growth Fund' }], portfolios: [{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }], formats: ['CSV', 'PDF'], frequencies: ['MONTHLY', 'WEEKLY'], rollingWindows: ['PREVIOUS_MONTH'] }),
  'GET /api/v1/reports/catalogue': ok(defs),
  'GET /api/v1/reports/runs': raw({ data: [run(), run({ id: 'run2', ref: 'RPT-1002', report: 'HOLDINGS', status: 'FAILED', error: 'No portfolio data', hasFile: false })], total: 2 }),
  'GET /api/v1/reports/schedules': ok([sched()]),
  ...o,
});
const VIEW = ['reports.view'];

describe('Reports catalogue and generation', () => {
  it('lists reports with run counts; Generate is disabled with a reason without reports.create', async () => {
    await mountPage(<ReportsPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText('Holdings report')).toBeInTheDocument();
    expect(screen.getByText(/Portfolio - 3 runs, last/)).toBeInTheDocument();
    expect(screen.getByText(/Fund - 1 run$/)).toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: 'Generate' })) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', 'Needs reports.create');
    }
  });
  it('Generate: required parameter fields are rendered from the spec; posts key, format and only filled params with an idempotency key; then jumps to Generated reports', async () => {
    const { user, api } = await mountPage(<ReportsPage />, { routes: base({ 'POST /api/v1/reports/runs': ok({ id: 'run9' }, 201) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Generate' }))[0]!);
    const dlg = screen.getByRole('dialog');
    const portfolio = within(dlg).getByLabelText(/^Portfolio/);
    expect(portfolio).toBeRequired();
    expect(within(dlg).getByLabelText(/^As of/)).not.toBeRequired();
    await user.selectOptions(portfolio, 'p1');
    await user.selectOptions(within(dlg).getByLabelText(/^Format/), 'PDF');
    await user.click(within(dlg).getByRole('button', { name: 'Generate' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/reports/runs'));
    expect(req!.body).toEqual({ key: 'HOLDINGS', format: 'PDF', params: { portfolioId: 'p1' } });
    expectIdempotencyKey(req!);
    expect(await screen.findByRole('tab', { name: 'Generated reports', selected: true })).toBeInTheDocument();
  });
  it('generation failure is shown in the dialog', async () => {
    const { user } = await mountPage(<ReportsPage />, { routes: base({ 'POST /api/v1/reports/runs': fail(400, 'validation_error', 'Validation failed', undefined) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Generate' }))[1]!);
    const dlg = screen.getByRole('dialog');
    await user.selectOptions(within(dlg).getByLabelText(/^Fund/), 'f1');
    await user.click(within(dlg).getByRole('button', { name: 'Generate' }));
    expect(await within(dlg).findByText(/Validation failed/)).toBeInTheDocument();
  });
  it('without reports.view: message and no catalogue request', async () => {
    const { api } = await mountPage(<ReportsPage />, { perms: [], routes: base() });
    expect(await screen.findByText('You do not have permission to view reports.')).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/reports/catalogue');
  });
});

describe('Reports: generated runs', () => {
  const runsTab = async (perms?: string[], routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<ReportsPage />, { perms, routes: base(routes) });
    await m.user.click(await screen.findByRole('tab', { name: 'Generated reports' }));
    await screen.findByText('RPT-1001');
    return m;
  };
  it('shows run refs, status, failure reason, short param ids; Download disabled when no file', async () => {
    await runsTab(VIEW);
    expect(screen.getByText('No portfolio data')).toBeInTheDocument();
    expect(screen.getAllByText('fundId: abcdef12').length).toBe(2);
    const failedRow = screen.getByText('RPT-1002').closest('tr')!;
    expect(within(failedRow).getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(within(screen.getByText('RPT-1001').closest('tr')!).getByRole('button', { name: 'Download' })).toBeEnabled();
  });
  it('Download fetches a signed link then opens it in a new tab with noopener', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user, api } = await runsTab(VIEW, { 'GET /api/v1/reports/runs/:id/link': raw({ data: { url: 'https://files.example/r1?sig=1' } }) });
    await user.click(within(screen.getByText('RPT-1001').closest('tr')!).getByRole('button', { name: 'Download' }));
    await waitFor(() => expectCalled(api, 'GET /api/v1/reports/runs/run1/link'));
    expect(open).toHaveBeenCalledWith('https://files.example/r1?sig=1', '_blank', 'noopener');
    open.mockRestore();
  });
  it('report filter and paging go to the API', async () => {
    const { user, api } = await runsTab(VIEW);
    await user.selectOptions(screen.getByLabelText('Report'), 'HOLDINGS');
    await waitFor(() => expect(api.calls('GET /api/v1/reports/runs').at(-1)!.query.get('report')).toBe('HOLDINGS'));
    expect(api.calls('GET /api/v1/reports/runs').at(-1)!.query.get('limit')).toBe('25');
  });
  it('email needs reports.create and a completed run; recipients are split on commas/spaces and sent with a key', async () => {
    const { user, api } = await runsTab(['reports.view', 'reports.create'], { 'POST /api/v1/reports/runs/:id/email': ok({}) });
    expect(screen.getAllByRole('button', { name: 'Email' })).toHaveLength(1); // the failed run has none
    await user.click(screen.getByRole('button', { name: 'Email' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Email addresses/), 'a@x.test, b@x.test;c@x.test');
    await user.click(within(dlg).getByRole('checkbox'));
    await user.click(within(dlg).getByRole('button', { name: 'Send' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/reports/runs/run1/email'));
    expect(req!.body).toEqual({ recipients: ['a@x.test', 'b@x.test', 'c@x.test'], attach: true });
    expectIdempotencyKey(req!);
  });
  it('LP portal distribution: approvers only, after in-app confirm, key sent; hidden once sent', async () => {
    const none = await runsTab(['reports.view', 'reports.create']);
    expect(screen.queryByRole('button', { name: 'Send to LP portal' })).not.toBeInTheDocument();
    none.unmount();
    const { user, api } = await runsTab(['reports.view', 'reports.approve'], { 'POST /api/v1/reports/runs/:id/distribute': ok({}) });
    await user.click(screen.getByRole('button', { name: 'Send to LP portal' }));
    expect(within(screen.getByRole('dialog')).getByText(/Publish RPT-1001 to every investor/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send to LP portal' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/reports/runs/run1/distribute'));
    expectIdempotencyKey(req!);
  });
  it('already distributed runs show "Sent <date>" and no resend button', async () => {
    await runsTab(['reports.view', 'reports.approve'], { 'GET /api/v1/reports/runs': raw({ data: [run({ distributedAt: '2026-08-21T09:00:00Z', distributedBy: 'Approver A' })], total: 1 }) });
    expect(screen.getByText(/Sent 2026-08-21/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to LP portal' })).not.toBeInTheDocument();
  });
  it('empty state', async () => {
    const { user } = await mountPage(<ReportsPage />, { routes: base({ 'GET /api/v1/reports/runs': raw({ data: [], total: 0 }) }) });
    await user.click(await screen.findByRole('tab', { name: 'Generated reports' }));
    expect(await screen.findByText(/No reports generated yet/)).toBeInTheDocument();
  });
});

describe('Reports: schedules (ADB-017)', () => {
  const schedTab = async (perms?: string[], routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<ReportsPage />, { perms, routes: base(routes) });
    await m.user.click(await screen.findByRole('tab', { name: 'Schedules' }));
    await screen.findByText('Monthly fact sheet');
    return m;
  };
  it('ADB-017: Next run is shown as dd Mon yyyy (UTC calendar day, no time-zone shift) with an explanatory tooltip', async () => {
    await schedTab(VIEW);
    const cell = screen.getByText('03 Oct 2026');
    expect(cell).toHaveAttribute('title', expect.stringContaining('Run now does not move this date'));
  });
  it('shows frequency, rolling window label, mail count with file, state', async () => {
    await schedTab(VIEW);
    expect(screen.getByText('Mails 1 with file')).toBeInTheDocument();
    expect(screen.getByText('Previous month')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });
  it('viewer has no create/run/pause controls; creator can Run now (key) and Pause (PATCH active:false)', async () => {
    const v = await schedTab(VIEW);
    expect(screen.queryByRole('button', { name: 'New schedule' })).not.toBeInTheDocument();
    v.unmount();
    const { user, api } = await schedTab(['reports.view', 'reports.create'], { 'POST /api/v1/reports/schedules/:id/run-now': ok({}), 'PATCH /api/v1/reports/schedules/:id': ok({}) });
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/reports/schedules/sc1/run-now'));
    expectIdempotencyKey(r!);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    const [p] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/reports/schedules/sc1'));
    expectBody(p!, { active: false });
  });
  it('LP delivery needs the approver permission and a confirm warning that creators cannot approve their own schedule', async () => {
    const { user, api } = await schedTab(['reports.view', 'reports.approve'], { 'POST /api/v1/reports/schedules/:id/lp-delivery': ok({}) });
    await user.click(screen.getByRole('button', { name: 'Deliver to LP portal' }));
    expect(within(screen.getByRole('dialog')).getByText(/You cannot approve a schedule you created/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deliver to LP portal' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/reports/schedules/sc1/lp-delivery'));
    expectBody(req!, { enabled: true });
  });
  it('SoD server refusal on LP delivery reads as a different-approver message', async () => {
    const { user } = await schedTab(['reports.view', 'reports.approve'], { 'POST /api/v1/reports/schedules/:id/lp-delivery': fail(409, 'segregation_of_duties', 'You created this schedule') });
    await user.click(screen.getByRole('button', { name: 'Deliver to LP portal' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deliver to LP portal' }));
    expect(await screen.findByText('A different approver is required. You created this schedule')).toBeInTheDocument();
  });
  it('New schedule posts report key, name, format, frequency, rolling window and parsed recipients', async () => {
    const { user, api } = await schedTab(['reports.view', 'reports.create'], { 'POST /api/v1/reports/schedules': ok({}, 201) });
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Name/), 'Weekly holdings');
    await user.selectOptions(within(dlg).getAllByRole('combobox').find((c) => within(c).queryByText('Holdings report'))!, 'HOLDINGS');
    await user.selectOptions(within(dlg).getByLabelText(/^Portfolio/), 'p1');
    await user.type(within(dlg).getByLabelText(/Email each run to/), 'a@x.test b@x.test');
    await user.click(within(dlg).getByRole('button', { name: 'Create schedule' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/reports/schedules'));
    expectBody(req!, { key: 'HOLDINGS', name: 'Weekly holdings', frequency: 'MONTHLY', format: 'CSV', rolling: 'PREVIOUS_MONTH', recipients: ['a@x.test', 'b@x.test'] });
    expectIdempotencyKey(req!);
  });
  it('empty schedules state', async () => {
    const { user } = await mountPage(<ReportsPage />, { routes: base({ 'GET /api/v1/reports/schedules': ok([]) }) });
    await user.click(await screen.findByRole('tab', { name: 'Schedules' }));
    expect(await screen.findByText('No schedules yet.')).toBeInTheDocument();
  });
});
