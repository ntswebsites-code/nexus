import { describe, it, expect, vi } from 'vitest';
import { LpPortalSidebar } from '@/components/layout/lp-portal-sidebar';
import { ok, screen, waitFor, setRoute } from '../_helpers';
import { API, liveApi, renderLp, sessionData, FUND_PE, FUND_OE } from './_lp';

vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

describe('LP sidebar', () => {
  it('LPC-025: "My Investments" is not rendered while the session (fund list) is still loading, then appears', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    liveApi({ [`GET ${API}/session`]: async () => { await gate; return ok(sessionData()); } } as never);
    setRoute('/lp-portal');
    renderLp(<LpPortalSidebar />);
    await screen.findByRole('link', { name: /Dashboard/ });
    expect(screen.queryByText('My Investments')).not.toBeInTheDocument();
    release();
    expect(await screen.findByText('My Investments')).toBeInTheDocument();
  });

  it('LPC-025: no sidebar link points at the non-existent /lp-portal/investments page; core links are present', async () => {
    liveApi();
    setRoute('/lp-portal');
    renderLp(<LpPortalSidebar />);
    await screen.findByText('My Investments');
    expect(document.querySelector('a[href*="/lp-portal/investments"]')).toBeNull();
    for (const [name, href] of [
      ['Performance', '/lp-portal/performance'],
      ['Account Activity', '/lp-portal/account-activity'],
      ['Signatures', '/lp-portal/signatures'],
      ['Notices', '/lp-portal/notices'],
      ['My Organisation', '/lp-portal/organisation'],
      ['Settings', '/lp-portal/settings'],
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href);
    }
  });

  it('unread counts from the session (strings from the API) show as badges', async () => {
    liveApi(undefined, { session: { unreadCounts: { requests: '3', messages: '0', notices: '7', notifications: '0' } } });
    setRoute('/lp-portal');
    renderLp(<LpPortalSidebar />);
    await waitFor(() => expect(screen.getByRole('link', { name: /Notices/ })).toHaveTextContent('7'));
    expect(screen.getByRole('link', { name: /Requests/ })).toHaveTextContent('3');
  });

  it('a mixed-model session offers both Private Capital and Open-Ended groups', async () => {
    liveApi({}, { session: { funds: [FUND_PE, FUND_OE] } });
    setRoute('/lp-portal');
    const { user } = renderLp(<LpPortalSidebar />);
    await user.click(await screen.findByText('My Investments'));
    expect(await screen.findByText('Private Capital')).toBeInTheDocument();
    expect(screen.getByText('Open-Ended')).toBeInTheDocument();
  });
});
