/**
 * Portfolio foundation checks against a RUNNING API: permissions, portal scoping, computed values
 * (market value = sum qty x price x fx, weights sum to 100%), as-of valuation, price upsert, mandate
 * updates, idempotent creates, audit events, lookup guards and seed idempotency.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4160 npx tsx scripts/test-portfolio.ts
 *
 * Run `prisma/seed.ts` first (role catalogue). Seeds the portfolio demo data itself (and re-runs it to check
 * idempotency). Creates throwaway users, securities and portfolios (best-effort removal); disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { seedPortfolio } from '../prisma/seed-portfolio';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Pf-${randomBytes(9).toString('base64url')}`;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (label: string) => `pf-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface Res {
  status: number;
  body: any;
  headers: Headers;
}

function client(portal: 'admin' | 'investor') {
  const origin = portal === 'admin' ? config.portalUrls.admin : config.portalUrls.investor;
  let cookie = '';
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
  };
}

const V1 = '/api/v1';
const sum = (xs: (string | null)[]) => xs.reduce((s, x) => s.add(x ?? 0), D(0));

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const clientIds: string[] = [];
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];

  const mkUser = async (label: string, portal: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `pf-${run}-${label}@example.test`, name: `PF ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, roleKey)).id } });
    return u;
  };

  // ---- seed idempotency (before anything else is created)
  console.log('\nSeed');
  await seedPortfolio();
  const counts = async () =>
    JSON.stringify([
      await prisma.portfolio.count(),
      await prisma.security.count(),
      await prisma.securityPrice.count(),
      await prisma.portfolioPosition.count(),
      await prisma.portfolioCash.count(),
      await prisma.broker.count(),
      await prisma.fxRate.count(),
    ]);
  const before = await counts();
  await seedPortfolio();
  check('seed re-run changes no row counts', before === (await counts()), { before, after: await counts() });
  const bgf = await prisma.portfolio.findFirstOrThrow({ where: { name: 'Balanced Growth Fund' } });
  check('Balanced Growth Fund seeded with a PF- ref and mandate limits', /^PF-\d{4}$/.test(bgf.ref) && (bgf.mandateJson as any)?.maxSingleNamePct === 13, bgf);
  check('13 securities across ZSE, VFEX and OTC', (await prisma.security.count()) >= 13 && (await prisma.security.count({ where: { market: 'VFEX' } })) >= 3);

  const pmU = await mkUser('pm', 'admin', 'portfolio_manager');
  const analystU = await mkUser('analyst', 'admin', 'analyst');
  const svcU = await mkUser('svc', 'admin', 'client_services');
  const lpU = await mkUser('lp', 'investor', 'finance');
  const lpClient = await prisma.client.create({ data: { ref: `X${run}L`, name: `PF LP ${run}`, type: 'Pension fund', portalEnabled: true, kycStatus: 'Current' } });
  clientIds.push(lpClient.id);
  await prisma.clientUser.create({ data: { userId: lpU.id, clientId: lpClient.id, investorRole: 'finance' } });

  const pm = client('admin');
  const analyst = client('admin');
  const svc = client('admin');
  const lp = client('investor');
  const anon = client('admin');

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[pm, pmU], [analyst, analystU], [svc, svcU], [lp, lpU]] as const) {
      check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    }

    // ---------------------------------------------------------------- access
    console.log('\nPermissions and portal scoping');
    for (const path of ['/portfolios', '/securities', '/brokers', '/ibor/positions']) {
      const noAuth = await anon.get(`${V1}${path}`);
      check(`GET ${path} without a session -> 401`, noAuth.status === 401, noAuth.status);
      const lpRes = await lp.get(`${V1}${path}`);
      check(`GET ${path} as an investor (LP) -> 403`, lpRes.status === 403, { s: lpRes.status, b: lpRes.body });
    }
    check('LP cannot read a portfolio by id (IDOR) -> 403', (await lp.get(`${V1}/portfolios/${bgf.id}`)).status === 403);
    check('analyst can list portfolios (portfolio.view)', (await analyst.get(`${V1}/portfolios`)).status === 200);
    check('client services can list portfolios', (await svc.get(`${V1}/portfolios`)).status === 200);
    const denyCreate = await analyst.post(`${V1}/portfolios`, { name: 'Nope', type: 'Fund' }, { 'Idempotency-Key': key('deny') });
    check('analyst cannot create a portfolio -> 403 permission_denied', denyCreate.status === 403 && denyCreate.body?.error?.code === 'permission_denied', denyCreate.body);
    const denyPatch = await svc.patch(`${V1}/portfolios/${bgf.id}`, { benchmark: 'x' });
    check('client services cannot update a portfolio -> 403', denyPatch.status === 403, denyPatch.body);
    const secs = await analyst.get(`${V1}/securities?q=DLTA`);
    const dlta = secs.body?.data?.find((s: any) => s.ticker === 'DLTA.ZW');
    const denyPrice = await analyst.post(`${V1}/securities/${dlta?.id}/prices`, { priceDate: '2026-08-27', price: '32' });
    check('analyst cannot post a price -> 403', denyPrice.status === 403, denyPrice.body);

    // ---------------------------------------------------------------- create
    console.log('\nCreate portfolio (idempotent, audited)');
    const body = {
      name: `PF Test Fund ${run}`,
      type: 'Balanced Fund',
      baseCurrency: 'USD',
      managerUserId: pmU.id,
      benchmark: 'ZSE All Share',
      mandate: { maxSingleNamePct: 10, maxSectorPct: 40, cashFloorPct: 2, maxCashPct: 20 },
    };
    const noKey = await pm.post(`${V1}/portfolios`, body);
    check('create without Idempotency-Key -> 400', noKey.status === 400 && noKey.body?.error?.code === 'idempotency_key_required', noKey.body);
    const k1 = key('create');
    const created = await pm.post(`${V1}/portfolios`, body, { 'Idempotency-Key': k1 });
    const p = created.body?.data?.portfolio;
    if (p?.id) portfolioIds.push(p.id);
    check('create -> 201 with PF ref, mandate and Active status', created.status === 201 && /^PF-\d{4}$/.test(p?.ref ?? '') && p?.status === 'Active' && p?.mandate?.maxSingleNamePct === 10, created.body);
    check('new portfolio is empty: zero value, no positions', created.body?.data?.totals?.totalValueBase === '0.00' && created.body?.data?.lines?.length === 0, created.body?.data?.totals);
    await sleep(400);
    const replay = await pm.post(`${V1}/portfolios`, body, { 'Idempotency-Key': k1 });
    check('same key + same body replays the same portfolio', replay.status === 201 && replay.headers.get('idempotent-replayed') === 'true' && replay.body?.data?.portfolio?.id === p?.id, { s: replay.status, b: replay.body });
    const reused = await pm.post(`${V1}/portfolios`, { ...body, name: `${body.name} other` }, { 'Idempotency-Key': k1 });
    check('same key + different body -> 409 idempotency_key_reused', reused.status === 409 && reused.body?.error?.code === 'idempotency_key_reused', reused.body);
    check('exactly one portfolio was created', (await prisma.portfolio.count({ where: { name: body.name } })) === 1);
    const audCreate = await prisma.auditEvent.findFirst({ where: { action: 'portfolio.created', objectId: p?.id } });
    check('audit event portfolio.created written with the actor', !!audCreate && audCreate.actorId === pmU.id, audCreate);

    const badMandate = await pm.post(`${V1}/portfolios`, { ...body, name: `${body.name} bad`, mandate: { cashFloorPct: 30, maxCashPct: 20 } }, { 'Idempotency-Key': key('bad1') });
    check('cash floor above the cash cap -> 400', badMandate.status === 400, badMandate.body);
    const unknownLimit = await pm.post(`${V1}/portfolios`, { ...body, name: `${body.name} bad2`, mandate: { maxSingleNamePct: 150 } }, { 'Idempotency-Key': key('bad2') });
    check('single-name limit above 100% -> 400', unknownLimit.status === 400, unknownLimit.body);
    const badClient = await pm.post(`${V1}/portfolios`, { ...body, name: `${body.name} bad3`, clientId: '00000000-0000-4000-8000-000000000000' }, { 'Idempotency-Key': key('bad3') });
    check('unknown client -> 400', badClient.status === 400, badClient.body);
    const badMgr = await pm.post(`${V1}/portfolios`, { ...body, name: `${body.name} bad4`, managerUserId: '00000000-0000-4000-8000-000000000000' }, { 'Idempotency-Key': key('bad4') });
    check('unknown manager -> 400', badMgr.status === 400, badMgr.body);

    // ---------------------------------------------------------------- computed values
    console.log('\nComputed values (market value, cash, weights, FX, as-of)');
    const mk = async (suffix: string, market: string, currency: string, sector: string) => {
      const s = await prisma.security.create({
        data: { ticker: `T${run.toUpperCase()}${suffix}`, name: `PF Test ${suffix}`, market, assetClass: 'Equity', currency, boardLot: 1, sector },
      });
      securityIds.push(s.id);
      return s;
    };
    const sA = await mk('A.ZW', 'ZSE', 'ZWG', 'Financials');
    const sB = await mk('B.VX', 'VFEX', 'USD', 'Materials');
    const sC = await mk('C.VX', 'VFEX', 'USD', 'Materials');
    const price = (s: { id: string }, date: string, v: string, source = 'TEST') =>
      prisma.securityPrice.create({ data: { securityId: s.id, priceDate: day(date), price: D(v), source } });
    await price(sA, '2026-08-25', '10.00');
    await price(sA, '2026-08-26', '13.00'); // ZWG
    await price(sA, '2026-09-30', '26.00'); // after the first as-of
    await price(sB, '2026-08-26', '2.50');
    await price(sC, '2026-08-20', '1.00');
    const pos = (s: { id: string }, qty: string, cost: string, asOf: string) =>
      prisma.portfolioPosition.create({ data: { portfolioId: p.id, securityId: s.id, quantity: D(qty), avgCost: D(cost), asOf: day(asOf) } });
    await pos(sA, '130000', '9.00', '2026-08-01');
    await pos(sA, '260000', '9.50', '2026-08-26'); // newer position row replaces the older one
    await pos(sB, '100000', '2.00', '2026-08-26');
    await pos(sC, '50000', '0.80', '2026-08-26');
    await prisma.portfolioCash.create({ data: { portfolioId: p.id, currency: 'USD', available: D('45000'), asOf: day('2026-08-26') } });

    const snapRes = await pm.get(`${V1}/portfolios/${p.ref}?asOf=2026-08-26`);
    const snap = snapRes.body?.data;
    check('snapshot by ref -> 200', snapRes.status === 200 && snap?.portfolio?.id === p.id, snapRes.body);
    const line = (t: string) => snap?.lines?.find((l: any) => l.ticker === t);
    const lA = line(sA.ticker);
    // A: 260,000 x 13.00 = 3,380,000 ZWG at 1/13 = 260,000 USD; B: 100,000 x 2.50 = 250,000; C: 50,000 x 1.00 = 50,000
    check('line market value = quantity x latest price at the as-of date', lA?.marketValue === '3380000.00' && lA?.price === '13.000000' && lA?.priceDate === '2026-08-26', lA);
    check('latest position row wins (260,000 not 130,000)', lA?.quantity === '260000.000000', lA);
    check('ZWG line converted to USD with the FX rate (3.38M ZWG = 260,000 USD)', lA?.marketValueBase === '260000.00', lA);
    check('USD line uses rate 1', line(sB.ticker)?.marketValueBase === '250000.00' && line(sC.ticker)?.marketValueBase === '50000.00', snap?.lines);
    const secBase = sum(snap.lines.map((l: any) => l.marketValueBase));
    check('securities value = sum of line values (560,000)', snap.totals.securitiesValueBase === secBase.toFixed(2) && secBase.eq(560000), snap.totals);
    check('total value = securities + cash (605,000), cash % = 7.4380', snap.totals.totalValueBase === '605000.00' && snap.totals.cashBase === '45000.00' && snap.totals.cashPct === '7.4380', snap.totals);
    const weights = sum([...snap.lines.map((l: any) => l.weightPct), snap.totals.cashPct]);
    check('weights plus cash sum to 100% (within rounding)', weights.sub(100).abs().lte('0.0005'), weights.toString());
    check('largest position is the ZWG name at 42.9752%', snap.concentration.largestPositionTicker === sA.ticker && snap.concentration.largestPositionPct === '42.9752', snap.concentration);
    check('unrealised P&L = market value - cost (260,000 - 190,000)', lA?.costBase === '190000.00' && lA?.unrealisedPnlBase === '70000.00', lA);
    const mats = snap.concentration.bySector.find((b: any) => b.key === 'Materials');
    check('sector breakdown aggregates Materials (300,000 = 49.5868%)', mats?.valueBase === '300000.00' && mats?.weightPct === '49.5868', snap.concentration.bySector);
    check('asset-class breakdown includes Cash', snap.concentration.byAssetClass.some((b: any) => b.key === 'Cash' && b.valueBase === '45000.00'));
    check('stale price noted: no warnings when every line is priced', snap.warnings.length === 0, snap.warnings);

    const early = (await pm.get(`${V1}/portfolios/${p.id}?asOf=2026-08-10`)).body?.data;
    check('as-of before the first price: lines unpriced, listed in warnings, excluded from totals', early?.lines?.length === 1 && early.lines[0].marketValueBase === null && early.warnings.length >= 1 && early.totals.securitiesValueBase === '0.00', early);
    const latest = (await pm.get(`${V1}/portfolios/${p.id}`)).body?.data;
    check('default (today) valuation uses the newest price (26.00)', latest?.lines?.find((l: any) => l.ticker === sA.ticker)?.price === '26.000000', latest?.lines);

    // Base currency with no FX rate: values are withheld, never guessed.
    const eurRes = await pm.post(`${V1}/portfolios`, { name: `PF EUR ${run}`, type: 'Fund', baseCurrency: 'EUR' }, { 'Idempotency-Key': key('eur') });
    const eur = eurRes.body?.data?.portfolio;
    if (eur?.id) {
      portfolioIds.push(eur.id);
      await prisma.portfolioPosition.create({ data: { portfolioId: eur.id, securityId: sB.id, quantity: D('10'), avgCost: D('1'), asOf: day('2026-08-26') } });
      const e = (await pm.get(`${V1}/portfolios/${eur.id}?asOf=2026-08-26`)).body?.data;
      check('no USD/EUR rate: base value null, warning names the pair, totals stay zero', e?.lines?.[0]?.marketValueBase === null && e?.warnings?.some((w: string) => w.includes('USD/EUR')) && e?.totals?.totalValueBase === '0.00', e);
    }

    // ---------------------------------------------------------------- list + filters
    console.log('\nList, filters and positions');
    const list = await pm.get(`${V1}/portfolios?q=${encodeURIComponent(`PF Test Fund ${run}`)}&asOf=2026-08-26`);
    check('search by name finds the portfolio with computed summary', list.body?.data?.length === 1 && list.body.data[0].marketValueBase === '605000.00' && list.body.data[0].cashPct === '7.4380' && list.body.data[0].positionCount === 3, list.body);
    const mine = await pm.get(`${V1}/portfolios?mine=1`);
    check('mine=1 lists only the manager\'s portfolios', mine.body?.data?.length >= 1 && mine.body.data.every((x: any) => x.managerUserId === pmU.id), mine.body?.data?.map((x: any) => x.managerUserId));
    const ccyList = await pm.get(`${V1}/portfolios?currency=ZWG`);
    check('currency filter', ccyList.body?.data?.length >= 2 && ccyList.body.data.every((x: any) => x.baseCurrency === 'ZWG'));
    const badQuery = await pm.get(`${V1}/portfolios?asOf=26-08-2026`);
    check('malformed asOf -> 400', badQuery.status === 400, badQuery.body);
    check('unknown portfolio id -> 404', (await pm.get(`${V1}/portfolios/00000000-0000-4000-8000-000000000000`)).status === 404);
    check('unknown portfolio ref -> 404', (await pm.get(`${V1}/portfolios/PF-9999999`)).status === 404);

    const ibor = await pm.get(`${V1}/ibor/positions?portfolioId=${p.id}&asOf=2026-08-26`);
    check('ibor positions for one portfolio = snapshot lines', ibor.status === 200 && ibor.body?.total === 3 && ibor.body.data.every((r: any) => r.portfolioId === p.id), ibor.body);
    const iborAll = await pm.get(`${V1}/ibor/positions?q=DLTA&limit=5`);
    check('ibor positions across portfolios, searchable by ticker, paged', iborAll.status === 200 && iborAll.body.total >= 3 && iborAll.body.data.length <= 5 && iborAll.body.data.every((r: any) => r.ticker === 'DLTA.ZW'), iborAll.body?.total);

    // ---------------------------------------------------------------- patch + mandate
    console.log('\nUpdate portfolio and mandate limits');
    const patched = await pm.patch(`${V1}/portfolios/${p.id}`, { mandate: { maxSingleNamePct: 12.5, maxSectorPct: null, restrictedTickers: ['ZZZ.ZW'] }, version: p.version });
    const pp = patched.body?.data?.portfolio;
    check('mandate merged: new limit set, null removes a limit, others kept', patched.status === 200 && pp?.mandate?.maxSingleNamePct === 12.5 && pp?.mandate?.maxSectorPct === undefined && pp?.mandate?.cashFloorPct === 2 && pp?.mandate?.restrictedTickers?.[0] === 'ZZZ.ZW', patched.body);
    check('version incremented', pp?.version === p.version + 1, pp);
    const stale = await pm.patch(`${V1}/portfolios/${p.id}`, { benchmark: 'x', version: p.version });
    check('stale version -> 409', stale.status === 409, stale.body);
    const audMandate = await prisma.auditEvent.findFirst({ where: { action: 'portfolio.mandate_updated', objectId: p.id } });
    check('audit event portfolio.mandate_updated with before and after', !!audMandate && (audMandate.before as any)?.mandate?.maxSingleNamePct === 10 && (audMandate.after as any)?.mandate?.maxSingleNamePct === 12.5, audMandate);
    const status = await pm.patch(`${V1}/portfolios/${p.id}`, { status: 'Suspended', benchmark: null });
    check('status and benchmark update', status.body?.data?.portfolio?.status === 'Suspended' && status.body.data.portfolio.benchmark === null, status.body);
    check('suspended portfolio filter', (await pm.get(`${V1}/portfolios?status=Suspended&q=${run}`)).body?.data?.length === 1);

    // ---------------------------------------------------------------- securities + prices
    console.log('\nSecurities and prices');
    check('securities search by name', secs.status === 200 && !!dlta && dlta.latestPrice?.price === '31.940000' && dlta.market === 'ZSE', secs.body);
    check('latest and previous price give the change (-0.01)', dlta?.previousPrice?.price === '31.950000' && dlta?.change === '-0.010000', dlta);
    const vfex = await analyst.get(`${V1}/securities?market=VFEX&limit=50`);
    check('market filter', vfex.body?.data?.length >= 3 && vfex.body.data.every((s: any) => s.market === 'VFEX'));
    const byTicker = await analyst.get(`${V1}/securities/${encodeURIComponent('zim.vx')}`);
    check('security detail by ticker (case-insensitive) with price history', byTicker.status === 200 && byTicker.body?.data?.ticker === 'ZIM.VX' && byTicker.body.data.history.length >= 2, byTicker.body);
    check('unknown security -> 404', (await analyst.get(`${V1}/securities/NOPE.ZW`)).status === 404);

    const newPrice = await pm.post(`${V1}/securities/${sB.id}/prices`, { priceDate: '2026-08-27', price: '2.75', source: 'manual' });
    check('post a price -> 201, latest price updated, source upper-cased', newPrice.status === 201 && newPrice.body?.data?.latestPrice?.price === '2.750000' && newPrice.body.data.latestPrice.source === 'MANUAL' && newPrice.body.data.created === true, newPrice.body);
    const audPrice = await prisma.auditEvent.findFirst({ where: { action: 'security_price.created', objectId: sB.id } });
    check('audit event security_price.created written', !!audPrice && audPrice.actorId === pmU.id, audPrice);
    const same = await pm.post(`${V1}/securities/${sB.id}/prices`, { priceDate: '2026-08-27', price: '2.75', source: 'MANUAL' });
    check('same price again is a no-op (200, changed false)', same.status === 200 && same.body?.data?.changed === false, same.body);
    const corrected = await pm.post(`${V1}/securities/${sB.ticker}/prices`, { priceDate: '2026-08-27', price: 2.8, source: 'MANUAL' });
    check('corrected price for the same date/source updates in place', corrected.status === 200 && corrected.body?.data?.latestPrice?.price === '2.800000', corrected.body);
    check('only one row per security/date/source', (await prisma.securityPrice.count({ where: { securityId: sB.id, priceDate: day('2026-08-27'), source: 'MANUAL' } })) === 1);
    check('audit event security_price.updated carries the old value', !!(await prisma.auditEvent.findFirst({ where: { action: 'security_price.updated', objectId: sB.id } })));
    const hist = await pm.get(`${V1}/securities/${sB.id}/prices?from=2026-08-27`);
    check('price history endpoint honours from', hist.status === 200 && hist.body?.data?.length === 1, hist.body);
    check('zero or negative price -> 400', (await pm.post(`${V1}/securities/${sB.id}/prices`, { priceDate: '2026-08-28', price: '0' })).status === 400 && (await pm.post(`${V1}/securities/${sB.id}/prices`, { priceDate: '2026-08-28', price: '-1' })).status === 400);
    check('future-dated price -> 400', (await pm.post(`${V1}/securities/${sB.id}/prices`, { priceDate: '2099-01-01', price: '3' })).status === 400);
    check('price for an unknown security -> 404', (await pm.post(`${V1}/securities/00000000-0000-4000-8000-000000000000/prices`, { priceDate: '2026-08-28', price: '3' })).status === 404);

    // ---------------------------------------------------------------- brokers
    console.log('\nBrokers');
    const brokers = await analyst.get(`${V1}/brokers`);
    check('three seeded brokers readable by order-capable staff', brokers.status === 200 && brokers.body?.total >= 3 && brokers.body.data.some((b: any) => b.name === 'IH Securities'), brokers.body);
    await prisma.broker.create({ data: { name: `PF Inactive ${run}`, status: 'Inactive' } });
    const act = await analyst.get(`${V1}/brokers?status=all`);
    check('inactive brokers hidden unless the caller can manage', !act.body?.data?.some((b: any) => b.name.startsWith('PF Inactive')));
    const all = await pm.get(`${V1}/brokers?status=all`);
    check('portfolio.manage can list inactive brokers', all.body?.data?.some((b: any) => b.name === `PF Inactive ${run}`));
  } finally {
    await cleanup(userIds, clientIds, portfolioIds, securityIds);
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll portfolio checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

async function cleanup(userIds: string[], clientIds: string[], portfolioIds: string[], securityIds: string[]) {
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.log(`  (cleanup: ${label} skipped: ${(err as Error).message.split('\n').pop()})`);
    }
  };
  const named = { name: { contains: run } };
  await step('portfolios', () => prisma.portfolio.deleteMany({ where: { OR: [{ id: { in: portfolioIds } }, named] } }));
  await step('securities', () => prisma.security.deleteMany({ where: { id: { in: securityIds } } }));
  await step('brokers', () => prisma.broker.deleteMany({ where: named }));
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
