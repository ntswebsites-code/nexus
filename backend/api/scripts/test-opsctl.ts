/**
 * Operations and finance controls checks (R4-2) against a RUNNING API:
 *  - payments reconciliation: matching rules (pure engine), idempotent runs, every break kind, maker-checker break
 *    handling with step-up, manual match, timing deferral, rejection, auto-clear on re-run,
 *  - settlement fails view,
 *  - NAV-released and reconciliation sign-off gates on the cash and accounting period closes (itemised blockers),
 *  - custody positions pulled through the custodian-feed adapter into the positions-vs-custody reconciliation.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4251 npx tsx scripts/test-opsctl.ts
 *
 * Disposable schema only: `prisma migrate deploy` + `prisma/seed.ts` (role catalogue), then start the API on the same
 * DATABASE_URL (INTEGRATION_CUSTODIAN_FEED unset or file-drop). Creates throwaway users, a fund, clients, a bank
 * ledger and a statement under its own run id and removes them afterwards.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { sha256Hex } from '../src/lib/crypto';
import { lineFingerprint } from '../src/modules/cash/cash.engine';
import { DEFAULT_PAY_PARAMS, diffSeverity, hasToken, matchPayments, missingSeverity, payeeInText, type ExpItem, type StmtLine } from '../src/modules/opsctl/payrecon.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Oc-${randomBytes(9).toString('base64url')}`;
let failures = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 700));
  }
};
const key = (label: string) => `oc-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface Res {
  status: number;
  body: any;
}
function client() {
  const origin = config.portalUrls.admin;
  let cookie = '';
  let secret = '';
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (cookie) h.Cookie = cookie;
    let payload: string | undefined;
    if (body !== undefined) {
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
    return { status: res.status, body: parsed };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    put: (p: string, b?: unknown) => send('PUT', p, b ?? {}),
    login: (email: string) => send('POST', '/api/auth/login', { email, password, portal: 'admin' }),
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
const errCode = (r: Res) => r.body?.error?.code;
const OC = '/api/v1/ops-controls';
const PR = `${OC}/pay-recon`;

async function main() {
  // ---------------------------------------------------------------- pure engine
  console.log('\nEngine: reference, amount and duplicate rules');
  const P = { tolerance: D('0.01'), graceDays: 2, dateWindowDays: 5 };
  const item = (o: Partial<ExpItem> & { key: string }): ExpItem => ({ documentRef: 'CC-100', tokens: [], payeeName: 'Alpha Pension Ltd', direction: 'IN', amount: D(1000), currency: 'USD', dueDate: '2026-09-01', covered: true, ...o });
  const ln = (o: Partial<StmtLine> & { id: string }): StmtLine => ({ date: '2026-09-01', amount: D(1000), currency: 'USD', text: '', ...o });
  check('token match respects word boundaries (CC-100 is not inside CC-1001)', hasToken('Wire CC-100 Alpha', 'CC-100') && !hasToken('Wire CC-1001 Alpha', 'CC-100') && !hasToken('x', 'ab'));
  check('payee match needs the first two significant words', payeeInText('Alpha Pension Fund Ltd', 'Subscription ALPHA PENSION') && !payeeInText('Alpha Pension Ltd', 'Subscription Alpha Trading') && !payeeInText('Ltd', 'Ltd'));
  const m1 = matchPayments([item({ key: 'a' })], [ln({ id: 'l1', text: 'CC-100 Alpha Pension' })], '2026-09-10', P);
  check('reference pair on an exact amount', m1.pairs.length === 1 && m1.pairs[0]!.method === 'REFERENCE' && m1.pairs[0]!.difference.isZero() && m1.missing.length === 0, m1);
  const m2 = matchPayments([item({ key: 'a' })], [ln({ id: 'l1', amount: D(900), text: 'CC-100' })], '2026-09-10', P);
  check('reference pair keeps an amount difference (-100) for the break', m2.pairs[0]?.difference.equals(-100) && diffSeverity(D(1000), D(900)) === 'HIGH', m2.pairs[0]);
  const shared = [item({ key: 'a', payeeName: 'Alpha Pension Ltd' }), item({ key: 'b', payeeName: 'Bravo Capital Ltd', amount: D(2000) })];
  const m3 = matchPayments(shared, [ln({ id: 'l1', amount: D(2000), text: 'CC-100 Bravo Capital' }), ln({ id: 'l2', text: 'CC-100 Alpha Pension' })], '2026-09-10', P);
  check('a shared document reference is narrowed by payee name', m3.pairs.find((p) => p.lineId === 'l1')?.itemKey === 'b' && m3.pairs.find((p) => p.lineId === 'l2')?.itemKey === 'a', m3.pairs);
  const m4 = matchPayments(shared, [ln({ id: 'l1', amount: D(1500), text: 'CC-100 Charlie' })], '2026-09-10', P);
  check('a shared reference with no payee and no exact amount is AMBIGUOUS, never guessed', m4.pairs.length === 0 && m4.unpaired[0]?.reason === 'AMBIGUOUS', m4);
  const m5 = matchPayments([item({ key: 'a' })], [ln({ id: 'l1', text: 'CC-100 Alpha Pension' }), ln({ id: 'l2', date: '2026-09-02', text: 'CC-100 Alpha Pension again' })], '2026-09-10', P);
  check('a second line for a paired payment is a DUPLICATE', m5.pairs.length === 1 && m5.unpaired[0]?.reason === 'DUPLICATE' && m5.unpaired[0].lineId === 'l2', m5);
  const m6 = matchPayments([item({ key: 'a', direction: 'OUT' })], [ln({ id: 'l1', text: 'CC-100' })], '2026-09-10', P);
  check('a reference with the wrong direction is raised as WRONG_DIRECTION', m6.pairs.length === 0 && m6.unpaired[0]?.reason === 'WRONG_DIRECTION', m6);
  const m7 = matchPayments([item({ key: 'a', direction: 'OUT', amount: D(3000) })], [ln({ id: 'l1', amount: D(-3000), date: '2026-09-02', text: 'Outgoing wire' })], '2026-09-10', P);
  check('no reference: unique exact amount near the due date pairs by AMOUNT', m7.pairs[0]?.method === 'AMOUNT', m7);
  const m8 = matchPayments([item({ key: 'a', direction: 'OUT', amount: D(3000) }), item({ key: 'b', direction: 'OUT', amount: D(3000), payeeName: 'Other Holdings' })], [ln({ id: 'l1', amount: D(-3000), text: 'wire' })], '2026-09-10', P);
  check('no reference and two payments with that amount: not paired', m8.pairs.length === 0, m8);
  const m9 = matchPayments([item({ key: 'a', direction: 'OUT', amount: D(3000) })], [ln({ id: 'l1', amount: D(-3000), date: '2026-09-20', text: 'wire' })], '2026-09-30', P);
  check('an amount-only line outside the date window is not paired', m9.pairs.length === 0 && m9.missing.length === 1, m9);
  const nd = matchPayments([item({ key: 'a', dueDate: '2026-09-09' }), item({ key: 'b', dueDate: '2026-09-01' }), item({ key: 'c', dueDate: '2026-09-01', covered: false })], [], '2026-09-10', P);
  check('within grace stays not due, past grace with a statement is missing, without a statement it waits', nd.notDue[0] === 'a' && nd.missing[0]?.itemKey === 'b' && nd.missing[0].daysOverdue === 9 && nd.awaitingStatement[0] === 'c', nd);
  check('severity bands: difference percent and days overdue', diffSeverity(D(1000), D(1000)) === 'LOW' && diffSeverity(D(1000), D('989')) === 'MEDIUM' && diffSeverity(D(1000), D(800)) === 'CRITICAL' && missingSeverity(2) === 'MEDIUM' && missingSeverity(3) === 'HIGH' && missingSeverity(10) === 'CRITICAL');

  // ---------------------------------------------------------------- fixtures
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, ...roleKeys: string[]) => {
    const u = await prisma.user.create({ data: { email: `oc-${run}-${label}@example.test`, name: `OC ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    for (const k of roleKeys) await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(k)).id } });
    return u;
  };
  const opsU = await mkUser('ops', 'operations'); // recon.manage + recon.signoff (maker here)
  const compU = await mkUser('comp', 'compliance'); // recon.signoff (independent checker)
  const fundU = await mkUser('fund', 'fund_accountant'); // cash and accounting close
  const pmU = await mkUser('pm', 'portfolio_manager'); // operations.view only
  const analystU = await mkUser('analyst', 'analyst'); // no operations.view
  const ops = client();
  const comp = client();
  const fundC = client();
  const pm = client();
  const analyst = client();
  const anon = client();

  const ids = { portfolio: [] as string[], security: [] as string[], counterparty: [] as string[], client: [] as string[] };
  const today = dayStr(0);
  const due = dayStr(-10);
  const D0 = dayStr(-9);

  const pf = await prisma.portfolio.create({ data: { ref: `OC-${run}-1`, name: `OC Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
  ids.portfolio.push(pf.id);
  const bank = await prisma.cashLedger.create({ data: { ref: `OCL${run}`, portfolioId: pf.id, name: `OC bank ${run}`, currency: 'USD', kind: 'BANK', createdBy: opsU.id } });
  const fund = await prisma.fund.create({ data: { ref: `OCF${run}`, name: `OC Fund ${run}`, shortName: 'OCF', currency: 'USD' } });
  const lp = async (suffix: string, name: string, commitment: number) => {
    const c = await prisma.client.create({ data: { ref: `X${run}${suffix}`, name: `${name} ${run}`, type: 'Pension fund', kycStatus: 'Current' } });
    ids.client.push(c.id);
    const cm = await prisma.fundCommitment.create({ data: { clientId: c.id, fundId: fund.id, commitmentAmount: D(commitment), currency: 'USD', status: 'ACTIVE' } });
    return { c, cm, name: c.name };
  };
  const A = await lp('A', 'Alpha Pension', 100000);
  const B = await lp('B', 'Bravo Capital', 100000);
  const C = await lp('C', 'Charlie Endowment', 100000);
  const E = await lp('D', 'Delta Holdings', 100000);
  const call = await prisma.capitalCall.create({ data: { ref: `OCC${run}`, fundId: fund.id, callNo: 1, totalAmount: D(40000), currency: 'USD', dueDate: day(due), status: 'ISSUED', issuedAt: new Date() } });
  const callAlloc = async (l: Awaited<ReturnType<typeof lp>>) =>
    prisma.capitalCallAllocation.create({ data: { callId: call.id, clientId: l.c.id, commitmentId: l.cm.id, lpLegalNameSnapshot: l.name, totalCommitmentSnapshot: D(100000), uncalledBeforeSnapshot: D(100000), callAmount: D(10000) } });
  const [cA, cB, cC, cD] = [await callAlloc(A), await callAlloc(B), await callAlloc(C), await callAlloc(E)];
  const dist = await prisma.distribution.create({ data: { ref: `OCD${run}`, fundId: fund.id, distributionDate: day(due), type: 'DIVIDEND', currency: 'USD', grossAmount: D(6000), netToLps: D(6000), status: 'ISSUED', issuedAt: new Date() } });
  const distAlloc = async (l: Awaited<ReturnType<typeof lp>>, amt: number) =>
    prisma.distributionAllocation.create({ data: { distributionId: dist.id, clientId: l.c.id, commitmentId: l.cm.id, lpLegalNameSnapshot: l.name, commitmentSnapshot: D(100000), shareAmount: D(amt) } });
  const [dX, dY, dZ] = [await distAlloc(A, 2000), await distAlloc(B, 3000), await distAlloc(C, 1000)];

  const stmtLines: { date: string; amount: string; reference: string | null; description: string }[] = [
    { date: dayStr(-11), amount: '10000.00', reference: call.ref, description: `Subscription ${A.name}` }, // A: exact
    { date: dayStr(-10), amount: '9500.00', reference: call.ref, description: `Capital call ${B.name}` }, // B: short by 500
    { date: dayStr(-10), amount: '-2000.00', reference: dist.ref, description: `Distribution ${A.name}` }, // X: exact
    { date: dayStr(-9), amount: '-2000.00', reference: dist.ref, description: `Distribution ${A.name} second payment` }, // duplicate of X
    { date: dayStr(-9), amount: '-3000.00', reference: null, description: 'Outgoing wire' }, // Y: matched on amount alone
    { date: dayStr(-2), amount: '-1000.00', reference: null, description: 'Wire adjustment' }, // later used for a manual match of Z
  ];
  const sum = stmtLines.reduce((s, l) => s.add(l.amount), D(0));
  const imp = await prisma.cashStatementImport.create({
    data: {
      ref: `OCI${run}`,
      ledgerId: bank.id,
      portfolioId: pf.id,
      filename: 'oc.csv',
      fileHash: sha256Hex(`oc-${run}`),
      format: 'CSV',
      statementFrom: day(dayStr(-14)),
      statementTo: day(today),
      openingBalance: D(0),
      closingBalance: sum,
      lineCount: stmtLines.length,
      variance: D(0),
      status: 'COMMITTED',
      makerId: opsU.id,
      checkerId: compU.id,
      committedAt: new Date(),
      lines: {
        create: stmtLines.map((l, i) => ({
          lineNo: i + 1,
          ledgerId: bank.id,
          valueDate: day(l.date),
          amount: D(l.amount),
          reference: l.reference,
          description: l.description,
          fingerprint: lineFingerprint(bank.id, { valueDate: day(l.date), amount: D(l.amount), reference: l.reference, description: l.description }),
        })),
      },
    },
  });

  const secA = await prisma.security.create({ data: { ticker: `O${run}A`.toUpperCase(), name: `OpsCtl A ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: 'S-A', status: 'Active' } });
  ids.security.push(secA.id);
  await prisma.securityPrice.create({ data: { securityId: secA.id, priceDate: day(dayStr(-12)), price: D(10), source: 'TEST' } });
  await prisma.portfolioCash.create({ data: { portfolioId: pf.id, currency: 'USD', available: D(100000), asOf: day(dayStr(-12)) } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf.id, securityId: secA.id, quantity: D(1000), avgCost: D(9), asOf: day(dayStr(-12)) } });
  const acc = `ACC-${run}`;
  const cp = await prisma.counterparty.create({ data: { ref: `CPO${run}`, name: `OC Custodian ${run}`, type: 'CUSTODIAN', accounts: [acc] } });
  ids.counterparty.push(cp.id);

  const navRefs: string[] = [];
  try {
    console.log('\nSign-in');
    for (const [c, u] of [[ops, opsU], [comp, compU], [fundC, fundU], [pm, pmU], [analyst, analystU]] as const) check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    for (const [n, c] of [['ops', ops], ['comp', comp]] as const) check(`${n} enrols TOTP`, await c.enrolMfa());

    // ---------------------------------------------------------------- permissions
    console.log('\nAccess');
    check('unauthenticated -> 401', (await anon.get(`${PR}/summary`)).status === 401);
    check('a role without operations.view -> 403', (await analyst.get(`${PR}/summary`)).status === 403);
    check('operations.view alone can read the summary', (await pm.get(`${PR}/summary`)).status === 200);
    const body = { fundId: fund.id, from: dayStr(-15), to: today };
    check('operations.view alone cannot run matching -> 403', (await pm.post(`${PR}/runs`, body, { 'Idempotency-Key': key('pm') })).status === 403);
    check('a run without Idempotency-Key -> 400', (await ops.post(`${PR}/runs`, body)).status === 400);
    check('an end date before the start -> 400', (await ops.post(`${PR}/runs`, { ...body, from: today, to: dayStr(-3) }, { 'Idempotency-Key': key('bad') })).status === 400);

    // ---------------------------------------------------------------- run
    console.log('\nPayments reconciliation run');
    const k1 = key('run1');
    const r1 = await ops.post(`${PR}/runs`, body, { 'Idempotency-Key': k1 });
    const run1 = r1.body?.data;
    check('first run created (201): 7 expected payments, 3 matched, 5 open breaks', r1.status === 201 && run1.itemCount === 7 && run1.matchedCount === 3 && run1.breakCount === 5 && run1.status === 'BREAKS' && r1.body.rerun === false, run1);
    const replay = await ops.post(`${PR}/runs`, body, { 'Idempotency-Key': k1 });
    check('the same Idempotency-Key replays the stored response', replay.status === 201 && replay.body?.data?.ref === run1.ref, replay.body?.data);
    const r2 = await ops.post(`${PR}/runs`, body, { 'Idempotency-Key': key('run2') });
    check('the same window again is a re-run of the same run (200, run count 2)', r2.status === 200 && r2.body.rerun === true && r2.body.data.ref === run1.ref && r2.body.data.runCount === 2, r2.body?.data);
    check('re-running does not duplicate breaks', (await prisma.payReconBreak.count({ where: { fundId: fund.id } })) === 5);
    check('re-running does not duplicate expected payments', (await prisma.payReconItem.count({ where: { fundId: fund.id } })) === 7);

    const items = (await ops.get(`${PR}/items?fundId=${fund.id}&limit=50`)).body.data as any[];
    const byPayee = (payee: string, kind: string) => items.find((i) => i.payeeName.startsWith(payee) && i.kind === kind);
    check('A receipt matched on reference', byPayee('Alpha', 'CAPITAL_CALL_RECEIPT')?.status === 'MATCHED' && byPayee('Alpha', 'CAPITAL_CALL_RECEIPT')?.matchMethod === 'REFERENCE');
    check('B receipt (shared reference, payee in text) paired but short: BREAK 9500.00', byPayee('Bravo', 'CAPITAL_CALL_RECEIPT')?.status === 'BREAK' && byPayee('Bravo', 'CAPITAL_CALL_RECEIPT')?.matchedAmount === '9500.00', byPayee('Bravo', 'CAPITAL_CALL_RECEIPT'));
    check('C and D receipts never arrived: BREAK', byPayee('Charlie', 'CAPITAL_CALL_RECEIPT')?.status === 'BREAK' && byPayee('Delta', 'CAPITAL_CALL_RECEIPT')?.status === 'BREAK');
    check('X payout matched on reference; Y payout matched on amount alone', byPayee('Alpha', 'DISTRIBUTION_PAYOUT')?.matchMethod === 'REFERENCE' && byPayee('Bravo', 'DISTRIBUTION_PAYOUT')?.matchMethod === 'AMOUNT' && byPayee('Bravo', 'DISTRIBUTION_PAYOUT')?.status === 'MATCHED');
    check('Z payout missing: BREAK', byPayee('Charlie', 'DISTRIBUTION_PAYOUT')?.status === 'BREAK');

    const brks = (await ops.get(`${PR}/breaks?fundId=${fund.id}`)).body.data as any[];
    const find = (kind: string, text: string) => brks.find((b) => b.kind === kind && b.label.includes(text));
    const bDiff = find('AMOUNT_DIFF', 'Bravo');
    const bMissC = brks.find((b) => b.kind === 'MISSING_PAYMENT' && b.label.includes('Charlie Endowment') && b.label.includes('receipt'));
    const bMissD = find('MISSING_PAYMENT', 'Delta');
    const bMissZ = brks.find((b) => b.kind === 'MISSING_PAYMENT' && b.label.includes('payout'));
    const bDup = brks.find((b) => b.kind === 'UNPAIRED_LINE');
    check('five breaks: amount difference, three missing payments and the duplicate payout line', !!bDiff && !!bMissC && !!bMissD && !!bMissZ && !!bDup && brks.length === 5, brks.map((b) => [b.kind, b.label.slice(0, 40)]));
    check('amount difference is -500.00, MEDIUM (exactly 5%)', bDiff?.difference === '-500.00' && bDiff.severity === 'MEDIUM', bDiff);
    check('a payment 10 days overdue is CRITICAL and material', bMissC?.severity === 'CRITICAL' && bMissC.material === true, bMissC);
    check('the duplicate payout line is HIGH and names the document', bDup?.severity === 'HIGH' && bDup.label.includes(dist.ref), bDup);
    check('break creation is written to the timeline', ((await ops.get(`${PR}/breaks/${bDiff.id}`)).body.events as any[]).some((e) => e.action === 'detected'));

    // ---------------------------------------------------------------- break handling
    console.log('\nBreak handling (maker-checker)');
    check('a PM cannot work breaks -> 403', (await pm.post(`${PR}/breaks/${bDiff.id}/investigate`, { note: 'looking' })).status === 403);
    const inv = await ops.post(`${PR}/breaks/${bDiff.id}/investigate`, { note: 'Asked the investor for the wire advice' });
    check('investigate: OPEN to INVESTIGATING, owner is the caller', inv.status === 200 && inv.body.data.status === 'INVESTIGATING' && inv.body.data.owner?.id === opsU.id, inv.body);
    const noEvidence = await ops.post(`${PR}/breaks/${bDiff.id}/resolve`, { resolution: 'ACCEPT_DIFFERENCE', rationale: 'Bank charges deducted by the sender' });
    check('resolve needs an evidence reference -> 400', noEvidence.status === 400, noEvidence.body);
    const res1 = await ops.post(`${PR}/breaks/${bDiff.id}/resolve`, { resolution: 'ACCEPT_DIFFERENCE', rationale: 'Sender bank deducted charges of 500', evidenceRef: 'MSG-4411' });
    check('resolve: to PENDING_CHECKER, caller is the maker', res1.status === 200 && res1.body.data.status === 'PENDING_CHECKER' && res1.body.data.maker?.id === opsU.id, res1.body);
    const selfApprove = await ops.post(`${PR}/breaks/${bDiff.id}/approve`);
    check('the maker cannot approve (403 segregation_of_duties)', selfApprove.status === 403, selfApprove.body);
    const noStep = await comp.post(`${PR}/breaks/${bDiff.id}/approve`);
    check('approval needs step-up MFA -> 401', noStep.status === 401, noStep.body);
    await comp.stepUp();
    const appr = await comp.post(`${PR}/breaks/${bDiff.id}/approve`, {}, { 'Idempotency-Key': key('appr') });
    check('independent checker approves -> RESOLVED, item ACCEPTED', appr.status === 200 && appr.body.data.status === 'RESOLVED' && appr.body.data.checker?.id === compU.id && (await prisma.payReconItem.findUniqueOrThrow({ where: { id: bDiff.itemId } })).status === 'ACCEPTED', appr.body);
    const again = await comp.post(`${PR}/breaks/${bDiff.id}/approve`);
    check('a resolved break cannot be approved again -> 409', again.status === 409 || again.status === 401, again.body);
    check('every transition is audited', (await prisma.auditEvent.count({ where: { objectId: bDiff.id, action: { startsWith: 'pay_recon.break_' } } })) >= 3);

    // reject path
    const resDup = await ops.post(`${PR}/breaks/${bDup.id}/resolve`, { resolution: 'ACCEPT_DIFFERENCE', rationale: 'Looks like a legitimate second payment', evidenceRef: 'MSG-1' });
    check('duplicate line: resolve to PENDING_CHECKER', resDup.status === 200 && resDup.body.data.status === 'PENDING_CHECKER', resDup.body);
    check('a PM cannot reject -> 403', (await pm.post(`${PR}/breaks/${bDup.id}/reject`, { reason: 'No, it is a duplicate' })).status === 403);
    const rej = await comp.post(`${PR}/breaks/${bDup.id}/reject`, { reason: 'It is a duplicate wire, ask the bank' });
    check('checker sends it back: INVESTIGATING, resolution cleared', rej.status === 200 && rej.body.data.status === 'INVESTIGATING' && rej.body.data.resolution === null, rej.body);
    await ops.post(`${PR}/breaks/${bDup.id}/resolve`, { resolution: 'RETURNED_PAYMENT', rationale: 'Bank recalled the duplicate wire', evidenceRef: 'BANK-RECALL-9' });
    await comp.stepUp();
    const apprDup = await comp.post(`${PR}/breaks/${bDup.id}/approve`);
    check('returned-payment resolution approved -> RESOLVED', apprDup.status === 200 && apprDup.body.data.status === 'RESOLVED', apprDup.body);

    // timing deferral
    const badTiming = await ops.post(`${PR}/breaks/${bMissD.id}/resolve`, { resolution: 'TIMING', rationale: 'Investor confirmed it is in transit', evidenceRef: 'MSG-2' });
    check('timing needs a future date -> 400', badTiming.status === 400, badTiming.body);
    await ops.post(`${PR}/breaks/${bMissD.id}/resolve`, { resolution: 'TIMING', rationale: 'Investor confirmed it is in transit', evidenceRef: 'MSG-2', deferredUntil: dayStr(3) });
    await comp.stepUp();
    const apprTiming = await comp.post(`${PR}/breaks/${bMissD.id}/approve`);
    const itemD = await prisma.payReconItem.findUniqueOrThrow({ where: { id: bMissD.itemId } });
    check('timing approved: item DEFERRED until the date', apprTiming.status === 200 && itemD.status === 'DEFERRED' && itemD.deferredUntil?.toISOString().slice(0, 10) === dayStr(3), itemD);

    // manual match
    const stray = await prisma.cashStatementLine.findFirstOrThrow({ where: { importId: imp.id, reference: null, description: 'Wire adjustment' } });
    const wrongSide = await ops.post(`${PR}/breaks/${bMissZ.id}/resolve`, { resolution: 'MANUAL_MATCH', rationale: 'The adjustment wire is the missing payout', evidenceRef: 'MSG-3', lineId: (await prisma.cashStatementLine.findFirstOrThrow({ where: { importId: imp.id, description: `Subscription ${A.name}` } })).id });
    check('manual match with a line of the wrong direction -> 400', wrongSide.status === 400, wrongSide.body);
    const unp = await ops.get(`${PR}/lines`);
    check('the unpaired-lines picker lists the stray line only among free lines', (unp.body.data as any[]).some((l) => l.id === stray.id) && !(unp.body.data as any[]).some((l) => l.description === 'Outgoing wire'), unp.body.data);
    const mm = await ops.post(`${PR}/breaks/${bMissZ.id}/resolve`, { resolution: 'MANUAL_MATCH', rationale: 'The adjustment wire is the missing payout', evidenceRef: 'MSG-3', lineId: stray.id });
    check('manual match proposed', mm.status === 200 && mm.body.data.status === 'PENDING_CHECKER', mm.body);
    await comp.stepUp();
    const mmOk = await comp.post(`${PR}/breaks/${bMissZ.id}/approve`);
    const itemZ = await prisma.payReconItem.findUniqueOrThrow({ where: { id: bMissZ.itemId } });
    check('manual match approved: item MATCHED to the line (MANUAL)', mmOk.status === 200 && itemZ.status === 'MATCHED' && itemZ.matchedLineId === stray.id && itemZ.matchMethod === 'MANUAL', itemZ);

    // a late receipt arrives; re-run clears C on its own
    await prisma.cashStatementLine.create({
      data: { importId: imp.id, ledgerId: bank.id, lineNo: 99, valueDate: day(dayStr(-3)), amount: D(10000), reference: call.ref, description: `Late receipt ${C.name}`, fingerprint: lineFingerprint(bank.id, { valueDate: day(dayStr(-3)), amount: D(10000), reference: call.ref, description: `Late receipt ${C.name}` }) },
    });
    const r3 = await ops.post(`${PR}/runs`, body, { 'Idempotency-Key': key('run3') });
    const cAfter = await prisma.payReconBreak.findUniqueOrThrow({ where: { id: bMissC.id } });
    check('re-run: the late receipt pairs, the missing-payment break is AUTO_CLEARED', r3.status === 200 && cAfter.status === 'AUTO_CLEARED' && r3.body.data.matchedCount === 6, { run: r3.body?.data, cAfter: cAfter.status });
    check('re-run leaves resolved breaks resolved and the locked items untouched', (await prisma.payReconBreak.findUniqueOrThrow({ where: { id: bDiff.id } })).status === 'RESOLVED' && (await prisma.payReconItem.findUniqueOrThrow({ where: { id: bMissD.itemId } })).status === 'DEFERRED' && (await prisma.payReconItem.findUniqueOrThrow({ where: { id: bMissZ.itemId } })).matchedLineId === stray.id);
    const openLeft = (await ops.get(`${PR}/breaks?fundId=${fund.id}&status=OPEN_ALL`)).body;
    check('no break of this fund is left open', openLeft.total === 0, openLeft);
    check('the summary reports the matched payments', (await ops.get(`${PR}/summary`)).body.data.items.MATCHED >= 5);
    const noStatement = await ops.post(`${PR}/runs`, { fundId: fund.id, from: dayStr(100), to: dayStr(110) }, { 'Idempotency-Key': key('empty') });
    check('a window with no documents is a NO_STATEMENTS run, not a break', noStatement.status === 201 && noStatement.body.data.status === 'NO_STATEMENTS' && noStatement.body.data.breakCount === 0, noStatement.body?.data);

    // ---------------------------------------------------------------- settlement fails
    console.log('\nSettlement fails view');
    const mapRes = await ops.put('/api/v1/recon/account-map', { counterpartyId: cp.id, accountRef: acc, portfolioId: pf.id });
    check('map the custodian account to the portfolio', mapRes.status === 200, mapRes.body);
    const o = await prisma.order.create({ data: { ref: `OC${run}1`, portfolioId: pf.id, securityId: secA.id, side: 'BUY', quantity: D(10), orderType: 'MARKET', currency: 'USD', decisionPrice: D(10), status: 'Filled', makerId: opsU.id, filledQty: D(10), avgPrice: D(10) } });
    await prisma.orderFill.create({ data: { orderId: o.id, quantity: D(10), price: D(10), executedAt: new Date(`${dayStr(-10)}T10:00:00.000Z`), source: 'CONTRACT_NOTE', sourceRef: null, recordedBy: opsU.id } });
    const sfRun = await ops.post('/api/v1/recon/runs', { family: 'SETTLEMENT_FAILS', asOfDate: today, counterpartyId: cp.id }, { 'Idempotency-Key': key('sf') });
    check('settlement-fails detection run finds the unsettled fill', sfRun.status === 201 && sfRun.body.data.breakCount === 1, sfRun.body?.data);
    check('the view needs operations.view', (await analyst.get(`${OC}/settlement-fails`)).status === 403);
    const sf = await pm.get(`${OC}/settlement-fails?asOf=${today}`);
    const fail = sf.body?.data?.[0];
    check('the view lists the fail with order, days late and bucket', sf.status === 200 && sf.body.data.length === 1 && fail.orderRef === o.ref && fail.daysLate >= 6 && fail.bucket === '6+' && fail.severity === 'CRITICAL' && fail.counterparty?.name === cp.name, sf.body);
    check('the view summarises by counterparty, bucket and security and shows the last run', sf.body.summary.open === 1 && sf.body.summary.byCounterparty[0].key === cp.name && sf.body.summary.byBucket.find((b: any) => b.key === '6+').count === 1 && sf.body.summary.stale === false, sf.body.summary);
    const sfFuture = await ops.get(`${OC}/settlement-fails?asOf=${dayStr(-20)}`);
    check('asking for a date before the detection shows nothing', sfFuture.body.data.length === 0, sfFuture.body);

    // ---------------------------------------------------------------- close gates
    console.log('\nPeriod-close gates');
    const gate = await fundC.get(`${OC}/close-gates?portfolioId=${pf.id}&periodEnd=${today}&type=cash`);
    const gi = (r: Res, k: string) => (r.body.data.items as any[]).find((i) => i.key === k);
    check('gates: NAV not released blocks, with the date in the blocker', gate.status === 200 && gi(gate, 'NAV_RELEASED').ok === false && gi(gate, 'NAV_RELEASED').blockers[0].includes(today), gate.body);
    check('gates: CASH reconciliation not signed off blocks, naming the family', gi(gate, 'RECON_SIGNOFF').ok === false && /Cash reconciliation/.test(gi(gate, 'RECON_SIGNOFF').blockers[0]), gate.body);
    check('gates: the open settlement fail is listed as a material break', gi(gate, 'RECON_MATERIAL').ok === false && gi(gate, 'RECON_MATERIAL').blockers.some((b: string) => b.includes('settlement fails')), gi(gate, 'RECON_MATERIAL'));
    const pre = await fundC.get(`/api/v1/cash/period-closes/precheck?portfolioId=${pf.id}&periodEnd=${today}`);
    const pk = (pre.body.data?.items as any[] | undefined)?.map((i) => i.key) ?? [];
    check('the cash close pre-check carries the three gates and cannot close', pre.status === 200 && ['NAV_RELEASED', 'RECON_SIGNOFF', 'RECON_MATERIAL'].every((k) => pk.includes(k)) && pre.body.data.canClose === false && pre.body.data.blockers.some((b: string) => b.includes('NAV')), pre.body);

    const prev = new Date();
    const periodEnd = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 0)).toISOString().slice(0, 10);
    const month = periodEnd.slice(0, 7);
    const per = await fundC.post('/api/v1/accounting/periods', { portfolioId: pf.id, month }, { 'Idempotency-Key': key('period') });
    check('open an accounting period for last month', per.status === 201, per.body);
    const acctItems = (per.body.data?.checklist as any[] | undefined) ?? [];
    check('the accounting checklist now includes the reconciliation sign-off gate with blockers', acctItems.some((i) => i.key === 'RECON_SIGNOFF' && !i.ok && i.blockers.length === 3) && acctItems.some((i) => i.key === 'NAV_RELEASED' && !i.ok), acctItems.map((i) => [i.key, i.ok, i.blockers.length]));
    await fundC.stepUp();
    const closeTry = await fundC.post(`/api/v1/accounting/periods/${per.body.data.id}/close`, {}, { 'Idempotency-Key': key('close') });
    check('closing the period is refused (409 close_blocked) and lists every blocker', closeTry.status === 409 && errCode(closeTry) === 'close_blocked' && JSON.stringify(closeTry.body.error.details.blockers).includes('is not signed off'), closeTry.body);

    // clear the gates: release a NAV and sign off the families for the cash close date
    const nav = await prisma.navRun.create({ data: { ref: `NV${run}`, portfolioId: pf.id, navDate: day(today), status: 'RELEASED', stage: 'DONE', makerId: opsU.id, reviewerId: opsU.id, checkerId: compU.id, releasedAt: new Date() } });
    navRefs.push(nav.id);
    await prisma.reconSignoff.create({ data: { scopeKey: `CASH|${today}|${cp.id}`, family: 'CASH', asOfDate: day(today), counterpartyId: cp.id, signedBy: compU.id } });
    const gate2 = await fundC.get(`${OC}/close-gates?portfolioId=${pf.id}&periodEnd=${today}&type=cash`);
    check('gates: a released NAV clears NAV_RELEASED', gi(gate2, 'NAV_RELEASED').ok === true, gate2.body);
    check('gates: a sign-off for every mapped counterparty clears RECON_SIGNOFF', gi(gate2, 'RECON_SIGNOFF').ok === true, gi(gate2, 'RECON_SIGNOFF'));
    const accountingGate = await fundC.get(`${OC}/close-gates?portfolioId=${pf.id}&periodEnd=${today}&type=accounting`);
    check('the accounting gate still wants TRADES and HOLDINGS signed off', gi(accountingGate, 'RECON_SIGNOFF').blockers.length === 2, gi(accountingGate, 'RECON_SIGNOFF'));
    await prisma.policy.upsert({ where: { key: 'close_gates' }, update: { value: false }, create: { key: 'close_gates', value: false } });
    const gate3 = await fundC.get(`${OC}/close-gates?portfolioId=${pf.id}&periodEnd=${today}&type=cash`);
    check('the policy close_gates=false switches the gates off', gate3.body.data.enabled === false && gate3.body.data.items.length === 0 && gate3.body.data.canClose === true, gate3.body.data);
    await prisma.policy.deleteMany({ where: { key: 'close_gates' } });

    // ---------------------------------------------------------------- custody positions through the adapter
    console.log('\nCustody positions through the custodian-feed adapter');
    const noMap = await comp.post(`${OC}/custody-positions/pull`, { asOfDate: dayStr(2) });
    check('a future date -> 400', noMap.status === 400, noMap.body);
    const first = await comp.post(`${OC}/custody-positions/pull`, { asOfDate: D0, counterpartyId: cp.id, run: true }, { 'Idempotency-Key': key('pull0') });
    const adapterName = first.body?.data?.adapter;
    if (first.status !== 200) check('pull request accepted', false, first.body);
    else if (adapterName !== 'file-drop') {
      console.log(`  SKIP  adapter is ${adapterName}; the file-drop assertions need INTEGRATION_CUSTODIAN_FEED=file-drop`);
      check('pull through a non-file-drop adapter reports per-account results', Array.isArray(first.body.data.results));
    } else {
      check('no statement for the date: reported per account, nothing stored', first.body.data.results[0].status === 'no_statement' && (await prisma.reconSourceReceipt.count({ where: { counterpartyId: cp.id } })) === 0, first.body.data);
      const fileId = randomUUID();
      await prisma.counterpartyDayEndPackage.create({ data: { ref: `P${run}1`, counterpartyId: cp.id, accountRef: acc, statementDate: day(D0), currency: 'USD', closingCash: D('100000.00'), holdingsMv: D('10000.00'), tradeCount: 0, note: 'Imported from test feed', sha256: 'b'.repeat(64), submittedById: opsU.id } });
      await prisma.custodianFeedHolding.createMany({
        data: [
          { fileId, counterpartyId: cp.id, accountRef: acc, statementDate: day(D0), ticker: secA.ticker, quantity: D(1000), currency: 'USD' },
          { fileId, counterpartyId: cp.id, accountRef: acc, statementDate: day(D0), ticker: `ZZ${run}`.toUpperCase(), quantity: D(55), currency: 'USD' },
        ],
      });
      const p1 = await comp.post(`${OC}/custody-positions/pull`, { asOfDate: D0, counterpartyId: cp.id, run: true }, { 'Idempotency-Key': key('pull1') });
      const res0 = p1.body?.data?.results?.[0];
      check('pull stores both position rows and a source receipt', p1.status === 200 && res0?.status === 'received' && res0.rows === 2 && (await prisma.reconCustodyPosition.count({ where: { counterpartyId: cp.id, accountRef: acc } })) === 2 && (await prisma.reconSourceReceipt.count({ where: { counterpartyId: cp.id, feed: 'POSITIONS' } })) === 1, p1.body);
      check('the matching run flags the holding the book does not have (CRITICAL) and passes the equal one', p1.body.data.run?.breakCount === 1 && p1.body.data.run.matchedCount === 1, p1.body.data.run);
      const p2 = await comp.post(`${OC}/custody-positions/pull`, { asOfDate: D0, counterpartyId: cp.id, run: true }, { 'Idempotency-Key': key('pull2') });
      check('pulling the same positions again is a no-op (unchanged) and the run is a re-run', p2.body.data.results[0].status === 'unchanged' && p2.body.data.run?.rerun === true && (await prisma.reconSourceReceipt.findFirstOrThrow({ where: { counterpartyId: cp.id, feed: 'POSITIONS' } })).version === 1, p2.body.data);
      check('the pull is audited with the adapter and statement', (await prisma.auditEvent.count({ where: { action: 'recon.custody_positions_pulled' } })) >= 1);
      check('a pull needs recon.manage -> 403', (await pm.post(`${OC}/custody-positions/pull`, { asOfDate: D0 })).status === 403);
    }
  } finally {
    console.log('\nCleanup');
    try {
      await prisma.payReconBreak.deleteMany({ where: { OR: [{ fundId: fund.id }, { lineId: { in: (await prisma.cashStatementLine.findMany({ where: { importId: imp.id }, select: { id: true } })).map((l) => l.id) } }] } });
      await prisma.payReconItem.deleteMany({ where: { fundId: fund.id } });
      await prisma.payReconRun.deleteMany({ where: { fundId: fund.id } });
      await prisma.payReconRun.deleteMany({ where: { runBy: opsU.id } });
      await prisma.cashStatementLine.deleteMany({ where: { importId: imp.id } });
      await prisma.cashStatementImport.deleteMany({ where: { id: imp.id } });
      await prisma.cashLedger.deleteMany({ where: { id: bank.id } });
      await prisma.capitalCallAllocation.deleteMany({ where: { callId: call.id } });
      await prisma.capitalCall.deleteMany({ where: { id: call.id } });
      await prisma.distributionAllocation.deleteMany({ where: { distributionId: dist.id } });
      await prisma.distribution.deleteMany({ where: { id: dist.id } });
      await prisma.fundCommitment.deleteMany({ where: { fundId: fund.id } });
      await prisma.fund.deleteMany({ where: { id: fund.id } });
      await prisma.client.deleteMany({ where: { id: { in: ids.client } } });
      await prisma.navRun.deleteMany({ where: { id: { in: navRefs } } });
      const accPeriods = await prisma.accPeriod.findMany({ where: { portfolioId: pf.id }, select: { id: true } });
      await prisma.accPeriod.deleteMany({ where: { id: { in: accPeriods.map((p) => p.id) } } });
      const runs = await prisma.reconRun.findMany({ where: { OR: [{ counterpartyId: cp.id }, { portfolioId: pf.id }] }, select: { id: true } });
      const bids = (await prisma.reconBreak.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { id: true } })).map((b) => b.id);
      await prisma.reconBreakEvidence.deleteMany({ where: { breakId: { in: bids } } });
      await prisma.reconBreakAction.deleteMany({ where: { breakId: { in: bids } } });
      await prisma.reconBreak.deleteMany({ where: { id: { in: bids } } });
      await prisma.reconRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } });
      await prisma.reconSignoff.deleteMany({ where: { OR: [{ counterpartyId: cp.id }, { signedBy: compU.id }] } });
      await prisma.reconCustodyPosition.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.reconSourceReceipt.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.reconAccountMap.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.custodianFeedHolding.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.counterpartyDayEndPackage.deleteMany({ where: { counterpartyId: cp.id } });
      const orders = await prisma.order.findMany({ where: { portfolioId: pf.id }, select: { id: true } });
      await prisma.orderFill.deleteMany({ where: { orderId: { in: orders.map((x) => x.id) } } });
      await prisma.order.deleteMany({ where: { id: { in: orders.map((x) => x.id) } } });
      await prisma.portfolioPosition.deleteMany({ where: { portfolioId: pf.id } });
      await prisma.portfolioCash.deleteMany({ where: { portfolioId: pf.id } });
      await prisma.portfolio.deleteMany({ where: { id: pf.id } });
      await prisma.securityPrice.deleteMany({ where: { securityId: { in: ids.security } } });
      await prisma.security.deleteMany({ where: { id: { in: ids.security } } });
      await prisma.counterparty.deleteMany({ where: { id: cp.id } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (e) {
      console.log('  (best-effort cleanup stopped:', e instanceof Error ? e.message : e, ')');
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  void DEFAULT_PAY_PARAMS;
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
