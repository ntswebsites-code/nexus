/**
 * Corporate Actions checks against a RUNNING API: entitlement maths (cash dividend with withholding tax, split with a
 * fractional share, scrip dividend election and default, rights, merger), date and field validation, the
 * ANNOUNCED -> CONFIRMED -> PROCESSED flow, maker-checker and step-up MFA on processing, election deadline, effects on
 * positions and cash, immutability, cancel, idempotency, audit events and permission refusals.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-corporate-actions.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API
 * against the same DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP enrolment). Creates throwaway users, securities and
 * portfolios with a random run id (best-effort removal at the end); disposable DBs only.
 *
 * Fixture: security S1 held by PA 1,000 (cost 2.00) and PB 500 (cost 3.00) and PC 7 on the record date; security S2 held by PA 1,000 and PB 500.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { applyToPosition, computeEntitlement, dateErrors } from '../src/modules/corporate-actions/ca.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ca-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `ca-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (n: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)).toISOString().slice(0, 10);
};
const day = (n: number) => new Date(`${dayStr(n)}T00:00:00.000Z`);
const A = '/api/v1/corporate-actions';

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
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];
  const mkUser = async (label: string, roleKey: string, portal = 'admin') => {
    const u = await prisma.user.create({ data: { email: `ca-${run}-${label}@example.test`, name: `CA ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, roleKey)).id } });
    return u;
  };
  const dealer = await mkUser('dealer', 'dealer'); // operations.view: creates, confirms, elects
  const ops = await mkUser('ops', 'operations'); // + corporate_actions.process
  const dir = await mkUser('dir', 'investment_director'); // + corporate_actions.process
  const aud = await mkUser('aud', 'auditor'); // read only
  const noView = await mkUser('noview', 'analyst');
  const lp = await mkUser('lp', 'finance', 'investor');
  const cDealer = client('admin');
  const cOps = client('admin');
  const cDir = client('admin');
  const cAud = client('admin');
  const cNo = client('admin');
  const cLp = client('investor');
  const anon = client('admin');

  const mkSec = async (label: string) => {
    const s = await prisma.security.create({ data: { ticker: `CA${label}${run}`.toUpperCase().slice(0, 24), name: `CA Test ${label} ${run}`, market: 'OTC', assetClass: 'Equity', currency: 'USD', status: 'Active' } });
    securityIds.push(s.id);
    return s;
  };
  const s1 = await mkSec('a');
  const s2 = await mkSec('b');
  const s3 = await mkSec('c'); // merger acquirer
  const mkPf = async (label: string) => {
    const p = await prisma.portfolio.create({ data: { ref: `CAP${label}-${run}`.slice(0, 16), name: `CA Test ${label} ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} } });
    portfolioIds.push(p.id);
    await prisma.portfolioCash.create({ data: { portfolioId: p.id, currency: 'USD', available: D('10000'), asOf: day(-10) } });
    return p;
  };
  const pa = await mkPf('A');
  const pb = await mkPf('B');
  const pc = await mkPf('C');
  const hold = (p: { id: string }, s: { id: string }, qty: string, cost: string) => prisma.portfolioPosition.create({ data: { portfolioId: p.id, securityId: s.id, quantity: D(qty), avgCost: D(cost), asOf: day(-10) } });
  await hold(pa, s1, '1000', '2.00');
  await hold(pb, s1, '500', '3.00');
  await hold(pc, s1, '7', '1.00');
  await hold(pa, s2, '1000', '2.00');
  await hold(pb, s2, '500', '2.00');
  await hold(pa, s3, '100', '10.00');

  const posNow = async (p: { id: string }, s: { id: string }) => {
    const r = await prisma.portfolioPosition.findFirst({ where: { portfolioId: p.id, securityId: s.id }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    return r ? { qty: r.quantity.toString(), avg: r.avgCost.toFixed(6) } : null;
  };
  const cashNow = async (p: { id: string }) => (await prisma.portfolioCash.findFirst({ where: { portfolioId: p.id, currency: 'USD' }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] }))?.available.toFixed(2);
  const auditCount = (action: string, objectId?: string, actorId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}), ...(actorId ? { actorId } : {}) } });
  const base = { exDate: dayStr(-5), recordDate: dayStr(-3), payDate: dayStr(-1) };

  try {
    console.log('\nEngine (pure)');
    const div = computeEntitlement({ type: 'CASH_DIVIDEND', rate: D('0.35'), ratioNew: null, ratioOld: null, withholdingPct: D('10') }, D('1000'), null);
    check('dividend 1,000 x 0.35, 10% tax: gross 350, tax 35, net 315', div.gross.toFixed(2) === '350.00' && div.tax.toFixed(2) === '35.00' && div.cash.toFixed(2) === '315.00');
    const odd = computeEntitlement({ type: 'CASH_DIVIDEND', rate: D('0.333333'), ratioNew: null, ratioOld: null, withholdingPct: D('0') }, D('3'), null);
    check('Decimal maths: 3 x 0.333333 = 0.999999 exactly', odd.gross.toFixed(6) === '0.999999');
    const split = computeEntitlement({ type: 'STOCK_SPLIT', rate: null, ratioNew: D(3), ratioOld: D(2), withholdingPct: D(0) }, D(7), null);
    check('3-for-2 split of 7 shares: 10 held, fraction 0.5 not paid', split.sharesDelta.toString() === '3' && split.fraction.toString() === '0.5');
    const rev = computeEntitlement({ type: 'STOCK_SPLIT', rate: null, ratioNew: D(1), ratioOld: D(10), withholdingPct: D(0) }, D(1000), null);
    check('1-for-10 reverse split of 1,000: delta -900', rev.sharesDelta.toString() === '-900');
    const scrip = { type: 'SCRIP_DIVIDEND', rate: D('0.10'), ratioNew: D(1), ratioOld: D(50), withholdingPct: D(0) };
    check('scrip CASH pays the dividend, SCRIP delivers shares and no cash', computeEntitlement(scrip, D(1000), 'CASH').cash.toFixed(2) === '100.00' && computeEntitlement(scrip, D(1000), 'SCRIP').sharesDelta.toString() === '20' && computeEntitlement(scrip, D(1000), 'SCRIP').cash.eq(0));
    const rights = { type: 'RIGHTS_ISSUE', rate: D('1.50'), ratioNew: D(1), ratioOld: D(4), withholdingPct: D(0) };
    const tu = computeEntitlement(rights, D(1000), 'TAKE_UP');
    check('rights take-up of 250 at 1.50 costs 375.00; lapse does nothing', tu.sharesDelta.toString() === '250' && tu.cash.toFixed(2) === '-375.00' && computeEntitlement(rights, D(1000), 'LAPSE').sharesDelta.eq(0));
    const pos = applyToPosition({ type: 'STOCK_SPLIT' }, D(1000), D('2'), computeEntitlement({ type: 'STOCK_SPLIT', rate: null, ratioNew: D(2), ratioOld: D(1), withholdingPct: D(0) }, D(1000), null));
    check('split keeps total cost: 2,000 shares at 1.000000', pos.quantity.toString() === '2000' && pos.avgCost.toFixed(6) === '1.000000');
    check('applyToPosition never goes below zero', applyToPosition({ type: 'MERGER' }, D(50), D(1), computeEntitlement({ type: 'MERGER', rate: D(0), ratioNew: D(1), ratioOld: D(1), withholdingPct: D(0) }, D(100), null)).quantity.eq(0));
    check('date order is checked', dateErrors('CASH_DIVIDEND', { exDate: day(2), recordDate: day(1), payDate: day(0), electionDeadline: null }).length === 2 && dateErrors('SCRIP_DIVIDEND', { exDate: day(0), recordDate: day(1), payDate: day(2), electionDeadline: null }).length === 1);

    console.log('\nSign-in and permissions');
    for (const [c, u] of [[cDealer, dealer], [cOps, ops], [cDir, dir], [cAud, aud], [cNo, noView], [cLp, lp]] as const) {
      check(`${u.email.split('@')[0]!.replace(`ca-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    }
    check('operations user enrols MFA', await cOps.enrolMfa());
    check('director enrols MFA', await cDir.enrolMfa());
    check('GET /events without a session -> 401', (await anon.get(`${A}/events`)).status === 401);
    check('investor -> 403', (await cLp.get(`${A}/events`)).status === 403);
    const denied = await cNo.get(`${A}/events`);
    check('without operations.view -> 403 permission_denied', denied.status === 403 && denied.body?.error?.code === 'permission_denied', denied.body);
    check('auditor can read', (await cAud.get(`${A}/events`)).status === 200 && (await cAud.get(`${A}/upcoming`)).status === 200);

    console.log('\nCreate and validation');
    const div1 = { securityId: s1.id, type: 'CASH_DIVIDEND', ...base, rate: '0.35', withholdingPct: '10' };
    check('create without Idempotency-Key -> 400', (await cDealer.post(`${A}/events`, div1)).status === 400);
    check('auditor cannot create -> 403', (await cAud.post(`${A}/events`, div1, { 'Idempotency-Key': key('x') })).status === 403);
    check('unknown security -> 400', (await cDealer.post(`${A}/events`, { ...div1, securityId: 'NOPE-XYZ' }, { 'Idempotency-Key': key('x') })).status === 400);
    check('record date before ex-date -> 400', (await cDealer.post(`${A}/events`, { ...div1, recordDate: dayStr(-9) }, { 'Idempotency-Key': key('x') })).status === 400);
    check('dividend without a rate -> 400', (await cDealer.post(`${A}/events`, { ...div1, rate: null }, { 'Idempotency-Key': key('x') })).status === 400);
    check('split without a ratio -> 400', (await cDealer.post(`${A}/events`, { securityId: s1.id, type: 'STOCK_SPLIT', ...base }, { 'Idempotency-Key': key('x') })).status === 400);
    check('scrip without an election deadline -> 400', (await cDealer.post(`${A}/events`, { securityId: s2.id, type: 'SCRIP_DIVIDEND', ...base, rate: '0.10', ratioNew: '1', ratioOld: '50' }, { 'Idempotency-Key': key('x') })).status === 400);
    check('merger without an acquirer -> 400', (await cDealer.post(`${A}/events`, { securityId: s1.id, type: 'MERGER', ...base, rate: '0', ratioNew: '1', ratioOld: '1' }, { 'Idempotency-Key': key('x') })).status === 400);
    check('bad type -> 400', (await cDealer.post(`${A}/events`, { ...div1, type: 'WEIRD' }, { 'Idempotency-Key': key('x') })).status === 400);
    const k1 = key('div');
    const c1 = await cDealer.post(`${A}/events`, div1, { 'Idempotency-Key': k1 });
    const E1 = c1.body?.data;
    check('create -> 201 ANNOUNCED CA-##### with the creator recorded', c1.status === 201 && E1?.status === 'ANNOUNCED' && /^CA-\d{5}$/.test(E1.ref) && E1.makerId === dealer.id && E1.withholdingPct === '10', c1.body);
    check('same key replays the same event', (await cDealer.post(`${A}/events`, div1, { 'Idempotency-Key': k1 })).headers.get('idempotent-replayed') === 'true');
    check('same key, different payload -> 409', (await cDealer.post(`${A}/events`, { ...div1, rate: '0.36' }, { 'Idempotency-Key': k1 })).status === 409);
    check('audit corp_action.created by the creator', (await auditCount('corp_action.created', E1.id, dealer.id)) === 1);
    const ed = await cDealer.patch(`${A}/events/${E1.id}`, { description: 'Interim dividend' });
    check('edit while ANNOUNCED', ed.status === 200 && ed.body.data.description === 'Interim dividend', ed.body);
    check('edit with nothing -> 400', (await cDealer.patch(`${A}/events/${E1.id}`, {})).status === 400);
    const up = await cDealer.get(`${A}/upcoming?days=30`);
    check('upcoming list answers (past event is not upcoming)', up.status === 200 && Array.isArray(up.body.data) && !up.body.data.some((e: any) => e.id === E1.id), up.body);
    const lst = await cDealer.get(`${A}/events?securityId=${s1.id}`);
    check('list filters by security and summarises', lst.status === 200 && lst.body.total === 1 && lst.body.summary.awaitingConfirmation === 1, lst.body);

    console.log('\nEntitlements');
    const future = await cDealer.post(`${A}/events`, { securityId: s2.id, type: 'CASH_DIVIDEND', exDate: dayStr(5), recordDate: dayStr(7), payDate: dayStr(9), rate: '0.1' }, { 'Idempotency-Key': key('fut') });
    const calcFuture = await cDealer.post(`${A}/events/${future.body.data.id}/entitlements/calculate`);
    check('calculate before the record date -> 409 record_date_not_reached', calcFuture.status === 409 && calcFuture.body?.error?.code === 'record_date_not_reached', calcFuture.body);
    const up2 = await cDealer.get(`${A}/upcoming?days=30`);
    check('a future event appears in the upcoming list', up2.body.data.some((e: any) => e.id === future.body.data.id));
    const calc = await cDealer.post(`${A}/events/${E1.id}/entitlements/calculate`);
    const ents = calc.body?.data?.entitlements ?? [];
    const ea = ents.find((e: any) => e.portfolioId === pa.id);
    const eb = ents.find((e: any) => e.portfolioId === pb.id);
    check('calculated for the two holders', calc.status === 200 && ents.length === 3, calc.body);
    check('PA: 1,000 shares, gross 350.00, tax 35.00, net 315.00', ea?.quantity === '1000' && ea.grossAmount === '350.00' && ea.taxAmount === '35.00' && ea.cashAmount === '315.00', ea);
    check('PB: 500 shares, net 157.50', eb?.quantity === '500' && eb.cashAmount === '157.50', eb);
    check('totals add up', calc.body.data.totals.netCash === '480.00', calc.body.data.totals);
    check('a later position change after the record date does not change the entitlement', (await prisma.portfolioPosition.create({ data: { portfolioId: pb.id, securityId: s1.id, quantity: D('9999'), avgCost: D('3'), asOf: day(-2) } })) !== null && (await cDealer.post(`${A}/events/${E1.id}/entitlements/calculate`)).body.data.entitlements.find((e: any) => e.portfolioId === pb.id).quantity === '500');
    await prisma.portfolioPosition.deleteMany({ where: { portfolioId: pb.id, securityId: s1.id, asOf: day(-2) } });

    console.log('\nConfirm and process (maker-checker)');
    const conf = await cDealer.post(`${A}/events/${E1.id}/confirm`);
    check('confirm -> CONFIRMED', conf.status === 200 && conf.body.data.status === 'CONFIRMED' && conf.body.data.confirmedBy === dealer.id, conf.body);
    check('edit after confirm -> 409', (await cDealer.patch(`${A}/events/${E1.id}`, { description: 'x' })).status === 409);
    check('a dealer without corporate_actions.process cannot process -> 403', (await cDealer.post(`${A}/events/${E1.id}/process`)).status === 403);
    check('an auditor cannot process -> 403', (await cAud.post(`${A}/events/${E1.id}/process`)).status === 403);
    check('process without step-up -> 401 step_up_required', (await cOps.post(`${A}/events/${E1.id}/process`)).body?.error?.code === 'step_up_required');
    check('step-up succeeds', (await cOps.stepUp()).status === 200);
    const before = { pa: await cashNow(pa), pb: await cashNow(pb) };
    const procKey = key('proc');
    const pr = await cOps.post(`${A}/events/${E1.id}/process`, {}, { 'Idempotency-Key': procKey });
    check('process -> PROCESSED by a different person', pr.status === 200 && pr.body.data.status === 'PROCESSED' && pr.body.data.processedBy === ops.id && pr.body.data.processedBy !== pr.body.data.makerId, pr.body);
    check('entitlements are APPLIED', pr.body.data.entitlements.every((e: any) => e.status === 'APPLIED'), pr.body.data.entitlements);
    check('cash credited: PA +315.00, PB +157.50', before.pa === '10000.00' && (await cashNow(pa)) === '10315.00' && (await cashNow(pb)) === '10157.50', { pa: await cashNow(pa), pb: await cashNow(pb) });
    check('a dividend leaves the positions alone', (await posNow(pa, s1))?.qty === '1000');
    check('the same key replays and applies nothing twice', (await cOps.post(`${A}/events/${E1.id}/process`, {}, { 'Idempotency-Key': procKey })).headers.get('idempotent-replayed') === 'true' && (await cashNow(pa)) === '10315.00');
    await cOps.stepUp();
    const again = await cOps.post(`${A}/events/${E1.id}/process`);
    check('processing again -> 409 event_immutable', again.status === 409 && again.body?.error?.code === 'event_immutable', again.body);
    check('a processed action cannot be cancelled or edited', (await cDealer.post(`${A}/events/${E1.id}/cancel`, { reason: 'Changed my mind' })).status === 409 && (await cDealer.patch(`${A}/events/${E1.id}`, { description: 'y' })).status === 409);
    check('audit corp_action.processed by the processor', (await auditCount('corp_action.processed', E1.id, ops.id)) === 1 && (await auditCount('corp_action.confirmed', E1.id, dealer.id)) === 1);

    console.log('\nSegregation of duties');
    const own = await cDir.post(`${A}/events`, { securityId: s3.id, type: 'STOCK_SPLIT', ...base, ratioNew: '2', ratioOld: '1' }, { 'Idempotency-Key': key('own') });
    const O = own.body.data;
    await cDir.post(`${A}/events/${O.id}/entitlements/calculate`);
    await cDir.post(`${A}/events/${O.id}/confirm`);
    await cDir.stepUp();
    const self = await cDir.post(`${A}/events/${O.id}/process`);
    check('the creator cannot process their own action -> 403 segregation_of_duties', self.status === 403 && self.body?.error?.code === 'segregation_of_duties', self.body);
    check('it is still CONFIRMED and the position is unchanged', (await prisma.corpActionEvent.findUnique({ where: { id: O.id } }))?.status === 'CONFIRMED' && (await posNow(pa, s3))?.qty === '100');
    const detailForDir = await cDir.get(`${A}/events/${O.id}`);
    check('allowed.process is false with a reason for the creator', detailForDir.body.data.allowed.process === false && /different person/.test(detailForDir.body.data.allowed.processBlocker ?? ''), detailForDir.body.data.allowed);
    await cOps.stepUp();
    const byOps = await cOps.post(`${A}/events/${O.id}/process`);
    check('another operator processes it: PA 100 -> 200 shares, cost 5.000000', byOps.status === 200 && (await posNow(pa, s3))?.qty === '200' && (await posNow(pa, s3))?.avg === '5.000000', byOps.body);

    console.log('\nStock split with a fractional share');
    const sp = await cDealer.post(`${A}/events`, { securityId: s1.id, type: 'STOCK_SPLIT', ...base, ratioNew: '3', ratioOld: '2' }, { 'Idempotency-Key': key('split') });
    const S = sp.body.data;
    await cDealer.post(`${A}/events/${S.id}/entitlements/calculate`);
    check('process before confirmation -> 409 invalid_state', (await (async () => { await cOps.stepUp(); return cOps.post(`${A}/events/${S.id}/process`); })()).status === 409);
    await cDealer.post(`${A}/events/${S.id}/confirm`);
    await cOps.stepUp();
    const sprc = await cOps.post(`${A}/events/${S.id}/process`);
    const pcEnt = sprc.body?.data?.entitlements?.find((e: any) => e.portfolioId === pc.id);
    check('PC: 7 -> 10 shares, 0.5 fraction reported', pcEnt?.sharesDelta === '3' && Number(pcEnt?.fraction) === 0.5 && (await posNow(pc, s1))?.qty === '10', pcEnt);
    check('PA: 1,000 -> 1,500, cost kept at 1.333333', (await posNow(pa, s1))?.qty === '1500' && (await posNow(pa, s1))?.avg === '1.333333', await posNow(pa, s1));

    console.log('\nScrip dividend: elections');
    const sc = await cDealer.post(`${A}/events`, { securityId: s2.id, type: 'SCRIP_DIVIDEND', ...base, electionDeadline: dayStr(0), rate: '0.10', ratioNew: '1', ratioOld: '50' }, { 'Idempotency-Key': key('scrip') });
    const C = sc.body.data;
    check('scrip created with CASH as the default option', sc.status === 201 && C.defaultOption === 'CASH' && C.elective === true, sc.body);
    check('election before entitlements -> 404', (await cDealer.put(`${A}/events/${C.id}/elections`, { portfolioId: pa.id, option: 'SCRIP' })).status === 404);
    await cDealer.post(`${A}/events/${C.id}/entitlements/calculate`);
    check('an invalid option -> 400', (await cDealer.put(`${A}/events/${C.id}/elections`, { portfolioId: pa.id, option: 'TAKE_UP' })).status === 400);
    check('an auditor cannot elect -> 403', (await cAud.put(`${A}/events/${C.id}/elections`, { portfolioId: pa.id, option: 'SCRIP' })).status === 403);
    const el = await cDealer.put(`${A}/events/${C.id}/elections`, { portfolioId: pa.id, option: 'SCRIP' });
    const ela = el.body?.data?.entitlements?.find((e: any) => e.portfolioId === pa.id);
    check('PA elects SCRIP: 20 shares and no cash', el.status === 200 && ela?.option === 'SCRIP' && ela.elected === true && ela.sharesDelta === '20' && ela.cashAmount === '0.00', el.body);
    check('PB stays on the default CASH: 50.00', el.body.data.entitlements.find((e: any) => e.portfolioId === pb.id)?.cashAmount === '50.00');
    check('audit corp_action.election_recorded', (await auditCount('corp_action.election_recorded', C.id, dealer.id)) === 1);
    const recalc = await cDealer.post(`${A}/events/${C.id}/entitlements/calculate`);
    check('recalculation keeps the election', recalc.body.data.entitlements.find((e: any) => e.portfolioId === pa.id)?.option === 'SCRIP');
    await cDealer.post(`${A}/events/${C.id}/confirm`);
    await cOps.stepUp();
    const scp = await cOps.post(`${A}/events/${C.id}/process`);
    check('processed: PA 1,000 -> 1,020 shares, PB cash +50.00', scp.status === 200 && (await posNow(pa, s2))?.qty === '1020' && (await cashNow(pb)) === '10207.50', { pa: await posNow(pa, s2), pb: await cashNow(pb), body: scp.body?.error });
    check('PA cost basis includes the forgone dividend: (2,000 + 100) / 1,020', (await posNow(pa, s2))?.avg === '2.058824', await posNow(pa, s2));
    const late = await cDealer.post(`${A}/events`, { securityId: s2.id, type: 'SCRIP_DIVIDEND', ...base, electionDeadline: dayStr(-2), rate: '0.10', ratioNew: '1', ratioOld: '50' }, { 'Idempotency-Key': key('late') });
    await cDealer.post(`${A}/events/${late.body.data.id}/entitlements/calculate`);
    const lateEl = await cDealer.put(`${A}/events/${late.body.data.id}/elections`, { portfolioId: pa.id, option: 'SCRIP' });
    check('election after the deadline -> 409 election_closed', lateEl.status === 409 && lateEl.body?.error?.code === 'election_closed', lateEl.body);
    check('election on a cash dividend -> 409 no_election', (await cDealer.put(`${A}/events/${future.body.data.id}/elections`, { portfolioId: pa.id, option: 'CASH' })).body?.error?.code === 'no_election');

    console.log('\nRights issue and merger');
    const ri = await cDealer.post(`${A}/events`, { securityId: s2.id, type: 'RIGHTS_ISSUE', ...base, electionDeadline: dayStr(0), rate: '1.50', ratioNew: '1', ratioOld: '4' }, { 'Idempotency-Key': key('rights') });
    const R = ri.body.data;
    check('rights default to LAPSE', R.defaultOption === 'LAPSE', R);
    await cDealer.post(`${A}/events/${R.id}/entitlements/calculate`);
    const take = await cDealer.put(`${A}/events/${R.id}/elections`, { portfolioId: pb.id, option: 'TAKE_UP' });
    const tb = take.body?.data?.entitlements?.find((e: any) => e.portfolioId === pb.id);
    check('PB takes up 125 rights at 1.50: cash -187.50', tb?.sharesDelta === '125' && tb.cashAmount === '-187.50', take.body);
    check('PA (no election) lapses: nothing', take.body.data.entitlements.find((e: any) => e.portfolioId === pa.id)?.sharesDelta === '0');
    await cDealer.post(`${A}/events/${R.id}/confirm`);
    await cOps.stepUp();
    await cOps.post(`${A}/events/${R.id}/process`);
    check('rights applied: PB 500 -> 625 shares, cash 10,020.00', (await posNow(pb, s2))?.qty === '625' && (await cashNow(pb)) === '10020.00', { pos: await posNow(pb, s2), cash: await cashNow(pb) });

    const mg = await cDealer.post(`${A}/events`, { securityId: s2.id, type: 'MERGER', ...base, rate: '0.20', ratioNew: '1', ratioOld: '10', targetSecurityId: s3.id }, { 'Idempotency-Key': key('merger') });
    const M = mg.body.data;
    check('merger created with the acquirer', mg.status === 201 && M.targetTicker === s3.ticker, mg.body);
    await cDealer.post(`${A}/events/${M.id}/entitlements/calculate`);
    await cDealer.post(`${A}/events/${M.id}/confirm`);
    await cOps.stepUp();
    const mp = await cOps.post(`${A}/events/${M.id}/process`);
    check('merger takes the record-date 1,000 out of the S2 holding of PA (20 scrip shares remain) and adds 100 S3 shares', mp.status === 200 && (await posNow(pa, s2))?.qty === '20' && (await posNow(pa, s3))?.qty === '300', { s2: await posNow(pa, s2), s3: await posNow(pa, s3), err: mp.body?.error });

    console.log('\nCancel');
    const cx = await cDealer.post(`${A}/events`, { securityId: s2.id, type: 'CASH_DIVIDEND', exDate: dayStr(3), recordDate: dayStr(4), payDate: dayStr(6), rate: '0.05' }, { 'Idempotency-Key': key('cx') });
    check('cancel needs a reason -> 400', (await cDealer.post(`${A}/events/${cx.body.data.id}/cancel`, {})).status === 400);
    const cxd = await cDealer.post(`${A}/events/${cx.body.data.id}/cancel`, { reason: 'Issuer withdrew the dividend' });
    check('cancel -> CANCELLED with the reason', cxd.status === 200 && cxd.body.data.status === 'CANCELLED' && cxd.body.data.cancelReason === 'Issuer withdrew the dividend', cxd.body);
    check('a cancelled action cannot be confirmed -> 409', (await cDealer.post(`${A}/events/${cx.body.data.id}/confirm`)).status === 409);
    check('audit corp_action.cancelled carries the reason', (await prisma.auditEvent.count({ where: { action: 'corp_action.cancelled', objectId: cx.body.data.id, reason: 'Issuer withdrew the dividend' } })) === 1);
    const all = await cAud.get(`${A}/events?limit=100`);
    check('summary counts processed and cancelled', all.body.summary.byStatus.PROCESSED >= 5 && all.body.summary.byStatus.CANCELLED >= 1, all.body.summary);
  } finally {
    try {
      const ev = await prisma.corpActionEvent.findMany({ where: { securityId: { in: securityIds } }, select: { id: true } });
      await prisma.corpActionEntitlement.deleteMany({ where: { eventId: { in: ev.map((e) => e.id) } } });
      await prisma.corpActionEvent.deleteMany({ where: { id: { in: ev.map((e) => e.id) } } });
      await prisma.portfolioPosition.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.portfolioCash.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
      await prisma.security.deleteMany({ where: { id: { in: securityIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    } catch (e) {
      console.log('  (cleanup skipped:', e instanceof Error ? e.message.split('\n').pop() : e, ')');
    }
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
