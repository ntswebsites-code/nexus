import { describe, it, expect } from 'vitest';
import DealingPage from '@/app/(ops)/ops/dealing/page';
import TermSheetsPage from '@/app/(ops)/ops/term-sheets/page';
import TermSheetPage from '@/app/(ops)/ops/term-sheets/[id]/page';
import InvesteePage from '@/app/(ops)/ops/investee-requests/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, created, mountPage, without } from './_kit';

const req = (over: Record<string, unknown> = {}) => ({ id: 'dr-1', ref: 'DL-00001', clientId: 'cl-1', clientName: 'Rutendo Trust', fundId: 'f-1', fundName: 'Agri Growth Fund I', shareClassCode: 'A', requestType: 'SUBSCRIPTION', inputMode: 'AMOUNT', amount: '50000.00', units: null, currency: 'USD', requestedDealingDate: '2026-10-31', status: 'SUBMITTED', submittedByName: 'Tendai Moyo', processedById: null, dealingNavPerUnit: null, unitsAllocated: null, rejectionReason: null, notes: null, createdAt: '2026-10-01T00:00:00Z', ...over });

describe('Dealing queue', () => {
  const routes = (rows: unknown[] = [req()], extra = {}) => ({ 'GET /api/v1/ops/dealing/requests': D(rows), ...extra });
  it('lists requests by LP name with status; a request is selected for review showing fund and amount', async () => {
    const { user } = mountPage(<DealingPage />, { routes: routes() });
    expect(await screen.findByText(/Select a request to review it/)).toBeInTheDocument();
    await user.click(await screen.findByText('DL-00001'));
    expect((await screen.findAllByText('Agri Growth Fund I')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rutendo Trust').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50,000.00/).length).toBeGreaterThan(0);
  });
  it('full redemption shows "Full holding" and units show with 4 decimals', async () => {
    const rows = [req({ id: 'a', ref: 'DL-A', requestType: 'REDEMPTION', inputMode: 'FULL', amount: null }), req({ id: 'b', ref: 'DL-B', amount: null, units: '123.45678' })];
    const { user } = mountPage(<DealingPage />, { routes: routes(rows) });
    await user.click(await screen.findByText('DL-A'));
    expect((await screen.findAllByText('Full holding')).length).toBeGreaterThan(0);
    await user.click(screen.getByText('DL-B'));
    expect((await screen.findAllByText('123.4568 units')).length).toBeGreaterThan(0);
  });
  it('Accept posts with a key (submitted + dealing.process)', async () => {
    const { api, user } = mountPage(<DealingPage />, { routes: routes([req()], { 'POST /api/v1/ops/dealing/requests/dr-1/accept': D({}) }) });
    await user.click(await screen.findByText('DL-00001'));
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/dealing/requests/dr-1/accept')))[0]);
  });
  it('Process at NAV: non-numeric NAV is refused client-side, a valid NAV posts with a key', async () => {
    const { api, user } = mountPage(<DealingPage />, { routes: routes([req({ status: 'AWAITING_FUNDS' })], { 'POST /api/v1/ops/dealing/requests/dr-1/process': D({}) }) });
    await user.click(await screen.findByText('DL-00001'));
    await user.click(await screen.findByRole('button', { name: 'Process at NAV' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Dealing NAV per unit/), 'one point two');
    await user.click(within(d).getByRole('button', { name: 'Process' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Enter the dealing NAV per unit as a number.');
    expectNotCalled(api, 'POST /api/v1/ops/dealing/requests/dr-1/process');
    await user.clear(within(d).getByLabelText(/Dealing NAV per unit/));
    await user.type(within(d).getByLabelText(/Dealing NAV per unit/), '1.234567');
    await user.click(within(d).getByRole('button', { name: 'Process' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/dealing/requests/dr-1/process'));
    expectBody(r, { navPerUnit: '1.234567' });
    expectIdempotencyKey(r);
  });
  it('SoD: the processor cannot approve (disabled, reason and notice); another approver can', async () => {
    const own = mountPage(<DealingPage />, { routes: routes([req({ status: 'AWAITING_NAV', processedById: 'usr_admin' })]) });
    await own.user.click(await screen.findByText('DL-00001'));
    const b = await screen.findByRole('button', { name: 'Approve' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'You processed this request. A different approver is required.');
    own.unmount();
    const { api, user } = mountPage(<DealingPage />, { routes: routes([req({ status: 'AWAITING_NAV', processedById: 'someone' })], { 'POST /api/v1/ops/dealing/requests/dr-1/approve': D({}) }) });
    await user.click(await screen.findByText('DL-00001'));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/ops/dealing/requests/dr-1/approve'));
  });
  it('Reject posts the reason with a key; terminal requests offer no actions; the rejection reason is shown', async () => {
    const { api, user } = mountPage(<DealingPage />, { routes: routes([req(), req({ id: 'dr-2', ref: 'DL-2', status: 'REJECTED', rejectionReason: 'KYC outdated' })], { 'POST /api/v1/ops/dealing/requests/dr-1/reject': D({}) }) });
    await user.click(await screen.findByText('DL-2'));
    expect(await screen.findByText('Rejected: KYC outdated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    await user.click(screen.getByText('DL-00001'));
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Fund closed to subscriptions');
    await user.click(within(d).getByRole('button', { name: 'Reject' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/dealing/requests/dr-1/reject'));
    expectBody(r, { reason: 'Fund closed to subscriptions' });
    expectIdempotencyKey(r);
  });
  it('permissions: without dealing.process/approve no action buttons; status filter is sent; empty state', async () => {
    const { api, user } = mountPage(<DealingPage />, { perms: without('dealing.process', 'dealing.approve'), routes: routes() });
    await user.click(await screen.findByText('DL-00001'));
    await screen.findAllByText('Agri Growth Fund I');
    for (const n of ['Accept', 'Reject', 'Approve', 'Process at NAV']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'COMPLETED');
    await waitFor(() => expect(api.calls('GET /api/v1/ops/dealing/requests').at(-1)!.query.get('status')).toBe('COMPLETED'));
  });
  it('empty queue', async () => {
    mountPage(<DealingPage />, { routes: routes([]) });
    expect(await screen.findByText('No dealing requests match this filter.')).toBeInTheDocument();
  });
});

const sheet = (over: Record<string, unknown> = {}) => ({ id: 'ts-1', ref: 'TS-001', companyId: 'CO-1', companyName: 'Zim Agro Ltd', title: 'Series A term sheet', versionNo: 2, status: 'PENDING_APPROVAL', investmentAmount: '2000000.00', valuation: '10000000.00', equityPercentage: '16.67', currency: 'USD', keyTerms: ['1x liquidation preference', { anti: 'dilution' }], conditions: 'Satisfactory DD', timeline: '90 days', createdById: 'u-maker', createdByName: 'Maya Maker', approvedById: null, approvedByName: null, issuedById: null, issuedAt: null, viewedAt: null, signedAt: null, ...over });

describe('Term sheets list', () => {
  const routes = (rows: unknown[] = [sheet()], extra = {}) => ({ 'GET /api/v1/ops/term-sheets': D(rows), 'GET /api/v1/private-markets/companies': D([{ id: 'CO-1', name: 'Zim Agro Ltd' }]), ...extra });
  it('lists term sheets with company-readable fields and opens one', async () => {
    const { user } = mountPage(<TermSheetsPage />, { routes: routes() });
    expect(await screen.findByText('Series A term sheet')).toBeInTheDocument();
    expect(screen.getByText(/TS-001 · v2/)).toBeInTheDocument();
    expect(screen.getByText(/2,000,000.00/)).toBeInTheDocument();
    await user.click(screen.getByText('Series A term sheet'));
  });
  it('empty state; New term sheet hidden without term_sheets.create', async () => {
    mountPage(<TermSheetsPage />, { perms: without('term_sheets.create'), routes: routes([]) });
    expect(await screen.findByText('No term sheets yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New term sheet' })).not.toBeInTheDocument();
  });
  async function fillForm(user: ReturnType<typeof mountPage>['user'], equity: string) {
    await user.click(await screen.findByRole('button', { name: 'New term sheet' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Zim Agro Ltd/ });
    await user.selectOptions(within(d).getByLabelText('Company'), 'CO-1');
    await user.type(within(d).getByLabelText('Title'), 'Seed term sheet');
    await user.type(within(d).getByLabelText('Investment amount'), '1,000,000');
    await user.type(within(d).getByLabelText('Pre-money valuation'), '5000000');
    await user.type(within(d).getByLabelText('Equity (%)'), equity);
    return d;
  }
  it('validates equity between 0 and 100 and numeric amounts before sending', async () => {
    const { api, user } = mountPage(<TermSheetsPage />, { routes: routes([], { 'POST /api/v1/ops/term-sheets': created({ id: 'ts-9' }) }) });
    const d = await fillForm(user, '150');
    await user.click(within(d).getByRole('button', { name: 'Save draft' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Equity must be between 0 and 100%.');
    expectNotCalled(api, 'POST /api/v1/ops/term-sheets');
  });
  it('posts the draft with key terms split by line, then opens it', async () => {
    const { api, user } = mountPage(<TermSheetsPage />, { routes: routes([], { 'POST /api/v1/ops/term-sheets': created({ id: 'ts-9' }) }) });
    const d = await fillForm(user, '16.67');
    await user.type(within(d).getByLabelText(/Key terms/), 'Board seat{enter}Pro-rata rights');
    await user.click(within(d).getByRole('button', { name: 'Save draft' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/term-sheets'));
    expectBody(r, { company: 'CO-1', title: 'Seed term sheet', currency: 'USD', investmentAmount: '1000000', valuation: '5000000', equityPercentage: '16.67', keyTerms: ['Board seat', 'Pro-rata rights'] });
    expectIdempotencyKey(r);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/term-sheets/ts-9'));
  });
});

describe('Term sheet detail', () => {
  const r = (t: unknown, extra = {}) => ({ 'GET /api/v1/ops/term-sheets/ts-1': D(t), ...extra });
  it('shows company, terms, key terms (strings and objects) and conditions', async () => {
    mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet()) });
    expect(await screen.findByText('1x liquidation preference')).toBeInTheDocument();
    expect(screen.getByText('{"anti":"dilution"}')).toBeInTheDocument();
    expect(screen.getByText('Satisfactory DD')).toBeInTheDocument();
    expect(screen.getByText('16.67%')).toBeInTheDocument();
    expect(screen.getByText('Maya Maker')).toBeInTheDocument();
  });
  it('maker cannot approve own sheet (disabled + notice); another approver can with a key', async () => {
    const own = mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet({ createdById: 'usr_admin' })) });
    const b = await screen.findByRole('button', { name: 'Approve' });
    expect(b).toBeDisabled();
    expect(screen.getByText(/You prepared this term sheet. A different approver is required/, { selector: '.ops-alert' })).toBeInTheDocument();
    own.unmount();
    const { api, user } = mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet(), { 'POST /api/v1/ops/term-sheets/ts-1/approve': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/term-sheets/ts-1/approve')))[0]);
  });
  it('lifecycle buttons per status: draft->Submit, approved->Issue (confirm), signed->Countersign (confirm, not by issuer), countersigned->Mark executed (confirm)', async () => {
    const cases: [string, string, string][] = [['DRAFT', 'Submit for approval', 'submit'], ['APPROVED', 'Issue to company', 'issue'], ['SIGNED_BY_COMPANY', 'Countersign', 'countersign'], ['COUNTERSIGNED', 'Mark executed', 'execute']];
    for (const [status, label, verb] of cases) {
      const { api, user, unmount } = mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet({ status }), { [`POST /api/v1/ops/term-sheets/ts-1/${verb}`]: D({}) }) });
      await user.click(await screen.findByRole('button', { name: label }));
      if (status !== 'DRAFT') {
        expectNotCalled(api, `POST /api/v1/ops/term-sheets/ts-1/${verb}`);
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }));
      }
      expectIdempotencyKey((await waitFor(() => expectCalled(api, `POST /api/v1/ops/term-sheets/ts-1/${verb}`)))[0]);
      unmount();
    }
  });
  it('the issuer cannot countersign', async () => {
    mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet({ status: 'SIGNED_BY_COMPANY', issuedById: 'usr_admin' })) });
    expect(await screen.findByRole('button', { name: 'Countersign' })).toBeDisabled();
  });
  it('without term_sheets.approve there is no approval control', async () => {
    mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, perms: without('term_sheets.approve'), routes: r(sheet()) });
    await screen.findByText('Series A term sheet');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
  it('version conflict / SoD error from approve is shown', async () => {
    const { user } = mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet(), { 'POST /api/v1/ops/term-sheets/ts-1/approve': fail(403, 'segregation_of_duties', 'Creator cannot approve') }) });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A different approver is required. Creator cannot approve');
  });
});

const ireq = (over: Record<string, unknown> = {}) => ({ id: 'ir-1', companyId: 'CO-1', companyName: 'Zim Agro Ltd', companyRef: 'CO-1', title: 'Irrigation pumps', description: 'x', status: 'SUBMITTED', priority: 'High', sourcingCategory: 'Equipment', currency: 'USD', estimatedAmount: 250000, needBy: '2026-12-01', createdByName: 'Tendai Moyo', note: '', ...over });
const consent = (over: Record<string, unknown> = {}) => ({ id: 'gc-1', companyId: 'CO-1', companyName: 'Zim Agro Ltd', companyRef: 'CO-1', title: 'Change auditor', basis: 'Shareholder agreement', submitted: '2026-10-01', due: '2026-10-20', owner: 'Board', status: 'Investor review', note: '', ...over });

describe('Investee requests', () => {
  const routes = (r: unknown[] = [ireq()], c: unknown[] = [consent()], extra = {}) => ({ 'GET /api/v1/ops/investee-requests': D(r), 'GET /api/v1/ops/investee-requests/consents': D(c), ...extra });
  it('lists requests and consents with company names', async () => {
    mountPage(<InvesteePage />, { routes: routes() });
    expect(await screen.findByText('Irrigation pumps')).toBeInTheDocument();
    expect(screen.getByText('Change auditor')).toBeInTheDocument();
    expect(screen.getAllByText('Zim Agro Ltd')).toHaveLength(2);
    expect(screen.getByText(/Equipment · High · Tendai Moyo/)).toBeInTheDocument();
  });
  it('Approve on a submitted request asks for confirmation then posts the decision to the company/request path with a key', async () => {
    const { api, user } = mountPage(<InvesteePage />, { routes: routes([ireq()], [], { 'POST /api/v1/ops/investee-requests/CO-1/ir-1/decide': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expectNotCalled(api, 'POST /api/v1/ops/investee-requests/CO-1/ir-1/decide');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/investee-requests/CO-1/ir-1/decide'));
    expectBody(r, { status: 'APPROVED' });
    expectIdempotencyKey(r);
  });
  it('approved request offers Mark fulfilled; rejected offers nothing', async () => {
    const { api, user } = mountPage(<InvesteePage />, { routes: routes([ireq({ status: 'APPROVED' }), ireq({ id: 'ir-2', status: 'REJECTED', title: 'Other' })], [], { 'POST /api/v1/ops/investee-requests/CO-1/ir-1/decide': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Mark fulfilled' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark fulfilled' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/investee-requests/CO-1/ir-1/decide')))[0], { status: 'FULFILLED' });
    expect(screen.getAllByRole('button', { name: 'Mark fulfilled' })).toHaveLength(1);
  });
  it('consent decisions use the consent path and Approved/Declined values', async () => {
    const { api, user } = mountPage(<InvesteePage />, { routes: routes([], [consent()], { 'POST /api/v1/ops/investee-requests/consents/CO-1/gc-1/decide': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Decline' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/investee-requests/consents/CO-1/gc-1/decide')))[0], { status: 'Declined' });
  });
  it('decision buttons are hidden without research.edit; empty states', async () => {
    mountPage(<InvesteePage />, { perms: without('research.edit'), routes: routes() });
    await screen.findByText('Irrigation pumps');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
  it('empty states and error state', async () => {
    const e = mountPage(<InvesteePage />, { routes: routes([], []) });
    expect(await screen.findByText('No company requests yet.')).toBeInTheDocument();
    expect(screen.getByText('No consent requests yet.')).toBeInTheDocument();
    e.unmount();
    mountPage(<InvesteePage />, { routes: { 'GET /api/v1/ops/investee-requests': fail(500, 'internal', 'down'), 'GET /api/v1/ops/investee-requests/consents': D([]) } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load requests: down/);
  });
});
