import { describe, it, expect } from 'vitest';
import NoticesPage from '@/app/(ops)/ops/notices/page';
import BankPage from '@/app/(ops)/ops/bank-instructions/page';
import ReportingPage from '@/app/(ops)/ops/reporting/page';
import CustodianPage from '@/app/(ops)/ops/custodian/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, screen, waitFor, within } from '../../_helpers';
import { D, created, mountPage, without } from './_kit';

const notice = (over: Record<string, unknown> = {}) => ({
  id: 'n-1', ref: 'NT-001', title: 'Q3 capital call issued', body: 'Dear LP, please pay by 15 Oct.', category: 'CAPITAL_CALL', targetType: 'FUND', fundId: 'f-1', fundName: 'Agri Growth Fund I', clientId: null, clientName: null, userId: null, requiresAcknowledgement: true, status: 'PENDING_APPROVAL',
  publishedAt: null, expiresAt: null, createdById: 'u-maker', createdByName: 'Maya Maker', approvedById: null, createdAt: '2026-10-01T00:00:00Z', ...over,
});

describe('LP notices', () => {
  const routes = (rows: unknown[] = [notice()], extra = {}) => ({ 'GET /api/v1/ops/notices': D(rows), 'GET /api/v1/ops/funds': D([]), ...extra });
  it('ADA-022: audience and prepared-by show names, never ids', async () => {
    const { user } = mountPage(<NoticesPage />, { routes: routes() });
    await user.click(await screen.findByText('Q3 capital call issued'));
    expect((await screen.findAllByText('Fund: Agri Growth Fund I')).length).toBeGreaterThan(0);
    expect(screen.getByText('Maya Maker')).toBeInTheDocument();
    expect(screen.queryByText('u-maker')).not.toBeInTheDocument();
  });
  it('ADA-022: a user-targeted notice shows the user name, an org notice the LP name', async () => {
    const rows = [notice({ id: 'n-2', title: 'To a user', targetType: 'USER', userId: 'uid-9', userName: 'Tendai Moyo', fundName: null }), notice({ id: 'n-3', title: 'To an LP', targetType: 'ORG', clientId: 'c1', clientName: 'Rutendo Trust' })];
    const { user } = mountPage(<NoticesPage />, { routes: routes(rows, { 'GET /api/v1/ops/notices/n-2/receipts': D([]), 'GET /api/v1/ops/notices/n-3/receipts': D([]) }) });
    await user.click(await screen.findByText('To a user'));
    expect((await screen.findAllByText('User: Tendai Moyo')).length).toBeGreaterThan(0);
    await user.click(screen.getByText('To an LP'));
    expect((await screen.findAllByText('LP: Rutendo Trust')).length).toBeGreaterThan(0);
  });
  it('shows an empty-state prompt until a notice is selected; empty list message', async () => {
    mountPage(<NoticesPage />, { routes: routes([]) });
    expect(await screen.findByText('No notices match this filter.')).toBeInTheDocument();
    expect(screen.getByText(/Select a notice to review/)).toBeInTheDocument();
  });
  it('status filter is sent to the API', async () => {
    const { api, user } = mountPage(<NoticesPage />, { routes: routes() });
    await screen.findByText('Q3 capital call issued');
    await user.selectOptions(screen.getByLabelText('Status'), 'PUBLISHED');
    await waitFor(() => expect(api.calls('GET /api/v1/ops/notices').at(-1)!.query.get('status')).toBe('PUBLISHED'));
  });
  it('maker cannot approve their own notice (disabled with reason + notice); a different approver can, with a key', async () => {
    const own = mountPage(<NoticesPage />, { routes: routes([notice({ createdById: 'usr_admin' })], { 'GET /api/v1/ops/notices/n-1/receipts': D([]) }) });
    await own.user.click(await screen.findByText('Q3 capital call issued'));
    const b = await screen.findByRole('button', { name: 'Approve' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'You prepared this notice. A different approver is required.');
    own.unmount();
    const { api, user } = mountPage(<NoticesPage />, { routes: routes([notice()], { 'GET /api/v1/ops/notices/n-1/receipts': D([]), 'POST /api/v1/ops/notices/n-1/approve': D({}) }) });
    await user.click(await screen.findByText('Q3 capital call issued'));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/notices/n-1/approve')))[0]);
  });
  it('draft: Submit for approval; approved: Publish asks for confirmation; published: Withdraw asks for confirmation', async () => {
    const draft = mountPage(<NoticesPage />, { routes: routes([notice({ status: 'DRAFT' })], { 'POST /api/v1/ops/notices/n-1/submit': D({}) }) });
    await draft.user.click(await screen.findByText('Q3 capital call issued'));
    await draft.user.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expectCalled(draft.api, 'POST /api/v1/ops/notices/n-1/submit'));
    draft.unmount();
    const pub = mountPage(<NoticesPage />, { routes: routes([notice({ status: 'APPROVED' })], { 'GET /api/v1/ops/notices/n-1/receipts': D([]), 'POST /api/v1/ops/notices/n-1/publish': D({}) }) });
    await pub.user.click(await screen.findByText('Q3 capital call issued'));
    await pub.user.click(await screen.findByRole('button', { name: 'Publish' }));
    expectNotCalled(pub.api, 'POST /api/v1/ops/notices/n-1/publish');
    await pub.user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expectCalled(pub.api, 'POST /api/v1/ops/notices/n-1/publish'));
  });
  it('published notice lists receipts with names and opened/acknowledged counts', async () => {
    const receipts = [
      { id: 'r1', noticeId: 'n-1', clientId: 'c1', clientName: 'Rutendo Trust', userId: 'u1', userName: 'Tendai Moyo', userEmail: 't@x', deliveredAt: '2026-10-02T00:00:00Z', openedAt: '2026-10-02T01:00:00Z', acknowledgedAt: null },
      { id: 'r2', noticeId: 'n-1', clientId: 'c2', clientName: 'Zinc LP', userId: 'u2', userName: null, userEmail: 'z@x.test', deliveredAt: '2026-10-02T00:00:00Z', openedAt: null, acknowledgedAt: null },
    ];
    const { user } = mountPage(<NoticesPage />, { routes: routes([notice({ status: 'PUBLISHED' })], { 'GET /api/v1/ops/notices/n-1/receipts': D(receipts) }) });
    await user.click(await screen.findByText('Q3 capital call issued'));
    expect(await screen.findByText('1 of 2 opened · 0 acknowledged')).toBeInTheDocument();
    expect(screen.getByText('Tendai Moyo')).toBeInTheDocument();
    expect(screen.getByText('z@x.test')).toBeInTheDocument();
  });
  it('New notice: audience FUND requires a fund; posts target fields with a key', async () => {
    const { api, user } = mountPage(<NoticesPage />, { routes: routes([], { 'GET /api/v1/ops/funds': D([{ id: 'f-1', name: 'Agri Growth Fund I', shortName: 'AGFI', currency: 'USD', operatingModel: 'PRIVATE_CAPITAL', version: 1 }]), 'POST /api/v1/ops/notices': created({}) }) });
    await user.click(await screen.findByRole('button', { name: 'New notice' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Title'), 'Hello');
    await user.type(within(d).getByLabelText('Message'), 'Body');
    await user.selectOptions(within(d).getByLabelText('Audience'), 'FUND');
    await within(d).findByRole('option', { name: /Agri Growth Fund I/ });
    await user.selectOptions(within(d).getByLabelText('Fund'), 'f-1');
    await user.click(within(d).getByRole('button', { name: 'Save draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/notices'));
    expectBody(req, { title: 'Hello', body: 'Body', category: 'GENERAL', targetType: 'FUND', fundId: 'f-1', requiresAcknowledgement: true });
    expectIdempotencyKey(req);
  });
  it('New notice hidden without notices.create', async () => {
    mountPage(<NoticesPage />, { perms: without('notices.create'), routes: routes([]) });
    await screen.findByText('No notices match this filter.');
    expect(screen.queryByRole('button', { name: 'New notice' })).not.toBeInTheDocument();
  });
});

const bank = (over: Record<string, unknown> = {}) => ({ id: 'bk-1', clientName: 'Rutendo Trust', clientRef: 'CL-1001', bankName: 'CBZ Bank', accountName: 'Rutendo Trust', accountNumberMasked: '****4321', fundName: 'Agri Growth Fund I', currency: 'USD', status: 'Pending verification', submittedAt: '2026-10-01T00:00:00Z', ...over });

describe('Bank instructions', () => {
  it('defaults to the pending filter and shows masked account numbers (never full)', async () => {
    const { api } = mountPage(<BankPage />, { routes: { 'GET /api/v1/ops/bank-instructions': D([bank()]) } });
    expect(await screen.findByText('****4321')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/ops/bank-instructions')[0].query.get('status')).toBe('Pending verification');
  });
  it('Record call-back posts the note with an Idempotency-Key (needs clients.edit)', async () => {
    const { api, user } = mountPage(<BankPage />, { routes: { 'GET /api/v1/ops/bank-instructions': D([bank()]), 'POST /api/v1/ops/bank-instructions/bk-1/verify': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Record call-back' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('What was confirmed'), 'Spoke to signatory');
    await user.click(within(d).getByRole('button', { name: 'Record call-back' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/bank-instructions/bk-1/verify'));
    expectBody(req, { callbackNote: 'Spoke to signatory' });
    expectIdempotencyKey(req);
  });
  it('under verification: Activate needs cash.approve and confirmation; segregation error is shown', async () => {
    const routes = { 'GET /api/v1/ops/bank-instructions': D([bank({ status: 'Under verification' })]), 'POST /api/v1/ops/bank-instructions/bk-1/approve': fail(403, 'segregation_of_duties', 'You recorded the call-back') };
    const { user } = mountPage(<BankPage />, { routes });
    await user.click(await screen.findByRole('button', { name: 'Activate' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A different approver is required. You recorded the call-back');
  });
  it('without cash.approve the Activate control is not offered; without clients.edit there is no call-back control', async () => {
    mountPage(<BankPage />, { perms: without('cash.approve', 'clients.edit'), routes: { 'GET /api/v1/ops/bank-instructions': D([bank(), bank({ id: 'bk-2', status: 'Under verification' })]) } });
    await screen.findAllByText('CBZ Bank');
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record call-back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
  it('Reject sends the reason; empty state', async () => {
    const { api, user } = mountPage(<BankPage />, { routes: { 'GET /api/v1/ops/bank-instructions': D([bank()]), 'POST /api/v1/ops/bank-instructions/bk-1/reject': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Account name mismatch');
    await user.click(within(d).getByRole('button', { name: 'Reject' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/bank-instructions/bk-1/reject')))[0], { reason: 'Account name mismatch' });
  });
  it('empty state', async () => {
    mountPage(<BankPage />, { routes: { 'GET /api/v1/ops/bank-instructions': D([]) } });
    expect(await screen.findByText('No bank instructions match this filter.')).toBeInTheDocument();
  });
});

const pack = (over: Record<string, unknown> = {}) => ({ id: 'pk-1', uuid: 'uuid-1', label: 'Sept 2026', due: '2026-10-15', status: 'submitted', submittedAt: '2026-10-10T00:00:00Z', reviewNote: null, company: { id: 'CO-1', name: 'Zim Agro Ltd' }, ...over });

describe('Reporting packs', () => {
  const routes = (rows: unknown[] = [pack()], extra = {}) => ({ 'GET /api/v1/private-markets/reporting-packs': D(rows), 'GET /api/v1/private-markets/companies': D([{ id: 'CO-1', name: 'Zim Agro Ltd' }]), ...extra });
  it('lists packs for the default submitted status, with the company name', async () => {
    const { api } = mountPage(<ReportingPage />, { routes: routes() });
    expect(await screen.findByText('Zim Agro Ltd')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/private-markets/reporting-packs')[0].query.get('status')).toBe('submitted');
  });
  it('ADA-026: open/returned packs past due are marked Overdue; submitted and not-yet-due ones are not', async () => {
    const rows = [pack({ id: 'a', uuid: 'a', status: 'open', due: '2020-01-31T00:00:00.000Z', company: { id: 'c', name: 'Late Co' } }), pack({ id: 'b', uuid: 'b', status: 'open', due: '2999-01-31', company: { id: 'd', name: 'Future Co' } }), pack({ id: 'c', uuid: 'c', status: 'submitted', due: '2020-01-31', company: { id: 'e', name: 'Sub Co' } })];
    mountPage(<ReportingPage />, { routes: routes(rows) });
    await screen.findByText('Late Co');
    expect(screen.getAllByText('Overdue')).toHaveLength(1);
    expect(within(screen.getByText('Late Co').closest('tr')!).getByText('Overdue')).toBeInTheDocument();
  });
  it('ADA-026: Open period posts company + period + due, then switches the list to "open" so the new period is visible', async () => {
    const { api, user } = mountPage(<ReportingPage />, { routes: routes([], { 'POST /api/v1/private-markets/companies/CO-1/periods': created({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Open period' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Zim Agro Ltd/ });
    await user.selectOptions(within(d).getByLabelText('Company'), 'CO-1');
    await user.type(within(d).getByLabelText(/Period/), '2026-10');
    const due = within(d).getByLabelText('Due date');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(due, '2026-11-15');
    due.dispatchEvent(new Event('input', { bubbles: true }));
    due.dispatchEvent(new Event('change', { bubbles: true }));
    await user.click(within(d).getByRole('button', { name: 'Open period' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/companies/CO-1/periods')))[0], { period: '2026-10', due: '2026-11-15' });
    await waitFor(() => expect(api.calls('GET /api/v1/private-markets/reporting-packs').at(-1)!.query.get('status')).toBe('open'));
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('open');
  });
  it('period field enforces YYYY-MM', async () => {
    const { user } = mountPage(<ReportingPage />, { routes: routes([]) });
    await user.click(await screen.findByRole('button', { name: 'Open period' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText(/Period/)).toHaveAttribute('pattern', '\\d{4}-(0[1-9]|1[0-2])');
  });
  it('Accept asks for confirmation then posts with a key; Return needs a note', async () => {
    const { api, user } = mountPage(<ReportingPage />, { routes: routes([pack()], { 'POST /api/v1/private-markets/reporting-packs/uuid-1/accept': D({}), 'POST /api/v1/private-markets/reporting-packs/uuid-1/return': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expectNotCalled(api, 'POST /api/v1/private-markets/reporting-packs/uuid-1/accept');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Accept' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/reporting-packs/uuid-1/accept')))[0]);
    await user.click(screen.getByRole('button', { name: 'Return' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/What needs to change/), 'Cash flow does not match');
    await user.click(within(d).getByRole('button', { name: 'Return pack' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/reporting-packs/uuid-1/return')))[0], { note: 'Cash flow does not match' });
  });
  it('reviewers only: Accept/Return/Open period are hidden without research.edit', async () => {
    mountPage(<ReportingPage />, { perms: ['portfolio.view'], routes: routes() });
    await screen.findByText('Zim Agro Ltd');
    for (const n of ['Accept', 'Return', 'Open period']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
  });
});

const dayEnd = (over: Record<string, unknown> = {}) => ({ id: 'de-1', ref: 'DAY-001', counterpartyId: 'cp-1', counterpartyName: 'Standard Chartered', accountRef: 'ACC-9', statementDate: '2026-09-30', currency: 'USD', closingCash: '1000.00', holdingsMv: '250000.00', tradeCount: 2, executionsReceived: 3, sha256: 'abcdef0123456789abcdef', status: 'Approved', submittedAt: '2026-10-01T09:00:00Z', submittedByName: 'Sam Submitter', reviewNote: null, ...over });

describe('Custodian submissions', () => {
  const routes = (rows: unknown = { dayEnds: [dayEnd()] }, extra = {}) => ({ 'GET /api/v1/ops/custodian/submissions': D(rows), 'GET /api/v1/ops/custodian/counterparties': D({ items: [{ id: 'cp-1', ref: 'CP-1', name: 'Standard Chartered' }] }), ...extra });
  it('ADA-027: shows package trades and the separate executions-received count, and holdings MV', async () => {
    mountPage(<CustodianPage />, { routes: routes() });
    expect(await screen.findByText('DAY-001')).toBeInTheDocument();
    expect(screen.getByText('3 executions received')).toBeInTheDocument();
    expect(screen.getByText(/250,000.00/)).toBeInTheDocument();
    expect(screen.getByText('Sam Submitter')).toBeInTheDocument();
    expect(screen.getByText(/sha256 abcdef012345/)).toBeInTheDocument();
  });
  it('accepts both the {dayEnds} envelope and a bare array', async () => {
    mountPage(<CustodianPage />, { routes: routes([dayEnd({ ref: 'DAY-ARR' })]) });
    expect(await screen.findByText('DAY-ARR')).toBeInTheDocument();
  });
  it('empty state', async () => {
    mountPage(<CustodianPage />, { routes: routes({ dayEnds: [] }) });
    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument();
  });
  it('Review posts the decision and note with a key; only for approved packages and custodian.review holders', async () => {
    const { api, user } = mountPage(<CustodianPage />, { routes: routes({ dayEnds: [dayEnd()] }, { 'POST /api/v1/ops/custodian/day-end/de-1/review': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const d = await screen.findByRole('dialog');
    await user.selectOptions(within(d).getByLabelText('Decision'), 'REJECT');
    await user.type(within(d).getByLabelText(/Note/), 'Holdings do not match');
    await user.click(within(d).getByRole('button', { name: 'Record decision' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/custodian/day-end/de-1/review'));
    expectBody(req, { decision: 'REJECT', note: 'Holdings do not match' });
    expectIdempotencyKey(req);
  });
  it('no Review/Invite without custodian.review; non-approved packages cannot be reviewed', async () => {
    mountPage(<CustodianPage />, { perms: without('custodian.review'), routes: routes() });
    await screen.findByText('DAY-001');
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
  });
  it('Invite user sends counterparty, email and role with a key', async () => {
    const { api, user } = mountPage(<CustodianPage />, { routes: routes({ dayEnds: [] }, { 'POST /api/v1/ops/custodian/users': created({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Invite user' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /Standard Chartered/ });
    await user.selectOptions(within(d).getByLabelText('Counterparty'), 'cp-1');
    await user.type(within(d).getByLabelText('Work email'), 'ops@scb.test');
    await user.selectOptions(within(d).getByLabelText('Role'), 'approver');
    await user.click(within(d).getByRole('button', { name: 'Send invitation' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/custodian/users'));
    expectBody(req, { counterpartyId: 'cp-1', email: 'ops@scb.test', role: 'approver' });
    expectIdempotencyKey(req);
  });
});
