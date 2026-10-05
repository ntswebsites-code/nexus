import { describe, it, expect, vi } from 'vitest';
import FundsPage from '@/app/(ops)/ops/funds/page';
import CallsPage from '@/app/(ops)/ops/capital-calls/page';
import { api, apiRequest, describeError, OpsError } from '@/ops/api';
import { fail, loginAs, mockApi, raw, renderWithProviders, screen, waitFor } from '../../_helpers';
import { SessionProvider } from '@/ops/session';
import { D, mountPage, validationFail } from './_kit';

describe('ops API client (shared by every admin-a screen)', () => {
  it('unwraps { data } for api.get but apiRequest keeps the raw payload (the ADA-015 root cause)', async () => {
    mockApi({ 'GET /x': raw({ data: [1, 2], total: 2 }) });
    expect(await api.get('/x')).toEqual([1, 2]);
    expect(await apiRequest('GET', '/x')).toEqual({ data: [1, 2], total: 2 });
  });
  it('turns the real validation envelope into "Validation failed. <reason>" and keeps the field map', async () => {
    mockApi({ 'POST /x': validationFail({ amount: 'Amount must be above 0', 'lines.0.ledgerId': 'Ledger is required' }) });
    const e = await api.post('/x', {}).catch((x) => x as OpsError);
    expect(e).toBeInstanceOf(OpsError);
    expect(e.message).toBe('Validation failed. Amount must be above 0. Ledger is required');
    expect(e.status).toBe(400);
  });
  it('more than three field reasons are summarised', async () => {
    mockApi({ 'POST /x': validationFail({ a: 'A bad', b: 'B bad', c: 'C bad', d: 'D bad', e: 'E bad' }) });
    const e = await api.post('/x', {}).catch((x) => x as OpsError);
    expect(e.message).toContain('(and 2 more)');
  });
  it('network failure becomes a readable error, not a raw TypeError', async () => {
    mockApi({});
    const e = await api.get('/unmocked').catch((x) => x as OpsError);
    expect(e).toBeInstanceOf(OpsError);
    expect((e as OpsError).code).toBe('network_error');
    expect(describeError(e)).toMatch(/could not be reached/);
  });
  it('describeError wording for control failures', () => {
    expect(describeError(new OpsError(403, 'segregation_of_duties', 'You made it'))).toBe('A different approver is required. You made it');
    expect(describeError(new OpsError(403, 'forbidden', 'cash.approve'))).toBe('You do not have permission for this action. cash.approve');
    expect(describeError(new OpsError(409, 'conflict', 'Stale'))).toBe('Stale Reload the page to see the latest version.');
    expect(describeError(new OpsError(501, 'not_implemented', 'x'))).toMatch(/not available yet/);
    expect(describeError(new Error('plain'))).toBe('plain');
  });
  it('sends Idempotency-Key and JSON content-type only when asked', async () => {
    const m = mockApi({ 'POST /x': raw({}) });
    await api.post('/x', { a: 1 }, { idempotencyKey: 'k-1' });
    await api.post('/x', { a: 2 });
    expect(m.requests[0].idempotencyKey).toBe('k-1');
    expect(m.requests[0].headers['content-type']).toBe('application/json');
    expect(m.requests[1].idempotencyKey).toBeUndefined();
  });
});

describe('screen-level error states', () => {
  it('501 shows the "Not available yet" panel and never demo data', async () => {
    mountPage(<FundsPage />, { routes: { 'GET /api/v1/ops/funds': fail(501, 'not_implemented', 'nope') } });
    const s = (await screen.findByText('Not available yet')).closest('[role="status"]')!;
    expect(s).toHaveTextContent(/No demo data is displayed here/);
  });
  it('403 shows a permission message naming the thing', async () => {
    mountPage(<FundsPage />, { routes: { 'GET /api/v1/ops/funds': fail(403, 'forbidden', 'funds.view required') } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/You do not have permission to view funds. funds.view required/);
  });
  it('a network failure shows the connection message', async () => {
    mountPage(<CallsPage />, { routes: { 'GET /api/v1/ops/funds': D([]) } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/The API could not be reached/);
  });
  it('a signed-out session redirects to login with the page to return to', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/ops-native/funds', search: '?x=1', assign } });
    try {
      mockApi({ 'GET /api/auth/me': { status: 401, body: { error: { code: 'unauthenticated', message: 'no' } } } });
      renderWithProviders(<div>secret</div>, { providers: [SessionProvider] });
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?next=%2Fops%2Ffunds%3Fx%3D1'));
      expect(screen.queryByText('secret')).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
  it('a user without an admin-portal role is refused with a sign-in-as-someone-else link', async () => {
    mockApi(loginAs('investor'));
    renderWithProviders(<div>secret</div>, { providers: [SessionProvider] });
    expect(await screen.findByText(/does not have access to the staff workspace/)).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});
