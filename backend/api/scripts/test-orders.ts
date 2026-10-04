/**
 * Orders (OMS) checks against a RUNNING API: lifecycle, segregation of duties, step-up, every pre-trade
 * check outcome, cash and share reservation, fills (positions, cash, average price), over-fill, illegal
 * transitions, idempotency, audit events, outbox, permission and portal refusals.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4190 npx tsx scripts/test-orders.ts
 *
 * Disposable schema only (docs: `nexus_orders_test`): run `prisma migrate deploy` and `prisma/seed.ts` first (role
 * catalogue), then start the API against the same DATABASE_URL. Creates throwaway users, securities, a broker
 * and portfolios under its own run id (best-effort removal at the end).
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Od-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `od-${run}-${label}-${randomBytes(4).toString('hex')}`;
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
    patch: (p: string, b?: unknown, h?: Record<string, string>) => send('PATCH', p, b ?? {}, h),
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

const O = '/api/v1/orders';
const errCode = (r: Res) => r.body?.error?.code;
const errDetails = (r: Res) => r.body?.error?.details;

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const clientIds: string[] = [];
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];
  const orderIds: string[] = [];

  const mkUser = async (label: string, portal: string, ...roleKeys: string[]) => {
    const u = await prisma.user.create({ data: { email: `od-${run}-${label}@example.test`, name: `OD ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    for (const k of roleKeys) await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, k)).id } });
    return u;
  };

  // ---------------------------------------------------------------- fixtures
  const pmU = await mkUser('pm', 'admin', 'portfolio_manager');
  const pm2U = await mkUser('pm2', 'admin', 'portfolio_manager');
  const dirU = await mkUser('dir', 'admin', 'investment_director');
  const dualU = await mkUser('dual', 'admin', 'investment_director', 'dealer'); // holds orders.approve AND orders.route
  const dealerU = await mkUser('dealer', 'admin', 'dealer');
  const compU = await mkUser('comp', 'admin', 'compliance'); // orders.view only
  const analystU = await mkUser('analyst', 'admin', 'analyst'); // no orders permissions
  const lpU = await mkUser('lp', 'investor', 'finance');
  const lpClient = await prisma.client.create({ data: { ref: `X${run}L`, name: `OD LP ${run}`, type: 'Pension fund', portalEnabled: true, kycStatus: 'Current' } });
  clientIds.push(lpClient.id);
  await prisma.clientUser.create({ data: { userId: lpU.id, clientId: lpClient.id, investorRole: 'finance' } });

  const pm = client('admin');
  const pm2 = client('admin');
  const dir = client('admin');
  const dual = client('admin');
  const dealer = client('admin');
  const comp = client('admin');
  const analyst = client('admin');
  const lp = client('investor');
  const anon = client('admin');

  const yesterday = day(dayStr(-1));
  const mkSecurity = async (suffix: string, o: { price: number; boardLot?: number; adv?: number; market?: string; status?: string; assetClass?: string; sector?: string }) => {
    const s = await prisma.security.create({
      data: {
        ticker: `T${run}${suffix}`.toUpperCase(),
        name: `Test ${suffix} ${run}`,
        market: o.market ?? 'ZSE',
        assetClass: o.assetClass ?? 'Equity',
        currency: 'USD',
        boardLot: o.boardLot ?? 1,
        sector: o.sector ?? `Sector-${suffix}`,
        status: o.status ?? 'Active',
        averageDailyVolume: o.adv !== undefined ? D(o.adv) : null,
      },
    });
    securityIds.push(s.id);
    await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: day(dayStr(-2)), price: D(o.price), source: 'TEST' } });
    await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: yesterday, price: D(o.price), source: 'TEST' } });
    return s;
  };
  const secA = await mkSecurity('A', { price: 50 });
  const secB = await mkSecurity('B', { price: 10, boardLot: 100, adv: 100000 });
  const secC = await mkSecurity('C', { price: 1, adv: 100000 });
  const secR = await mkSecurity('R', { price: 5 });
  const secO = await mkSecurity('O', { price: 5, market: 'OTC' });
  const secS = await mkSecurity('S', { price: 5, status: 'Suspended' });
  const broker = await prisma.broker.create({ data: { name: `OD Broker ${run}`, email: `od-broker-${run}@example.test`, status: 'Active' } });
  const brokerNoMail = await prisma.broker.create({ data: { name: `OD NoMail ${run}`, status: 'Active' } });

  /** USD 100,000 cash, 1,000 x A @ 50 (= 50,000): total 150,000; A is 33.33%. */
  const mkPortfolio = async (label: string, mandate: object) => {
    const p = await prisma.portfolio.create({
      data: { ref: `OD-${run}-${label}`, name: `OD Portfolio ${label} ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active', mandateJson: mandate as Prisma.InputJsonValue },
    });
    portfolioIds.push(p.id);
    await prisma.portfolioCash.create({ data: { portfolioId: p.id, currency: 'USD', available: D(100000), asOf: yesterday } });
    await prisma.portfolioPosition.create({ data: { portfolioId: p.id, securityId: secA.id, quantity: D(1000), avgCost: D(45), asOf: yesterday } });
    return p;
  };
  const mandate = { maxSingleNamePct: 40, restrictedTickers: [secR.ticker], allowedMarkets: ['ZSE', 'VFEX'] };
  const pfMain = await mkPortfolio('MAIN', mandate); // lifecycle and fills
  const pfCash = await mkPortfolio('CASH', { ...mandate, maxSingleNamePct: 60 }); // reservation tests (80,000 buys must not trip the name limit)
  const pfSell = await mkPortfolio('SELL', mandate); // share commitment tests
  const pfChk = await mkPortfolio('CHK', mandate); // one-shot check outcomes (nothing is submitted here)

  try {
    console.log('\nSign-in and MFA');
    for (const [c, u] of [[pm, pmU], [pm2, pm2U], [dir, dirU], [dual, dualU], [dealer, dealerU], [comp, compU], [analyst, analystU], [lp, lpU]] as const) {
      check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    }
    for (const [name, c] of [['dir', dir], ['dual', dual], ['dealer', dealer]] as const) check(`${name} enrols TOTP`, await c.enrolMfa());

    const ticket = (over: Record<string, unknown> = {}) => ({
      portfolioId: pfMain.id,
      securityId: secB.id,
      side: 'BUY',
      quantity: 1000,
      orderType: 'MARKET',
      tif: 'DAY',
      urgency: 'Normal',
      brokerId: broker.id,
      ...over,
    });
    const create = async (c: Client, body: object, label = 'c') => {
      const r = await c.post(O, body, { 'Idempotency-Key': key(label) });
      if (r.body?.data?.id) orderIds.push(r.body.data.id);
      return r;
    };
    const submit = (c: Client, id: string, rationale = 'Rebalance towards the target allocation', h: Record<string, string> = {}) =>
      c.post(`${O}/${id}/submit`, { rationale }, { 'Idempotency-Key': key('s'), ...h });
    const approve = async (c: Client, id: string) => {
      await c.stepUp();
      return c.post(`${O}/${id}/approve`, {}, { 'Idempotency-Key': key('a') });
    };
    const route = async (c: Client, id: string, body: object = { brokerId: broker.id }) => {
      await c.stepUp();
      return c.post(`${O}/${id}/route`, body, { 'Idempotency-Key': key('r') });
    };
    const fill = (c: Client, id: string, quantity: number, price: number, extra: object = {}) =>
      c.post(`${O}/${id}/fills`, { quantity, price, ...extra }, { 'Idempotency-Key': key('f') });
    const cancel = (c: Client, id: string, reason = 'No longer required') => c.post(`${O}/${id}/cancel`, { reason });
    const validate = (c: Client, id: string) => c.post(`${O}/${id}/validate`, {});
    const checkOf = (r: Res, k: string) => (r.body?.data?.precheck ?? r.body?.data)?.checks?.find((x: any) => x.key === k);
    const staleMfa = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    /** Creates and validates a ticket; returns the validate response. */
    const makeValidated = async (c: Client, body: object) => {
      const cr = await create(c, body);
      const id = cr.body?.data?.id as string;
      return { cr, id, vr: await validate(c, id) };
    };

    // ---------------------------------------------------------------- access
    console.log('\nPermissions and portal scoping');
    check('GET /orders without a session -> 401', (await anon.get(O)).status === 401);
    check('investor portal user -> 403', (await lp.get(O)).status === 403);
    check('analyst (no orders.view) -> 403', (await analyst.get(O)).status === 403);
    check('compliance (orders.view) can read the blotter', (await comp.get(O)).status === 200);
    const compCreate = await comp.post(O, ticket(), { 'Idempotency-Key': key('x') });
    check('compliance cannot create orders (403 permission_denied)', compCreate.status === 403 && errCode(compCreate) === 'permission_denied', compCreate.body);
    check('investor cannot create orders', (await lp.post(O, ticket(), { 'Idempotency-Key': key('x') })).status === 403);

    // ---------------------------------------------------------------- create
    console.log('\nCreate, idempotency and validation');
    const k1 = key('idem');
    const body1 = ticket();
    const c1 = await pm.post(O, body1, { 'Idempotency-Key': k1 });
    const lifecycleId = c1.body?.data?.id as string;
    orderIds.push(lifecycleId);
    check('create -> 201 Draft with ORD- ref', c1.status === 201 && c1.body?.data?.status === 'Draft' && /^ORD-\d{6}$/.test(c1.body?.data?.ref), c1.body);
    check('decision price is the latest security price', c1.body?.data?.decisionPrice === '10.000000', c1.body?.data);
    check('maker is the creator', c1.body?.data?.maker?.id === pmU.id);
    const c1b = await pm.post(O, body1, { 'Idempotency-Key': k1 });
    check('same Idempotency-Key and payload replays the same order', c1b.status === 201 && c1b.headers.get('idempotent-replayed') === 'true' && c1b.body?.data?.id === lifecycleId, c1b.body);
    const c1c = await pm.post(O, ticket({ quantity: 5 }), { 'Idempotency-Key': k1 });
    check('same key with a different payload -> 409 idempotency_key_reused', c1c.status === 409 && errCode(c1c) === 'idempotency_key_reused', c1c.body);
    const noKey = await pm.post(O, ticket());
    check('create without Idempotency-Key -> 400', noKey.status === 400 && errCode(noKey) === 'idempotency_key_required', noKey.body);
    check('only one order was created for the replayed key', (await prisma.order.count({ where: { portfolioId: pfMain.id } })) === 1);
    const badLimit = await create(pm, ticket({ orderType: 'LIMIT' }));
    check('LIMIT without a price -> 400', badLimit.status === 400, badLimit.body);
    const badQty = await create(pm, ticket({ quantity: 0 }));
    check('zero quantity -> 400', badQty.status === 400);
    const fracQty = await create(pm, ticket({ quantity: '10.5' }));
    check('fractional quantity -> 400', fracQty.status === 400);
    const susp = await create(pm, ticket({ securityId: secS.id }));
    check('suspended security cannot be ordered (409 security_not_tradable)', susp.status === 409 && errCode(susp) === 'security_not_tradable', susp.body);
    const unknownSec = await create(pm, ticket({ securityId: '00000000-0000-0000-0000-000000000000' }));
    check('unknown security -> 404', unknownSec.status === 404);
    const byTicker = await create(pm, ticket({ securityId: secB.ticker.toLowerCase(), quantity: 100 }));
    check('security can be given as a ticker', byTicker.status === 201 && byTicker.body?.data?.security?.id === secB.id, byTicker.body);
    const badBroker = await create(pm, ticket({ brokerId: '00000000-0000-0000-0000-000000000000' }));
    check('unknown broker -> 400', badBroker.status === 400);

    console.log('\nDraft visibility and edits');
    check('maker sees their draft', (await pm.get(`${O}/${lifecycleId}`)).status === 200);
    check("another user does not see someone's draft (404)", (await pm2.get(`${O}/${lifecycleId}`)).status === 404);
    const listPm2 = await pm2.get(`${O}?portfolioId=${pfMain.id}`);
    check("another user's blotter leaves out drafts", listPm2.status === 200 && listPm2.body.total === 0, listPm2.body?.total);
    const stalePatch = await pm.patch(`${O}/${lifecycleId}`, { quantity: 1200 }, { 'If-Match': '"99"' });
    check('edit with a stale If-Match -> 409 version_conflict', stalePatch.status === 409 && errCode(stalePatch) === 'version_conflict', stalePatch.body);
    const okPatch = await pm.patch(`${O}/${lifecycleId}`, { quantity: 1000, urgency: 'High', rationale: 'Draft note' }, { 'If-Match': `"${c1.body.data.version}"` });
    check('edit with the current version works and bumps it', okPatch.status === 200 && okPatch.body?.data?.urgency === 'High' && okPatch.body.data.version === c1.body.data.version + 1, okPatch.body);
    const notMaker = await dir.patch(`${O}/${lifecycleId}`, { urgency: 'Low' });
    check('non-maker cannot edit (404 for a hidden draft)', notMaker.status === 404);

    // ---------------------------------------------------------------- pre-trade outcomes
    console.log('\nPre-trade check outcomes');
    const pre = await pm.post(`${O}/precheck`, { portfolioId: pfChk.id, securityId: secB.id, side: 'BUY', quantity: 1000, orderType: 'MARKET' });
    check('what-if precheck returns checks without creating an order', pre.status === 200 && pre.body?.data?.checks?.length === 6 && pre.body.data.overall === 'Within', pre.body);
    check('precheck estimates notional and fee', pre.body?.data?.notional === '10000.00' && pre.body.data.estimatedFee === '75.00', pre.body?.data);
    const pmPreAnalyst = await analyst.post(`${O}/precheck`, { portfolioId: pfChk.id, securityId: secB.id, side: 'BUY', quantity: 100, orderType: 'MARKET' });
    check('precheck needs orders.create', pmPreAnalyst.status === 403);

    const within = await makeValidated(pm, ticket({ portfolioId: pfChk.id }));
    check('Within -> order Validated', within.vr.status === 200 && within.vr.body?.data?.status === 'Validated' && within.vr.body.data.precheck?.overall === 'Within', within.vr.body);

    const cashFail = await makeValidated(pm, ticket({ portfolioId: pfChk.id, quantity: 20000 }));
    check('cash Fail (notional 200,000 > 100,000) -> Blocked and stays Draft', checkOf(cashFail.vr, 'cash')?.result === 'Fail' && cashFail.vr.body.data.precheck.overall === 'Blocked' && cashFail.vr.body.data.status === 'Draft', cashFail.vr.body);
    const sub0 = await submit(pm, cashFail.id);
    check('Blocked order cannot be submitted (409)', sub0.status === 409 && errCode(sub0) === 'precheck_required', sub0.body);

    const posFail = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secA.id, side: 'SELL', quantity: 1500 }));
    check('position Fail (sell 1,500 of 1,000 held)', checkOf(posFail.vr, 'position')?.result === 'Fail' && posFail.vr.body.data.precheck.overall === 'Blocked', checkOf(posFail.vr, 'position'));
    const posOk = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secA.id, side: 'SELL', quantity: 400 }));
    check('position Pass (sell 400 of 1,000)', checkOf(posOk.vr, 'position')?.result === 'Pass' && posOk.vr.body.data.precheck.overall === 'Within', posOk.vr.body);
    check('cash check is n/a for sells', checkOf(posOk.vr, 'cash')?.result === 'Pass');

    const mandFail = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secA.id, quantity: 500 }));
    check('mandate Fail: post-trade weight 50% > 40% single-name limit', checkOf(mandFail.vr, 'mandate')?.result === 'Fail' && /40%/.test(checkOf(mandFail.vr, 'mandate')?.detail ?? ''), checkOf(mandFail.vr, 'mandate'));
    const mandReview = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secA.id, quantity: 200 }));
    check('mandate Review: weight 40.0% is within 5% of the limit', checkOf(mandReview.vr, 'mandate')?.result === 'Review' && mandReview.vr.body.data.precheck.overall === 'Review' && mandReview.vr.body.data.status === 'Validated', checkOf(mandReview.vr, 'mandate'));
    const restricted = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secR.id, quantity: 10 }));
    check('mandate Fail: restricted ticker', checkOf(restricted.vr, 'mandate')?.result === 'Fail' && /restricted/.test(checkOf(restricted.vr, 'mandate')?.detail ?? ''), checkOf(restricted.vr, 'mandate'));
    const otc = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secO.id, quantity: 10 }));
    check('mandate Fail: market not allowed (OTC)', checkOf(otc.vr, 'mandate')?.result === 'Fail' && /Market OTC/.test(checkOf(otc.vr, 'mandate')?.detail ?? ''), checkOf(otc.vr, 'mandate'));

    // Board-lot multiples are now refused at ticket entry (400); the liquidity check keeps the rule as a second line of defence.
    const lotEntry = await create(pm, ticket({ portfolioId: pfChk.id, quantity: 150 }));
    check('ticket entry: 150 is not a multiple of the board lot 100 -> 400 on quantity', lotEntry.status === 400 && JSON.stringify(lotEntry.body).includes('board lot'), lotEntry.body);
    const lotOrder = await create(pm, ticket({ portfolioId: pfChk.id, quantity: 200 }));
    await prisma.security.update({ where: { id: secB.id }, data: { boardLot: 300 } }); // the lot changes after the ticket was entered
    const lot = { vr: await validate(pm, lotOrder.body?.data?.id as string) };
    await prisma.security.update({ where: { id: secB.id }, data: { boardLot: 100 } });
    check('liquidity Fail: 200 is not a multiple of the (changed) board lot 300', checkOf(lot.vr, 'liquidity')?.result === 'Fail' && /board lot/.test(checkOf(lot.vr, 'liquidity')?.detail ?? ''), checkOf(lot.vr, 'liquidity'));
    const advReview = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secC.id, quantity: 15000 }));
    check('liquidity Review: 15% of average daily volume', checkOf(advReview.vr, 'liquidity')?.result === 'Review' && advReview.vr.body.data.precheck.overall === 'Review', checkOf(advReview.vr, 'liquidity'));
    const advFail = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secC.id, quantity: 30000 }));
    check('liquidity Fail: 30% of average daily volume', checkOf(advFail.vr, 'liquidity')?.result === 'Fail', checkOf(advFail.vr, 'liquidity'));
    const priceFar = await makeValidated(pm, ticket({ portfolioId: pfChk.id, orderType: 'LIMIT', limitPrice: '12.5', quantity: 100 }));
    check('price Review: limit 25% above the last price', checkOf(priceFar.vr, 'price')?.result === 'Review', checkOf(priceFar.vr, 'price'));
    const concentration = checkOf(mandReview.vr, 'concentration');
    check('concentration reports the post-trade weight', concentration && /40\.00%/.test(concentration.detail), concentration);

    const rvShort = await submit(pm, mandReview.id, 'too short');
    check('Review without a documented reason (under 10 chars) -> 400', rvShort.status === 400, rvShort.body);
    const rvOk = await submit(pm, mandReview.id, 'Within 5% of the limit, accepted by the PM for the mandate rebalance');
    check('Review with a documented rationale can be submitted', rvOk.status === 200 && rvOk.body?.data?.status === 'AwaitingApproval', rvOk.body);
    await cancel(pm, mandReview.id, 'cleanup');

    const lowLot = await makeValidated(pm, ticket({ portfolioId: pfChk.id, securityId: secA.id, quantity: 100 }));
    check('validate again on a Validated order keeps it Validated and refreshes the result', (await validate(pm, lowLot.id)).body?.data?.status === 'Validated');

    // ---------------------------------------------------------------- reservation
    console.log('\nCash reservation');
    const x = await makeValidated(pm, ticket({ portfolioId: pfCash.id, quantity: 8000 }));
    check('X validates Within (notional 80,000 + fee 600 <= 100,000)', x.vr.body?.data?.precheck?.overall === 'Within', x.vr.body);
    const xs = await submit(pm, x.id);
    check('submit reserves notional + estimated fee (80,600.00)', xs.status === 200 && xs.body?.data?.reservedAmount === '80600.00' && xs.body.data.status === 'AwaitingApproval', xs.body);
    const y = await makeValidated(pm2, ticket({ portfolioId: pfCash.id, quantity: 3000 }));
    const yCash = checkOf(y.vr, 'cash');
    check('another open buy sees available cash reduced by the reservation', yCash?.result === 'Fail' && yCash.metrics?.reserved === '80600.00' && yCash.metrics?.free === '19400.00', yCash);
    const xc = await cancel(dir, x.id, 'Cancelled by the approver in a test');
    check('approver can cancel; reservation released', xc.status === 200 && xc.body?.data?.status === 'Cancelled' && xc.body.data.reservedAmount === '0.00', xc.body);
    const yAgain = await validate(pm2, y.id);
    check('after the release the other buy is Within again', checkOf(yAgain, 'cash')?.result === 'Pass' && yAgain.body.data.status === 'Validated', checkOf(yAgain, 'cash'));
    const pfAfter = await prisma.portfolioCash.findFirst({ where: { portfolioId: pfCash.id }, orderBy: { asOf: 'desc' } });
    check('cancelling never touched the portfolio cash', pfAfter?.available.eq(100000) === true);

    // The cash a Validated order was checked against can disappear before it is submitted.
    const z1 = await makeValidated(pm, ticket({ portfolioId: pfCash.id, quantity: 8000 }));
    const z2 = await makeValidated(pm2, ticket({ portfolioId: pfCash.id, quantity: 8000 }));
    check('two buys both validate Within while nothing is reserved', z1.vr.body?.data?.precheck?.overall === 'Within' && z2.vr.body?.data?.precheck?.overall === 'Within');
    check('first submit reserves', (await submit(pm, z1.id)).status === 200);
    const z2s = await submit(pm2, z2.id);
    check('second submit is re-checked under the portfolio lock and Blocked (409 precheck_blocked)', z2s.status === 409 && errCode(z2s) === 'precheck_blocked' && errDetails(z2s)?.checks?.[0]?.key === 'cash', z2s.body);
    const z2row = await prisma.order.findUnique({ where: { id: z2.id } });
    check('the blocked order dropped back to Draft with no reservation', z2row?.status === 'Draft' && z2row.reservedAmount.eq(0));
    await cancel(pm, z1.id, 'cleanup');
    await cancel(pm2, z2.id, 'cleanup');

    console.log('\nShare commitment (sells)');
    const s1 = await makeValidated(pm, ticket({ portfolioId: pfSell.id, securityId: secA.id, side: 'SELL', quantity: 700 }));
    check('sell 700 of 1,000 validates', s1.vr.body?.data?.precheck?.overall === 'Within');
    check('sell 700 submitted', (await submit(pm, s1.id)).status === 200);
    const s2 = await makeValidated(pm2, ticket({ portfolioId: pfSell.id, securityId: secA.id, side: 'SELL', quantity: 500 }));
    const s2pos = checkOf(s2.vr, 'position');
    check('a second sell sees only 300 free (700 committed)', s2pos?.result === 'Fail' && s2pos.metrics?.committed === '700' && s2pos.metrics?.free === '300', s2pos);
    check('sells reserve no cash', (await prisma.order.findUnique({ where: { id: s1.id } }))?.reservedAmount.eq(0) === true);
    await cancel(pm, s1.id, 'cleanup');
    await cancel(pm2, s2.id, 'cleanup');

    // ---------------------------------------------------------------- lifecycle
    console.log('\nLifecycle: validate, submit, approve, route, fills');
    await dir.stepUp();
    const approveDraft = await dir.post(`${O}/${lifecycleId}/approve`, {}, { 'Idempotency-Key': key('a') });
    check("an approver cannot reach someone else's Draft (404)", approveDraft.status === 404, approveDraft.body);
    const approveCancelled = await dir.post(`${O}/${z1.id}/approve`, {}, { 'Idempotency-Key': key('a') });
    check('approving a Cancelled order is an illegal transition (409 invalid_transition)', approveCancelled.status === 409 && errCode(approveCancelled) === 'invalid_transition', approveCancelled.body);
    const vNotMaker = await pm2.post(`${O}/${lifecycleId}/validate`, {});
    check("another user cannot validate someone's draft", vNotMaker.status === 404);
    const v1 = await validate(pm, lifecycleId);
    check('validate -> Validated with six check results', v1.status === 200 && v1.body?.data?.status === 'Validated' && v1.body.data.precheck?.checks?.length === 6, v1.body);
    const edited = await pm.patch(`${O}/${lifecycleId}`, { quantity: 1000, urgency: 'Normal' });
    check('a non-material edit keeps the order Validated', edited.body?.data?.status === 'Validated' && edited.body.data.precheck !== null, edited.body?.data?.status);
    const materialEdit = await pm.patch(`${O}/${lifecycleId}`, { quantity: 900 });
    check('a material edit drops it back to Draft and clears the check', materialEdit.body?.data?.status === 'Draft' && materialEdit.body.data.precheck === null, materialEdit.body?.data);
    await pm.patch(`${O}/${lifecycleId}`, { quantity: 1000 });
    const subDraft = await submit(pm, lifecycleId);
    check('submit from Draft requires a fresh check (409 precheck_required)', subDraft.status === 409 && errCode(subDraft) === 'precheck_required', subDraft.body);
    await validate(pm, lifecycleId);
    const nokey = await pm.post(`${O}/${lifecycleId}/submit`, { rationale: 'Rebalance towards target' });
    check('submit without Idempotency-Key -> 400', nokey.status === 400 && errCode(nokey) === 'idempotency_key_required');
    const norat = await pm.post(`${O}/${lifecycleId}/submit`, {}, { 'Idempotency-Key': key('s') });
    check('submit without a rationale -> 400', norat.status === 400);
    const subKey = key('submit');
    const sub = await pm.post(`${O}/${lifecycleId}/submit`, { rationale: 'Rebalance towards the target allocation' }, { 'Idempotency-Key': subKey });
    check('submit -> AwaitingApproval, reserves 10,075.00', sub.status === 200 && sub.body?.data?.status === 'AwaitingApproval' && sub.body.data.reservedAmount === '10075.00', sub.body);
    const subReplay = await pm.post(`${O}/${lifecycleId}/submit`, { rationale: 'Rebalance towards the target allocation' }, { 'Idempotency-Key': subKey });
    check('submit is idempotent: replay returns the same result', subReplay.status === 200 && subReplay.headers.get('idempotent-replayed') === 'true' && subReplay.body?.data?.version === sub.body.data.version, subReplay.body);
    const subAgain = await submit(pm, lifecycleId);
    check('a second submit with a new key is illegal (409 invalid_transition)', subAgain.status === 409 && errCode(subAgain) === 'invalid_transition', subAgain.body);
    const editSubmitted = await pm.patch(`${O}/${lifecycleId}`, { quantity: 1 });
    check('a submitted order cannot be edited (409)', editSubmitted.status === 409 && errCode(editSubmitted) === 'invalid_transition', editSubmitted.body);

    const approvalNotice = await prisma.outboxEvent.findMany({ where: { type: 'notify.permission' }, orderBy: { id: 'desc' }, take: 40 });
    check('submit queued a notification for orders.approve holders', approvalNotice.some((e) => (e.payload as any).permission === 'orders.approve' && (e.payload as any).link === `/ops/orders/${lifecycleId}`));

    console.log('\nSegregation of duties and step-up');
    const makerApprove = await pm.post(`${O}/${lifecycleId}/approve`, {}, { 'Idempotency-Key': key('a') });
    check('a user without orders.approve gets 403 permission_denied', makerApprove.status === 403 && errCode(makerApprove) === 'permission_denied', makerApprove.body);
    const dealerApprove = await dealer.post(`${O}/${lifecycleId}/approve`, {}, { 'Idempotency-Key': key('a') });
    check('a dealer cannot approve (403)', dealerApprove.status === 403);
    // A director who is the maker cannot approve their own order.
    const own = await create(dir, ticket());
    await validate(dir, own.body.data.id);
    await submit(dir, own.body.data.id);
    await dir.stepUp();
    const ownApprove = await dir.post(`${O}/${own.body.data.id}/approve`, {}, { 'Idempotency-Key': key('a') });
    check('maker cannot approve their own order (403 segregation_of_duties)', ownApprove.status === 403 && errCode(ownApprove) === 'segregation_of_duties', ownApprove.body);
    const ownReject = await dir.post(`${O}/${own.body.data.id}/reject`, { reason: 'self reject' });
    check('maker cannot reject their own order either', ownReject.status === 403 && errCode(ownReject) === 'segregation_of_duties', ownReject.body);
    await cancel(dir, own.body.data.id, 'cleanup');

    await staleMfa(dirU.id);
    const stepNeg = await dir.post(`${O}/${lifecycleId}/approve`, {}, { 'Idempotency-Key': key('a') });
    check('approve with stale MFA -> 401 step_up_required', stepNeg.status === 401 && errCode(stepNeg) === 'step_up_required', stepNeg.body);
    const rejectNeg = await dir.post(`${O}/${lifecycleId}/reject`, { reason: 'stale test' });
    check('reject with stale MFA -> 401 step_up_required', rejectNeg.status === 401 && errCode(rejectNeg) === 'step_up_required', rejectNeg.body);
    check('nothing changed without step-up', (await prisma.order.findUnique({ where: { id: lifecycleId } }))?.status === 'AwaitingApproval');
    check('director step-up with TOTP', (await dir.stepUp()).status === 200);
    const noReason = await dir.post(`${O}/${lifecycleId}/reject`, {});
    check('reject needs a reason (400)', noReason.status === 400, noReason.body);
    const ap = await dir.post(`${O}/${lifecycleId}/approve`, {}, { 'Idempotency-Key': key('a') });
    check('approve (different person, fresh step-up) -> Approved', ap.status === 200 && ap.body?.data?.status === 'Approved' && ap.body.data.approver?.id === dirU.id, ap.body);
    const routeNotice = await prisma.outboxEvent.findMany({ where: { type: 'notify.permission' }, orderBy: { id: 'desc' }, take: 40 });
    check('approval queued a notification for orders.route holders', routeNotice.some((e) => (e.payload as any).permission === 'orders.route' && (e.payload as any).link === `/ops/orders/${lifecycleId}`));

    const prevEarly = await dealer.get(`${O}/${lifecycleId}/broker-instruction/preview`);
    check('broker instruction preview (orders.route) shows the stored text', prevEarly.status === 200 && prevEarly.body?.data?.routable === true && prevEarly.body.data.instruction?.to === broker.email && /BUY 1000/.test(prevEarly.body.data.instruction.text), prevEarly.body);
    check('preview needs orders.route (pm -> 403)', (await pm.get(`${O}/${lifecycleId}/broker-instruction/preview`)).status === 403);

    const fillEarly = await fill(dealer, lifecycleId, 100, 10);
    check('a fill on an Approved (not routed) order is illegal (409 invalid_transition)', fillEarly.status === 409 && errCode(fillEarly) === 'invalid_transition', fillEarly.body);
    check('maker without orders.route cannot route (403)', (await pm.post(`${O}/${lifecycleId}/route`, { brokerId: broker.id }, { 'Idempotency-Key': key('r') })).status === 403);
    await dual.stepUp();
    // The dual-role user approved nothing here, so make one: dual approves a fresh order, then cannot route it.
    const dualOrder = await create(pm, ticket({ portfolioId: pfSell.id, quantity: 100 }));
    await validate(pm, dualOrder.body.data.id);
    await submit(pm, dualOrder.body.data.id);
    const dualAp = await approve(dual, dualOrder.body.data.id);
    check('dual-role user approves (maker is someone else)', dualAp.status === 200 && dualAp.body?.data?.status === 'Approved', dualAp.body);
    const dualRoute = await route(dual, dualOrder.body.data.id);
    check('approver cannot route the same order (403 segregation_of_duties, BR-003)', dualRoute.status === 403 && errCode(dualRoute) === 'segregation_of_duties', dualRoute.body);
    check('the order stayed Approved', (await prisma.order.findUnique({ where: { id: dualOrder.body.data.id } }))?.status === 'Approved');
    const dualFromOther = await route(dealer, dualOrder.body.data.id, { brokerId: brokerNoMail.id });
    check('a broker without an email cannot be used (409 broker_unavailable)', dualFromOther.status === 409 && errCode(dualFromOther) === 'broker_unavailable', dualFromOther.body);
    await cancel(pm, dualOrder.body.data.id, 'cleanup');

    await staleMfa(dealerU.id);
    const routeNeg = await dealer.post(`${O}/${lifecycleId}/route`, { brokerId: broker.id }, { 'Idempotency-Key': key('r') });
    check('route with stale MFA -> 401 step_up_required', routeNeg.status === 401 && errCode(routeNeg) === 'step_up_required', routeNeg.body);
    const rt = await route(dealer, lifecycleId);
    check('route (different person from the approver, step-up) -> Routing', rt.status === 200 && rt.body?.data?.status === 'Routing' && rt.body.data.router?.id === dealerU.id && rt.body.data.broker?.id === broker.id, rt.body);
    const instr = await prisma.brokerInstruction.findMany({ where: { orderId: lifecycleId } });
    check('a broker_instruction row was created (EMAIL, QUEUED)', instr.length === 1 && instr[0]!.channel === 'EMAIL' && instr[0]!.deliveryStatus === 'QUEUED' && (instr[0]!.payload as any).to === broker.email, instr);
    const mails = await prisma.outboxEvent.findMany({ where: { type: 'email.send' }, orderBy: { id: 'desc' }, take: 20 });
    check('the instruction email was queued in the outbox', mails.some((e) => (e.payload as any).to === broker.email && /ORD-/.test((e.payload as any).subject)));
    check('detail returns the stored instruction', (await dealer.get(`${O}/${lifecycleId}`)).body?.data?.instruction?.deliveryStatus === 'QUEUED');
    const reRoute = await route(dealer, lifecycleId);
    check('routing twice is illegal (409 invalid_transition)', reRoute.status === 409 && errCode(reRoute) === 'invalid_transition', reRoute.body);

    console.log('\nFills');
    check('fills need orders.route (pm -> 403)', (await fill(pm, lifecycleId, 100, 10)).status === 403);
    const noKeyFill = await dealer.post(`${O}/${lifecycleId}/fills`, { quantity: 100, price: 10 });
    check('a fill without Idempotency-Key -> 400', noKeyFill.status === 400);
    const cashBefore = (await prisma.portfolioCash.findFirst({ where: { portfolioId: pfMain.id, currency: 'USD' }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] }))!.available;
    check('cash before fills is 100,000', cashBefore.eq(100000));
    const f1 = await fill(dealer, lifecycleId, 400, 10.1, { fees: 10, source: 'CONTRACT_NOTE', sourceRef: 'CN-1001' });
    check('partial fill -> PartiallyFilled, qty 400, avg 10.10', f1.status === 201 && f1.body?.data?.status === 'PartiallyFilled' && f1.body.data.filledQty === '400' && f1.body.data.avgPrice === '10.100000', f1.body);
    check('the reservation shrinks to the remaining 600 x 10.075', f1.body?.data?.reservedAmount === '6045.00', f1.body?.data?.reservedAmount);
    const overfill = await fill(dealer, lifecycleId, 700, 10.2);
    check('over-fill is rejected (409 overfill) and records nothing', overfill.status === 409 && errCode(overfill) === 'overfill' && (await prisma.orderFill.count({ where: { orderId: lifecycleId } })) === 1, overfill.body);
    const f1replayKey = key('f-replay');
    const f2body = { quantity: 600, price: 10.2, fees: 15 };
    const f2 = await dealer.post(`${O}/${lifecycleId}/fills`, f2body, { 'Idempotency-Key': f1replayKey });
    const f2r = await dealer.post(`${O}/${lifecycleId}/fills`, f2body, { 'Idempotency-Key': f1replayKey });
    check('final fill -> Filled, avg price 10.16', f2.status === 201 && f2.body?.data?.status === 'Filled' && f2.body.data.avgPrice === '10.160000' && f2.body.data.remainingQty === '0', f2.body);
    check('a replayed fill (same key) records nothing twice', f2r.headers.get('idempotent-replayed') === 'true' && (await prisma.orderFill.count({ where: { orderId: lifecycleId } })) === 2);
    check('reservation fully released at Filled', f2.body?.data?.reservedAmount === '0.00');
    check('slippage (BUY) = (10.16 - 10) / 10 x 10,000 = 160 bp', f2.body?.data?.slippageBp === 160, f2.body?.data?.slippageBp);
    const posB = await prisma.portfolioPosition.findFirst({ where: { portfolioId: pfMain.id, securityId: secB.id }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    check('position upserted: 1,000 x B at avg cost 10.16', posB?.quantity.eq(1000) === true && posB.avgCost.eq('10.16'), posB);
    const cashAfter = (await prisma.portfolioCash.findFirst({ where: { portfolioId: pfMain.id, currency: 'USD' }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] }))!.available;
    check('cash reduced by notional and fees: 100,000 - 10,160 - 25 = 89,815', cashAfter.eq(89815), cashAfter.toString());
    const posA = await prisma.portfolioPosition.findFirst({ where: { portfolioId: pfMain.id, securityId: secA.id }, orderBy: [{ asOf: 'desc' }] });
    check('other positions untouched; history rows never edited', posA?.quantity.eq(1000) === true && (await prisma.portfolioCash.count({ where: { portfolioId: pfMain.id } })) === 2);
    const snap = await pm.get(`/api/v1/portfolios/${pfMain.id}`);
    check('the portfolio snapshot reflects the fill (B line, cash 89,815)', snap.status === 200 && snap.body?.data?.lines?.some((l: any) => l.ticker === secB.ticker && l.quantity === '1000.000000') && snap.body.data.cash?.[0]?.available === '89815.00', snap.body?.data?.cash);
    const fillsAfter = await fill(dealer, lifecycleId, 1, 10);
    check('no more fills once Filled (409 invalid_transition)', fillsAfter.status === 409 && errCode(fillsAfter) === 'invalid_transition', fillsAfter.body);
    const cancelFilled = await cancel(dir, lifecycleId);
    check('a Filled order cannot be cancelled (409 invalid_transition)', cancelFilled.status === 409 && errCode(cancelFilled) === 'invalid_transition', cancelFilled.body);
    const detail = await dir.get(`${O}/${lifecycleId}`);
    check('detail lists both fills with source and fees', detail.body?.data?.fills?.length === 2 && detail.body.data.fills[0].source === 'CONTRACT_NOTE' && detail.body.data.fills[0].sourceRef === 'CN-1001' && detail.body.data.fills[0].fees === '10.00', detail.body?.data?.fills);

    console.log('\nSells, limits and partial cancel');
    const sellOrder = await create(pm, ticket({ portfolioId: pfMain.id, securityId: secA.id, side: 'SELL', quantity: 400, orderType: 'LIMIT', limitPrice: '50' }));
    const sid = sellOrder.body.data.id as string;
    await validate(pm, sid);
    await submit(pm, sid);
    await approve(dir, sid);
    await route(dealer, sid);
    const lim = await fill(dealer, sid, 100, 49);
    check('a sell fill below the limit is refused (409 limit_breach)', lim.status === 409 && errCode(lim) === 'limit_breach', lim.body);
    const sf = await fill(dealer, sid, 150, 51);
    check('sell fill -> PartiallyFilled; slippage on a sell is signed by side (decision 50, got 51 = -200 bp)', sf.status === 201 && sf.body?.data?.status === 'PartiallyFilled' && sf.body.data.slippageBp === -200, sf.body?.data);
    const posA2 = await prisma.portfolioPosition.findFirst({ where: { portfolioId: pfMain.id, securityId: secA.id }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    check('sell reduced the position to 850 and kept the cost basis', posA2?.quantity.eq(850) === true && posA2.avgCost.eq(45), posA2);
    const cashAfterSell = (await prisma.portfolioCash.findFirst({ where: { portfolioId: pfMain.id, currency: 'USD' }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] }))!.available;
    check('sell proceeds credited to cash (89,815 + 7,650)', cashAfterSell.eq(97465), cashAfterSell.toString());
    const noCancelReason = await pm.post(`${O}/${sid}/cancel`, {});
    check('cancel needs a reason (400)', noCancelReason.status === 400);
    const outsider = await pm2.post(`${O}/${sid}/cancel`, { reason: 'not mine' });
    check('a user who is neither creator nor approver cannot cancel (403)', outsider.status === 403, outsider.body);
    const pc = await cancel(pm, sid, 'Remaining shares no longer wanted');
    check('creator can cancel a partially filled order; fills stay', pc.status === 200 && pc.body?.data?.status === 'Cancelled' && pc.body.data.filledQty === '150' && pc.body.data.cancelReason === 'Remaining shares no longer wanted', pc.body?.data);

    console.log('\nReject');
    const rj = await create(pm, ticket({ portfolioId: pfCash.id, quantity: 1000 }));
    await validate(pm, rj.body.data.id);
    await submit(pm, rj.body.data.id);
    await dir.stepUp();
    const rjr = await dir.post(`${O}/${rj.body.data.id}/reject`, { reason: 'Outside the investment committee guidance' });
    check('reject -> Rejected with the reason; reservation released', rjr.status === 200 && rjr.body?.data?.status === 'Rejected' && rjr.body.data.rejectReason === 'Outside the investment committee guidance' && rjr.body.data.reservedAmount === '0.00', rjr.body);
    const rjAgain = await cancel(pm, rj.body.data.id);
    check('a Rejected order cannot be cancelled or revived (409 invalid_transition)', rjAgain.status === 409 && errCode(rjAgain) === 'invalid_transition');

    // ---------------------------------------------------------------- blotter
    console.log('\nBlotter');
    const list = await dir.get(`${O}?portfolioId=${pfMain.id}&limit=2`);
    check('list paginates and returns a total', list.status === 200 && list.body.data.length === 2 && list.body.total >= 3 && list.body.limit === 2, list.body?.total);
    const filled = await dir.get(`${O}?status=Filled&portfolioId=${pfMain.id}`);
    check('status filter returns only Filled orders', filled.body?.data?.length === 1 && filled.body.data[0].id === lifecycleId, filled.body?.data?.length);
    check('KPI summary: filled count and slippage', filled.body?.summary?.filled === 1 && typeof filled.body.summary.slippageBp === 'number', filled.body?.summary);
    const bySec = await dir.get(`${O}?securityId=${secA.ticker}`);
    check('security filter accepts a ticker', bySec.status === 200 && bySec.body.data.every((o: any) => o.security.id === secA.id) && bySec.body.total >= 1, bySec.body?.total);
    const byDate = await dir.get(`${O}?portfolioId=${pfMain.id}&from=${dayStr(1)}`);
    check('date filter excludes orders created before it', byDate.status === 200 && byDate.body.total === 0, byDate.body?.total);
    const waiting = await dir.get(`${O}?status=AwaitingApproval`);
    check('awaiting-approval filter works and the KPI counts it', waiting.status === 200 && waiting.body.summary.awaitingApproval === waiting.body.total);
    check('working group expands to Approved, Routing and PartiallyFilled', (await dir.get(`${O}?status=Working`)).status === 200);

    // ---------------------------------------------------------------- audit
    console.log('\nAudit and timeline');
    const events = await prisma.auditEvent.findMany({ where: { objectType: 'order', objectId: lifecycleId }, orderBy: { id: 'asc' } });
    const actions = events.map((e) => e.action);
    const expected = ['order.created', 'order.updated', 'order.validated', 'order.submitted', 'order.approved', 'order.routed', 'order.fill_recorded'];
    check('every lifecycle step wrote an audit event', expected.every((a) => actions.includes(a)) && actions.filter((a) => a === 'order.fill_recorded').length === 2, actions);
    check('audit events carry the actor and status change', events.find((e) => e.action === 'order.approved')?.actorId === dirU.id && (events.find((e) => e.action === 'order.approved')?.after as any)?.status === 'Approved');
    check('the submit audit event keeps the rationale as the reason', events.find((e) => e.action === 'order.submitted')?.reason === 'Rebalance towards the target allocation');
    const fillAudit = events.filter((e) => e.action === 'order.fill_recorded').at(-1)!;
    check('the fill audit event records position and cash after', (fillAudit.after as any)?.positionAfter === '1000' && (fillAudit.after as any)?.cashAfter === '89815');
    check('cancel and reject are audited', (await prisma.auditEvent.count({ where: { action: { in: ['order.cancelled', 'order.rejected'] }, objectId: { in: orderIds } } })) >= 2);
    const tl = detail.body?.data?.timeline as any[];
    check('detail timeline lists the steps with actor names', tl?.length >= 7 && tl.some((t) => t.action === 'order.approved' && t.actor === 'OD dir' && t.to === 'Approved'), tl?.map((t) => t.action));
    const allowedDir = (await dir.get(`${O}/${lifecycleId}`)).body?.data?.allowed;
    check('allowed actions on a Filled order are empty', Array.isArray(allowedDir) && allowedDir.length === 0, allowedDir);
    const probe = await create(pm, ticket({ portfolioId: pfCash.id, quantity: 100 }));
    await validate(pm, probe.body.data.id);
    await submit(pm, probe.body.data.id);
    const aDir = (await dir.get(`${O}/${probe.body.data.id}`)).body?.data?.allowed;
    const aPm = (await pm.get(`${O}/${probe.body.data.id}`)).body?.data?.allowed;
    check('allowed actions: approver gets approve/reject/cancel, maker only cancel', aDir?.includes('approve') && aDir.includes('reject') && !aDir.includes('route') && aPm?.length === 1 && aPm[0] === 'cancel', { aDir, aPm });
    await cancel(pm, probe.body.data.id, 'cleanup');
    check('audit chain still verifies', await chainIntact());
  } finally {
    await cleanup(userIds, clientIds, portfolioIds, securityIds);
  }

  console.log(failures ? `\n${failures} check(s) FAILED, ${passes} passed` : `\nAll ${passes} orders checks passed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

async function chainIntact() {
  const { verifyAuditChain } = await import('../src/lib/audit');
  return (await verifyAuditChain()).brokenAt === null;
}

async function cleanup(userIds: string[], clientIds: string[], portfolioIds: string[], securityIds: string[]) {
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.log(`  (cleanup: ${label} skipped: ${(err as Error).message.split('\n').pop()})`);
    }
  };
  await step('orders', () => prisma.order.deleteMany({ where: { portfolioId: { in: portfolioIds } } }));
  await step('portfolios', () => prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } }));
  await step('securities', () => prisma.security.deleteMany({ where: { id: { in: securityIds } } }));
  await step('brokers', () => prisma.broker.deleteMany({ where: { name: { contains: run } } }));
  await step('idempotency keys', () => prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } }));
  await step('client links', () => prisma.clientUser.deleteMany({ where: { userId: { in: userIds } } }));
  await step('users', () => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
  await step('clients', () => prisma.client.deleteMany({ where: { id: { in: clientIds } } }));
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
