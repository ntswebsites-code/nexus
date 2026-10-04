import { describe, it, expect } from 'vitest';
import ClientsPage from '@/app/(ops)/ops/clients/page';
import { mountPage } from './_kit';
import { raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const client = (o: Record<string, unknown> = {}) => ({ id: 'CL-00418', name: 'Horizon Pension Fund LP', type: 'Pension fund', accounts: 5, ccy: 'USD', kyc: 'Current', risk: 'Low', mandate: 'Balanced Growth', owner: 'Rel Owner', email: 'h@example.test', ...o });
const d360 = (o: Record<string, unknown> = {}) => ({
  client: { ...client(), uuid: 'u-1', dealingHold: false, holdReason: null, country: 'ZW', phone: '+263', registration: 'REG-1', address: '1 Main St', nextReviewDate: '2026-12-01', relationshipOwnerId: 'st1', portalEnabled: true },
  mandates: [{ id: 'MND-1', name: 'Balanced Growth', type: 'discretionary', status: 'Shell' }, { id: 'MND-2', name: 'Private markets', type: 'private_markets', status: 'Active' }],
  cashAccounts: [{ id: 'CA-1', legalEntity: 'Horizon Pension Fund LP', provider: 'CBZ', masked: '****1234', currency: 'USD', ownership: 'SEGREGATED', status: 'DRAFT', type: 'x' }, { id: 'CA-2', legalEntity: 'Horizon Pension Fund LP', provider: 'Stanbic', masked: '****9999', currency: 'USD', ownership: 'OMNIBUS', status: 'PENDING_APPROVAL', type: 'x' }],
  portfolios: [{ id: 'PF-1', name: 'Balanced Growth Fund', type: 'Pooled', currency: 'USD', status: 'Active' }],
  commitments: [{ fund: 'Zim Growth Fund III', fundRef: 'PEF-1', amount: 1500000, currency: 'USD', status: 'Active', effectiveDate: '2024-01-01' }],
  documents: { total: 26, recent: [{ id: 'DOC-1', name: 'Mandate.pdf', type: 'Mandate', classification: 'Restricted', status: 'Approved', date: '2026-01-01' }] },
  kycCases: [], requests: { open: 2, recent: [{ id: 'REQ-1', title: 'Statement request', status: 'Open', type: 'Statement', slaDueAt: '2026-09-01T00:00:00Z' }] }, portalUsers: [{ email: 'u@x.test', name: 'U', role: 'viewer', lastLoginAt: null }], capitalEvents: 4, pendingChanges: 0, ...o,
});
const summary = raw({ total: 40, onHold: 1, reviewOverdue: 3, reviewDueIn30Days: 4, byKyc: { Current: 30, 'Review due': 2, 'Enhanced review': 1 }, byRisk: { High: 5 }, accountsByStatus: { PENDING_APPROVAL: 2, ACTIVE: 50 } });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/client-ops/clients/summary': summary,
  'GET /api/v1/clients': raw({ data: [client(), client({ id: 'CL-00419', name: 'Acme Corp', type: 'Corporate', accounts: 1, kyc: 'Review due', risk: 'High' })] }),
  'GET /api/v1/client-ops/clients/:id/360': raw(d360()),
  'GET /api/v1/client-ops/change-requests': raw({ data: [] }),
  'GET /api/v1/client-ops/staff': raw({ data: [{ id: 'st1', name: 'Rel Owner', email: 'r@x.test', roles: [] }] }),
  ...o,
});
const EDIT = ['clients.view', 'clients.edit'];

describe('Clients: list and 360 consistency (ADB-013)', () => {
  it('shows tiles and rows with names, KYC and risk tones; no raw uuids', async () => {
    await mountPage(<ClientsPage />, { routes: base() });
    expect(await screen.findByText('Horizon Pension Fund LP')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('5 high risk')).toBeInTheDocument();
    expect(screen.getByText('3 in review')).toBeInTheDocument();
    expect(screen.queryByText('u-1')).not.toBeInTheDocument();
  });
  it('filters are sent as query params', async () => {
    const { user, api } = await mountPage(<ClientsPage />, { routes: base() });
    await screen.findByText('Acme Corp');
    await user.type(screen.getByPlaceholderText('Name, reference or owner'), 'hor');
    await user.selectOptions(screen.getByLabelText('KYC'), 'Review due');
    await user.selectOptions(screen.getByLabelText('Risk'), 'High');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/clients').at(-1)!.query;
      expect(q.get('q')).toBe('hor');
      expect(q.get('kyc')).toBe('Review due');
      expect(q.get('risk')).toBe('High');
    });
  });
  it('ADB-013: tab labels count real rows: accounts, mandates, portfolios AND commitments separately', async () => {
    const { user } = await mountPage(<ClientsPage />, { routes: base() });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    expect(await screen.findByRole('tab', { name: 'Cash accounts (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mandates (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Portfolios (1) & commitments (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Documents (26)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'KYC & requests (2 open)' })).toBeInTheDocument();
  });
  it('ADB-013: KYC Current without a case explains it was set directly on the client record', async () => {
    const { user } = await mountPage(<ClientsPage />, { routes: base() });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('tab', { name: /KYC & requests/ }));
    expect(await screen.findByText(/KYC status Current was set directly on the client record/)).toBeInTheDocument();
  });
  it('ADB-013: after creating a client the drawer selects the NEW client (not the previous one)', async () => {
    const { user, api } = await mountPage(<ClientsPage />, {
      perms: EDIT,
      routes: base({ 'POST /api/v1/clients': raw({ client: { id: 'CL-NEW' } }, 201), 'GET /api/v1/client-ops/clients/:id/360': (_r: unknown, p: Record<string, string>) => raw(p.id === 'CL-NEW' ? d360({ client: { ...d360().client, id: 'CL-NEW', name: 'QA Test Client' } }) : d360()) }),
    });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await screen.findByRole('tab', { name: 'Cash accounts (2)' });
    await user.click(screen.getByRole('button', { name: 'New client' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Legal name/), 'QA Test Client');
    await user.click(within(dlg).getByRole('button', { name: 'Create client' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/clients'));
    expectBody(req!, { name: 'QA Test Client', type: 'Individual', ccy: 'USD', risk: 'Medium' });
    expectIdempotencyKey(req!);
    await waitFor(() => expectCalled(api, 'GET /api/v1/client-ops/clients/CL-NEW/360'));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).join('|')).toMatch(/QA Test Client/));
  });
  it('360 tabs: accounts list shows masked identifiers only; mandates; holdings with commitment amount; documents; requests', async () => {
    const { user } = await mountPage(<ClientsPage />, { routes: base() });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('tab', { name: /Cash accounts/ }));
    expect(await screen.findByText(/\*\*\*\*1234/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Portfolios/ }));
    expect(await screen.findByText('USD 1,500,000.00')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Documents/ }));
    expect(await screen.findByText('Mandate.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /KYC & requests/ }));
    expect(await screen.findByText('Statement request')).toBeInTheDocument();
  });
  it('ADB-013: empty 360 collections are called out per tab', async () => {
    const { user } = await mountPage(<ClientsPage />, { routes: base({ 'GET /api/v1/client-ops/clients/:id/360': raw(d360({ cashAccounts: [], mandates: [], portfolios: [], commitments: [] })) }) });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('tab', { name: 'Cash accounts (0)' }));
    expect(await screen.findByText('No cash accounts.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Mandates (0)' }));
    expect(await screen.findByText('No mandates.')).toBeInTheDocument();
  });
  it('empty list and API error states', async () => {
    const a = await mountPage(<ClientsPage />, { routes: base({ 'GET /api/v1/clients': raw({ data: [] }) }) });
    expect(await screen.findByText('No clients match.')).toBeInTheDocument();
    a.unmount();
    await mountPage(<ClientsPage />, { routes: base({ 'GET /api/v1/clients': fail(500, 'x', 'Registry offline') }) });
    expect(await screen.findByText(/Could not load clients: Registry offline/)).toBeInTheDocument();
  });
  it('without clients.view: access denied naming the permission', async () => {
    await mountPage(<ClientsPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the clients.view permission/)).toBeInTheDocument();
  });
});

describe('Clients: maker-checker actions', () => {
  it('dealing hold release is a change request for a different approver; hold itself needs a reason', async () => {
    const { user, api } = await mountPage(<ClientsPage />, {
      perms: EDIT,
      routes: base({
        'GET /api/v1/client-ops/clients/:id/360': raw(d360({ client: { ...d360().client, dealingHold: true, holdReason: 'KYC review' } })),
        'POST /api/v1/client-ops/clients/:id/change-requests': raw({}, 201),
      }),
    });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    expect(await screen.findByText(/Dealing hold in place: KYC review/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request hold release' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/A different person must approve the release/)).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText(/Reason for release/), 'Review complete');
    await user.click(within(dlg).getByRole('button', { name: 'Send for approval' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/clients/CL-00418/change-requests'));
    expectBody(req!, { kind: 'DEALING_HOLD_RELEASE', reason: 'Review complete' });
    expectIdempotencyKey(req!);
  });
  it('place a dealing hold posts hold:true with a reason', async () => {
    const { user, api } = await mountPage(<ClientsPage />, { perms: EDIT, routes: base({ 'POST /api/v1/client-ops/clients/:id/dealing-hold': raw({}) }) });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('button', { name: 'Place dealing hold' }));
    await user.type(screen.getByLabelText(/^Reason/), 'Court order');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Place hold' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/clients/CL-00418/dealing-hold'));
    expectBody(req!, { hold: true, reason: 'Court order' });
  });
  it('viewer has no hold / owner actions in the drawer', async () => {
    const { user } = await mountPage(<ClientsPage />, { perms: ['clients.view'], routes: base() });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await screen.findByRole('tab', { name: 'Cash accounts (2)' });
    expect(screen.queryByRole('button', { name: 'Place dealing hold' })).not.toBeInTheDocument();
  });
  it('pending change requests: requester sees Withdraw only; another approver with onboarding.approve sees Approve/Reject and must write a note (5+ chars)', async () => {
    const reqs = raw({ data: [{ id: 'cr1', kind: 'MANDATE_STATUS', client: 'Acme Corp', clientRef: 'CL-00419', mandate: 'MND-9', mandateName: 'X', from: 'Shell', to: 'Active', reason: 'Go live', maker: 'Maker M', makerId: 'usr_other', createdAt: '2026-09-01T00:00:00Z' }, { id: 'cr2', kind: 'DEALING_HOLD_RELEASE', client: 'Horizon', clientRef: 'CL-1', mandate: null, mandateName: null, from: '', to: '', reason: 'Own', maker: 'Me', makerId: 'usr_admin', createdAt: '2026-09-01T00:00:00Z' }] });
    const { user, api } = await mountPage(<ClientsPage />, { perms: [...EDIT, 'onboarding.approve'], routes: base({ 'GET /api/v1/client-ops/change-requests': reqs, 'POST /api/v1/client-ops/change-requests/:id/approve': raw({}), 'POST /api/v1/client-ops/change-requests/:id/withdraw': raw({}) }) });
    expect(await screen.findByText('Pending approvals (2)')).toBeInTheDocument();
    expect(screen.getByText('Mandate MND-9: Shell to Active')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1); // only the other maker's request
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1); // only my own
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const note = screen.getByLabelText(/^Note/);
    expect(note).toBeRequired();
    await user.type(note, 'Verified');
    await user.click(screen.getByRole('button', { name: 'Approve and apply' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/change-requests/cr1/approve'));
    expectBody(req!, { note: 'Verified' });
    expectIdempotencyKey(req!);
  });
  it('mandate activation asks for an in-app confirm then files a change request', async () => {
    const { user, api } = await mountPage(<ClientsPage />, { perms: EDIT, routes: base({ 'POST /api/v1/client-ops/clients/:id/change-requests': raw({}, 201) }) });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('tab', { name: /Mandates/ }));
    await user.click(await screen.findByRole('button', { name: 'Request activation' }));
    expect(api.calls('POST /api/v1/client-ops/clients/CL-00418/change-requests')).toHaveLength(0);
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Request activation' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/clients/CL-00418/change-requests'));
    expectBody(req!, { kind: 'MANDATE_STATUS', mandate: 'MND-1', status: 'Active' });
  });
  it('draft cash account can be submitted for approval (key sent); add cash account posts clientId', async () => {
    const { user, api } = await mountPage(<ClientsPage />, { perms: EDIT, routes: base({ 'POST /api/v1/cash-accounts/:id/submit': raw({}), 'POST /api/v1/cash-accounts': raw({}, 201) }) });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('tab', { name: /Cash accounts/ }));
    await user.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash-accounts/CA-1/submit'));
    expectIdempotencyKey(req!);
    await user.click(screen.getByRole('button', { name: 'Add cash account' }));
    const dlg = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(dlg).getByLabelText(/Bank \/ provider/), 'CBZ');
    await user.type(within(dlg).getByLabelText(/Account identifier/), '0012345678');
    await user.click(within(dlg).getByRole('button', { name: 'Add account' }));
    const [c] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash-accounts'));
    expectBody(c!, { clientId: 'CL-00418', provider: 'CBZ', currency: 'USD', ownership: 'SEGREGATED' });
  });
  it('ADB-012: a cash account in Pending approval shows an Approve control; without cash.approve it is visible, disabled and names the permission', async () => {
    const { user, api } = await mountPage(<ClientsPage />, { perms: EDIT, routes: base({ 'POST /api/v1/cash-accounts/:id/approve': raw({}) }) });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('tab', { name: /Cash accounts/ }));
    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(approve.getAttribute('title')).toMatch(/cash\.approve/);
    expect(screen.getByText(/Needs cash\.approve/)).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/cash-accounts/CA-2/approve');
    void user;
  });
  it('ADB-012: with cash.approve the pending account can be approved (confirm, key); an SoD refusal reads "different approver"', async () => {
    const { user, api } = await mountPage(<ClientsPage />, { perms: [...EDIT, 'cash.approve'], routes: base({ 'POST /api/v1/cash-accounts/:id/approve': fail(409, 'segregation_of_duties', 'The maker of this account cannot approve it') }) });
    await user.click(await screen.findByText('Horizon Pension Fund LP'));
    await user.click(await screen.findByRole('tab', { name: /Cash accounts/ }));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash-accounts/CA-2/approve'));
    expectIdempotencyKey(req!);
    expect(await screen.findByText(/A different approver is required/)).toBeInTheDocument();
  });
});
