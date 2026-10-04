import { describe, it, expect } from 'vitest';
import { Shell, Alert, fmtSize } from '@/components/ui';
import { renderWithProviders, screen } from '../_helpers';

describe('onboarding-web smoke: setup', () => {
  it('Shell renders the brand header and pill; Alert error is role=alert', () => {
    renderWithProviders(
      <Shell pill="Step 2">
        <Alert kind="error">Upload failed</Alert>
      </Shell>,
    );
    expect(screen.getByText('Step 2')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed');
    expect(screen.getByRole('link', { name: /matanho/ })).toHaveAttribute('href', '/');
  });

  it('fmtSize', () => {
    expect(fmtSize(2048)).toBe('2 KB');
    expect(fmtSize(null)).toBe('');
  });
});
