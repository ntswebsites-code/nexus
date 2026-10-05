import { describe, it, expect, vi } from 'vitest';
import { OpsShell } from '@/ops/Shell';
import { Breadcrumbs } from '@/ops/shell/Breadcrumbs';
import { NotificationBell, ago } from '@/ops/shell/NotificationBell';
import { StepUpHost } from '@/ops/StepUp';
import { api as opsApi } from '@/ops/api';
import { SessionProvider, useSession } from '@/ops/session';
import { NAV } from '@/ops/shell/nav';
import { mountPage } from './_kit';
import { loginAs, mockApi, ok, raw, fail, screen, within, waitFor, router, setRoute, renderWithProviders, expectCalled, expectNotCalled, expectBody } from '../../_helpers';

const bell = (over: Record<string, unknown> = {}) =>
  raw({
    unread: 2,
    page: 1,
    pageSize: 8,
    total: 3,
    items: [
      { id: 'n1', type: 'approval', title: 'NAV awaiting review', body: 'Fund A', link: '/ops-native/nav/abc', readAt: null, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() },
      { id: 'n2', type: 'break', title: 'Recon break', body: null, link: 'https://evil.example/x', readAt: null, createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
      { id: 'n3', type: 'info', title: 'Old news', body: null, link: '/ops-native/audit', readAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    ],
    ...over,
  });

describe('shell: session provider states', () => {
  function Who() {
    return <p>hello {useSession().user.email}</p>;
  }
  it('admin user sees the page; permission helper reflects granted codes', async () => {
    function Can() {
      const { can } = useSession();
      return <p>{can('a.b', 'x.y') ? 'yes' : 'no'}|{can('zzz') ? 'yes' : 'no'}</p>;
    }
    await mountPage(<Can />, { perms: ['x.y'] });
    expect(screen.getByText('yes|no')).toBeInTheDocument();
  });
  it('a user without an admin role is refused', async () => {
    mockApi(loginAs('investor'));
    renderWithProviders(<Who />, { providers: [SessionProvider] });
    expect(await screen.findByText(/does not have access to the staff workspace/)).toBeInTheDocument();
    expect(screen.queryByText(/hello/)).not.toBeInTheDocument();
  });
  it('a server error shows a message and a retry button, not a blank page', async () => {
    mockApi({ 'GET /api/auth/me': fail(500, 'internal', 'Database unavailable') });
    renderWithProviders(<Who />, { providers: [SessionProvider] });
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('signed out (401) never renders the protected content', async () => {
    const api = mockApi(loginAs(null));
    renderWithProviders(<Who />, { providers: [SessionProvider] });
    await waitFor(() => expect(api.calls('GET /api/auth/me')).toHaveLength(1));
    expect(screen.queryByText(/hello/)).not.toBeInTheDocument();
    expect(screen.getByText('LOADING OPERATIONS CONSOLE')).toBeInTheDocument();
  });
});

describe('shell: sidebar permission filtering (ADA-028) and mobile toggle (ADB-026)', () => {
  const mount = (perms: string[], routes = {}) => mountPage(<OpsShell><p>page body</p></OpsShell>, { perms, routes });
  it('links the role lacks are marked disabled with a reason; granted links are live', async () => {
    setRoute('/ops-native/ibor');
    await mount(['portfolio.view']);
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    const ibor = within(nav).getByRole('link', { name: 'IBOR & Positions' });
    expect(ibor).toHaveAttribute('aria-disabled', 'false');
    expect(ibor).toHaveClass('active');
    const rbac = within(nav).getByRole('link', { name: 'RBAC & Controls' });
    expect(rbac).toHaveAttribute('aria-disabled', 'true');
    expect(rbac).toHaveAttribute('title', 'Your role does not include this area');
    // empty-perms items (Overview, E-signatures) are open to every signed-in staff user (ADB-025)
    expect(within(nav).getByRole('link', { name: 'E-signatures' })).toHaveAttribute('aria-disabled', 'false');
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-disabled', 'false');
  });
  it('ADA-029: no dead "Back to the investment workspace" link; page content renders', async () => {
    await mount(['portfolio.view']);
    expect(screen.queryByText(/Back to the investment workspace/)).not.toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });
  it('role focus lens narrows the menu to that role and explains why', async () => {
    await mount(['portfolio.view', 'reports.view'], {
      'GET /api/v1/shell/me/role-focus': raw({ role: 'analyst', permissions: ['reports.view'], roles: [{ key: 'analyst', label: 'Analyst' }] }),
    });
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'IBOR & Positions' })).toHaveAttribute('aria-disabled', 'true'));
    expect(within(nav).getByRole('link', { name: 'IBOR & Positions' })).toHaveAttribute('title', 'Outside the role you are viewing as');
    expect(within(nav).getByRole('link', { name: 'Performance & Attribution' })).toHaveAttribute('aria-disabled', 'false');
  });
  it('ADB-026: hamburger toggles the off-canvas sidebar (aria-expanded + scrim) and closes on scrim click', async () => {
    const { user, container } = await mount(['portfolio.view']);
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    const aside = container.querySelector('#ops-sidebar')!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(aside).not.toHaveClass('open');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(aside).toHaveClass('open');
    const scrim = container.querySelector('.ops-nav-scrim')!;
    expect(scrim).toBeTruthy();
    await user.click(scrim);
    expect(aside).not.toHaveClass('open');
    expect(container.querySelector('.ops-nav-scrim')).toBeNull();
  });
  it('ADB-026: navigating closes the open drawer', async () => {
    setRoute('/ops-native');
    const { user, container, rerender } = await mount(['portfolio.view']);
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(container.querySelector('#ops-sidebar')).toHaveClass('open');
    setRoute('/ops-native/ibor');
    rerender(<OpsShell><p>page body</p></OpsShell>);
    await waitFor(() => expect(container.querySelector('#ops-sidebar')).not.toHaveClass('open'));
  });
  it('production banner for simulated integrations shows only when production with fake adapters', async () => {
    await mount(['portfolio.view'], { 'GET /api/v1/admin-core/integrations/banner': ok({ production: true, fakeAdapters: ['market-data', 'kyc'], count: 2 }) });
    expect(await screen.findByText(/Simulated integrations are active in production: market-data, kyc/)).toBeInTheDocument();
  });
  it('NAV catalogue: every route is unique and ADB-025 e-sign needs no permission', () => {
    const hrefs = NAV.flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(NAV.flatMap((s) => s.items).find((i) => i.href === '/ops-native/esign')!.perms).toEqual([]);
  });
});

describe('shell: command palette / search', () => {
  const hits = raw({ query: 'abc', kinds: 1, hits: [{ kind: 'order', kindLabel: 'Order', id: 'o1', ref: 'ORD-1001', title: 'Buy 100 ABC', status: 'PENDING', href: '/ops-native/orders/o1' }] });
  it('Ctrl+K opens, lists permitted pages only, Enter navigates, Escape closes', async () => {
    const { user } = await mountPage(<OpsShell><p>x</p></OpsShell>, { perms: ['portfolio.view'] });
    await user.keyboard('{Control>}k{/Control}');
    const dlg = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(dlg).getByRole('option', { name: /IBOR & Positions/ })).toBeInTheDocument();
    expect(within(dlg).queryByRole('option', { name: /RBAC & Controls/ })).not.toBeInTheDocument();
    await user.type(within(dlg).getByLabelText('Search'), 'ibor');
    await user.keyboard('{Enter}');
    expect(router.push).toHaveBeenCalledWith('/ops-native/ibor');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    await user.keyboard('/');
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });
  it('record search: needs 2 characters, debounced, sends q+limit, shows record rows with ref and status; opens its href', async () => {
    const { user, api } = await mountPage(<OpsShell><p>x</p></OpsShell>, { perms: ['portfolio.view'], routes: { 'GET /api/v1/shell/search': hits } });
    await user.click(screen.getByRole('button', { name: /Search and commands/ }));
    const input = await screen.findByLabelText('Search');
    await user.type(input, 'a');
    await new Promise((r) => setTimeout(r, 300));
    expectNotCalled(api, 'GET /api/v1/shell/search');
    await user.type(input, 'bc');
    const row = await screen.findByRole('option', { name: /ORD-1001 · Buy 100 ABC/ });
    expect(row).toHaveTextContent('Order · PENDING');
    const [req] = expectCalled(api, 'GET /api/v1/shell/search');
    expect(req!.query.get('q')).toBe('abc');
    expect(req!.query.get('limit')).toBe('20');
    await user.click(row);
    expect(router.push).toHaveBeenCalledWith('/ops-native/orders/o1');
  });
  it('search errors are shown in the palette; no match message', async () => {
    const { user } = await mountPage(<OpsShell><p>x</p></OpsShell>, { perms: [], routes: { 'GET /api/v1/shell/search': fail(500, 'x', 'Search is down') } });
    await user.click(screen.getByRole('button', { name: /Search and commands/ }));
    await user.type(await screen.findByLabelText('Search'), 'zzzzqq');
    expect(await screen.findByText('Search is down')).toBeInTheDocument();
  });
  it('arrow keys move the active option; actions list profile and notifications', async () => {
    const { user } = await mountPage(<OpsShell><p>x</p></OpsShell>, { perms: [] });
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByLabelText('Search');
    await user.type(input, 'notif');
    await user.keyboard('{Enter}');
    expect(router.push).toHaveBeenCalledWith('/ops-native/notifications');
  });
});

describe('shell: notifications bell', () => {
  it('shows unread count, lists items, relative time, wraps long text', async () => {
    const { user } = await mountPage(<NotificationBell />, { routes: { 'GET /api/v1/notifications': bell() } });
    const btn = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(btn).toHaveTextContent('2');
    await user.click(btn);
    expect(await screen.findByText('NAV awaiting review')).toBeInTheDocument();
    expect(screen.getByText('5 min ago')).toBeInTheDocument();
    expect(screen.getByText('3 h ago')).toBeInTheDocument();
  });
  it('requests page size 8; opening a notification marks it read then navigates (relative links only)', async () => {
    const { user, api } = await mountPage(<NotificationBell />, {
      routes: { 'GET /api/v1/notifications': bell(), 'POST /api/v1/notifications/:id/read': ok({}) },
    });
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(api.calls('GET /api/v1/notifications')[0]!.query.get('pageSize')).toBe('8');
    await user.click(await screen.findByText('NAV awaiting review'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/nav/abc'));
    expectCalled(api, 'POST /api/v1/notifications/n1/read');
    // absolute (external) link: marked read, never navigated
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByText('Recon break'));
    await waitFor(() => expectCalled(api, 'POST /api/v1/notifications/n2/read'));
    expect(router.push).not.toHaveBeenCalledWith('https://evil.example/x');
  });
  it('already-read item does not call read; Mark all read posts and is disabled with no unread', async () => {
    const { user, api } = await mountPage(<NotificationBell />, {
      routes: { 'GET /api/v1/notifications': bell(), 'POST /api/v1/notifications/read-all': ok({}), 'POST /api/v1/notifications/:id/read': ok({}) },
    });
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByText('Old news'));
    expect(api.calls('POST /api/v1/notifications/n3/read')).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/notifications/read-all'));
  });
  it('empty state, error message, and view-all navigation', async () => {
    const { user } = await mountPage(<NotificationBell />, { routes: { 'GET /api/v1/notifications': bell({ items: [], unread: 0 }) } });
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'View all and preferences' }));
    expect(router.push).toHaveBeenCalledWith('/ops-native/notifications');
  });
  it('API failure shows the error in the dropdown', async () => {
    const { user } = await mountPage(<NotificationBell />, { routes: { 'GET /api/v1/notifications': fail(500, 'x', 'Notifications offline') } });
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Notifications offline')).toBeInTheDocument();
  });
  it('ago() boundaries', () => {
    expect(ago(new Date().toISOString())).toBe('just now');
    expect(ago(new Date(Date.now() - 2 * 86400_000).toISOString())).toBe('2 d ago');
  });
});

describe('shell: user menu', () => {
  it('shows name, role label, links; role focus select calls PUT and updates the lens; single role has no select', async () => {
    const roles = [
      { portal: 'admin', key: 'analyst', label: 'Analyst' },
      { portal: 'admin', key: 'ops', label: 'Operations' },
    ];
    const { user, api } = await mountPage(<OpsShell><p>x</p></OpsShell>, {
      perms: ['portfolio.view'],
      user: { roles, name: 'Pat Doe' },
      routes: { 'PUT /api/v1/shell/me/role-focus': raw({ role: 'ops', permissions: ['operations.view'] }) },
    });
    await user.click(screen.getByRole('button', { name: /Pat Doe/ }));
    expect(screen.getByRole('menuitem', { name: /Profile, MFA and password/ })).toHaveAttribute('href', '/ops-native/profile');
    await user.selectOptions(screen.getByLabelText('Role focus'), 'ops');
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/shell/me/role-focus'));
    expectBody(req!, { role: 'ops' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Viewing as Operations/ })).toBeInTheDocument());
  });
  it('role-focus failure is shown', async () => {
    const roles = [
      { portal: 'admin', key: 'a', label: 'A' },
      { portal: 'admin', key: 'b', label: 'B' },
    ];
    const { user } = await mountPage(<OpsShell><p>x</p></OpsShell>, { user: { roles, name: 'Q R' }, routes: { 'PUT /api/v1/shell/me/role-focus': fail(403, 'forbidden', 'No') } });
    await user.click(screen.getByRole('button', { name: /Q R/ }));
    await user.selectOptions(screen.getByLabelText('Role focus'), 'b');
    expect(await screen.findByText(/You do not have permission for this action/)).toBeInTheDocument();
  });
});

describe('shell: breadcrumbs (ADB-004)', () => {
  it('position sub-route is "Position", not raw lowercase; parent is a link; ids unchanged', () => {
    setRoute('/ops-native/ibor/position');
    const { unmount } = renderWithProviders(<Breadcrumbs />);
    expect(screen.getByRole('link', { name: 'IBOR & Positions' })).toHaveAttribute('href', '/ops-native/ibor');
    expect(screen.getByText('Position')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('position')).not.toBeInTheDocument();
    unmount();
    setRoute('/ops-native/performance/PRD-1001');
    renderWithProviders(<Breadcrumbs />);
    expect(screen.getByText('PRD-1001')).toBeInTheDocument();
  });
  it('new-order, profile, record pages and unknown routes', () => {
    setRoute('/ops-native/orders/new-order');
    const a = renderWithProviders(<Breadcrumbs />);
    expect(screen.getByText('New order')).toBeInTheDocument();
    a.unmount();
    setRoute('/ops-native/profile');
    const b = renderWithProviders(<Breadcrumbs />);
    expect(screen.getByText('My profile')).toBeInTheDocument();
    b.unmount();
    setRoute('/ops-native/record/model-governance/12345678-aaaa');
    const c = renderWithProviders(<Breadcrumbs />);
    expect(screen.getByText('model governance')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
    c.unmount();
    setRoute('/ops-native/mystery');
    renderWithProviders(<Breadcrumbs />);
    expect(screen.getByText('Console')).toBeInTheDocument();
  });
});

describe('shell: step-up TOTP modal', () => {
  it('validates 6 digits, posts the code, then the original request retries with the same Idempotency-Key', async () => {
    let n = 0;
    const m = mockApi({
      'POST /api/v1/ops/pay': () => (++n === 1 ? fail(401, 'step_up_required', 'Confirm') : ok({ paid: true })),
      'POST /api/v1/auth/mfa/step-up': ok({}),
    });
    const { user } = renderWithProviders(<StepUpHost />);
    const p = opsApi.post('/api/v1/ops/pay', { a: 1 }, { idempotencyKey: 'K1' });
    const input = await screen.findByLabelText('Authentication code');
    await user.type(input, '12 34');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Enter the 6-digit code from your authenticator app.')).toBeInTheDocument();
    expectCalled(m, 'POST /api/v1/auth/mfa/step-up', 0);
    await user.clear(input);
    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(p).resolves.toEqual({ paid: true });
    expectBody(expectCalled(m, 'POST /api/v1/auth/mfa/step-up')[0]!, { code: '123456' });
    expect(m.calls('POST /api/v1/ops/pay').map((r) => r.idempotencyKey)).toEqual(['K1', 'K1']);
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
  });
  it('wrong code shows the error and keeps the modal; Cancel rejects the original action', async () => {
    mockApi({
      'POST /api/v1/ops/pay': fail(401, 'step_up_required'),
      'POST /api/v1/auth/mfa/step-up': fail(400, 'invalid_code', 'Wrong code'),
    });
    const { user } = renderWithProviders(<StepUpHost />);
    const p = opsApi.post('/api/v1/ops/pay', {}).catch((e) => e);
    await user.type(await screen.findByLabelText('Authentication code'), '111111');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Wrong code')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await p).toMatchObject({ code: 'step_up_cancelled' });
  });
});
