/**
 * WS0 checkpoint smoke against a RUNNING API: platform flags, the LP envelope and session
 * contract shape, role gates, client scoping and unknown-route handling.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4150 npx tsx scripts/smoke-ws0.ts
 *
 * Creates throwaway users, clients and a fund (removed at the end); disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ws0-${randomBytes(9).toString('base64url')}`;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
};

function client() {
  const origin = config.portalUrls.investor;
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (cookie) h.Cookie = cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      cookie = /max-age=0/i.test(c) ? '' : pair!;
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed };
  };
  return {
    call,
    login: (email: string) => call('POST', '/api/auth/login', { email, password, portal: 'investor' }),
  };
}

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (key: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'investor', key } } });

  const fund = await prisma.fund.create({
    data: { ref: `WS0${run}`, name: `WS0 Fund ${run}`, shortName: 'WS0', currency: 'USD', asOfDate: new Date('2026-06-30'), valuationStatus: 'FINAL' },
  });
  const hidden = await prisma.fund.create({ data: { ref: `WS0H${run}`, name: `Hidden ${run}`, shortName: 'HID', portalVisible: false } });
  const mk = (suffix: string) =>
    prisma.client.create({ data: { ref: `W${run}${suffix}`, name: `WS0 Client ${suffix} ${run}`, type: 'Pension fund', portalEnabled: true } });
  const a = await mk('A');
  const b = await mk('B');
  await prisma.fundCommitment.create({ data: { clientId: a.id, fundId: fund.id, commitmentAmount: '1000000.00', investorAccountRef: 'ACC-A' } });
  await prisma.fundCommitment.create({ data: { clientId: a.id, fundId: hidden.id, commitmentAmount: '5.00' } });
  await prisma.fundCommitment.create({ data: { clientId: b.id, fundId: fund.id, commitmentAmount: '250000.00' } });

  const users: string[] = [];
  const mkUser = async (label: string, clientId: string, investorRole: string) => {
    const user = await prisma.user.create({ data: { email: `ws0-${run}-${label}@example.test`, name: `WS0 ${label}`, passwordHash: hash } });
    users.push(user.id);
    await prisma.userRole.create({ data: { userId: user.id, roleId: (await role(investorRole)).id } });
    await prisma.clientUser.create({ data: { userId: user.id, clientId, investorRole } });
    return user;
  };
  const manager = await mkUser('mgr', a.id, 'admin');
  const viewer = await mkUser('viewer', a.id, 'auditor');
  await mkUser('other', b.id, 'finance');

  try {
    console.log('\nPlatform flags');
    const anon = client();
    const flags = await anon.call('GET', '/api/v1/platform/flags');
    check('flags are public', flags.status === 200, flags);
    check('flags list every LP domain', flags.body?.lp && Object.keys(flags.body.lp).length === 12, flags.body);

    console.log('\nLP envelope');
    const unauth = await anon.call('GET', '/api/v1/lp-portal/session');
    check('unauthenticated -> 401 LP_UNAUTHORIZED envelope', unauth.status === 401 && unauth.body?.code === 'LP_UNAUTHORIZED' && unauth.body?.success === false, unauth);

    const m = client();
    check('manager signs in', (await m.login(manager.email)).status === 200);
    const s = await m.call('GET', '/api/v1/lp-portal/session');
    const d = s.body?.data;
    check('session 200 in LP envelope', s.status === 200 && s.body?.success === true && typeof s.body?.timestamp === 'string', s);
    check('session lpRole MANAGER (admin)', d?.lpRole === 'MANAGER', d);
    check('session shows only portal-visible funds', d?.funds?.length === 1 && d.funds[0].fundId === fund.id, d?.funds);
    check('commitment is a decimal string', d?.funds?.[0]?.commitmentAmount === '1000000', d?.funds);
    check('unreadCounts are numbers', d && ['requests', 'messages', 'notices', 'notifications'].every((k) => typeof d.unreadCounts[k] === 'number'), d);
    check('client is own client', d?.client?.id === a.id, d?.client);

    const list = await m.call('GET', '/api/v1/lp-portal/capital-calls?page=2&pageSize=5');
    check('stub list is contract-valid', list.status === 200 && list.body?.data?.page === 2 && Array.isArray(list.body?.data?.items), list);
    const missing = await m.call('GET', '/api/v1/lp-portal/does-not-exist');
    check('unknown LP route -> 404 LP_NOT_FOUND', missing.status === 404 && missing.body?.code === 'LP_NOT_FOUND', missing);
    const other = await m.call('GET', `/api/v1/lp-portal/session?client=W${run}B`);
    check('foreign client selector -> 403', other.status === 403 && other.body?.code === 'LP_FORBIDDEN', other);

    console.log('\nRole gates');
    const v = client();
    check('viewer signs in', (await v.login(viewer.email)).status === 200);
    const vs = await v.call('GET', '/api/v1/lp-portal/session');
    check('viewer lpRole VIEWER (auditor)', vs.body?.data?.lpRole === 'VIEWER', vs.body);
    const inv = await v.call('POST', '/api/v1/lp-portal/colleagues', { email: 'x@example.test', lpRole: 'VIEWER' });
    check('viewer invite colleague -> 403 LP_FORBIDDEN', inv.status === 403 && inv.body?.code === 'LP_FORBIDDEN', inv);
    const ack = await v.call('POST', '/api/v1/lp-portal/capital-calls/x/acknowledge', {}, { 'Idempotency-Key': `k-${run}` });
    check('viewer acknowledge call -> 403', ack.status === 403, ack);
    const noKey = await m.call('POST', '/api/v1/lp-portal/capital-calls/x/acknowledge', {});
    check('missing Idempotency-Key -> 400 LP_VALIDATION', noKey.status === 400 && noKey.body?.code === 'LP_VALIDATION', noKey);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: users } } });
    await prisma.client.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await prisma.fund.deleteMany({ where: { id: { in: [fund.id, hidden.id] } } });
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll WS0 checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
