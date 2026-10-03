/**
 * Reconciliations checks against a RUNNING API: each family matches and breaks as hand-computed, tolerance edges,
 * idempotent re-runs, break lifecycle with segregation of duties and step-up MFA, daily sign-off gating, source health,
 * audit events, outbox notifications, permission and portal refusals.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4251 npx tsx scripts/test-recon.ts
 *
 * Disposable schema only (docs: `nexus_recon_test`): run `prisma migrate deploy` and `prisma/seed.ts` first (role
 * catalogue), then start the API against the same DATABASE_URL. Creates throwaway users, counterparties, securities,
 * portfolios, orders and custodian records under its own run id (best-effort removal at the end).
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { compareAmount, compareCount, matchTrades, severityForPct, type ExtTrade, type IntFill } from '../src/modules/recon/recon.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Rc-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `rc-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

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
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    put: (p: string, b?: unknown, h?: Record<string, string>) => send('PUT', p, b ?? {}, h),
    del: (p: string) => send('DELETE', p),
    login: (email: string) => send('POST', '/api/auth/login', { email, password, portal }),
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

const R = '/api/v1/recon';
const errCode = (r: Res) => r.body?.error?.code;
const near = (a: unknown, b: number, eps = 0.001) => typeof a === 'string' || typeof a === 'number' ? Math.abs(Number(a) - b) <= eps : false;

async function main() {
  // ---------------------------------------------------------------- pure engine, hand-computed
  console.log('\nMatching engine (pure)');
  check('severity bands: 20% CRITICAL, 5.01% HIGH, 5% MEDIUM, 1.01% MEDIUM, 1% LOW', severityForPct(20) === 'CRITICAL' && severityForPct('5.01') === 'HIGH' && severityForPct(5) === 'MEDIUM' && severityForPct('1.01') === 'MEDIUM' && severityForPct(1) === 'LOW');
  check('amount inside the absolute tolerance is a match, one cent more is not', compareAmount(D(100), D('100.01'), { abs: D('0.01') }) === null && compareAmount(D(100), D('100.02'), { abs: D('0.01') })?.severity === 'LOW');
  check('holdings tolerance is a percent of the custodian value', compareAmount(D(12500), D('12562.50'), { pctOfExternal: D('0.5') }) === null && compareAmount(D(12500), D(12570), { pctOfExternal: D('0.5') })?.severity === 'LOW');
  check('count difference is at least HIGH and CRITICAL from 20%', compareCount(5, 5) === null && compareCount(6, 5)?.severity === 'HIGH' && compareCount(7, 5)?.severity === 'CRITICAL');
  const ext = (o: Partial<ExtTrade> & { tradeRef: string }): ExtTrade => ({ id: o.tradeRef, ticker: 'AAA', side: 'BUY', quantity: D(100), price: D(10), currency: 'USD', counterpartyId: 'c', counterpartyRef: 'C1', accountRef: 'a', portfolioId: 'p', ...o });
  const int = (o: Partial<IntFill> & { id: string }): IntFill => ({ refs: [], orderRef: 'O', ticker: 'AAA', side: 'BUY', quantity: D(100), price: D(10), currency: 'USD', portfolioId: 'p', ...o });
  const eng1 = matchTrades([ext({ tradeRef: 't1' })], [int({ id: 'i1', refs: ['T1'] })], D('0.01'));
  check('exact reference match is clean', eng1.matched.length === 1 && eng1.detected.length === 0);
  const eng2 = matchTrades([ext({ tradeRef: 't2', quantity: D(101) })], [int({ id: 'i2', refs: ['T2'] })], D('0.01'));
  check('reference match with a different quantity is a HIGH QUANTITY_DIFF', eng2.detected[0]?.kind === 'QUANTITY_DIFF' && eng2.detected[0].severity === 'HIGH');
  const eng3 = matchTrades([ext({ tradeRef: 'x', price: D('10.01') }), ext({ tradeRef: 'y', quantity: D(50), price: D('10.02') })], [int({ id: 'a' }), int({ id: 'b', quantity: D(50) })], D('0.01'));
  check('ticker+side+quantity fallback: +0.01 matches, +0.02 breaks', eng3.matched.length === 1 && eng3.detected.length === 1 && eng3.detected[0]!.kind === 'PRICE_OUT_OF_TOLERANCE');
  const eng4 = matchTrades([ext({ tradeRef: 'z', quantity: D(100) })], [int({ id: 'k', quantity: D(99) })], D('0.01'));
  check('a quantity that is not exact never matches by attributes', eng4.detected.map((d) => d.kind).sort().join() === 'MISSING_EXTERNAL,MISSING_INTERNAL');

  // ---------------------------------------------------------------- fixtures
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const clientIds: string[] = [];
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];
  const counterpartyIds: string[] = [];
  const runIds = new Set<string>();

  const mkUser = async (label: string, portal: string, ...roleKeys: string[]) => {
    const u = await prisma.user.create({ data: { email: `rc-${run}-${label}@example.test`, name: `RC ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    for (const k of roleKeys) await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, k)).id } });
    return u;
  };
  const opsU = await mkUser('ops', 'admin', 'operations'); // maker / runner
  const fundU = await mkUser('fund', 'admin', 'fund_accountant'); // checker
  const compU = await mkUser('comp', 'admin', 'compliance'); // independent sign-off
  const pmU = await mkUser('pm', 'admin', 'portfolio_manager'); // operations.view only
  const sysU = await mkUser('sys', 'admin', 'system_admin'); // operations.view only (locked bundle)
  const analystU = await mkUser('analyst', 'admin', 'analyst'); // no operations.view
  const lpU = await mkUser('lp', 'investor', 'finance');
  const lpClient = await prisma.client.create({ data: { ref: `X${run}L`, name: `RC LP ${run}`, type: 'Pension fund', portalEnabled: true, kycStatus: 'Current' } });
  clientIds.push(lpClient.id);
  await prisma.clientUser.create({ data: { userId: lpU.id, clientId: lpClient.id, investorRole: 'finance' } });

  const ops = client('admin');
  const fund = client('admin');
  const comp = client('admin');
  const pm = client('admin');
  const sys = client('admin');
  const analyst = client('admin');
  const lp = client('investor');
  const anon = client('admin');

  const D0 = dayStr(-1); // the reconciliation date
  const mkSecurity = async (suffix: string, price: number) => {
    const s = await prisma.security.create({
      data: { ticker: `R${run}${suffix}`.toUpperCase(), name: `Recon ${suffix} ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: `S-${suffix}`, status: 'Active' },
    });
    securityIds.push(s.id);
    await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: day(dayStr(-3)), price: D(price), source: 'TEST' } });
    return s;
  };
  const secA = await mkSecurity('A', 10);
  const secB = await mkSecurity('B', 5);

  const pf1 = await prisma.portfolio.create({ data: { ref: `RC-${run}-1`, name: `RC Portfolio 1 ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
  const pf2 = await prisma.portfolio.create({ data: { ref: `RC-${run}-2`, name: `RC Portfolio 2 ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
  portfolioIds.push(pf1.id, pf2.id);
  // PF1: cash 100,000.00; 1,000 A @ 10 + 500 B @ 5 = 12,500.00 securities.
  await prisma.portfolioCash.create({ data: { portfolioId: pf1.id, currency: 'USD', available: D(100000), asOf: day(dayStr(-3)) } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf1.id, securityId: secA.id, quantity: D(1000), avgCost: D(9), asOf: day(dayStr(-3)) } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf1.id, securityId: secB.id, quantity: D(500), avgCost: D(4), asOf: day(dayStr(-3)) } });
  await prisma.portfolioCash.create({ data: { portfolioId: pf2.id, currency: 'USD', available: D(5000), asOf: day(dayStr(-3)) } });

  const acc1 = `ACC1-${run}`;
  const acc2 = `ACC2-${run}`;
  const cp1 = await prisma.counterparty.create({ data: { ref: `CPX${run}1`, name: `RC Custodian ${run}`, type: 'CUSTODIAN', accounts: [acc1] } });
  const cp2 = await prisma.counterparty.create({ data: { ref: `CPX${run}2`, name: `RC Custodian B ${run}`, type: 'CUSTODIAN', accounts: [acc2] } });
  const cp3 = await prisma.counterparty.create({ data: { ref: `CPX${run}3`, name: `RC Unmapped ${run}`, type: 'CUSTODIAN', accounts: [`ACC3-${run}`] } });
  counterpartyIds.push(cp1.id, cp2.id, cp3.id);

  let seq = 0;
  const mkExec = (tradeRef: string, o: { ticker: string; side: string; qty: number; price: string; date?: string; status?: string; cp?: typeof cp1; account?: string }) =>
    prisma.counterpartyExecution.create({
      data: {
        ref: `X${run}${++seq}`,
        counterpartyId: (o.cp ?? cp1).id,
        tradeRef,
        executionAt: new Date(`${o.date ?? D0}T10:00:00.000Z`),
        accountRef: o.account ?? acc1,
        ticker: o.ticker,
        side: o.side,
        quantity: D(o.qty),
        price: D(o.price),
        currency: 'USD',
        status: o.status ?? 'Received',
        submittedById: opsU.id,
      },
    });
  const mkFill = async (portfolioId: string, security: { id: string }, side: string, qty: number, price: string, sourceRef: string | null, date = D0) => {
    const o = await prisma.order.create({
      data: {
        ref: `RC${run}${++seq}`,
        portfolioId,
        securityId: security.id,
        side,
        quantity: D(qty),
        orderType: 'MARKET',
        currency: 'USD',
        decisionPrice: D(price),
        status: 'Filled',
        makerId: opsU.id,
        filledQty: D(qty),
        avgPrice: D(price),
      },
    });
    const f = await prisma.orderFill.create({ data: { orderId: o.id, quantity: D(qty), price: D(price), executedAt: new Date(`${date}T10:00:00.000Z`), source: 'CONTRACT_NOTE', sourceRef, recordedBy: opsU.id } });
    return { order: o, fill: f };
  };

  // Internal fills (PF1) and custodian executions (CP1 / acc1), see the table in docs/ADMIN-REAL-PAGES.md.
  await mkFill(pf1.id, secA, 'BUY', 100, '10.00', 'CN-1'); //   matches E1 by reference
  await mkFill(pf1.id, secA, 'SELL', 50, '10.50', null); //     matches E2 by attributes, price +0.01 (edge, inside)
  const f3 = await mkFill(pf1.id, secB, 'BUY', 200, '5.00', null); // matches E3 by attributes, price +0.02 (break, LOW)
  await mkFill(pf1.id, secA, 'BUY', 10, '10.00', 'CN-4'); //    reference match, custodian says 11 (break, HIGH)
  await mkFill(pf1.id, secB, 'BUY', 33, '5.00', null); //       nothing at the custodian (break, HIGH)
  await mkFill(pf1.id, secA, 'BUY', 999, '10.00', null, dayStr(-5)); // outside the date: ignored
  await mkExec('CN-1', { ticker: secA.ticker, side: 'BUY', qty: 100, price: '10.00' });
  await mkExec('X-2', { ticker: secA.ticker, side: 'SELL', qty: 50, price: '10.51' });
  await mkExec('X-3', { ticker: secB.ticker, side: 'BUY', qty: 200, price: '5.02' });
  await mkExec('CN-4', { ticker: secA.ticker, side: 'BUY', qty: 11, price: '10.00' });
  const e5 = await mkExec('X-5', { ticker: secB.ticker, side: 'SELL', qty: 70, price: '5.00' }); // not in the internal book (break, CRITICAL)
  await mkExec('OLD-1', { ticker: secA.ticker, side: 'BUY', qty: 1, price: '1', status: 'Superseded' }); // ignored
  await mkExec('PAST-1', { ticker: secA.ticker, side: 'BUY', qty: 1, price: '1', date: dayStr(-6) }); // other date: ignored
  const dayEnd = await prisma.counterpartyDayEndPackage.create({
    data: { ref: `D${run}1`, counterpartyId: cp1.id, accountRef: acc1, statementDate: day(D0), currency: 'USD', closingCash: D('100000.00'), holdingsMv: D('12500.00'), tradeCount: 5, sha256: 'a'.repeat(64), submittedById: opsU.id },
  });

  const mapBody = (cp: { id: string }, account: string, pf: { id: string }) => ({ counterpartyId: cp.id, accountRef: account, portfolioId: pf.id });
  const runReq = (c: Client, body: object, label = 'run') => c.post(`${R}/runs`, body, { 'Idempotency-Key': key(label) });
  const doRun = async (c: Client, body: object, label = 'run') => {
    const r = await runReq(c, body, label);
    if (r.body?.data?.id) runIds.add(r.body.data.id);
    return r;
  };
  const breaksOf = async (c: Client, runId: string) => (await c.get(`${R}/breaks?runId=${runId}&limit=500`)).body;
  const findBreak = (body: any, itemKeyEnd: string) => (Array.isArray(body?.data) ? body.data : body?.breaks)?.find((b: any) => b.itemKey.endsWith(itemKeyEnd));
  const staleMfa = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
  const dbRun = async (family: string, cpId: string | null = null, pfId: string | null = null) =>
    prisma.reconRun.findUnique({ where: { scopeKey: `${family}|${D0}|${cpId ?? '*'}|${pfId ?? '*'}` } });

  try {
    console.log('\nSign-in and MFA');
    for (const [c, u] of [[ops, opsU], [fund, fundU], [comp, compU], [pm, pmU], [sys, sysU], [analyst, analystU], [lp, lpU]] as const) {
      check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    }
    for (const [name, c] of [['fund', fund], ['comp', comp]] as const) check(`${name} enrols TOTP`, await c.enrolMfa());

    // ---------------------------------------------------------------- permissions
    console.log('\nPermissions and portals');
    check('anonymous -> 401', (await anon.get(`${R}/breaks`)).status === 401);
    const lpRes = await lp.get(`${R}/breaks`);
    check('investor session -> 403 portal_access_denied', lpRes.status === 403 && errCode(lpRes) === 'portal_access_denied', lpRes.body);
    const an = await analyst.get(`${R}/breaks`);
    check('analyst (no operations.view) cannot read', an.status === 403 && errCode(an) === 'permission_denied', an.body);
    check('portfolio manager (operations.view) can read', (await pm.get(`${R}/breaks`)).status === 200);
    const pmRun = await pm.post(`${R}/runs`, { family: 'TRADES', asOfDate: D0 }, { 'Idempotency-Key': key('pm') });
    check('portfolio manager cannot run matching (recon.manage missing)', pmRun.status === 403 && errCode(pmRun) === 'permission_denied', pmRun.body);
    const sysRun = await sys.post(`${R}/runs`, { family: 'TRADES', asOfDate: D0 }, { 'Idempotency-Key': key('sys') });
    check('system admin does not hold recon.manage', sysRun.status === 403, sysRun.body);
    const sysMap = await sys.put(`${R}/account-map`, mapBody(cp1, acc1, pf1));
    check('system admin cannot map accounts', sysMap.status === 403, sysMap.body);
    check('fund accountant can read sign-offs (operations.view)', (await fund.get(`${R}/signoffs`)).status === 200);
    const pmSign = await pm.post(`${R}/signoffs`, { family: 'TRADES', asOfDate: D0 });
    check('portfolio manager cannot sign off', pmSign.status === 403 && errCode(pmSign) === 'permission_denied', pmSign.body);

    // ---------------------------------------------------------------- mapping and validation
    console.log('\nAccount mapping and run validation');
    const noMap = await doRun(ops, { family: 'TRADES', asOfDate: D0, counterpartyId: cp1.id }, 'nomap');
    check('run without any account mapping -> 409 no_account_mapping', noMap.status === 409 && errCode(noMap) === 'no_account_mapping', noMap.body);
    const badAcc = await ops.put(`${R}/account-map`, mapBody(cp1, 'NOT-AN-ACCOUNT', pf1));
    check('mapping an account the counterparty does not list -> 400', badAcc.status === 400, badAcc.body);
    const m1 = await ops.put(`${R}/account-map`, mapBody(cp1, acc1, pf1));
    check('map CP1 account to portfolio 1', m1.status === 200 && m1.body.data.portfolioId === pf1.id, m1.body);
    const m1b = await ops.put(`${R}/account-map`, mapBody(cp1, acc1, pf1));
    check('mapping again is an update, not a duplicate', m1b.status === 200 && (await prisma.reconAccountMap.count({ where: { counterpartyId: cp1.id } })) === 1);
    const mapList = await ops.get(`${R}/account-map`);
    check('account map lists the mapping with names', mapList.body?.data?.some((m: any) => m.accountRef === acc1 && m.portfolio.ref === pf1.ref && m.counterparty.ref === cp1.ref), mapList.body);
    check('missing Idempotency-Key -> 400', (await ops.post(`${R}/runs`, { family: 'TRADES', asOfDate: D0 })).status === 400);
    check('unknown family -> 400', (await runReq(ops, { family: 'FX', asOfDate: D0 })).status === 400);
    check('future date -> 400', (await runReq(ops, { family: 'TRADES', asOfDate: dayStr(2) })).status === 400);
    check('bad date -> 400', (await runReq(ops, { family: 'TRADES', asOfDate: '2026-13-45' })).status === 400);
    check('unknown counterparty -> 400', (await runReq(ops, { family: 'TRADES', asOfDate: D0, counterpartyId: 'nope' })).status === 400);
    check('out-of-range tolerance -> 400', (await runReq(ops, { family: 'CASH', asOfDate: D0, tolerances: { holdingsPct: 500 } })).status === 400);

    // ---------------------------------------------------------------- TRADES
    console.log('\nTRADES family');
    const k = key('trades');
    const body = { family: 'TRADES', asOfDate: D0 };
    const t1 = await ops.post(`${R}/runs`, body, { 'Idempotency-Key': k });
    if (t1.body?.data?.id) runIds.add(t1.body.data.id);
    check('first run -> 201 with a RUN reference', t1.status === 201 && /^RUN-\d{5}$/.test(t1.body?.data?.ref) && t1.body.rerun === false, t1.body);
    const tradesRunId = t1.body.data.id as string;
    check('2 matched, 4 breaks', t1.body.data.matchedCount === 2 && t1.body.data.breakCount === 4 && t1.body.data.status === 'BREAKS', t1.body?.data);
    check('match rate = 2 / 6 = 33.33%', t1.body.data.matchRate === 33.33, t1.body?.data?.matchRate);
    const replay = await ops.post(`${R}/runs`, body, { 'Idempotency-Key': k });
    check('same Idempotency-Key replays the stored response', replay.status === 201 && replay.headers.get('idempotent-replayed') === 'true' && replay.body.data.id === tradesRunId);
    const reuse = await ops.post(`${R}/runs`, { ...body, tolerances: { price: 5 } }, { 'Idempotency-Key': k });
    check('same key with another payload -> 409 idempotency_key_reused', reuse.status === 409 && errCode(reuse) === 'idempotency_key_reused', reuse.body);
    const tb = await breaksOf(ops, tradesRunId);
    check('exactly 4 breaks stored', tb.total === 4, tb.total);
    const bE3 = findBreak(tb, ':X-3');
    const bE4 = findBreak(tb, ':CN-4');
    const bE5 = findBreak(tb, ':X-5');
    const bF6 = tb.data.find((b: any) => b.kind === 'MISSING_EXTERNAL');
    check('price +0.02 -> PRICE_OUT_OF_TOLERANCE, LOW, difference 0.02', bE3?.kind === 'PRICE_OUT_OF_TOLERANCE' && bE3.severity === 'LOW' && near(bE3.difference, 0.02) && bE3.status === 'NEW', bE3);
    check('LOW severity: 0.02 / 5.02 = 0.3984%', near(bE3?.differencePct, 0.3984, 0.0001), bE3?.differencePct);
    check('reference match with qty 11 vs 10 -> QUANTITY_DIFF, HIGH, difference 1 (9.0909%)', bE4?.kind === 'QUANTITY_DIFF' && bE4.severity === 'HIGH' && near(bE4.difference, 1) && near(bE4.differencePct, 9.0909, 0.0001), bE4);
    check('custodian trade not booked -> MISSING_INTERNAL, CRITICAL, no internal value', bE5?.kind === 'MISSING_INTERNAL' && bE5.severity === 'CRITICAL' && bE5.internalValue === null && bE5.externalValue?.quantity === '70', bE5);
    check('internal fill without custodian trade -> MISSING_EXTERNAL, HIGH', bF6?.kind === 'MISSING_EXTERNAL' && bF6.severity === 'HIGH' && bF6.externalValue === null && bF6.internalValue?.quantity === '33', bF6);
    check('break carries counterparty and portfolio', bE3?.counterparty?.ref === cp1.ref && bE3.portfolio?.ref === pf1.ref && bF6.counterparty?.ref === cp1.ref, { a: bE3?.counterparty, b: bF6?.counterparty });
    check('breaks get REC references', /^REC-\d{5}$/.test(bE3?.ref));
    check('the superseded and out-of-date executions and the out-of-date fill were ignored', !tb.data.some((b: any) => /OLD-1|PAST-1/.test(b.itemKey)) && !tb.data.some((b: any) => b.internalValue?.quantity === '999'));
    const execStatus = async (tr: string) => (await prisma.counterpartyExecution.findFirst({ where: { counterpartyId: cp1.id, tradeRef: tr } }))?.status;
    check('custodian execution status: matched ones Matched, exceptions Exception, superseded untouched', (await execStatus('CN-1')) === 'Matched' && (await execStatus('X-2')) === 'Matched' && (await execStatus('X-3')) === 'Exception' && (await execStatus('X-5')) === 'Exception' && (await execStatus('OLD-1')) === 'Superseded');
    check('tolerance edge: +0.01 (X-2) did not break', !findBreak(tb, ':X-2'));

    console.log('\nIdempotent re-run');
    const t2 = await doRun(ops, body, 'rerun');
    check('re-run with a new key -> 200 rerun on the same run', t2.status === 200 && t2.body.rerun === true && t2.body.data.id === tradesRunId && t2.body.data.runCount === 2, t2.body?.data);
    check('re-run created no duplicate breaks', (await prisma.reconBreak.count({ where: { runId: tradesRunId } })) === 4 && (await prisma.reconRun.count({ where: { scopeKey: `TRADES|${D0}|*|*` } })) === 1);
    const tbAgain = await breaksOf(ops, tradesRunId);
    check('break references and ids are stable across re-runs', findBreak(tbAgain, ':X-3').id === bE3.id && findBreak(tbAgain, ':X-5').ref === bE5.ref);
    const [pa, pb] = await Promise.all([ops.post(`${R}/runs`, body, { 'Idempotency-Key': key('par1') }), ops.post(`${R}/runs`, body, { 'Idempotency-Key': key('par2') })]);
    check('two concurrent runs both succeed without duplicating breaks', pa.status < 300 && pb.status < 300 && (await prisma.reconBreak.count({ where: { runId: tradesRunId } })) === 4, [pa.status, pb.status]);
    const scoped = await doRun(ops, { ...body, counterpartyId: cp1.ref, portfolioId: pf1.ref }, 'scoped');
    check('a counterparty + portfolio scope is its own run (accepts refs)', scoped.status === 201 && scoped.body.data.id !== tradesRunId && scoped.body.data.counterparty.ref === cp1.ref && scoped.body.data.portfolio.ref === pf1.ref, scoped.body);
    const dashed = await doRun(ops, { family: 'dayend-count', asOfDate: D0, counterpartyId: cp1.id }, 'dash');
    check('family accepts DAYEND-COUNT spelling', dashed.status === 201 && dashed.body.data.family === 'DAYEND_COUNT', dashed.body);

    console.log('\nAuto-clear and reopen');
    await prisma.orderFill.updateMany({ where: { orderId: f3.order.id }, data: { price: D('5.02') } });
    const t3 = await doRun(ops, body, 'fix');
    check('price corrected internally -> re-run clears the break to MATCHED', t3.body?.data?.matchedCount === 3 && t3.body.data.breakCount === 3 && findBreak(t3.body, ':X-3')?.status === 'MATCHED', t3.body?.data);
    const evs = await prisma.reconBreakEvent.findMany({ where: { breakId: bE3.id }, orderBy: { createdAt: 'asc' } });
    check('timeline shows detected then auto_cleared', evs.map((e) => e.action).join() === 'detected,auto_cleared', evs.map((e) => e.action));
    check('the cleared execution is Matched again', (await execStatus('X-3')) === 'Matched');
    await prisma.orderFill.updateMany({ where: { orderId: f3.order.id }, data: { price: D('5.00') } });
    const t4 = await doRun(ops, body, 'unfix');
    const reopened = findBreak(t4.body, ':X-3');
    check('the same difference reappearing reopens a MATCHED break (same ref)', reopened?.status === 'NEW' && reopened.id === bE3.id && t4.body.data.breakCount === 4, reopened);

    // ---------------------------------------------------------------- break lifecycle
    console.log('\nBreak lifecycle: SoD, step-up, validation');
    const det = await ops.get(`${R}/breaks/${bE5.id}`);
    check('detail exposes allowed actions for the maker role (assign, investigate, resolve; no approve)', det.body?.allowed?.assign && det.body.allowed.resolve && !det.body.allowed.approve, det.body?.allowed);
    check('an open CRITICAL break is flagged overdue', det.body?.data?.overdue === true && det.body.data.ageDays === 0);
    const asg = await ops.post(`${R}/breaks/${bE5.id}/assign`, { ownerUserId: fundU.id, note: 'Please look at the custodian confirmation' });
    check('assign NEW -> ASSIGNED with the owner', asg.status === 200 && asg.body.data.status === 'ASSIGNED' && asg.body.data.ownerUserId === fundU.id && asg.body.data.ownerName === 'RC fund', asg.body);
    const ob = await prisma.outboxEvent.findMany({ where: { type: 'notify.users' }, orderBy: { id: 'desc' }, take: 40 });
    check('assignment queued a notification for the owner', ob.some((o) => (o.payload as any)?.type === 'recon.break_assigned' && (o.payload as any).userIds?.[0] === fundU.id && (o.payload as any).title.includes(bE5.ref)));
    const asgBad = await ops.post(`${R}/breaks/${bE5.id}/assign`, { ownerUserId: lpU.id });
    check('assigning to a non-staff user -> 400', asgBad.status === 400, asgBad.body);
    const asgStale = await ops.post(`${R}/breaks/${bE5.id}/assign`, { ownerUserId: compU.id, version: 1 });
    check('stale version -> 409 version_conflict', asgStale.status === 409 && errCode(asgStale) === 'version_conflict', asgStale.body);
    const noNote = await ops.post(`${R}/breaks/${bE5.id}/investigate`, { note: 'x' });
    check('investigate needs a note -> 400', noNote.status === 400);
    const inv = await ops.post(`${R}/breaks/${bE5.id}/investigate`, { note: 'Asked the custodian for the contract note' });
    check('investigate -> INVESTIGATING', inv.status === 200 && inv.body.data.status === 'INVESTIGATING', inv.body);
    const noEv = await ops.post(`${R}/breaks/${bE5.id}/resolve`, { cause: 'TIMING', rationale: 'Trade booked after cut-off' });
    check('resolve without an evidence reference -> 400', noEv.status === 400, noEv.body);
    const badCause = await ops.post(`${R}/breaks/${bE5.id}/resolve`, { cause: 'BECAUSE', rationale: 'Trade booked after cut-off', evidenceRef: 'DOC-1' });
    check('resolve with an unknown cause -> 400', badCause.status === 400);
    const shortWhy = await ops.post(`${R}/breaks/${bE5.id}/resolve`, { cause: 'TIMING', rationale: 'late', evidenceRef: 'DOC-1' });
    check('resolve with a one-word rationale -> 400', shortWhy.status === 400);
    await comp.stepUp();
    const fundNoResolve = await comp.post(`${R}/breaks/${bE5.id}/approve`, {});
    check('approve of a break that is not pending the checker -> 409 invalid_transition', fundNoResolve.status === 409 && errCode(fundNoResolve) === 'invalid_transition', fundNoResolve.body);
    const res1 = await ops.post(`${R}/breaks/${bE5.id}/resolve`, { cause: 'BOOKING_ERROR', rationale: 'Trade was not booked internally; booked late on the next day', evidenceRef: 'Contract note CN-5512' });
    check('resolve -> PENDING_CHECKER with maker, cause, rationale and evidence', res1.status === 200 && res1.body.data.status === 'PENDING_CHECKER' && res1.body.data.makerId === opsU.id && res1.body.data.cause === 'BOOKING_ERROR' && res1.body.data.evidenceRef === 'Contract note CN-5512' && !!res1.body.data.resolvedAt, res1.body);
    check('the maker sees approve blocked with a reason', res1.body.allowed.approve === false && !!res1.body.allowed.approveBlockedReason, res1.body.allowed);
    const ob2 = await prisma.outboxEvent.findMany({ where: { type: 'notify.permission' }, orderBy: { id: 'desc' }, take: 40 });
    check('resolution notified the holders of recon.signoff', ob2.some((o) => (o.payload as any)?.type === 'recon.break_pending_checker' && (o.payload as any).permission === 'recon.signoff'));
    const resAgain = await ops.post(`${R}/breaks/${bE5.id}/resolve`, { cause: 'TIMING', rationale: 'Second attempt at resolving', evidenceRef: 'DOC-2' });
    check('resolve again while pending -> 409', resAgain.status === 409 && errCode(resAgain) === 'invalid_transition');
    const selfApprove = await ops.post(`${R}/breaks/${bE5.id}/approve`, {});
    check('maker cannot approve their own resolution -> 403 segregation_of_duties', selfApprove.status === 403 && errCode(selfApprove) === 'segregation_of_duties', selfApprove.body);
    const selfReject = await ops.post(`${R}/breaks/${bE5.id}/reject`, { reason: 'self reject' });
    check('maker cannot reject their own resolution either', selfReject.status === 403 && errCode(selfReject) === 'segregation_of_duties', selfReject.body);
    const pmApprove = await pm.post(`${R}/breaks/${bE5.id}/approve`, {});
    check('a user without recon.signoff cannot approve -> 403', pmApprove.status === 403 && errCode(pmApprove) === 'permission_denied');
    await staleMfa(fundU.id);
    const stepNeg = await fund.post(`${R}/breaks/${bE5.id}/approve`, {});
    check('approve with stale MFA -> 401 step_up_required', stepNeg.status === 401 && errCode(stepNeg) === 'step_up_required', stepNeg.body);
    check('nothing changed without step-up', (await prisma.reconBreak.findUnique({ where: { id: bE5.id } }))?.status === 'PENDING_CHECKER');
    const noReject = await fund.post(`${R}/breaks/${bE5.id}/reject`, {});
    check('return to maker needs a reason -> 400', noReject.status === 400);
    const rej = await fund.post(`${R}/breaks/${bE5.id}/reject`, { reason: 'Contract note reference does not match the custodian trade' });
    check('checker returns it -> INVESTIGATING, checker cleared', rej.status === 200 && rej.body.data.status === 'INVESTIGATING' && rej.body.data.checkerId === null, rej.body);
    const ob3 = await prisma.outboxEvent.findMany({ where: { type: 'notify.users' }, orderBy: { id: 'desc' }, take: 40 });
    check('the maker was notified of the return', ob3.some((o) => (o.payload as any)?.type === 'recon.break_returned' && (o.payload as any).userIds?.[0] === opsU.id));
    const res2 = await ops.post(`${R}/breaks/${bE5.id}/resolve`, { cause: 'CUSTODIAN_ERROR', rationale: 'Custodian re-sent the note with the corrected reference', evidenceRef: 'Email 2026-10-03 14:02' });
    check('maker resolves again -> PENDING_CHECKER', res2.status === 200 && res2.body.data.status === 'PENDING_CHECKER');
    check('the checker sees approve allowed', (await fund.get(`${R}/breaks/${bE5.id}`)).body?.allowed?.approve === true);
    check('fund accountant step-up with TOTP', (await fund.stepUp()).status === 200);
    const appr = await fund.post(`${R}/breaks/${bE5.id}/approve`, { note: 'Evidence checked' });
    check('approve (different user, step-up) -> CLOSED with checker and closedAt', appr.status === 200 && appr.body.data.status === 'CLOSED' && appr.body.data.checkerId === fundU.id && appr.body.data.makerId === opsU.id && !!appr.body.data.closedAt, appr.body);
    check('a closed break is no longer overdue and allows no action', appr.body.data.overdue === false && Object.values(appr.body.allowed).every((v) => v === false || v === null), appr.body.allowed);
    const lateAppr = await fund.post(`${R}/breaks/${bE5.id}/approve`, {});
    check('approving a closed break -> 409', lateAppr.status === 409 && errCode(lateAppr) === 'invalid_transition');
    const lateAssign = await ops.post(`${R}/breaks/${bE5.id}/assign`, { ownerUserId: fundU.id });
    check('assigning a closed break -> 409', lateAssign.status === 409);
    const tl = (await ops.get(`${R}/breaks/${bE5.id}`)).body;
    check('timeline lists every step in order with actor names', tl.events.map((e: any) => e.action).join() === 'detected,assigned,investigating,resolved,rejected,resolved,approved' && tl.events.find((e: any) => e.action === 'approved').actorName === 'RC fund', tl.events.map((e: any) => e.action));
    const rerunClosed = await doRun(ops, body, 'afterclose');
    check('re-run with the same difference leaves a CLOSED break closed', findBreak(rerunClosed.body, ':X-5')?.status === 'CLOSED');
    await prisma.counterpartyExecution.updateMany({ where: { id: e5.id }, data: { quantity: D(71) } });
    const rerunChanged = await doRun(ops, body, 'changed');
    check('a CLOSED break whose difference changed is reopened', findBreak(rerunChanged.body, ':X-5')?.status === 'NEW' && findBreak(rerunChanged.body, ':X-5').externalValue.quantity === '71', findBreak(rerunChanged.body, ':X-5'));
    await prisma.counterpartyExecution.updateMany({ where: { id: e5.id }, data: { quantity: D(70) } });
    await doRun(ops, body, 'back');

    console.log('\nBreak queue filters and KPIs');
    const all = await ops.get(`${R}/breaks?limit=500`);
    const mine = (b: any) => b.counterparty?.ref === cp1.ref;
    check('queue lists breaks with ageing fields', all.status === 200 && all.body.data.every((b: any) => typeof b.ageDays === 'number' && typeof b.ageHours === 'number'));
    const fam = await ops.get(`${R}/breaks?family=TRADES&runId=${tradesRunId}`);
    check('family + run filter', fam.body.total === 4 && fam.body.data.every((b: any) => b.family === 'TRADES'));
    const sevF = await ops.get(`${R}/breaks?runId=${tradesRunId}&severity=high,critical`);
    check('severity filter accepts a list', sevF.body.data.every((b: any) => ['HIGH', 'CRITICAL'].includes(b.severity)) && sevF.body.total === 3, sevF.body.total);
    const openF = await ops.get(`${R}/breaks?runId=${tradesRunId}&status=open`);
    check('status=open expands to the four open states', openF.body.data.every((b: any) => ['NEW', 'ASSIGNED', 'INVESTIGATING', 'PENDING_CHECKER'].includes(b.status)) && openF.body.summary.open === openF.body.total);
    const ownerF = await ops.get(`${R}/breaks?ownerId=${fundU.id}&runId=${tradesRunId}`);
    check('owner filter', ownerF.body.total === 1 && ownerF.body.data[0].id === bE5.id, ownerF.body.total);
    check('age filter: nothing is a day old yet', (await ops.get(`${R}/breaks?runId=${tradesRunId}&ageDays=1`)).body.total === 0);
    const q = await ops.get(`${R}/breaks?q=${bE4.ref}`);
    check('search by reference', q.body.total === 1 && q.body.data[0].id === bE4.id);
    check('summary counts open breaks by severity', all.body.summary.openBySeverity && all.body.summary.openBySeverity.HIGH >= 2 && typeof all.body.summary.overdue === 'number', all.body.summary);
    check('bad status filter -> 400', (await ops.get(`${R}/breaks?status=NOPE`)).status === 400);
    check('unknown break -> 404', (await ops.get(`${R}/breaks/00000000-0000-0000-0000-000000000000`)).status === 404);
    void mine;

    // close the remaining material breaks (E4, F6) through the full workflow
    const closeBreak = async (b: any) => {
      await ops.post(`${R}/breaks/${b.id}/investigate`, { note: 'Investigating with the custodian' });
      const r = await ops.post(`${R}/breaks/${b.id}/resolve`, { cause: 'BOOKING_ERROR', rationale: 'Corrected in the book, evidence attached', evidenceRef: `EVID-${b.ref}` });
      await fund.stepUp();
      const a = await fund.post(`${R}/breaks/${b.id}/approve`, {});
      return [r.status, a.status, a.body?.data?.status];
    };

    // ---------------------------------------------------------------- sign-off
    console.log('\nDaily sign-off');
    await comp.stepUp();
    const rd = await comp.get(`${R}/signoffs/readiness?family=TRADES&asOf=${D0}`);
    check('readiness lists the open Critical/High breaks and is not ready', rd.status === 200 && rd.body.data.ready === false && rd.body.data.openMaterial.length === 3 && rd.body.data.openOther === 1, rd.body?.data);
    const so0 = await comp.post(`${R}/signoffs`, { family: 'TRADES', asOfDate: D0 });
    check('sign-off blocked while Critical/High breaks are open -> 409 open_material_breaks', so0.status === 409 && errCode(so0) === 'open_material_breaks' && so0.body.error.details.breaks.length >= 2, so0.body);
    const noRun = await comp.post(`${R}/signoffs`, { family: 'TRADES', asOfDate: dayStr(-20) });
    check('sign-off for a date with no run -> 409 no_run', noRun.status === 409 && errCode(noRun) === 'no_run', noRun.body);
    const results = [await closeBreak(findBreak(await breaksOf(ops, tradesRunId), ':CN-4')), await closeBreak((await breaksOf(ops, tradesRunId)).data.find((b: any) => b.kind === 'MISSING_EXTERNAL')), await closeBreak(findBreak(await breaksOf(ops, tradesRunId), ':X-5'))];
    check('the remaining Critical/High breaks close through resolve and approve', results.every((r) => r[0] === 200 && r[1] === 200 && r[2] === 'CLOSED'), results);
    const rd2 = await comp.get(`${R}/signoffs/readiness?family=TRADES&asOf=${D0}`);
    check('readiness: the LOW break does not block, and the signer is independent', rd2.body.data.ready === true && rd2.body.data.openOther === 1 && rd2.body.data.canSign === true, rd2.body.data);
    const opsReady = await ops.get(`${R}/signoffs/readiness?family=TRADES&asOf=${D0}`);
    check('readiness tells the runner they cannot sign', opsReady.body.data.independent === false && opsReady.body.data.canSign === false);
    const soOps = await ops.post(`${R}/signoffs`, { family: 'TRADES', asOfDate: D0 });
    check('the person who ran matching and resolved breaks cannot sign -> 403 segregation_of_duties', soOps.status === 403 && errCode(soOps) === 'segregation_of_duties', soOps.body);
    await staleMfa(compU.id);
    const soStale = await comp.post(`${R}/signoffs`, { family: 'TRADES', asOfDate: D0 });
    check('sign-off with stale MFA -> 401 step_up_required', soStale.status === 401 && errCode(soStale) === 'step_up_required', soStale.body);
    check('compliance step-up with TOTP', (await comp.stepUp()).status === 200);
    const so1 = await comp.post(`${R}/signoffs`, { family: 'TRADES', asOfDate: D0, note: 'All material breaks closed' });
    check('independent checker signs off -> 201', so1.status === 201 && so1.body.data.signedBy === compU.id && so1.body.data.family === 'TRADES' && so1.body.data.note === 'All material breaks closed', so1.body);
    const so2 = await comp.post(`${R}/signoffs`, { family: 'TRADES', asOfDate: D0 });
    check('second sign-off for the same family and date -> 409 already_signed_off', so2.status === 409 && errCode(so2) === 'already_signed_off', so2.body);
    const sl = await ops.get(`${R}/signoffs?family=TRADES&from=${D0}&to=${D0}`);
    check('sign-off list shows the signer', sl.body?.data?.length === 1 && sl.body.data[0].signedByName === 'RC comp' && sl.body.data[0].asOfDate === D0, sl.body);
    check('readiness now reports signed off', (await ops.get(`${R}/signoffs/readiness?family=TRADES&asOf=${D0}`)).body.data.signedOff?.signedByName === 'RC comp');

    // ---------------------------------------------------------------- CASH
    console.log('\nCASH family');
    const setPkg = (data: object) => prisma.counterpartyDayEndPackage.update({ where: { id: dayEnd.id }, data });
    const cashBody = { family: 'CASH', asOfDate: D0 };
    const c1 = await doRun(ops, cashBody, 'cash1');
    check('closing cash equal to portfolio cash matches (1 matched, 0 breaks, CLEAN)', c1.status === 201 && c1.body.data.matchedCount === 1 && c1.body.data.breakCount === 0 && c1.body.data.status === 'CLEAN', c1.body?.data);
    const cashRunId = c1.body.data.id as string;
    await setPkg({ closingCash: D('100000.01') });
    const c2 = await doRun(ops, cashBody, 'cash2');
    check('tolerance edge: custodian cash 0.01 higher still matches', c2.body.data.matchedCount === 1 && c2.body.data.breakCount === 0, c2.body?.data);
    await setPkg({ closingCash: D('100000.02') });
    const c3 = await doRun(ops, cashBody, 'cash3');
    const cb = (await breaksOf(ops, cashRunId)).data[0];
    check('0.02 higher breaks: CASH_DIFF, LOW, difference 0.02, internal 100000.00', c3.body.data.breakCount === 1 && cb?.kind === 'CASH_DIFF' && cb.severity === 'LOW' && near(cb.difference, 0.02) && cb.internalValue.amount === '100000.00' && cb.externalValue.amount === '100000.02', cb);
    const cLoose = await doRun(ops, { ...cashBody, portfolioId: pf1.id, tolerances: { cash: 0.05 } }, 'cashloose');
    check('configurable tolerance: 0.05 accepts the 0.02 difference', cLoose.body.data.matchedCount === 1 && cLoose.body.data.breakCount === 0 && cLoose.body.data.params.tolerances.cash === '0.05', cLoose.body?.data);
    const cashSev: [string, string, number][] = [['99000.00', 'LOW', 1], ['96000.00', 'MEDIUM', 4], ['85000.00', 'HIGH', 15], ['80000.00', 'CRITICAL', 20]];
    for (const [cash, sev, pct] of cashSev) {
      await setPkg({ closingCash: D(cash) });
      await doRun(ops, cashBody, `cashsev${cash}`);
      const b = (await breaksOf(ops, cashRunId)).data[0];
      check(`custodian cash ${cash} vs 100000.00: ${pct}% -> ${sev}`, b?.severity === sev && near(b.differencePct, pct, 0.01) && near(b.difference, Number(cash) - 100000, 0.001), b);
    }
    check('the break is the same record across re-runs', (await prisma.reconBreak.count({ where: { runId: cashRunId } })) === 1);
    check('the CRITICAL cash break queued a notification for sign-off holders', (await prisma.outboxEvent.count({ where: { type: 'notify.permission', payload: { path: '$.type', equals: 'recon.break_critical' } } })) >= 2);

    // ---------------------------------------------------------------- HOLDINGS
    console.log('\nHOLDINGS family');
    const holdBody = { family: 'HOLDINGS', asOfDate: D0 };
    await setPkg({ closingCash: D('100000.00'), holdingsMv: D('12500.00') });
    const h1 = await doRun(ops, holdBody, 'hold1');
    check('custodian value equal to positions at latest prices (12,500.00) matches', h1.body.data.matchedCount === 1 && h1.body.data.breakCount === 0, h1.body?.data);
    const holdRunId = h1.body.data.id as string;
    await setPkg({ holdingsMv: D('12562.50') });
    const h2 = await doRun(ops, holdBody, 'hold2');
    check('tolerance edge: 0.4975% of custodian value is inside 0.5%', h2.body.data.matchedCount === 1 && h2.body.data.breakCount === 0, h2.body?.data);
    await setPkg({ holdingsMv: D('12570.00') });
    await doRun(ops, holdBody, 'hold3');
    const hb = (await breaksOf(ops, holdRunId)).data[0];
    check('12,570 breaks: HOLDINGS_DIFF, LOW (0.5569%), difference 70', hb?.kind === 'HOLDINGS_DIFF' && hb.severity === 'LOW' && near(hb.difference, 70) && near(hb.differencePct, 0.5569, 0.0001) && hb.internalValue.amount === '12500.00', hb);
    await setPkg({ holdingsMv: D('13100.00') });
    await doRun(ops, holdBody, 'hold4');
    check('13,100: 4.58% -> MEDIUM', (await breaksOf(ops, holdRunId)).data[0]?.severity === 'MEDIUM');
    await setPkg({ holdingsMv: D('14000.00') });
    await doRun(ops, holdBody, 'hold5');
    const hb5 = (await breaksOf(ops, holdRunId)).data[0];
    check('14,000: 10.71% -> HIGH', hb5?.severity === 'HIGH' && near(hb5.differencePct, 10.7143, 0.0001), hb5);
    const holdTol = await doRun(ops, { ...holdBody, portfolioId: pf1.id, tolerances: { holdingsPct: 15 } }, 'holdtol');
    check('configurable holdings tolerance (15%) accepts it', holdTol.body.data.matchedCount === 1 && holdTol.body.data.breakCount === 0, holdTol.body?.data);

    // ---------------------------------------------------------------- DAYEND_COUNT
    console.log('\nDAYEND_COUNT family');
    const cntBody = { family: 'DAYEND_COUNT', asOfDate: D0 };
    const n1 = await doRun(ops, cntBody, 'cnt1');
    check('package says 5 trades, 5 executions received (superseded and other dates excluded) -> match', n1.body.data.matchedCount === 1 && n1.body.data.breakCount === 0, n1.body?.data);
    const cntRunId = n1.body.data.id as string;
    await setPkg({ tradeCount: 6 });
    await doRun(ops, cntBody, 'cnt2');
    const nb = (await breaksOf(ops, cntRunId)).data[0];
    check('6 vs 5: COUNT_DIFF, HIGH (16.67%), difference 1', nb?.kind === 'COUNT_DIFF' && nb.severity === 'HIGH' && near(nb.difference, 1) && near(nb.differencePct, 16.6667, 0.0001) && nb.internalValue.executionsReceived === 5, nb);
    await setPkg({ tradeCount: 7 });
    await doRun(ops, cntBody, 'cnt3');
    check('7 vs 5: 28.57% -> CRITICAL', (await breaksOf(ops, cntRunId)).data[0]?.severity === 'CRITICAL');
    await setPkg({ tradeCount: 5 });
    const n4 = await doRun(ops, cntBody, 'cnt4');
    check('count corrected -> the break clears to MATCHED', n4.body.data.breakCount === 0 && (await breaksOf(ops, cntRunId)).data[0]?.status === 'MATCHED');

    // ---------------------------------------------------------------- sources and missing sources
    console.log('\nSources and missing sources');
    await ops.put(`${R}/account-map`, mapBody(cp2, acc2, pf2));
    const src = await ops.get(`${R}/sources?asOf=${D0}`);
    const s1 = src.body?.data?.find((s: any) => s.counterpartyId === cp1.id);
    const s2 = src.body?.data?.find((s: any) => s.counterpartyId === cp2.id);
    const s3 = src.body?.data?.find((s: any) => s.counterpartyId === cp3.id);
    check('sources: CP1 has its day-end and 5 executions for the date', src.status === 200 && s1?.missingSource === false && s1.executionsToday === 5 && s1.lastDayEnd?.statementDate === D0 && s1.accounts[0].dayEnd.tradeCount === 5 && s1.accounts[0].portfolio.ref === pf1.ref, s1);
    check('sources: CP2 (mapped, no day-end) is flagged missing', s2?.missingSource === true && s2.lastDayEnd === null && s2.executionsToday === 0 && s2.accounts[0].mapped === true, s2);
    check('sources: CP3 account is listed as unmapped', s3?.unmappedAccounts?.includes(`ACC3-${run}`) && s3.accounts[0].mapped === false, s3);
    const todaySrc = await ops.get(`${R}/sources`);
    check('sources default to today (CP1 has nothing for today)', todaySrc.body.asOfDate === dayStr(0) && todaySrc.body.data.find((s: any) => s.counterpartyId === cp1.id).executionsToday === 0 && todaySrc.body.data.find((s: any) => s.counterpartyId === cp1.id).missingSource === true);
    await setPkg({ closingCash: D('100000.00') });
    const cAll = await doRun(ops, cashBody, 'cashall');
    check('the all-counterparty CASH run is re-run on the same scope and clears the earlier break', cAll.status === 200 && cAll.body.data.id === cashRunId && (await breaksOf(ops, cashRunId)).data[0]?.status === 'MATCHED', cAll.body?.data);
    check('a mapped account without a day-end is a source gap, not a break: SOURCE_MISSING', cAll.body.data.status === 'SOURCE_MISSING' && cAll.body.data.summary.missingSources.length === 1 && cAll.body.data.summary.missingSources[0].accountRef === acc2 && cAll.body.data.breakCount === 0, cAll.body?.data);
    check('unmapped counterparty accounts are reported on the run', cAll.body.data.summary.unmappedAccounts.some((u: any) => u.accountRef === `ACC3-${run}`));
    await comp.stepUp();
    const soMissing = await comp.post(`${R}/signoffs`, { family: 'CASH', asOfDate: D0 });
    check('sign-off blocked while a scheduled source is missing -> 409 source_missing', soMissing.status === 409 && errCode(soMissing) === 'source_missing' && soMissing.body.error.details.sources[0].accountRef === acc2, soMissing.body);
    await prisma.counterpartyDayEndPackage.create({ data: { ref: `D${run}2`, counterpartyId: cp2.id, accountRef: acc2, statementDate: day(D0), currency: 'USD', closingCash: D('5000.00'), holdingsMv: D('0'), tradeCount: 0, submittedById: opsU.id } });
    const cAll2 = await doRun(ops, cashBody, 'cashall2');
    check('once the package arrives the run is CLEAN (2 matched)', cAll2.body.data.status === 'CLEAN' && cAll2.body.data.matchedCount === 2, cAll2.body?.data);
    // the cash breaks of the CP1-only run are still LOW/closed? re-run it too so everything agrees
    await doRun(ops, { ...cashBody, counterpartyId: cp1.id }, 'cashcp1');
    await doRun(ops, { ...cashBody, portfolioId: pf1.id }, 'cashpf1');
    await comp.stepUp();
    const soCash = await comp.post(`${R}/signoffs`, { family: 'CASH', asOfDate: D0 });
    check('CASH sign-off allowed once every run agrees and the source is in', soCash.status === 201, soCash.body);
    const soCnt = await comp.post(`${R}/signoffs`, { family: 'DAYEND_COUNT', asOfDate: D0, counterpartyId: cp1.id });
    check('a sign-off can be scoped to one counterparty (unique per family/date/counterparty)', soCnt.status === 201 && soCnt.body.data.counterpartyId === cp1.id, soCnt.body);
    const soHold = await comp.post(`${R}/signoffs`, { family: 'HOLDINGS', asOfDate: D0, counterpartyId: cp1.id });
    check('HOLDINGS sign-off is blocked while its High break is open', soHold.status === 409 && errCode(soHold) === 'open_material_breaks', soHold.body);

    // ---------------------------------------------------------------- overview, runs
    console.log('\nOverview and run queries');
    const ov = await ops.get(`${R}/overview?asOf=${D0}`);
    const ovT = ov.body?.data?.families?.find((f: any) => f.family === 'TRADES');
    check('overview: per-family match rate, open breaks and sign-off state', ov.status === 200 && ovT?.matched >= 2 && typeof ovT.matchRate === 'number' && ovT.signedOff === true && ov.body.data.families.length === 4, ov.body?.data);
    check('overview: open breaks by severity and overdue', ov.body.data.openBySeverity && typeof ov.body.data.openTotal === 'number' && typeof ov.body.data.overdue === 'number');
    const runs = await ops.get(`${R}/runs?family=TRADES&asOf=${D0}`);
    check('run list filters by family and date', runs.status === 200 && runs.body.data.every((r: any) => r.family === 'TRADES' && r.asOfDate === D0) && runs.body.total >= 2);
    const oneRun = await ops.get(`${R}/runs/${tradesRunId}`);
    check('run detail includes its breaks and counts', oneRun.body?.data?.ref === t1.body.data.ref && oneRun.body.breaks.length === 4 && oneRun.body.data.openBreaks === 1, oneRun.body?.data);
    check('run detail accepts the RUN reference', (await ops.get(`${R}/runs/${t1.body.data.ref}`)).body?.data?.id === tradesRunId);
    check('unknown run -> 404', (await ops.get(`${R}/runs/RUN-99999`)).status === 404);
    const users = await ops.get(`${R}/users`);
    check('staff list for owner pickers', users.status === 200 && users.body.data.some((u: any) => u.id === fundU.id));

    // ---------------------------------------------------------------- audit
    console.log('\nAudit');
    const actions = async (type: string) => (await prisma.auditEvent.findMany({ where: { objectType: type }, orderBy: { id: 'asc' } }));
    const runAudit = (await actions('recon_run')).filter((e) => e.objectId === tradesRunId);
    check('every run execution is audited with counts', runAudit.length >= 3 && runAudit.every((e) => e.action === 'recon.run_executed') && (runAudit[0]!.after as any).breaks === 4 && (runAudit[0]!.after as any).rerun === false && (runAudit[1]!.after as any).rerun === true, runAudit.map((e) => e.after));
    const brkAudit = (await actions('recon_break')).filter((e) => e.objectId === bE5.id);
    const brkActions = brkAudit.map((e) => e.action);
    check('break actions are audited (assigned, investigating, resolved, rejected, approved)', ['recon.break_assigned', 'recon.break_investigating', 'recon.break_resolved', 'recon.break_rejected', 'recon.break_approved'].every((a) => brkActions.includes(a)), brkActions);
    const apprAudit = brkAudit.find((e) => e.action === 'recon.break_approved' && (e.before as any)?.status === 'PENDING_CHECKER');
    check('approval audit records actor, status change and maker/checker', apprAudit?.actorId === fundU.id && (apprAudit.after as any).status === 'CLOSED' && (apprAudit.after as any).makerId === opsU.id && (apprAudit.after as any).checkerId === fundU.id, apprAudit);
    check('resolve audit keeps the rationale as the reason', brkAudit.find((e) => e.action === 'recon.break_resolved')?.reason?.startsWith('Trade was not booked'));
    const so = await actions('recon_signoff');
    check('sign-offs are audited with the signer', so.length >= 3 && so.every((e) => e.action === 'recon.signoff_recorded') && so.some((e) => e.actorId === compU.id && (e.after as any).family === 'TRADES'));
    check('account mapping is audited', (await prisma.auditEvent.count({ where: { action: 'recon.account_mapped', actorId: opsU.id } })) >= 2);
    check('refused actions wrote no sign-off or approval audit for the maker', (await prisma.auditEvent.count({ where: { actorId: opsU.id, action: { in: ['recon.break_approved', 'recon.signoff_recorded'] } } })) === 0);
    const del = await ops.del(`${R}/account-map/${(await prisma.reconAccountMap.findFirstOrThrow({ where: { counterpartyId: cp2.id } })).id}`);
    check('an account mapping can be removed (audited)', del.status === 200 && (await prisma.auditEvent.count({ where: { action: 'recon.account_unmapped' } })) >= 1);
    check('audit chain still verifies', await chainIntact());
  } finally {
    await cleanup({ userIds, clientIds, portfolioIds, securityIds, counterpartyIds, runIds: [...runIds] });
  }

  console.log(failures ? `\n${failures} check(s) FAILED, ${passes} passed` : `\nAll ${passes} reconciliation checks passed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

async function chainIntact() {
  const { verifyAuditChain } = await import('../src/lib/audit');
  return (await verifyAuditChain()).brokenAt === null;
}

async function cleanup(ids: { userIds: string[]; clientIds: string[]; portfolioIds: string[]; securityIds: string[]; counterpartyIds: string[]; runIds: string[] }) {
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.log(`  (cleanup: ${label} skipped: ${(err as Error).message.split('\n').pop()})`);
    }
  };
  await step('signoffs', () => prisma.reconSignoff.deleteMany({ where: { signedBy: { in: ids.userIds } } }));
  const runs = await prisma.reconRun.findMany({ where: { OR: [{ id: { in: ids.runIds } }, { runBy: { in: ids.userIds } }] }, select: { id: true } });
  await step('breaks', async () => {
    const bs = await prisma.reconBreak.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { id: true } });
    await prisma.reconBreakEvent.deleteMany({ where: { breakId: { in: bs.map((b) => b.id) } } });
    await prisma.reconBreak.deleteMany({ where: { runId: { in: runs.map((r) => r.id) } } });
  });
  await step('runs', () => prisma.reconRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } }));
  await step('account map', () => prisma.reconAccountMap.deleteMany({ where: { counterpartyId: { in: ids.counterpartyIds } } }));
  await step('executions', () => prisma.counterpartyExecution.deleteMany({ where: { counterpartyId: { in: ids.counterpartyIds } } }));
  await step('day-end', () => prisma.counterpartyDayEndPackage.deleteMany({ where: { counterpartyId: { in: ids.counterpartyIds } } }));
  await step('counterparties', () => prisma.counterparty.deleteMany({ where: { id: { in: ids.counterpartyIds } } }));
  await step('orders', () => prisma.order.deleteMany({ where: { portfolioId: { in: ids.portfolioIds } } }));
  await step('portfolios', () => prisma.portfolio.deleteMany({ where: { id: { in: ids.portfolioIds } } }));
  await step('securities', () => prisma.security.deleteMany({ where: { id: { in: ids.securityIds } } }));
  await step('idempotency keys', () => prisma.idempotencyKey.deleteMany({ where: { userId: { in: ids.userIds } } }));
  await step('client links', () => prisma.clientUser.deleteMany({ where: { userId: { in: ids.userIds } } }));
  await step('users', () => prisma.user.deleteMany({ where: { id: { in: ids.userIds } } }));
  await step('clients', () => prisma.client.deleteMany({ where: { id: { in: ids.clientIds } } }));
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
