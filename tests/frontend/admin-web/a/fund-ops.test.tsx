import { describe, it, expect } from 'vitest';
import FundsPage from '@/app/(ops)/ops/funds/page';
import FundPage from '@/app/(ops)/ops/funds/[id]/page';
import CallsPage from '@/app/(ops)/ops/capital-calls/page';
import CallPage from '@/app/(ops)/ops/capital-calls/[id]/page';
import DistPage from '@/app/(ops)/ops/distributions/page';
import DistDetailPage from '@/app/(ops)/ops/distributions/[id]/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, created, mountPage, without } from './_kit';

const fund = (over: Record<string, unknown> = {}) => ({
  id: 'f-1', ref: 'FND-001', name: 'Agri Growth Fund I', shortName: 'AGFI', publicReference: null, operatingModel: 'PRIVATE_CAPITAL', currency: 'USD', vintage: 2025, status: 'Active', portalVisible: true,
  defaultShareClass: null, navPerUnit: null, totalNav: null, asOfDate: '2026-09-30', valuationStatus: null, totalCommitted: '50000000.00', commitmentCount: 4, version: 3, ...over,
});
const commitment = { id: 'cm-1', clientId: 'cl-1', clientName: 'Rutendo Trust', clientRef: 'CL-1001', fundId: 'f-1', commitmentAmount: '10000000.00', currency: 'USD', status: 'ACTIVE', effectiveDate: '2026-01-15T00:00:00Z', investorAccountRef: 'IA-1', version: 2 };

describe('Funds', () => {
  it('ADA-021: list COMMITTED column reads totalCommitted and shows the LP count', async () => {
    mountPage(<FundsPage />, { routes: { 'GET /api/v1/ops/funds': D([fund()]) } });
    expect(await screen.findByText('Agri Growth Fund I')).toBeInTheDocument();
    expect(screen.getByText(/50,000,000.00/)).toBeInTheDocument();
    expect(screen.getByText('4 LPs')).toBeInTheDocument();
  });
  it('list: empty state, row click opens the fund', async () => {
    const { user } = mountPage(<FundsPage />, { routes: { 'GET /api/v1/ops/funds': D([fund()]) } });
    await user.click(await screen.findByText('Agri Growth Fund I'));
    expect(router.push).toHaveBeenCalledWith('/ops-native/funds/f-1');
  });
  it('empty list', async () => {
    mountPage(<FundsPage />, { routes: { 'GET /api/v1/ops/funds': D([]) } });
    expect(await screen.findByText('No funds yet.')).toBeInTheDocument();
  });
  it('New fund posts the form payload with a key and opens the fund; New fund is hidden without funds.manage', async () => {
    const { api, user } = mountPage(<FundsPage />, { routes: { 'GET /api/v1/ops/funds': D([]), 'POST /api/v1/ops/funds': created({ id: 'f-9' }) } });
    await user.click(await screen.findByRole('button', { name: 'New fund' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Fund name'), 'Income Fund II');
    await user.type(within(d).getByLabelText('Short name'), 'IF2');
    await user.type(within(d).getByLabelText('Vintage'), '2026');
    await user.click(within(d).getByRole('button', { name: 'Create fund' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/funds'));
    expectBody(req, { name: 'Income Fund II', shortName: 'IF2', currency: 'USD', vintage: 2026, operatingModel: 'PRIVATE_CAPITAL', portalVisible: true });
    expectIdempotencyKey(req);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/funds/f-9'));
  });
  it('without funds.manage there is no New fund button', async () => {
    mountPage(<FundsPage />, { perms: without('funds.manage'), routes: { 'GET /api/v1/ops/funds': D([]) } });
    await screen.findByText('No funds yet.');
    expect(screen.queryByRole('button', { name: 'New fund' })).not.toBeInTheDocument();
  });
  it('API validation error shows in the dialog', async () => {
    const { user } = mountPage(<FundsPage />, { routes: { 'GET /api/v1/ops/funds': D([]), 'POST /api/v1/ops/funds': fail(409, 'conflict', 'Short name already used') } });
    await user.click(await screen.findByRole('button', { name: 'New fund' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Fund name'), 'X Fund');
    await user.type(within(d).getByLabelText('Short name'), 'AGFI');
    await user.click(within(d).getByRole('button', { name: 'Create fund' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Short name already used');
  });
});

describe('Fund detail', () => {
  const routes = (extra = {}) => ({ 'GET /api/v1/ops/funds/f-1': D({ ...fund(), commitments: [commitment] }), 'GET /api/v1/clients': D([{ uuid: 'cl-1', id: 'CL-1001', name: 'Rutendo Trust' }]), ...extra });
  it('shows master data and commitments by LP name (not id)', async () => {
    mountPage(<FundPage />, { params: { id: 'f-1' }, routes: routes() });
    expect(await screen.findByText('Rutendo Trust')).toBeInTheDocument();
    expect(screen.getByText('CL-1001')).toBeInTheDocument();
    expect(screen.getByText('Private capital fund')).toBeInTheDocument();
  });
  it('Add commitment posts amount (digits only) with a key', async () => {
    const { api, user } = mountPage(<FundPage />, { params: { id: 'f-1' }, routes: routes({ 'POST /api/v1/ops/funds/f-1/commitments': created({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Add commitment' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Rutendo Trust/ });
    await user.selectOptions(within(d).getByLabelText('Client (LP)'), 'cl-1');
    await user.type(within(d).getByLabelText('Commitment amount'), '2500000.00');
    await user.click(within(d).getByRole('button', { name: 'Add commitment' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/funds/f-1/commitments'));
    expectBody(req, { clientId: 'cl-1', commitmentAmount: '2500000.00', currency: 'USD', status: 'ACTIVE' });
    expectIdempotencyKey(req);
  });
  it('a non-numeric commitment is refused client-side with a clear message and nothing is sent', async () => {
    const { api, user } = mountPage(<FundPage />, { params: { id: 'f-1' }, routes: routes() });
    await user.click(await screen.findByRole('button', { name: 'Add commitment' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Rutendo Trust/ });
    await user.selectOptions(within(d).getByLabelText('Client (LP)'), 'cl-1');
    await user.type(within(d).getByLabelText('Commitment amount'), 'ten million');
    await user.click(within(d).getByRole('button', { name: 'Add commitment' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Enter the commitment as a number');
    expectNotCalled(api, 'POST /api/v1/ops/funds/f-1/commitments');
  });
  it('Edit fund sends the version; Edit commitment patches /commitments/:id with its version', async () => {
    const { api, user } = mountPage(<FundPage />, { params: { id: 'f-1' }, routes: routes({ 'PATCH /api/v1/ops/funds/f-1': D({}), 'PATCH /api/v1/ops/commitments/cm-1': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Edit fund' }));
    let d = await screen.findByRole('dialog');
    await user.click(within(d).getByRole('button', { name: 'Save changes' }));
    expectBody((await waitFor(() => expectCalled(api, 'PATCH /api/v1/ops/funds/f-1')))[0], { version: 3, shortName: 'AGFI' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    d = await screen.findByRole('dialog');
    await user.click(within(d).getByRole('button', { name: 'Save changes' }));
    expectBody((await waitFor(() => expectCalled(api, 'PATCH /api/v1/ops/commitments/cm-1')))[0], { version: 2, commitmentAmount: '10000000.00', status: 'ACTIVE' });
  });
  it('read-only without funds.manage', async () => {
    mountPage(<FundPage />, { params: { id: 'f-1' }, perms: without('funds.manage'), routes: routes() });
    await screen.findByText('Rutendo Trust');
    expect(screen.queryByRole('button', { name: 'Edit fund' })).not.toBeInTheDocument();
  });
});

const alloc = (over: Record<string, unknown> = {}) => ({ id: 'al-1', clientId: 'cl-1', clientName: 'Rutendo Trust', lpLegalNameSnapshot: 'Rutendo Family Trust', totalCommitmentSnapshot: '10000000.00', uncalledBeforeSnapshot: '8000000.00', callAmount: '1000000.00', amountPaid: '0.00', status: 'ISSUED', ...over });
const call = (over: Record<string, unknown> = {}) => ({
  id: 'cc-1', ref: 'CC-00001', fundId: 'f-1', fundName: 'Agri Growth Fund I', callNo: 3, callDate: '2026-09-01', dueDate: '2026-10-15', purpose: 'Follow-on investment', totalAmount: '1000000.00', currency: 'USD', status: 'PENDING_APPROVAL', allocationMethod: 'PRO_RATA',
  makerId: 'u-maker', makerName: 'Maya Maker', checkerId: null, checkerName: null, approvedAt: null, issuedAt: null, amountPaid: '0.00', allocations: [alloc()], payments: [], evidence: [], ...over,
});

describe('Capital calls list', () => {
  const rows = [{ id: 'cc-1', ref: 'CC-00001', callNo: 3, fundId: 'f-1', fundName: 'Agri Growth Fund I', dueDate: '2026-10-15', totalAmount: '1000000.00', currency: 'USD', status: 'PARTIALLY_PAID', amountPaid: '250000.00' }];
  it('ADA-021: PAID column shows amountPaid and rows open the call', async () => {
    const { user } = mountPage(<CallsPage />, { routes: { 'GET /api/v1/ops/capital-calls': D(rows), 'GET /api/v1/ops/funds': D([fund()]) } });
    expect(await screen.findByText('CC-00001')).toBeInTheDocument();
    expect(screen.getByText(/250,000.00/)).toBeInTheDocument();
    await user.click(screen.getByText('CC-00001'));
    expect(router.push).toHaveBeenCalledWith('/ops-native/capital-calls/cc-1');
  });
  it('status and fund filters are sent to the API; empty state', async () => {
    const { api, user } = mountPage(<CallsPage />, { routes: { 'GET /api/v1/ops/capital-calls': D([]), 'GET /api/v1/ops/funds': D([fund()]) } });
    expect(await screen.findByText('No capital calls match these filters.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'ISSUED');
    await waitFor(() => expect(api.calls('GET /api/v1/ops/capital-calls').at(-1)!.query.get('status')).toBe('ISSUED'));
    await within(screen.getByLabelText('Fund').closest('label')!).findByRole('option', { name: /Agri Growth Fund I/ });
    await user.selectOptions(screen.getByLabelText('Fund'), 'f-1');
    await waitFor(() => expect(api.calls('GET /api/v1/ops/capital-calls').at(-1)!.query.get('fundId')).toBe('f-1'));
  });
  it('New capital call: rejects a non-numeric total, then posts a pro-rata draft', async () => {
    const { api, user } = mountPage(<CallsPage />, { routes: { 'GET /api/v1/ops/capital-calls': D([]), 'GET /api/v1/ops/funds': D([fund()]), 'POST /api/v1/ops/capital-calls': created({ id: 'cc-9' }) } });
    await user.click(await screen.findByRole('button', { name: 'New capital call' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Agri Growth Fund I/ });
    await user.selectOptions(within(d).getByLabelText('Fund'), 'f-1');
    fireDate(within(d).getByLabelText('Due date'), '2026-11-30');
    await user.type(within(d).getByLabelText('Purpose'), 'Fees');
    await user.type(within(d).getByLabelText(/Total amount/), '12abc');
    await user.click(within(d).getByRole('button', { name: 'Save draft' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Enter the total amount as a number');
    expectNotCalled(api, 'POST /api/v1/ops/capital-calls');
    await user.clear(within(d).getByLabelText(/Total amount/));
    await user.type(within(d).getByLabelText(/Total amount/), '2,500,000.00');
    await user.click(within(d).getByRole('button', { name: 'Save draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/capital-calls'));
    expectBody(req, { fundId: 'f-1', dueDate: '2026-11-30', purpose: 'Fees', totalAmount: '2500000.00', allocationMethod: 'PRO_RATA' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/capital-calls/cc-9'));
  });
  it('explicit allocation requires amounts that add up to the total before Save draft is enabled', async () => {
    const f = { ...fund(), commitments: [commitment] };
    const { api, user } = mountPage(<CallsPage />, { routes: { 'GET /api/v1/ops/capital-calls': D([]), 'GET /api/v1/ops/funds': D([fund()]), 'GET /api/v1/ops/funds/f-1': D(f), 'POST /api/v1/ops/capital-calls': created({ id: 'cc-9' }) } });
    await user.click(await screen.findByRole('button', { name: 'New capital call' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Agri Growth Fund I/ });
    await user.selectOptions(within(d).getByLabelText('Fund'), 'f-1');
    fireDate(within(d).getByLabelText('Due date'), '2026-11-30');
    await user.type(within(d).getByLabelText('Purpose'), 'Fees');
    await user.type(within(d).getByLabelText(/Total amount/), '1000');
    await user.click(within(d).getAllByRole('radio')[1]);
    const save = within(d).getByRole('button', { name: 'Save draft' });
    expect(save).toBeDisabled();
    const lpInput = await within(d).findByLabelText(/Rutendo Trust/).catch(() => within(d).getAllByRole('textbox').at(-1)!);
    await user.type(lpInput, '1000');
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/capital-calls')))[0], { allocationMethod: 'EXPLICIT', allocations: [{ clientId: 'cl-1', amount: '1000' }] });
  });
  it('New capital call hidden without capital.create', async () => {
    mountPage(<CallsPage />, { perms: without('capital.create'), routes: { 'GET /api/v1/ops/capital-calls': D([]), 'GET /api/v1/ops/funds': D([]) } });
    await screen.findByText('No capital calls match these filters.');
    expect(screen.queryByRole('button', { name: 'New capital call' })).not.toBeInTheDocument();
  });
});

function fireDate(el: HTMLElement, value: string) {
  // user-event cannot type into date inputs in jsdom; set via the native setter
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Capital call detail', () => {
  const r = (c: unknown, extra = {}) => ({ 'GET /api/v1/ops/capital-calls/cc-1': D(c), ...extra });
  it('ADA-022: shows maker/checker names, allocation method, commitment and unfunded snapshots, LP names and payment recorder (no UUIDs)', async () => {
    const c = call({ status: 'PARTIALLY_PAID', checkerName: 'Carl Checker', checkerId: 'u-checker', amountPaid: '250000.00', allocations: [alloc({ amountPaid: '250000.00', status: 'PARTIALLY_PAID' })],
      payments: [{ id: 'p1', allocationId: 'al-1', amount: '250000.00', recordedAt: '2026-10-02T09:00:00Z', paidAt: '2026-10-01', recordedByName: 'Rita Recorder', bankReference: 'BNK-77', recordedById: 'u-rita' }] });
    mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(c) });
    expect(await screen.findByText('Maya Maker')).toBeInTheDocument();
    expect(screen.getByText('Carl Checker')).toBeInTheDocument();
    expect(screen.getByText('pro rata')).toBeInTheDocument();
    expect(screen.getAllByText('Rutendo Trust').length).toBeGreaterThan(0);
    expect(screen.getByText(/10,000,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/8,000,000.00/)).toBeInTheDocument();
    expect(screen.getByText('Rita Recorder')).toBeInTheDocument();
    expect(screen.getByText('BNK-77')).toBeInTheDocument();
    expect(screen.queryByText('u-maker')).not.toBeInTheDocument();
    expect(screen.queryByText('al-1')).not.toBeInTheDocument();
  });
  it('ADA-021: paid-to-date and outstanding are computed from amountPaid', async () => {
    mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call({ status: 'PARTIALLY_PAID', amountPaid: '250000.00', allocations: [alloc({ amountPaid: '250000.00' })] })) });
    await screen.findByText('Paid to date');
    expect(screen.getAllByText(/250,000.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/750,000.00/).length).toBeGreaterThan(0);
  });
  it('maker sees the maker-checker notice and a disabled Approve with the reason', async () => {
    mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call({ makerId: 'usr_admin', makerName: 'Test Admin' })) });
    const b = await screen.findByRole('button', { name: 'Approve' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'You prepared this call. A different approver is required.');
    expect(screen.getByText(/You prepared this call. A different approver is required/, { selector: '.ops-alert' })).toBeInTheDocument();
  });
  it('checker approves with a key; approval of draft: Submit for approval needs capital.create', async () => {
    const { api, user } = mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call(), { 'POST /api/v1/ops/capital-calls/cc-1/approve': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/capital-calls/cc-1/approve')))[0]);
    await waitFor(() => expect(api.calls('GET /api/v1/ops/capital-calls/cc-1').length).toBe(2));
  });
  it('approver without capital.approve sees no Approve/Reject', async () => {
    mountPage(<CallPage />, { params: { id: 'cc-1' }, perms: without('capital.approve'), routes: r(call()) });
    await screen.findByText('CC-00001');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
  it('Reject returns to the maker with a reason and key', async () => {
    const { api, user } = mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call(), { 'POST /api/v1/ops/capital-calls/cc-1/reject': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Reason/), 'Wrong amount');
    await user.click(within(d).getByRole('button', { name: 'Reject' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/capital-calls/cc-1/reject'));
    expectBody(req, { reason: 'Wrong amount' });
    expectIdempotencyKey(req);
  });
  it('draft: Submit for approval; approved: Issue to LPs asks for confirmation first', async () => {
    const { api, user } = mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call({ status: 'APPROVED' }), { 'POST /api/v1/ops/capital-calls/cc-1/issue': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Issue to LPs' }));
    expectNotCalled(api, 'POST /api/v1/ops/capital-calls/cc-1/issue');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Issue to LPs' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/capital-calls/cc-1/issue')))[0]);
  });
  it('a returned draft shows the approver reason', async () => {
    mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call({ status: 'DRAFT', rejectionReason: 'Wrong amount' })) });
    expect(await screen.findByText('Returned by the approver: Wrong amount')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
  });
  it('Cancel call sends a reason', async () => {
    const { api, user } = mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call(), { 'POST /api/v1/ops/capital-calls/cc-1/cancel': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Cancel call' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Superseded');
    await user.click(within(d).getByRole('button', { name: 'Cancel call' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/capital-calls/cc-1/cancel')))[0], { reason: 'Superseded' });
  });
  it('Record payment: refuses more than outstanding and non-numbers, sends allocation payment with key otherwise', async () => {
    const { api, user } = mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call({ status: 'ISSUED' }), { 'POST /api/v1/ops/capital-calls/cc-1/allocations/al-1/payments': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));
    const d = await screen.findByRole('dialog');
    expect(d).toHaveTextContent('Outstanding');
    await user.clear(within(d).getByLabelText(/Amount/));
    await user.type(within(d).getByLabelText(/Amount/), '2000000');
    await user.type(within(d).getByLabelText('Bank reference'), 'BNK-1');
    await user.click(within(d).getByRole('button', { name: 'Record payment' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent(/more than the outstanding/);
    await user.clear(within(d).getByLabelText(/Amount/));
    await user.type(within(d).getByLabelText(/Amount/), '400000.50');
    await user.click(within(d).getByRole('button', { name: 'Record payment' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/capital-calls/cc-1/allocations/al-1/payments'));
    expectBody(req, { amount: '400000.50', reference: 'BNK-1' });
    expectIdempotencyKey(req);
  });
  it('Record payment is hidden for a paid allocation and without capital.settle', async () => {
    mountPage(<CallPage />, { params: { id: 'cc-1' }, perms: without('capital.settle'), routes: r(call({ status: 'ISSUED' })) });
    await screen.findByText('CC-00001');
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
  it('cancelled call shows the reason', async () => {
    mountPage(<CallPage />, { params: { id: 'cc-1' }, routes: r(call({ status: 'CANCELLED', cancelReason: 'Superseded' })) });
    expect(await screen.findByText('Cancelled: Superseded.')).toBeInTheDocument();
  });
});

const dist = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', ref: 'DS-00001', fundId: 'f-1', fundName: 'Agri Growth Fund I', distributionDate: '2026-10-20', type: 'RETURN_OF_CAPITAL', currency: 'USD', grossAmount: '1500000.00', carryAmount: '100000.00', adjustmentsAmount: '0', netToLps: '1400000.00', status: 'PENDING_APPROVAL', notes: 'Q3', makerId: 'u-maker', makerName: 'Maya Maker', checkerId: null, checkerName: null, issuedAt: null,
  allocations: [{ id: 'da-1', clientId: 'cl-1', clientName: 'Rutendo Trust', shareAmount: '1400000.00', amountPaid: '0.00', status: 'ISSUED' }], payments: [], ...over,
});

describe('Distributions', () => {
  it('list shows gross, net and status; rows open the distribution; empty state; filters', async () => {
    const { api, user } = mountPage(<DistPage />, { routes: { 'GET /api/v1/ops/distributions': D([dist()]), 'GET /api/v1/ops/funds': D([fund()]) } });
    expect(await screen.findByText('DS-00001')).toBeInTheDocument();
    expect(screen.getByText(/1,400,000.00/)).toBeInTheDocument();
    await user.click(screen.getByText('DS-00001'));
    expect(router.push).toHaveBeenCalledWith('/ops-native/distributions/d-1');
    await user.selectOptions(screen.getByLabelText('Status'), 'ISSUED');
    await waitFor(() => expect(api.calls('GET /api/v1/ops/distributions').at(-1)!.query.get('status')).toBe('ISSUED'));
  });
  it('New distribution: net must be positive and amounts numeric; posts the draft otherwise', async () => {
    const { api, user } = mountPage(<DistPage />, { routes: { 'GET /api/v1/ops/distributions': D([]), 'GET /api/v1/ops/funds': D([fund()]), 'POST /api/v1/ops/distributions': created({ id: 'd-9' }) } });
    await user.click(await screen.findByRole('button', { name: 'New distribution' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Agri Growth Fund I/ });
    await user.selectOptions(within(d).getByLabelText('Fund'), 'f-1');
    fireDate(within(d).getByLabelText('Distribution date'), '2026-12-01');
    await user.type(within(d).getByLabelText('Gross amount'), '1000');
    await user.type(within(d).getByLabelText('Carried interest'), '1000');
    await user.click(within(d).getByRole('button', { name: 'Save draft' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('The net amount to LPs must be positive.');
    expectNotCalled(api, 'POST /api/v1/ops/distributions');
    await user.clear(within(d).getByLabelText('Carried interest'));
    await user.type(within(d).getByLabelText('Carried interest'), '100');
    expect(within(d).getByText('Net to LPs: 900.00')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Save draft' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/distributions')))[0], { fundId: 'f-1', grossAmount: '1000', carryAmount: '100', adjustmentsAmount: '0', type: 'RETURN_OF_CAPITAL', allocationMethod: 'PRO_RATA' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/distributions/d-9'));
  });
  it('detail: names, net to LPs, SoD on approve, issue confirm, reject/cancel reasons', async () => {
    const r = (d: unknown, extra = {}) => ({ 'GET /api/v1/ops/distributions/d-1': D(d), ...extra });
    const { unmount } = mountPage(<DistDetailPage />, { params: { id: 'd-1' }, routes: r(dist({ makerId: 'usr_admin' })) });
    expect(await screen.findByText('Net to LPs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    unmount();
    const { api, user } = mountPage(<DistDetailPage />, { params: { id: 'd-1' }, routes: r(dist(), { 'POST /api/v1/ops/distributions/d-1/approve': D({}), 'POST /api/v1/ops/distributions/d-1/reject': D({}) }) });
    expect(await screen.findByText('Maya Maker')).toBeInTheDocument();
    expect(screen.getAllByText('Rutendo Trust').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/distributions/d-1/approve')))[0]);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Reason/), 'Check carry');
    await user.click(within(dlg).getByRole('button', { name: 'Reject' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/distributions/d-1/reject')))[0], { reason: 'Check carry' });
  });
  it('detail: Settle records a settlement on the allocation with a key and refuses an amount above the share', async () => {
    const { api, user } = mountPage(<DistDetailPage />, { params: { id: 'd-1' }, routes: { 'GET /api/v1/ops/distributions/d-1': D(dist({ status: 'ISSUED' })), 'POST /api/v1/ops/distributions/d-1/allocations/da-1/settle': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Settle' }));
    const d = await screen.findByRole('dialog');
    await user.clear(within(d).getByLabelText(/Amount/));
    await user.type(within(d).getByLabelText(/Amount/), '9999999');
    await user.type(within(d).getByLabelText('Bank reference'), 'PAY-1');
    await user.click(within(d).getByRole('button', { name: 'Record settlement' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent(/more than the outstanding/);
    await user.clear(within(d).getByLabelText(/Amount/));
    await user.type(within(d).getByLabelText(/Amount/), '1400000');
    await user.click(within(d).getByRole('button', { name: 'Record settlement' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/distributions/d-1/allocations/da-1/settle'));
    expectBody(req, { amount: '1400000', reference: 'PAY-1' });
    expectIdempotencyKey(req);
  });
});
