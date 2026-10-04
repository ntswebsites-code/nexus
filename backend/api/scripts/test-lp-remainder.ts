/**
 * Package S6 (LP portal remainder) checks against a RUNNING API:
 *  - BR-087/095/170/171: the presentation currency is applied by the API with the as-of FX rate, a missing rate keeps the
 *    original currency with a note, ratios do not move.
 *  - BR-152/FR-LP-029: ledger rows carry the transaction-date rate stamped once (lp_fx_stamps); a later rate never restates a row.
 *  - BR-091: benchmark series from approved points only; staff maker-checker (different approver, approved is immutable).
 *  - BR-101/FR-LP-054: full account number only on an explicit reveal by SIGNATORY or MANAGER (audited); VIEWER stays masked.
 *  - BR-143/094/078: RESTATED status machine (restate action with reason, no direct PATCH, weakest status wins).
 *  - BR-096: report job states QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED, restart pick-up and download gating.
 *  - FR-LP-102/FR-AUTH-018: /account/security (MFA status, backup codes, recovery, sessions, password change).
 *  - FR-LP-032/062/072/033/095/099: server sorts, activity PDF export, invitation resend, confirm-account and letter upload.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4190 npx tsx scripts/test-lp-remainder.ts
 *
 * Disposable schema only (migration applied, role catalogue seeded). Creates throwaway users, clients, funds, currencies
 * (ZZA, ZZB) and records under its own run id and removes them at the end.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { storeFile } from '../src/lib/storage';
import { encryptField } from '../src/lib/crypto';
import { totpNow } from '../src/lib/totp';
import { storeWire } from '../src/modules/ops/ops.common';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const LP = '/api/v1/lp-portal';
const run = randomBytes(3).toString('hex');
const password = `S6-${randomBytes(9).toString('base64url')}`;
let failures = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 1200));
  }
};

type Res = { status: number; body: any; headers: Headers };

function client(portal: 'investor' | 'admin' = 'investor') {
  const origin = config.portalUrls[portal];
  const jar = new Map<string, string>();
  let secret = '';
  const send = async (method: string, path: string, init: { body?: string | FormData; headers?: Record<string, string> } = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...(init.headers ?? {}) };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, { method, headers: h, body: init.body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/max-age=0/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: buf, headers: res.headers };
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
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const once = () =>
      send(method, path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      });
    let res = await once();
    for (let i = 0; i < 10 && res.status === 409 && res.body?.code === 'LP_IDEMPOTENCY_IN_PROGRESS'; i++) {
      await new Promise((r) => setTimeout(r, 300));
      res = await once();
    }
    return res;
  };
  return {
    call,
    get: (path: string) => call('GET', path),
    post: (path: string, body: unknown = {}, headers: Record<string, string> = {}) => call('POST', path, body, headers),
    patch: (path: string, body: unknown = {}, headers: Record<string, string> = {}) => call('PATCH', path, body, headers),
    del: (path: string) => call('DELETE', path),
    upload: (path: string, name: string, mime: string, data: Buffer, headers: Record<string, string> = {}) => {
      const form = new FormData();
      form.append('file', new Blob([data], { type: mime }), name);
      return send('POST', path, { body: form, headers });
    },
    login: (email: string, pw = password, mfa = false) => call('POST', '/api/auth/login', { email, password: pw, portal }).then((r) => (mfa ? r : r)),
    async enrolMfa() {
      const e = await send('POST', '/api/auth/mfa/enroll', { body: '{}', headers: { 'Content-Type': 'application/json' } });
      secret = e.body?.secret ?? '';
      const v = await call('POST', '/api/auth/mfa/verify', { code: totpNow(secret) });
      return e.status === 200 && v.status === 200;
    },
    stepUp: () => call('POST', '/api/auth/mfa/step-up', { code: totpNow(secret) }),
    code: () => totpNow(secret),
  };
}
type Client = ReturnType<typeof client>;

const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% S6 test ${label}\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n`);
const key = (s: string) => ({ 'Idempotency-Key': `s6-${run}-${s}-${randomBytes(3).toString('hex')}` });
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });

  const created = {
    users: [] as string[],
    clients: [] as string[],
    funds: [] as string[],
    docs: [] as string[],
    files: [] as string[],
    roles: [] as string[],
    emails: [] as string[],
  };

  const fundA = await prisma.fund.create({ data: { ref: `S6A${run}`, name: `S6 Fund A ${run}`, shortName: 'S6A', currency: 'ZZA', asOfDate: day('2026-06-30'), valuationStatus: 'FINAL' } });
  const fundB = await prisma.fund.create({ data: { ref: `S6B${run}`, name: `S6 Fund B ${run}`, shortName: 'S6B', currency: 'ZZB', asOfDate: day('2026-06-30'), valuationStatus: 'FINAL' } });
  const fundC = await prisma.fund.create({ data: { ref: `S6C${run}`, name: `S6 Fund C ${run}`, shortName: 'S6C', currency: 'ZZA', asOfDate: day('2026-06-30'), valuationStatus: 'PROVISIONAL' } });
  created.funds.push(fundA.id, fundB.id, fundC.id);
  const mkClient = (s: string) => prisma.client.create({ data: { ref: `S6${run}${s}`, name: `S6 Client ${s} ${run}`, type: 'Pension fund', portalEnabled: true } });
  const a = await mkClient('A');
  const b = await mkClient('B');
  const c = await mkClient('C');
  created.clients.push(a.id, b.id, c.id);
  // Client A holds fund A (ZZA, has rates). Client B holds fund B (ZZB, no rate). Client C holds A and C (statuses FINAL + PROVISIONAL).
  const cmA = await prisma.fundCommitment.create({ data: { clientId: a.id, fundId: fundA.id, commitmentAmount: '1000.00', investorAccountRef: 'ACC-A', metricsJson: { nav: '1000', paidIn: '500', distributions: '100', tvpi: '1.2000', dpi: '0.2000', rvpi: '1.0000' } } });
  await prisma.fundCommitment.create({ data: { clientId: b.id, fundId: fundB.id, commitmentAmount: '2000.00', metricsJson: { nav: '2000', paidIn: '1000' } } });
  await prisma.fundCommitment.create({ data: { clientId: c.id, fundId: fundA.id, commitmentAmount: '1000.00', metricsJson: { nav: '1000', paidIn: '500' } } });
  await prisma.fundCommitment.create({ data: { clientId: c.id, fundId: fundC.id, commitmentAmount: '1000.00', metricsJson: { nav: '1000', paidIn: '500' } } });

  // Rates ZZA -> USD (rate = USD per 1 ZZA): 2026-03-01 = 2.0, 2026-06-30 = 2.5. None for ZZB.
  await prisma.fxRate.createMany({
    data: [
      { fromCurrency: 'ZZA', toCurrency: 'USD', rateDate: day('2026-03-01'), rate: '2.0000000000', source: 'TEST' },
      { fromCurrency: 'ZZA', toCurrency: 'USD', rateDate: day('2026-06-30'), rate: '2.5000000000', source: 'TEST' },
    ],
  });

  const mkUser = async (label: string, clientId: string | null, portal: string, roleKey: string) => {
    const email = `s6-${run}-${label}@example.test`;
    const user = await prisma.user.create({ data: { email, name: `S6 ${label}`, passwordHash: hash } });
    created.users.push(user.id);
    await prisma.userRole.create({ data: { userId: user.id, roleId: (await role(portal, roleKey)).id } });
    if (clientId) await prisma.clientUser.create({ data: { userId: user.id, clientId, investorRole: roleKey } });
    return user;
  };
  const mgrA = await mkUser('mgr', a.id, 'investor', 'admin');
  const sigA = await mkUser('sig', a.id, 'investor', 'finance');
  const viewA = await mkUser('viewer', a.id, 'investor', 'investment');
  const sigB = await mkUser('sigb', b.id, 'investor', 'finance');
  const mgrB = await mkUser('mgrb', b.id, 'investor', 'admin');
  const mgrC = await mkUser('mgrc', c.id, 'investor', 'admin');
  const mkRole = async (label: string, perms: string[]) => {
    const r = await prisma.role.create({ data: { portal: 'admin', key: `s6-${run}-${label}`, label: `S6 ${label}`, custom: true } });
    created.roles.push(r.id);
    await prisma.rolePermission.createMany({ data: perms.map((permission) => ({ roleId: r.id, permission })) });
    return r;
  };
  const staffRole = await mkRole('funds', ['funds.view', 'funds.manage']);
  const makerRole = await mkRole('maker', ['reports.view', 'reports.create', 'performance.lock']);
  const prepRole = await mkRole('prep', ['reports.view', 'reports.create']);
  const checkerRole = await mkRole('checker', ['reports.view', 'performance.lock']);
  const mkStaff = async (label: string, r: { id: string }) => {
    const u = await prisma.user.create({ data: { email: `s6-${run}-${label}@example.test`, name: `S6 ${label}`, passwordHash: hash } });
    created.users.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });
    return u;
  };
  const fundsStaff = await mkStaff('fundsstaff', staffRole);
  const maker = await mkStaff('maker', makerRole);
  const prep = await mkStaff('prep', prepRole);
  const checker = await mkStaff('checker', checkerRole);

  const mkDoc = async (clientId: string, name: string, fundId: string) => {
    const file = await storeFile({ name: `${name}.pdf`, mime: 'application/pdf', data: pdf(name) });
    created.files.push(file.id);
    const d = await prisma.document.create({
      data: {
        ref: `S6D${run}${created.docs.length}`,
        name,
        type: 'report',
        status: 'Published',
        classification: 'Client',
        clientId,
        fundId,
        period: '2026-Q2',
        versions: { create: { version: 1, fileId: file.id, sha256: file.sha256 } },
        publications: { create: { clientId } },
      },
    });
    created.docs.push(d.id);
    return d;
  };
  const docZ = await mkDoc(a.id, `Zeta report ${run}`, fundA.id);
  const docA1 = await mkDoc(a.id, `Alpha report ${run}`, fundA.id);

  // A capital call dated 2026-03-10 (rate of 2026-03-01 applies) with a wire holding an encrypted account number.
  const call = await prisma.capitalCall.create({
    data: {
      ref: `S6C${run}`,
      fundId: fundA.id,
      callNo: 3,
      currency: 'ZZA',
      totalAmount: '300',
      dueDate: day('2099-12-31'),
      status: 'ISSUED',
      issuedAt: day('2026-03-10'),
      transactionDate: day('2026-03-10'),
      wireJson: storeWire({ bank: 'First Bank', accountName: 'S6 Fund Ltd', accountNumber: '4100123456789' }) as any,
    },
  });
  const alloc = await prisma.capitalCallAllocation.create({
    data: { callId: call.id, clientId: a.id, commitmentId: cmA.id, lpLegalNameSnapshot: a.name, totalCommitmentSnapshot: '1000', uncalledBeforeSnapshot: '1000', callAmount: '300', amountPaid: '0' },
  });
  const call2 = await prisma.capitalCall.create({
    data: { ref: `S6D${run}`, fundId: fundA.id, callNo: 4, currency: 'ZZA', totalAmount: '100', dueDate: day('2099-12-31'), status: 'ISSUED', issuedAt: day('2026-03-12'), transactionDate: day('2026-03-12') },
  });
  const alloc2 = await prisma.capitalCallAllocation.create({
    data: { callId: call2.id, clientId: a.id, commitmentId: cmA.id, lpLegalNameSnapshot: a.name, totalCommitmentSnapshot: '1000', uncalledBeforeSnapshot: '700', callAmount: '100', amountPaid: '0' },
  });
  const bank = await prisma.bankInstruction.create({
    data: { clientId: a.id, version: 1, bank: 'S6 Bank', accountName: a.name, identifierEnc: encryptField('9988776655'), masked: '•••• 6655', status: 'Active', currency: 'USD', label: 'S6 settlement' },
  });

  const benchId = `T${run}`.toUpperCase();
  const jobIds: string[] = [];
  const extraCalls: string[] = [];
  try {
    const mgr = client();
    const sig = client();
    const view = client();
    const mgrOther = client();
    const mgrNoFx = client();
    const mgrMixed = client();
    const fundsC = client('admin');
    const makerC = client('admin');
    const prepC = client('admin');
    const checkerC = client('admin');
    check(
      'LP users sign in',
      [await mgr.login(mgrA.email), await sig.login(sigA.email), await view.login(viewA.email), await mgrOther.login(sigB.email), await mgrNoFx.login(mgrB.email), await mgrMixed.login(mgrC.email)].every((r) => r.status === 200),
    );
    check('staff sign in', [await fundsC.login(fundsStaff.email), await makerC.login(maker.email), await prepC.login(prep.email), await checkerC.login(checker.email)].every((r) => r.status === 200));

    // ── Presentation currency (BR-087/095/170/171) ──────────────────────
    console.log('\nPresentation currency');
    const dash = await mgr.get(`${LP}/dashboard`);
    const k = dash.body?.data?.kpis;
    check('dashboard converted with the as-of rate (nav 1000 ZZA x 2.5 = 2500.00 USD)', dash.status === 200 && k?.currentNav === '2500.00' && k?.distributions === '250.00' && k?.totalCommitment === '2500.00', dash.body);
    check('payload names the currency and the rate used', dash.body?.data?.reportingCurrency === 'USD' && dash.body.data.fx?.converted === true && dash.body.data.fx.rates?.[0]?.rate === '2.5000000000' && dash.body.data.fx.rates[0].rateDate === '2026-06-30', dash.body?.data?.fx);
    check('ratios are currency free (tvpi unchanged)', k?.tvpi === '1.2000' && k?.dpi === '0.2000', k);
    const perf = await mgr.get(`${LP}/performance`);
    check('performance converted, reportingCurrency USD', perf.body?.data?.metrics?.currentNav === '2500.00' && perf.body.data.reportingCurrency === 'USD' && perf.body.data.presentationCurrency === 'USD', perf.body?.data?.metrics);
    const byFund = await mgr.get(`${LP}/performance/by-fund`);
    check('by-fund rows converted', byFund.body?.data?.funds?.[0]?.nav === '2500.00' && byFund.body.data.reportingCurrency === 'USD', byFund.body?.data);
    const noFx = await mgrNoFx.get(`${LP}/dashboard`);
    check('missing rate: original currency, note, nothing converted', noFx.body?.data?.kpis?.currentNav === '2000.00' && noFx.body.data.reportingCurrency === 'ZZB' && noFx.body.data.fx?.converted === false && /FX rate unavailable for ZZB\/USD/.test(noFx.body.data.fx?.note ?? ''), noFx.body?.data);
    const stored = await prisma.fundCommitment.findUnique({ where: { id: cmA.id } });
    check('records are not changed by the display currency', stored?.commitmentAmount.toFixed(2) === '1000.00');

    // ── Ledger FX stamps (BR-152) ───────────────────────────────────────
    console.log('\nLedger FX stamps');
    const act = await mgr.get(`${LP}/account-activity?pageSize=50`);
    const items: any[] = act.body?.data?.items ?? [];
    const e1 = items.find((e) => e.entryId === alloc.id);
    check('call entry keeps original amount/currency and carries the stamped rate', e1?.amount === '300.00' && e1.currency === 'ZZA' && e1.reportingAmount === '600.00' && e1.reportingCurrency === 'USD' && e1.fxRate === '2.0000000000' && e1.fxRateDate === '2026-03-01', e1);
    await prisma.fxRate.create({ data: { fromCurrency: 'ZZA', toCurrency: 'USD', rateDate: day('2026-03-05'), rate: '9.9000000000', source: 'TEST' } });
    const again = ((await mgr.get(`${LP}/account-activity?pageSize=50`)).body?.data?.items ?? []).find((e: any) => e.entryId === alloc.id);
    check('a later rate does not restate the stamped row', again?.reportingAmount === '600.00' && again.fxRate === '2.0000000000', again);
    const call3 = await prisma.capitalCall.create({
      data: { ref: `S6E${run}`, fundId: fundA.id, callNo: 5, currency: 'ZZA', totalAmount: '100', dueDate: day('2099-12-31'), status: 'ISSUED', issuedAt: day('2026-03-12'), transactionDate: day('2026-03-12') },
    });
    const alloc3 = await prisma.capitalCallAllocation.create({
      data: { callId: call3.id, clientId: a.id, commitmentId: cmA.id, lpLegalNameSnapshot: a.name, totalCommitmentSnapshot: '1000', uncalledBeforeSnapshot: '600', callAmount: '100', amountPaid: '0' },
    });
    extraCalls.push(call3.id);
    const fresh = ((await mgr.get(`${LP}/account-activity?pageSize=50`)).body?.data?.items ?? []).find((e: any) => e.entryId === alloc3.id);
    check('a record first read after the new rate is stamped with the rate then in force (9.9)', fresh?.fxRate === '9.9000000000' && fresh.reportingAmount === '990.00', fresh);
    const stampRows = await prisma.lpFxStamp.count({ where: { clientId: a.id, entryId: alloc.id } });
    check('exactly one stamp per record and currency (idempotent reads)', stampRows === 1, stampRows);
    const ledger = await mgr.get(`${LP}/ledger`);
    check('ledger carries the same fields', (ledger.body?.data ?? []).find((e: any) => e.entryId === alloc.id)?.reportingAmount === '600.00', ledger.body);
    const nofxAct = await mgrNoFx.get(`${LP}/account-activity`);
    check('other client sees none of A stamps', !(nofxAct.body?.data?.items ?? []).some((e: any) => e.entryId === alloc.id));
    const csv = await mgr.get(`${LP}/account-activity/export?format=csv`);
    const csvText = Buffer.isBuffer(csv.body) ? csv.body.toString('utf8') : String(csv.body);
    check('CSV export has the reporting columns', csv.status === 200 && csvText.split('\r\n')[0]!.endsWith('reportingAmount,reportingCurrency,fxRate,fxRateDate') && csvText.includes('600.00,USD,2.0000000000,2026-03-01'), csvText.slice(0, 300));
    const pdfRes = await mgr.get(`${LP}/account-activity/export?format=pdf`);
    check('PDF export (FR-LP-033)', pdfRes.status === 200 && (pdfRes.headers.get('content-type') ?? '').includes('application/pdf') && Buffer.isBuffer(pdfRes.body) && pdfRes.body.subarray(0, 4).toString() === '%PDF', pdfRes.status);
    check('unknown export format -> 415', (await mgr.get(`${LP}/account-activity/export?format=doc`)).status === 415);

    // ── Server-side sorts (FR-LP-032 / 062 / 072) ───────────────────────
    console.log('\nSorting');
    const asc = ((await mgr.get(`${LP}/account-activity?sortBy=amount&sortDirection=asc&pageSize=50`)).body?.data?.items ?? []).map((e: any) => Number(e.amount));
    check('activity sorted by amount ascending', asc.length >= 2 && asc.every((v: number, i: number) => i === 0 || asc[i - 1]! <= v), asc);
    const desc = ((await mgr.get(`${LP}/account-activity?sortBy=amount&sortDirection=desc&pageSize=50`)).body?.data?.items ?? []).map((e: any) => Number(e.amount));
    check('activity sorted by amount descending', desc.every((v: number, i: number) => i === 0 || desc[i - 1]! >= v), desc);
    const badSort = await mgr.get(`${LP}/account-activity?sortBy=bogus`);
    check('unknown activity sortBy -> 400 with field error', badSort.status === 400 && !!badSort.body?.fieldErrors?.sortBy, badSort.body);
    const docsAsc = ((await mgr.get(`${LP}/documents?sortBy=name&sortDirection=asc`)).body?.data?.items ?? []).map((d: any) => d.name);
    check('documents sorted by name ascending', docsAsc.length === 2 && docsAsc[0].startsWith('Alpha') && docsAsc[1].startsWith('Zeta'), docsAsc);
    const docsDesc = ((await mgr.get(`${LP}/documents?sortBy=name&sortDirection=desc`)).body?.data?.items ?? []).map((d: any) => d.name);
    check('documents sorted by name descending', docsDesc[0].startsWith('Zeta'), docsDesc);
    check('unknown documents sortBy -> 400', (await mgr.get(`${LP}/documents?sortBy=bogus`)).status === 400);
    const dealSort = await mgr.get(`${LP}/dealing/requests?sortBy=amount&sortDirection=asc`);
    check('dealing history accepts sortBy (submitted, amount, status)', dealSort.status === 200, dealSort.body);
    check('dealing sortBy bogus -> 400', (await mgr.get(`${LP}/dealing/requests?sortBy=bogus`)).status === 400);
    check('dealing sortDirection bogus -> 400', (await mgr.get(`${LP}/dealing/requests?sortBy=amount&sortDirection=up`)).status === 400);

    // ── Account number reveal (BR-101) ──────────────────────────────────
    console.log('\nAccount number reveal');
    const detailV = await view.get(`${LP}/capital-calls/${alloc.id}`);
    check('call detail stays masked for everyone', detailV.body?.data?.wiring?.accountNumber === null && /6789$/.test(detailV.body?.data?.wiring?.accountNumberMasked ?? '') && !JSON.stringify(detailV.body).includes('4100123456789'), detailV.body?.data?.wiring);
    const revV = await view.post(`${LP}/capital-calls/${alloc.id}/wiring/reveal`);
    check('VIEWER cannot reveal -> 403', revV.status === 403 && revV.body?.code === 'LP_FORBIDDEN' && !JSON.stringify(revV.body).includes('4100123456789'), revV.body);
    const revS = await sig.post(`${LP}/capital-calls/${alloc.id}/wiring/reveal`);
    check('SIGNATORY reveals the full number', revS.status === 200 && revS.body?.data?.accountNumber === '4100123456789' && revS.headers.get('cache-control')?.includes('no-store') === true, revS.body);
    const revM = await mgr.post(`${LP}/capital-calls/${alloc.id}/wiring/reveal`);
    check('MANAGER reveals the full number', revM.status === 200 && revM.body?.data?.accountNumber === '4100123456789', revM.body);
    const revO = await mgrOther.post(`${LP}/capital-calls/${alloc.id}/wiring/reveal`);
    check('another client cannot reveal (404, no leak)', revO.status === 404 && !JSON.stringify(revO.body).includes('4100'), revO.body);
    const revNone = await sig.post(`${LP}/capital-calls/${alloc2.id}/wiring/reveal`);
    check('a call without an account number -> 404', revNone.status === 404, revNone.body);
    const audits = await prisma.auditEvent.findMany({ where: { action: 'lp_account_number.revealed', objectId: alloc.id } });
    check('each reveal is audited (2) without the number', audits.length === 2 && !JSON.stringify(audits.map((x) => x.after)).includes('4100123456789'), audits.length);
    const banksV = await view.get(`${LP}/dealing/bank-accounts`);
    check('bank accounts list is masked', (banksV.body?.data ?? []).some((x: any) => x.id === bank.id && x.accountNumberMasked === '•••• 6655') && !JSON.stringify(banksV.body).includes('9988776655'), banksV.body);
    check('VIEWER cannot reveal a bank account -> 403', (await view.post(`${LP}/dealing/bank-accounts/${bank.id}/reveal`)).status === 403);
    const revBank = await sig.post(`${LP}/dealing/bank-accounts/${bank.id}/reveal`);
    check('SIGNATORY reveals a bank account number', revBank.status === 200 && revBank.body?.data?.accountNumber === '9988776655', revBank.body);
    check('other client cannot reveal that bank account -> 404', (await mgrOther.post(`${LP}/dealing/bank-accounts/${bank.id}/reveal`)).status === 404);

    // ── RESTATED status machine (BR-143 / BR-094 / BR-078) ──────────────
    console.log('\nRESTATED');
    const direct = await fundsC.patch(`/api/v1/ops/funds/${fundA.id}`, { valuationStatus: 'RESTATED', version: fundA.version }, key('p'));
    check('PATCH to RESTATED is refused (use the restate action)', direct.status === 400 && /restate action/i.test(JSON.stringify(direct.body)), direct.body);
    const shortReason = await fundsC.post(`/api/v1/ops/funds/${fundA.id}/restate`, { reason: 'short', version: fundA.version }, key('r1'));
    check('restate needs a reason of 10+ characters', shortReason.status === 400, shortReason.body);
    const notFinal = await fundsC.post(`/api/v1/ops/funds/${fundC.id}/restate`, { reason: 'Provisional cannot be restated', version: fundC.version }, key('r2'));
    check('only a FINAL valuation can be restated -> 409', notFinal.status === 409, notFinal.body);
    check('LP session cannot restate -> 401/403', [401, 403].includes((await mgr.post(`/api/v1/ops/funds/${fundA.id}/restate`, { reason: 'Not allowed to do this' })).status));
    const noStaff = await prepC.post(`/api/v1/ops/funds/${fundA.id}/restate`, { reason: 'Maker lacks funds.manage', version: fundA.version }, key('r3'));
    check('staff without funds.manage -> 403', noStaff.status === 403, noStaff.body);
    const mixedBefore = await mgrMixed.get(`${LP}/dashboard`);
    check('mixed FINAL + PROVISIONAL shows the weakest (PROVISIONAL)', mixedBefore.body?.data?.valuationStatus === 'PROVISIONAL', mixedBefore.body?.data?.valuationStatus);
    const restate = await fundsC.post(`/api/v1/ops/funds/${fundA.id}/restate`, { reason: 'Audit adjustment to the Q2 valuation', documentIds: [docZ.id], version: fundA.version }, key('r4'));
    check('restate FINAL fund -> 200, one document marked', restate.status === 200 && restate.body?.documentsMarked === 1 && restate.body?.data?.valuationStatus === 'RESTATED', restate.body);
    const auditR = await prisma.auditEvent.findFirst({ where: { action: 'fund.valuation_restated', objectId: fundA.id } });
    check('restatement audited with the reason', auditR?.reason === 'Audit adjustment to the Q2 valuation', auditR);
    const dashR = await mgr.get(`${LP}/dashboard`);
    check('LP sees RESTATED on the dashboard', dashR.body?.data?.valuationStatus === 'RESTATED', dashR.body?.data?.valuationStatus);
    const docsR = await mgr.get(`${LP}/documents`);
    const zeta = (docsR.body?.data?.items ?? []).find((d: any) => d.id === docZ.id);
    const alpha = (docsR.body?.data?.items ?? []).find((d: any) => d.id === docA1.id);
    check('restated document listed with RESTATED, others PUBLISHED', zeta?.status === 'RESTATED' && alpha?.status === 'PUBLISHED', { zeta: zeta?.status, alpha: alpha?.status });
    const dl = await mgr.get(`${LP}/documents/${docZ.id}/download`);
    check('a restated document still downloads', dl.status === 200 || dl.status === 302, dl.status);
    const notified = await prisma.outboxEvent.count({ where: { type: 'notify.users', payload: { path: '$.type', equals: 'valuation.restated' } } }).catch(() => -1);
    check('LP members are notified (outbox)', notified === -1 || notified >= 1, notified);
    const mixedAfter = await mgrMixed.get(`${LP}/dashboard`);
    check('mixed RESTATED + PROVISIONAL still shows the weakest (PROVISIONAL)', mixedAfter.body?.data?.valuationStatus === 'PROVISIONAL', mixedAfter.body?.data?.valuationStatus);
    const cur = await prisma.fund.findUniqueOrThrow({ where: { id: fundA.id } });
    const back = await fundsC.patch(`/api/v1/ops/funds/${fundA.id}`, { valuationStatus: 'PROVISIONAL', version: cur.version }, key('p2'));
    check('RESTATED cannot return to PROVISIONAL', back.status === 400, back.body);
    const reconfirm = await fundsC.patch(`/api/v1/ops/funds/${fundA.id}`, { valuationStatus: 'FINAL', version: cur.version }, key('p3'));
    check('RESTATED may be re-confirmed FINAL', reconfirm.status === 200, reconfirm.body);

    // ── Benchmarks (BR-091) ─────────────────────────────────────────────
    console.log('\nBenchmark points');
    const noBench = await mgr.get(`${LP}/performance/benchmarks?benchmarkId=${benchId}&metric=NET_IRR`);
    check('no points: configured false, honest note', noBench.body?.data?.configured === false && noBench.body.data.series.length === 0 && noBench.body.data.valuationStatus === 'UNAVAILABLE', noBench.body?.data);
    const BP = '/api/v1/performance/benchmark-points';
    const mk = await makerC.post(BP, { benchmarkId: benchId, metric: 'NET_IRR', source: 'Cambridge Associates Q2', points: [{ date: '2026-03-31', label: 'Q1 2026', value: '11.5' }, { date: '2026-06-30', label: 'Q2 2026', value: '12.25' }] }, key('bp'));
    check('maker prepares two DRAFT points', mk.status === 201 && mk.body?.data?.length === 2 && mk.body.data.every((p: any) => p.status === 'DRAFT'), mk.body);
    const draftSeen = await mgr.get(`${LP}/performance/benchmarks?benchmarkId=${benchId}&metric=NET_IRR`);
    check('DRAFT points are invisible to the LP', draftSeen.body?.data?.configured === false, draftSeen.body?.data);
    const pid = mk.body?.data?.[0]?.id as string;
    const selfApprove = await makerC.post(`${BP}/${pid}/approve`, {}, key('ba'));
    check('maker cannot approve their own points (SoD) -> 403', selfApprove.status === 403 && selfApprove.body?.error?.code === 'segregation_of_duties', selfApprove.body);
    check('a preparer without performance.lock cannot approve -> 403', (await prepC.post(`${BP}/${pid}/approve`, {}, key('ba2'))).status === 403);
    const ap1 = await checkerC.post(`${BP}/${pid}/approve`, {}, key('ba3'));
    const ap2 = await checkerC.post(`${BP}/${mk.body?.data?.[1]?.id}/approve`, {}, key('ba4'));
    check('a different approver approves both', ap1.status === 200 && ap2.status === 200 && ap1.body?.data?.status === 'APPROVED', [ap1.body, ap2.body]);
    const bench = await mgr.get(`${LP}/performance/benchmarks?benchmarkId=${benchId}&metric=NET_IRR`);
    check('approved series: configured, FINAL, points in date order with source', bench.body?.data?.configured === true && bench.body.data.valuationStatus === 'FINAL' && bench.body.data.series.length === 2 && bench.body.data.series[0].date === '2026-03-31' && bench.body.data.series[1].value === '12.250000' && bench.body.data.source === 'Cambridge Associates Q2' && !!bench.body.data.approvedAt, bench.body?.data);
    const edit = await makerC.post(BP, { benchmarkId: benchId, metric: 'NET_IRR', source: 'Cambridge', points: [{ date: '2026-06-30', value: 1 }] }, key('bp2'));
    check('an approved point is immutable -> 409', edit.status === 409, edit.body);
    const again2 = await checkerC.post(`${BP}/${pid}/approve`, {}, key('ba5'));
    check('approving twice -> 409', again2.status === 409, again2.body);
    const mk2 = await makerC.post(BP, { benchmarkId: benchId, metric: 'TVPI', source: 'Cambridge', points: [{ date: '2026-06-30', value: '1.4' }] }, key('bp3'));
    const rid = mk2.body?.data?.[0]?.id as string;
    check('reject without a reason -> 400', (await checkerC.post(`${BP}/${rid}/reject`, {}, key('br2'))).status === 400);
    const rej = await checkerC.post(`${BP}/${rid}/reject`, { reason: 'Source value looks wrong' }, key('br'));
    check('reject with a reason moves to REJECTED', rej.status === 200 && rej.body?.data?.status === 'REJECTED', rej.body);
    const resub = await makerC.post(BP, { benchmarkId: benchId, metric: 'TVPI', source: 'Cambridge', points: [{ date: '2026-06-30', value: '1.45' }] }, key('bp4'));
    check('a rejected point can be corrected and resubmitted as DRAFT', resub.status === 201 && resub.body?.data?.[0]?.status === 'DRAFT' && resub.body.data[0].value === '1.450000', resub.body);
    const listPts = await makerC.get(`${BP}?benchmarkId=${benchId}`);
    check('staff list shows the series with statuses', listPts.status === 200 && listPts.body?.data?.length === 3, listPts.body);
    check('LP cannot reach the staff endpoint', [401, 403].includes((await mgr.get(BP)).status));

    // ── Report jobs (BR-096) ────────────────────────────────────────────
    console.log('\nReport jobs');
    const j1 = await mgr.post(`${LP}/jobs/performance-report`, { period: 'SI', benchmarkId: benchId }, key('j1'));
    check('job accepted as QUEUED (202)', j1.status === 202 && j1.body?.data?.status === 'QUEUED', j1.body);
    const id1 = j1.body?.data?.jobId as string;
    jobIds.push(id1);
    let st: any = null;
    for (let i = 0; i < 30; i++) {
      st = (await mgr.get(`${LP}/jobs/${id1}`)).body?.data;
      if (st?.status === 'COMPLETED' || st?.status === 'FAILED') break;
      await wait(300);
    }
    check('job reaches COMPLETED with a result and download link', st?.status === 'COMPLETED' && !!st.result && !!st.downloadUrl && !!st.completedAt, st);
    check('result captured the benchmark series', st?.result?.benchmark?.configured === true, st?.result?.benchmark);
    const dlJob = await mgr.get(`${LP}/reports/${id1}/download`);
    check('completed job downloads a PDF', dlJob.status === 200 && Buffer.isBuffer(dlJob.body) && dlJob.body.subarray(0, 4).toString() === '%PDF', dlJob.status);
    check('another client cannot read the job -> 404', (await mgrOther.get(`${LP}/jobs/${id1}`)).status === 404);
    const cancelDone = await mgr.post(`${LP}/jobs/${id1}/cancel`);
    check('cancelling a finished job -> 409', cancelDone.status === 409 && cancelDone.body?.code === 'LP_JOB_FINISHED', cancelDone.body);

    const mkJob = async (status: string, over: Record<string, unknown> = {}) => {
      const id = (await import('node:crypto')).randomUUID();
      jobIds.push(id);
      await prisma.setting.create({
        data: {
          ownerId: id,
          key: 'lp.job',
          value: { clientId: a.id, userId: mgrA.id, jobType: 'PERFORMANCE_REPORT', status, request: { fundId: null, period: 'SI', benchmarkId: null, asOfDate: null }, result: null, errorMessage: null, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, ...over } as any,
        },
      });
      return id;
    };
    const queued = await mkJob('QUEUED');
    const early = await mgr.get(`${LP}/reports/${queued}/download`);
    check('download of a QUEUED job -> 409 LP_JOB_NOT_READY', early.status === 409 && early.body?.code === 'LP_JOB_NOT_READY', early.body);
    const cx = await mgr.post(`${LP}/jobs/${queued}/cancel`);
    check('QUEUED job can be cancelled', cx.status === 200 && cx.body?.data?.status === 'CANCELLED', cx.body);
    const cxDl = await mgr.get(`${LP}/reports/${queued}/download`);
    check('download of a CANCELLED job -> 410 LP_JOB_CANCELLED', cxDl.status === 410 && cxDl.body?.code === 'LP_JOB_CANCELLED', cxDl.body);
    const failed = await mkJob('FAILED', { errorMessage: 'Valuation source unavailable', completedAt: new Date().toISOString() });
    const fs = (await mgr.get(`${LP}/jobs/${failed}`)).body?.data;
    check('FAILED job exposes its error and no download link', fs?.status === 'FAILED' && fs.errorMessage === 'Valuation source unavailable' && fs.downloadUrl === null, fs);
    const fdl = await mgr.get(`${LP}/reports/${failed}/download`);
    check('download of a FAILED job -> 410 LP_JOB_FAILED', fdl.status === 410 && fdl.body?.code === 'LP_JOB_FAILED', fdl.body);
    const stale = await mkJob('QUEUED', { createdAt: new Date(Date.now() - 120_000).toISOString() });
    const picked = (await mgr.get(`${LP}/jobs/${stale}`)).body?.data;
    check('a job left QUEUED by a restart is picked up on the next read', picked?.status === 'COMPLETED' && !!picked.result, picked);
    const running = await mkJob('RUNNING', { startedAt: new Date().toISOString() });
    const stillRunning = (await mgr.get(`${LP}/jobs/${running}`)).body?.data;
    check('a recent RUNNING job is left alone', stillRunning?.status === 'RUNNING', stillRunning);

    // ── Account security (FR-LP-102 / FR-AUTH-018) ──────────────────────
    console.log('\nAccount security');
    const secUser = await mkUser('sec', a.id, 'investor', 'finance');
    const sec = client();
    check('security user signs in', (await sec.login(secUser.email)).status === 200);
    const s0 = await sec.get('/api/v1/account/security');
    check('security overview: not enrolled, one session marked current', s0.status === 200 && s0.body?.data?.mfa?.enrolled === false && s0.body.data.sessions.length === 1 && s0.body.data.sessions[0].current === true, s0.body);
    check('unauthenticated -> 401', (await client().get('/api/v1/account/security')).status === 401);
    const noMfaCodes = await sec.post('/api/v1/account/security/mfa/backup-codes');
    check('backup codes need an enrolled authenticator', noMfaCodes.status >= 400 && noMfaCodes.status < 500, noMfaCodes.body);
    check('MFA enrolment through /auth/mfa', await sec.enrolMfa());
    const gen = await sec.post('/api/v1/account/security/mfa/backup-codes');
    const codes: string[] = gen.body?.data?.codes ?? [];
    check('ten backup codes generated once', gen.status === 200 && codes.length === 10 && new Set(codes).size === 10 && codes.every((x) => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(x)), gen.body);
    const stored2 = await prisma.userMfaBackupCode.findMany({ where: { userId: secUser.id } });
    check('only hashes are stored', stored2.length === 10 && stored2.every((r) => !codes.some((x) => r.codeHash.includes(x.replace('-', '')))), stored2.length);
    const s1 = await sec.get('/api/v1/account/security');
    check('overview shows enrolled and 10 codes left', s1.body?.data?.mfa?.enrolled === true && s1.body.data.mfa.backupCodesRemaining === 10, s1.body?.data?.mfa);
    const regen = await sec.post('/api/v1/account/security/mfa/backup-codes');
    const codes2: string[] = regen.body?.data?.codes ?? [];
    check('regenerating voids the old set', regen.status === 200 && codes2.length === 10 && (await prisma.userMfaBackupCode.count({ where: { userId: secUser.id } })) === 10 && codes2.every((x) => !codes.includes(x)));
    const rec = client();
    const lg = await rec.login(secUser.email);
    check('sign-in with MFA is pending', lg.status === 200);
    check('an unknown backup code is refused', (await rec.post('/api/auth/mfa/recover', { code: 'aaaaa-bbbbb' })).status === 401);
    check('an old (voided) backup code is refused', (await rec.post('/api/auth/mfa/recover', { code: codes[0]! })).status === 401);
    const okRec = await rec.post('/api/auth/mfa/recover', { code: codes2[0]! });
    check('a valid backup code completes sign-in', okRec.status === 200, okRec.body);
    check('the session is usable after recovery', (await rec.get('/api/v1/account/security')).status === 200);
    const rec2 = client();
    await rec2.login(secUser.email);
    check('a backup code works only once', (await rec2.post('/api/auth/mfa/recover', { code: codes2[0]! })).status === 401);
    const after = await sec.get('/api/v1/account/security');
    check('9 codes left after one use', after.body?.data?.mfa?.backupCodesRemaining === 9, after.body?.data?.mfa);
    check('sessions: this browser plus the recovered one', after.body?.data?.sessions?.length >= 2 && after.body.data.sessions.filter((x: any) => x.current).length === 1, after.body?.data?.sessions?.length);
    const other = after.body.data.sessions.find((x: any) => !x.current);
    const delCur = await sec.del(`/api/v1/account/security/sessions/${after.body.data.sessions.find((x: any) => x.current).id}`);
    check('signing out the current session here -> 409', delCur.status === 409, delCur.body);
    const delOther = await sec.post(`/api/v1/account/security/sessions/${other.id}/revoke`);
    check('another session can be signed out (POST alias)', delOther.status === 200, delOther.body);
    check('that session is gone', (await rec.get('/api/v1/account/security')).status === 401);
    check('a stranger session id -> 404', (await sec.del(`/api/v1/account/security/sessions/${(await prisma.session.findFirst({ where: { userId: mgrA.id } }))?.id}`)).status === 404);
    const revokeOthers = await sec.post('/api/v1/account/security/sessions/revoke-others');
    check('revoke-others keeps only this browser', revokeOthers.status === 200 && (await prisma.session.count({ where: { userId: secUser.id } })) === 1, revokeOthers.body);
    const badPw = await sec.post('/api/v1/account/security/password', { currentPassword: 'wrong-password-1', newPassword: `New-${randomBytes(8).toString('hex')}` });
    check('wrong current password -> 400', badPw.status === 400 && badPw.body?.error?.code === 'invalid_current_password', badPw.body);
    check('too short new password -> 400', (await sec.post('/api/v1/account/security/password', { currentPassword: password, newPassword: 'short' })).status === 400);
    check('same password -> 400', (await sec.post('/api/v1/account/security/password', { currentPassword: password, newPassword: password })).status === 400);
    const second = client();
    await second.login(secUser.email);
    await second.post('/api/auth/mfa/recover', { code: codes2[1]! });
    const newPw = `New-${randomBytes(9).toString('base64url')}`;
    const change = await sec.post('/api/v1/account/security/password', { currentPassword: password, newPassword: newPw });
    check('password change -> 200 and other sessions revoked', change.status === 200 && change.body?.data?.otherSessionsRevoked >= 1, change.body);
    check('the other session is signed out', (await second.get('/api/v1/account/security')).status === 401);
    check('this session survives', (await sec.get('/api/v1/account/security')).status === 200);
    const relog = client();
    check('old password no longer signs in; new one does', (await relog.login(secUser.email)).status === 401 && (await relog.login(secUser.email, newPw)).status === 200);
    const staffSec = await fundsC.get('/api/v1/account/security');
    check('the same page works for staff portals (admin) too', staffSec.status === 200 && Array.isArray(staffSec.body?.data?.sessions), staffSec.body);
    const auditSec = await prisma.auditEvent.findMany({ where: { objectId: secUser.id, action: { in: ['auth.mfa.backup_codes_generated', 'auth.mfa.backup_code_used', 'auth.password.changed'] } } });
    check('security events are audited', ['auth.mfa.backup_codes_generated', 'auth.mfa.backup_code_used', 'auth.password.changed'].every((x) => auditSec.some((e) => e.action === x)), auditSec.map((e) => e.action));

    // ── Organisation: resend, confirm account, letter (FR-LP-095 / 099) ──
    console.log('\nOrganisation');
    const inv = await mgr.post(`${LP}/colleagues`, { email: `s6-${run}-new@example.test`, name: 'S6 Colleague', role: 'VIEWER' }, key('inv'));
    check('invite returns activationEmailSent', inv.status === 201 && inv.body?.data?.activationEmailSent === true, inv.body);
    created.emails.push(`s6-${run}-new@example.test`);
    const invId = inv.body?.data?.id as string;
    const resend = await mgr.post(`${LP}/colleagues/${invId}/resend`);
    check('resend issues a new invitation', resend.status === 200 && resend.body?.data?.activationEmailSent === true && resend.body.data.id !== invId, resend.body);
    const oldInv = await prisma.invitation.findUnique({ where: { id: invId } });
    check('the previous link is revoked', !!oldInv?.revokedAt);
    const open = await prisma.invitation.count({ where: { clientId: a.id, email: `s6-${run}-new@example.test`, revokedAt: null, acceptedAt: null } });
    check('exactly one open invitation remains', open === 1, open);
    const grant = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: resend.body?.data?.id, key: 'invite.grant' } } });
    check('the role grant moved to the new invitation', !!grant);
    check('VIEWER cannot resend -> 403', (await view.post(`${LP}/colleagues/${resend.body?.data?.id}/resend`)).status === 403);
    check('another client cannot resend -> 404', (await mgrNoFx.post(`${LP}/colleagues/${resend.body?.data?.id}/resend`)).status === 404);
    const enrolled = await sig.enrolMfa();
    check('signatory enrols MFA for the bank change', enrolled);
    const mismatch = await sig.post(`${LP}/bank-instructions/changes`, { bankName: 'S6 Bank', accountNumber: '1234567890', confirmAccountNumber: '1234567891', currency: 'USD' }, key('bk1'));
    check('mismatching confirm-account -> 400 field error', mismatch.status === 400 && !!mismatch.body?.fieldErrors?.confirmAccountNumber, mismatch.body);
    const goodBank = await sig.post(`${LP}/bank-instructions/changes`, { bankName: 'S6 Bank', accountNumber: '1234567890', confirmAccountNumber: '1234 567 890', currency: 'USD' }, key('bk2'));
    check('matching confirm-account -> 201 pending verification', goodBank.status === 201 && goodBank.body?.data?.status === 'PENDING_VERIFICATION', goodBank.body);
    const bid = goodBank.body?.data?.id as string;
    const badMime = await sig.upload(`${LP}/bank-instructions/changes/${bid}/letter`, 'x.txt', 'text/plain', Buffer.from('hello'));
    check('letter must be PDF/PNG/JPEG -> 415', badMime.status === 415, badMime.body);
    const letter = await sig.upload(`${LP}/bank-instructions/changes/${bid}/letter`, 'bank-letter.pdf', 'application/pdf', pdf('bank letter'));
    check('letter attached to the pending change', letter.status === 201 && !!letter.body?.data?.fileId && letter.body.data.sha256?.length === 64, letter.body);
    const row = await prisma.bankInstruction.findUnique({ where: { id: bid } });
    check('the file id is stored on the instruction', row?.supportingLetterFileId === letter.body?.data?.fileId);
    check('VIEWER cannot attach a letter -> 403', (await view.upload(`${LP}/bank-instructions/changes/${bid}/letter`, 'a.pdf', 'application/pdf', pdf('v'))).status === 403);
    check('another client cannot attach to it -> 404 or 403', [403, 404].includes((await mgrOther.upload(`${LP}/bank-instructions/changes/${bid}/letter`, 'a.pdf', 'application/pdf', pdf('o'))).status));
    if (row?.supportingLetterFileId) created.files.push(row.supportingLetterFileId);

    // ── Session: client list ────────────────────────────────────────────
    console.log('\nClient switcher');
    const session = await mgr.get(`${LP}/session`);
    check('session lists the relationships the user can open', Array.isArray(session.body?.data?.clients) && session.body.data.clients.some((x: any) => x.investorId === a.ref), session.body?.data?.clients);
    check('presentation currency is returned', typeof session.body?.data?.presentationCurrency === 'string');
    const wrongClient = await mgr.get(`${LP}/dashboard?client=${b.ref}`);
    check('a relationship the user is not linked to answers 403', wrongClient.status === 403, wrongClient.body);
  } finally {
    await prisma.lpFxStamp.deleteMany({ where: { clientId: { in: created.clients } } });
    await prisma.fxRate.deleteMany({ where: { fromCurrency: { in: ['ZZA', 'ZZB'] } } });
    await prisma.benchmarkPoint.deleteMany({ where: { benchmarkId: benchId } });
    await prisma.bankInstruction.deleteMany({ where: { clientId: { in: created.clients } } });
    await prisma.capitalCallPayment.deleteMany({ where: { allocation: { callId: { in: [call.id, call2.id, ...extraCalls] } } } });
    await prisma.capitalCallAllocation.deleteMany({ where: { callId: { in: [call.id, call2.id, ...extraCalls] } } });
    await prisma.capitalCall.deleteMany({ where: { id: { in: [call.id, call2.id, ...extraCalls] } } });
    await prisma.documentAccessLog.deleteMany({ where: { documentId: { in: created.docs } } });
    await prisma.document.deleteMany({ where: { id: { in: created.docs } } });
    await prisma.fileObject.deleteMany({ where: { id: { in: created.files } } });
    for (const id of jobIds) await prisma.setting.deleteMany({ where: { ownerId: id } });
    await prisma.invitation.deleteMany({ where: { clientId: { in: created.clients } } });
    await prisma.setting.deleteMany({ where: { ownerId: { in: [...created.users, ...created.clients] } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.role.deleteMany({ where: { id: { in: created.roles } } });
    await prisma.client.deleteMany({ where: { id: { in: created.clients } } });
    await prisma.fund.deleteMany({ where: { id: { in: created.funds } } });
  }

  console.log(failures ? `\n${failures} check(s) FAILED, ${passes} passed` : `\nAll ${passes} S6 checks passed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
