import { describe, it, expect } from 'vitest';
import InvestorServicesPage from '@/app/(ops)/ops/investor-services/page';
import { mountPage } from './_kit';
import { raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey } from '../../_helpers';

const req = (o: Record<string, unknown> = {}) => ({ id: 'REQ-2017', clientRef: 'CL-1', client: 'Horizon Pension Fund', type: 'Statement request', priority: 'Normal', title: 'Q2 statement', detail: 'Need Q2', status: 'Open', assignee: null, assigneeId: null, slaDueAt: '2026-09-10T10:00:00Z', sla: 'On track', createdAt: '2026-09-01T10:00:00Z', ageHours: 30, ...o });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/client-ops/staff': raw({ data: [{ id: 'st1', name: 'Sam Staff', email: 's@x.test', roles: [] }] }),
  'GET /api/v1/client-ops/services/summary': raw({ open: 12, unassigned: 3, breached: 2, atRisk: 1, byType: {}, byAssignee: {}, avgResolutionHours: 60, slaMetPct: 88 }),
  'GET /api/v1/client-ops/services/requests': raw({ data: [req(), req({ id: 'REQ-2018', title: 'Waiting one', status: 'Waiting on you', sla: 'Waiting on client', assignee: 'Sam Staff', assigneeId: 'st1' })] }),
  'GET /api/v1/client-ops/services/requests/:id': raw({ request: req(), events: [{ at: '2026-09-01T10:00:00Z', title: 'Logged', detail: null, by: 'Sam Staff' }] }),
  'GET /api/v1/clients': raw({ data: [{ id: 'CL-1', name: 'Horizon Pension Fund' }] }),
  'GET /api/v1/client-ops/services/sla-policies': raw({ data: [{ id: 'pol1', requestType: 'Statement request', priority: 'Normal', targetHours: 72 }, { id: 'pol2', requestType: '*', priority: 'Normal', targetHours: 48 }, { id: 'pol3', requestType: 'Capital Activity', priority: 'Normal', targetHours: 24 }] }),
  ...o,
});
const VIEW = ['clients.view'];

describe('Investor Services queue', () => {
  it('tiles (avg resolution in days/hours, SLA met), rows with names (not ids only), unassigned badge', async () => {
    await mountPage(<InvestorServicesPage />, { routes: base() });
    expect(await screen.findByText('Q2 statement')).toBeInTheDocument();
    expect(screen.getByText('3 unassigned')).toBeInTheDocument();
    expect(screen.getByText('88% closed within SLA')).toBeInTheDocument();
    expect(screen.getByText('3d')).toBeInTheDocument();
    expect(screen.getAllByText('Horizon Pension Fund').length).toBeGreaterThan(0);
    expect(screen.getByText('unassigned')).toBeInTheDocument();
  });
  it('default status filter is the active set; all filters reach the API', async () => {
    const { user, api } = await mountPage(<InvestorServicesPage />, { routes: base() });
    await screen.findByText('Q2 statement');
    expect(api.calls('GET /api/v1/client-ops/services/requests')[0]!.query.get('status')).toBe('Open,In progress,Waiting on you');
    await user.selectOptions(screen.getByLabelText('Type'), 'Complaint');
    await user.selectOptions(screen.getByLabelText('SLA'), 'Waiting on client');
    await user.selectOptions(screen.getByLabelText('Assignee'), 'unassigned');
    await user.type(screen.getByPlaceholderText('Reference, title or client'), 'q2');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/client-ops/services/requests').at(-1)!.query;
      expect(q.get('type')).toBe('Complaint');
      expect(q.get('sla')).toBe('Waiting on client');
      expect(q.get('assignee')).toBe('unassigned');
      expect(q.get('q')).toBe('q2');
    });
  });
  it('ADB-015: "Waiting on you" request shows SLA "waiting on client" (not breached); the SLA filter offers that option', async () => {
    await mountPage(<InvestorServicesPage />, { routes: base() });
    expect(await screen.findByText('waiting on client')).toBeInTheDocument();
    expect(within(screen.getByLabelText('SLA')).getByRole('option', { name: 'Waiting on client' })).toBeInTheDocument();
    const row = screen.getByText('Waiting one').closest('tr')!;
    expect(within(row).queryByText('breached')).not.toBeInTheDocument();
  });
  it('ADB-015: SLA policy tab explains fallback, portal type mapping and paused clock; includes Capital Activity row', async () => {
    const { user } = await mountPage(<InvestorServicesPage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'SLA policy' }));
    expect(await screen.findByText(/The clock is paused while a request is waiting on the client/)).toBeInTheDocument();
    expect(screen.getByText(/Account \/ Statement: Statement request/)).toBeInTheDocument();
    expect(screen.getByText('Capital Activity')).toBeInTheDocument();
    expect(screen.getByText('All other types')).toBeInTheDocument();
    expect(screen.getByText('3d (72h)')).toBeInTheDocument();
  });
  it('without clients.edit: no Log request, no Edit on policies; without clients.view: no access', async () => {
    const { user } = await mountPage(<InvestorServicesPage />, { perms: VIEW, routes: base() });
    await screen.findByText('Q2 statement');
    expect(screen.queryByRole('button', { name: 'Log request' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'SLA policy' }));
    await screen.findByText('Capital Activity');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
  it('no access without clients.view', async () => {
    await mountPage(<InvestorServicesPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the clients.view permission/)).toBeInTheDocument();
  });
  it('empty and error states', async () => {
    const a = await mountPage(<InvestorServicesPage />, { routes: base({ 'GET /api/v1/client-ops/services/requests': raw({ data: [] }) }) });
    expect(await screen.findByText('No requests match.')).toBeInTheDocument();
    a.unmount();
    await mountPage(<InvestorServicesPage />, { routes: base({ 'GET /api/v1/client-ops/services/requests': fail(500, 'x', 'Service desk down') }) });
    expect(await screen.findByText(/Could not load requests: Service desk down/)).toBeInTheDocument();
  });
});

describe('Investor Services actions', () => {
  it('Log request posts client, type, priority, title, detail with an idempotency key', async () => {
    const { user, api } = await mountPage(<InvestorServicesPage />, { perms: [...VIEW, 'clients.edit'], routes: base({ 'POST /api/v1/client-ops/services/requests': raw({}, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'Log request' }));
    const dlg = screen.getByRole('dialog');
    await user.selectOptions(await within(dlg).findByLabelText(/^Client/), 'CL-1');
    await user.type(within(dlg).getByLabelText(/^Title/), 'Transfer query');
    await user.type(within(dlg).getByLabelText(/^Details/), 'Where is it');
    await user.click(within(dlg).getByRole('button', { name: 'Log request' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/services/requests'));
    expectBody(r!, { clientId: 'CL-1', type: 'Query', priority: 'Normal', title: 'Transfer query', detail: 'Where is it' });
    expectIdempotencyKey(r!);
  });
  it('request drawer shows client name, age, timeline; real id REQ-2017 comes from the clicked row (LPC-022 style)', async () => {
    const { user, api } = await mountPage(<InvestorServicesPage />, {
      routes: base({ 'GET /api/v1/client-ops/services/requests/:id': (_q: unknown, p: Record<string, string>) => raw({ request: req({ id: p.id, title: `Detail of ${p.id}` }), events: [] }) }),
    });
    await user.click(await screen.findByText('Waiting one'));
    expect(await screen.findByText('Detail of REQ-2018')).toBeInTheDocument();
    expectCalled(api, 'GET /api/v1/client-ops/services/requests/REQ-2018');
    expect(screen.getByText('No events.')).toBeInTheDocument();
  });
  it('status change posts status, note and notify flag; status options exclude the current status', async () => {
    const { user, api } = await mountPage(<InvestorServicesPage />, { perms: [...VIEW, 'clients.edit'], routes: base({ 'POST /api/v1/client-ops/services/requests/:id/status': raw({}) }) });
    await user.click(await screen.findByText('Q2 statement'));
    await user.click(await screen.findByRole('button', { name: 'Change status' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    const opts = within(within(f).getByLabelText(/^Status/)).getAllByRole('option').map((o) => o.textContent);
    expect(opts).not.toContain('Open');
    await user.selectOptions(within(f).getByLabelText(/^Status/), 'Closed');
    await user.type(within(f).getByLabelText(/Note \/ resolution/), 'Sent');
    await user.click(within(f).getByRole('button', { name: 'Update' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/services/requests/REQ-2017/status'));
    expectBody(r!, { status: 'Closed', note: 'Sent', notifyClient: true });
  });
  it('closed requests have no action buttons; SLA reset requires a 5+ char reason', async () => {
    const closed = await mountPage(<InvestorServicesPage />, { perms: [...VIEW, 'clients.edit'], routes: base({ 'GET /api/v1/client-ops/services/requests/:id': raw({ request: req({ status: 'Closed' }), events: [] }) }) });
    await closed.user.click(await screen.findByText('Q2 statement'));
    await screen.findByText('Timeline');
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    closed.unmount();
    const { user } = await mountPage(<InvestorServicesPage />, { perms: [...VIEW, 'clients.edit'], routes: base() });
    await user.click(await screen.findByText('Q2 statement'));
    await user.click(await screen.findByRole('button', { name: 'Re-set SLA' }));
    expect(within(screen.getAllByRole('dialog').at(-1)!).getByLabelText(/^Reason/)).toHaveAttribute('minlength', '5');
  });
  it('assign posts the user id (or null for unassigned) and an optional note', async () => {
    const { user, api } = await mountPage(<InvestorServicesPage />, { perms: [...VIEW, 'clients.edit'], routes: base({ 'POST /api/v1/client-ops/services/requests/:id/assign': raw({}) }) });
    await user.click(await screen.findByText('Q2 statement'));
    await user.click(await screen.findByRole('button', { name: 'Assign' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.selectOptions(within(f).getByLabelText(/Staff member/), 'st1');
    await user.click(within(f).getByRole('button', { name: 'Assign' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/services/requests/REQ-2017/assign'));
    expectBody(r!, { userId: 'st1' });
  });
  it('SLA policy change PUTs type, priority and numeric hours', async () => {
    const { user, api } = await mountPage(<InvestorServicesPage />, { perms: [...VIEW, 'clients.edit'], routes: base({ 'PUT /api/v1/client-ops/services/sla-policies': raw({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'SLA policy' }));
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const f = screen.getAllByRole('dialog').at(-1)!;
    const h = within(f).getByLabelText(/Target \(hours\)/);
    await user.clear(h);
    await user.type(h, '36');
    await user.click(within(f).getByRole('button', { name: 'Save target' }));
    const [r] = await waitFor(() => expectCalled(api, 'PUT /api/v1/client-ops/services/sla-policies'));
    expectBody(r!, { requestType: 'Statement request', priority: 'Normal', targetHours: 36 });
  });
});
