import { describe, it, expect, beforeEach } from 'vitest';
import { waitFor, screen, router, setRoute, expectCalled, expectNotCalled, expectIdempotencyKey, expectBody } from '../_helpers';
import { healthyRoutes, P, ok, fail, raw, profile, dashboard } from './_fixtures';
import { InvesteePortal } from '@/components/InvesteePortal';
import { mountPortal, installBrowserStubs, stubLocation, seeText, setValue } from './_portal';

beforeEach(() => {
  installBrowserStubs();
});

describe('Investee portal shell: live data, chrome, no demo fallback', () => {
  it('INO-016/INO-005: renders the live company everywhere; no sample company ("Zambezi Pay") and no Demo ribbon', async () => {
    const m = await mountPortal();
    const root = m.q('.investee-portal-v8-root');
    expect(root.textContent).not.toMatch(/Zambezi/i);
    expect(m.q('.company-card .company-copy strong').textContent).toBe('Kuda Logistics');
    expect(m.q('.company-card .company-copy span').textContent).toBe('Matanho Growth Partners I');
    expect(m.q('.company-card .company-avatar').textContent).toBe('KL');
    expect(m.q('.topbar .profile-copy strong').textContent).toContain('Tariro Moyo');
    expect(m.q('.topbar .profile-copy span').textContent).toBe('CFO');
    expect(m.q('.topbar .profile-avatar').textContent).toBe('TM');
    expect(m.q('.system-health').textContent).toContain('Connected to Matanho');
    expect(screen.queryByTestId('demo-ribbon')).toBeNull();
    expect(root.dataset.livePages).toContain('reports');
  });

  it('INO-005: the demo period selector is hidden in live mode', async () => {
    const m = await mountPortal();
    expect(m.q<HTMLElement>('#periodSelect').style.display).toBe('none');
  });

  it('INO-005: footer health shows "Service unavailable" when the health probe fails', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/health`]: fail(503, 'unavailable', 'down') }));
    await waitFor(() => expect(m.q('.system-health').textContent).toContain('Service unavailable'));
  });

  it('Overview greets the signed-in user by first name and shows live figures', async () => {
    const m = await mountPortal();
    expect(m.workspace()).toMatch(/Good (morning|afternoon|evening), Tariro/);
    expect(m.workspace()).toContain('Live portfolio status for Kuda Logistics.');
    expect(m.workspace()).toContain('$2.5M');
    expect(m.workspace()).toContain('Invested');
  });

  it('only allowlisted pages are live: others keep the fixture behind the visible "Demo data" ribbon', async () => {
    const m = await mountPortal(healthyRoutes({}, ['dashboard']));
    expect(m.q('.investee-portal-v8-root').dataset.livePages).toBe('dashboard');
    await m.goto('cap-table');
    expect(await screen.findByTestId('demo-ribbon')).toHaveTextContent('Demo data');
    await m.goto('dashboard');
    await waitFor(() => expect(screen.queryByTestId('demo-ribbon')).toBeNull());
  });

  it('an allowlist without a key never calls that endpoint (adapter refuses before the network)', async () => {
    const m = await mountPortal(healthyRoutes({}, ['dashboard', 'profile']));
    expectCalled(m.api, `GET ${P}/dashboard`);
    expectNotCalled(m.api, `GET ${P}/cap-table`);
    expectNotCalled(m.api, `GET ${P}/team`);
  });

  it('sidebar entries navigate with router.push to the right route', async () => {
    const m = await mountPortal();
    await m.goto('reports');
    expect(router.push).toHaveBeenCalledWith('/reports');
    await m.goto('cap-table');
    expect(router.push).toHaveBeenCalledWith('/cap-table');
    await m.goto('settings');
    expect(router.push).toHaveBeenCalledWith('/settings');
  });

  it('opening a deep link (/governance) renders that page; a route change re-renders the right page', async () => {
    const m = await mountPortal(healthyRoutes(), { path: '/governance' });
    expect(m.workspace()).toMatch(/Governance/);
    setRoute('/kpis');
    m.rerender(<InvesteePortal />);
    await m.settle();
    expect(m.workspace()).toMatch(/KPI Centre/);
  });

  it('a page whose loader fails shows the page-level error with the loader name (not a blank page)', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/dashboard`]: fail(500, 'internal_error', 'Database unavailable') }));
    await m.settle();
    expect(m.workspace()).toMatch(/Database unavailable/);
  });

  it('INO-005/INO-006 profile drawer: shows live identity, access profile and two-factor state', async () => {
    const m = await mountPortal();
    await m.act('profile');
    const d = m.drawer().textContent!;
    expect(d).toContain('Your profile');
    expect(d).toContain('tariro@kuda.test');
    expect(d).toContain('Kuda Logistics');
    expect(d).toContain('report contributor');
    expect(d).toContain('Not set up');
    expect(m.drawer().querySelector('[data-action="setup-mfa"]')).not.toBeNull();
  });
});

describe('INO-016: failed or slow flags call never falls back to the sample company', () => {
  it('a transient failure is retried and the portal then loads live', async () => {
    let n = 0;
    const m = await mountPortal(
      healthyRoutes({
        'GET /api/v1/platform/flags': () => {
          n += 1;
          return n === 1 ? fail(502, 'bad_gateway', 'upstream') : raw({ lp: {}, investee: { liveActions: ['all'] } });
        },
      }),
    );
    expect(n).toBe(2);
    expect(m.q('.company-card .company-copy strong').textContent).toBe('Kuda Logistics');
    expect(screen.queryByText('The portal could not load your data')).toBeNull();
  }, 20000);

  it('after 3 failed attempts: error panel with Retry, no shell, no sample data; Retry loads again', async () => {
    let n = 0;
    const routes = healthyRoutes({
      'GET /api/v1/platform/flags': () => {
        n += 1;
        return n <= 3 ? fail(500, 'internal_error', 'boom') : raw({ lp: {}, investee: { liveActions: ['all'] } });
      },
    });
    const { renderWithProviders, mockApi } = await import('../_helpers');
    const { InvesteePortal } = await import('@/components/InvesteePortal');
    mockApi(routes);
    const { user, container } = renderWithProviders(<InvesteePortal />);
    const panel = await screen.findByText('The portal could not load your data', {}, { timeout: 9000 });
    expect(panel).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Zambezi/i);
    expect((container.querySelector('.investee-portal-v8-root') as HTMLElement).style.display).toBe('none');
    expect(n).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container.querySelector('.company-card .company-copy strong')?.textContent).toBe('Kuda Logistics'), { timeout: 5000 });
    expect(screen.queryByText('The portal could not load your data')).toBeNull();
  }, 30000);
});

describe('INO-001: account with no company access', () => {
  const noCompany = () => {
    const denied = () => fail(403, 'no_company_access', 'This account is not linked to a portfolio company.');
    return {
      'GET /api/v1/platform/flags': raw({ lp: {}, investee: { liveActions: ['all'] } }),
      'GET /api/auth/me': raw({ user: { id: 'u', email: 'cust@x.test', name: 'Cust', roles: [], permissions: [], createdAt: '' } }),
      'POST /api/auth/logout': raw({ ok: true }),
      'GET /api/v1/notifications': raw({ items: [] }),
      [`GET ${P}/*`]: denied,
    };
  };

  it('replaces the shell with a "not linked to a portfolio company" panel (no sidebar, no failing-call noise)', async () => {
    const { renderWithProviders, mockApi } = await import('../_helpers');
    const { InvesteePortal } = await import('@/components/InvesteePortal');
    const api = mockApi(noCompany());
    const { container } = renderWithProviders(<InvesteePortal />);
    expect(await screen.findByText('This account is not linked to a portfolio company', {}, { timeout: 8000 })).toBeInTheDocument();
    expect((container.querySelector('.investee-portal-v8-root') as HTMLElement).style.display).toBe('none');
    expect(screen.queryByText('Workspace tools')).toBeNull();
    expect(screen.queryByTestId('demo-ribbon')).toBeNull();
    // the bell does not call notifications for an account with no company
    expectNotCalled(api, 'GET /api/v1/notifications');
  });

  it('Sign out on the panel ends the session and returns to /login', async () => {
    const { assign } = stubLocation();
    const { renderWithProviders, mockApi } = await import('../_helpers');
    const { InvesteePortal } = await import('@/components/InvesteePortal');
    const api = mockApi(noCompany());
    const { user } = renderWithProviders(<InvesteePortal />);
    await user.click(await screen.findByRole('button', { name: 'Sign out' }, { timeout: 8000 }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    expectCalled(api, 'POST /api/auth/logout');
  });
});

describe('INO-006: company switcher', () => {
  it('the company card lists every workspace, marks the current one; choosing another sends ?company= on every call', async () => {
    const m = await mountPortal();
    expect(m.api.calls(`GET ${P}/profile`)[0].query.get('company')).toBeNull();
    await m.act('company-menu');
    const d = m.drawer().textContent!;
    expect(d).toContain('Company workspace');
    expect(d).toContain('Zeta Foods');
    expect(d).toContain('PC-100');
    expect(d).toContain('Kuda Logistics');
    expect(d).toContain('Current');
    expect(m.drawer().querySelectorAll('[data-action="switch-company"]')).toHaveLength(1); // only the non-current one is clickable

    m.api.on(`GET ${P}/profile`, ok(profile({ company: { id: 'PC-100', name: 'Zeta Foods', fundName: 'Matanho Growth Partners I' }, companies: [{ id: 'PC-100', name: 'Zeta Foods', accessProfile: 'read_only', current: true }, { id: 'PC-101', name: 'Kuda Logistics', accessProfile: 'report_contributor', current: false }] })));
    const before = m.api.requests.length;
    await m.act('switch-company', m.drawer());
    await waitFor(() => expect(window.sessionStorage.getItem('matanho.investee.company')).toBe('PC-100'));
    await seeText(m, 'Workspace switched');
    const after = m.api.requests.slice(before).filter((r) => r.path.startsWith(P) && r.method === 'GET' && !r.path.endsWith('/health'));
    expect(after.length).toBeGreaterThan(5);
    for (const r of after) expect(r.query.get('company'), `${r.path} must carry ?company=`).toBe('PC-100');
    await waitFor(() => expect(m.q('.company-card .company-copy strong').textContent).toBe('Zeta Foods'));
  });

  it('a single-workspace user sees the current workspace only', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/profile`]: ok(profile({ companies: [{ id: 'PC-101', name: 'Kuda Logistics', accessProfile: 'report_contributor', current: true }] })) }));
    await m.act('company-menu');
    expect(m.drawer().textContent).toContain('The company you are signed in to');
    expect(m.drawer().querySelectorAll('[data-action="switch-company"]')).toHaveLength(0);
  });
});

describe('INO-027: notification bell', () => {
  it('lists the caller\'s own notifications from /api/v1/notifications with New badges and links', async () => {
    const m = await mountPortal(
      healthyRoutes({
        'GET /api/v1/notifications': raw({ items: [{ id: 'n1', title: 'Report returned', body: 'Please fix the balance sheet', link: '/reports', createdAt: '2026-09-02T10:00:00.000Z', readAt: null }, { id: 'n2', title: 'Welcome', body: null, link: null, createdAt: '2026-09-01T10:00:00.000Z', readAt: '2026-09-01T11:00:00.000Z' }] }),
      }),
    );
    expect(m.api.calls('GET /api/v1/notifications')[0].query.get('pageSize')).toBe('20');
    await m.act('notifications');
    const d = m.drawer().textContent!;
    expect(d).toContain('Report returned');
    expect(d).toContain('Please fix the balance sheet');
    expect(d).toContain('2026-09-02');
    expect(d.match(/New/g)).toHaveLength(1); // only the unread one
    expect(m.drawer().querySelector('[data-action="navigate"][data-page="reports"]')).not.toBeNull();
  });

  it('empty state when the user has none (not demo alerts)', async () => {
    const m = await mountPortal();
    await m.act('notifications');
    expect(m.drawer().textContent).toContain('No notifications');
    expect(m.drawer().textContent).not.toMatch(/POS terminal|Procurement-request drill-down/);
  });
});

describe('INO-017: in-portal two-factor enrolment', () => {
  const enrolRoutes = () =>
    healthyRoutes({
      'POST /api/auth/mfa/enroll': raw({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' }),
      'POST /api/auth/mfa/verify': raw({ user: { id: 'u' } }),
    });

  it('Settings > "Set up two-factor" opens the enrolment dialog, confirms a code, refreshes status and says so', async () => {
    const m = await mountPortal(enrolRoutes());
    await m.goto('settings');
    expect(m.workspace()).toContain('Set up two-factor');
    await m.act('setup-mfa', m.q('#workspace'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Set up two-factor authentication');
    expect(await screen.findByTestId('mfa-setup-key')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expectCalled(m.api, 'POST /api/auth/mfa/enroll');

    m.api.on(`GET ${P}/profile`, ok(profile({ mfaEnabled: true })));
    m.api.on(`GET ${P}/settings`, ok({ notifications: [], security: { mfaEnabled: true, mfaRequired: true, sessionTimeoutMinutes: 30 }, accessProfile: 'report_contributor', capabilities: {} }));
    const profileCallsBefore = m.api.calls(`GET ${P}/profile`).length;
    await m.user.type(screen.getByLabelText('Authentication code'), '123456');
    await m.user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expectBody(expectCalled(m.api, 'POST /api/auth/mfa/verify')[0], { code: '123456' });
    await seeText(m, 'Two-factor sign-in is on');
    expect(m.api.calls(`GET ${P}/profile`).length).toBeGreaterThan(profileCallsBefore);
  });

  it('Cancel closes the dialog without verifying or reloading', async () => {
    const m = await mountPortal(enrolRoutes());
    await m.goto('settings');
    await m.act('setup-mfa', m.q('#workspace'));
    await screen.findByRole('dialog');
    await m.user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expectNotCalled(m.api, 'POST /api/auth/mfa/verify');
  });
});

describe('INO-017/INO-005: the settings Security card is live', () => {
  it('shows the live two-factor status from /settings', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/settings`]: ok({ notifications: [], security: { mfaEnabled: true, mfaRequired: true, sessionTimeoutMinutes: 45 }, accessProfile: 'workspace_administrator', capabilities: {} }) }));
    await m.goto('settings');
    expect(m.workspace()).toMatch(/45/);
  });
});

void [setValue, expectIdempotencyKey, dashboard];
