/**
 * Local checks for the flows that were still unfinished: bank-instruction verification,
 * invitation grants, investee templates and team invites, spreadsheet export, custodian
 * enrolment grant, revenue variance, and the fixed holiday calendar.
 *
 *   E2E_CONFIRM=local npx tsx --env-file-if-exists=../../.env scripts/test-local-gaps.ts
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { decryptField } from '../src/lib/crypto';
import { totpNow } from '../src/lib/totp';
import { nextDealingDate } from '../src/modules/lp-portal/services/dealing';
import { submitPack, type PackActor } from '../src/modules/company/company.service';
import { HttpError } from '../src/lib/errors';

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

type Res = { status: number; body: any; headers: Headers };
const users = JSON.parse(readFileSync(new URL('../../../secrets/uat-users.json', import.meta.url), 'utf8')) as { email: string; password: string }[];
const pw = (email: string) => users.find((u) => u.email === email)?.password ?? '';

function client(portal: 'investor' | 'admin' | 'company' | 'custodian') {
  const origin = config.portalUrls[portal];
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, init: { body?: string | FormData; headers?: Record<string, string> } = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...(init.headers ?? {}) };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, { method, headers: h, body: init.body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const once = () =>
      send(method, path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      });
    let res = await once();
    for (let i = 0; i < 8 && res.status === 409 && String(res.body?.error?.code ?? res.body?.code ?? '').includes('in_progress'); i++) {
      await new Promise((r) => setTimeout(r, 200));
      res = await once();
    }
    return res;
  };
  return { call, get: (path: string) => call('GET', path) };
}

async function codeFor(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { mfaFactors: { where: { verifiedAt: { not: null } } } } });
  const secret = decryptField(user.mfaFactors[0]?.secretEnc ?? null);
  if (!secret) throw new Error(`no TOTP for ${email}`);
  return totpNow(secret);
}

async function signIn(portal: 'investor' | 'admin' | 'company' | 'custodian', email: string, loginPortal: string | null = portal) {
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

async function stepUp(c: Awaited<ReturnType<typeof signIn>>, email: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { mfaFactors: { where: { verifiedAt: { not: null } } } } });
  if (!user?.mfaFactors.length) return;
  const res = await c.call('POST', '/api/auth/mfa/step-up', { code: await codeFor(email) });
  check(`${email} step-up`, res.status === 200, res.body);
}

const key = (s: string) => ({ 'Idempotency-Key': `gap-${run}-${s}` });

function tokenFrom(text: string) {
  const m = /token=([^&\s]+)/.exec(text);
  return m ? decodeURIComponent(m[1]!) : '';
}

async function latestInviteToken(email: string) {
  const row = await prisma.outboxEvent.findFirst({
    where: { type: 'email.send' },
    orderBy: { id: 'desc' },
  });
  const payload = row?.payload as { to?: string; text?: string } | null;
  if (payload?.to !== email) return '';
  return tokenFrom(payload.text ?? '');
}

async function main() {
  const holiday = nextDealingDate(new Date(Date.UTC(2026, 0, 1)), 'DAILY');
  check('1 Jan 2026 (holiday, Thursday) is not a dealing day', holiday.toISOString().slice(0, 10) === '2026-01-02', holiday.toISOString());

  const signatory = 'lp_a_signatory@uat.matanho.test';
  const services = 'client_services@uat.matanho.test';
  const compliance = 'compliance@uat.matanho.test';
  const manager = 'lp_a_manager@uat.matanho.test';
  const investee = 'investee_102_admin@uat.matanho.test';
  const ops = 'operations@uat.matanho.test';

  const lp = await signIn('investor', signatory);
  await stepUp(lp, signatory);
  const bank = await lp.call(
    'POST',
    '/api/v1/lp-portal/bank-instructions/changes',
    { bankName: 'Gap Test Bank', accountName: 'LP A', accountNumber: `GAP${run}99`, currency: 'USD' },
    key('bank'),
  );
  check('LP submits a bank change', bank.status === 201 && bank.body?.data?.status === 'PENDING_VERIFICATION', bank.body);

  const cs = await signIn('admin', services);
  const list = await cs.get('/api/v1/ops/bank-instructions?status=Pending%20verification');
  const pendingId = bank.body?.data?.id as string;
  check('staff can list the pending instruction', (list.body?.data ?? []).some((r: { id: string }) => r.id === pendingId), list.status);

  await stepUp(cs, services);
  const verified = await cs.call('POST', `/api/v1/ops/bank-instructions/${pendingId}/verify`, { callbackNote: 'Called the number on file and confirmed the account.' }, key('verify'));
  check('client services records the call-back', verified.status === 200 && verified.body?.data?.status === 'Under verification', verified.body);

  const selfApprove = await cs.call('POST', `/api/v1/ops/bank-instructions/${pendingId}/approve`, {}, key('self'));
  check('the verifier cannot activate it', selfApprove.status === 403, selfApprove.body);

  const co = await signIn('admin', compliance);
  await stepUp(co, compliance);
  const approved = await co.call('POST', `/api/v1/ops/bank-instructions/${pendingId}/approve`, {}, key('approve'));
  check('compliance activates the instruction', approved.status === 200 && approved.body?.data?.status === 'Active', approved.body);

  const mgr = await signIn('investor', manager);
  const managerLink = await prisma.clientUser.findFirst({ where: { user: { email: manager }, revokedAt: null } });
  const commitment = managerLink ? await prisma.fundCommitment.findFirst({ where: { clientId: managerLink.clientId, status: 'ACTIVE' } }) : null;
  const fundId = commitment?.fundId;
  const colleagueEmail = `gap-${run}@uat.matanho.test`;
  await stepUp(mgr, manager);
  const invite = await mgr.call(
    'POST',
    '/api/v1/lp-portal/colleagues',
    { email: colleagueEmail, name: 'Gap Colleague', role: 'VIEWER', ...(fundId ? { fundIds: [fundId] } : {}) },
    key('invite'),
  );
  check('manager invites a colleague', invite.status === 201, invite.body);
  const token = await latestInviteToken(colleagueEmail);
  check('invitation email carries a token', token.length > 10);
  const accepted = await client('investor').call('POST', '/api/auth/invitations/accept', { token, name: 'Gap Colleague', password: `Gap-${run}-Passw0rd` });
  check('colleague accepts', accepted.status === 200, accepted.body);
  const membership = await prisma.clientUser.findFirst({
    where: { user: { email: colleagueEmail } },
  });
  check('accepted membership has the LP role', membership?.lpRole === 'VIEWER' && !membership.revokedAt, membership);
  if (fundId) check('accepted membership keeps the fund scope', JSON.stringify(membership?.fundIds) === JSON.stringify([fundId]), membership?.fundIds);

  const company = await signIn('company', investee, null);
  const template = await company.get('/api/v1/investee-portal/financial-reports/template/INCOME_STATEMENT');
  const bytes = template.body as Buffer;
  check('income statement template is an xlsx file', template.status === 200 && bytes[0] === 0x50 && bytes[1] === 0x4b, template.status);

  const teamEmail = `gap-team-${run}@uat.matanho.test`;
  const team = await company.call('POST', '/api/v1/investee-portal/team', { email: teamEmail, name: 'Gap Analyst', profile: 'Report contributor', title: 'Analyst' }, key('team'));
  check('company admin invites a teammate', team.status === 201, team.body);
  const teamToken = await latestInviteToken(teamEmail);
  const teamAccept = await client('company').call('POST', '/api/auth/invitations/accept', { token: teamToken, name: 'Gap Analyst', password: `Gap-${run}-Passw0rd` });
  check('teammate accepts', teamAccept.status === 200, teamAccept.body);
  const link = await prisma.companyUser.findFirst({ where: { user: { email: teamEmail } }, include: { company: { select: { ref: true } } } });
  check('teammate profile is report contributor', link?.profile === 'report_contributor' && link.title === 'Analyst', link);

  const viewerExport = await signIn('investor', 'lp_a_viewer@uat.matanho.test');
  const sheet = await viewerExport.get('/api/v1/lp-portal/account-activity/export?format=xlsx');
  const xlsx = sheet.body as Buffer;
  check('activity export xlsx', sheet.status === 200 && xlsx[0] === 0x50 && xlsx[1] === 0x4b, sheet.status);

  const operations = await signIn('admin', ops);
  const parties = await operations.get('/api/v1/ops/custodian/counterparties');
  const counterpartyId = parties.body?.items?.[0]?.id as string | undefined;
  check('operations can list counterparties', !!counterpartyId, parties.body);
  const cpEmail = `gap-cp-${run}@uat.matanho.test`;
  const cpInvite = await operations.call('POST', '/api/v1/ops/custodian/users', { counterpartyId, email: cpEmail, name: 'Gap Custodian', role: 'submitter' }, key('cp'));
  check('operations invites a custodian user', cpInvite.status === 201, cpInvite.body);
  const cpToken = await latestInviteToken(cpEmail);
  const cpAccept = await client('custodian').call('POST', '/api/auth/invitations/accept', { token: cpToken, name: 'Gap Custodian', password: `Gap-${run}-Passw0rd` });
  check('custodian user accepts', cpAccept.status === 200, cpAccept.body);
  const cpUser = await prisma.user.findUnique({ where: { email: cpEmail }, select: { id: true } });
  const cpLink = cpUser ? await prisma.counterpartyUser.findFirst({ where: { userId: cpUser.id } }) : null;
  check('custodian user is linked as submitter', cpLink?.role === 'submitter' && cpLink.status === 'active', cpLink);

  const companyRow = await prisma.companyUser.findFirst({ where: { user: { email: investee }, status: 'active' }, include: { company: true } });
  if (companyRow) {
    const prior = `2098-${run.slice(0, 2)}`;
    const current = `2099-${run.slice(0, 2)}`;
    const due = new Date('2099-12-31');
    await prisma.reportingPeriod.create({ data: { companyId: companyRow.companyId, period: prior, label: prior, dueDate: due, status: 'submitted', kpiValues: { totalRevenue: 1000 } } });
    await prisma.reportingPeriod.create({ data: { companyId: companyRow.companyId, period: current, label: current, dueDate: due, status: 'open', kpiValues: { totalRevenue: 100 } } });
    const actor: PackActor = { userId: companyRow.userId, name: 'Gap', audit: { actorId: companyRow.userId, portal: 'company', ip: '127.0.0.1', requestId: `gap-${run}` } };
    const period = await prisma.reportingPeriod.findUniqueOrThrow({ where: { companyId_period: { companyId: companyRow.companyId, period: current } }, include: { items: { include: { submissions: true } } } });
    let blocked = false;
    try {
      await submitPack(actor, companyRow.company, period, {});
    } catch (err) {
      blocked = err instanceof HttpError && err.status === 400 && /50%/.test(err.message);
    }
    check('revenue drop without a note is blocked', blocked);
    await submitPack(actor, companyRow.company, period, { notes: 'Revenue fell because the largest customer paused orders this period.' });
    const after = await prisma.reportingPeriod.findUnique({ where: { companyId_period: { companyId: companyRow.companyId, period: current } } });
    check('the same pack submits once a variance note is present', after?.status === 'submitted');
    await prisma.reportingPeriod.deleteMany({ where: { companyId: companyRow.companyId, period: { in: [prior, current] } } });
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
