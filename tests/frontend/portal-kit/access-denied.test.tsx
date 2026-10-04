import { describe, it, expect } from 'vitest';
import { AccessDeniedPage } from '@matanho/portal-kit';
import { mockApi, ok, expectCalled, renderWithProviders, screen, waitFor } from '../_helpers';
import { stubLocation } from './_loc';

describe('AccessDeniedPage', () => {
  it('names the portal, shows the reason and offers a way to switch account', () => {
    renderWithProviders(<AccessDeniedPage portal="company" message="You are signed in with an investor account." />);
    expect(screen.getByText('INVESTEE PORTAL')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /can't open this portal/i })).toBeInTheDocument();
    expect(screen.getByText('You are signed in with an investor account.')).toBeInTheDocument();
    // foot={null}: the generic "one account works everywhere" hint must not contradict the denial
    expect(screen.queryByText(/One Matanho account works/)).toBeNull();
  });

  it('Sign out ends the session on the API and goes to /login', async () => {
    const { assign } = stubLocation('', '/access-denied');
    const api = mockApi({ 'POST /api/auth/logout': ok({ ok: true }) });
    const { user } = renderWithProviders(<AccessDeniedPage portal="company" message="x" />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    expectCalled(api, 'POST /api/auth/logout');
  });
});
