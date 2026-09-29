/**
 * End-to-end check of the shared authentication flow against a RUNNING API.
 *
 *   npm run dev:api            (in one terminal)
 *   npm run smoke -w @matanho/api
 *
 * Uses the same typed client the portals use, from each portal's real origin.
 * Creates a throwaway user and removes it at the end.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ApiError, PORTAL_IDS, PORTALS, createApiClient } from '@matanho/shared';

const API = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? 4100}`;
const prisma = new PrismaClient();

let failures = 0;
const ok = (name: string) => console.log(`  PASS  ${name}`);
const fail = (name: string, detail?: unknown) => {
  failures++;
  console.log(`  FAIL  ${name}`, detail ?? '');
};
const check = (name: string, cond: boolean, detail?: unknown) => (cond ? ok(name) : fail(name, detail));

/** fetch with a tiny cookie jar so each "portal" behaves like a browser. */
function browser(origin: string): typeof fetch {
  let cookie = '';
  return async (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Origin', origin);
    if (cookie) headers.set('Cookie', cookie);
    const res = await fetch(input, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      cookie = /max-age=0|expires=thu, 01 jan 1970/i.test(c) || value === '' ? '' : `${name}=${value}`;
    }
    return res;
  };
}

async function expectError(name: string, status: number, run: () => Promise<unknown>) {
  try {
    await run();
    fail(name, 'expected error but request succeeded');
  } catch (e) {
    check(name, e instanceof ApiError && e.status === status, e instanceof ApiError ? `${e.status} ${e.code}` : e);
  }
}

const email = `smoke-${randomBytes(4).toString('hex')}@example.test`;
const password = randomBytes(12).toString('base64url');

try {
  console.log(`API: ${API}\n`);

  console.log('Health');
  const anon = createApiClient({ baseUrl: API, fetchImpl: browser(`http://localhost:${PORTALS.admin.devPort}`) });
  const health = await anon.health();
  check('GET /api/health -> ok', health.status === 'ok', health);

  console.log('\nRegistration + credential handling');
  const reg = await anon.register({ email, password, name: 'Smoke Test' });
  check('register returns user', reg.user.email === email);
  check('register never leaks password material', !JSON.stringify(reg).match(/password|hash/i), reg);
  await expectError('duplicate email -> 409', 409, () => anon.register({ email, password }));
  await expectError('weak password -> 400', 400, () => anon.register({ email: `x-${email}`, password: 'short' }));

  const row = await prisma.user.findUnique({ where: { email } });
  check('password stored as bcrypt hash (not plaintext)', !!row && row.passwordHash.startsWith('$2') && row.passwordHash !== password);

  console.log('\nUnauthenticated access');
  await expectError('GET /me without session -> 401', 401, () => anon.me());
  await expectError('wrong password -> 401', 401, () => anon.login({ email, password: 'wrong-password-123' }));
  await expectError('unknown email -> 401', 401, () => anon.login({ email: `nobody-${email}`, password }));

  console.log('\nPortal authorisation (shared user, per-portal access)');
  await expectError('no role => admin portal login denied (403)', 403, () => anon.login({ email, password, portal: 'admin' }));

  // Give the throwaway user one investor role (as an administrator would).
  const investorRole = await prisma.role.findFirst({ where: { portal: 'investor' } });
  if (!investorRole) throw new Error('No roles seeded - run `npm run db:seed` first');
  await prisma.userRole.create({ data: { userId: row!.id, roleId: investorRole.id } });

  for (const portal of PORTAL_IDS) {
    const origin = `http://localhost:${PORTALS[portal].devPort}`;
    const client = createApiClient({ baseUrl: API, fetchImpl: browser(origin) });
    if (portal === 'investor') {
      const res = await client.login({ email, password, portal });
      check(`[${portal}] login ok`, res.user.email === email);
      check(`[${portal}] roles/permissions returned`, res.user.roles.length === 1 && res.user.permissions.length > 0);
      const me = await client.me();
      check(`[${portal}] /me with session`, me.user.id === res.user.id);
      await client.logout();
      await expectError(`[${portal}] /me after logout -> 401`, 401, () => client.me());
    } else {
      await expectError(`[${portal}] login denied without ${portal} role (403)`, 403, () => client.login({ email, password, portal }));
      const res = await client.login({ email, password });
      check(`[${portal}] same account signs in without portal restriction`, res.user.email === email);
      await client.logout();
    }
  }

  console.log('\nCORS / CSRF');
  const evil = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: JSON.stringify({ email, password }),
  });
  check('POST from unlisted origin -> 403', evil.status === 403, evil.status);
  const preflight = await fetch(`${API}/api/auth/me`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:3101', 'Access-Control-Request-Method': 'GET' },
  });
  check('preflight from portal origin allowed', preflight.headers.get('access-control-allow-origin') === 'http://localhost:3101' && preflight.headers.get('access-control-allow-credentials') === 'true');
} catch (error) {
  fail('unexpected error', error);
} finally {
  await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
  await prisma.$disconnect();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
