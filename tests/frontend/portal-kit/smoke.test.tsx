import { describe, it, expect } from 'vitest';
import { AccessDeniedPage } from '@matanho/portal-kit';
import { userInitials } from '@matanho/portal-kit/session';
import { renderWithProviders, screen } from '../_helpers';

describe('portal-kit smoke: setup', () => {
  it('AccessDeniedPage renders the portal card and message', () => {
    renderWithProviders(<AccessDeniedPage portal="admin" message="Not for you." />);
    expect(screen.getByRole('heading', { name: /can't open this portal/i })).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('userInitials', () => {
    expect(userInitials('Ada Lovelace King')).toBe('AK');
    expect(userInitials('')).toBe('U');
  });
});
