import { describe, it, expect, beforeEach } from 'vitest';
import { DemoDataRibbon } from '@/components/lp-portal/demo-data-ribbon';
import { reloadLpFlags } from '@/lib/lp-portal/flags';
import { raw, screen, waitFor, renderWithProviders } from '../_helpers';
import { ALL_LIVE_FLAGS } from './_lp';
import { mockApi } from '../_helpers';

beforeEach(async () => {
  await reloadLpFlags();
});

describe('LP platform flags and demo ribbon', () => {
  it('hides the demo ribbon when every listed domain is live (LP_LIVE_DOMAINS=all path)', async () => {
    mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS) });
    await reloadLpFlags();
    renderWithProviders(<DemoDataRibbon domains={['capital', 'dashboard', 'session']} />);
    await waitFor(() => expect(screen.queryByTestId('demo-data-ribbon')).not.toBeInTheDocument());
  });

  it('shows the demo ribbon naming domains that are not live', async () => {
    mockApi({
      'GET /api/v1/platform/flags': raw({
        lp: { ...ALL_LIVE_FLAGS.lp, capital: false, dashboard: true },
      }),
    });
    await reloadLpFlags();
    renderWithProviders(<DemoDataRibbon domains={['capital', 'dashboard']} />);
    const ribbon = await screen.findByTestId('demo-data-ribbon');
    expect(ribbon).toHaveAttribute('data-domains', 'capital');
    expect(ribbon).toHaveTextContent('Capital calls & distributions');
  });
});
