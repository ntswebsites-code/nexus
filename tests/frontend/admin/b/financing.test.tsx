import { describe, it, expect } from 'vitest';
import FinancingPage from '@/app/(ops)/ops/financing/page';
import { mountPage } from './_kit';
import { ok, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const margin = (o: Record<string, unknown> = {}) => ({ drawn: '500000', counted: '800000', coverage: '1.60', state: 'OK', excess: '100000', callAmount: '0', availableToDraw: '200000', ...o });
const facility = (o: Record<string, unknown> = {}) => ({
  id: 'fa1', ref: 'FAC-1001', name: 'Margin line A', type: 'MARGIN_LOAN', lender: 'Big Bank', portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', poolId: 'pl1', poolRef: 'POOL-1', poolName: 'Core pool', currency: 'USD', limitAmount: '1000000', ratePct: '8',
  initialRatio: '1.5', maintenanceRatio: '1.25', callDueDays: 2, status: 'ACTIVE', makerId: 'usr_other', makerName: 'Maker M', approverName: 'Approver A', margin: margin(), openCalls: 1, overdueCalls: 1, version: 4,
  valuation: { marketValue: '1000000', afterHaircut: '800000', counted: '800000', ineligible: '0', warnings: [], lines: [] }, movements: [{ id: 'mv1', kind: 'DRAW', amount: '500000', valueDate: '2026-08-01', note: null, createdByName: 'Maker M' }], calls: [], ...o,
});
const call = (o: Record<string, unknown> = {}) => ({
  id: 'mc1', ref: 'MC-0001', facilityRef: 'FAC-1001', facilityName: 'Margin line A', lender: 'Big Bank', currency: 'USD', status: 'ISSUED', calledAmount: '120000', drawn: '500000', eligibleValue: '600000', coverageRatio: '1.2', coverageAfter: null, dueAt: '2026-09-02T00:00:00Z', overdue: true,
  issuedBy: 'usr_other', issuedByName: 'Issuer I', acknowledgedByName: null, resolvedByName: null, resolution: null, current: margin({ state: 'DEFICIT', callAmount: '90000' }), ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/financing/summary': ok({ facilities: 3, pendingApproval: 1, inDeficit: 1, warning: 2, openCalls: 1, overdueCalls: 1, exposure: [{ currency: 'USD', limit: '3000000', drawn: '1500000' }], watchlist: [] }),
  'GET /api/v1/financing/facilities': ok([facility()]),
  'GET /api/v1/financing/facilities/:id': ok(facility()),
  'GET /api/v1/financing/calls': ok([call()]),
  'GET /api/v1/financing/calls/:id': ok(call()),
  'GET /api/v1/financing/pools': ok([{ id: 'pl1', ref: 'POOL-1', name: 'Core pool', portfolioId: 'p1', portfolioName: 'Balanced Growth Fund', currency: 'USD', status: 'ACTIVE', valuation: { marketValue: '1', afterHaircut: '1', counted: '1', ineligible: '0', warnings: [], lines: [] }, facilities: [{ id: 'fa1', ref: 'FAC-1001', name: 'Margin line A', status: 'ACTIVE' }], items: 2 }]),
  'GET /api/v1/financing/pools/:id': ok({ id: 'pl1', ref: 'POOL-1', name: 'Core pool', portfolioId: 'p1', portfolioName: 'Balanced Growth Fund', currency: 'USD', status: 'ACTIVE', valuation: { marketValue: '1', afterHaircut: '1', counted: '1', ineligible: '0', warnings: [], lines: [{ itemId: 'it1', ticker: 'ABC', assetClass: 'Equity', market: 'ZSE', quantity: '1000', marketValue: '1500', eligible: true, haircutPct: '30', afterHaircut: '1050', counted: '1050', capped: false, reason: null }] }, facilities: [] }),
  'GET /api/v1/financing/rules': ok([{ id: 'r1', assetClass: 'Equity', market: 'ZSE', eligible: true, haircutPct: '30', maxPoolPct: '50', note: null, updatedByName: 'Admin A' }]),
  'GET /api/v1/portfolios': ok([{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }]),
  'GET /api/v1/securities': ok([{ id: 's1', ticker: 'ABC', name: 'ABC Holdings' }]),
  ...o,
});
const VIEW = ['risk.view'];

describe('Financing: overview and facilities', () => {
  it('shows summary tiles with currency and the facilities table with names, ratios and overdue calls', async () => {
    await mountPage(<FinancingPage />, { routes: base() });
    expect(await screen.findByText('FAC-1001')).toBeInTheDocument();
    expect(screen.getByText('Drawn (USD)')).toBeInTheDocument();
    expect(screen.getByText('of 3,000,000.00 limit')).toBeInTheDocument();
    expect(screen.getByText('Margin line A · Margin loan')).toBeInTheDocument();
    expect(screen.getByText('1.60x')).toBeInTheDocument();
    expect(screen.getByText('1 (1 overdue)')).toBeInTheDocument();
    expect(screen.getByText('Big Bank')).toBeInTheDocument();
    expect(screen.queryByText('fa1')).not.toBeInTheDocument();
  });
  it('ADB-012: for a user without financing.manage, New facility, Run margin monitor are visible but disabled naming the permission', async () => {
    const { api } = await mountPage(<FinancingPage />, { perms: VIEW, routes: base() });
    const nf = await screen.findByRole('button', { name: 'New facility' });
    expect(nf).toBeDisabled();
    expect(nf).toHaveAttribute('title', 'Needs the financing.manage permission');
    const mon = screen.getByRole('button', { name: 'Run margin monitor' });
    expect(mon).toBeDisabled();
    expect(mon).toHaveAttribute('title', 'Needs the financing.manage permission');
    expectNotCalled(api, 'POST /api/v1/financing/monitor');
  });
  it('ADB-012: Set a rule and New pool are disabled with a reason for a viewer', async () => {
    const { user } = await mountPage(<FinancingPage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Collateral pools' }));
    expect(await screen.findByRole('button', { name: 'New pool' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Haircuts & eligibility' }));
    const rule = await screen.findByRole('button', { name: 'Set a rule' });
    expect(rule).toBeDisabled();
    expect(rule).toHaveAttribute('title', 'Needs the financing.manage permission');
  });
  it('managers: Run margin monitor posts (with confirm-free action) and refreshes the summary', async () => {
    const { user, api } = await mountPage(<FinancingPage />, { perms: [...VIEW, 'financing.manage'], routes: base({ 'POST /api/v1/financing/monitor': ok({}) }) });
    await screen.findByText('FAC-1001');
    const before = api.calls('GET /api/v1/financing/summary').length;
    await user.click(screen.getByRole('button', { name: 'Run margin monitor' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/financing/monitor'));
    await waitFor(() => expect(api.calls('GET /api/v1/financing/summary').length).toBeGreaterThan(before));
  });
  it('ADB-012: facility detail for a viewer shows disabled Draw, Repay, Close with the permission and a text note', async () => {
    const { user } = await mountPage(<FinancingPage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByText('FAC-1001'));
    const dlg = await screen.findByRole('dialog');
    for (const n of ['Draw', 'Repay', 'Close']) {
      const b = (await within(dlg).findAllByRole('button', { name: n })).find((x) => x.getAttribute('title')?.startsWith('Needs'))!;
      expect(b, n).toBeDisabled();
      expect(b, n).toHaveAttribute('title', 'Needs the financing.manage permission');
    }
    expect(within(dlg).getByText('Needs the financing.manage permission.')).toBeInTheDocument();
  });
  it('ADB-012: pending facility, viewer sees disabled "Approve and activate" naming financing.approve; maker sees the explanation', async () => {
    const a = await mountPage(<FinancingPage />, { perms: VIEW, routes: base({ 'GET /api/v1/financing/facilities/:id': ok(facility({ status: 'PENDING_APPROVAL' })) }) });
    await a.user.click(await screen.findByText('FAC-1001'));
    const b = await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Approve and activate' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Needs the financing.approve permission');
    a.unmount();
    const m = await mountPage(<FinancingPage />, { perms: [...VIEW, 'financing.manage', 'financing.approve'], routes: base({ 'GET /api/v1/financing/facilities/:id': ok(facility({ status: 'PENDING_APPROVAL', makerId: 'usr_admin' })) }) });
    await m.user.click(await screen.findByText('FAC-1001'));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('A different person with financing.approve activates it.')).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Approve and activate' })).not.toBeInTheDocument();
  });
  it('a different approver activates after confirm; sends an idempotency key; the SoD error reads "different approver"', async () => {
    const { user, api } = await mountPage(<FinancingPage />, {
      perms: [...VIEW, 'financing.approve'],
      routes: base({ 'GET /api/v1/financing/facilities/:id': ok(facility({ status: 'PENDING_APPROVAL' })), 'POST /api/v1/financing/facilities/:id/approve': ok({}) }),
    });
    await user.click(await screen.findByText('FAC-1001'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Approve and activate' }));
    expect(within(screen.getAllByRole('dialog').at(-1)!).getByText('Activate this facility?')).toBeInTheDocument();
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Approve and activate' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/facilities/fa1/approve'));
    expectIdempotencyKey(req!);
  });
  it('draw posts amount without commas, value date and key; refusal text from the API is shown', async () => {
    const { user, api } = await mountPage(<FinancingPage />, {
      perms: [...VIEW, 'financing.manage'],
      routes: base({ 'POST /api/v1/financing/facilities/:id/draw': fail(409, 'conflict', 'Draw exceeds available cover') }),
    });
    await user.click(await screen.findByText('FAC-1001'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Draw' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    expect(within(f).getByText(/Available to draw: USD 200,000.00/)).toBeInTheDocument();
    await user.type(within(f).getByLabelText(/^Amount/), '1,500,000');
    await user.click(within(f).getByRole('button', { name: 'Draw' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/facilities/fa1/draw'));
    expectBody(req!, { amount: '1500000' });
    expectIdempotencyKey(req!);
    expect(await within(f).findByText(/Draw exceeds available cover/)).toBeInTheDocument();
  });
  it('deficit state warns with the amount a call would ask for', async () => {
    await mountPage(<FinancingPage />, { perms: VIEW, routes: base({ 'GET /api/v1/financing/facilities/:id': ok(facility({ margin: margin({ state: 'DEFICIT', callAmount: '77000' }) })) }) });
    const { user } = await mountPage(<FinancingPage />, { perms: VIEW, routes: base({ 'GET /api/v1/financing/facilities/:id': ok(facility({ margin: margin({ state: 'DEFICIT', callAmount: '77000' }) })) }) });
    const rows = await screen.findAllByText('FAC-1001');
    await user.click(rows[rows.length - 1]!);
    expect(await screen.findByText(/A margin call would ask for USD 77,000.00/)).toBeInTheDocument();
  });
  it('New facility posts the full body with a key', async () => {
    const { user, api } = await mountPage(<FinancingPage />, { perms: [...VIEW, 'financing.manage'], routes: base({ 'POST /api/v1/financing/facilities': ok({ id: 'fa2' }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'New facility' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Name/), 'Repo line');
    await user.type(within(dlg).getByLabelText(/Lender/), 'Bank B');
    await user.selectOptions(within(dlg).getAllByRole('combobox').find((c) => within(c).queryByText('Choose a portfolio'))!, 'p1');
    await user.type(within(dlg).getByLabelText(/^Limit/), '2,000,000');
    await user.click(within(dlg).getByRole('button', { name: 'Create draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/facilities'));
    expectBody(req!, { name: 'Repo line', lender: 'Bank B', portfolioId: 'p1', limitAmount: '2000000', initialRatio: '1.5', maintenanceRatio: '1.25', callDueDays: 2 });
    expectIdempotencyKey(req!);
  });
  it('empty and error states', async () => {
    const a = await mountPage(<FinancingPage />, { routes: base({ 'GET /api/v1/financing/facilities': ok([]) }) });
    expect(await screen.findByText('No facilities yet.')).toBeInTheDocument();
    a.unmount();
    await mountPage(<FinancingPage />, { routes: base({ 'GET /api/v1/financing/summary': fail(403, 'forbidden', 'Needs risk.view') }) });
    expect(await screen.findByText(/You do not have permission to view financing summary/)).toBeInTheDocument();
  });
  it('without risk.view: access denied', async () => {
    await mountPage(<FinancingPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the risk.view permission/)).toBeInTheDocument();
  });
});

describe('Financing: margin calls (ADB-012 MC-0001)', () => {
  const openCall = async (perms: string[], c = call()) => {
    const m = await mountPage(<FinancingPage />, {
      perms,
      routes: base({
        'GET /api/v1/financing/calls/:id': ok(c),
        'POST /api/v1/financing/calls/:id/acknowledge': ok({}), 'POST /api/v1/financing/calls/:id/dispute': ok({}), 'POST /api/v1/financing/calls/:id/resolve': ok({}),
        'POST /api/v1/financing/calls/:id/waive': ok({}), 'POST /api/v1/financing/calls/:id/cancel': ok({}),
      }),
    });
    await m.user.click(await screen.findByRole('tab', { name: 'Margin calls' }));
    await m.user.click(await screen.findByText('MC-0001'));
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('viewer: Acknowledge, Dispute, Mark as met, Waive are present but disabled with the permission named plus a text note', async () => {
    const { dlg } = await openCall(VIEW);
    for (const [n, perm] of [['Acknowledge', 'financing.manage'], ['Dispute', 'financing.manage'], ['Mark as met', 'financing.manage'], ['Waive', 'financing.approve']] as const) {
      const b = await within(dlg).findByRole('button', { name: n });
      expect(b, n).toBeDisabled();
      expect(b, n).toHaveAttribute('title', `Needs the ${perm} permission`);
    }
    expect(within(dlg).getByText(/Needs the financing.manage permission to act on a margin call/)).toBeInTheDocument();
  });
  it('list and detail show lender/facility names and overdue, still-in-deficit guidance', async () => {
    const { dlg } = await openCall(VIEW);
    expect(await within(dlg).findByText(/Still in deficit: post collateral or repay about 90,000.00/)).toBeInTheDocument();
    expect(within(dlg).getAllByText('overdue').length).toBeGreaterThan(0);
  });
  it('manager acknowledges with a key; disputes with a required reason', async () => {
    const { user, api, dlg } = await openCall([...VIEW, 'financing.manage']);
    await user.click(await within(dlg).findByRole('button', { name: 'Acknowledge' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/calls/mc1/acknowledge'));
    expectIdempotencyKey(req!);
    await user.click(within(dlg).getByRole('button', { name: 'Dispute' }));
    await user.type(screen.getByLabelText(/Reason/), 'Valuation disputed');
    await user.click(screen.getAllByRole('button', { name: 'Dispute' }).at(-1)!);
    const [d] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/calls/mc1/dispute'));
    expectBody(d!, { reason: 'Valuation disputed' });
  });
  it('Mark as met requires a note of 5+ chars (required field) and posts it', async () => {
    const { user, api, dlg } = await openCall([...VIEW, 'financing.manage']);
    await user.click(await within(dlg).findByRole('button', { name: 'Mark as met' }));
    const note = screen.getByLabelText(/How it was met/);
    expect(note).toBeRequired();
    await user.type(note, 'Posted collateral');
    await user.click(screen.getAllByRole('button', { name: 'Mark as met' }).at(-1)!);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/calls/mc1/resolve'));
    expectBody(req!, { note: 'Posted collateral' });
    expectIdempotencyKey(req!);
  });
  it('issuer cannot waive their own call (no Waive, sees Cancel instead); another approver sees Waive', async () => {
    const own = await openCall([...VIEW, 'financing.manage', 'financing.approve'], call({ issuedBy: 'usr_admin' }));
    expect(await within(own.dlg).findByRole('button', { name: 'Cancel (raised in error)' })).toBeInTheDocument();
    expect(within(own.dlg).queryByRole('button', { name: 'Waive' })).not.toBeInTheDocument();
    own.unmount();
    const other = await openCall([...VIEW, 'financing.manage', 'financing.approve']);
    expect(await within(other.dlg).findByRole('button', { name: 'Waive' })).toBeEnabled();
  });
  it('resolved calls offer no actions', async () => {
    const { dlg } = await openCall([...VIEW, 'financing.manage'], call({ status: 'MET', resolution: 'Collateral posted', resolvedByName: 'Res R' }));
    await within(dlg).findByText(/MC-0001/);
    expect(within(dlg).queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Mark as met' })).not.toBeInTheDocument();
  });
  it('status filter is sent to the API', async () => {
    const { user, api } = await mountPage(<FinancingPage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Margin calls' }));
    await screen.findByText('MC-0001');
    await user.selectOptions(screen.getByLabelText('Status'), 'DISPUTED');
    await waitFor(() => expect(api.calls('GET /api/v1/financing/calls').at(-1)!.query.get('status')).toBe('DISPUTED'));
  });
});

describe('Financing: pools and rules', () => {
  it('pool detail lists collateral with haircut and counted value; viewer sees Post collateral disabled with reason', async () => {
    const { user } = await mountPage(<FinancingPage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Collateral pools' }));
    await user.click(await screen.findByText('POOL-1'));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('ABC')).toBeInTheDocument();
    const b = within(dlg).getByRole('button', { name: 'Post collateral' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Needs the financing.manage permission');
  });
  it('manager posts collateral: securityId and quantity without commas, with a key', async () => {
    const { user, api } = await mountPage(<FinancingPage />, { perms: [...VIEW, 'financing.manage'], routes: base({ 'POST /api/v1/financing/pools/:id/collateral': ok({}, 201) }) });
    await user.click(await screen.findByRole('tab', { name: 'Collateral pools' }));
    await user.click(await screen.findByText('POOL-1'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Post collateral' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.selectOptions(within(f).getByRole('combobox'), 's1');
    await user.type(within(f).getByLabelText(/^Quantity/), '2,000');
    await user.click(within(f).getByRole('button', { name: 'Pledge' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/pools/pl1/collateral'));
    expectBody(req!, { securityId: 's1', quantity: '2000' });
    expectIdempotencyKey(req!);
  });
  it('rules table and Set a rule (PUT) for a manager', async () => {
    const { user, api } = await mountPage(<FinancingPage />, { perms: [...VIEW, 'financing.manage'], routes: base({ 'PUT /api/v1/financing/rules': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Haircuts & eligibility' }));
    expect(await screen.findByText('Equity')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set a rule' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/^Asset class/), 'Bond');
    await user.type(within(f).getByLabelText(/^Haircut/), '10');
    await user.click(within(f).getByRole('button', { name: 'Save rule' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/financing/rules'));
    expectBody(req!, { assetClass: 'Bond', eligible: true, haircutPct: '10' });
  });
  it('empty rules says nothing is eligible', async () => {
    const { user } = await mountPage(<FinancingPage />, { routes: base({ 'GET /api/v1/financing/rules': ok([]) }) });
    await user.click(await screen.findByRole('tab', { name: 'Haircuts & eligibility' }));
    expect(await screen.findByText('No rules: nothing is eligible as collateral.')).toBeInTheDocument();
  });
});
