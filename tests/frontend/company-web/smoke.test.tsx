import { describe, it, expect } from 'vitest';
import { DemoRibbon } from '@/components/DemoRibbon';
import { renderWithProviders, screen } from '../_helpers';

describe('company-web smoke: setup', () => {
  it('DemoRibbon marks fixture data and shows the note', () => {
    renderWithProviders(<DemoRibbon note="Q3 pack" />);
    const ribbon = screen.getByTestId('demo-ribbon');
    expect(ribbon).toHaveAttribute('role', 'status');
    expect(ribbon).toHaveTextContent('Demo data');
    expect(ribbon).toHaveTextContent('Q3 pack');
  });
});
