import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { useSessionUser, signOut, userInitials } from '@matanho/portal-kit/session';
import { mockApi, ok, raw, loginAs, expectCalled, expectNoUnmocked, renderWithProviders, screen, waitFor } from '../_helpers';
import { stubLocation } from './_loc';

function Who() {
  const u = useSessionUser();
  return <p data-testid="who">{u ? `${u.name}|${u.email}` : 'none'}</p>;
}

describe('portal-kit session hook', () => {
  it('loads the signed-in user from GET /api/auth/me with credentials', async () => {
    const api = mockApi({ ...loginAs('company', { user: { name: 'Ada Moyo', email: 'ada@pc101.test' } }) });
    renderWithProviders(<Who />);
    expect(screen.getByTestId('who')).toHaveTextContent('none');
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('Ada Moyo|ada@pc101.test'));
    expectCalled(api, 'GET /api/auth/me');
    expect((api.fetch.mock.calls[0][1] as RequestInit).credentials).toBe('include');
  });

  it('stays null (no crash) when signed out (401)', async () => {
    const api = mockApi({ ...loginAs(null) });
    renderWithProviders(<Who />);
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(screen.getByTestId('who')).toHaveTextContent('none');
  });

  it('stays null when the API is unreachable', async () => {
    const api = mockApi({}); // unmocked => fetch rejects
    renderWithProviders(<Who />);
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(screen.getByTestId('who')).toHaveTextContent('none');
  });

  it('does not set state after unmount', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi({
      'GET /api/auth/me': async () => {
        await gate;
        return raw({ user: { id: 'u', email: 'a@b.c', name: 'A', roles: [], permissions: [], createdAt: '' } });
      },
    });
    const { unmount } = renderWithProviders(<Who />);
    unmount();
    await act(async () => release());
    expectNoUnmocked();
  });
});

describe('portal-kit signOut', () => {
  it('POSTs /api/auth/logout then returns to /login', async () => {
    const { assign } = stubLocation();
    const api = mockApi({ 'POST /api/auth/logout': ok({ ok: true }) });
    await signOut();
    expectCalled(api, 'POST /api/auth/logout');
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('still returns to /login when the logout call fails', async () => {
    const { assign } = stubLocation();
    mockApi({}); // logout request throws
    await signOut();
    expect(assign).toHaveBeenCalledWith('/login');
  });
});

describe('userInitials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['  Ada   Lovelace King ', 'AK'],
    ['ada', 'A'],
    ['', 'U'],
    ['   ', 'U'],
  ])('%j -> %s', (name, out) => expect(userInitials(name)).toBe(out));
});
