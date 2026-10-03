/**
 * IBOR & Positions and Performance & Attribution checks against a RUNNING API: pure rules (FIFO lots, settlement
 * dates, available-to-trade, flow-neutral returns, Brinson), then the API: lots from fills, idempotent refresh, drift
 * booked as lineage, unsettled activity and the settlement ladder, the holdings reconciliation hook; returns versus a
 * hand calculation, benchmark and attribution, period preparation, maker-checker lock (step-up MFA, segregation, the
 * five controls), immutability and corrections. Also permissions, idempotency and audit events.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-ibor-performance.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API
 * against the same DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP enrolment). Creates throwaway users, securities
 * and portfolios with a random run id; disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { addBusinessDays, availableToTrade, consumeFifo, ladderBucket, settlementDate } from '../src/modules/ibor/ibor.engine';
import { brinson, buildSeries, dayReturn } from '../src/modules/performance/perf.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ip-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `ip-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const I = '/api/v1/ibor';
const P = '/api/v1/performance';
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const dayDate = (offset: number) => new Date(`${dayStr(offset)}T00:00:00.000Z`);

interface Res {
  status: number;
  body: any;
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
    return { status: res.status, body: parsed };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    put: (p: string, b?: unknown, h?: Record<string, string>) => send('PUT', p, b ?? {}, h),
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

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string, portal = 'admin') => {
    const u = await prisma.user.create({ data: { email: `ip-${run}-${label}@example.test`, name: `IP ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, roleKey)).id } });
    return u;
  };
  const pm = await mkUser('pm', 'portfolio_manager'); // view, manage (refresh), reports.create (maker)
  const fa = await mkUser('fa', 'fund_accountant'); // reports.create, performance.lock, recon.manage (checker)
  const aud = await mkUser('aud', 'auditor'); // reports.view only
  const ops = await mkUser('ops', 'operations'); // portfolio.manage but no reports.view
  const cPm = client('admin');
  const cFa = client('admin');
  const cAud = client('admin');
  const cOps = client('admin');
  const anon = client('admin');

  // Fixtures: one USD security with known prices; a portfolio holding 1,000 and 5,000 cash.
  const tk = `IPT${run.toUpperCase()}`;
  const sec = await prisma.security.create({ data: { ticker: tk, name: `IP Test ${run}`, market: 'VFEX', assetClass: 'Equity', currency: 'USD', sector: `Sec${run}` } });
  const mkPortfolio = (suffix: string, benchmark: string | null) => prisma.portfolio.create({ data: { ref: `IP${suffix}${run}`.slice(0, 16), name: `IP Entity ${suffix} ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', benchmark, mandateJson: {} } });
  const p = await mkPortfolio('A', `BM ${run}`);
  const p2 = await mkPortfolio('B', null);
  for (const [off, price] of [[-6, '10'], [-5, '10'], [-4, '10.5'], [-3, '11']] as const) await prisma.securityPrice.create({ data: { securityId: sec.id, priceDate: dayDate(off), price: D(price), source: 'TEST' } });
  await prisma.portfolioPosition.create({ data: { portfolioId: p.id, securityId: sec.id, quantity: D(1000), avgCost: D(10), asOf: dayDate(-6) } });
  await prisma.portfolioCash.create({ data: { portfolioId: p.id, currency: 'USD', available: D(5000), asOf: dayDate(-6) } });
  const bm = await prisma.perfBenchmark.create({ data: { code: `BM${run}`.toUpperCase(), name: `BM ${run}`, constituents: { create: [{ securityId: sec.id, sector: `Sec${run}`, weightPct: D(100) }] } } });
  const auditCount = (action: string, objectId?: string, actorId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}), ...(actorId ? { actorId } : {}) } });

  try {
    console.log('\nEngine (pure)');
    check('business-day maths skips weekends (Fri + 1 = Mon)', addBusinessDays(new Date('2026-09-04T00:00:00Z'), 1).toISOString().slice(0, 10) === '2026-09-07');
    check('settlement is T+3 on the ZSE', settlementDate(new Date('2026-09-02T10:00:00Z'), 'ZSE').toISOString().slice(0, 10) === '2026-09-07');
    check('ladder buckets: past overdue, same day today, next business day T+1, far later', ladderBucket(new Date('2026-09-01'), new Date('2026-09-02')) === 'OVERDUE' && ladderBucket(new Date('2026-09-02'), new Date('2026-09-02')) === 'TODAY' && ladderBucket(new Date('2026-09-03'), new Date('2026-09-02')) === 'T+1' && ladderBucket(new Date('2026-10-30'), new Date('2026-09-02')) === 'LATER');
    const fifo = consumeFifo([{ id: 'b', remainingQty: D(5), unitCost: D(2), openedOn: new Date('2026-02-01') }, { id: 'a', remainingQty: D(5), unitCost: D(1), openedOn: new Date('2026-01-01') }], D(7));
    check('FIFO draws the oldest lot first and reports no shortfall', fifo.draws[0]!.lotId === 'a' && fifo.draws[0]!.quantity.eq(5) && fifo.draws[1]!.quantity.eq(2) && fifo.shortfall.isZero());
    check('FIFO reports the shortfall when lots cannot cover a sale', consumeFifo([{ id: 'a', remainingQty: D(3), unitCost: D(1), openedOn: new Date() }], D(5)).shortfall.eq(2));
    const att = availableToTrade({ quantity: D(628), unsettledBuys: D(0), unsettledSells: D(80), openSellRemaining: D(0), assetClass: 'Equity' });
    check('available = settled less pending sales (qty 628, unsettled sell 80 -> settled 708, available 628)', att.settled.eq(708) && att.available.eq(628));
    check('private assets are restricted', availableToTrade({ quantity: D(1), unsettledBuys: D(0), unsettledSells: D(0), openSellRemaining: D(0), assetClass: 'Private' }).restricted);
    check('a flow at the start of the day is neutralised (100 + 10 in, value 110 -> 0%)', dayReturn(100, { value: 110, flow: 10 }).r === 0);
    const s = buildSeries(['a', 'b', 'c'], [{ value: 15000, flow: 0 }, { value: 15500, flow: 0 }, { value: 16000, flow: 0 }], null);
    check('geometric chaining: 15,000 -> 16,000 is 6.6667%', Math.abs(s.twr - (16000 / 15000 - 1)) < 1e-12);
    const b = brinson([{ sector: 'X', wp: 0.6, rp: 0.1, wb: 0.5, rb: 0.08 }, { sector: 'Y', wp: 0.4, rp: 0.02, wb: 0.5, rb: 0.04 }], 0.06);
    check('Brinson effects per segment sum to total', b.every((r) => Math.abs(r.allocation + r.selection + r.interaction - r.total) < 1e-12));
    check('no holding: selection and interaction drop out', brinson([{ sector: 'Z', wp: 0, rp: null, wb: 0.2, rb: 0.05 }], 0.04)[0]!.selection === 0);

    console.log('\nSign-in and permissions');
    for (const [c, u] of [[cPm, pm], [cFa, fa], [cAud, aud], [cOps, ops]] as const) check(`${u.email.split('@')[0]!.replace(`ip-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    check('fund accountant enrols MFA', await cFa.enrolMfa());
    check('GET /ibor/overview without a session -> 401', (await anon.get(`${I}/overview`)).status === 401);
    check('GET /performance/summary without a session -> 401', (await anon.get(`${P}/summary`)).status === 401);
    check('without reports.view the performance API is 403', (await cOps.get(`${P}/benchmarks`)).status === 403);
    check('auditor reads the book and performance', (await cAud.get(`${I}/overview?portfolioId=${p.id}`)).status === 200 && (await cAud.get(`${P}/benchmarks`)).status === 200);
    check('auditor cannot refresh the book (portfolio.manage) -> 403', (await cAud.post(`${I}/refresh`, { portfolioId: p.id }, { 'Idempotency-Key': key('r0') })).status === 403);
    check('refresh without Idempotency-Key -> 400', (await cPm.post(`${I}/refresh`, { portfolioId: p.id })).status === 400);

    console.log('\nIBOR: lots from the position record and fills');
    const k1 = key('r1');
    const r1 = await cPm.post(`${I}/refresh`, { portfolioId: p.id }, { 'Idempotency-Key': k1 });
    check('refresh -> 201 with a snapshot ref', r1.status === 201 && /^IBR-\d{4}$/.test(r1.body?.data?.ref), r1.body);
    check('first refresh opens one opening lot', r1.body?.data?.lotsOpened === 1 && r1.body?.data?.adjustments === 0, r1.body);
    check('same key replays the same snapshot', (await cPm.post(`${I}/refresh`, { portfolioId: p.id }, { 'Idempotency-Key': k1 })).body?.data?.id === r1.body?.data?.id);
    const r1b = await cPm.post(`${I}/refresh`, { portfolioId: p.id }, { 'Idempotency-Key': key('r1b') });
    check('a second refresh books nothing new', r1b.body?.data?.lotsOpened === 0 && r1b.body?.data?.eventsIngested === 0, r1b.body);
    check('audit ibor.refreshed by the manager', (await auditCount('ibor.refreshed', r1.body?.data?.id, pm.id)) === 1);
    let lots = (await cPm.get(`${I}/lots?portfolioId=${p.id}`)).body;
    check('one open lot of 1,000 at cost 10', lots.data.length === 1 && lots.data[0].remainingQty === '1000' && lots.data[0].sourceType === 'OPENING', lots);

    // a buy of 200 filled today, then recorded on the position
    const mkOrder = async (side: 'BUY' | 'SELL', qty: number, price: number) => {
      const o = await prisma.order.create({ data: { ref: `T${randomBytes(5).toString('hex')}`.slice(0, 16), portfolioId: p.id, securityId: sec.id, side, quantity: D(qty), orderType: 'MARKET', currency: 'USD', decisionPrice: D(price), status: 'Filled', filledQty: D(qty), avgPrice: D(price), makerId: pm.id } });
      const f = await prisma.orderFill.create({ data: { orderId: o.id, quantity: D(qty), price: D(price), fees: D(0), executedAt: new Date(), recordedBy: pm.id } });
      return { o, f };
    };
    const setPos = (qty: number) => prisma.portfolioPosition.upsert({ where: { portfolioId_securityId_asOf: { portfolioId: p.id, securityId: sec.id, asOf: dayDate(0) } }, create: { portfolioId: p.id, securityId: sec.id, quantity: D(qty), avgCost: D(10.2), asOf: dayDate(0) }, update: { quantity: D(qty) } });
    const buy = await mkOrder('BUY', 200, 12);
    await setPos(1200);
    let ledger = (await cPm.get(`${I}/ledger?portfolioId=${p.id}&q=${tk}`)).body;
    const line = ledger.data[0];
    check('ledger shows unsettled +200 and settled 1,000', line && Number(line.unsettled) === 200 && Number(line.settled) === 1000 && Number(line.quantity) === 1200, line);
    check('the position is in Review until the buy is booked to lots', line.state === 'Review' && line.reasons.some((x: string) => x.includes('Lots differ')), line);
    const lad = (await cPm.get(`${I}/settlement-ladder?portfolioId=${p.id}`)).body.data;
    check('the settlement ladder lists the unsettled buy with negative net cash', lad.items.length === 1 && Number(lad.items[0].netCash) === -2400 && lad.items[0].orderId === buy.o.id, lad);
    const r2 = await cPm.post(`${I}/refresh`, { portfolioId: p.id }, { 'Idempotency-Key': key('r2') });
    check('refresh ingests the fill into a new lot', r2.body?.data?.eventsIngested === 1 && r2.body?.data?.lotsOpened === 1 && r2.body?.data?.adjustments === 0, r2.body);
    await mkOrder('SELL', 300, 13);
    await setPos(900);
    const r3 = await cPm.post(`${I}/refresh`, { portfolioId: p.id }, { 'Idempotency-Key': key('r3') });
    lots = (await cPm.get(`${I}/lots?portfolioId=${p.id}&status=OPEN`)).body;
    check('a sale consumes the oldest lot first (1,000 -> 700, 200 untouched)', r3.status === 201 && lots.data.map((l: any) => Number(l.remainingQty)).sort((a: number, c: number) => a - c).join(',') === '200,700', lots);
    await setPos(950);
    const r4 = await cPm.post(`${I}/refresh`, { portfolioId: p.id }, { 'Idempotency-Key': key('r4') });
    check('quantity changed outside fills is booked as an ADJUSTMENT lot (+50)', r4.body?.data?.adjustments === 1, r4.body);
    const ev = (await cPm.get(`${I}/events?portfolioId=${p.id}&type=ADJUSTMENT`)).body;
    check('lineage lists the adjustment with its reason', ev.total === 1 && ev.data[0].quantityDelta === '50' && JSON.stringify(ev.data[0].detail).includes('corporate action'), ev);
    const health = (await cPm.get(`${I}/health?portfolioId=${p.id}`)).body.data;
    check('book health: lots agree and every fill is ingested', health.items.find((i: any) => i.key === 'lots').ok && health.items.find((i: any) => i.key === 'fills').ok, health);
    const detail = (await cPm.get(`${I}/position?portfolioId=${p.id}&securityId=${sec.id}`)).body.data;
    check('position second layer has lots, events, history and orders', detail.lots.length >= 3 && detail.events.length >= 4 && detail.history.length >= 2 && detail.orders.length === 2, { lots: detail.lots.length, ev: detail.events.length });
    const ov = (await cPm.get(`${I}/overview?portfolioId=${p.id}`)).body.data;
    check('overview KPIs: one position, a market value and a recent refresh', ov.kpis.positions === 1 && Number(ov.kpis.marketValueBase) > 0 && ov.control.lastRefresh?.ref, ov);

    console.log('\nIBOR: reconciliation hook');
    check('recon.manage is required (portfolio manager has none) -> 403', (await cPm.post(`${I}/reconcile`, { portfolioId: p.id }, { 'Idempotency-Key': key('rc0') })).status === 403);
    const rc = await cFa.post(`${I}/reconcile`, { portfolioId: p.id }, { 'Idempotency-Key': key('rc1') });
    check('reconcile runs the HOLDINGS family and returns the run', rc.status === 201 && /^RUN-\d{5}$/.test(rc.body?.data?.run?.ref), rc.body);
    check('the run is recorded in the book lineage', (await prisma.iborEvent.count({ where: { portfolioId: p.id, eventType: 'RECON' } })) === 1);
    check('audit ibor.reconcile_requested', (await auditCount('ibor.reconcile_requested', p.id, fa.id)) === 1);

    console.log('\nPerformance: returns and attribution');
    const q = `portfolioId=${p.id}&from=${dayStr(-5)}&to=${dayStr(-3)}`;
    const ret = (await cPm.get(`${P}/returns?${q}`)).body.data;
    check('TWR over 10 -> 11 on 1,000 shares + 5,000 cash is 6.666667%', ret?.twrPct === '6.666667', ret?.twrPct);
    check('benchmark (100% the same security) is 10.000000% and active -3.333333%', ret.benchmarkPct === '10.000000' && ret.activePct === '-3.333333', { b: ret.benchmarkPct, a: ret.activePct });
    check('series has one point per valuation date', ret.series.length === 3 && ret.series[2].value === 16000, ret.series);
    check('five controls are returned', ret.controls.length === 5 && ret.controls.map((c: any) => c.key).join() === 'ibor,cash,valuation,composite,flows');
    const att2 = (await cPm.get(`${P}/attribution?${q}`)).body.data;
    check('attribution has the sector and cash segments, effects sum to explained', att2.segments.some((x: any) => x.sector === `Sec${run}`) && Math.abs(att2.totals.allocationBps + att2.totals.selectionBps + att2.totals.interactionBps - att2.totals.explainedBps) < 0.02, att2.totals);
    const sumBps = att2.contributions.reduce((a: number, c: any) => a + c.contributionBps, 0);
    check('contribution rows (with residual and compounding) sum to the return in bps', Math.abs(sumBps - 666.67) < 0.05, sumBps);
    check('the security contribution is the weighted daily return (about 656 bps)', Math.abs(att2.contributions.find((c: any) => c.ticker === tk).contributionBps - 655.91) < 0.2, att2.contributions);
    const sum = (await cPm.get(`${P}/summary?from=${dayStr(-5)}&to=${dayStr(-3)}`)).body;
    check('summary lists every portfolio with a return or an explanation', sum.data.some((r: any) => r.portfolioId === p.id && r.twrPct === '6.666667'));

    console.log('\nBenchmarks');
    check('weights must total 100 -> 400', (await cPm.put(`${P}/benchmarks/${bm.id}/constituents`, { constituents: [{ securityId: sec.id, weightPct: '60' }] }, { 'Idempotency-Key': key('b0') })).status === 400);
    check('a duplicate benchmark code -> 409', (await cPm.post(`${P}/benchmarks`, { code: bm.code, name: 'dup' }, { 'Idempotency-Key': key('b1') })).status === 409);
    check('auditor cannot maintain benchmarks -> 403', (await cAud.post(`${P}/benchmarks`, { code: `X${run}`, name: 'x' }, { 'Idempotency-Key': key('b2') })).status === 403);

    console.log('\nPerformance: periods, controls, maker-checker lock');
    const body = { portfolioId: p.id, periodStart: dayStr(-5), periodEnd: dayStr(-3) };
    check('auditor cannot prepare a period -> 403', (await cAud.post(`${P}/periods`, body, { 'Idempotency-Key': key('pp0') })).status === 403);
    const pp = await cPm.post(`${P}/periods`, body, { 'Idempotency-Key': key('pp1') });
    const per = pp.body?.data;
    check('prepare -> 201 DRAFT PRF-#### with the stored return', pp.status === 201 && per.status === 'DRAFT' && /^PRF-\d{4}$/.test(per.ref) && per.twrPct === '6.666667' && per.version === 1, pp.body);
    check('a second prepare for the same period -> 409 period_exists', (await cPm.post(`${P}/periods`, body, { 'Idempotency-Key': key('pp2') })).body?.error?.code === 'period_exists');
    check('audit performance.period_prepared', (await auditCount('performance.period_prepared', per.id, pm.id)) === 1);
    check('all controls are done on the live view and the draft is lockable by someone else', (await cFa.get(`${P}/periods/${per.id}`)).body.data.controlsPending === 0 && (await cFa.get(`${P}/periods/${per.id}`)).body.data.canLock, (await cFa.get(`${P}/periods/${per.id}`)).body);
    check('the preparer without performance.lock cannot lock -> 403', (await cPm.post(`${P}/periods/${per.id}/lock`, {}, { 'Idempotency-Key': key('l0') })).status === 403);
    check('lock without step-up -> 401 step_up_required', (await cFa.post(`${P}/periods/${per.id}/lock`, {}, { 'Idempotency-Key': key('l1') })).body?.error?.code === 'step_up_required');
    await cFa.stepUp();
    const locked = await cFa.post(`${P}/periods/${per.id}/lock`, { note: 'Month end' }, { 'Idempotency-Key': key('l2') });
    check('a different person with step-up locks it -> LOCKED (Official)', locked.status === 200 && locked.body.data.status === 'LOCKED' && locked.body.data.official && locked.body.data.checkerId === fa.id, locked.body);
    check('audit performance.period_locked by the checker', (await auditCount('performance.period_locked', per.id, fa.id)) === 1);
    check('locking again -> 409', (await cFa.post(`${P}/periods/${per.id}/lock`, {}, { 'Idempotency-Key': key('l3') })).status === 409);
    check('a locked period cannot be recomputed -> 409 period_immutable', (await cPm.post(`${P}/periods/${per.id}/recompute`, {}, { 'Idempotency-Key': key('l4') })).body?.error?.code === 'period_immutable');
    check('preparing the same period again points at the correction path', (await cPm.post(`${P}/periods`, body, { 'Idempotency-Key': key('l5') })).body?.error?.message?.includes('correction'));
    check('correction needs a reason -> 400', (await cPm.post(`${P}/periods/${per.id}/correct`, {}, { 'Idempotency-Key': key('c0') })).status === 400);
    const cor = await cPm.post(`${P}/periods/${per.id}/correct`, { reason: 'Late price correction' }, { 'Idempotency-Key': key('c1') });
    check('correction -> new DRAFT version 2 linked to the Official period', cor.status === 201 && cor.body.data.version === 2 && cor.body.data.supersedesId === per.id && cor.body.data.status === 'DRAFT', cor.body);
    check('the Official version is untouched until the correction is locked', (await cFa.get(`${P}/periods/${per.id}`)).body.data.status === 'LOCKED');
    await cFa.stepUp();
    check('locking the correction supersedes the earlier version', (await cFa.post(`${P}/periods/${cor.body.data.id}/lock`, {}, { 'Idempotency-Key': key('c2') })).status === 200 && (await cFa.get(`${P}/periods/${per.id}`)).body.data.status === 'SUPERSEDED');

    // segregation and blocked controls on the portfolio with no benchmark and no history
    const b2 = { portfolioId: p2.id, periodStart: dayStr(-5), periodEnd: dayStr(-3) };
    const own = await cFa.post(`${P}/periods`, b2, { 'Idempotency-Key': key('s1') });
    await cFa.stepUp();
    const selfLock = await cFa.post(`${P}/periods/${own.body?.data?.id}/lock`, {}, { 'Idempotency-Key': key('s2') });
    check('the preparer cannot lock their own period (403 segregation_of_duties)', selfLock.status === 403 && selfLock.body?.error?.code === 'segregation_of_duties', selfLock.body);
    const blocked = await prisma.perfPeriod.create({ data: { ref: `PRF-T${run}`.slice(0, 16), portfolioId: p2.id, periodStart: dayDate(-9), periodEnd: dayDate(-8), makerId: pm.id, baseCurrency: 'USD', startValue: D(0), endValue: D(0), twrPct: D(0), dayCount: 1, series: [], dataHash: 'x' } });
    await cFa.stepUp();
    const nb = await cFa.post(`${P}/periods/${blocked.id}/lock`, {}, { 'Idempotency-Key': key('s3') });
    check('a lock with controls not done -> 409 controls_not_clear naming them', nb.status === 409 && nb.body?.error?.code === 'controls_not_clear' && JSON.stringify(nb.body).includes('composite'), nb.body);
  } finally {
    // best-effort cleanup of throwaway records
    const pids = [p.id, p2.id];
    await prisma.perfPeriod.deleteMany({ where: { portfolioId: { in: pids } } }).catch(() => undefined);
    await prisma.perfBenchmark.deleteMany({ where: { id: bm.id } }).catch(() => undefined);
    await prisma.iborLot.deleteMany({ where: { portfolioId: { in: pids } } }).catch(() => undefined);
    await prisma.iborEvent.deleteMany({ where: { portfolioId: { in: pids } } }).catch(() => undefined);
    await prisma.iborSnapshot.deleteMany({ where: { portfolioId: { in: pids } } }).catch(() => undefined);
    await prisma.orderFill.deleteMany({ where: { order: { portfolioId: { in: pids } } } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { portfolioId: { in: pids } } }).catch(() => undefined);
    await prisma.reconRun.deleteMany({ where: { portfolioId: { in: pids } } }).catch(() => undefined);
    await prisma.portfolio.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    await prisma.security.deleteMany({ where: { id: sec.id } }).catch(() => undefined);
    for (const id of userIds) {
      await prisma.userRole.deleteMany({ where: { userId: id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
