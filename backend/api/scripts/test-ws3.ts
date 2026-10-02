/**
 * WS3 checks against a RUNNING API: Investee contract shapes (zod), J5 reporting loop, J6 term
 * sheets (maker/checker, step-up, idempotency, e-signature evidence), company scoping (IDOR) and
 * access-profile negatives.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4153 npx tsx scripts/test-ws3.ts
 *
 * Creates two throwaway companies, company users and staff users (removed at the end).
 */
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import {
  dashboardSchema,
  envelopeSchema,
  errorEnvelopeSchema,
  financialReportDetailSchema,
  financialReportPageSchema,
  kpiRegisterSchema,
  letterheadSchema,
  livePayloadSchema,
  profileSchema,
  companySchema,
  reportingRequestSchema,
  settingsSchema,
  signResultSchema,
  teamMemberSchema,
  termSheetListSchema,
  termSheetSchema,
  threadSchema,
  draftResultSchema,
  uploadResultSchema,
  updateCompanyResultSchema,
} from '../src/modules/investee-portal/investee.contract';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ws3-${randomBytes(9).toString('base64url')}`;
const PERIOD = '2026-09';
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};

/** Parses an API body with a contract schema and reports the first issues on failure. */
function shape<T extends z.ZodTypeAny>(name: string, schema: T, body: unknown) {
  const r = schema.safeParse(body);
  check(`contract: ${name}`, r.success, r.success ? undefined : r.error.issues.slice(0, 4));
  return r.success ? (r.data as z.infer<T>) : (body as z.infer<T>);
}

type Res = { status: number; body: any; headers: Headers };

function portal(name: 'company' | 'admin') {
  const origin = config.portalUrls[name];
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res> => {
    const headers: Record<string, string> = { Origin: origin, 'User-Agent': `ws3-test/${run}`, ...extra };
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
      const value = pair!.slice(pair!.indexOf('=') + 1);
      cookie = /max-age=0|expires=thu, 01 jan 1970/i.test(c) || value === '' ? '' : pair!;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return {
    call,
    get: (p: string) => call('GET', p),
    post: (p: string, b: unknown = {}, h?: Record<string, string>) => call('POST', p, b, h),
    put: (p: string, b: unknown = {}, h?: Record<string, string>) => call('PUT', p, b, h),
    login: (email: string) => call('POST', '/api/auth/login', { email, password, ...(name === 'company' ? {} : { portal: name }) }),
  };
}
type Client = ReturnType<typeof portal>;

const userIds: string[] = [];
const companyIds: string[] = [];

async function makeUser(label: string, roles: string[] = []) {
  const bcrypt = (await import('bcryptjs')).default;
  const user = await prisma.user.create({
    data: { email: `ws3-${run}-${label}@example.test`, name: `WS3 ${label}`, passwordHash: await bcrypt.hash(password, 4) },
  });
  userIds.push(user.id);
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key } } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

async function makeCompany(suffix: string) {
  const c = await prisma.portfolioCompany.create({
    data: {
      ref: `W3${suffix}${run}`.toUpperCase(),
      name: `WS3 Co ${suffix} ${run}`,
      legalName: `WS3 Company ${suffix} (Pvt) Ltd`,
      ticker: `W3${suffix}`,
      sector: 'Fintech',
      country: 'Zimbabwe',
      relationship: { fund: 'Matanho Growth Fund I', ownership: '18%', invested: 2500000 },
      contacts: [{ name: `CFO ${suffix}`, role: 'CFO', email: `cfo-${suffix}@example.test`, phone: '+263 77 000 0000' }],
    },
  });
  companyIds.push(c.id);
  return c;
}

async function companyMember(label: string, companyId: string, profile: string, signingAuthority?: unknown) {
  const user = await makeUser(label);
  await prisma.companyUser.create({
    data: { companyId, userId: user.id, profile, title: label, ...(signingAuthority !== undefined ? { signingAuthority: signingAuthority as object } : {}) },
  });
  const client = portal('company');
  const res = await client.login(user.email);
  check(`${label} signs in`, res.status === 200, res.body);
  return { user, client };
}

async function staff(label: string, roles: string[]) {
  const user = await makeUser(label, roles);
  const client = portal('admin');
  const res = await client.login(user.email);
  check(`${label} signs in`, res.status === 200, res.body);
  return { user, client };
}

async function enrolMfa(c: Client) {
  const enrol = await c.post('/api/auth/mfa/enroll');
  const verify = await c.post('/api/auth/mfa/verify', { code: totpNow(enrol.body?.secret ?? '') });
  check('MFA enrolled and verified', enrol.status === 200 && verify.status === 200, { enrol: enrol.status, verify: verify.body });
}

const file = (field: string, name: string, mime: string) => {
  const f = new FormData();
  f.append(field, new Blob([mime === 'application/pdf' ? `%PDF-1.4\n% ${name}\n%%EOF\n` : 'metric,value\nrevenue,100\n'], { type: mime }), name);
  return f;
};
const key = (label: string) => ({ 'Idempotency-Key': `ws3-${run}-${label}` });
const IP = '/api/v1/investee-portal';

async function main() {
  console.log(`API ${API} · run ${run}`);
  const A = await makeCompany('A');
  const B = await makeCompany('B');

  const admin = await companyMember('a-admin', A.id, 'workspace_administrator', true);
  const approver = await companyMember('a-approver', A.id, 'executive_approver', { label: 'Director, by board resolution' });
  const approverNoAuth = await companyMember('a-approver-noauth', A.id, 'executive_approver');
  const contrib = await companyMember('a-contrib', A.id, 'report_contributor');
  const viewer = await companyMember('a-viewer', A.id, 'read_only');
  const other = await companyMember('b-admin', B.id, 'workspace_administrator', true);
  const pm = await staff('pm', ['portfolio_manager']);
  const director = await staff('director', ['investment_director']);
  const dual = await staff('dual', ['portfolio_manager', 'investment_director']);

  // ------------------------------------------------------------ access
  console.log('\nAccess');
  const staffOnInvestee = await pm.client.get(`${IP}/profile`);
  check('staff user on investee portal -> 403 no_company_access', staffOnInvestee.status === 403 && staffOnInvestee.body?.code === 'no_company_access', staffOnInvestee.body);
  shape('error envelope', errorEnvelopeSchema, staffOnInvestee.body);
  const companyOnOps = await admin.client.get('/api/v1/ops/term-sheets');
  check('company user on ops -> 403', companyOnOps.status === 403, companyOnOps.status);
  const notBuilt = await admin.client.get(`${IP}/procurement/drawdown`);
  check('unbuilt endpoint -> 501 not_implemented', notBuilt.status === 501 && notBuilt.body?.code === 'not_implemented', notBuilt.body);

  // ------------------------------------------------------------ contract shapes
  console.log('\nContract shapes');
  const profile = shape('GET /profile', envelopeSchema(profileSchema), (await approver.client.get(`${IP}/profile`)).body);
  check('profile is scoped to company A', profile.data?.company?.id === A.ref && profile.data?.accessProfile === 'executive_approver', profile.data);
  check('approver has signing authority text', profile.data?.signingAuthority === 'Director, by board resolution', profile.data);
  shape('GET /company', envelopeSchema(companySchema), (await admin.client.get(`${IP}/company`)).body);
  shape('GET /letterhead', envelopeSchema(letterheadSchema), (await admin.client.get(`${IP}/letterhead`)).body);
  shape('GET /dashboard', envelopeSchema(dashboardSchema), (await admin.client.get(`${IP}/dashboard`)).body);
  shape('GET /kpis', envelopeSchema(kpiRegisterSchema), (await admin.client.get(`${IP}/kpis`)).body);
  shape('GET /settings', envelopeSchema(settingsSchema), (await admin.client.get(`${IP}/settings`)).body);
  const team = shape('GET /team', envelopeSchema(teamMemberSchema.array()), (await admin.client.get(`${IP}/team`)).body);
  check('team lists only company A members', team.data?.length === 5 && team.data.some((m) => m.isYou), team.data?.length);
  const teamWrite = await admin.client.post(
    `${IP}/team`,
    { email: `ws3-${run}-invite@example.test`, name: 'WS3 Invite', profile: 'Report contributor' },
    { 'Idempotency-Key': `ws3-${run}-team` },
  );
  check('team invite is accepted', teamWrite.status === 201, teamWrite.body);
  shape('GET /term-sheets/my (empty)', envelopeSchema(termSheetListSchema), (await admin.client.get(`${IP}/term-sheets/my`)).body);

  // ------------------------------------------------------------ company + letterhead
  console.log('\nCompany profile and letterhead');
  const coBefore = (await admin.client.get(`${IP}/company`)).body.data;
  const coUpd = await admin.client.put(`${IP}/company`, { industry: 'Payments', website: 'https://a.example.test', contactPerson: 'New CFO', description: 'We move money.', version: coBefore.version });
  shape('PUT /company', envelopeSchema(updateCompanyResultSchema), coUpd.body);
  const coAfter = (await admin.client.get(`${IP}/company`)).body.data;
  check('whitelisted company fields saved', coAfter.industry === 'Payments' && coAfter.contactPerson === 'New CFO' && coAfter.description === 'We move money.', coAfter);
  const massAssign = await admin.client.put(`${IP}/company`, { status: 'Exited' });
  check('non-whitelisted field rejected (400)', massAssign.status === 400, massAssign.body);
  const rename = await admin.client.put(`${IP}/company`, { name: 'Hijacked' });
  check('company rename rejected (400)', rename.status === 400, rename.body);
  const contribCo = await contrib.client.put(`${IP}/company`, { industry: 'X' });
  check('contributor cannot update company (403)', contribCo.status === 403 && contribCo.body?.code === 'permission_denied', contribCo.body);
  const lh = { legalName: 'WS3 Company A (Pvt) Ltd', line1: '1 Samora Machel Ave', city: 'Harare', country: 'Zimbabwe', email: 'info@a.example.test' };
  const lhPut = await admin.client.put(`${IP}/letterhead`, lh);
  check('admin saves letterhead', lhPut.status === 200 && lhPut.body?.data?.line1 === lh.line1, lhPut.body);
  const lhAlias = await admin.client.get(`${IP}/portfolio-companies/${A.ref}/letterhead`);
  check('NVCCZ letterhead alias works for own company', lhAlias.status === 200 && lhAlias.body?.data?.city === 'Harare', lhAlias.body);
  const lhContrib = await contrib.client.put(`${IP}/letterhead`, lh);
  check('contributor cannot change letterhead (403)', lhContrib.status === 403, lhContrib.status);

  // ------------------------------------------------------------ J5 reporting loop
  console.log('\nJ5 reporting loop');
  const opened = await pm.client.post(`/api/v1/private-markets/companies/${A.ref}/periods`, { period: PERIOD, due: '2026-10-20' });
  check('staff opens reporting period', opened.status === 201, opened.body);
  const periodId: string = opened.body?.period?.uuid;
  const schedule = shape('GET /reporting/requests', envelopeSchema(reportingRequestSchema.array()), (await contrib.client.get(`${IP}/reporting/requests`)).body);
  const req0 = schedule.data?.find((r) => r.reportingPeriod === PERIOD);
  check('investee sees open request', req0?.status === 'OPEN' && req0.portalStatus === 'REPORTING_OPEN' && req0.canEdit && !req0.canSubmit, req0);
  const ids = Object.fromEntries((req0?.mandatoryAttachments ?? []).map((m) => [m.key, m.reportId]));

  const draft = await contrib.client.post(`${IP}/financial-reports/income-statement/draft`, {
    reportingPeriod: `${PERIOD}-01`,
    title: 'Income statement',
    data: { totalRevenue: '1250000', netProfit: 180000, otherIncome: '' },
  });
  shape('POST /financial-reports/income-statement/draft', envelopeSchema(draftResultSchema), draft.body);
  const badDraft = await contrib.client.post(`${IP}/financial-reports/income-statement/draft`, { reportingPeriod: PERIOD, title: 'x', data: { totalRevenue: 'lots' } });
  check('non-numeric KPI rejected with the standard message', badDraft.status === 400 && /numerical value/.test(badDraft.body?.message ?? ''), badDraft.body);
  const noPeriod = await contrib.client.post(`${IP}/financial-reports/cash-flow/draft`, { reportingPeriod: '2025-01', title: 'x', data: {} });
  check('draft for a period with no request -> 404', noPeriod.status === 404, noPeriod.body);
  const unbalanced = await contrib.client.post(`${IP}/financial-reports/balance-sheet/draft`, {
    reportingPeriod: PERIOD,
    title: 'BS',
    data: { totalAssets: 100, totalLiabilities: 40, totalEquity: 50 },
  });
  check('unbalanced balance sheet rejected (400)', unbalanced.status === 400, unbalanced.body);

  const uploads: [string, string, string][] = [
    ['accounts', 'accounts.pdf', 'application/pdf'],
    ['kpis', 'kpis.csv', 'text/csv'],
    ['debt', 'debt.pdf', 'application/pdf'],
  ];
  for (const [slot, name, mime] of uploads) {
    const up = await contrib.client.post(`${IP}/financial-reports/${ids[slot]}/file`, file('file', name, mime));
    if (slot === 'accounts') shape('POST /financial-reports/:id/file', envelopeSchema(uploadResultSchema), up.body);
    check(`contributor uploads ${slot}`, up.status === 201, up.body);
  }
  const viewerUpload = await viewer.client.post(`${IP}/financial-reports/${ids.compliance}/file`, file('file', 'c.pdf', 'application/pdf'));
  check('viewer cannot upload (403)', viewerUpload.status === 403, viewerUpload.status);
  await contrib.client.post(`${IP}/financial-reports/${ids.compliance}/file`, file('file', 'compliance.pdf', 'application/pdf'));

  const reports = shape('GET /financial-reports', envelopeSchema(financialReportPageSchema), (await contrib.client.get(`${IP}/financial-reports?reportingPeriod=${PERIOD}`)).body);
  check('five reports for the period, all DRAFT', reports.data?.total === 5 && reports.data.items.every((r) => r.status === 'DRAFT'), reports.data?.items?.map((r) => r.status));
  const detail = shape('GET /financial-reports/:id', envelopeSchema(financialReportDetailSchema), (await contrib.client.get(`${IP}/financial-reports/${ids.accounts}`)).body);
  check('accounts report carries draft numbers', detail.data?.data?.['IS.totalRevenue'] === 1250000 && detail.data?.data?.['IS.otherIncome'] === 0, detail.data?.data);

  const viewerSubmit = await viewer.client.post(`${IP}/reporting/requests/${PERIOD}/submit`, {});
  check('viewer cannot submit (403 permission_denied)', viewerSubmit.status === 403 && viewerSubmit.body?.code === 'permission_denied', viewerSubmit.body);
  const contribSubmit = await contrib.client.post(`${IP}/financial-reports/submit/${ids.accounts}`, {});
  check('contributor cannot submit (403)', contribSubmit.status === 403, contribSubmit.body);
  const submitted = await approver.client.post(`${IP}/financial-reports/submit/${ids.accounts}`, { notes: 'September pack' });
  shape('POST /financial-reports/submit/:id', envelopeSchema(reportingRequestSchema), submitted.body);
  check('approver submits the pack', submitted.status === 200 && submitted.body?.data?.status === 'SUBMITTED', submitted.body);
  const lockedDraft = await contrib.client.post(`${IP}/financial-reports/income-statement/draft`, { reportingPeriod: PERIOD, title: 'x', data: { totalRevenue: 1 } });
  check('submitted pack is locked (409)', lockedDraft.status === 409, lockedDraft.body);

  const returned = await director.client.post(`/api/v1/private-markets/reporting-packs/${periodId}/return`, { note: 'Please add the debt schedule detail.' });
  check('staff returns the pack', returned.status === 200 && returned.body?.period?.status === 'returned', returned.body);
  const afterReturn = (await contrib.client.get(`${IP}/reporting/requests/${PERIOD}`)).body?.data;
  check('investee sees CHANGES_REQUESTED with the note', afterReturn?.portalStatus === 'CHANGES_REQUESTED' && /debt schedule/.test(afterReturn.reviewNote ?? ''), afterReturn);
  const resubmit = await approver.client.post(`${IP}/reporting/requests/${PERIOD}/submit`, {});
  check('approver resubmits', resubmit.status === 200 && resubmit.body?.data?.status === 'SUBMITTED', resubmit.body);
  const accepted = await director.client.post(`/api/v1/private-markets/reporting-packs/${periodId}/accept`, { note: 'Thanks.' });
  check('staff accepts the pack', accepted.status === 200 && accepted.body?.period?.status === 'accepted', accepted.body);
  const history = shape('GET /reporting/history', envelopeSchema(reportingRequestSchema.array()), (await viewer.client.get(`${IP}/reporting/history`)).body);
  check('investee history shows ACCEPTED', history.data?.some((h) => h.reportingPeriod === PERIOD && h.status === 'ACCEPTED' && h.reviewerName), history.data);
  const companyKpis = (await viewer.client.get(`${IP}/company`)).body?.data?.financialKpis?.kpiValues;
  check('accepted KPIs flow into company.financialKpis', companyKpis?.['2026-09-30']?.['IS.totalRevenue'] === 1250000, companyKpis);

  // ------------------------------------------------------------ threads
  console.log('\nThreads');
  const thread = await contrib.client.post(`${IP}/threads`, { title: 'Question on covenant definitions', text: 'Is EBITDA adjusted?', reportingPeriod: PERIOD });
  shape('POST /threads', envelopeSchema(threadSchema), thread.body);
  check('contributor starts a thread', thread.status === 201 && thread.body?.data?.messages?.[0]?.who === 'me', thread.body);
  const viewerThread = await viewer.client.post(`${IP}/threads`, { title: 'x', text: 'y' });
  check('read-only cannot start a thread (403)', viewerThread.status === 403, viewerThread.status);
  const threadRef: string = thread.body?.data?.id;

  // ------------------------------------------------------------ J6 term sheets
  console.log('\nJ6 term sheets');
  const tsBody = {
    company: A.ref,
    title: 'Series A preferred',
    investmentAmount: '2500000.00',
    valuation: 12000000,
    equityPercentage: 17.24,
    currency: 'USD',
    keyTerms: { instrument: 'Series A preferred', liquidationPreference: '1x non-participating', board: '1 seat' },
    conditions: 'Satisfactory legal and financial due diligence.',
    timeline: 'Close within 45 days of signature.',
  };
  const created = await dual.client.post('/api/v1/ops/term-sheets', tsBody);
  check('maker creates draft', created.status === 201 && created.body?.data?.status === 'DRAFT', created.body);
  const tsId: string = created.body?.data?.id;
  const draftVisible = await admin.client.get(`${IP}/term-sheets/${tsId}`);
  check('investee cannot see a draft (404)', draftVisible.status === 404, draftVisible.status);
  const otherSubmit = await pm.client.post(`/api/v1/ops/term-sheets/${tsId}/submit`);
  check('only the author submits for approval (403)', otherSubmit.status === 403, otherSubmit.body);
  const sub = await dual.client.post(`/api/v1/ops/term-sheets/${tsId}/submit`);
  check('maker submits for approval', sub.body?.data?.status === 'PENDING_APPROVAL', sub.body);
  const sod = await dual.client.post(`/api/v1/ops/term-sheets/${tsId}/approve`, {}, key('sod'));
  check('maker cannot approve own term sheet (403 segregation_of_duties)', sod.status === 403 && sod.body?.error?.code === 'segregation_of_duties', sod.body);
  const pmApprove = await pm.client.post(`/api/v1/ops/term-sheets/${tsId}/approve`, {}, key('pm'));
  check('portfolio manager lacks term_sheets.approve (403)', pmApprove.status === 403, pmApprove.status);
  const noKey = await director.client.post(`/api/v1/ops/term-sheets/${tsId}/approve`, {});
  check('approve without Idempotency-Key -> 400', noKey.status === 400 && noKey.body?.error?.code === 'idempotency_key_required', noKey.body);

  await enrolMfa(director.client);
  await prisma.session.updateMany({ where: { userId: director.user.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
  const stale = await director.client.post(`/api/v1/ops/term-sheets/${tsId}/approve`, {}, key('approve'));
  check('approve with stale MFA -> 401 step_up_required', stale.status === 401 && stale.body?.error?.code === 'step_up_required', stale.body);
  await prisma.session.updateMany({ where: { userId: director.user.id }, data: { mfaVerifiedAt: new Date() } });
  const approved = await director.client.post(`/api/v1/ops/term-sheets/${tsId}/approve`, {}, key('approve'));
  check('checker approves', approved.status === 200 && approved.body?.data?.status === 'APPROVED', approved.body);
  const replay = await director.client.post(`/api/v1/ops/term-sheets/${tsId}/approve`, {}, key('approve'));
  check('approve replay returns stored response', replay.status === 200 && replay.headers.get('idempotent-replayed') === 'true', replay.status);

  const issued = await dual.client.post(`/api/v1/ops/term-sheets/${tsId}/issue`, {}, key('issue'));
  check('term sheet issued with document', issued.status === 200 && issued.body?.data?.status === 'ISSUED' && issued.body.data.document?.sha256, issued.body);
  const opsList = await director.client.get(`/api/v1/ops/term-sheets?company=${A.ref}`);
  check('ops list returns the term sheet', opsList.status === 200 && opsList.body?.data?.length === 1, opsList.body);

  const tsList = shape('GET /term-sheets/my', envelopeSchema(termSheetListSchema), (await contrib.client.get(`${IP}/term-sheets/my`)).body);
  check('investee sees issued term sheet; contributor cannot sign', tsList.data?.total === 1 && tsList.data.termSheets[0]?.canSign === false, tsList.data);
  const viewed = shape('GET /term-sheets/:id', envelopeSchema(termSheetSchema), (await approver.client.get(`${IP}/term-sheets/${tsId}`)).body);
  check('opening marks VIEWED; approver can sign', viewed.data?.status === 'VIEWED' && viewed.data.canSign && !!viewed.data.documentUrl, viewed.data);
  const consentVersion = viewed.data?.consent?.version;

  const signBody = { name: 'WS3 a-approver', consent: true, consentTextVersion: consentVersion };
  const contribSign = await contrib.client.post(`${IP}/term-sheets/${tsId}/sign`, signBody, key('c-sign'));
  check('contributor cannot sign (403)', contribSign.status === 403 && contribSign.body?.code === 'permission_denied', contribSign.body);
  const noAuthSign = await approverNoAuth.client.post(`${IP}/term-sheets/${tsId}/sign`, signBody, key('na-sign'));
  check('approver without signing authority cannot sign (403)', noAuthSign.status === 403 && noAuthSign.body?.code === 'signing_authority_required', noAuthSign.body);
  const noMfa = await approver.client.post(`${IP}/term-sheets/${tsId}/sign`, signBody, key('sign0'));
  check('signing requires MFA enrolment (401)', noMfa.status === 401 && noMfa.body?.code === 'mfa_enrolment_required', noMfa.body);
  await enrolMfa(approver.client);
  const signNoKey = await approver.client.post(`${IP}/term-sheets/${tsId}/sign`, signBody);
  check('sign without Idempotency-Key -> 400', signNoKey.status === 400, signNoKey.body);
  const wrongConsent = await approver.client.post(`${IP}/term-sheets/${tsId}/sign`, { ...signBody, consentTextVersion: 'old' }, key('sign-old'));
  check('stale consent text version -> 409', wrongConsent.status === 409 && wrongConsent.body?.code === 'consent_version_mismatch', wrongConsent.body);
  const signed = await approver.client.post(`${IP}/term-sheets/${tsId}/sign`, signBody, key('sign'));
  shape('POST /term-sheets/:id/sign', envelopeSchema(signResultSchema), signed.body);
  check('approver signs', signed.status === 200 && signed.body?.data?.status === 'SIGNED_BY_COMPANY' && signed.body.data.isSigned, signed.body);
  const sig = await prisma.signature.findFirst({ where: { signerUserId: approver.user.id }, orderBy: { signedAt: 'desc' } });
  check(
    'signature evidence recorded (consent hash, UA, session, IP, MFA, certificate)',
    sig && sig.consentHash?.length === 64 && sig.consentTextVersion === consentVersion && sig.userAgent === `ws3-test/${run}` && sig.sessionId && sig.ip && sig.mfaAt && sig.certificateDocumentId && sig.docSha256.length === 64,
    sig,
  );
  const signReplay = await approver.client.post(`${IP}/term-sheets/${tsId}/sign`, signBody, key('sign'));
  check('sign replay is idempotent', signReplay.status === 200 && signReplay.headers.get('idempotent-replayed') === 'true', signReplay.status);
  const signAgain = await approver.client.post(`${IP}/term-sheets/${tsId}/sign`, signBody, key('sign2'));
  check('second signature -> 409', signAgain.status === 409, signAgain.body);

  // second term sheet: decline path
  const ts2 = (await dual.client.post('/api/v1/ops/term-sheets', { ...tsBody, title: 'Bridge note' })).body?.data?.id as string;
  await dual.client.post(`/api/v1/ops/term-sheets/${ts2}/submit`);
  await director.client.post(`/api/v1/ops/term-sheets/${ts2}/approve`, {}, key('approve2'));
  await dual.client.post(`/api/v1/ops/term-sheets/${ts2}/issue`, {}, key('issue2'));
  const declineViewer = await viewer.client.post(`${IP}/term-sheets/${ts2}/decline`, { reason: 'no' }, key('v-decline'));
  check('viewer cannot decline (403)', declineViewer.status === 403, declineViewer.status);
  const declined = await approver.client.post(`${IP}/term-sheets/${ts2}/decline`, { reason: 'Valuation too low.' }, key('decline'));
  check('approver declines with reason', declined.status === 200 && declined.body?.data?.status === 'DECLINED', declined.body);

  const auditActions = (
    await prisma.auditEvent.findMany({ where: { objectType: 'term_sheet', objectId: { in: [tsId, ts2] } }, select: { action: true } })
  ).map((a) => a.action);
  check(
    'every term sheet step is audited',
    ['created', 'submitted', 'approved', 'issued', 'viewed', 'signed', 'declined'].every((s) => auditActions.includes(`term_sheet.${s}`)),
    auditActions,
  );

  // ------------------------------------------------------------ IDOR (company B user vs company A)
  console.log('\nCompany scoping (IDOR)');
  const bProfile = (await other.client.get(`${IP}/company`)).body?.data;
  check('B user sees only company B', bProfile?.id === B.ref, bProfile?.id);
  const sel = await other.client.get(`${IP}/company?company=${A.ref}`);
  check('company selector for a foreign company -> 403', sel.status === 403 && sel.body?.code === 'no_company_access', sel.body);
  const lhGet = await other.client.get(`${IP}/portfolio-companies/${A.ref}/letterhead`);
  check('foreign letterhead read -> 404', lhGet.status === 404, lhGet.status);
  const lhWrite = await other.client.put(`${IP}/portfolio-companies/${A.ref}/letterhead`, lh);
  check('foreign letterhead write -> 404', lhWrite.status === 404, lhWrite.status);
  const lhById = await other.client.get(`${IP}/portfolio-companies/${A.id}/letterhead`);
  check('foreign letterhead by uuid -> 404', lhById.status === 404, lhById.status);
  const aLh = await prisma.portfolioCompany.findUniqueOrThrow({ where: { id: A.id } });
  check('company A letterhead unchanged by B', (aLh.letterhead as { line1?: string } | null)?.line1 === lh.line1);
  const rq = await other.client.get(`${IP}/reporting/requests/${PERIOD}`);
  check('foreign reporting period -> 404', rq.status === 404, rq.status);
  const bSchedule = (await other.client.get(`${IP}/reporting/requests`)).body?.data;
  check('B schedule does not include A periods', Array.isArray(bSchedule) && bSchedule.length === 0, bSchedule);
  const rep = await other.client.get(`${IP}/financial-reports/${ids.accounts}`);
  check('foreign financial report -> 404', rep.status === 404, rep.status);
  const fileId = reports.data?.items?.find((r) => r.slot === 'accounts')?.files?.[0]?.id;
  const dl = await other.client.get(`${IP}/financial-reports/${ids.accounts}/files/${fileId}/download-url`);
  check('foreign file download -> 404', dl.status === 404, dl.status);
  const upB = await other.client.post(`${IP}/financial-reports/${ids.board}/file`, file('file', 'b.pdf', 'application/pdf'));
  check('foreign report upload -> 404', upB.status === 404, upB.status);
  const tsB = await other.client.get(`${IP}/term-sheets/${tsId}`);
  check('foreign term sheet -> 404', tsB.status === 404, tsB.status);
  const tsBList = (await other.client.get(`${IP}/term-sheets/my`)).body?.data;
  check('B term sheet list is empty', tsBList?.total === 0, tsBList);
  const declineB = await other.client.post(`${IP}/term-sheets/${ts2}/decline`, { reason: 'x' }, key('b-decline'));
  check('foreign term sheet decline -> 404', declineB.status === 404, declineB.status);
  const threadB = await other.client.post(`${IP}/threads/${threadRef}/messages`, { text: 'hi' });
  check('foreign thread reply -> 404', threadB.status === 404, threadB.status);
  const bThreads = (await other.client.get(`${IP}/threads`)).body?.data;
  check('B threads exclude A', Array.isArray(bThreads) && bThreads.length === 0, bThreads);

  // ------------------------------------------------------------ hydration payload
  console.log('\nHydration payload');
  const live = await approver.client.get(`${IP}/live`);
  shape('GET /live', livePayloadSchema, live.body);
  check('live payload carries the signed term sheet', live.body?.termSheets?.data?.termSheets?.some((t: { status: string }) => t.status === 'SIGNED_BY_COMPANY'), live.body?.termSheets);
}

async function cleanup() {
  const tsIds = (await prisma.termSheet.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } })).map((t) => t.id);
  await prisma.signatureRequest.deleteMany({ where: { subjectType: 'term_sheet', subjectId: { in: tsIds } } });
  await prisma.document.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.portfolioCompany.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

main()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error('cleanup failed:', err));
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll WS3 checks passed');
    await prisma.$disconnect();
    process.exit(failures ? 1 : 0);
  });
