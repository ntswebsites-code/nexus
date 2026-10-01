/**
 * Cross-portal Phase 1 journey against a RUNNING API and its database:
 * onboarding -> KYC -> activation -> investor invite, the demo investor and company
 * workspaces, reporting-pack review, RBAC/audit and TOTP MFA.
 *
 *   SEED_DEMO=1 npm run db:seed -w @matanho/api
 *   E2E_CONFIRM=throwaway-db npm run e2e -w @matanho/api
 *
 * It creates throwaway users (removed at the end) and leaves business records behind,
 * so only point it at a disposable or development database.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes demo records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `E2e-${randomBytes(9).toString('base64url')}`;
const createdEmails: string[] = [];

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
};

type Res = { status: number; body: any };

/** A browser-like client for one portal origin with its own cookie jar. */
function portal(name: keyof typeof config.portalUrls) {
  const origin = config.portalUrls[name];
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown): Promise<Res> => {
    const headers: Record<string, string> = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    let payload: FormData | string | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const value = pair!.slice(eq + 1);
      cookie = /max-age=0|expires=thu, 01 jan 1970/i.test(c) || value === '' ? '' : pair!;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* CSV / binary */
    }
    return { status: res.status, body: parsed };
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    put: (p: string, b?: unknown) => call('PUT', p, b ?? {}),
    patch: (p: string, b?: unknown) => call('PATCH', p, b ?? {}),
    // Role-less portals (company, onboarding) sign in without the portal role check, like their LoginForm.
    login: (email: string, pw = password) =>
      call('POST', '/api/auth/login', { email, password: pw, ...(name === 'company' || name === 'onboarding' ? {} : { portal: name }) }),
  };
}

async function makeUser(label: string, roles: string[]) {
  const email = `e2e-${run}-${label}@example.test`;
  const bcrypt = (await import('bcryptjs')).default;
  const user = await prisma.user.create({ data: { email, name: `E2E ${label}`, passwordHash: await bcrypt.hash(password, 4) } });
  createdEmails.push(email);
  for (const spec of roles) {
    const [p, key] = spec.split(':');
    const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: p!, key: key! } } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

function pdf(label: string) {
  const f = new FormData();
  f.append('file', new Blob([`%PDF-1.4\n% ${label}\n%%EOF\n`], { type: 'application/pdf' }), `${label}.pdf`);
  return f;
}

/** Signed download URLs point at PUBLIC_API_URL; fetch them through the API under test. */
async function fetchSigned(url: string) {
  const u = new URL(url);
  const res = await fetch(`${API}${u.pathname}${u.search}`);
  return { status: res.status, head: Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString() };
}

try {
  console.log(`API ${API} · run ${run}\n`);
  const health = (await fetch(`${API}/api/health?deep=1`).then((r) => r.json())) as { status?: string };
  check('health ok', health.status === 'ok', health);

  const director = await makeUser('director', ['admin:investment_director']);
  const services = await makeUser('services', ['admin:client_services']);
  const compliance = await makeUser('compliance', ['admin:compliance']);
  const sysadmin = await makeUser('sysadmin', ['admin:system_admin']);

  // ------------------------------------------------------------ onboarding -> KYC -> activation
  console.log('\nOnboarding and KYC');
  const onb = portal('onboarding');
  const applicant = `e2e-${run}-applicant@example.test`;
  createdEmails.push(applicant);
  const draft = await onb.post('/api/v1/public/applications', { email: applicant, applicantType: 'Company', name: `E2E Holdings ${run}`, sendLink: false });
  check('draft created (201)', draft.status === 201 && draft.body.token, draft);
  const draftHeaders = { id: draft.body.id as string, token: draft.body.token as string };
  const withToken = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { Origin: config.portalUrls.onboarding, 'X-Draft-Token': draftHeaders.token };
    let payload: FormData | string | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}/api/v1/public/applications/${draftHeaders.id}${path}`, { method, headers, body: payload });
    return { status: res.status, body: await res.json().catch(() => null) } as Res;
  };
  const noToken = await fetch(`${API}/api/v1/public/applications/${draftHeaders.id}`, { headers: { Origin: config.portalUrls.onboarding } });
  check('draft unreachable without its token (404)', noToken.status === 404, noToken.status);
  const early = await withToken('POST', '/submit', { consent: true });
  check('incomplete submit rejected (400)', early.status === 400 && early.body?.error?.code === 'incomplete_application', early.body);
  await withToken('PATCH', '', { form: { name: `E2E Holdings ${run}`, country: 'Zimbabwe', email: applicant, amount: '2500000', funds: 'Operating surplus' } });
  for (const slot of ['doc1', 'doc2', 'doc3', 'doc4']) {
    const f = pdf(slot);
    f.append('slot', slot);
    const up = await withToken('POST', '/evidence', f);
    check(`evidence ${slot} uploaded`, up.status === 200 || up.status === 201, up.body);
  }
  const submitted = await withToken('POST', '/submit', { consent: true });
  check('application submitted', submitted.status === 200 && /^ONB-/.test(submitted.body?.ref), submitted.body);

  const svc = portal('admin');
  check('client services signs in to admin', (await svc.login(services.email)).status === 200);
  const list = await svc.get(`/api/v1/kyc/cases?q=${encodeURIComponent(`E2E Holdings ${run}`)}`);
  const kase = list.body?.data?.[0];
  check('case visible in KYC queue at Screening', kase?.stage === 'Screening', list.body);
  const adv = await svc.post(`/api/v1/kyc/cases/${kase.id}/advance`, { toStage: 'ComplianceReview', reason: 'Pre-screen reviewed' });
  check('preparer moves case to compliance review', adv.status === 200, adv.body);
  const selfDecide = await svc.post(`/api/v1/kyc/cases/${kase.id}/decision`, { decision: 'approve', reason: 'Trying to self-approve' });
  check('non-compliance user cannot decide (403)', selfDecide.status === 403, selfDecide.body);

  const comp = portal('admin');
  check('compliance signs in', (await comp.login(compliance.email)).status === 200);
  const approve = await comp.post(`/api/v1/kyc/cases/${kase.id}/decision`, { decision: 'approve', reason: 'Evidence complete, low risk profile' });
  check('compliance approves with rationale', approve.status === 200, approve.body);
  const activate = await svc.post(`/api/v1/kyc/cases/${kase.id}/activate`);
  check('activation creates client + invitation', activate.status === 200, activate.body);

  const outbox = await prisma.outboxEvent.findMany({ where: { type: 'email.send' }, orderBy: { id: 'desc' }, take: 50 });
  const inviteMail = outbox.map((o) => o.payload as { to?: string; text?: string }).find((p) => p.to === applicant && /token=/.test(p.text ?? ''));
  const inviteToken = inviteMail ? decodeURIComponent(/token=([^\s&]+)/.exec(inviteMail.text!)![1]!) : '';
  check('invitation email queued for the applicant', !!inviteToken);
  const inv = portal('investor');
  const accept = await inv.post('/api/auth/invitations/accept', { token: inviteToken, password, name: 'E2E Applicant' });
  check('investor accepts invitation', accept.status === 200, accept.body);
  const reuse = await inv.post('/api/auth/invitations/accept', { token: inviteToken, password });
  check('invitation is single-use', reuse.status >= 400, reuse.status);
  check('new investor signs in', (await inv.login(applicant)).status === 200);
  const boot = await inv.get('/api/v1/investor/bootstrap');
  check('new investor sees own client', boot.body?.client?.name === `E2E Holdings ${run}`, boot.body?.client);

  // ------------------------------------------------------------ demo investor
  console.log('\nDemo investor (CL-00418)');
  const demoClient = await prisma.client.findUnique({ where: { ref: 'CL-00418' } });
  if (!demoClient) check('demo client seeded (run seed with SEED_DEMO=1)', false);
  else {
    const holder = await makeUser('investor', ['investor:admin']);
    await prisma.clientUser.create({ data: { clientId: demoClient.id, userId: holder.id, investorRole: 'admin' } });
    const hv = portal('investor');
    check('demo investor signs in', (await hv.login(holder.email)).status === 200);
    const b = await hv.get('/api/v1/investor/bootstrap');
    check('NAV matches prototype (US$ 19.48M)', b.body?.metrics?.nav === 19480000, b.body?.metrics);
    check('14 published documents', b.body?.documents?.length === 14, b.body?.documents?.length);
    check('6 capital events', b.body?.capitalActivity?.length === 6, b.body?.capitalActivity?.length);
    const dl = await hv.get('/api/v1/investor/documents/DOC-081/download-url');
    const file = dl.body?.url ? await fetchSigned(dl.body.url) : { status: 0, head: '' };
    check('document download is a real PDF', file.status === 200 && file.head === '%PDF-', { dl: dl.body, file });
    const tampered = dl.body?.url ? await fetchSigned(dl.body.url.replace(/sig=[0-9a-f]{4}/, 'sig=0000')) : { status: 0 };
    check('tampered signed URL rejected', tampered.status === 403 || tampered.status === 401 || tampered.status === 404, tampered.status);
    const staffOnly = await hv.get('/api/v1/admin/users');
    check('investor cannot call admin API', staffOnly.status === 401 || staffOnly.status === 403, staffOnly.status);
    const other = await inv.get('/api/v1/investor/documents/DOC-081/download-url');
    check("other client's investor cannot read CL-00418 documents", other.status === 404 || other.status === 403, other.status);
  }

  // ------------------------------------------------------------ company reporting
  console.log('\nCompany reporting (PC-100)');
  const demoCompany = await prisma.portfolioCompany.findUnique({ where: { ref: 'PC-100' } });
  if (!demoCompany) check('demo company seeded (run seed with SEED_DEMO=1)', false);
  else {
    const cfo = await makeUser('company', []);
    await prisma.companyUser.create({ data: { companyId: demoCompany.id, userId: cfo.id } });
    const co = portal('company');
    check('company user signs in', (await co.login(cfo.email)).status === 200);
    const ws = await co.get('/api/v1/company/workspace');
    check('workspace has 4 periods + 4 covenants', ws.body?.periods?.length === 4 && ws.body?.covenants?.length === 4, ws.body?.periods);
    const period = ws.body?.periods?.find((p: { status: string }) => p.status === 'open' || p.status === 'returned')?.id;
    const bad = new FormData();
    bad.append('files', new Blob(['x'], { type: 'image/png' }), 'wrong.png');
    const rejected = await co.post(`/api/v1/company/periods/${period}/items/accounts/files`, bad);
    check('wrong file type rejected for item', rejected.status === 400, rejected.body);
    for (const [key, name, type] of [
      ['accounts', 'accounts.pdf', 'application/pdf'],
      ['kpis', 'kpis.csv', 'text/csv'],
      ['debt', 'debt.pdf', 'application/pdf'],
      ['compliance', 'certs.pdf', 'application/pdf'],
    ] as const) {
      const f = new FormData();
      f.append('files', new Blob([type === 'text/csv' ? 'kpi,value\nrevenue,1900\n' : '%PDF-1.4\n%%EOF\n'], { type }), name);
      const up = await co.post(`/api/v1/company/periods/${period}/items/${key}/files`, f);
      check(`upload ${key}`, up.status === 200 || up.status === 201, up.body);
    }
    const sub = await co.post(`/api/v1/company/periods/${period}/submit`, { kpis: { revenue: 1900 }, notes: 'E2E pack' });
    check('pack submitted', sub.status === 200, sub.body);
    const locked = await co.put(`/api/v1/company/periods/${period}`, { notes: 'late edit' });
    check('submitted pack is locked', locked.status === 409, locked.status);

    const dir = portal('admin');
    check('investment director signs in', (await dir.login(director.email)).status === 200);
    const queue = await dir.get('/api/v1/private-markets/reporting-packs');
    const queued = (queue.body?.data ?? []).some((p: { id: string; company: { id: string } }) => p.company.id === 'PC-100' && p.id === period);
    check('pack in staff review queue', queued, queue.body);
    const detail = await dir.get('/api/v1/private-markets/companies/PC-100');
    const uuid = detail.body?.periodDetails?.find((p: { id: string }) => p.id === period)?.uuid;
    const noNote = await dir.post(`/api/v1/private-markets/reporting-packs/${uuid}/return`, {});
    check('return requires a note', noNote.status === 400, noNote.body);
    const acc = await dir.post(`/api/v1/private-markets/reporting-packs/${uuid}/accept`, { note: 'E2E accepted' });
    check('staff accepts pack', acc.status === 200 && acc.body?.period?.status === 'accepted', acc.body);
    const after = await co.get('/api/v1/company/workspace');
    check('company history shows accepted', after.body?.history?.some((h: { id: string; status: string }) => h.id === period && h.status === 'accepted'), after.body?.history);
    const cross = await co.get('/api/v1/investor/bootstrap');
    check('company user cannot open investor API', cross.status === 403 || cross.status === 401, cross.status);
  }

  // ------------------------------------------------------------ RBAC, audit, MFA
  console.log('\nRBAC, audit and MFA');
  const sa = portal('admin');
  check('system admin signs in', (await sa.login(sysadmin.email)).status === 200);
  const accessCtx = await sa.get('/api/v1/admin/access-context');
  check('access-context returns real roles', accessCtx.body?.roles?.includes?.('system_admin') || accessCtx.body?.role === 'system_admin', accessCtx.body);
  const users = await sa.get('/api/v1/admin/users');
  check('user list includes the director', JSON.stringify(users.body).includes(director.email), users.status);
  const lockout = await sa.put(`/api/v1/admin/users/${sysadmin.id}/roles`, { roles: ['client_services'] });
  check('self-lockout blocked', lockout.status === 409 || lockout.status === 400, lockout.body);
  const sod = await sa.get('/api/v1/admin/sod-scan');
  check('SoD scan runs', sod.status === 200 && Array.isArray(sod.body?.findings), sod.body);
  const audit = await sa.get(`/api/v1/admin/audit-events?objectType=kyc_case&objectId=${encodeURIComponent(kase?.id ?? '')}&limit=20`);
  check('audit search finds KYC events', audit.status === 200 && (audit.body?.data?.length ?? 0) >= 2, audit.body);
  const csv = await sa.get('/api/v1/admin/audit-events.csv?limit=5');
  check('audit CSV export', csv.status === 200 && typeof csv.body === 'string' && csv.body.startsWith('Event,') && csv.body.split('\n').length > 2, String(csv.body).slice(0, 80));
  const verify = await sa.get('/api/v1/admin/audit-events/verify');
  check('audit hash chain verifies', verify.body?.brokenAt === null && verify.body?.checked > 0, verify.body);
  const svcRbac = await svc.get('/api/v1/admin/users');
  check('client services cannot manage users (403)', svcRbac.status === 403, svcRbac.status);

  const enroll = await sa.post('/api/auth/mfa/enroll');
  check('MFA enrol returns secret', !!enroll.body?.secret, enroll.body);
  const wrong = await sa.post('/api/auth/mfa/verify', { code: '000000' });
  check('wrong TOTP rejected', wrong.status === 401, wrong.status);
  const ok = await sa.post('/api/auth/mfa/verify', { code: totpNow(enroll.body.secret) });
  check('TOTP verifies', ok.status === 200, ok.body);
  const again = await sa.post('/api/auth/mfa/enroll');
  check('re-enrol blocked once verified', again.status === 409, again.status);
  const sa2 = portal('admin');
  const relogin = await sa2.login(sysadmin.email);
  check('next login asks for the code', relogin.body?.mfa === 'verify', relogin.body);
  const pending = await sa2.get('/api/v1/admin/access-context');
  check('MFA-pending session cannot use the API', pending.status === 401 || pending.status === 403, pending.status);
  await sa2.post('/api/auth/mfa/verify', { code: totpNow(enroll.body.secret) });
  check('verified session works', (await sa2.get('/api/v1/admin/access-context')).status === 200);
} catch (error) {
  failures++;
  console.log('  FAIL  unexpected error', error);
} finally {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } }).catch(() => undefined);
  await prisma.$disconnect();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
