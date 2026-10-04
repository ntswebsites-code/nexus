import { describe, it, expect } from 'vitest';
import { InfoHint } from '@/components/lp-portal/info-hint';
import { renderWithProviders, screen } from '../_helpers';

describe('investor-web smoke: setup', () => {
  it('InfoHint opens a Radix popover with its description on click', async () => {
    const { user } = renderWithProviders(<InfoHint label="NAV" description="Net asset value per unit." />);
    await user.click(screen.getByRole('button', { name: 'NAV info' }));
    expect(await screen.findByText('Net asset value per unit.')).toBeInTheDocument();
  });
});
