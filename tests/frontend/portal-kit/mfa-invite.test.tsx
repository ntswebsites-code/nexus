import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from '@matanho/shared';
import { MfaStep, AcceptInviteForm } from '@matanho/portal-kit';
import { mockApi, raw, fail, expectCalled, expectNotCalled, expectBody, renderWithProviders, screen, waitFor } from '../_helpers';
import { stubLocation } from './_loc';

const API = 'http://localhost:4100';
const client = () => createApiClient({ baseUrl: API });
const ENROL = { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Matanho:a?secret=JBSWY3DPEHPK3PXP' };

describe('MfaStep verify mode', () => {
  it('posts the 6 digits and calls onDone', async () => {
    const api = mockApi({ 'POST /api/auth/mfa/verify': raw({ user: { id: 'u' } }) });
    const onDone = vi.fn();
    const { user } = renderWithProviders(<MfaStep api={client()} mode="verify" onDone={onDone} onCancel={() => {}} />);
    expect(screen.getByText(/Enter the 6-digit code/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expectBody(expectCalled(api, 'POST /api/auth/mfa/verify')[0], { code: '123456' });
  });

  it('a wrong code shows the API message, stays open and can be retried', async () => {
    mockApi({ 'POST /api/auth/mfa/verify': fail(401, 'invalid_mfa_code', 'That code is not valid.') });
    const onDone = vi.fn();
    const { user } = renderWithProviders(<MfaStep api={client()} mode="verify" onDone={onDone} onCancel={() => {}} />);
    await user.type(screen.getByLabelText('Authentication code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled();
  });

  it('the code field is numeric, 6 long and required; cancel calls onCancel', async () => {
    mockApi({});
    const onCancel = vi.fn();
    const { user } = renderWithProviders(<MfaStep api={client()} mode="verify" onDone={() => {}} onCancel={onCancel} />);
    const input = screen.getByLabelText('Authentication code');
    expect(input).toHaveAttribute('maxlength', '6');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('MfaStep enroll mode (INO-017 building block)', () => {
  it('starts enrolment, shows the key grouped in fours and an authenticator link; Verify is disabled until the key arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi({
      'POST /api/auth/mfa/enroll': async () => {
        await gate;
        return raw(ENROL);
      },
    });
    renderWithProviders(<MfaStep api={client()} mode="enroll" onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/Preparing a new key/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    release();
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute('href', ENROL.otpauthUri);
    expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled();
  });

  it('enrolment failure shows an error (not a spinner forever)', async () => {
    mockApi({ 'POST /api/auth/mfa/enroll': fail(500, 'server_error', 'Could not create a key.') });
    renderWithProviders(<MfaStep api={client()} mode="enroll" onDone={() => {}} onCancel={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create a key.');
    expect(screen.queryByText(/Preparing a new key/)).toBeNull();
  });

  it('confirming the first code posts it and finishes', async () => {
    const api = mockApi({ 'POST /api/auth/mfa/enroll': raw(ENROL), 'POST /api/auth/mfa/verify': raw({ user: { id: 'u' } }) });
    const onDone = vi.fn();
    const { user } = renderWithProviders(<MfaStep api={client()} mode="enroll" onDone={onDone} onCancel={() => {}} />);
    await screen.findByText('JBSW Y3DP EHPK 3PXP');
    await user.type(screen.getByLabelText('Authentication code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expectBody(expectCalled(api, 'POST /api/auth/mfa/verify')[0], { code: '654321' });
  });
});

describe('AcceptInviteForm', () => {
  const TOKEN = 'i'.repeat(40);

  it('missing token: explains and links to sign in; no API call', async () => {
    stubLocation('');
    const api = mockApi({});
    renderWithProviders(<AcceptInviteForm portal="company" apiUrl={API} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/invitation link is incomplete/i);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(api.requests).toHaveLength(0);
  });

  it('invalid/expired invitation shows the API message', async () => {
    stubLocation(`?token=${TOKEN}`);
    mockApi({ 'GET /api/auth/invitations/:t': fail(404, 'invitation_not_found', 'This invitation has expired.') });
    renderWithProviders(<AcceptInviteForm portal="company" apiUrl={API} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation has expired.');
  });

  it('new account: previews, prefills the name, requires matching passwords, then accepts and goes home', async () => {
    const loc = stubLocation(`?token=${TOKEN}`);
    const api = mockApi({
      'GET /api/auth/invitations/:t': raw({ email: 'new@pc.test', name: 'New Person', portal: 'company', existingAccount: false, expiresAt: '2026-12-01T00:00:00Z' }),
      'POST /api/auth/invitations/accept': raw({ user: { id: 'u' } }),
    });
    const { user } = renderWithProviders(<AcceptInviteForm portal="company" apiUrl={API} />);
    expect(await screen.findByText('new@pc.test')).toBeInTheDocument();
    expect(api.calls('GET /api/auth/invitations/:t')[0].path).toBe(`/api/auth/invitations/${TOKEN}`);
    expect(screen.getByLabelText('Full name')).toHaveValue('New Person');
    await user.type(screen.getByLabelText('Password'), 'Brand-new-pass-1');
    await user.type(screen.getByLabelText('Confirm password'), 'nope-nope-nope-1');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The two passwords do not match.');
    expectNotCalled(api, 'POST /api/auth/invitations/accept');
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Confirm password'), 'Brand-new-pass-1');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/'));
    expectBody(expectCalled(api, 'POST /api/auth/invitations/accept')[0], { token: TOKEN, password: 'Brand-new-pass-1', name: 'New Person' });
  });

  it('existing account: asks for the current password only (no confirm, no name)', async () => {
    stubLocation(`?token=${TOKEN}`);
    const api = mockApi({
      'GET /api/auth/invitations/:t': raw({ email: 'old@pc.test', name: null, portal: 'company', existingAccount: true, expiresAt: '2026-12-01T00:00:00Z' }),
      'POST /api/auth/invitations/accept': fail(401, 'invalid_credentials', 'Incorrect password'),
    });
    const { user } = renderWithProviders(<AcceptInviteForm portal="company" apiUrl={API} />);
    await screen.findByText('old@pc.test');
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm password')).toBeNull();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    await user.type(screen.getByLabelText('Current password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password');
    expectBody(expectCalled(api, 'POST /api/auth/invitations/accept')[0], { token: TOKEN, password: 'whatever' });
  });
});
