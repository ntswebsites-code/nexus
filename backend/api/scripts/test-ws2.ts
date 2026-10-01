/**
 * WS2 end-to-end checks against a RUNNING API: funds and commitments, the J3 capital call
 * (draft -> approve -> issue -> acknowledge -> evidence -> paid), distributions, the J4 dealing
 * flow, and the guards around them (segregation of duties, step-up, idempotency, IDOR, LP roles).
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4152 npx tsx scripts/test-ws2.ts
 *
 * Creates throwaway users, clients and funds (best-effort removal at the end); disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ws2-${randomBytes(9).toString('base64url')}`;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const key = (label: string) => `ws2-${run}-${label}-${randomBytes(4).toString('hex')}`;

interface Res {
  status: number;
  body: any;
  headers: Headers;
}

function client(portal: 'admin' | 'investor') {
  const origin = portal === 'admin' ? config.portalUrls.admin : config.portalUrls.investor;
  let cookie = '';
  let secret = '';
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
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
  return {
    send,
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    patch: (p: string, b?: unknown, h?: Record<string, string>) => send('PATCH', p, b ?? {}, h),
    put: (p: string, b?: unknown, h?: Record<string, string>) => send('PUT', p, b ?? {}, h),
    login: (email: string) => send('POST', '/api/auth/login', { email, password, portal }),
    /** Enrols TOTP on the current session and verifies it (sets mfaVerifiedAt). */
    async enrolMfa() {
      const e = await send('POST', '/api/auth/mfa/enroll', {});
      secret = e.body?.secret ?? '';
      const v = await send('POST', '/api/auth/mfa/verify', { code: totpNow(secret) });
      return e.status === 200 && v.status === 200;
    },
    stepUp: () => send('POST', '/api/auth/mfa/step-up', { code: totpNow(secret) }),
  };
}
type Client = ReturnType<typeof client>;

const OPS = '/api/v1/ops';
const LP = '/api/v1/lp-portal';
const pdfBytes = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });

  const userIds: string[] = [];
  const clientIds: string[] = [];
  const fundIds: string[] = [];

  const mkClient = async (suffix: string) => {
    const c = await prisma.client.create({
      data: { ref: `X${run}${suffix}`, name: `WS2 Client ${suffix} ${run}`, type: 'Pension fund', portalEnabled: true, kycStatus: 'Current' },
    });
    clientIds.push(c.id);
    return c;
  };
  const mkStaff = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `ws2-${run}-${label}@example.test`, name: `WS2 ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role('admin', roleKey)).id } });
    return u;
  };
  const mkLp = async (label: string, clientId: string, investorRole: string) => {
    const u = await prisma.user.create({ data: { email: `ws2-${run}-${label}@example.test`, name: `WS2 ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role('investor', investorRole)).id } });
    await prisma.clientUser.create({ data: { userId: u.id, clientId, investorRole } });
    return u;
  };

  const A = await mkClient('A');
  const B = await mkClient('B');
  const makerU = await mkStaff('ops', 'operations');
  const approverU = await mkStaff('dir', 'investment_director');
  const servicesU = await mkStaff('svc', 'client_services');
  const dualU = await mkStaff('dual', 'operations');
  await prisma.userRole.create({ data: { userId: dualU.id, roleId: (await role('admin', 'compliance')).id } });
  const aFinU = await mkLp('afin', A.id, 'finance');
  const aViewU = await mkLp('aview', A.id, 'auditor');
  const bFinU = await mkLp('bfin', B.id, 'finance');

  const maker = client('admin');
  const approver = client('admin');
  const services = client('admin');
  const dual = client('admin');
  const aFin = client('investor');
  const aView = client('investor');
  const bFin = client('investor');

  try {
    console.log('\nSign-in and MFA');
    check('maker signs in', (await maker.login(makerU.email)).status === 200);
    check('approver signs in', (await approver.login(approverU.email)).status === 200);
    check('client services signs in', (await services.login(servicesU.email)).status === 200);
    check('maker enrols TOTP', await maker.enrolMfa());
    check('approver enrols TOTP', await approver.enrolMfa());
    check('dual-role user (maker + approver permissions) signs in', (await dual.login(dualU.email)).status === 200 && (await dual.enrolMfa()));
    for (const [c, u] of [
      [aFin, aFinU],
      [aView, aViewU],
      [bFin, bFinU],
    ] as const) {
      check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    }

    // ------------------------------------------------------------------ funds
    console.log('\nFunds and commitments');
    const fundRes = await maker.post(`${OPS}/funds`, {
      name: `WS2 Growth Fund ${run}`,
      shortName: 'WS2G',
      currency: 'USD',
      operatingModel: 'PRIVATE_CAPITAL',
      vintage: 2026,
      wiring: { bank: 'Test Bank', accountName: 'WS2 Growth Fund LP', accountNumber: '0011223344', abaRouting: '021000021' },
    });
    const fund = fundRes.body?.data;
    if (fund?.id) fundIds.push(fund.id);
    check('create fund -> 201 with FND ref', fundRes.status === 201 && /^FND-\d{4}$/.test(fund?.ref ?? ''), fundRes.body);
    check('fund wiring masked, number never returned', fund?.wiring?.accountNumberMasked?.endsWith('3344') && !JSON.stringify(fund).includes('0011223344'), fund?.wiring);
    const svcCreate = await services.post(`${OPS}/funds`, { name: 'Nope', shortName: 'N' });
    check('client services cannot create a fund (403)', svcCreate.status === 403, svcCreate.body);
    check('client services can list funds', (await services.get(`${OPS}/funds`)).status === 200);

    const cA = await maker.post(`${OPS}/funds/${fund.id}/commitments`, { clientId: A.id, commitmentAmount: '1000000', investorAccountRef: `ACC-A-${run}` });
    const cB = await maker.post(`${OPS}/funds/${fund.id}/commitments`, { clientId: B.ref, commitmentAmount: '500000' });
    check('commitment A created', cA.status === 201, cA.body);
    check('commitment B created (client by ref)', cB.status === 201, cB.body);
    const dup = await maker.post(`${OPS}/funds/${fund.id}/commitments`, { clientId: A.id, commitmentAmount: '5' });
    check('duplicate commitment -> 409', dup.status === 409, dup.body);
    const patchB = await maker.patch(`${OPS}/commitments/${cB.body?.data?.id}`, { commitmentAmount: '600000', version: cB.body?.data?.version });
    check('commitment B raised to 600,000', patchB.status === 200 && patchB.body?.data?.commitmentAmount === '600000.00', patchB.body);
    const stale = await maker.patch(`${OPS}/commitments/${cB.body?.data?.id}`, { notes: 'x', version: 1 });
    check('stale commitment version -> 409', stale.status === 409, stale.body);
    const fundDetail = await services.get(`${OPS}/funds/${fund.id}`);
    check('fund detail lists 2 commitments totalling 1,600,000', fundDetail.body?.data?.commitments?.length === 2 && fundDetail.body?.data?.totalCommitment === '1600000.00', fundDetail.body?.data);

    // ------------------------------------------------------------------ J3
    console.log('\nJ3 capital call: draft -> approval');
    const created = await maker.post(`${OPS}/capital-calls`, {
      fundId: fund.id,
      callDate: day(0),
      dueDate: day(14),
      purpose: 'Follow-on investment in Portfolio Co',
      totalAmount: '150000.01',
      allocationMethod: 'PRO_RATA',
    });
    const call = created.body?.data;
    check('create call -> 201 DRAFT', created.status === 201 && call?.status === 'DRAFT', created.body);
    const allocA = call?.allocations?.find((a: any) => a.clientId === A.id);
    const allocB = call?.allocations?.find((a: any) => a.clientId === B.id);
    check('pro-rata split, remainder to the largest commitment', allocA?.callAmount === '93750.01' && allocB?.callAmount === '56250.00', call?.allocations);
    check('wire defaults to the fund wiring', call?.wire?.bank === 'Test Bank', call?.wire);

    const lpBefore = await aFin.get(`${LP}/capital-calls`);
    check('LP cannot see a draft call', lpBefore.status === 200 && lpBefore.body?.data?.items?.length === 0, lpBefore.body);

    check('maker submits', (await maker.post(`${OPS}/capital-calls/${call.id}/submit`)).body?.data?.status === 'PENDING_APPROVAL');
    await maker.stepUp();
    const sod = await maker.post(`${OPS}/capital-calls/${call.id}/approve`, {}, { 'Idempotency-Key': key('sod') });
    check('maker without capital.approve cannot approve -> 403 permission_denied', sod.status === 403 && sod.body?.error?.code === 'permission_denied', sod.body);

    const noKey = await approver.post(`${OPS}/capital-calls/${call.id}/approve`, {});
    check('approve without Idempotency-Key -> 400', noKey.status === 400 && noKey.body?.error?.code === 'idempotency_key_required', noKey.body);

    await prisma.session.updateMany({ where: { userId: approverU.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    const stepNeg = await approver.post(`${OPS}/capital-calls/${call.id}/approve`, {}, { 'Idempotency-Key': key('stale') });
    check('approve with stale MFA -> 401 step_up_required', stepNeg.status === 401 && stepNeg.body?.error?.code === 'step_up_required', stepNeg.body);
    const su = await approver.stepUp();
    check('step-up with TOTP', su.status === 200, su.body);

    const approveKey = key('approve');
    const approved = await approver.post(`${OPS}/capital-calls/${call.id}/approve`, {}, { 'Idempotency-Key': approveKey });
    check('approver approves -> APPROVED', approved.status === 200 && approved.body?.data?.status === 'APPROVED' && approved.body?.data?.checkerId === approverU.id, approved.body);
    await sleep(400);
    const replay = await approver.post(`${OPS}/capital-calls/${call.id}/approve`, {}, { 'Idempotency-Key': approveKey });
    check('same key + same body replays', replay.status === 200 && replay.headers.get('idempotent-replayed') === 'true' && replay.body?.data?.status === 'APPROVED', { s: replay.status, b: replay.body });
    const reused = await approver.post(`${OPS}/capital-calls/${call.id}/approve`, { note: 'different' }, { 'Idempotency-Key': approveKey });
    check('same key + different body -> 409 idempotency_key_reused', reused.status === 409 && reused.body?.error?.code === 'idempotency_key_reused', reused.body);

    console.log('\nJ3 capital call: issue -> LP');
    await maker.stepUp();
    const issued = await maker.post(`${OPS}/capital-calls/${call.id}/issue`, {}, { 'Idempotency-Key': key('issue') });
    check('maker issues -> ISSUED', issued.status === 200 && issued.body?.data?.status === 'ISSUED', issued.body);

    const list = await aFin.get(`${LP}/capital-calls`);
    const item = list.body?.data?.items?.[0];
    check('LP list shows the call in the envelope', list.status === 200 && list.body?.success === true && list.body?.data?.items?.length === 1, list.body);
    check('LP item is the allocation with mock shapes', item?.id === allocA?.id && item?.amount === '93750.01' && item?.paid === '0.00' && item?.outstanding === '93750.01' && item?.status === 'ISSUED' && item?.callNo === 1, item);
    const detail = await aFin.get(`${LP}/capital-calls/${allocA.id}`);
    const d = detail.body?.data;
    check('detail wiring masked, accountNumber null', d?.wiring?.accountNumber === null && d?.wiring?.accountNumberMasked?.endsWith('3344') && !JSON.stringify(d).includes('0011223344'), d?.wiring);
    check('detail reference = account ref / call no', d?.wiring?.reference === `ACC-A-${run} / CC-001`, d?.wiring);
    check('timeline codes', d?.timeline?.map((t: any) => t.code).join() === 'ISSUED,ACKNOWLEDGED,PAYMENT_RECEIVED,ALLOCATED' && d.timeline[0].completed === true && d.timeline[1].completed === false, d?.timeline);
    const summary = await aFin.get(`${LP}/capital-calls/summary`);
    check('summary: 1 open, outstanding 93750.01', summary.body?.data?.openCount === 1 && summary.body?.data?.outstanding === '93750.01' && summary.body?.data?.currencyCode === 'USD', summary.body);
    const docs = await aFin.get(`${LP}/capital-calls/${allocA.id}/documents`);
    check('call documents include the notice', docs.status === 200 && Array.isArray(docs.body?.data) && docs.body.data.length >= 1, docs.body);
    const notice = await aFin.get(`${LP}/capital-calls/${allocA.id}/notice/download`);
    check('notice download is a PDF', notice.status === 200 && notice.headers.get('content-type')?.includes('pdf') && Buffer.isBuffer(notice.body) && notice.body.subarray(0, 5).toString() === '%PDF-', notice.status);
    const notices = await prisma.lpNotice.count({ where: { clientId: A.id, category: 'CAPITAL_CALL' } }).catch(() => -1);
    check('LP notice published for client A', notices === 1 || notices === -1, notices);

    console.log('\nJ3 guards: IDOR and LP roles');
    const bList = await bFin.get(`${LP}/capital-calls`);
    check("client B sees only its own allocation", bList.body?.data?.items?.length === 1 && bList.body.data.items[0].id === allocB?.id, bList.body);
    const bGet = await bFin.get(`${LP}/capital-calls/${allocA.id}`);
    check("client B cannot read A's call (404)", bGet.status === 404 && bGet.body?.code === 'LP_NOT_FOUND', bGet.body);
    const bAck = await bFin.post(`${LP}/capital-calls/${allocA.id}/acknowledge`, {}, { 'Idempotency-Key': key('back') });
    check("client B cannot acknowledge A's call (404)", bAck.status === 404, bAck.body);
    const bForm = new FormData();
    bForm.append('file', new Blob([pdfBytes()], { type: 'application/pdf' }), 'proof.pdf');
    const bUp = await bFin.send('POST', `${LP}/capital-calls/${allocA.id}/payment-confirmations`, bForm);
    check("client B cannot upload on A's call (404)", bUp.status === 404, bUp.body);
    const bDoc = await bFin.get(`${LP}/capital-calls/${allocA.id}/notice/download`);
    check("client B cannot download A's notice (404)", bDoc.status === 404, bDoc.status);
    const vAck = await aView.post(`${LP}/capital-calls/${allocA.id}/acknowledge`, {}, { 'Idempotency-Key': key('vack') });
    check('VIEWER cannot acknowledge (403)', vAck.status === 403, vAck.body);
    const vForm = new FormData();
    vForm.append('file', new Blob([pdfBytes()], { type: 'application/pdf' }), 'proof.pdf');
    const vUp = await aView.send('POST', `${LP}/capital-calls/${allocA.id}/payment-confirmations`, vForm);
    check('VIEWER cannot upload evidence (403)', vUp.status === 403, vUp.body);
    check('VIEWER can still read the call', (await aView.get(`${LP}/capital-calls/${allocA.id}`)).status === 200);

    console.log('\nJ3 LP actions');
    const ackNoKey = await aFin.post(`${LP}/capital-calls/${allocA.id}/acknowledge`, {});
    check('acknowledge without key -> 400 LP_VALIDATION', ackNoKey.status === 400 && ackNoKey.body?.code === 'LP_VALIDATION', ackNoKey.body);
    const ackKey = key('ack');
    const ack = await aFin.post(`${LP}/capital-calls/${allocA.id}/acknowledge`, {}, { 'Idempotency-Key': ackKey });
    check('signatory acknowledges', ack.status === 200 && typeof ack.body?.data?.acknowledgedAt === 'string', ack.body);
    await sleep(400);
    const ackReplay = await aFin.post(`${LP}/capital-calls/${allocA.id}/acknowledge`, {}, { 'Idempotency-Key': ackKey });
    check('acknowledge replay returns the same result', ackReplay.status === 200 && ackReplay.body?.data?.acknowledgedAt === ack.body?.data?.acknowledgedAt, ackReplay.body);
    const ackAgain = await aFin.post(`${LP}/capital-calls/${allocA.id}/acknowledge`, {}, { 'Idempotency-Key': key('ack2') });
    check('second acknowledge -> 409 LP_CALL_ALREADY_ACKNOWLEDGED', ackAgain.status === 409 && ackAgain.body?.code === 'LP_CALL_ALREADY_ACKNOWLEDGED', ackAgain.body);
    check('status now ACKNOWLEDGED', (await aFin.get(`${LP}/capital-calls/${allocA.id}`)).body?.data?.status === 'ACKNOWLEDGED');

    const form = new FormData();
    form.append('file', new Blob([pdfBytes()], { type: 'application/pdf' }), 'wire-confirmation.pdf');
    form.append('amountClaimed', '93750.01');
    const up = await aFin.send('POST', `${LP}/capital-calls/${allocA.id}/payment-confirmations`, form, { 'Idempotency-Key': key('up') });
    check('signatory uploads payment confirmation -> 201 with sha256', up.status === 201 && /^[a-f0-9]{64}$/.test(up.body?.data?.sha256 ?? '') && up.body?.data?.amountClaimed === '93750.01', up.body);
    const stillUnpaid = await aFin.get(`${LP}/capital-calls/${allocA.id}`);
    check('upload alone does not change paid', stillUnpaid.body?.data?.paid === '0.00', stillUnpaid.body?.data);

    console.log('\nJ3 staff settlement');
    const staffCall = (await maker.get(`${OPS}/capital-calls/${call.id}`)).body?.data;
    const evidence = staffCall?.allocations?.find((a: any) => a.id === allocA.id)?.evidence?.[0];
    check('staff sees the evidence with a download link', !!evidence?.id, staffCall?.allocations);
    await maker.stepUp();
    const over = await maker.post(`${OPS}/capital-calls/${call.id}/allocations/${allocA.id}/payments`, { amount: '100000', paidAt: day(0), reference: 'TOO-MUCH' }, { 'Idempotency-Key': key('over') });
    check('payment above outstanding refused', over.status === 400 || over.status === 409, over.body);
    const noStepKey = await maker.post(`${OPS}/capital-calls/${call.id}/allocations/${allocA.id}/payments`, { amount: '1', paidAt: day(0), reference: 'X' });
    check('payment without Idempotency-Key -> 400', noStepKey.status === 400, noStepKey.body);
    const p1 = await maker.post(
      `${OPS}/capital-calls/${call.id}/allocations/${allocA.id}/payments`,
      { amount: '50000', paidAt: day(0), reference: 'FT-0001', evidenceId: evidence?.id },
      { 'Idempotency-Key': key('p1') },
    );
    check('first payment -> 201, call PARTIALLY_PAID', p1.status === 201 && p1.body?.data?.status === 'PARTIALLY_PAID', p1.body);
    check('LP sees PARTIALLY_PAID 50000.00', (await aFin.get(`${LP}/capital-calls/${allocA.id}`)).body?.data?.paid === '50000.00');
    const p2 = await maker.post(`${OPS}/capital-calls/${call.id}/allocations/${allocA.id}/payments`, { amount: '43750.01', paidAt: day(0), reference: 'FT-0002' }, { 'Idempotency-Key': key('p2') });
    check('second payment settles A', p2.status === 201, p2.body);
    const p3 = await maker.post(`${OPS}/capital-calls/${call.id}/allocations/${allocB.id}/payments`, { amount: '56250', paidAt: day(0), reference: 'FT-0003' }, { 'Idempotency-Key': key('p3') });
    check('B paid -> call PAID', p3.status === 201 && p3.body?.data?.status === 'PAID', p3.body);
    const paid = (await aFin.get(`${LP}/capital-calls/${allocA.id}`)).body?.data;
    check('LP detail PAID, outstanding 0.00, ALLOCATED step complete', paid?.status === 'PAID' && paid?.outstanding === '0.00' && paid?.timeline?.[3]?.completed === true, paid);
    const sum2 = (await aFin.get(`${LP}/capital-calls/summary`)).body?.data;
    check('summary: no open calls, paidYtd 93750.01', sum2?.openCount === 0 && sum2?.paidYtd === '93750.01' && sum2?.paidCallCount === 1, sum2);

    console.log('\nSegregation of duties');
    const own = await dual.post(`${OPS}/capital-calls`, { fundId: fund.id, callDate: day(0), dueDate: day(10), purpose: 'SoD check', totalAmount: '1000' });
    await dual.post(`${OPS}/capital-calls/${own.body?.data?.id}/submit`);
    await dual.stepUp();
    const ownApprove = await dual.post(`${OPS}/capital-calls/${own.body?.data?.id}/approve`, {}, { 'Idempotency-Key': key('own') });
    check('maker with approve permission cannot approve own call -> 403 segregation_of_duties', ownApprove.status === 403 && ownApprove.body?.error?.code === 'segregation_of_duties', ownApprove.body);
    const ownCancel = await dual.post(`${OPS}/capital-calls/${own.body?.data?.id}/cancel`, { reason: 'SoD check done' });
    check('pending call cancelled', ownCancel.status === 200 && ownCancel.body?.data?.status === 'CANCELLED', ownCancel.body);

    // ------------------------------------------------------------------ distributions
    console.log('\nDistributions');
    const dc = await maker.post(`${OPS}/distributions`, {
      fundId: fund.id,
      distributionDate: day(0),
      type: 'REALISATION_PROCEEDS',
      grossAmount: '100000',
      carryAmount: '10000',
    });
    const dist = dc.body?.data;
    check('create distribution -> 201 DRAFT, net 90000', dc.status === 201 && dist?.status === 'DRAFT' && dist?.netToLps === '90000.00', dc.body);
    const dA = dist?.allocations?.find((a: any) => a.clientId === A.id);
    const dB = dist?.allocations?.find((a: any) => a.clientId === B.id);
    const netSum = Number(dA?.shareAmount ?? 0) * 100 + Number(dB?.shareAmount ?? 0) * 100;
    check('allocations pro-rata by paid-in and sum to net', dA && dB && Math.round(netSum) === 9_000_000 && Number(dA.shareAmount) > Number(dB.shareAmount), dist?.allocations);
    check('LP cannot see a draft distribution', (await aFin.get(`${LP}/distributions`)).body?.data?.items?.length === 0);
    await maker.post(`${OPS}/distributions/${dist.id}/submit`);
    await maker.stepUp();
    const dSod = await maker.post(`${OPS}/distributions/${dist.id}/approve`, {}, { 'Idempotency-Key': key('dsod') });
    check('maker cannot approve distribution (403)', dSod.status === 403, dSod.body);
    await approver.stepUp();
    const dApp = await approver.post(`${OPS}/distributions/${dist.id}/approve`, {}, { 'Idempotency-Key': key('dapp') });
    check('approver approves distribution', dApp.status === 200 && dApp.body?.data?.status === 'APPROVED', dApp.body);
    const dIss = await maker.post(`${OPS}/distributions/${dist.id}/issue`, {}, { 'Idempotency-Key': key('diss') });
    check('maker issues distribution', dIss.status === 200 && dIss.body?.data?.status === 'ISSUED', dIss.body);
    const lpD = await aFin.get(`${LP}/distributions`);
    const lpDi = lpD.body?.data?.items?.[0];
    check('LP sees its distribution', lpD.status === 200 && lpD.body?.data?.items?.length === 1 && lpDi?.id === dA?.id, lpD.body);
    check('LP distribution shapes', lpDi?.netPaid === dA?.shareAmount && lpDi?.reference === dist.ref && typeof lpDi?.type === 'string', lpDi);
    const bD = await bFin.get(`${LP}/distributions/${dA.id}`);
    check("client B cannot read A's distribution (404)", bD.status === 404, bD.body);
    const dDl = await aFin.get(`${LP}/distributions/${dA.id}/download`);
    check('distribution notice download is a PDF', dDl.status === 200 && Buffer.isBuffer(dDl.body) && dDl.body.subarray(0, 5).toString() === '%PDF-', dDl.status);
    const settle = await maker.post(`${OPS}/distributions/${dist.id}/allocations/${dA.id}/settle`, { paidAt: day(0), reference: 'OUT-0001' }, { 'Idempotency-Key': key('dset') });
    check('settle A distribution -> PARTIALLY_PAID header', settle.status === 200 || settle.status === 201, settle.body);
    const lpDPaid = (await aFin.get(`${LP}/distributions/${dA.id}`)).body?.data;
    check('LP sees distribution PAID', lpDPaid?.status === 'PAID', lpDPaid);
    const csum = (await aFin.get(`${LP}/capital-calls/summary`)).body?.data;
    check('summary totalDistributions reflects the payout', csum?.totalDistributions === dA?.shareAmount, csum);

    // ------------------------------------------------------------------ dealing
    console.log('\nJ4 dealing');
    const oeRes = await maker.post(`${OPS}/funds`, {
      name: `WS2 Income Fund ${run}`,
      shortName: 'WS2I',
      operatingModel: 'OPEN_ENDED',
      navPerUnit: '10',
      asOfDate: day(-1),
      dealingRules: { noticeDays: 0, dealingFrequency: 'DAILY', minBalanceAmount: '1000', settlementLagDays: 2 },
    });
    const oe = oeRes.body?.data;
    if (oe?.id) fundIds.push(oe.id);
    check('open-ended fund created', oeRes.status === 201 && oe?.operatingModel === 'OPEN_ENDED', oeRes.body);
    await maker.post(`${OPS}/funds/${oe.id}/commitments`, { clientId: A.id, commitmentAmount: '1' });
    const hold = await maker.put(`${OPS}/funds/${oe.id}/holdings`, { clientId: A.id, units: '1000' });
    check('holding set to 1000 units', hold.status === 200 || hold.status === 201, hold.body);
    const ov = await aFin.get(`${LP}/dealing/overview?fundId=${oe.id}`);
    check('overview: 1000 units at 10, value 10000.00', ov.body?.data?.unitsHeld === '1000.000000' && ov.body?.data?.accountValue === '10000.00', ov.body);
    const bOv = await bFin.get(`${LP}/dealing/overview?fundId=${oe.id}`);
    check('client B cannot see a fund outside its scope (404)', bOv.status === 404 || bOv.status === 403, bOv.body);

    const est = await aFin.post(`${LP}/dealing/subscriptions/estimate`, { fundId: oe.id, shareClass: 'DEFAULT', amount: '5000.00', currency: 'USD' });
    check('subscription estimate: 500 units', est.status === 200 && est.body?.data?.estimatedUnits === '500.000000' && !!est.body?.data?.estimateSnapshotId, est.body);
    const subBody = { fundId: oe.id, shareClass: 'DEFAULT', estimateSnapshotId: est.body?.data?.estimateSnapshotId, amount: '5000.00', currency: 'USD', acceptTerms: true };
    const vSub = await aView.post(`${LP}/dealing/subscriptions`, subBody, { 'Idempotency-Key': key('vsub') });
    check('VIEWER cannot subscribe (403)', vSub.status === 403, vSub.body);
    const tampered = await aFin.post(`${LP}/dealing/subscriptions`, { ...subBody, amount: '9000.00' }, { 'Idempotency-Key': key('tamper') });
    check('body not matching estimate -> 409', tampered.status === 409, tampered.body);
    const sub = await aFin.post(`${LP}/dealing/subscriptions`, subBody, { 'Idempotency-Key': key('sub') });
    check('subscription submitted -> 201 SUBMITTED', sub.status === 201 && sub.body?.data?.status === 'SUBMITTED' && sub.body?.data?.isEstimate === true, sub.body);
    const reuseEst = await aFin.post(`${LP}/dealing/subscriptions`, subBody, { 'Idempotency-Key': key('sub2') });
    check('estimate cannot be used twice (409)', reuseEst.status === 409, reuseEst.body);

    const rules = (await aFin.get(`${LP}/dealing/rules?fundId=${oe.id}`)).body?.data;
    const earliest = rules?.nextEligibleDealingDate ?? day(1);
    const breach = await aFin.post(`${LP}/dealing/redemptions/estimate`, { fundId: oe.id, shareClass: 'DEFAULT', mode: 'UNITS', units: '950', earliestDealingDate: earliest });
    check('redemption below min balance -> 422 LP_MIN_BALANCE_BREACH', breach.status === 422 && breach.body?.code === 'LP_MIN_BALANCE_BREACH', breach.body);
    const tooMany = await aFin.post(`${LP}/dealing/redemptions/estimate`, { fundId: oe.id, shareClass: 'DEFAULT', mode: 'UNITS', units: '2000', earliestDealingDate: earliest });
    check('redemption above holdings -> 422 LP_INSUFFICIENT_UNITS', tooMany.status === 422 && tooMany.body?.code === 'LP_INSUFFICIENT_UNITS', tooMany.body);
    const rEst = await aFin.post(`${LP}/dealing/redemptions/estimate`, { fundId: oe.id, shareClass: 'DEFAULT', mode: 'UNITS', units: '100', earliestDealingDate: earliest });
    check('redemption estimate: 100 units', rEst.status === 200 && rEst.body?.data?.estimatedUnitsToCancel === '100.000000', rEst.body);
    const red = await aFin.post(
      `${LP}/dealing/redemptions`,
      { fundId: oe.id, shareClass: 'DEFAULT', estimateSnapshotId: rEst.body?.data?.estimateSnapshotId, mode: 'UNITS', units: '100', requestedDealingDate: earliest, acceptTerms: true },
      { 'Idempotency-Key': key('red') },
    );
    check('redemption submitted -> 201', red.status === 201 && red.body?.data?.requestType === 'REDEMPTION', red.body);

    await prisma.client.update({ where: { id: A.id }, data: { dealingHold: true, holdReason: 'Test hold' } });
    const held = await aFin.post(`${LP}/dealing/subscriptions/estimate`, { fundId: oe.id, shareClass: 'DEFAULT', amount: '100.00', currency: 'USD' });
    check('compliance hold blocks dealing (403 LP_COMPLIANCE_HOLD)', held.status === 403 && held.body?.code === 'LP_COMPLIANCE_HOLD', held.body);
    await prisma.client.update({ where: { id: A.id }, data: { dealingHold: false, holdReason: null } });

    console.log('\nJ4 staff queue');
    const queue = await services.get(`${OPS}/dealing/requests?status=SUBMITTED&fundId=${oe.id}`);
    check('queue lists both requests for client services', queue.status === 200 && queue.body?.data?.length === 2, queue.body);
    const subId = sub.body?.data?.id;
    const redId = red.body?.data?.id;
    const svcAccept = await services.post(`${OPS}/dealing/requests/${subId}/accept`);
    check('client services cannot accept (403)', svcAccept.status === 403, svcAccept.body);
    check('maker accepts subscription -> AWAITING_FUNDS', (await maker.post(`${OPS}/dealing/requests/${subId}/accept`)).body?.data?.status === 'AWAITING_FUNDS');
    const proc = await maker.post(`${OPS}/dealing/requests/${subId}/process`, { navPerUnit: '10' });
    check('maker processes -> AWAITING_NAV, 500 units', proc.body?.data?.status === 'AWAITING_NAV' && proc.body?.data?.unitsAllocated === '500.000000', proc.body);
    const makerApprove = await maker.post(`${OPS}/dealing/requests/${subId}/approve`, {}, { 'Idempotency-Key': key('dmk') });
    check('processor cannot approve (403)', makerApprove.status === 403, makerApprove.body);
    await prisma.session.updateMany({ where: { userId: approverU.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    const dStale = await approver.post(`${OPS}/dealing/requests/${subId}/approve`, {}, { 'Idempotency-Key': key('dstale') });
    check('dealing approve with stale MFA -> 401 step_up_required', dStale.status === 401 && dStale.body?.error?.code === 'step_up_required', dStale.body);
    await approver.stepUp();
    const dAppr = await approver.post(`${OPS}/dealing/requests/${subId}/approve`, {}, { 'Idempotency-Key': key('dappr') });
    check('approver completes subscription', dAppr.status === 200 && dAppr.body?.data?.status === 'COMPLETED', dAppr.body);
    const lpReqs = await aFin.get(`${LP}/dealing/requests?fundId=${oe.id}`);
    const lpSub = lpReqs.body?.data?.items?.find((r: any) => r.id === subId);
    check('LP sees ALLOCATED with final units', lpSub?.status === 'ALLOCATED' && lpSub?.isEstimate === false && lpSub?.units === '500.000000', lpSub);

    await maker.post(`${OPS}/dealing/requests/${redId}/accept`);
    const rProc = await maker.post(`${OPS}/dealing/requests/${redId}/process`, {});
    check('redemption processed at fund NAV', rProc.body?.data?.status === 'AWAITING_NAV' && rProc.body?.data?.unitsAllocated === '100.000000', rProc.body);
    const rAppr = await approver.post(`${OPS}/dealing/requests/${redId}/approve`, {}, { 'Idempotency-Key': key('rappr') });
    check('approver completes redemption', rAppr.status === 200 && rAppr.body?.data?.status === 'COMPLETED', rAppr.body);
    const ov2 = (await aFin.get(`${LP}/dealing/overview?fundId=${oe.id}`)).body?.data;
    check('holding now 1400 units (1000 + 500 - 100)', ov2?.unitsHeld === '1400.000000' && ov2?.accountValue === '14000.00', ov2);

    const est3 = await aFin.post(`${LP}/dealing/subscriptions/estimate`, { fundId: oe.id, shareClass: 'DEFAULT', amount: '1000.00', currency: 'USD' });
    const sub3 = await aFin.post(
      `${LP}/dealing/subscriptions`,
      { fundId: oe.id, shareClass: 'DEFAULT', estimateSnapshotId: est3.body?.data?.estimateSnapshotId, amount: '1000.00', currency: 'USD', acceptTerms: true },
      { 'Idempotency-Key': key('sub3') },
    );
    const rej = await maker.post(`${OPS}/dealing/requests/${sub3.body?.data?.id}/reject`, { reason: 'Funds not received' });
    check('reject -> REJECTED with reason', rej.body?.data?.status === 'REJECTED' && rej.body?.data?.rejectionReason === 'Funds not received', rej.body);
    const est4 = await aFin.post(`${LP}/dealing/subscriptions/estimate`, { fundId: oe.id, shareClass: 'DEFAULT', amount: '2000.00', currency: 'USD' });
    const sub4 = await aFin.post(
      `${LP}/dealing/subscriptions`,
      { fundId: oe.id, shareClass: 'DEFAULT', estimateSnapshotId: est4.body?.data?.estimateSnapshotId, amount: '2000.00', currency: 'USD', acceptTerms: true },
      { 'Idempotency-Key': key('sub4') },
    );
    const sub4Id = sub4.body?.data?.id;
    await dual.post(`${OPS}/dealing/requests/${sub4Id}/accept`);
    await dual.post(`${OPS}/dealing/requests/${sub4Id}/process`, {});
    await dual.stepUp();
    const dualAppr = await dual.post(`${OPS}/dealing/requests/${sub4Id}/approve`, {}, { 'Idempotency-Key': key('dual') });
    check('processor cannot approve own dealing request -> 403 segregation_of_duties', dualAppr.status === 403 && dualAppr.body?.error?.code === 'segregation_of_duties', dualAppr.body);
    await dual.post(`${OPS}/dealing/requests/${sub4Id}/reject`, { reason: 'SoD check done' });

    const csv = await aFin.get(`${LP}/dealing/requests/export?fundId=${oe.id}`);
    check('requests export is CSV', csv.status === 200 && Buffer.isBuffer(csv.body) && csv.body.toString().startsWith('id,fundName'), csv.status);
  } finally {
    await cleanup(userIds, clientIds, fundIds);
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll WS2 checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

async function cleanup(userIds: string[], clientIds: string[], fundIds: string[]) {
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.log(`  (cleanup: ${label} skipped: ${(err as Error).message.split('\n').pop()})`);
    }
  };
  const calls = await prisma.capitalCall.findMany({ where: { fundId: { in: fundIds } }, select: { id: true } });
  const allocs = await prisma.capitalCallAllocation.findMany({ where: { callId: { in: calls.map((c) => c.id) } }, select: { id: true } });
  const dists = await prisma.distribution.findMany({ where: { fundId: { in: fundIds } }, select: { id: true } });
  const evidence = await prisma.fundingEvidence.findMany({ where: { allocationId: { in: allocs.map((a) => a.id) } }, select: { capitalEventId: true } });
  await step('payments', () => prisma.capitalCallPayment.deleteMany({ where: { allocationId: { in: allocs.map((a) => a.id) } } }));
  await step('evidence', () => prisma.fundingEvidence.deleteMany({ where: { allocationId: { in: allocs.map((a) => a.id) } } }));
  await step('capital events', () => prisma.capitalEvent.deleteMany({ where: { id: { in: evidence.map((e) => e.capitalEventId) } } }));
  await step('allocations', () => prisma.capitalCallAllocation.deleteMany({ where: { callId: { in: calls.map((c) => c.id) } } }));
  await step('calls', () => prisma.capitalCall.deleteMany({ where: { id: { in: calls.map((c) => c.id) } } }));
  await step('distribution allocations', () => prisma.distributionAllocation.deleteMany({ where: { distributionId: { in: dists.map((d) => d.id) } } }));
  await step('distributions', () => prisma.distribution.deleteMany({ where: { id: { in: dists.map((d) => d.id) } } }));
  await step('dealing requests', () => prisma.lpDealingRequest.deleteMany({ where: { fundId: { in: fundIds } } }));
  await step('estimates', () => prisma.dealingEstimate.deleteMany({ where: { fundId: { in: fundIds } } }));
  await step('notices', () => prisma.lpNotice.deleteMany({ where: { clientId: { in: clientIds } } }));
  await step('documents', () => prisma.document.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { fundId: { in: fundIds } }] } }));
  await step('idempotency keys', () => prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } }));
  await step('users', () => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
  await step('clients', () => prisma.client.deleteMany({ where: { id: { in: clientIds } } }));
  await step('funds', () => prisma.fund.deleteMany({ where: { id: { in: fundIds } } }));
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
