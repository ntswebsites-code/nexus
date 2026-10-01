/**
 * WS4 journeys against a RUNNING API (flags CUSTODIAN_LIVE=true, ONBOARDING_LIVE=true):
 *   J1B  public V65 application -> KYC case with every field and evidence slot, visible to staff
 *   J7   custodian executions (batch, idempotent, deduplicated) -> day-end package with a
 *        server-side hash -> second-user approval -> staff review feeding reconciliation status
 *   plus segregation-of-duties, cross-counterparty IDOR and permission negatives.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4154 npx tsx scripts/test-ws4.ts
 *
 * Creates throwaway users and counterparties (removed at the end) and leaves the onboarding
 * application behind; disposable databases only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { canonicalPackage } from '../src/modules/custodian/custodian.service';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ws4-${randomBytes(9).toString('base64url')}`;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500));
  }
};

type Res = { status: number; body: any; headers: Headers };

function client(origin: string, extra: Record<string, string> = {}) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...extra, ...headers };
    if (cookie) h.Cookie = cookie;
    let payload: FormData | string | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
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
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return { call, login: (email: string, portal: string) => call('POST', '/api/auth/login', { email, password, portal }) };
}

const pdfBytes = (label: string) => Buffer.from(`%PDF-1.4\n% ${label} ${run}\n%%EOF\n`);
function fileForm(fields: Record<string, string>, name: string, bytes: Buffer, mime = 'application/pdf') {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
  return f;
}

const users: string[] = [];
const counterparties: string[] = [];

async function mkUser(label: string, roles: string[]) {
  const bcrypt = (await import('bcryptjs')).default;
  const user = await prisma.user.create({ data: { email: `ws4-${run}-${label}@example.test`, name: `WS4 ${label}`, passwordHash: await bcrypt.hash(password, 4) } });
  users.push(user.id);
  for (const spec of roles) {
    const [portal, key] = spec.split(':');
    const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: portal!, key: key! } } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

// ------------------------------------------------------------------------ J1B

const V65_FORM: Record<string, string> = {
  investorType: 'Pension / provident fund',
  legalName: `WS4 Pension Fund ${run}`,
  registrationRef: `PF/${run}/2019`,
  jurisdiction: 'Zimbabwe',
  incorporationDate: '2019-04-01',
  regulatedStatus: 'Pension / retirement arrangement',
  regulator: 'IPEC',
  licenceRef: `IPEC-${run}`,
  website: 'https://pension.example.test',
  registeredAddress: '12 Samora Machel Ave, Harare',
  relationship: 'Fund / LP subscription',
  mandate: 'Growth Fund I',
  initialInvestment: '750000',
  baseCurrency: 'USD',
  investorClassification: 'Institutional / professional investor',
  primaryEmail: `ws4-${run}-applicant@example.test`,
  primaryContact: 'Tendai Moyo',
  telephone: '+263242700000',
  purpose: 'Pension / liability matching',
  ownershipNarrative: 'Board of trustees; members are beneficiaries.',
  authorityNarrative: 'Trustee resolution 2026/14 authorises the investment.',
  pep: 'no',
  sanctions: 'no',
  adverseMedia: 'unknown',
  highRiskJurisdiction: 'no',
  sourceFunds: 'Pension contributions / member assets',
  sourceWealth: 'Pension / institutional assets',
  annualVolume: '1500000',
  transactionFrequency: '2–5 per month',
  fundingJurisdictions: 'Zimbabwe, South Africa',
  expectedCurrencies: 'USD, ZAR',
  sourceFundsNarrative: 'Accumulated member contributions held with the fund custodian.',
  expectedActivity: 'Quarterly subscriptions; annual redemptions for benefit payments.',
  taxResidence: 'Zimbabwe',
  taxId: `TIN${run}999`,
  fatca: 'Active NFFE',
  giin: '',
  crs: 'Active non-financial entity',
  usIndicia: 'no',
  bankName: 'CBZ Bank',
  bankHolder: `WS4 Pension Fund ${run}`,
  bankCountry: 'Zimbabwe',
  bankAccount: `0123456789${run}`,
  swift: 'COBZZWHA',
  bankCurrency: 'USD',
  evidenceNote: 'Trust deed amended in 2024.',
  complianceContact: 'Rudo Chikore, Compliance Officer, rudo@example.test',
  signatureName: 'Tendai Moyo',
  signatureCapacity: 'Principal Officer',
};
const CARDS = ['legal', 'registry', 'ownership', 'identity', 'address', 'bank', 'funds', 'tax', 'authority', 'subscription', 'additional'];

async function j1b(staff: ReturnType<typeof client>) {
  console.log('\nJ1B public onboarding -> KYC case');
  const onb = client(config.portalUrls.onboarding);
  const draft = await onb.call('POST', '/api/v1/public/applications', { email: V65_FORM.primaryEmail, applicantType: V65_FORM.investorType, name: V65_FORM.legalName, sendLink: false });
  check('draft created', draft.status === 201 && draft.body?.token, draft.body);
  const tok = { 'X-Draft-Token': draft.body.token as string };
  const base = `/api/v1/public/applications/${draft.body.id}`;
  const owners = [
    { name: 'Board of Trustees', nationality: 'Zimbabwe', id: 'TRUST-001', pct: '60' },
    { name: 'Farai Ncube', nationality: 'South Africa', id: 'ZA8001015009087', pct: '40' },
  ];
  const signatories = [
    { name: 'Tendai Moyo', role: 'Principal Officer', email: 'tendai@example.test' },
    { name: 'Rudo Chikore', role: 'Trustee', email: 'rudo@example.test' },
  ];
  const patch = await onb.call('PATCH', base, { form: { formVersion: 'v65', ...V65_FORM }, owners, signatories }, tok);
  check('V65 draft saved', patch.status === 200, patch.body);

  const early = await onb.call('POST', `${base}/submit`, { consent: true }, tok);
  check('submit without evidence -> 400 incomplete_application listing V65 slots', early.status === 400 && early.body?.error?.code === 'incomplete_application' && early.body.error.details.evidence.includes('Registry / constitutional extract'), early.body);

  const hashes: Record<string, string> = {};
  for (const card of CARDS) {
    const bytes = pdfBytes(card);
    hashes[card] = sha(bytes);
    const up = await onb.call('POST', `${base}/evidence`, fileForm({ slot: card }, `${card}.pdf`, bytes), tok);
    if (up.status !== 201 || up.body?.sha256 !== hashes[card]) check(`evidence ${card} uploaded with sha256`, false, up.body);
  }
  check('all 11 V65 evidence cards accepted with server sha256', true);
  const unknown = await onb.call('POST', `${base}/evidence`, fileForm({ slot: 'nonsense' }, 'x.pdf', pdfBytes('x')), tok);
  check('unknown evidence slot -> 400', unknown.status === 400, unknown.body);

  const view = await onb.call('GET', base, undefined, tok);
  const a = view.body?.application;
  check('resume view never returns tax id or account number', a?.form?.taxId === '' && a?.form?.bankAccount === '' && a?.taxIdOnFile && a?.bankAccountOnFile, a?.form);
  check('resume view restores owners with nationality and signatories', a?.ownerDetails?.length === 2 && a.ownerDetails[1].nationality === 'South Africa' && a?.signatories?.length === 2, a);
  check('resume view restores every V65 field', Object.entries(V65_FORM).every(([k, v]) => k === 'taxId' || k === 'bankAccount' || a?.form?.[k] === v), a?.form);
  check('resume view lists 11 evidence files with hashes', a?.evidence?.length === 11 && a.evidence.every((e: any) => /^[0-9a-f]{64}$/.test(e.sha256)), a?.evidence);

  // Blank tax id / account on a later save keep the encrypted values (resumed drafts send blanks).
  await onb.call('PATCH', base, { form: { formVersion: 'v65', ...V65_FORM, taxId: '', bankAccount: '' }, owners, signatories }, tok);
  const sub = await onb.call('POST', `${base}/submit`, { consent: true, form: { formVersion: 'v65', ...V65_FORM, taxId: '', bankAccount: '' }, owners, signatories }, tok);
  check('submit -> ONB reference', sub.status === 200 && /^ONB-\d{6}$/.test(sub.body?.ref ?? ''), sub.body);
  const again = await onb.call('POST', `${base}/submit`, { consent: true }, tok);
  check('second submit -> 409 already_submitted', again.status === 409, again.body);

  const app = await prisma.onboardingApplication.findUniqueOrThrow({ where: { id: draft.body.id }, include: { owners: true, kycCase: true } });
  check('typed columns mapped (legal name, reg, country, phone, classification, tax status, signing authority)',
    app.legalName === V65_FORM.legalName && app.registrationRef === V65_FORM.registrationRef && app.country === 'Zimbabwe' && app.phone === V65_FORM.telephone &&
      app.classification === V65_FORM.investorClassification && app.taxStatus === 'FATCA: Active NFFE · CRS: Active non-financial entity' &&
      app.signingAuthority === 'Tendai Moyo (Principal Officer)' && app.expectedInvestment?.toNumber() === 750000 && app.applicantType === V65_FORM.investorType,
    app);
  const fd = JSON.stringify(app.formData);
  check('tax id and account number not stored in clear', !!app.taxIdEnc && !fd.includes(V65_FORM.taxId) && !fd.includes(V65_FORM.bankAccount) && !app.owners.some((o) => (o.idNumberEnc ?? '').includes('ZA80')), fd.slice(0, 200));
  check('KYC case created in Screening', app.kycCase?.stage === 'Screening', app.kycCase);
  const files = await prisma.kycEvidence.findMany({ where: { applicationId: app.id } });
  const fileRows = await prisma.fileObject.findMany({ where: { id: { in: files.map((f) => f.fileId!).filter(Boolean) } } });
  check('stored evidence sha256 equals uploaded bytes', fileRows.length === 11 && fileRows.every((f) => Object.values(hashes).includes(f.sha256)), fileRows.map((f) => f.sha256));
  const audits = await prisma.auditEvent.count({ where: { objectId: { in: [app.id, app.kycCase!.id] }, action: { in: ['application.draft.created', 'kyc.evidence.uploaded', 'application.submitted'] } } });
  check('draft, 11 evidence uploads and submission audited', audits >= 13, audits);

  const list = await staff.call('GET', '/api/v1/kyc/cases');
  const row = (list.body?.data ?? list.body?.cases ?? list.body?.items ?? []).find?.((c: any) => c.applicationRef === sub.body.ref);
  check('case visible in the staff KYC queue', !!row, list.body);
  const detail = await staff.call('GET', `/api/v1/kyc/cases/${app.kycCase!.id}`);
  const form = detail.body?.case?.application?.form;
  const fields = new Map<string, string>((form?.sections ?? []).flatMap((s: any) => s.fields).map((f: any) => [f.key, f.value]));
  const missing = Object.keys(V65_FORM).filter((k) => !fields.has(k));
  check('staff case shows every V65 field', form && missing.length === 0, missing);
  check('staff values match the application', Object.entries(V65_FORM).every(([k, v]) => ['taxId', 'bankAccount'].includes(k) || fields.get(k) === v), [...fields].slice(0, 5));
  check('staff sees masked tax id and account', fields.get('taxId') === '•••• 999' && fields.get('bankAccount') === `•••• ${V65_FORM.bankAccount.slice(-4)}`, [fields.get('taxId'), fields.get('bankAccount')]);
  check('staff sees owners (nationality), signatories and the declaration', form?.owners?.length === 2 && form.owners[1].nationality === 'South Africa' && form?.signatories?.length === 2 &&
    form?.declaration?.consentVersion && form.declaration.name === 'Tendai Moyo' && form.declaration.ip && form.declaration.at, form);
  const ev = detail.body?.case?.evidence ?? [];
  check('staff case: 9 required slots received, 11 slots on file', ev.filter((e: any) => e.required).length === 9 && ev.filter((e: any) => e.required).every((e: any) => e.status === 'Received') && ev.filter((e: any) => e.fileId).length === 11, ev);
  const legacy = await staff.call('GET', '/api/v1/kyc/cases/legacy');
  const rec = (legacy.body?.data ?? []).find((r: any) => r.caseId === app.kycCase!.id);
  check('admin queue record carries bank, declarations, signatories', rec?.applicant?.bank?.name === 'CBZ Bank' && rec?.applicant?.declarations?.adverseMedia === 'unknown' && rec?.applicant?.signatories?.length === 2 && rec?.docsTotal === 9, rec?.applicant);
}

// ------------------------------------------------------------------------ J7

async function j7(staff: ReturnType<typeof client>, staffViewer: ReturnType<typeof client>) {
  console.log('\nJ7 custodian day-end -> reconciliation');
  const origin = config.portalUrls.custodian;
  const cpA = await prisma.counterparty.create({ data: { ref: `CPA${run}`, name: `WS4 Custodian A ${run}`, accounts: ['BGF-001', { ref: 'BGF-002' }] } });
  const cpB = await prisma.counterparty.create({ data: { ref: `CPB${run}`, name: `WS4 Custodian B ${run}`, accounts: ['XYZ-9'] } });
  counterparties.push(cpA.id, cpB.id);
  const subA = await mkUser('sub-a', ['custodian:submitter']);
  const apprA = await mkUser('appr-a', ['custodian:approver']);
  const apprB = await mkUser('appr-b', ['custodian:approver']);
  const orphan = await mkUser('orphan', ['custodian:submitter']);
  await prisma.counterpartyUser.createMany({
    data: [
      { counterpartyId: cpA.id, userId: subA.id, role: 'submitter' },
      { counterpartyId: cpA.id, userId: apprA.id, role: 'approver' },
      { counterpartyId: cpB.id, userId: apprB.id, role: 'approver' },
    ],
  });

  const s = client(origin);
  const ap = client(origin);
  const b = client(origin);
  const o = client(origin);
  check('submitter signs in to the custodian portal', (await s.login(subA.email, 'custodian')).status === 200);
  check('approver signs in', (await ap.login(apprA.email, 'custodian')).status === 200);
  check('counterparty B approver signs in', (await b.login(apprB.email, 'custodian')).status === 200);
  check('unlinked custodian user signs in', (await o.login(orphan.email, 'custodian')).status === 200);
  const staffLogin = await client(origin).login(`ws4-${run}-ops@example.test`, 'custodian');
  check('staff account refused at custodian login (portal_access_denied)', staffLogin.status === 403 && staffLogin.body?.error?.code === 'portal_access_denied', staffLogin.body);
  const orphanMe = await o.call('GET', '/api/v1/custodian/me');
  check('user without a counterparty -> 403 no_counterparty', orphanMe.status === 403 && orphanMe.body?.error?.code === 'no_counterparty', orphanMe.body);
  const anon = await client(origin).call('GET', '/api/v1/custodian/me');
  check('anonymous -> 401', anon.status === 401, anon.body);

  const me = await s.call('GET', '/api/v1/custodian/me');
  check('me: own counterparty and accounts', me.status === 200 && me.body?.counterparty?.id === cpA.id && me.body.counterparty.accounts.join() === 'BGF-001,BGF-002' && me.body.role === 'submitter', me.body);

  const today = new Date().toISOString().slice(0, 10);
  const exec = (n: number, account = 'BGF-001') => ({
    tradeRef: `TRD-${run}-${n}`,
    executionAt: `${today}T00:30:00.000Z`,
    accountRef: account,
    ticker: 'dlta.zw',
    side: n % 2 ? 'BUY' : 'SELL',
    quantity: String(1000 * n),
    price: '0.1840',
    currency: 'USD',
    settlementDate: today,
    broker: 'IH Securities',
  });
  const noKey = await s.call('POST', '/api/v1/custodian/executions', { executions: [exec(1)] });
  check('executions without Idempotency-Key -> 400', noKey.status === 400 && noKey.body?.error?.code === 'idempotency_key_required', noKey.body);
  const batch = { executions: [exec(1), exec(2), exec(3)] };
  const k1 = `k1-${run}`;
  const first = await s.call('POST', '/api/v1/custodian/executions', batch, { 'Idempotency-Key': k1 });
  check('batch of 3 executions -> 201', first.status === 201 && first.body?.created?.length === 3 && first.body.created[0].ticker === 'DLTA.ZW', first.body);
  const replay = await s.call('POST', '/api/v1/custodian/executions', batch, { 'Idempotency-Key': k1 });
  check('idempotent replay returns the original response', replay.status === 201 && replay.headers.get('idempotent-replayed') === 'true' && replay.body?.created?.[0]?.id === first.body?.created?.[0]?.id, replay.body);
  const reuse = await s.call('POST', '/api/v1/custodian/executions', { executions: [exec(9)] }, { 'Idempotency-Key': k1 });
  check('same key, different payload -> 409 idempotency_key_reused', reuse.status === 409 && reuse.body?.error?.code === 'idempotency_key_reused', reuse.body);
  const mixed = await s.call('POST', '/api/v1/custodian/executions', { executions: [exec(1), exec(2), exec(3), exec(4)] }, { 'Idempotency-Key': `k2-${run}` });
  check('dedupe on tradeRef: 1 created, 3 reported as duplicates', mixed.status === 201 && mixed.body?.created?.length === 1 && mixed.body?.duplicates?.length === 3, mixed.body);
  const dupes = await s.call('POST', '/api/v1/custodian/executions', { executions: [exec(4)] }, { 'Idempotency-Key': `k3-${run}` });
  check('all duplicates -> 409 duplicate_trade_ref', dupes.status === 409 && dupes.body?.error?.code === 'duplicate_trade_ref', dupes.body);
  check('exactly 4 executions stored', (await prisma.counterpartyExecution.count({ where: { counterpartyId: cpA.id } })) === 4);
  const scope = await s.call('POST', '/api/v1/custodian/executions', { executions: [exec(5, 'XYZ-9')] }, { 'Idempotency-Key': `k4-${run}` });
  check("other counterparty's account -> 403 account_out_of_scope", scope.status === 403 && scope.body?.error?.code === 'account_out_of_scope', scope.body);
  const bad = await s.call('POST', '/api/v1/custodian/executions', { executions: [{ ...exec(6), quantity: '0' }] }, { 'Idempotency-Key': `k5-${run}` });
  check('zero quantity -> 400', bad.status === 400, bad.body);

  const fileBytes = Buffer.from(`account,cash,holdings\nBGF-001,6320000.00,21839000.00\n${run}\n`);
  const fields = { statementDate: today, accountRef: 'BGF-001', currency: 'USD', closingCash: '6320000.00', holdingsMv: '21839000', tradeCount: '4', note: 'Official day-end balances.' };
  const noFile = new FormData();
  for (const [k, v] of Object.entries(fields)) noFile.append(k, v);
  const nf = await s.call('POST', '/api/v1/custodian/day-end', noFile, { 'Idempotency-Key': `d0-${run}` });
  check('day-end without the official file -> 400', nf.status === 400, nf.body);
  const created = await s.call('POST', '/api/v1/custodian/day-end', fileForm(fields, 'dayend.csv', fileBytes, 'text/csv'), { 'Idempotency-Key': `d1-${run}` });
  const pkgId = created.body?.package?.id as string;
  check('day-end package created as Draft with server file hash', created.status === 201 && created.body.package.status === 'Draft' && created.body.package.file?.sha256 === sha(fileBytes), created.body);
  const notPreparer = await ap.call('POST', `/api/v1/custodian/day-end/${pkgId}/submit`, {});
  check('another user cannot submit the preparer\'s draft -> 403 not_preparer', notPreparer.status === 403 && notPreparer.body?.error?.code === 'not_preparer', notPreparer.body);
  const submitted = await s.call('POST', `/api/v1/custodian/day-end/${pkgId}/submit`, {});
  const row = await prisma.counterpartyDayEndPackage.findUniqueOrThrow({ where: { id: pkgId } });
  const expected = sha(canonicalPackage(row, cpA.ref, { sha256: sha(fileBytes), size: fileBytes.length, name: 'dayend.csv' }));
  check('submit -> Received with the server-side canonical sha256', submitted.status === 200 && submitted.body?.package?.status === 'Received' && submitted.body.package.sha256 === expected, { got: submitted.body?.package?.sha256, expected });
  check('trade-count control matches 4 executions', submitted.body?.controls?.matches === true && submitted.body.controls.executionsReceived === 4, submitted.body?.controls);
  const dup = await s.call('POST', '/api/v1/custodian/day-end', fileForm(fields, 'dayend2.csv', Buffer.from('x')), { 'Idempotency-Key': `d2-${run}` });
  check('second active package for the same account/date/currency -> 409 package_exists', dup.status === 409 && dup.body?.error?.code === 'package_exists', dup.body);

  const selfApprove = await s.call('POST', `/api/v1/custodian/day-end/${pkgId}/approve`, {});
  check('submitter cannot approve (no approve permission) -> 403', selfApprove.status === 403, selfApprove.body);

  // SoD with a user who holds the approve permission: an approver submits, then tries to approve.
  const fields2 = { ...fields, accountRef: 'BGF-002', tradeCount: '0' };
  const c2 = await ap.call('POST', '/api/v1/custodian/day-end', fileForm(fields2, 'dayend-b.csv', Buffer.from(`b ${run}`), 'text/csv'), { 'Idempotency-Key': `d3-${run}` });
  const p2 = c2.body?.package?.id as string;
  await ap.call('POST', `/api/v1/custodian/day-end/${p2}/submit`, {});
  const sod = await ap.call('POST', `/api/v1/custodian/day-end/${p2}/approve`, {});
  check('approver cannot approve a package they submitted -> 403 segregation_of_duties', sod.status === 403 && sod.body?.error?.code === 'segregation_of_duties', sod.body);

  console.log('\nCross-counterparty IDOR');
  const execId = first.body.created[0].id as string;
  for (const [label, res] of [
    ['GET day-end', await b.call('GET', `/api/v1/custodian/day-end/${pkgId}`)],
    ['approve day-end', await b.call('POST', `/api/v1/custodian/day-end/${pkgId}/approve`, {})],
    ['submit day-end', await b.call('POST', `/api/v1/custodian/day-end/${pkgId}/submit`, {})],
    ['GET execution', await b.call('GET', `/api/v1/custodian/executions/${execId}`)],
  ] as const) {
    check(`counterparty B ${label} of A -> 404`, res.status === 404, res.body);
  }
  const bSubs = await b.call('GET', '/api/v1/custodian/submissions');
  check("counterparty B's submissions exclude A's records", bSubs.status === 200 && bSubs.body.executions.length === 0 && bSubs.body.dayEnds.length === 0, bSubs.body?.counts);
  const bList = await b.call('GET', '/api/v1/custodian/executions');
  check("counterparty B's execution list is empty", bList.body?.items?.length === 0, bList.body);

  const approved = await ap.call('POST', `/api/v1/custodian/day-end/${pkgId}/approve`, {});
  check('second user approves -> Approved', approved.status === 200 && approved.body?.package?.status === 'Approved' && approved.body.package.approvedById === apprA.id, approved.body);

  console.log('\nStaff review');
  const subs = await staff.call('GET', '/api/v1/ops/custodian/submissions');
  const item = subs.body?.dayEnds?.find((d: any) => d.id === pkgId);
  check('staff sees the approved package with controls and counterparty', subs.status === 200 && item?.status === 'Approved' && item.controls?.matches === true && item.counterparty?.id === cpA.id, item);
  check('staff list hides counterparty drafts', !(subs.body?.dayEnds ?? []).some((d: any) => d.status === 'Draft'));
  const det = await staff.call('GET', `/api/v1/ops/custodian/day-end/${pkgId}`);
  check('staff detail verifies the package fingerprint', det.status === 200 && det.body?.integrity?.verified === true, det.body?.integrity);
  const viewerReview = await staffViewer.call('POST', `/api/v1/ops/custodian/day-end/${pkgId}/review`, { decision: 'ACCEPT' });
  check('staff without custodian.review -> 403', viewerReview.status === 403, viewerReview.body);
  const custodianToOps = await s.call('GET', '/api/v1/ops/custodian/submissions');
  check('custodian user cannot reach the staff API -> 403', custodianToOps.status === 403, custodianToOps.body);
  const noNote = await staff.call('POST', `/api/v1/ops/custodian/day-end/${pkgId}/review`, { decision: 'REJECT' });
  check('REJECT without a note -> 400', noNote.status === 400, noNote.body);
  const notApproved = await staff.call('POST', `/api/v1/ops/custodian/day-end/${p2}/review`, { decision: 'ACCEPT' });
  check('package not yet approved by the counterparty -> 409', notApproved.status === 409, notApproved.body);
  const accept = await staff.call('POST', `/api/v1/ops/custodian/day-end/${pkgId}/review`, { decision: 'ACCEPT', note: 'Balances agree to the internal book.' });
  check('ACCEPT -> Accepted, 4 executions Matched', accept.status === 200 && accept.body?.package?.status === 'Accepted' && accept.body.executionsUpdated === 4 && accept.body.executionStatus === 'Matched', accept.body);
  const twice = await staff.call('POST', `/api/v1/ops/custodian/day-end/${pkgId}/review`, { decision: 'REJECT', note: 'again' });
  check('second review -> 409', twice.status === 409, twice.body);
  const back = await s.call('GET', '/api/v1/custodian/submissions');
  const mine = back.body?.dayEnds?.find((d: any) => d.id === pkgId);
  check('counterparty sees the outcome and note, executions Matched', mine?.status === 'Accepted' && mine.review?.decision === 'ACCEPT' && mine.review.note === 'Balances agree to the internal book.' && !('reviewerId' in mine.review) &&
    back.body.executions.filter((e: any) => e.status === 'Matched').length === 4, mine);

  const actions = (await prisma.auditEvent.findMany({ where: { objectId: { in: [pkgId, ...first.body.created.map((c: any) => c.id)] } }, select: { action: true } })).map((a) => a.action);
  check('every state change audited', ['custodian.dayend.created', 'custodian.dayend.submitted', 'custodian.dayend.approved', 'custodian.dayend.reviewed', 'custodian.execution.submitted'].every((a) => actions.includes(a)), actions);
}

async function main() {
  console.log(`API ${API} · run ${run}`);
  const flags = await fetch(`${API}/api/v1/platform/flags`).then((r) => r.json() as Promise<any>);
  check('flags: custodian and onboarding live', flags?.custodian?.live === true && flags?.onboarding?.live === true, flags);
  const ops = await mkUser('ops', ['admin:operations', 'admin:compliance']);
  const viewer = await mkUser('viewer', ['admin:auditor']);
  const staff = client(config.portalUrls.admin);
  check('staff signs in (admin)', (await staff.login(ops.email, 'admin')).status === 200);
  const staffViewer = client(config.portalUrls.admin);
  check('staff viewer signs in (admin)', (await staffViewer.login(viewer.email, 'admin')).status === 200);
  try {
    await j1b(staff);
    await j7(staff, staffViewer);
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: users } } });
    await prisma.counterpartyExecution.deleteMany({ where: { counterpartyId: { in: counterparties } } });
    await prisma.counterpartyDayEndPackage.deleteMany({ where: { counterpartyId: { in: counterparties } } });
    await prisma.counterparty.deleteMany({ where: { id: { in: counterparties } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll WS4 checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
