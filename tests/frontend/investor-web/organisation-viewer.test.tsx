import { describe, it, expect, vi } from 'vitest';
import { LpOrganisationScreen } from '@/components/lp-portal/screens/lp-organisation-screen';
import { ok, screen, within } from '../_helpers';
import { API, liveApi, renderLp, FUND_PE } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

describe('Organisation as a non-manager (LPC-010)', () => {
  it('LPC-010: a viewer receives only their own colleague row; only that person is listed and no other emails appear', async () => {
    const own = { membershipId: 'mem-9', userId: 'u-9', email: 'vic@alpha.test', name: 'Vic Viewer', lpRole: 'VIEWER', fundIds: [FUND_PE.fundId], isActive: true, status: 'ACTIVE', revokedAt: null, mfaEnabled: true, lastActiveAt: null };
    liveApi({
      [`GET ${API}/organisation`]: ok({ id: 'cli-a', legalName: 'Alpha Family Office', investorId: 'INV-0001', email: 'lp@alpha.test', country: 'US', phone: '', address: '', status: 'ACTIVE', lpRole: 'VIEWER', colleagues: [own] }),
      [`GET ${API}/bank-instructions/changes`]: ok({ items: [] }),
    } as never, { session: { lpRole: 'VIEWER' } });
    renderLp(<LpOrganisationScreen />);
    await screen.findAllByText('Vic Viewer');
    const dir = within(screen.getAllByText('Vic Viewer')[0].closest('table') as HTMLElement);
    expect(dir.getAllByRole('row')).toHaveLength(2); // header + own row
    expect(screen.queryByText('ann@alpha.test')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite User' })).toBeDisabled();
  });
});
