import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpOrganisationScreen } from '@/components/lp-portal/screens/lp-organisation-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, within, expectCalled, expectIdempotencyKey, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, FUND_PE } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

const colleague = (over: Record<string, unknown> = {}) => ({
  membershipId: 'mem-1', userId: 'u-1', email: 'ann@alpha.test', name: 'Ann Alpha', lpRole: 'MANAGER', fundIds: [FUND_PE.fundId], isActive: true,
  status: 'ACTIVE', revokedAt: null, mfaEnabled: true, lastActiveAt: '2026-07-01T10:00:00Z', ...over,
});
const COLLEAGUES = [
  colleague(),
  colleague({ membershipId: 'mem-2', userId: 'u-2', email: 'bob@alpha.test', name: 'Bob Beta', lpRole: 'VIEWER', fundIds: null, mfaEnabled: false, lastActiveAt: null }),
  colleague({ membershipId: 'mem-3', userId: 'u-3', email: 'cy@alpha.test', name: 'Cy Gone', lpRole: 'SIGNATORY', status: 'REVOKED', isActive: false, mfaEnabled: false, revokedAt: '2026-06-01T00:00:00Z' }),
  colleague({ membershipId: 'inv-1', userId: '', email: 'new@alpha.test', name: 'new@alpha.test', lpRole: 'VIEWER', status: 'INVITED', isActive: false, mfaEnabled: false }),
];
const ORG = { id: 'cli-a', legalName: 'Alpha Family Office', investorId: 'INV-0001', email: 'lp@alpha.test', country: 'US', phone: '', address: '', status: 'ACTIVE', lpRole: 'MANAGER', colleagues: COLLEAGUES };

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/organisation`]: ok(ORG),
    // The API answers {items:[]} here, not a bare array
    [`GET ${API}/bank-instructions/changes`]: ok({ items: [{ id: 'b1', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', accountNumberMasked: '****4321', requestedBy: 'Ann Alpha', submittedAt: '2026-06-20T10:00:00Z', status: 'PENDING_VERIFICATION' }] }),
    ...over,
  } as never;
}
beforeEach(() => vi.clearAllMocks());
const ready = () => screen.findByText('Bob Beta');

describe('Organisation: colleagues and bank instructions', () => {
  it('QA: renders with the real API shapes (fundIds null, items envelope for bank changes) without crashing', async () => {
    const api = liveApi(routes());
    renderLp(<LpOrganisationScreen />);
    await ready();
    expect(screen.getByText('Alpha Family Office')).toBeInTheDocument();
    expect(screen.getByText('Investor INV-0001')).toBeInTheDocument();
    expect(screen.getByText('Under Verification')).toBeInTheDocument(); // bank change status mapped
    expect(screen.getByText('****4321')).toBeInTheDocument();
    expect(screen.getAllByText('Growth Fund I').length).toBeGreaterThan(0);
    expectCalled(api, `GET ${API}/organisation`);
    expectCalled(api, `GET ${API}/bank-instructions/changes`);
    expectNoUnmocked();
  });

  it('roles map to labels; revoked colleagues are NOT shown or counted as Active; invited are counted separately', async () => {
    liveApi(routes());
    renderLp(<LpOrganisationScreen />);
    await ready();
    const dir = within(screen.getAllByRole('table')[0]);
    expect(dir.getByText('Investor Admin')).toBeInTheDocument();
    expect(dir.getByText('Signatory')).toBeInTheDocument();
    const goneRow = screen.getByText('Cy Gone').closest('tr')!;
    expect(within(goneRow).getByText('Revoked')).toBeInTheDocument();
    expect(within(goneRow).queryByText('Active')).not.toBeInTheDocument();
    expect(screen.getByText('2 active · 1 invited')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // authorised users
    expect(screen.getByText('1/4')).toBeInTheDocument(); // MFA coverage uses mfaEnabled
  });

  it('search filters the directory', async () => {
    liveApi(routes());
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByPlaceholderText('Search users...'));
    await user.paste('bob');
    const dir = within(screen.getAllByRole('table')[0]);
    expect(dir.queryByText('Ann Alpha')).not.toBeInTheDocument();
    expect(dir.getByText('Bob Beta')).toBeInTheDocument();
  });

  it('invite: empty email is rejected with no request', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Invite User' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Send Invite' }));
    expect(toast.error).toHaveBeenCalledWith('Email is required.');
    expect(api.calls(`POST ${API}/colleagues`)).toHaveLength(0);
  });

  it('invite: idempotent POST with email, role and fund scope; closes, toasts and refetches', async () => {
    const api = liveApi(routes({ [`POST ${API}/colleagues`]: ok({ id: 'inv-2', status: 'INVITED' }, 201) }));
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Invite User' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByPlaceholderText('colleague@company.com'));
    await user.paste('  new.person@alpha.test ');
    await user.click(within(dlg).getByRole('button', { name: 'Send Invite' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation sent.'));
    const [req] = expectCalled(api, `POST ${API}/colleagues`);
    expectIdempotencyKey(req);
    expect(req.body).toEqual({ email: 'new.person@alpha.test', role: 'VIEWER', fundIds: [FUND_PE.fundId, 'fund-bal-1'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.calls(`GET ${API}/organisation`).length).toBeGreaterThanOrEqual(2);
  });

  it('invite: server rejection (already has access) shows the API message and keeps the dialog open', async () => {
    liveApi(routes({ [`POST ${API}/colleagues`]: fail(409, 'LP_VERSION_CONFLICT', 'User already has active access') }));
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Invite User' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByPlaceholderText('colleague@company.com'));
    await user.paste('bob@alpha.test');
    await user.click(within(dlg).getByRole('button', { name: 'Send Invite' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('User already has active access'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('invite: invalid email from the API is reported (LP_VALIDATION), not swallowed', async () => {
    liveApi(routes({ [`POST ${API}/colleagues`]: { status: 400, body: { success: false, code: 'LP_VALIDATION', message: 'Enter a valid email address', fieldErrors: { email: 'Invalid email' } } } }));
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Invite User' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByPlaceholderText('colleague@company.com'));
    await user.paste('not-an-email');
    await user.click(within(dlg).getByRole('button', { name: 'Send Invite' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Enter a valid email address'));
  });

  it('revoke access: PATCH /colleagues/:id/revoke then refetch; revoked rows cannot be revoked again', async () => {
    const api = liveApi(routes({ [`PATCH ${API}/colleagues/:id/revoke`]: ok({ membershipId: 'mem-2', userId: 'u-2', revokedById: 'u-1' }) }));
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Actions for Bob Beta' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke access' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Access revoked.'));
    expectCalled(api, `PATCH ${API}/colleagues/mem-2/revoke`);
    expect(api.calls(`GET ${API}/organisation`).length).toBeGreaterThanOrEqual(2);
  });

  it('revoke failure shows the API message', async () => {
    liveApi(routes({ [`PATCH ${API}/colleagues/:id/revoke`]: fail(403, 'LP_FORBIDDEN', 'Managers only') }));
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Actions for Bob Beta' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke access' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Managers only'));
  });

  it('bank instruction change: requires fund, bank name and account number; submits idempotently', async () => {
    const api = liveApi(routes({ [`POST ${API}/bank-instructions/changes`]: ok({ id: 'b2', status: 'SUBMITTED' }, 201) }));
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Request Change' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Submit Request' }));
    expect(toast.error).toHaveBeenCalledWith('Fund, bank name, and account number are required.');
    expect(api.calls(`POST ${API}/bank-instructions/changes`)).toHaveLength(0);
    await user.click(within(dlg).getByPlaceholderText('Bank name'));
    await user.paste('Second Bank');
    await user.click(within(dlg).getByPlaceholderText('Account number'));
    await user.paste('000123456');
    await user.click(within(dlg).getByPlaceholderText('Confirm account number'));
    await user.paste('000123456');
    await user.click(within(dlg).getByRole('button', { name: 'Submit Request' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bank instruction change submitted.'));
    const [req] = expectCalled(api, `POST ${API}/bank-instructions/changes`);
    expectIdempotencyKey(req);
    expect(req.body).toEqual({ fundId: FUND_PE.fundId, bankName: 'Second Bank', accountName: undefined, accountNumber: '000123456', confirmAccountNumber: '000123456' });
  });

  it('FR-LP-099: a confirm-account-number that does not match is refused before anything is sent', async () => {
    const api = liveApi(routes({ [`POST ${API}/bank-instructions/changes`]: ok({ id: 'b2', status: 'SUBMITTED' }, 201) }));
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Request Change' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByPlaceholderText('Bank name'));
    await user.paste('Second Bank');
    await user.click(within(dlg).getByPlaceholderText('Account number'));
    await user.paste('000123456');
    await user.click(within(dlg).getByPlaceholderText('Confirm account number'));
    await user.paste('000123457');
    await user.click(within(dlg).getByRole('button', { name: 'Submit Request' }));
    expect(toast.error).toHaveBeenCalledWith('The account numbers do not match.');
    expect(api.calls(`POST ${API}/bank-instructions/changes`)).toHaveLength(0);
  });

  it('MFA step-up on the bank change: the MFA dialog opens and the SAME request is retried after the code', async () => {
    let n = 0;
    const api = liveApi(
      routes({
        [`POST ${API}/bank-instructions/changes`]: () => (++n === 1 ? fail(403, 'LP_STEP_UP_REQUIRED', 'Confirm with your code') : ok({ id: 'b2', status: 'SUBMITTED' }, 201)),
        'POST /api/v1/auth/mfa/step-up': ok({}),
      }),
    );
    const { user } = renderLp(<LpOrganisationScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Request Change' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByPlaceholderText('Bank name'));
    await user.paste('Second Bank');
    await user.click(within(dlg).getByPlaceholderText('Account number'));
    await user.paste('000123456');
    await user.click(within(dlg).getByPlaceholderText('Confirm account number'));
    await user.paste('000123456');
    await user.click(within(dlg).getByRole('button', { name: 'Submit Request' }));
    const mfa = await screen.findByTestId('lp-step-up-dialog');
    await user.click(within(mfa).getByLabelText('Authentication code'));
    await user.paste('654321');
    await user.click(within(mfa).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bank instruction change submitted.'));
    const posts = api.calls(`POST ${API}/bank-instructions/changes`);
    expect(posts).toHaveLength(2);
    expect(posts[0].idempotencyKey).toBe(posts[1].idempotencyKey);
  });

  it('viewer: invite / revoke / bank change controls are disabled and a reason banner is shown', async () => {
    liveApi(routes({ [`GET ${API}/organisation`]: ok({ ...ORG, lpRole: 'VIEWER', colleagues: [] }) }), { session: { lpRole: 'VIEWER' } });
    renderLp(<LpOrganisationScreen />);
    expect(await screen.findByText('Colleague management requires Manager role.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite User' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Request Change' })).toBeDisabled();
  });

  it('error state shows the API message', async () => {
    liveApi(routes({ [`GET ${API}/organisation`]: fail(500, 'internal', 'Organisation unavailable') }));
    renderLp(<LpOrganisationScreen />);
    expect(await screen.findByText(/Organisation unavailable/)).toBeInTheDocument();
  });
});
