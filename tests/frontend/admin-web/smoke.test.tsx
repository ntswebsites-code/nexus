import { describe, it, expect } from 'vitest';
import { SessionProvider, useSession } from '@/ops/session';
import { FundFields, fundPayload } from '@/ops/FundForm';
import { loginAs, mockApi, renderWithProviders, screen, router } from '../_helpers';

function Who() {
  const { user } = useSession();
  return <p>signed in as {user.email}</p>;
}

describe('admin-web smoke: setup', () => {
  it('FundFields renders defaults and fundPayload reads the form', () => {
    const { container } = renderWithProviders(
      <form>
        <FundFields />
      </form>,
    );
    expect(screen.getByDisplayValue('USD')).toBeInTheDocument();
    const fd = new FormData(container.querySelector('form')!);
    expect(fundPayload(fd)).toMatchObject({ currency: 'USD', operatingModel: 'PRIVATE_CAPITAL', portalVisible: true });
  });

  it('SessionProvider loads /api/auth/me via mockApi', async () => {
    const api = mockApi(loginAs('admin'));
    renderWithProviders(<Who />, { providers: [SessionProvider] });
    expect(await screen.findByText('signed in as admin@example.test')).toBeInTheDocument();
    expect(api.calls('GET /api/auth/me')).toHaveLength(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
