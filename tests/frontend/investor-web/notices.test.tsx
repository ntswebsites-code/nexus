import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpNoticesScreen } from '@/components/lp-portal/screens/lp-notices-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, within, expectCalled, expectIdempotencyKey, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, list, FUND_PE } from './_lp';
import { emitRealtime } from './_rt';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

const notice = (over: Record<string, unknown> = {}) => ({
  id: 'n-1', title: 'Q2 valuation update', status: 'PUBLISHED', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', shareClass: null,
  publishedAt: '2026-07-01T09:00:00Z', acknowledgedAt: null, category: 'VALUATION', requiresAcknowledgement: true,
  preview: 'NAV has been updated.', body: 'Full body of the valuation notice.', openedAt: null, ...over,
});
const NOTICES = [
  notice(),
  notice({ id: 'n-2', title: 'AGM invitation', category: 'AGM', requiresAcknowledgement: false, status: 'OPENED', openedAt: '2026-07-02T00:00:00Z', fundName: 'All funds', fundId: '', body: 'Join us.' }),
  notice({ id: 'n-3', title: 'Policy change', category: 'POLICY', acknowledgedAt: '2026-06-01T00:00:00Z', fundName: 'Growth Fund I' }),
];

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/notices/:id`]: (_r: unknown, p: Record<string, string>) => ok(NOTICES.find((n) => n.id === p.id) ?? NOTICES[0]),
    [`GET ${API}/notices`]: ok(list(NOTICES)),
    ...over,
  } as never;
}
beforeEach(() => vi.clearAllMocks());
const ready = () => screen.findByText('AGM invitation');

describe('Notices', () => {
  it('lists notices with kind, fund name, status; first notice detail is loaded by id', async () => {
    const api = liveApi(routes());
    renderLp(<LpNoticesScreen />);
    await ready();
    expect(api.calls(`GET ${API}/notices`)[0].query.get('pageSize')).toBe('50');
    await waitFor(() => expectCalled(api, `GET ${API}/notices/n-1`));
    expect(screen.getAllByText('Valuation Update').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AGM Notice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unread').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Opened').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Acknowledged').length).toBeGreaterThan(0);
    expect(screen.queryByText(new RegExp(FUND_PE.fundId))).not.toBeInTheDocument();
    expect(await screen.findByText('Full body of the valuation notice.')).toBeInTheDocument();
    expectNoUnmocked();
  });

  it('selecting another notice loads and SHOWS its detail (stale detail used to bounce the selection back to the first notice)', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpNoticesScreen />);
    await user.click((await ready()).closest('button')!);
    await waitFor(() => expectCalled(api, `GET ${API}/notices/n-2`));
    expect(await screen.findByText('Join us.')).toBeInTheDocument();
    // a notice that needs no acknowledgement has no Acknowledge button
    expect(screen.queryByRole('button', { name: 'Acknowledge Notice' })).not.toBeInTheDocument();
  });

  it('acknowledge: idempotent POST, success toast, list and detail refetched, button disappears', async () => {
    let acked = false;
    const api = liveApi(
      routes({
        [`POST ${API}/notices/n-1/acknowledge`]: () => {
          acked = true;
          return ok({ acknowledgedAt: '2026-07-03T00:00:00Z' });
        },
        [`GET ${API}/notices/:id`]: (_r: unknown, p: Record<string, string>) => {
          const n = NOTICES.find((x) => x.id === p.id)!;
          return ok(acked && n.id === 'n-1' ? { ...n, acknowledgedAt: '2026-07-03T00:00:00Z' } : n);
        },
      }),
    );
    const { user } = renderLp(<LpNoticesScreen />);
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge Notice' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Notice acknowledged.'));
    expectIdempotencyKey(expectCalled(api, `POST ${API}/notices/n-1/acknowledge`)[0]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Acknowledge Notice' })).not.toBeInTheDocument());
    expect(api.calls(`GET ${API}/notices`).length).toBeGreaterThanOrEqual(2);
  });

  it('acknowledge failure shows the API message and keeps the button', async () => {
    liveApi(routes({ [`POST ${API}/notices/n-1/acknowledge`]: fail(409, 'LP_CONFLICT', 'Notice withdrawn') }));
    const { user } = renderLp(<LpNoticesScreen />);
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge Notice' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Notice withdrawn'));
    expect(screen.getByRole('button', { name: 'Acknowledge Notice' })).toBeEnabled();
  });

  it('acknowledge double-click sends a single request while in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = liveApi(routes({ [`POST ${API}/notices/n-1/acknowledge`]: async () => { await gate; return ok({ acknowledgedAt: 'x' }); } }));
    const { user } = renderLp(<LpNoticesScreen />);
    await ready();
    const btn = await screen.findByRole('button', { name: 'Acknowledge Notice' });
    await user.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await user.click(btn);
    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.calls(`POST ${API}/notices/n-1/acknowledge`)).toHaveLength(1);
  });

  it('search filters by title and shows the empty message when nothing matches', async () => {
    liveApi(routes());
    const { user } = renderLp(<LpNoticesScreen />);
    await ready();
    await user.click(screen.getByPlaceholderText('Search notices...'));
    await user.paste('policy');
    expect(screen.queryByText('AGM invitation')).not.toBeInTheDocument();
    expect(screen.getAllByText('Policy change').length).toBeGreaterThan(0);
    await user.clear(screen.getByPlaceholderText('Search notices...'));
    await user.paste('zzz-nothing');
    expect(await screen.findByText('No notices match your filters.')).toBeInTheDocument();
  });

  it('?id= deep link opens that notice', async () => {
    const api = liveApi(routes());
    renderLp(<LpNoticesScreen initialNoticeId="n-3" />);
    await waitFor(() => expectCalled(api, `GET ${API}/notices/n-3`));
  });

  it('realtime lp_notice_updated refetches the list', async () => {
    const api = liveApi(routes());
    renderLp(<LpNoticesScreen />);
    await ready();
    api.on(`GET ${API}/notices`, ok(list([notice({ id: 'n-9', title: 'Brand new notice' }), ...NOTICES])));
    emitRealtime('lp_notice_updated');
    expect(await screen.findByText('Brand new notice')).toBeInTheDocument();
  });

  it('error state shows the API message; empty list renders without crashing', async () => {
    liveApi(routes({ [`GET ${API}/notices`]: fail(500, 'internal', 'Notices unavailable') }));
    renderLp(<LpNoticesScreen />);
    expect(await screen.findByText(/Notices unavailable/)).toBeInTheDocument();
  });

  it('empty notices: no crash, message shown', async () => {
    liveApi(routes({ [`GET ${API}/notices`]: ok(list([])) }));
    renderLp(<LpNoticesScreen />);
    expect(await screen.findByText('No notices match your filters.')).toBeInTheDocument();
    expect(within(document.body).queryByText(/NaN|undefined/)).not.toBeInTheDocument();
  });
});
