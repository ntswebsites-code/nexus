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

  const flags = await company.get('/api/v1/platform/flags');
  const live = flags.body?.investee?.liveActions as string[] | undefined;
  check('forecast and vault are allowlisted', Array.isArray(live) && live.includes('forecast') && live.includes('vault') && live.includes('requests.create'), live);

  const application = await company.get('/api/v1/investee-portal/application');
  check('application summary names the company', application.status === 200 && typeof dataOf(application).businessName === 'string' && dataOf(application).businessName.length > 1, application.body);

  const cap = await company.get('/api/v1/investee-portal/cap-table');
  const holders = dataOf(cap).shareholders as { name: string; pct: number }[];
  check('cap table is read from the register tables', cap.status === 200 && Array.isArray(holders) && holders.length >= 1 && dataOf(cap).derived === false, cap.body);
  const baseline = await company.call('PUT', '/api/v1/investee-portal/cap-table', { shareholders: [{ name: `X ${run}`, type: 'Ordinary', shares: 10 }] });
  check('baseline save is refused once the register has transactions', baseline.status === 409, baseline.body);

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

  await workspaceSection(companyId, docId);

  await prisma.investeeRequisition.deleteMany({ where: { companyId, title: { contains: run } } });
  await prisma.investeeConsent.deleteMany({ where: { companyId, title: { contains: run } } });
  if (docId) await prisma.document.delete({ where: { id: docId } }).catch(() => undefined);
  if (threadId) await prisma.reportingQuestion.deleteMany({ where: { companyId, ref: threadId } });

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

/** WP-5: cap-table transactions with maker-checker, certificates, GL, waterfall, locking, board, signatures, share links, search, KPIs, access. */
async function workspaceSection(companyId: string, docId: string | undefined) {
  const P = '/api/v1/investee-portal';
  const admin = await signIn('company', 'investee_102_admin@uat.matanho.test', null);
  const maker = await signIn('company', 'investee_101_contributor@uat.matanho.test', null);
  const approver = await signIn('company', 'investee_101_approver@uat.matanho.test', null);
  const company101 = (await prisma.portfolioCompany.findUniqueOrThrow({ where: { ref: 'PC-101' } })).id;
  const holder = `Fund ${run}`;
  const klass = `Series ${run} Preferred`;

  // maker-checker on a cap-table issuance
  const sub = await maker.call('POST', `${P}/cap-table/transactions`, { kind: 'ISSUANCE', holder, className: klass, shares: 1000, pricePerShare: 2, effectiveDate: new Date().toISOString().slice(0, 10), note: `issue ${run}` }, key('tx1'));
  const txRef = dataOf(sub).id as string;
  check('issuance is submitted as pending approval', sub.status === 201 && dataOf(sub).status === 'PENDING_APPROVAL' && dataOf(sub).consideration === 2000, sub.body);
  const noRegisterChange = await maker.get(`${P}/cap-table`);
  check('a pending transaction does not change the register', !(dataOf(noRegisterChange).shareholders as { name: string }[]).some((h) => h.name === holder), noRegisterChange.body);
  const selfApprove = await maker.call('POST', `${P}/cap-table/transactions/${txRef}/decide`, { decision: 'APPROVE' }, key('tx1-self'));
  check('a contributor cannot approve', selfApprove.status === 403, selfApprove.body);
  const approved = await approver.call('POST', `${P}/cap-table/transactions/${txRef}/decide`, { decision: 'APPROVE', note: 'ok' }, key('tx1-ok'));
  check('a different approver approves the issuance', approved.status === 200 && dataOf(approved).status === 'APPROVED', approved.body);
  check('approval records the accounting journal or the reason it was skipped', ['PENDING_GL', 'SKIPPED'].includes(dataOf(approved).glStatus), approved.body);
  if (dataOf(approved).glStatus === 'PENDING_GL') {
    const j = await prisma.accJournal.findUnique({ where: { sourceRef: `CAP:${txRef}` }, include: { lines: true } });
    check('the journal is balanced and waits for approval', j?.status === 'PENDING_APPROVAL' && j.totalDebit.equals(j.totalCredit) && j.totalDebit.toNumber() === 2000, j?.status);
  }
  const reg = await approver.get(`${P}/cap-table`);
  check('the register now holds the new shares', (dataOf(reg).shareholders as { name: string; shares: number }[]).some((h) => h.name === holder && h.shares === 1000), reg.body);
  const certs = await approver.get(`${P}/cap-table/certificates`);
  const cert = (dataOf(certs).certificates as { id: string; holder: string; sha256: string }[]).find((x) => x.holder === holder);
  check('a certificate with a SHA-256 was issued', Boolean(cert) && /^[0-9a-f]{64}$/.test(cert?.sha256 ?? ''), certs.body);
  const verify = await approver.get(`${P}/cap-table/certificates/${cert?.id}/verify`);
  check('the stored certificate hashes to the recorded value', verify.status === 200 && dataOf(verify).valid === true, verify.body);
  const dl = await approver.get(`${P}/cap-table/certificates/${cert?.id}/download-url`);
  check('the certificate has a signed download url', typeof dataOf(dl).url === 'string', dl.body);

  const tooMany = await maker.call('POST', `${P}/cap-table/transactions`, { kind: 'TRANSFER', holder: `Buyer ${run}`, fromHolder: holder, className: klass, shares: 5000 }, key('tx-big'));
  check('a transfer above the holding is refused', tooMany.status === 409, tooMany.body);
  const own = await approver.call('POST', `${P}/cap-table/transactions`, { kind: 'TRANSFER', holder: `Buyer ${run}`, fromHolder: holder, className: klass, shares: 400 }, key('tx-own'));
  const ownDecide = await approver.call('POST', `${P}/cap-table/transactions/${dataOf(own).id}/decide`, { decision: 'APPROVE' }, key('tx-own-d'));
  check('the maker cannot approve their own transaction', own.status === 201 && ownDecide.status === 403 && ownDecide.body?.error?.code === 'maker_checker', ownDecide.body);
  const rej = await maker.call('POST', `${P}/cap-table/transactions/${dataOf(own).id}/decide`, { decision: 'REJECT' }, key('tx-own-r'));
  check('a contributor cannot reject either', rej.status === 403, rej.body);

  const terms = await approver.call('PUT', `${P}/cap-table/classes/${(dataOf(reg).classes as { id: string; name: string }[]).find((k) => k.name === klass)?.id}`, { preferenceMultiple: 1, participating: false, seniority: 1 });
  check('class terms are editable by an approver', terms.status === 200, terms.body);
  const wf = await approver.call('POST', `${P}/cap-table/waterfall`, { exitValue: 5_000_000 });
  const wfRows = dataOf(wf).classes as { total: number }[];
  check('waterfall distributes the whole exit value', wf.status === 200 && Math.abs((dataOf(wf).distributed as number) - 5_000_000) < 1, wf.body);
  check('waterfall lists classes and holders', Array.isArray(wfRows) && wfRows.length >= 1 && (dataOf(wf).holders as unknown[]).length >= 1, wf.body);
  const history = await approver.get(`${P}/cap-table?asOf=2000-01-01`);
  check('the register can be read as of an earlier date', history.status === 200 && (dataOf(history).shareholders as unknown[]).length === 0, history.body);

  // forecast month locking
  const future = new Date();
  future.setUTCMonth(future.getUTCMonth() + 6);
  const lockMonth = future.toISOString().slice(0, 7);
  const lock = await admin.call('POST', `${P}/forecast/lock`, { periods: [lockMonth] });
  check('a forecast month can be locked', lock.status === 200 && (dataOf(lock).lockedPeriods as string[]).includes(lockMonth), lock.body);
  const blocked = await admin.call('PUT', `${P}/forecast`, { revenue: { [lockMonth]: 1 } });
  check('a locked month rejects edits', blocked.status === 409 && blocked.body?.error?.code === 'period_locked', blocked.body);
  const unlock = await admin.call('POST', `${P}/forecast/unlock`, { periods: [lockMonth] });
  check('an administrator can unlock it', unlock.status === 200 && !(dataOf(unlock).lockedPeriods as string[]).includes(lockMonth), unlock.body);

  // board calendar, pack, actions
  const at = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const meet = await admin.call('POST', `${P}/governance/meetings`, { title: `Board ${run}`, meetingAt: at, location: 'Boardroom', agenda: 'Budget' }, key('meet'));
  const meetingId = (dataOf(meet).meetings as { id: string; title: string }[]).find((m) => m.title === `Board ${run}`)?.id ?? '';
  check('a board meeting is scheduled', meet.status === 201 && Boolean(meetingId), meet.body);
  const gov = await admin.get(`${P}/governance`);
  check('the calendar shows the meeting', (dataOf(gov).calendar as { title: string; kind: string }[]).some((e) => e.title === `Board ${run}` && e.kind === 'board'), gov.body);
  const emptyPublish = await admin.call('POST', `${P}/governance/meetings/${meetingId}/publish`, undefined, key('pub0'));
  check('an empty pack cannot be published', emptyPublish.status === 400, emptyPublish.body);
  const added = await admin.call('POST', `${P}/governance/meetings/${meetingId}/pack`, { documentId: docId });
  check('a vault document joins the pack', added.status === 200, added.body);
  const published = await admin.call('POST', `${P}/governance/meetings/${meetingId}/publish`, undefined, key('pub1'));
  const pm = (dataOf(published).meetings as { id: string; packStatus: string; packSha256: string }[]).find((m) => m.id === meetingId);
  check('publishing freezes the pack with a hash', published.status === 200 && pm?.packStatus === 'PUBLISHED' && /^[0-9a-f]{64}$/.test(pm?.packSha256 ?? ''), published.body);
  const frozen = await admin.call('POST', `${P}/governance/meetings/${meetingId}/pack`, { documentId: docId });
  check('a published pack is frozen', frozen.status === 409, frozen.body);
  const act = await admin.call('POST', `${P}/governance/actions`, { title: `Action ${run}`, owner: 'CFO', meetingId }, key('act'));
  const actionId = (dataOf(act).actions as { id: string; title: string }[]).find((a) => a.title === `Action ${run}`)?.id;
  const done = await admin.call('PATCH', `${P}/governance/actions/${actionId}`, { status: 'COMPLETE', evidence: 'minutes' });
  check('a board action is created and completed', act.status === 201 && done.status === 200 && (dataOf(done).actions as { id: string; status: string }[]).some((a) => a.id === actionId && a.status === 'Complete'), done.body);

  // company-initiated signature requests and public signing
  const emails = [`a-${run}@signers.test`, `b-${run}@signers.test`];
  const sig = await admin.call('POST', `${P}/signature-requests`, { documentId: docId, title: `NDA ${run}`, signers: [{ name: 'Ada', email: emails[0] }, { name: 'Ben', email: emails[1] }], expiresInDays: 7 }, key('sig'));
  check('a signature request is sent to two signers', sig.status === 201 && dataOf(sig).status === 'PENDING' && dataOf(sig).signers.length === 2, sig.body);
  const tokenFor = async (email: string) => {
    const rows = await prisma.outboxEvent.findMany({ where: { type: 'email.send' }, orderBy: { createdAt: 'desc' }, take: 60 });
    const row = rows.find((r) => (r.payload as { to?: string }).to === email);
    return /\/sign\/([\w-]+)/.exec((row?.payload as { text?: string } | undefined)?.text ?? '')?.[1] ?? '';
  };
  const pub = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}/api/v1/investee-public${path}`, { method, headers: { Origin: config.portalUrls.company, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() } as Res;
  };
  const t0 = await tokenFor(emails[0]!);
  const t1 = await tokenFor(emails[1]!);
  check('each signer has a link', t0.length > 20 && t1.length > 20 && t0 !== t1, [t0.length, t1.length]);
  const info = await pub('GET', `/sign/${t0}`);
  check('the signer page shows the request without a session', info.status === 200 && dataOf(info).title === `NDA ${run}` && dataOf(info).signerName === 'Ada', info.body);
  const noConsent = await pub('POST', `/sign/${t0}`, { action: 'SIGN', name: 'Ada Lovelace' });
  check('signing needs explicit consent', noConsent.status === 400, noConsent.body);
  const s0 = await pub('POST', `/sign/${t0}`, { action: 'SIGN', name: 'Ada Lovelace', consent: true });
  check('the first signer signs', s0.status === 200 && dataOf(s0).status === 'PENDING' && /^[0-9a-f]{64}$/.test(dataOf(s0).evidenceSha), s0.body);
  const twice = await pub('POST', `/sign/${t0}`, { action: 'SIGN', name: 'Ada Lovelace', consent: true });
  check('a signer cannot sign twice', twice.status === 409, twice.body);
  const s1 = await pub('POST', `/sign/${t1}`, { action: 'SIGN', name: 'Ben Okoye', consent: true });
  check('the last signature completes the request', s1.status === 200 && dataOf(s1).status === 'COMPLETED', s1.body);

  const second = await admin.call('POST', `${P}/signature-requests`, { documentId: docId, title: `MSA ${run}`, signers: [{ name: 'Cy', email: `c-${run}@signers.test` }] }, key('sig2'));
  const oldToken = await tokenFor(`c-${run}@signers.test`);
  const remind = await admin.call('POST', `${P}/signature-requests/${dataOf(second).id}/remind`, undefined, key('rem'));
  check('a reminder is sent', remind.status === 200 && dataOf(remind).reminderCount === 1, remind.body);
  const again = await admin.call('POST', `${P}/signature-requests/${dataOf(second).id}/remind`, undefined, key('rem2'));
  check('reminders are rate limited', again.status === 409, again.body);
  const stale = await pub('GET', `/sign/${oldToken}`);
  check('the earlier link stops working after a reminder', stale.status === 404, stale.body);
  const voided = await admin.call('POST', `${P}/signature-requests/${dataOf(second).id}/void`, { reason: 'Sent in error' }, key('void'));
  check('a request can be voided', voided.status === 200 && dataOf(voided).status === 'VOIDED', voided.body);
  const newToken = await tokenFor(`c-${run}@signers.test`);
  const afterVoid = await pub('GET', `/sign/${newToken}`);
  check('a voided request cannot be signed', afterVoid.status === 404 || dataOf(afterVoid).requestStatus === 'VOIDED', afterVoid.body);

  // share links
  const share = await admin.call('POST', `${P}/share-links`, { documentId: docId, recipient: `Auditor ${run}`, expiresInDays: 7 }, key('share'));
  const fileUrl = dataOf(share).url as string;
  check('a share link is issued once', share.status === 201 && typeof fileUrl === 'string' && fileUrl.includes('/investee-public/share/'), share.body);
  const tooLong = await admin.call('POST', `${P}/share-links`, { documentId: docId, recipient: 'Someone', expiresInDays: 30 }, key('share-long'));
  check('a link longer than 7 days is refused', tooLong.status === 400, tooLong.body);
  const viewed = await fetch(fileUrl);
  const viewedText = await viewed.text();
  check('the link serves a watermarked file without a session', viewed.status === 200 && viewedText.includes(`Shared with Auditor ${run}`), viewedText.slice(0, 120));
  const links = await admin.get(`${P}/share-links`);
  check('the access is counted', (dataOf(links).links as { id: string; accessCount: number }[]).some((l) => l.id === dataOf(share).id && l.accessCount === 1), links.body);
  const revoke = await admin.call('DELETE', `${P}/share-links/${dataOf(share).id}`);
  const gone = await fetch(fileUrl);
  check('a revoked link answers 410', revoke.status === 200 && gone.status === 410, gone.status);

  // search, KPIs, access
  const found = await admin.get(`${P}/search?q=${encodeURIComponent(run)}`);
  const types = new Set((dataOf(found).hits as { type: string }[]).map((h) => h.type));
  check('search finds records across the workspace', found.status === 200 && types.has('document') && types.has('meeting') && types.has('signature') && types.has('requisition'), [...types]);
  const short = await admin.get(`${P}/search?q=a`);
  check('search needs two characters', short.status === 400, short.body);
  const kh = await admin.get(`${P}/kpis/history`);
  check('derived KPI history answers', kh.status === 200 && Array.isArray(dataOf(kh).rows), kh.body);
  const csv = await admin.send('GET', `${P}/kpis/export?format=csv`);
  check('KPI history exports as CSV', csv.status === 200 && String(csv.body).startsWith('period,status,revenue'), String(csv.body).slice(0, 80));
  const xlsx = await admin.send('GET', `${P}/kpis/export?format=xlsx`);
  check('KPI history exports as xlsx', xlsx.status === 200 && Buffer.isBuffer(xlsx.body) && xlsx.body.subarray(0, 2).toString() === 'PK', xlsx.status);
  const access = await admin.get(`${P}/access`);
  check('access view shows MFA coverage', access.status === 200 && typeof dataOf(access).coverage?.pct === 'number' && (dataOf(access).members as unknown[]).length >= 1, access.body);
  const members = dataOf(access).members as { userId: string; status: string }[];
  const review = await admin.call('POST', `${P}/access/reviews`, { decisions: members.filter((m) => m.status === 'active').map((m) => ({ userId: m.userId, decision: 'CERTIFIED' })), note: `review ${run}` }, key('review'));
  check('an access review is recorded', review.status === 201 && dataOf(review).lastReview !== null, review.body);

  // old settings JSON is moved into tables on first use
  const ownSettings = await prisma.setting.count({ where: { ownerId: companyId, key: { in: ['workspace.cap', 'workspace.governance'] } } });
  if (ownSettings === 0) {
    await prisma.setting.upsert({
      where: { ownerId_key: { ownerId: companyId, key: 'workspace.requests' } },
      create: { ownerId: companyId, key: 'workspace.requests', value: { requisitions: [{ id: `REQ-L${run}`, title: `Legacy ${run}`, description: '', status: 'SUBMITTED', priority: 'Low', sourcingCategory: 'Capital request: Growth capital', currency: 'USD', estimatedAmount: 5, needBy: '', createdByName: 'Old', createdAt: new Date().toISOString(), note: '' }] } },
      update: { value: { requisitions: [{ id: `REQ-L${run}`, title: `Legacy ${run}`, description: '', status: 'SUBMITTED', priority: 'Low', sourcingCategory: 'Capital request: Growth capital', currency: 'USD', estimatedAmount: 5, needBy: '', createdByName: 'Old', createdAt: new Date().toISOString(), note: '' }] } },
    });
    await prisma.investeeWorkspace.update({ where: { companyId }, data: { legacyMigratedAt: null } });
    const moved = await admin.get(`${P}/procurement`);
    check('legacy settings rows are moved into the requisition table', (dataOf(moved).requisitions as { id: string }[]).some((r) => r.id === `REQ-L${run}`), moved.body);
    await prisma.investeeRequisition.deleteMany({ where: { ref: `REQ-L${run}` } });
    await prisma.setting.deleteMany({ where: { ownerId: companyId, key: 'workspace.requests' } });
  } else {
    console.log('  SKIP  legacy move (company still has old cap/governance settings that would be copied twice)');
  }

  // cleanup of what this run created
  await prisma.investeeSignRequest.deleteMany({ where: { companyId, title: { contains: run } } });
  await prisma.investeeShareLink.deleteMany({ where: { companyId, recipient: { contains: run } } });
  await prisma.investeeBoardMeeting.deleteMany({ where: { companyId, title: { contains: run } } });
  await prisma.investeeBoardAction.deleteMany({ where: { companyId, title: { contains: run } } });
  const mine = await prisma.investeeShareholder.findMany({ where: { companyId: company101, name: { contains: run } }, select: { id: true } });
  await prisma.investeeCertificate.deleteMany({ where: { companyId: company101, holderId: { in: mine.map((h) => h.id) } } });
  await prisma.investeeCapTx.deleteMany({ where: { companyId: company101, note: { contains: run } } });
  await prisma.investeeCapTx.deleteMany({ where: { companyId: company101, holderId: { in: mine.map((h) => h.id) } } });
  await prisma.investeeShareholder.deleteMany({ where: { companyId: company101, name: { contains: run } } });
  await prisma.investeeShareClass.deleteMany({ where: { companyId: company101, name: { contains: run } } });
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
