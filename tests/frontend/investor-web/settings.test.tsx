import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpSettingsScreen } from '@/components/lp-portal/screens/lp-settings-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, expectCalled, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

// Real shape of GET /settings (backend settings.routes.ts) and its accepted enums.
const BACKEND_AS_OF = ['LATEST', 'LATEST_FINAL', 'QUARTER_END'];
const BACKEND_CURRENCIES = ['USD', 'ZIG'];
const settings = (over: Record<string, unknown> = {}) => ({
  notifications: {
    emailCapitalCalls: true, emailDistributions: true, emailDocuments: false, emailMessages: true, emailNotices: true,
    inAppCapitalCalls: true, inAppDistributions: true, inAppDocuments: true, inAppMessages: true, inAppNotices: true, digest: 'weekly',
  },
  mfa: { requireMfaForLp: true, issuerName: 'Matanho Nexus', enabled: true, enabledAt: '2026-05-01T00:00:00Z', manageUrl: '/lp-portal/settings?tab=security', sessionsUrl: null, passwordUrl: '/reset-password' },
  presentationCurrency: 'USD',
  defaultAsOfPreference: 'LATEST',
  ...over,
});

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/settings`]: ok(settings()),
    [`PATCH ${API}/settings/notifications`]: ok({}),
    [`PATCH ${API}/settings/display`]: ok({}),
    ...over,
  } as never;
}
beforeEach(() => vi.clearAllMocks());
const ready = () => screen.findByText('Notification Preferences');

describe('Settings', () => {
  it('renders saved preferences from the real response shape', async () => {
    const api = liveApi(routes());
    renderLp(<LpSettingsScreen />);
    await ready();
    await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
    expect(screen.getByText('MFA required')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Documents published email' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Documents published in-app' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Capital calls & distributions email' })).toBeChecked();
    expectNoUnmocked();
    expectCalled(api, `GET ${API}/settings`);
  });

  it('toggling a pref and saving sends both PATCHes with the toggled value, toasts and refetches', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpSettingsScreen />);
    await ready();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Documents published email' })).not.toBeChecked());
    await user.click(screen.getByRole('switch', { name: 'Documents published email' }));
    await user.click(screen.getByRole('switch', { name: 'Capital calls & distributions in-app' }));
    await user.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings saved.'));
    const [n] = expectCalled(api, `PATCH ${API}/settings/notifications`);
    expect(n.body).toMatchObject({ emailDocuments: true, inAppCapitalCalls: false, inAppDistributions: false, emailCapitalCalls: true, digest: 'weekly' });
    expectCalled(api, `PATCH ${API}/settings/display`);
    await waitFor(() => expect(api.calls(`GET ${API}/settings`).length).toBeGreaterThanOrEqual(2));
  });

  it('API validation error on save shows an error toast and no success toast', async () => {
    liveApi(routes({ [`PATCH ${API}/settings/display`]: fail(422, 'VALIDATION_ERROR', 'Check the display settings', { defaultAsOfPreference: 'Use one of LATEST' }) }));
    const { user } = renderLp(<LpSettingsScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('load failure shows an error banner', async () => {
    liveApi(routes({ [`GET ${API}/settings`]: fail(500, 'INTERNAL', 'Could not load settings') }));
    renderLp(<LpSettingsScreen />);
    expect(await screen.findByText(/Could not load settings/)).toBeInTheDocument();
  });

  it('security buttons without a URL are disabled (sessions); those with a URL open it safely', async () => {
    liveApi(routes());
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = renderLp(<LpSettingsScreen />);
    await ready();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manage' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(open).toHaveBeenCalledWith('/reset-password', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it.each([['LATEST'], ['LATEST_FINAL'], ['QUARTER_END']])('SETTINGS-ASOF %s from the API is saved back unchanged and accepted by the backend', async (pref) => {
    const api = liveApi(routes({ [`GET ${API}/settings`]: ok(settings({ defaultAsOfPreference: pref })) }));
    const { user } = renderLp(<LpSettingsScreen />);
    await ready();
    await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [d] = expectCalled(api, `PATCH ${API}/settings/display`);
    const sent = (d.body as Record<string, string>).defaultAsOfPreference;
    expect(BACKEND_AS_OF).toContain(sent);
    expect(sent).toBe(pref);
  });

  it('SETTINGS-ENUMS every currency and as-of option the UI offers is a value the backend accepts', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpSettingsScreen />);
    await ready();
    await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
    await user.click(screen.getAllByRole('combobox')[1]);
    const cur = (await screen.findAllByRole('option')).map((o) => o.textContent);
    await user.keyboard('{Escape}');
    cur.forEach((c) => expect(BACKEND_CURRENCIES).toContain(c));

    await user.click(screen.getAllByRole('combobox')[2]);
    const count = (await screen.findAllByRole('option')).length;
    await user.keyboard('{Escape}');
    const seen: string[] = [];
    for (let i = 0; i < count; i++) {
      await user.click(screen.getAllByRole('combobox')[2]);
      await user.click((await screen.findAllByRole('option'))[i]);
      await user.click(screen.getByRole('button', { name: /Save Changes/ }));
      await waitFor(() => expect(api.calls(`PATCH ${API}/settings/display`)).toHaveLength(i + 1));
      seen.push((api.calls(`PATCH ${API}/settings/display`)[i].body as Record<string, string>).defaultAsOfPreference);
    }
    seen.forEach((v) => expect(BACKEND_AS_OF).toContain(v));
    expect(new Set(seen).size).toBe(count);
  });
});
