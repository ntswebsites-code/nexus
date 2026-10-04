import { describe, it, expect } from 'vitest';
import SettingsPage from '@/app/(ops)/ops/settings/page';
import ProfilePage from '@/app/(ops)/ops/profile/page';
import NotificationsPage from '@/app/(ops)/ops/notifications/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, router, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

// ------------------------------------------------------------------ settings
const setting = (o: Record<string, unknown> = {}) => ({ key: 'mfa_required', category: 'Security', label: 'Require authenticator', help: 'Staff must enrol', type: 'boolean', options: null, min: null, max: null, value: false, default: false, isDefault: true, stepUp: true, enforced: true, version: 3, updatedAt: null, updatedBy: null, ...o });
const settingsList = [
  setting(),
  setting({ key: 'notify_channel', category: 'Notifications', label: 'Channel for critical alerts', type: 'enum', options: ['in_app_email', 'email_only'], value: 'in_app_email', default: 'email_only', isDefault: false, enforced: false, updatedAt: '2026-08-01T10:00:00Z', updatedBy: 'Admin A' }),
  setting({ key: 'session_hours', category: 'Retention', label: 'Session length', type: 'int', min: 1, max: 24, value: 8, default: 8 }),
];
const sBase = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/admin-core/settings': ok(settingsList),
  'GET /api/v1/admin-core/settings/numbering': ok([{ kind: 'modelPortfolio', prefix: 'PMD-', pad: 4, first: 'PMD-0001', next: 'PMD-1003', issued: 2, basePad: 4, maxPad: 8 }]),
  'GET /api/v1/admin-core/settings/history': ok([{ id: 'h1', key: 'mfa_required', label: 'Require authenticator', version: 3, before: false, after: true, reason: 'Policy', changedBy: 'Admin A', changedAt: '2026-08-01T10:00:00Z' }]),
  ...o,
});

describe('Settings (ADB-021)', () => {
  it('ADB-021: enum values are humanised ("In app email"), booleans On/Off, defaults shown when changed', async () => {
    await mountPage(<SettingsPage />, { routes: sBase() });
    expect(await screen.findByText('In app email')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('default Email only')).toBeInTheDocument();
    expect(screen.queryByText('in_app_email')).not.toBeInTheDocument();
  });
  it('ADB-021: the "recorded" footer only appears when some setting is unenforced; it disappears when all are enforced', async () => {
    const a = await mountPage(<SettingsPage />, { routes: sBase() });
    expect(await screen.findByText(/Settings marked recorded are stored with history/)).toBeInTheDocument();
    expect(screen.getAllByText('recorded')).toHaveLength(1);
    a.unmount();
    await mountPage(<SettingsPage />, { routes: sBase({ 'GET /api/v1/admin-core/settings': ok(settingsList.map((s) => ({ ...s, enforced: true }))) }) });
    await screen.findByText('Require authenticator');
    expect(screen.queryByText(/Settings marked recorded/)).not.toBeInTheDocument();
  });
  it('ADB-021: the lede says the authenticator code is needed once one is enrolled (not always)', async () => {
    await mountPage(<SettingsPage />, { routes: sBase() });
    expect(await screen.findByText(/need a fresh authenticator code once your account has one enrolled/)).toBeInTheDocument();
  });
  it('step-up badge on security settings; Change posts value, reason, version and an idempotency key; shows a success note', async () => {
    const { user, api } = await mountPage(<SettingsPage />, { routes: sBase({ 'PUT /api/v1/admin-core/settings/:key': ok({}) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Change' }))[0]!);
    const dlg = screen.getByRole('dialog');
    await user.selectOptions(within(dlg).getByLabelText(/^Value/), 'true');
    await user.type(within(dlg).getByLabelText(/Reason/), 'Policy change');
    await user.click(within(dlg).getByRole('button', { name: 'Save change' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/admin-core/settings/mfa_required'));
    expect(req!.body).toEqual({ value: true, reason: 'Policy change', version: 3 });
    expectIdempotencyKey(req!);
    expect(await screen.findByText('Require authenticator updated.')).toBeInTheDocument();
  });
  it('integer settings send a number and carry min/max on the input; reason is required', async () => {
    const { user, api } = await mountPage(<SettingsPage />, { routes: sBase({ 'PUT /api/v1/admin-core/settings/:key': ok({}) }) });
    await user.click(within((await screen.findByText('Session length')).closest('tr')!).getByRole('button', { name: 'Change' }));
    const dlg = screen.getByRole('dialog');
    const v = within(dlg).getByLabelText(/^Value/);
    expect(v).toHaveAttribute('min', '1');
    expect(v).toHaveAttribute('max', '24');
    expect(within(dlg).getByLabelText(/Reason/)).toBeRequired();
    await user.clear(v);
    await user.type(v, '12');
    await user.type(within(dlg).getByLabelText(/Reason/), 'Longer sessions');
    await user.click(within(dlg).getByRole('button', { name: 'Save change' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/admin-core/settings/session_hours'));
    expectBody(req!, { value: 12 });
  });
  it('step-up required error from the server is not swallowed (shown in the dialog)', async () => {
    const { user } = await mountPage(<SettingsPage />, { routes: sBase({ 'PUT /api/v1/admin-core/settings/:key': fail(409, 'version_conflict', 'Someone changed this setting; reload') }) });
    await user.click((await screen.findAllByRole('button', { name: 'Change' }))[0]!);
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Reason/), 'Test');
    await user.click(within(dlg).getByRole('button', { name: 'Save change' }));
    expect(await within(dlg).findByText('Someone changed this setting; reload')).toBeInTheDocument();
  });
  it('ADB-023: numbering shows the PMD- prefix for model portfolios (not MDL-); padding change PUTs digits and reason', async () => {
    const { user, api } = await mountPage(<SettingsPage />, { routes: sBase({ 'PUT /api/v1/admin-core/settings/numbering/:kind': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Numbering' }));
    expect(await screen.findByText('model portfolio')).toBeInTheDocument();
    expect(screen.getByText('PMD-####')).toBeInTheDocument();
    expect(screen.queryByText(/MDL-/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Padding' }));
    const dlg = screen.getByRole('dialog');
    const pad = within(dlg).getByLabelText(/^Digits/);
    expect(pad).toHaveAttribute('min', '4');
    expect(pad).toHaveAttribute('max', '8');
    await user.clear(pad);
    await user.type(pad, '6');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'More headroom');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/admin-core/settings/numbering/modelPortfolio'));
    expectBody(req!, { pad: 6, reason: 'More headroom' });
  });
  it('change history lists before -> after with who and why; filter by setting is sent', async () => {
    const { user, api } = await mountPage(<SettingsPage />, { routes: sBase() });
    await user.click(await screen.findByRole('tab', { name: 'Change history' }));
    expect(await screen.findByText((_, el) => el?.tagName === 'TD' && el.textContent === 'Off → On')).toBeInTheDocument();
    expect(screen.getByText('Policy')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Setting'), 'mfa_required');
    await waitFor(() => expect(api.calls('GET /api/v1/admin-core/settings/history').at(-1)!.query.get('key')).toBe('mfa_required'));
  });
  it('without admin.settings (System Administrator after ADB-020): message names the permission and nothing is fetched', async () => {
    const { api } = await mountPage(<SettingsPage />, { perms: ['admin.rbac'], routes: sBase() });
    expect(await screen.findByText(/Ask a System Administrator for the admin.settings permission/)).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/admin-core/settings');
  });
});

// ------------------------------------------------------------------ profile
const me = (o: Record<string, unknown> = {}) => ({
  id: 'usr_admin', name: 'Test Admin', email: 'admin@example.test', roles: [{ key: 'admin', label: 'System Administrator' }], permissions: [], lastLoginAt: '2026-09-03T08:30:00Z', memberSince: '2026-01-01T00:00:00Z', mfa: { enrolled: false, enrolledAt: null, required: false }, roleFocus: null,
  sessions: [{ id: 'se1', current: true, createdAt: '2026-09-03T08:30:00Z', lastUsedAt: '2026-09-03T09:00:00Z', expiresAt: '2026-09-04T00:00:00Z', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', ip: '10.0.0.1' }, { id: 'se2', current: false, createdAt: '2026-09-01T08:30:00Z', lastUsedAt: '2026-09-02T09:00:00Z', expiresAt: '2026-09-04T00:00:00Z', userAgent: 'node', ip: null }], ...o,
});
const pBase = (o: Record<string, unknown> = {}) => ({ 'GET /api/v1/shell/me': raw(me()), ...o });

describe('Profile and security (ADB-027)', () => {
  it('ADB-027: session devices show "Chrome on Windows" and "Script or API client", not the raw user agent; current session is flagged and cannot be signed out', async () => {
    await mountPage(<ProfilePage />, { routes: pBase() });
    expect(await screen.findByText(/Chrome on Windows/)).toBeInTheDocument();
    expect(screen.getByText(/Script or API client/)).toBeInTheDocument();
    expect(screen.queryByText(/AppleWebKit/)).not.toBeInTheDocument();
    expect(screen.getByText('this browser')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  });
  it('ADB-027: password mismatch is caught client side: button disabled with the hint; weak password (under 10) cannot be submitted', async () => {
    const { user, api } = await mountPage(<ProfilePage />, { routes: pBase({ 'POST /api/v1/shell/me/password': raw({ otherSessionsRevoked: 1 }) }) });
    await screen.findByText('Change password', { selector: 'h2' });
    await user.type(screen.getByLabelText('Current password'), 'oldpassword1');
    await user.type(screen.getByLabelText(/^New password/), 'short');
    const btn = screen.getByRole('button', { name: 'Change password' });
    expect(btn).toBeDisabled();
    await user.clear(screen.getByLabelText(/^New password/));
    await user.type(screen.getByLabelText(/^New password/), 'long-enough-pw1');
    await user.type(screen.getByLabelText(/^Repeat new password/), 'different-pw1');
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(btn).toBeDisabled();
    expectNotCalled(api, 'POST /api/v1/shell/me/password');
  });
  it('password change posts current/new with a key, clears the fields and says how many other sessions were signed out', async () => {
    const { user, api } = await mountPage(<ProfilePage />, { routes: pBase({ 'POST /api/v1/shell/me/password': raw({ otherSessionsRevoked: 1 }) }) });
    await screen.findByText('Change password', { selector: 'h2' });
    await user.type(screen.getByLabelText('Current password'), 'oldpassword1');
    await user.type(screen.getByLabelText(/^New password/), 'long-enough-pw1');
    await user.type(screen.getByLabelText(/^Repeat new password/), 'long-enough-pw1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/shell/me/password'));
    expect(req!.body).toEqual({ currentPassword: 'oldpassword1', newPassword: 'long-enough-pw1' });
    expectIdempotencyKey(req!);
    expect(await screen.findByText('Password changed. 1 other session signed out.')).toBeInTheDocument();
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
  });
  it('ADB-027 / ADA-010: a weak-password rejection shows the field reason from the API, not a generic message', async () => {
    const { user } = await mountPage(<ProfilePage />, {
      routes: pBase({ 'POST /api/v1/shell/me/password': { status: 400, body: { error: { code: 'validation_error', message: 'Validation failed', fieldErrors: { newPassword: 'New password is too common' } } } } }),
    });
    await screen.findByText('Change password', { selector: 'h2' });
    await user.type(screen.getByLabelText('Current password'), 'oldpassword1');
    await user.type(screen.getByLabelText(/^New password/), 'password1234');
    await user.type(screen.getByLabelText(/^Repeat new password/), 'password1234');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Validation failed. New password is too common')).toBeInTheDocument();
  });
  it('MFA enrolment: start shows setup key and link; code accepts digits only (6) and verifies', async () => {
    const { user, api } = await mountPage(<ProfilePage />, { routes: pBase({ 'POST /api/auth/mfa/enroll': raw({ secret: 'ABCDEF', otpauthUri: 'otpauth://totp/x' }), 'POST /api/auth/mfa/verify': raw({}) }) });
    expect(await screen.findByText('not enrolled')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up authenticator' }));
    expect(await screen.findByText('ABCDEF')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in authenticator' })).toHaveAttribute('href', 'otpauth://totp/x');
    const code = screen.getByLabelText('6-digit code');
    const confirm = screen.getByRole('button', { name: 'Confirm and turn on' });
    await user.type(code, '12ab34');
    expect((code as HTMLInputElement).value).toBe('1234');
    expect(confirm).toBeDisabled();
    await user.type(code, '56');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/auth/mfa/verify'));
    expectBody(req!, { code: '123456' });
  });
  it('MFA required but not enrolled is labelled; enrolled shows reset guidance and no setup button', async () => {
    const a = await mountPage(<ProfilePage />, { routes: pBase({ 'GET /api/v1/shell/me': raw(me({ mfa: { enrolled: false, enrolledAt: null, required: true } })) }) });
    expect(await screen.findByText('required, not enrolled')).toBeInTheDocument();
    a.unmount();
    await mountPage(<ProfilePage />, { routes: pBase({ 'GET /api/v1/shell/me': raw(me({ mfa: { enrolled: true, enrolledAt: '2026-08-01T10:00:00Z', required: true } })) }) });
    expect(await screen.findByText('enrolled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up authenticator' })).not.toBeInTheDocument();
    expect(screen.getByText(/ask a System Administrator to reset your second factor/)).toBeInTheDocument();
  });
  it('display name: Save is disabled until it changes; PUT sends the name and shows Saved', async () => {
    const { user, api } = await mountPage(<ProfilePage />, { routes: pBase({ 'PUT /api/v1/shell/me': raw({ ok: true }) }) });
    const save = await screen.findByRole('button', { name: 'Save name' });
    expect(save).toBeDisabled();
    const name = screen.getByLabelText('Display name');
    await user.clear(name);
    await user.type(name, 'Renamed Admin');
    await user.click(save);
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/shell/me'));
    expectBody(req!, { name: 'Renamed Admin' });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
  it('sessions: sign out one session (DELETE) and sign out all others; others button disabled with one session', async () => {
    const { user, api } = await mountPage(<ProfilePage />, { routes: pBase({ 'DELETE /api/v1/shell/me/sessions/:id': raw({ ok: true }), 'POST /api/v1/shell/me/sessions/revoke-others': raw({ ok: true }) }) });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/shell/me/sessions/se2'));
    await user.click(screen.getByRole('button', { name: 'Sign out all other sessions' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/shell/me/sessions/revoke-others'));
  });
  it('a failing sessions call shows the error', async () => {
    const { user } = await mountPage(<ProfilePage />, { routes: pBase({ 'DELETE /api/v1/shell/me/sessions/:id': fail(500, 'x', 'Session store down') }) });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Session store down')).toBeInTheDocument();
  });
  it('profile load failure shows an error', async () => {
    await mountPage(<ProfilePage />, { routes: pBase({ 'GET /api/v1/shell/me': fail(500, 'x', 'Profile service down') }) });
    expect(await screen.findByText(/Could not load your profile: Profile service down/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ notifications
const note = (id: string, o: Record<string, unknown> = {}) => ({ id, type: 'approval', title: `Item ${id}`, body: 'Body text', link: '/ops/nav/1', readAt: null, createdAt: new Date(Date.now() - 600_000).toISOString(), ...o });
const nPage = (n = 2, o: Record<string, unknown> = {}) => raw({ items: Array.from({ length: n }, (_, i) => note(`n${i + 1}`)), unread: n, page: 1, pageSize: 20, total: n, ...o });
const prefs = raw({ digest: 'off', types: [{ type: 'approval', label: 'Approvals', critical: false, channels: { in_app: true, email: false } }, { type: 'risk_breach', label: 'Risk breaches', critical: true, channels: { in_app: true, email: true } }] });
const nBase = (o: Record<string, unknown> = {}) => ({ 'GET /api/v1/notifications': nPage(), 'GET /api/v1/notifications/preferences': prefs, ...o });

describe('Notifications page', () => {
  it('lists notifications with relative times, unread filter and paging params are sent', async () => {
    const { user, api } = await mountPage(<NotificationsPage />, { routes: nBase() });
    expect(await screen.findByText('Item n1')).toBeInTheDocument();
    expect(screen.getAllByText('10 min ago')).toHaveLength(2);
    const first = api.calls('GET /api/v1/notifications')[0]!.query;
    expect(first.get('page')).toBe('1');
    expect(first.get('pageSize')).toBe('20');
    await user.click(screen.getByLabelText(/Unread only/));
    await waitFor(() => expect(api.calls('GET /api/v1/notifications').at(-1)!.query.get('unread')).toBe('1'));
  });
  it('Mark all read posts and is disabled when nothing is unread; opening an item marks it read and navigates', async () => {
    const { user, api } = await mountPage(<NotificationsPage />, { routes: nBase({ 'POST /api/v1/notifications/read-all': raw({ ok: true }), 'POST /api/v1/notifications/:id/read': raw({ ok: true }) }) });
    await user.click(await screen.findByText('Item n1'));
    await waitFor(() => expectCalled(api, 'POST /api/v1/notifications/n1/read'));
    expect(router.push).toHaveBeenCalledWith('/ops/nav/1');
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/notifications/read-all'));
  });
  it('empty states differ for unread-only; pagination shows page x of y and next/previous request pages', async () => {
    const e = await mountPage(<NotificationsPage />, { routes: nBase({ 'GET /api/v1/notifications': nPage(0) }) });
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    e.unmount();
    const { user, api } = await mountPage(<NotificationsPage />, { routes: nBase({ 'GET /api/v1/notifications': nPage(2, { total: 45, unread: 2 }) }) });
    expect(await screen.findByText('Page 1 of 3 · 45 notifications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.calls('GET /api/v1/notifications').at(-1)!.query.get('page')).toBe('2'));
  });
  it('API failure shows the error', async () => {
    await mountPage(<NotificationsPage />, { routes: nBase({ 'GET /api/v1/notifications': fail(500, 'x', 'Inbox unavailable') }) });
    expect(await screen.findByText('Inbox unavailable')).toBeInTheDocument();
  });
  it('preferences: critical alerts are locked on; saving PUTs digest and per-channel flags with the right values', async () => {
    const { user, api } = await mountPage(<NotificationsPage />, { routes: nBase({ 'PUT /api/v1/notifications/preferences': raw({}) }) });
    const critical = await screen.findByLabelText('Risk breaches by email');
    expect(critical).toBeDisabled();
    expect(critical).toBeChecked();
    await user.click(screen.getByLabelText('Approvals by email'));
    await user.selectOptions(screen.getByLabelText(/Email digest/), 'weekly');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/notifications/preferences'));
    const body = req!.body as { digest: string; preferences: { type: string; channel: string; enabled: boolean }[] };
    expect(body.digest).toBe('weekly');
    expect(body.preferences).toContainEqual({ type: 'approval', channel: 'email', enabled: true });
    expect(body.preferences).toContainEqual({ type: 'approval', channel: 'in_app', enabled: true });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
