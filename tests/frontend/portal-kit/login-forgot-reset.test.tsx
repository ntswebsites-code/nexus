import { describe, it, expect } from 'vitest';
import { LoginForm, ResetPasswordForm } from '@matanho/portal-kit';
import { safeNext, errorMessage } from '../../../packages/portal-kit/src/AuthCard';
import { ApiError } from '@matanho/shared';
import {
  mockApi, ok, raw, fail, loginAs, expectCalled, expectNotCalled, expectBody, renderWithProviders, screen, waitFor,
} from '../_helpers';
import { stubLocation } from './_loc';

const API = 'http://localhost:4100';

describe('safeNext / errorMessage helpers', () => {
  it.each([
    ['/reports', '/reports'],
    ['/a?b=1', '/a?b=1'],
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
    ['/\\evil.com', '/'],
    ['', '/'],
    [null, '/'],
  ])('safeNext(%j) -> %j (no open redirect)', (v, out) => expect(safeNext(v as string | null)).toBe(out));

  it('errorMessage shows API messages and a friendly fallback otherwise', () => {
    expect(errorMessage(new ApiError(401, { code: 'invalid_credentials', message: 'Incorrect email or password' }))).toBe('Incorrect email or password');
    expect(errorMessage(new Error('boom'))).toMatch(/Unable to reach the sign-in service/);
  });

  it('ADA-010: field-level reasons are appended to the message', () => {
    const e = new ApiError(400, { code: 'validation_error', message: 'Validation failed', fieldErrors: { password: 'Password must be at least 10 characters' } });
    expect(errorMessage(e)).toBe('Validation failed. Password must be at least 10 characters');
  });
});

describe('LoginForm sign-in', () => {
  it('signs in with email+password, sends the portal when access is enforced, then goes to a safe ?next', async () => {
    const { assign } = stubLocation('?next=%2Fcap-table');
    const api = mockApi({ ...loginAs(null), 'POST /api/auth/login': raw({ user: { id: 'u1' } }) });
    const { user } = renderWithProviders(<LoginForm portal="admin" apiUrl={API} />);
    await user.type(await screen.findByLabelText('Email'), 'ada@pc.test');
    await user.type(screen.getByLabelText('Password'), 'S3cret-pass!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cap-table'));
    const [req] = expectCalled(api, 'POST /api/auth/login');
    expectBody(req, { email: 'ada@pc.test', password: 'S3cret-pass!', portal: 'admin' });
  });

  it('company portal (role-less) does not send a portal restriction', async () => {
    const { assign } = stubLocation('');
    const api = mockApi({ ...loginAs(null), 'POST /api/auth/login': raw({ user: { id: 'u1' } }) });
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect((api.calls('POST /api/auth/login')[0].body as Record<string, unknown>).portal).toBeUndefined();
  });

  it('an evil ?next is ignored (no open redirect)', async () => {
    const { assign } = stubLocation('?next=%2F%2Fevil.com');
    mockApi({ ...loginAs(null), 'POST /api/auth/login': raw({ user: { id: 'u1' } }) });
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });

  it('wrong credentials: shows the API message in an alert, stays on the form, re-enables the button', async () => {
    const { assign } = stubLocation('');
    mockApi({ ...loginAs(null), 'POST /api/auth/login': fail(401, 'invalid_credentials', 'Incorrect email or password') });
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('API down: shows the friendly fallback, not a stack or blank', async () => {
    stubLocation('');
    mockApi({ ...loginAs(null) }); // login unmocked => rejects
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to reach the sign-in service/);
  });

  it('empty submit is blocked by the form (required fields), no request', async () => {
    stubLocation('');
    const api = mockApi({ ...loginAs(null) });
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expectNotCalled(api, 'POST /api/auth/login');
    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Password')).toBeRequired();
  });

  it('shows "Checking session..." first, then the form', async () => {
    stubLocation('');
    mockApi({ ...loginAs(null) });
    renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    expect(screen.getByText(/Checking session/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });
});

describe('LoginForm existing session', () => {
  it('signed in with access: Continue link (to ?next) and Sign out', async () => {
    stubLocation('?next=%2Fkpis');
    const api = mockApi({ ...loginAs('company', { user: { email: 'ada@pc.test' } }), 'POST /api/auth/logout': ok({ ok: true }), 'GET /api/auth/me': raw({ user: { id: 'u', email: 'ada@pc.test', name: 'Ada', roles: [], permissions: [], createdAt: '' } }) });
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} turnAwayPortals={['investor', 'custodian']} />);
    expect(await screen.findByText('ada@pc.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/kpis');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expectCalled(api, 'POST /api/auth/logout');
    expect(await screen.findByLabelText('Email')).toBeInTheDocument(); // back to the sign-in form
  });

  it('INO-001: an investor/custodian account sees "no access" with a switch-account button, not Continue', async () => {
    stubLocation('');
    mockApi({
      'GET /api/auth/me': raw({ user: { id: 'u', email: 'cust@x.test', name: 'C', roles: [{ portal: 'custodian', key: 'approver', label: 'Approver' }], permissions: [], createdAt: '' } }),
      'POST /api/auth/logout': ok({ ok: true }),
    });
    renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} turnAwayPortals={['investor', 'custodian']} />);
    expect(await screen.findByText(/does not have access to the Investee Portal/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with a different account' })).toBeInTheDocument();
  });

  it('enforced portals: a role on another portal means no access', async () => {
    stubLocation('');
    mockApi({ 'GET /api/auth/me': raw({ user: { id: 'u', email: 'inv@x.test', name: 'I', roles: [{ portal: 'investor', key: 'lp', label: 'LP' }], permissions: [], createdAt: '' } }) });
    renderWithProviders(<LoginForm portal="admin" apiUrl={API} />);
    expect(await screen.findByText(/does not have access to the Nexus Admin Workspace/)).toBeInTheDocument();
  });
});

describe('LoginForm MFA step', () => {
  async function toMfa(mfa: 'verify' | 'enroll') {
    const loc = stubLocation('?next=%2Fsettings');
    const api = mockApi({
      ...loginAs(null),
      'POST /api/auth/login': raw({ user: { id: 'u' }, mfa }),
      'POST /api/auth/mfa/enroll': raw({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }),
      'POST /api/auth/mfa/verify': raw({ user: { id: 'u' } }),
      'POST /api/auth/logout': ok({ ok: true }),
    });
    const r = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await r.user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await r.user.type(screen.getByLabelText('Password'), 'pw');
    await r.user.click(screen.getByRole('button', { name: 'Sign in' }));
    return { ...r, api, loc };
  }

  it('login answering mfa=verify opens the two-factor check, then redirects after a valid code', async () => {
    const { user, api, loc } = await toMfa('verify');
    expect(await screen.findByRole('heading', { name: 'Two-factor check' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/settings'));
    expectBody(expectCalled(api, 'POST /api/auth/mfa/verify')[0], { code: '123456' });
  });

  it('login answering mfa=enroll starts enrolment and shows the key', async () => {
    const { api } = await toMfa('enroll');
    expect(await screen.findByRole('heading', { name: 'Set up two-factor' })).toBeInTheDocument();
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expectCalled(api, 'POST /api/auth/mfa/enroll');
  });

  it('"Use a different account" signs out and returns to the password form', async () => {
    const { user, api } = await toMfa('verify');
    await user.click(await screen.findByRole('button', { name: 'Use a different account' }));
    await waitFor(() => expectCalled(api, 'POST /api/auth/logout'));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });
});

describe('INO-026: forgot password in the login form', () => {
  it('"Forgot password?" opens the email step; submit POSTs /password/forgot with email and portal and confirms generically', async () => {
    stubLocation('');
    const api = mockApi({ ...loginAs(null), 'POST /api/auth/password/forgot': raw({ ok: true }) });
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset password' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'ada@pc.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If that email belongs to an active account, a reset link is on its way/)).toBeInTheDocument();
    expectBody(expectCalled(api, 'POST /api/auth/password/forgot')[0], { email: 'ada@pc.test', portal: 'company' });
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });

  it('/login?forgot=1 (linked from the reset page) opens the request step directly', async () => {
    stubLocation('?forgot=1');
    mockApi({ ...loginAs(null) });
    renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    expect(await screen.findByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('forgot step shows even while another account is signed in', async () => {
    stubLocation('?forgot=1');
    mockApi({ ...loginAs('company') });
    renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    expect(await screen.findByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('a failed request (rate limit) shows the message and keeps the form', async () => {
    stubLocation('?forgot=1');
    mockApi({ ...loginAs(null), 'POST /api/auth/password/forgot': fail(429, 'rate_limited', 'Too many requests. Try again later.') });
    const { user } = renderWithProviders(<LoginForm portal="company" apiUrl={API} enforcePortalAccess={false} />);
    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });
});

describe('INO-026: ResetPasswordForm (/reset-password?token=...)', () => {
  const TOKEN = 'a'.repeat(40);

  it('missing token: "incomplete link" with Request a new reset link (/login?forgot=1) and Back to sign in', async () => {
    stubLocation('');
    mockApi({});
    renderWithProviders(<ResetPasswordForm portal="company" apiUrl={API} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/reset link is incomplete/i);
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/login?forgot=1');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('happy path: sends token and password once, then shows success and a Sign in link', async () => {
    stubLocation(`?token=${TOKEN}`, '/reset-password');
    const api = mockApi({ 'POST /api/auth/password/reset': raw({ ok: true }) });
    const { user } = renderWithProviders(<ResetPasswordForm portal="company" apiUrl={API} />);
    const pw = await screen.findByLabelText('New password');
    expect(pw).toHaveAttribute('minlength', '10');
    await user.type(pw, 'Brand-new-pass-1');
    await user.type(screen.getByLabelText('Confirm password'), 'Brand-new-pass-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/Your password has been changed/)).toBeInTheDocument();
    expectBody(expectCalled(api, 'POST /api/auth/password/reset')[0], { token: TOKEN, password: 'Brand-new-pass-1' });
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('mismatched passwords: shows an error and sends nothing', async () => {
    stubLocation(`?token=${TOKEN}`);
    const api = mockApi({});
    const { user } = renderWithProviders(<ResetPasswordForm portal="company" apiUrl={API} />);
    await user.type(await screen.findByLabelText('New password'), 'Brand-new-pass-1');
    await user.type(screen.getByLabelText('Confirm password'), 'Different-pass-22');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The two passwords do not match.');
    expectNotCalled(api, 'POST /api/auth/password/reset');
  });

  it('expired/used token: API message is shown with both recovery links, form stays usable', async () => {
    stubLocation(`?token=${TOKEN}`);
    mockApi({ 'POST /api/auth/password/reset': fail(400, 'invalid_token', 'This reset link is invalid or has expired.') });
    const { user } = renderWithProviders(<ResetPasswordForm portal="company" apiUrl={API} />);
    await user.type(await screen.findByLabelText('New password'), 'Brand-new-pass-1');
    await user.type(screen.getByLabelText('Confirm password'), 'Brand-new-pass-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/login?forgot=1');
    expect(screen.getByRole('button', { name: 'Set password' })).toBeEnabled();
  });

  it('ADA-010: weak password rejected by the API shows the field reason, not just "Validation failed"', async () => {
    stubLocation(`?token=${TOKEN}`);
    mockApi({
      'POST /api/auth/password/reset': {
        status: 400,
        body: { error: { code: 'validation_error', message: 'Validation failed', fieldErrors: { password: 'Password must be at least 10 characters' } } },
      },
    });
    const { user } = renderWithProviders(<ResetPasswordForm portal="company" apiUrl={API} />);
    await user.type(await screen.findByLabelText('New password'), 'short1');
    await user.type(screen.getByLabelText('Confirm password'), 'short1');
    // bypass native minlength (jsdom does not block submit on it for user-event clicks in all cases)
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Password must be at least 10 characters');
  });
});
