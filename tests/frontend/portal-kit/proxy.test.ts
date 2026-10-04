import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPortalProxy } from '@matanho/portal-kit/proxy';
import { mockApi, raw, fail, expectCalled, makeUser } from '../_helpers';

function req(path: string, opts: { host?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const host = opts.host ?? 'company.example.com';
  const headers: Record<string, string> = { host, ...(opts.headers ?? {}) };
  if (opts.cookies) headers.cookie = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest(`http://${host}${path}`, { headers });
}
const loc = (res: Response) => res.headers.get('location');
const isNext = (res: Response) => res.headers.get('x-middleware-next') === '1';
const roleless = { requirePortalRole: false };

afterEach(() => vi.unstubAllEnvs());

describe('portal proxy gate (createPortalProxy)', () => {
  it('lets everything through when the portal is not in REQUIRE_AUTH_PORTALS', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'admin,investor');
    const api = mockApi({});
    const res = await createPortalProxy('company', roleless)(req('/cap-table'));
    expect(isNext(res)).toBe(true);
    expect(api.requests).toHaveLength(0);
  });

  it('redirects to /login?next=<path+query> when gated and there is no cookie', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    mockApi({});
    const res = await createPortalProxy('company', roleless)(req('/reports?tab=drafts'));
    expect(res.status).toBe(307);
    const u = new URL(loc(res)!);
    expect(u.origin).toBe('http://company.example.com');
    expect(u.pathname).toBe('/login');
    expect(u.searchParams.get('next')).toBe('/reports?tab=drafts');
  });

  it('valid session on a role-less portal passes; cookie is forwarded under the plain name', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    const api = mockApi({ 'GET /api/auth/me': raw({ user: makeUser('company') }) });
    const res = await createPortalProxy('company', roleless)(req('/', { cookies: { nexus_session: 'tok1' } }));
    expect(isNext(res)).toBe(true);
    const [call] = expectCalled(api, 'GET /api/auth/me');
    expect(call.headers.cookie).toBe('nexus_session=tok1');
  });

  it('ADA-004/LPC-001: on localhost outside production the cookie is read per portal port and forwarded under the plain name', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    vi.stubEnv('NODE_ENV', 'development');
    const api = mockApi({ 'GET /api/auth/me': raw({ user: makeUser('company') }) });
    // another portal's cookie (port 48221) must not authenticate this portal (port 48225)
    const wrong = await createPortalProxy('company', roleless)(req('/', { host: 'localhost:48225', cookies: { nexus_session_48221: 'other' } }));
    expect(loc(wrong)).toContain('/login');
    expect(api.requests).toHaveLength(0);
    const right = await createPortalProxy('company', roleless)(
      req('/', { host: 'localhost:48225', cookies: { nexus_session_48225: 'mine', nexus_session_48221: 'other' } }),
    );
    expect(isNext(right)).toBe(true);
    expect(api.requests[0].headers.cookie).toBe('nexus_session=mine');
  });

  it('in production the plain cookie name is used even with a port in the host', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    vi.stubEnv('NODE_ENV', 'production');
    const api = mockApi({ 'GET /api/auth/me': raw({ user: makeUser('company') }) });
    const res = await createPortalProxy('company', roleless)(req('/', { host: 'localhost:3100', cookies: { nexus_session: 'p' } }));
    expect(isNext(res)).toBe(true);
    expect(api.requests).toHaveLength(1);
  });

  it('honours a custom SESSION_COOKIE_NAME', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    vi.stubEnv('SESSION_COOKIE_NAME', 'mx_sess');
    const api = mockApi({ 'GET /api/auth/me': raw({ user: makeUser('company') }) });
    const res = await createPortalProxy('company', roleless)(req('/', { cookies: { mx_sess: 'z' } }));
    expect(isNext(res)).toBe(true);
    expect(api.requests[0].headers.cookie).toBe('mx_sess=z');
  });

  it('INO-001: investor/custodian accounts are turned away to /access-denied; company accounts pass', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    const proxy = createPortalProxy('company', { requirePortalRole: false, turnAwayPortals: ['investor', 'custodian'] });
    const cookies = { nexus_session: 't' };
    mockApi({ 'GET /api/auth/me': raw({ user: makeUser('custodian') }) });
    expect(new URL(loc(await proxy(req('/', { cookies })))!).pathname).toBe('/access-denied');
    mockApi({ 'GET /api/auth/me': raw({ user: makeUser('investor') }) });
    expect(new URL(loc(await proxy(req('/', { cookies })))!).pathname).toBe('/access-denied');
    mockApi({ 'GET /api/auth/me': raw({ user: makeUser('company') }) });
    expect(isNext(await proxy(req('/', { cookies })))).toBe(true);
  });

  it('requirePortalRole: a user without a role on this portal goes to /login', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'admin');
    const cookies = { nexus_session: 't' };
    mockApi({ 'GET /api/auth/me': raw({ user: makeUser('investor') }) });
    const res = await createPortalProxy('admin', { requirePortalRole: true })(req('/ops', { cookies }));
    expect(new URL(loc(res)!).pathname).toBe('/login');
    mockApi({ 'GET /api/auth/me': raw({ user: makeUser('admin') }) });
    expect(isNext(await createPortalProxy('admin', { requirePortalRole: true })(req('/ops', { cookies })))).toBe(true);
  });

  it('API says 401 or is unreachable: treated as signed out', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    const proxy = createPortalProxy('company', roleless);
    const cookies = { nexus_session: 't' };
    mockApi({ 'GET /api/auth/me': fail(401, 'unauthenticated', 'no') });
    expect(new URL(loc(await proxy(req('/x', { cookies })))!).pathname).toBe('/login');
    mockApi({}); // fetch throws
    expect(new URL(loc(await proxy(req('/x', { cookies })))!).pathname).toBe('/login');
  });

  it('API_INTERNAL_URL is used for the session check', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    vi.stubEnv('API_INTERNAL_URL', 'http://api:4100/');
    const api = mockApi({ 'GET /api/auth/me': raw({ user: makeUser('company') }) });
    await createPortalProxy('company', roleless)(req('/', { cookies: { nexus_session: 't' } }));
    expect(api.requests[0].url).toBe('http://api:4100/api/auth/me');
  });

  it('behind a reverse proxy the redirect uses the public (forwarded) origin, not the internal host', async () => {
    vi.stubEnv('REQUIRE_AUTH_PORTALS', 'company');
    mockApi({});
    const res = await createPortalProxy('company', roleless)(
      req('/team', { host: '127.0.0.1:3100', headers: { 'x-forwarded-host': 'company.nexus.matanho.com', 'x-forwarded-proto': 'https' } }),
    );
    const u = new URL(loc(res)!);
    expect(u.origin).toBe('https://company.nexus.matanho.com');
    expect(u.searchParams.get('next')).toBe('/team');
  });
});
