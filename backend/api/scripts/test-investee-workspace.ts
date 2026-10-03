/**
 * Live investee workspace: application, procurement, cap table, forecast,
 * governance, vault and signatures. Company writes, then a portfolio user decides the request.
 *
 *   E2E_CONFIRM=local npx tsx --env-file-if-exists=../../.env scripts/test-investee-workspace.ts
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { decryptField } from '../src/lib/crypto';
import { totpNow } from '../src/lib/totp';

if (process.env.E2E_CONFIRM !== 'local') {
  console.error('Refusing to run: set E2E_CONFIRM=local');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://127.0.0.1:${config.port}`;
const run = randomBytes(3).toString('hex');
let passes = 0;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 800));
  }
};

type Res = { status: number; body: any };
const users = JSON.parse(readFileSync(new URL('../../../secrets/uat-users.json', import.meta.url), 'utf8')) as { email: string; password: string }[];
const pw = (email: string) => users.find((u) => u.email === email)?.password ?? '';

function client(portal: 'investor' | 'admin' | 'company') {
  const origin = config.portalUrls[portal];
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: string | FormData, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, { method, headers: h, body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed };
  };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const once = () =>
      send(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? headers : { 'Content-Type': 'application/json', ...headers });
    let res = await once();
    for (let i = 0; i < 8 && res.status === 409 && String(res.body?.error?.code ?? res.body?.code ?? '').includes('in_progress'); i++) {
      await new Promise((r) => setTimeout(r, 200));
      res = await once();
    }
    return res;
  };
  return { call, get: (path: string) => call('GET', path), send };
}

async function codeFor(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { mfaFactors: { where: { verifiedAt: { not: null } } } } });
  const secret = decryptField(user.mfaFactors[0]?.secretEnc ?? null);
  if (!secret) throw new Error(`no TOTP for ${email}`);
  return totpNow(secret);
}

async function signIn(portal: 'admin' | 'company', email: string, loginPortal: string | null = portal) {
  const c = client(portal);
  const login = await c.call('POST', '/api/auth/login', { email, password: pw(email), ...(loginPortal ? { portal: loginPortal } : {}) });
  if (login.body?.mfa === 'verify') {
    const verified = await c.call('POST', '/api/auth/mfa/verify', { code: await codeFor(email) });
    check(`${email} signs in`, verified.status === 200, verified.body);
  } else {
    check(`${email} signs in`, login.status === 200, login.body);
  }
  return c;
}

const key = (s: string) => ({ 'Idempotency-Key': `ws-${run}-${s}` });
const dataOf = (res: Res) => res.body?.data ?? res.body;

async function main() {
  const investee = 'investee_102_admin@uat.matanho.test';
  const company = await signIn('company', investee, null);
  const link = await prisma.companyUser.findFirst({ where: { user: { email: investee }, status: 'active' }, select: { companyId: true } });
  if (!link) throw new Error('investee has no company');
  const companyId = link.companyId;
  const keys = ['workspace.cap', 'workspace.governance', 'workspace.forecast', 'workspace.requests'];
  const before = await prisma.setting.findMany({ where: { ownerId: companyId, key: { in: keys } } });

  const flags = await company.get('/api/v1/platform/flags');
  const live = flags.body?.investee?.liveActions as string[] | undefined;
  check('forecast and vault are allowlisted', Array.isArray(live) && (live.includes('all') || (live.includes('forecast') && live.includes('vault') && live.includes('requests.create'))), live);

  const application = await company.get('/api/v1/investee-portal/application');
  check('application summary names the company', application.status === 200 && typeof dataOf(application).businessName === 'string' && dataOf(application).businessName.length > 1, application.body);

  const cap = await company.call('PUT', '/api/v1/investee-portal/cap-table', {
    shareholders: [
      { name: `Founders ${run}`, type: 'Ordinary', shares: 8000 },
      { name: `Fund ${run}`, type: 'Preferred', shares: 2000 },
    ],
  });
  const holders = dataOf(cap).shareholders as { name: string; pct: number }[];
  check('cap table save records both holders', cap.status === 200 && holders?.length === 2 && holders[1]?.pct === 20, cap.body);

  const month = new Date().toISOString().slice(0, 7);
  const forecast = await company.call('PUT', '/api/v1/investee-portal/forecast', { scenario: 'Upside', revenue: { [month]: 125000 } });
  check('forecast stores the upside cell', forecast.status === 200 && dataOf(forecast).scenario === 'Upside' && dataOf(forecast).forecast?.[month] === 125000, forecast.body);

  const consent = await company.call(
    'POST',
    '/api/v1/investee-portal/governance/consents',
    { title: `Facility ${run}`, basis: 'New debt or security', due: '2026-12-15', note: 'Working capital facility for the test.' },
    key('consent'),
  );
  const consents = dataOf(consent).consents as { title: string }[];
  check('governance consent is listed', consent.status === 201 && consents?.some((row) => row.title === `Facility ${run}`), consent.body);
  check('reserved matters are part of governance', Array.isArray(dataOf(consent).reservedMatters) && dataOf(consent).reservedMatters.length >= 5, consent.body);

  const request = await company.call(
    'POST',
    '/api/v1/investee-portal/procurement',
    { title: `POS terminals ${run}`, description: '120 units for the branch rollout.', type: 'Procurement request', category: 'Equipment procurement', currency: 'USD', amount: 250000, needBy: '2026-11-30', priority: 'High' },
    key('request'),
  );
  const requestId = dataOf(request).id as string;
  check('procurement request is submitted', request.status === 201 && dataOf(request).status === 'SUBMITTED' && /Procurement request/.test(dataOf(request).sourcingCategory), request.body);
  const listed = await company.get('/api/v1/investee-portal/procurement');
  check('procurement list contains the request', (dataOf(listed).requisitions as { id: string }[])?.some((row) => row.id === requestId), listed.body);

  const form = new FormData();
  form.append('file', new Blob(['vault note ' + run], { type: 'text/plain' }), `vault-${run}.txt`);
  form.append('name', `Vault note ${run}`);
  form.append('type', 'company');
  const uploaded = await company.send('POST', '/api/v1/investee-portal/vault', form, key('vault'));
  const docId = dataOf(uploaded).id as string;
  check('vault accepts the file', uploaded.status === 201 && dataOf(uploaded).fileName === `Vault note ${run}`, uploaded.body);
  const vault = await company.get('/api/v1/investee-portal/vault');
  check('vault lists the file', (dataOf(vault).documents as { id: string }[])?.some((row) => row.id === docId), vault.status);

  const signatures = await company.get('/api/v1/investee-portal/signatures');
  check('signatures endpoint answers', signatures.status === 200 && Array.isArray(dataOf(signatures)), signatures.body);
  const team = await company.get('/api/v1/investee-portal/team');
  check('team list includes the admin', team.status === 200 && (dataOf(team) as { email: string }[]).some((row) => row.email === investee), team.body);
  const threads = await company.get('/api/v1/investee-portal/threads');
  check('message threads answer', threads.status === 200 && Array.isArray(dataOf(threads)), threads.body);
  const started = await company.call('POST', '/api/v1/investee-portal/threads', { title: `Workspace note ${run}`, text: 'Opening the thread.' }, key('thread'));
  const threadId = dataOf(started).id as string;
  check('company can start a thread', started.status === 201 && Boolean(threadId), started.body);
  const reply = await company.call('POST', `/api/v1/investee-portal/threads/${encodeURIComponent(threadId)}/messages`, { text: `Reply ${run}` }, key('reply'));
  const replyMessages = dataOf(reply).messages as { text: string }[] | undefined;
  check('company can reply on the thread', reply.status === 200 && replyMessages?.some((row) => row.text === `Reply ${run}`), reply.body);

  const dash = await company.get('/api/v1/investee-portal/dashboard');
  check('dashboard carries the application', dash.status === 200 && dataOf(dash).summary?.hasApplication === true && dataOf(dash).application?.businessName, dash.body);

  const staff = await prisma.user.findFirst({
    where: { roles: { some: { role: { portal: 'admin', permissions: { some: { permission: 'research.edit' } } } } } },
    select: { email: true },
  });
  if (!staff || !pw(staff.email)) {
    check('a portfolio user with research.edit exists', false, staff?.email);
  } else {
    const ops = await signIn('admin', staff.email);
    const queue = await ops.get('/api/v1/ops/investee-requests');
    check('staff can see the company request', (queue.body?.data as { id: string }[])?.some((row) => row.id === requestId), queue.status);
    const approved = await ops.call('POST', `/api/v1/ops/investee-requests/${companyId}/${requestId}/decide`, { status: 'APPROVED', note: 'Approved in the local test.' }, key('decide'));
    check('staff approves the request', approved.status === 200 && approved.body?.data?.status === 'APPROVED', approved.body);
    const again = await company.get('/api/v1/investee-portal/procurement');
    check('the company sees the approval', (dataOf(again).requisitions as { id: string; status: string }[])?.some((row) => row.id === requestId && row.status === 'APPROVED'), again.body);
    const consentId = (dataOf(consent).consents as { id: string; title: string }[])?.find((row) => row.title === `Facility ${run}`)?.id;
    const consentQueue = await ops.get('/api/v1/ops/investee-requests/consents');
    check('staff can see the consent', Boolean(consentId) && (consentQueue.body?.data as { id: string }[])?.some((row) => row.id === consentId), consentQueue.status);
    const decided = await ops.call(
      'POST',
      `/api/v1/ops/investee-requests/consents/${companyId}/${encodeURIComponent(consentId ?? '')}/decide`,
      { status: 'Approved', note: 'Approved in the local test.' },
      key('consent-decide'),
    );
    check('staff approves the consent', decided.status === 200 && decided.body?.data?.status === 'Approved', decided.body);
    const gov = await company.get('/api/v1/investee-portal/governance');
    check(
      'the company sees the consent decision',
      (dataOf(gov).consents as { id: string; status: string }[])?.some((row) => row.id === consentId && row.status === 'Approved'),
      gov.body,
    );
  }

  await prisma.setting.deleteMany({ where: { ownerId: companyId, key: { in: keys } } });
  if (before.length) {
    await prisma.setting.createMany({ data: before.map((row) => ({ ownerId: row.ownerId, key: row.key, value: row.value as object })) });
  }
  if (docId) await prisma.document.delete({ where: { id: docId } }).catch(() => undefined);
  if (threadId) await prisma.reportingQuestion.deleteMany({ where: { companyId, ref: threadId } });

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
