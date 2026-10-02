/**
 * Risk & Compliance checks against a RUNNING API: limit lifecycle with segregation of duties and step-up MFA,
 * each metric against known book values, the monitor (one breach and one case per day, idempotent), the
 * hypothetical pre-trade check, scenario maths against hand-computed expectations and status thresholds,
 * cases, permission refusals and audit events.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4170 npx tsx scripts/test-risk.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first (for example
 * `nexus_risk_test`) and start the API against the same DATABASE_URL. Creates throwaway users, securities,
 * portfolios and risk records with a random run id (best-effort removal at the end); disposable DBs only.
 *
 * Fixture books (all valued in USD unless stated; hand-computed in the comments next to each check):
 *   A  A1 40,000 (Tech), B1 10,000 (Tech), C1 10,000 (Mining), D1 10,000 (Banks), E1 10,000 (Banks), F1 5,000 (Mining), cash 15,000
 *      -> NAV 100,000; single name 40, sector 50 (Tech), top-5 80, cash 15
 *   B  T-bill 30,000, equity 20,000, ZWG equity ZWG 13,000 (= USD 1,000), cash 49,000 -> NAV 100,000
 *   C  S1 50,000, S2 40,000, cash 10,000 (one limit that puts it in the 10% warning band)
 *   D  base ZWG: cash USD 1,000 (= ZWG 13,000) and ZWG 7,000
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { seedRisk } from '../prisma/seed-risk';
import { checkLimitsForPortfolio } from '../src/modules/risk/risk.service';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Rk-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `rk-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = () => new Date().toISOString().slice(0, 10);
const V1 = '/api/v1';
const R = `${V1}/risk`;

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

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const clientIds: string[] = [];
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];
  const limitIds: string[] = [];
  const scenarioNames: string[] = [];

  // ---- presets (before any user exists, so seedRisk adds only the three scenarios)
  console.log('\nSeed');
  await seedRisk();
  const presetCount = async () => prisma.riskScenario.count({ where: { preset: { not: null } } });
  const pc = await presetCount();
  await seedRisk();
  check('seedRisk is idempotent and creates the three presets', pc === 3 && (await presetCount()) === 3, pc);

  const mkUser = async (label: string, portal: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `rk-${run}-${label}@example.test`, name: `RK ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, roleKey)).id } });
    return u;
  };
  const makerU = await mkUser('maker', 'admin', 'compliance');
  const checkerU = await mkUser('checker', 'admin', 'compliance');
  const analystU = await mkUser('analyst', 'admin', 'analyst');
  const lpU = await mkUser('lp', 'investor', 'finance');
  const lpClient = await prisma.client.create({ data: { ref: `X${run}L`, name: `RK LP ${run}`, type: 'Pension fund', portalEnabled: true, kycStatus: 'Current' } });
  clientIds.push(lpClient.id);
  await prisma.clientUser.create({ data: { userId: lpU.id, clientId: lpClient.id, investorRole: 'finance' } });

  const maker = client('admin');
  const checker = client('admin');
  const analyst = client('admin');
  const lp = client('investor');
  const anon = client('admin');

  // ---- fixtures
  const mkSec = async (label: string, sector: string, price: string, opts: { currency?: string; assetClass?: string } = {}) => {
    const s = await prisma.security.create({
      data: { ticker: `RK${label}-${run}`.toUpperCase(), name: `RK ${label} ${run}`, market: 'VFEX', assetClass: opts.assetClass ?? 'Equity', currency: opts.currency ?? 'USD', sector: `${sector}-${run}` },
    });
    securityIds.push(s.id);
    await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: day('2026-08-26'), price: D(price), source: 'RISKTEST' } });
    return s;
  };
  const mkPortfolio = async (label: string, base: string, positions: [{ id: string }, string][], cash: [string, string][]) => {
    const p = await prisma.portfolio.create({ data: { ref: `RKP-${run}-${label}`, name: `RK Fund ${label} ${run}`, type: 'Test Fund', baseCurrency: base, status: 'Active', mandateJson: {} } });
    portfolioIds.push(p.id);
    for (const [s, qty] of positions) await prisma.portfolioPosition.create({ data: { portfolioId: p.id, securityId: s.id, quantity: D(qty), avgCost: D(1), asOf: day('2026-08-26') } });
    for (const [ccy, amt] of cash) await prisma.portfolioCash.create({ data: { portfolioId: p.id, currency: ccy, available: D(amt), asOf: day('2026-08-26') } });
    return p;
  };
  // FX needed for ZWG (same values as prisma/seed-portfolio.ts); never overwrites an existing rate
  for (const [from, to, rate] of [['USD', 'ZWG', '13'], ['ZWG', 'USD', '0.0769230769']] as const) {
    await prisma.fxRate.upsert({
      where: { fromCurrency_toCurrency_rateDate: { fromCurrency: from, toCurrency: to, rateDate: day('2026-08-26') } },
      update: {},
      create: { fromCurrency: from, toCurrency: to, rateDate: day('2026-08-26'), rate: D(rate), source: 'RISKTEST' },
    });
  }
  const sA1 = await mkSec('A1', 'Tech', '10');
  const sB1 = await mkSec('B1', 'Tech', '5');
  const sC1 = await mkSec('C1', 'Mining', '2');
  const sD1 = await mkSec('D1', 'Banks', '4');
  const sE1 = await mkSec('E1', 'Banks', '10');
  const sF1 = await mkSec('F1', 'Mining', '1');
  const sTb = await mkSec('TB', 'Government', '1', { assetClass: 'Fixed income' });
  const sEq = await mkSec('EQ', 'Tech', '10');
  const sZw = await mkSec('ZW', 'Banks', '13', { currency: 'ZWG' });
  const sS1 = await mkSec('S1', 'Tech', '10');
  const sS2 = await mkSec('S2', 'Mining', '10');
  const sNew = await mkSec('NEW', 'Energy', '1');
  const pA = await mkPortfolio('A', 'USD', [[sA1, '4000'], [sB1, '2000'], [sC1, '5000'], [sD1, '2500'], [sE1, '1000'], [sF1, '5000']], [['USD', '15000']]);
  const pB = await mkPortfolio('B', 'USD', [[sTb, '30000'], [sEq, '2000'], [sZw, '1000']], [['USD', '49000']]);
  const pC = await mkPortfolio('C', 'USD', [[sS1, '5000'], [sS2, '4000']], [['USD', '10000']]);
  const pD = await mkPortfolio('D', 'ZWG', [], [['USD', '1000'], ['ZWG', '7000']]);

  const num = (s: any) => Number(s);
  const near = (a: any, b: number, eps = 0.0001) => Math.abs(num(a) - b) < eps;
  const auditCount = (action: string, objectId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}) } });

  /** Create + submit + (as the other user, with step-up) approve a limit. Returns the active limit view. */
  async function activate(body: Record<string, unknown>, who: Client = maker, approver: Client = checker) {
    const c = await who.post(`${R}/limits`, body, { 'Idempotency-Key': key('lim') });
    if (c.status !== 201) return { err: c };
    limitIds.push(c.body.data.id);
    const s = await who.post(`${R}/limits/${c.body.data.id}/submit`);
    const su = await approver.stepUp();
    const a = await approver.post(`${R}/limits/${c.body.data.id}/approve`);
    return { limit: a.body?.data, c, s, su, a };
  }

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[maker, makerU], [checker, checkerU], [analyst, analystU], [lp, lpU]] as const) {
      check(`${u.email.split('@')[0]!.replace(`rk-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    }
    check('maker enrols MFA', await maker.enrolMfa());
    check('checker enrols MFA', await checker.enrolMfa());

    // ---------------------------------------------------------------- permissions
    console.log('\nPermissions and portal scoping');
    for (const p of ['limits', 'breaches', 'scenarios', 'runs', 'cases']) {
      check(`GET /risk/${p} without a session -> 401`, (await anon.get(`${R}/${p}`)).status === 401);
      const r = await lp.get(`${R}/${p}`);
      check(`GET /risk/${p} as an investor -> 403`, r.status === 403, r.status);
      check(`GET /risk/${p} as an analyst (risk.view) -> 200`, (await analyst.get(`${R}/${p}`)).status === 200);
    }
    const staffList = await analyst.get(`${R}/users`);
    check('GET /risk/users lists active staff (id and name only) for pickers; investors get 403', staffList.status === 200 && staffList.body?.data?.some((u: any) => u.id === makerU.id && u.name === 'RK maker' && !('passwordHash' in u)) && (await lp.get(`${R}/users`)).status === 403, staffList.body);
    const denyLimit =await analyst.post(`${R}/limits`, { metric: 'SINGLE_NAME_PCT', scopeType: 'PORTFOLIO', scopeId: pA.id, threshold: 35 }, { 'Idempotency-Key': key('deny') });
    check('analyst cannot create a limit -> 403 permission_denied', denyLimit.status === 403 && denyLimit.body?.error?.code === 'permission_denied', denyLimit.body);
    check('analyst cannot run the monitor -> 403', (await analyst.post(`${R}/monitor`, {})).status === 403);
    check('analyst cannot create a case -> 403', (await analyst.post(`${R}/cases`, { description: 'x y z' }, { 'Idempotency-Key': key('dc') })).status === 403);
    check('analyst cannot create a scenario -> 403', (await analyst.post(`${R}/scenarios`, { name: `deny ${run}`, shocks: {} }, { 'Idempotency-Key': key('ds') })).status === 403);
    check('analyst can use the read-only check endpoint', (await analyst.post(`${R}/check`, { portfolioId: pA.id })).status === 200);

    // ---------------------------------------------------------------- limit lifecycle
    console.log('\nLimit lifecycle (maker-checker, step-up)');
    const body1 = { metric: 'SINGLE_NAME_PCT', scopeType: 'PORTFOLIO', scopeId: pA.id, threshold: 35, breachAction: 'ALERT', description: `RK single name ${run}` };
    check('create without Idempotency-Key -> 400', (await maker.post(`${R}/limits`, body1)).status === 400);
    check('invalid metric -> 400', (await maker.post(`${R}/limits`, { ...body1, metric: 'BOGUS' }, { 'Idempotency-Key': key('bad') })).status === 400);
    check('threshold above 100 -> 400', (await maker.post(`${R}/limits`, { ...body1, threshold: 120 }, { 'Idempotency-Key': key('bad') })).status === 400);
    check('portfolio scope without a portfolio -> 400', (await maker.post(`${R}/limits`, { ...body1, scopeId: undefined }, { 'Idempotency-Key': key('bad') })).status === 400);
    check('unknown portfolio -> 400', (await maker.post(`${R}/limits`, { ...body1, scopeId: '00000000-0000-4000-8000-000000000000' }, { 'Idempotency-Key': key('bad') })).status === 400);
    const k1 = key('create');
    const c1 = await maker.post(`${R}/limits`, body1, { 'Idempotency-Key': k1 });
    const L1 = c1.body?.data;
    if (L1?.id) limitIds.push(L1.id);
    check('create -> 201 DRAFT with a LIM- ref, maker and owner = creator', c1.status === 201 && L1?.status === 'DRAFT' && /^LIM-\d{4}$/.test(L1.ref) && L1.makerId === makerU.id && L1.ownerUserId === makerU.id && L1.threshold === '35.0000', c1.body);
    const replay = await maker.post(`${R}/limits`, body1, { 'Idempotency-Key': k1 });
    check('same Idempotency-Key replays the same limit', replay.headers.get('idempotent-replayed') === 'true' && replay.body?.data?.id === L1?.id, replay.body);
    check('same key with a different payload -> 409', (await maker.post(`${R}/limits`, { ...body1, threshold: 36 }, { 'Idempotency-Key': k1 })).status === 409);
    check('audit risk.limit_created written by the maker', (await prisma.auditEvent.count({ where: { action: 'risk.limit_created', objectId: L1.id, actorId: makerU.id } })) === 1);

    const edit = await maker.patch(`${R}/limits/${L1.id}`, { threshold: 36, version: L1.version });
    check('edit in DRAFT works (threshold 36, version bumped)', edit.status === 200 && edit.body?.data?.threshold === '36.0000' && edit.body.data.version === L1.version + 1, edit.body);
    const staleEdit = await maker.patch(`${R}/limits/${L1.id}`, { threshold: 37, version: L1.version });
    check('edit with a stale version -> 409 version_conflict', staleEdit.status === 409 && staleEdit.body?.error?.code === 'version_conflict', staleEdit.body);
    await maker.patch(`${R}/limits/${L1.id}`, { threshold: 35 });
    check('approve while DRAFT -> 409 invalid_state', (await checker.post(`${R}/limits/${L1.id}/approve`)).body?.error?.code === 'invalid_state');
    const sub = await maker.post(`${R}/limits/${L1.id}/submit`);
    check('submit -> PENDING_APPROVAL', sub.status === 200 && sub.body?.data?.status === 'PENDING_APPROVAL', sub.body);
    const lateEdit = await maker.patch(`${R}/limits/${L1.id}`, { threshold: 30 });
    check('edit after submit -> 409 limit_not_editable', lateEdit.status === 409 && lateEdit.body?.error?.code === 'limit_not_editable', lateEdit.body);
    check('delete after submit -> 409', (await maker.del(`${R}/limits/${L1.id}`)).status === 409);

    // maker cannot approve their own limit (BR-001), even with a fresh step-up
    await maker.stepUp();
    const selfApprove = await maker.post(`${R}/limits/${L1.id}/approve`);
    check('maker approving own limit -> 403 sod_violation', selfApprove.status === 403 && selfApprove.body?.error?.code === 'sod_violation', selfApprove.body);
    check('analyst (no risk.manage) approving -> 403', (await analyst.post(`${R}/limits/${L1.id}/approve`)).status === 403);
    // stale MFA for the checker
    await prisma.session.updateMany({ where: { userId: checkerU.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    const noStep = await checker.post(`${R}/limits/${L1.id}/approve`);
    check('approve with stale MFA -> 401 step_up_required', noStep.status === 401 && noStep.body?.error?.code === 'step_up_required', noStep.body);
    check('limit still PENDING_APPROVAL after the refusals', (await prisma.riskLimit.findUniqueOrThrow({ where: { id: L1.id } })).status === 'PENDING_APPROVAL');
    check('checker step-up succeeds', (await checker.stepUp()).status === 200);
    const appr = await checker.post(`${R}/limits/${L1.id}/approve`);
    check('different user with step-up approves -> ACTIVE with checker and approvedAt', appr.status === 200 && appr.body?.data?.status === 'ACTIVE' && appr.body.data.checkerId === checkerU.id && !!appr.body.data.approvedAt, appr.body);
    check('audit risk.limit_submitted and risk.limit_approved (actor = checker)', (await auditCount('risk.limit_submitted', L1.id)) === 1 && (await prisma.auditEvent.count({ where: { action: 'risk.limit_approved', objectId: L1.id, actorId: checkerU.id } })) === 1);
    check('re-approve an ACTIVE limit -> 409 invalid_state', (await checker.post(`${R}/limits/${L1.id}/approve`)).status === 409);

    // duplicate active limit for the same metric and scope
    const dup = await maker.post(`${R}/limits`, { ...body1, threshold: 30 }, { 'Idempotency-Key': key('dup') });
    if (dup.body?.data?.id) limitIds.push(dup.body.data.id);
    await maker.post(`${R}/limits/${dup.body.data.id}/submit`);
    await checker.stepUp();
    const dupAppr = await checker.post(`${R}/limits/${dup.body.data.id}/approve`);
    check('second ACTIVE limit for the same metric and scope -> 409 limit_exists', dupAppr.status === 409 && dupAppr.body?.error?.code === 'limit_exists', dupAppr.body);
    const rej = await checker.post(`${R}/limits/${dup.body.data.id}/reject`, { reason: 'duplicate of ' + L1.ref });
    check('reject returns a pending limit to DRAFT', rej.status === 200 && rej.body?.data?.status === 'DRAFT', rej.body);
    check('reject needs a reason -> 400', (await checker.post(`${R}/limits/${dup.body.data.id}/reject`, {})).status === 400);
    check('delete a DRAFT limit -> 200 and gone', (await maker.del(`${R}/limits/${dup.body.data.id}`)).status === 200 && (await prisma.riskLimit.count({ where: { id: dup.body.data.id } })) === 0);

    // ---------------------------------------------------------------- metrics on known values
    console.log('\nMetrics against known book values (book A: 40 / 50 / 80 / 15)');
    const L2 = (await activate({ metric: 'CASH_FLOOR_PCT', scopeType: 'PORTFOLIO', scopeId: pA.id, threshold: 10, breachAction: 'BLOCK', description: `RK cash floor ${run}` })).limit;
    const L3 = (await activate({ metric: 'SECTOR_PCT', scopeType: 'PORTFOLIO', scopeId: pA.id, threshold: 55, breachAction: 'ESCALATE', description: `RK sector ${run}` })).limit;
    const L4 = (await activate({ metric: 'TOP5_PCT', scopeType: 'PORTFOLIO', scopeId: pA.id, threshold: 90, breachAction: 'ALERT', description: `RK top5 ${run}` })).limit;
    check('three more limits activated through the full maker-checker flow', [L2, L3, L4].every((l) => l?.status === 'ACTIVE'), [L2?.status, L3?.status, L4?.status]);
    const snapA = (await prisma.portfolio.findUniqueOrThrow({ where: { id: pA.id } })).id;
    const now = await checkLimitsForPortfolio(snapA);
    const ev = (r: typeof now, ref: string) => r.evaluations.find((e) => e.ref === ref)!;
    check('SINGLE_NAME_PCT = 40.0000 (A1 40,000 / 100,000), limit 35 -> BREACH', ev(now, L1.ref).value === '40.0000' && ev(now, L1.ref).state === 'BREACH', ev(now, L1.ref));
    check('SINGLE_NAME_PCT names the driving ticker', (ev(now, L1.ref).detail as any).ticker === sA1.ticker);
    check('SECTOR_PCT = 50.0000 (Tech 40,000 + 10,000), limit 55 -> WARNING (inside the 10% band)', ev(now, L3.ref).value === '50.0000' && ev(now, L3.ref).state === 'WARNING', ev(now, L3.ref));
    check('SECTOR_PCT names the sector', (ev(now, L3.ref).detail as any).sector === `Tech-${run}`);
    check('CASH_FLOOR_PCT = 15.0000, floor 10 -> OK', ev(now, L2.ref).value === '15.0000' && ev(now, L2.ref).state === 'OK', ev(now, L2.ref));
    check('TOP5_PCT = 80.0000 (40+10+10+10+10), limit 90 -> OK', ev(now, L4.ref).value === '80.0000' && ev(now, L4.ref).state === 'OK', ev(now, L4.ref));
    check('breaches/warnings lists and blocked=false without a hypothetical', now.breaches.length === 1 && now.warnings.length === 1 && now.blocked === false && now.hypothetical === null, now);
    const viaApi = await analyst.post(`${R}/check`, { portfolioId: pA.id });
    check('POST /risk/check returns the same evaluations', viaApi.status === 200 && viaApi.body?.data?.evaluations?.length === 4 && viaApi.body.data.breaches.length === 1, viaApi.body);

    // ---------------------------------------------------------------- hypothetical
    console.log('\nHypothetical post-trade check');
    // BUY 1,000 A1 at the latest price 10 = 10,000: A1 50,000 (50%), cash 5,000 (5%), Tech 60,000 (60%), top-5 90%
    const hyp = await checkLimitsForPortfolio(snapA, { ticker: sA1.ticker, side: 'BUY', quantity: 1000 });
    check('applied trade value is 10,000.00 at the latest price', hyp.hypothetical?.valueBase === '10000.00' && hyp.hypothetical.price === '10', hyp.hypothetical);
    check('single name 40 -> 50 (still breach, worsened)', ev(hyp, L1.ref).value === '50.0000' && ev(hyp, L1.ref).valueBefore === '40.0000' && ev(hyp, L1.ref).worsened === true);
    check('cash 15 -> 5: floor 10 newly BREACH', ev(hyp, L2.ref).value === '5.0000' && ev(hyp, L2.ref).stateBefore === 'OK' && ev(hyp, L2.ref).state === 'BREACH' && ev(hyp, L2.ref).worsened === true, ev(hyp, L2.ref));
    check('sector 50 -> 60 BREACH; top-5 80 -> 90 WARNING (equal to the limit is not a breach)', ev(hyp, L3.ref).value === '60.0000' && ev(hyp, L3.ref).state === 'BREACH' && ev(hyp, L4.ref).value === '90.0000' && ev(hyp, L4.ref).state === 'WARNING', [ev(hyp, L3.ref), ev(hyp, L4.ref)]);
    check('blocked = true because the BLOCK cash-floor limit is newly breached', hyp.blocked === true && hyp.breaches.length === 3);
    const viaApiHyp = await analyst.post(`${R}/check`, { portfolioId: pA.id, hypothetical: { ticker: sA1.ticker, side: 'BUY', quantity: 1000, price: 10 } });
    check('POST /risk/check with a hypothetical agrees', viaApiHyp.status === 200 && viaApiHyp.body?.data?.blocked === true && viaApiHyp.body.data.cashBase === '5000.00', viaApiHyp.body);
    // SELL 1,000 A1: A1 30%, cash 25%
    const sell = await checkLimitsForPortfolio(snapA, { ticker: sA1.ticker, side: 'SELL', quantity: 1000 });
    check('SELL 1,000 A1: single name 30 (OK), cash 25, not blocked', ev(sell, L1.ref).value === '30.0000' && ev(sell, L1.ref).state === 'OK' && ev(sell, L2.ref).value === '25.0000' && sell.blocked === false, sell.evaluations);
    // a security the book does not hold: BUY 10,000 NEW at 1 -> cash 5%
    const fresh = await checkLimitsForPortfolio(snapA, { ticker: sNew.ticker, side: 'BUY', quantity: 10000 });
    check('BUY of an unheld security adds it to the book (cash 15 -> 5)', fresh.hypothetical?.valueBase === '10000.00' && ev(fresh, L2.ref).value === '5.0000', fresh.hypothetical);
    check('hypothetical records nothing (no breach rows)', (await prisma.riskBreach.count({ where: { portfolioId: pA.id } })) === 0);
    const badHyp = await analyst.post(`${R}/check`, { portfolioId: pA.id, hypothetical: { ticker: 'NOPE.ZW', side: 'BUY', quantity: 1 } });
    check('hypothetical on an unknown security -> 404', badHyp.status === 404, badHyp.body);
    check('hypothetical with quantity 0 -> 400', (await analyst.post(`${R}/check`, { portfolioId: pA.id, hypothetical: { ticker: sA1.ticker, side: 'BUY', quantity: 0 } })).status === 400);

    // ---------------------------------------------------------------- monitor
    console.log('\nMonitor (one breach and one case per limit, portfolio and day)');
    const m1 = await maker.post(`${R}/monitor`, { portfolioId: pA.id }, { 'Idempotency-Key': key('mon') });
    check('monitor run -> 200, exactly one new breach (L1 only; the warning is not recorded)', m1.status === 200 && m1.body?.data?.newBreaches?.length === 1 && m1.body.data.newBreaches[0].limitRef === L1.ref, m1.body);
    const nb = m1.body?.data?.newBreaches?.[0];
    check('breach value 40, threshold 35, severity MEDIUM (14.29% over: < 15%)', nb?.value === '40.0000' && nb.threshold === '35.0000' && nb.severity === 'MEDIUM', nb);
    const breach = await prisma.riskBreach.findFirstOrThrow({ where: { limitId: L1.id, portfolioId: pA.id } });
    const autoCase = await prisma.riskCase.findFirstOrThrow({ where: { sourceBreachId: breach.id } });
    check('breach is OPEN, dated today, linked to a RC- case', breach.status === 'OPEN' && breach.detectedOn.toISOString().slice(0, 10) === today() && breach.caseId === autoCase.id && /^RC-\d{4}$/.test(autoCase.ref), { breach, autoCase });
    check('auto case: LIMIT_BREACH, MEDIUM, OPEN, owned by the limit owner, names the limit and the percentages', autoCase.type === 'LIMIT_BREACH' && autoCase.severity === 'MEDIUM' && autoCase.status === 'OPEN' && autoCase.ownerUserId === makerU.id && autoCase.description.includes(L1.ref) && autoCase.description.includes('40.00%') && autoCase.description.includes('35.00%'), autoCase);
    const outbox = await prisma.outboxEvent.findMany({ where: { type: 'notify.users' }, orderBy: { createdAt: 'desc' }, take: 50 });
    check('a notify.users outbox event was queued for the limit owner', outbox.some((o) => (o.payload as any)?.type === 'risk.breach' && (o.payload as any).userIds?.includes(makerU.id) && String((o.payload as any).title).includes(L1.ref)));
    check('audit: risk.breach_detected, risk.case_created, risk.monitor_run', (await auditCount('risk.breach_detected', breach.id)) === 1 && (await auditCount('risk.case_created', autoCase.id)) === 1 && (await auditCount('risk.monitor_run')) >= 1);
    const m2 = await maker.post(`${R}/monitor`, { portfolioId: pA.id }, { 'Idempotency-Key': key('mon') });
    check('re-run with a new key records nothing new (alreadyRecorded 1)', m2.status === 200 && m2.body?.data?.newBreaches?.length === 0 && m2.body.data.alreadyRecorded === 1, m2.body);
    const m3 = await maker.post(`${R}/monitor`, { portfolioId: pA.id });
    check('re-run without a key is also a no-op', m3.status === 200 && m3.body?.data?.newBreaches?.length === 0, m3.body);
    check('still exactly one breach and one case for the limit/portfolio/day', (await prisma.riskBreach.count({ where: { limitId: L1.id, portfolioId: pA.id } })) === 1 && (await prisma.riskCase.count({ where: { sourceBreachId: breach.id } })) === 1);
    const mk = key('mon-same');
    const ra = await maker.post(`${R}/monitor`, { portfolioId: pA.id }, { 'Idempotency-Key': mk });
    const rb = await maker.post(`${R}/monitor`, { portfolioId: pA.id }, { 'Idempotency-Key': mk });
    check('same Idempotency-Key replays the stored response', rb.headers.get('idempotent-replayed') === 'true' && JSON.stringify(ra.body) === JSON.stringify(rb.body));
    check('monitor of an unknown portfolio -> 404', (await maker.post(`${R}/monitor`, { portfolioId: '00000000-0000-4000-8000-000000000000' })).status === 404);

    // FIRM scope: applies to every portfolio. FIRM floor of 99% cash breaches book A and book C but not book D (cash 100%)
    const LF = (await activate({ metric: 'CASH_FLOOR_PCT', scopeType: 'FIRM', threshold: 99, breachAction: 'ALERT', description: `RK firm floor ${run}` })).limit;
    check('FIRM limit is created without a scope id and activated', LF?.status === 'ACTIVE' && LF.scopeType === 'FIRM' && LF.scopeId === null && LF.scopeName === 'All portfolios', LF);
    check('FIRM limit with a scope id -> 400', (await maker.post(`${R}/limits`, { metric: 'TOP5_PCT', scopeType: 'FIRM', scopeId: pA.id, threshold: 50 }, { 'Idempotency-Key': key('f') })).status === 400);
    const m4 = await maker.post(`${R}/monitor`, {}, { 'Idempotency-Key': key('mon-all') });
    const firmBreaches = (m4.body?.data?.newBreaches ?? []).filter((b: any) => b.limitRef === LF.ref);
    const firmPortfolios = firmBreaches.map((b: any) => b.portfolioRef);
    check('monitor over all portfolios: the FIRM limit breaches A, B and C (cash < 99%) but not D (cash 100%)', [pA, pB, pC].every((p) => firmPortfolios.includes(p.ref)) && !firmPortfolios.includes(pD.ref), firmPortfolios);
    check('FIRM breach severity: shortfall 99-15=84 of 99 = 84.8% -> CRITICAL', firmBreaches.find((b: any) => b.portfolioRef === pA.ref)?.severity === 'CRITICAL', firmBreaches);
    await maker.post(`${R}/limits/${LF.id}/retire`, { reason: 'test finished' });

    // ---------------------------------------------------------------- breaches
    console.log('\nBreaches');
    const bl = await analyst.get(`${R}/breaches?status=OPEN&portfolioId=${pA.id}`);
    const row = bl.body?.data?.find((b: any) => b.id === breach.id);
    check('breach list shows limit ref, portfolio name and linked case ref', bl.status === 200 && row?.limitRef === L1.ref && row.portfolioName === pA.name && row.caseRef === autoCase.ref && row.value === '40.0000', row);
    check('breach filter by limitId and date', (await analyst.get(`${R}/breaches?limitId=${L1.id}&from=${today()}&to=${today()}`)).body?.data?.length === 1);
    check('analyst cannot acknowledge -> 403', (await analyst.post(`${R}/breaches/${breach.id}/acknowledge`, {})).status === 403);
    const ack = await checker.post(`${R}/breaches/${breach.id}/acknowledge`, { note: 'Rebalancing planned for Friday' });
    check('acknowledge -> ACKNOWLEDGED with who, when and note', ack.status === 200 && ack.body?.data?.status === 'ACKNOWLEDGED' && ack.body.data.ackBy === checkerU.id && ack.body.data.ackNote === 'Rebalancing planned for Friday' && !!ack.body.data.ackAt, ack.body);
    check('acknowledge again -> 409 invalid_state', (await checker.post(`${R}/breaches/${breach.id}/acknowledge`, {})).body?.error?.code === 'invalid_state');
    check('audit risk.breach_acknowledged by the checker', (await prisma.auditEvent.count({ where: { action: 'risk.breach_acknowledged', objectId: breach.id, actorId: checkerU.id } })) === 1);
    check('acknowledge unknown breach -> 404', (await checker.post(`${R}/breaches/00000000-0000-4000-8000-000000000000/acknowledge`, {})).status === 404);

    // ---------------------------------------------------------------- scenarios
    console.log('\nScenario lab');
    const list = await analyst.get(`${R}/scenarios`);
    check('list returns the three presets (liquidity, equity, fx)', list.status === 200 && list.body?.presets?.length === 3 && list.body.data.filter((s: any) => s.preset).length >= 3, list.body?.presets);
    const presetRow = list.body?.data?.find((s: any) => s.preset === 'equity');
    check('preset scenarios are locked against edit and delete', (await maker.patch(`${R}/scenarios/${presetRow.id}`, { name: `x ${run}` })).body?.error?.code === 'preset_locked' && (await maker.del(`${R}/scenarios/${presetRow.id}`)).body?.error?.code === 'preset_locked');
    const sc = async (name: string, shocks: object) => {
      scenarioNames.push(`${name} ${run}`);
      const r = await maker.post(`${R}/scenarios`, { name: `${name} ${run}`, shocks }, { 'Idempotency-Key': key('sc') });
      return r;
    };
    const runOn = async (id: string, portfolioId: string) => maker.post(`${R}/scenarios/${id}/run`, { portfolioId });
    const bad = await maker.post(`${R}/scenarios`, { name: `bad ${run}`, shocks: { equityPct: -150 } }, { 'Idempotency-Key': key('sc') });
    check('equityPct below -100 -> 400', bad.status === 400);
    check('unknown shock key -> 400', (await maker.post(`${R}/scenarios`, { name: `bad2 ${run}`, shocks: { foo: 1 } }, { 'Idempotency-Key': key('sc') })).status === 400);

    // combined: rate +2pp with 2y duration, equity -10, ZWG -25%, redemption 30% on book B
    //  T-bill 30,000 x (1 - 2x2/100 = 0.96) = 28,800 (-1,200)
    //  equity 20,000 x 0.9 = 18,000 (-2,000); ZWG equity 1,000 x 0.9 = 900 (-100) then x 0.75 = 675 (fx -225)
    //  cash 49,000 unchanged -> post 96,475, loss 3,525 (3.5250%); impacts equity -2,100, rate -1,200, fx -225
    //  liquid = 49,000 + 28,800 = 77,800; redemption = 30% x 96,475 = 28,942.50; coverage 2.6881 -> Within
    const combo = await sc('combo', { equityPct: -10, fxPct: 25, ratePctPoints: 2, durationYears: 2, redemptionPct: 30 });
    check('create scenario -> 201 with defaults filled in', combo.status === 201 && combo.body?.data?.shocks?.equityPct === -10 && combo.body.data.runCount === 0, combo.body);
    check('duplicate scenario name -> 409', (await sc('combo', {})).status === 409);
    const cr = await runOn(combo.body.data.id, pB.id);
    const cres = cr.body?.data?.results;
    check('run -> 201 and stored with portfolio, asOf and run-by', cr.status === 201 && cr.body.data.portfolioId === pB.id && cr.body.data.runBy === makerU.id && !!cr.body.data.asOf, cr.body);
    check('NAV 100,000.00; post-shock 96,475.00; loss 3,525.00; loss % 3.5250', cres?.nav === '100000.00' && cres.postShockValue === '96475.00' && cres.loss === '3525.00' && cres.lossPct === '3.5250', cres);
    check('impacts: equity -2,100.00, rate -1,200.00, fx -225.00', cres?.impacts?.equity === '-2100.00' && cres.impacts.rate === '-1200.00' && cres.impacts.fx === '-225.00', cres?.impacts);
    check('liquid assets 77,800.00; redemption 28,942.50; coverage 2.6881; status Within', cres?.liquidity?.liquidAssets === '77800.00' && cres.liquidity.redemptionAmount === '28942.50' && cres.liquidity.coverage === '2.6881' && cres.status === 'Within', cres?.liquidity);
    check('no ACTIVE limit applies to book B, so no limit checks', cres?.limitChecks?.length === 0);
    check('audit risk.scenario_run recorded', (await auditCount('risk.scenario_run', cr.body?.data?.id)) === 1);
    const runs = await analyst.get(`${R}/runs?scenarioId=${combo.body.data.id}`);
    check('runs list returns the stored run with scenario and portfolio names', runs.status === 200 && runs.body?.data?.length === 1 && runs.body.data[0].scenarioName === `combo ${run}` && runs.body.data[0].portfolioName === pB.name && runs.body.data[0].results.status === 'Within', runs.body);
    check('GET /runs/:id', (await analyst.get(`${R}/runs/${cr.body.data.id}`)).body?.data?.results?.loss === '3525.00');
    check('scenario with runs cannot be deleted -> 409', (await maker.del(`${R}/scenarios/${combo.body.data.id}`)).body?.error?.code === 'scenario_has_runs');
    check('scenario list shows the run count', (await analyst.get(`${R}/scenarios`)).body?.data?.find((s: any) => s.id === combo.body.data.id)?.runCount === 1);

    // liquidity thresholds on book B (liquid assets 79,000 = cash 49,000 + T-bill 30,000, no market move)
    const liq = async (pct: number) => (await maker.post(`${R}/scenarios/preview`, { portfolioId: pB.id, shocks: { redemptionPct: pct } })).body?.data?.results;
    const l50 = await liq(50);
    const l72 = await liq(72);
    const l80 = await liq(80);
    check('redemption 50%: coverage 79,000/50,000 = 1.5800 -> Within', l50?.liquidity?.coverage === '1.5800' && l50.status === 'Within', l50?.liquidity);
    check('redemption 72%: coverage 79,000/72,000 = 1.0972 (< 1.1) -> Review', l72?.liquidity?.coverage === '1.0972' && l72.status === 'Review' && l72.reasons.length === 1, l72);
    check('redemption 80%: coverage 79,000/80,000 = 0.9875 (< 1.0) -> Escalate', l80?.liquidity?.coverage === '0.9875' && l80.status === 'Escalate', l80);
    const l0 = await liq(0);
    check('no redemption: coverage is null and status Within', l0?.liquidity?.coverage === null && l0.status === 'Within');
    check('preview stores nothing', (await prisma.riskScenarioRun.count({ where: { portfolioId: pB.id } })) === 1);

    // presets on book B
    const byPreset = (k: string) => list.body.data.find((s: any) => s.preset === k);
    const pLiq = (await maker.post(`${R}/scenarios/${byPreset('liquidity').id}/run`, { portfolioId: pB.id })).body?.data?.results;
    check('liquidity preset (15% redemption): coverage 79,000/15,000 = 5.2667, loss 0', pLiq?.liquidity?.coverage === '5.2667' && pLiq.loss === '0.00' && pLiq.status === 'Within', pLiq);
    const pEq = (await maker.post(`${R}/scenarios/${byPreset('equity').id}/run`, { portfolioId: pB.id })).body?.data?.results;
    check('equity preset (-20%): equity 20,000+1,000 -> loss 4,200.00 = 4.2000%', pEq?.loss === '4200.00' && pEq.lossPct === '4.2000' && pEq.impacts.equity === '-4200.00', pEq);
    const pFx = (await maker.post(`${R}/scenarios/${byPreset('fx').id}/run`, { portfolioId: pB.id })).body?.data?.results;
    check('fx preset (ZWG -25%): only the ZWG holding (1,000) is hit -> loss 250.00 = 0.2500%', pFx?.loss === '250.00' && pFx.lossPct === '0.2500' && pFx.impacts.fx === '-250.00', pFx);

    // book A has no fixed income: the rate shock is zero and the result says so
    //  equity -20: six equities 85,000 x 0.8 = 68,000 + cash 15,000 = 83,000 -> loss 17,000 (17.0000%)
    //  post-shock A1 32,000 / 83,000 = 38.5542% > 35 -> L1 BREACH -> Escalate
    const aRate = (await maker.post(`${R}/scenarios/preview`, { portfolioId: pA.id, shocks: { ratePctPoints: 3, durationYears: 5 } })).body?.data?.results;
    check('rate shock on a book without fixed income: effect 0.00 and an explanatory note', aRate?.impacts?.rate === '0.00' && aRate.loss === '0.00' && aRate.notes.some((n: string) => /no fixed-income/i.test(n)), aRate);
    const aEq = (await maker.post(`${R}/scenarios/preview`, { portfolioId: pA.id, shocks: { equityPct: -20 } })).body?.data?.results;
    check('book A equity -20: post 83,000.00, loss 17,000.00 (17.0000%)', aEq?.postShockValue === '83000.00' && aEq.loss === '17000.00' && aEq.lossPct === '17.0000', aEq);
    const l1chk = aEq?.limitChecks?.find((c: any) => c.ref === L1.ref);
    check('post-shock single name 38.5542 vs limit 35 -> BREACH, scenario status Escalate', l1chk?.value === '38.5542' && l1chk.state === 'BREACH' && aEq.status === 'Escalate' && aEq.reasons.some((r: string) => r.includes(L1.ref)), aEq);
    check('post-shock cash 15,000/83,000 = 18.0723 vs floor 10 -> OK', aEq?.limitChecks?.find((c: any) => c.ref === L2.ref)?.value === '18.0723' && aEq.limitChecks.find((c: any) => c.ref === L2.ref).state === 'OK');

    // Review from a limit: book C single name 50%, limit 54 -> inside the 10% band (48.6 and above)
    const LC = (await activate({ metric: 'SINGLE_NAME_PCT', scopeType: 'PORTFOLIO', scopeId: pC.id, threshold: 54, breachAction: 'ALERT', description: `RK C single ${run}` })).limit;
    const cRev = (await maker.post(`${R}/scenarios/preview`, { portfolioId: pC.id, shocks: {} })).body?.data?.results;
    check('book C with no shock: 50.0000 vs limit 54 -> WARNING and scenario status Review', cRev?.limitChecks?.[0]?.state === 'WARNING' && cRev.limitChecks[0].value === '50.0000' && cRev.status === 'Review', cRev);
    const cWithin = (await maker.post(`${R}/scenarios/preview`, { portfolioId: pC.id, shocks: { equityPct: -50 } })).body?.data?.results;
    //  equity -50: 45,000 + 20,000 + cash 10,000 = 75,000; S1 25,000 -> 33.3333% vs 54 -> OK -> Within
    check('book C equity -50: 25,000 + 20,000 + cash 10,000 = 55,000, single name 25,000/55,000 = 45.4545 (< 48.6) -> Within', cWithin?.postShockValue === '55000.00' && cWithin.limitChecks[0].value === '45.4545' && cWithin.status === 'Within', cWithin);

    // FX shock in a ZWG-based book: USD cash 1,000 = ZWG 13,000 gains 1/0.8 when ZWG falls 20%
    const dFx = (await maker.post(`${R}/scenarios/preview`, { portfolioId: pD.id, shocks: { fxPct: 20 } })).body?.data?.results;
    check('ZWG book, ZWG -20%: USD cash 13,000 -> 16,250 (gain 3,250), post 23,250, loss -3,250.00 (-16.2500%)', dFx?.nav === '20000.00' && dFx.postShockValue === '23250.00' && dFx.loss === '-3250.00' && dFx.lossPct === '-16.2500', dFx);
    const noFx = (await maker.post(`${R}/scenarios/preview`, { portfolioId: pC.id, shocks: { fxPct: 20 } })).body?.data?.results;
    check('FX shock with no ZWG exposure: zero effect and a note', noFx?.loss === '0.00' && noFx.notes.some((n: string) => /no ZWG\/USD/i.test(n)), noFx);

    const del = await sc('to-delete', { equityPct: -5 });
    check('scenario without runs can be edited and deleted', (await maker.patch(`${R}/scenarios/${del.body.data.id}`, { shocks: { equityPct: -7 } })).body?.data?.shocks?.equityPct === -7 && (await maker.del(`${R}/scenarios/${del.body.data.id}`)).status === 200);
    check('audit risk.scenario_created/updated/deleted', (await auditCount('risk.scenario_created', del.body.data.id)) === 1 && (await auditCount('risk.scenario_updated', del.body.data.id)) === 1 && (await auditCount('risk.scenario_deleted', del.body.data.id)) === 1);
    check('run on an unknown portfolio -> 404', (await runOn(combo.body.data.id, '00000000-0000-4000-8000-000000000000')).status === 404);
    check('analyst cannot run a stored scenario -> 403', (await analyst.post(`${R}/scenarios/${combo.body.data.id}/run`, { portfolioId: pB.id })).status === 403);

    // ---------------------------------------------------------------- cases
    console.log('\nCases');
    check('create without a description -> 400', (await maker.post(`${R}/cases`, { type: 'MANUAL' }, { 'Idempotency-Key': key('c') })).status === 400);
    check('create with a blank description -> 400', (await maker.post(`${R}/cases`, { description: '  ' }, { 'Idempotency-Key': key('c') })).status === 400);
    check('create without Idempotency-Key -> 400', (await maker.post(`${R}/cases`, { description: 'Missing key case' })).status === 400);
    const ck = key('case');
    const cc = await maker.post(`${R}/cases`, { type: 'RESTRICTED_LIST', description: `Trade in restricted name ${run}`, severity: 'HIGH', portfolioId: pA.id }, { 'Idempotency-Key': ck });
    const C1 = cc.body?.data;
    check('create -> 201 OPEN, RC- ref, severity HIGH, owner defaults to the creator', cc.status === 201 && C1?.status === 'OPEN' && /^RC-\d{4}$/.test(C1.ref) && C1.severity === 'HIGH' && C1.ownerUserId === makerU.id && C1.portfolioName === pA.name, cc.body);
    check('case create replays on the same key', (await maker.post(`${R}/cases`, { type: 'RESTRICTED_LIST', description: `Trade in restricted name ${run}`, severity: 'HIGH', portfolioId: pA.id }, { 'Idempotency-Key': ck })).headers.get('idempotent-replayed') === 'true');
    check('audit risk.case_created (manual)', (await auditCount('risk.case_created', C1.id)) === 1);
    const lst = await analyst.get(`${R}/cases?status=OPEN&severity=HIGH&q=${run}`);
    check('list filters by status, severity and text', lst.status === 200 && lst.body?.data?.length === 1 && lst.body.data[0].id === C1.id, lst.body);
    check('list open=1 includes the auto case and the manual case', (await analyst.get(`${R}/cases?open=1&ownerId=${makerU.id}`)).body?.data?.filter((c: any) => c.id === C1.id || c.id === autoCase.id).length === 2);
    const asg = await maker.post(`${R}/cases/${C1.id}/assign`, { ownerUserId: checkerU.id });
    check('assign to another staff user', asg.status === 200 && asg.body?.data?.ownerUserId === checkerU.id && asg.body.data.ownerName === 'RK checker', asg.body);
    check('assign to an unknown user -> 400', (await maker.post(`${R}/cases/${C1.id}/assign`, { ownerUserId: '00000000-0000-4000-8000-000000000000' })).status === 400);
    check('audit risk.case_assigned', (await auditCount('risk.case_assigned', C1.id)) === 1);
    check('mine=1 lists the cases of the caller', (await checker.get(`${R}/cases?mine=1`)).body?.data?.some((c: any) => c.id === C1.id));
    const patched = await maker.patch(`${R}/cases/${C1.id}`, { severity: 'CRITICAL', version: asg.body.data.version });
    check('edit severity with the current version', patched.status === 200 && patched.body?.data?.severity === 'CRITICAL', patched.body);
    check('edit with a stale version -> 409', (await maker.patch(`${R}/cases/${C1.id}`, { severity: 'LOW', version: 1 })).status === 409);

    const tr = (id: string, status: string, note?: string) => maker.post(`${R}/cases/${id}/transition`, { status, note });
    check('OPEN -> RESOLVED is not allowed -> 409 invalid_transition', (await tr(C1.id, 'RESOLVED', 'done done')).body?.error?.code === 'invalid_transition');
    check('OPEN -> CLOSED is not allowed -> 409', (await tr(C1.id, 'CLOSED', 'nope nope')).status === 409);
    const inv = await tr(C1.id, 'INVESTIGATING');
    check('OPEN -> INVESTIGATING', inv.status === 200 && inv.body?.data?.status === 'INVESTIGATING', inv.body);
    const noNote = await tr(C1.id, 'RESOLVED');
    check('INVESTIGATING -> RESOLVED without a resolution note -> 400', noNote.status === 400, noNote.body);
    const res1 = await tr(C1.id, 'RESOLVED', 'Trade reversed; confirmed with the dealer');
    check('INVESTIGATING -> RESOLVED with a note stores note and resolvedAt', res1.status === 200 && res1.body?.data?.status === 'RESOLVED' && res1.body.data.resolutionNote === 'Trade reversed; confirmed with the dealer' && !!res1.body.data.resolvedAt, res1.body);
    const closed = await tr(C1.id, 'CLOSED');
    check('RESOLVED -> CLOSED keeps the resolution note', closed.status === 200 && closed.body?.data?.status === 'CLOSED' && closed.body.data.resolutionNote?.startsWith('Trade reversed'), closed.body);
    check('CLOSED is terminal (-> INVESTIGATING 409) and cannot be edited or reassigned', (await tr(C1.id, 'INVESTIGATING')).status === 409 && (await maker.patch(`${R}/cases/${C1.id}`, { severity: 'LOW' })).status === 409 && (await maker.post(`${R}/cases/${C1.id}/assign`, { ownerUserId: makerU.id })).status === 409);
    check('audit risk.case_transitioned recorded three times for the case', (await auditCount('risk.case_transitioned', C1.id)) === 3);
    check('a closed case cannot be deleted', (await maker.del(`${R}/cases/${C1.id}`)).status === 409);
    const scratch = await maker.post(`${R}/cases`, { description: `Scratch case ${run}` }, { 'Idempotency-Key': key('c') });
    check('an OPEN manual case can be deleted (audited)', (await maker.del(`${R}/cases/${scratch.body.data.id}`)).status === 200 && (await auditCount('risk.case_deleted', scratch.body.data.id)) === 1);
    check('an auto-opened breach case cannot be deleted', (await maker.del(`${R}/cases/${autoCase.id}`)).status === 409);

    // closing the breach case resolves the breach
    await tr(autoCase.id, 'INVESTIGATING');
    await tr(autoCase.id, 'CLOSED', 'False alarm after revaluation');
    check('closing the auto case sets the source breach to RESOLVED', (await prisma.riskBreach.findUniqueOrThrow({ where: { id: breach.id } })).status === 'RESOLVED');
    const manual = await maker.post(`${R}/cases`, { description: `Linked to a breach ${run}`, sourceBreachId: breach.id }, { 'Idempotency-Key': key('c') });
    check('a breach that already has a case cannot get a second one -> 409', manual.status === 409 && manual.body?.error?.code === 'breach_has_case', manual.body);

    // ---------------------------------------------------------------- retire
    console.log('\nRetire');
    check('retire needs a reason -> 400', (await maker.post(`${R}/limits/${L4.id}/retire`, {})).status === 400);
    const ret = await maker.post(`${R}/limits/${L4.id}/retire`, { reason: 'Superseded by the mandate review' });
    check('retire -> RETIRED with retiredAt', ret.status === 200 && ret.body?.data?.status === 'RETIRED' && !!ret.body.data.retiredAt, ret.body);
    check('retire a RETIRED limit -> 409 and audit risk.limit_retired carries the reason', (await maker.post(`${R}/limits/${L4.id}/retire`, { reason: 'again' })).status === 409 && (await prisma.auditEvent.count({ where: { action: 'risk.limit_retired', objectId: L4.id, reason: 'Superseded by the mandate review' } })) === 1);
    const after = await checkLimitsForPortfolio(snapA);
    check('retired limits drop out of the check', !after.evaluations.some((e) => e.ref === L4.ref) && after.evaluations.length === 3, after.evaluations.map((e) => e.ref));
    check('a retired limit cannot be submitted or edited', (await maker.post(`${R}/limits/${L4.id}/submit`)).status === 409 && (await maker.patch(`${R}/limits/${L4.id}`, { threshold: 70 })).status === 409);
    const ls = await analyst.get(`${R}/limits?status=ACTIVE&portfolioId=${pA.id}`);
    check('limit list filters by status and portfolio; rows carry owner, maker, checker and scope names', ls.status === 200 && ls.body.data.some((l: any) => l.id === L1.id && l.ownerName === 'RK maker' && l.checkerName === 'RK checker' && l.scopeName === pA.name) && !ls.body.data.some((l: any) => l.id === L4.id), ls.body?.data);
    check('GET a limit by ref', (await analyst.get(`${R}/limits/${L1.ref}`)).body?.data?.id === L1.id);
    check('unknown limit -> 404', (await analyst.get(`${R}/limits/LIM-9999`)).status === 404);
    void LC;
  } finally {
    await cleanup();
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  console.log(failures ? `${failures} check(s) FAILED` : 'All risk checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);

  async function cleanup() {
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.log(`  (cleanup: ${label} skipped: ${(err as Error).message.split('\n').pop()})`);
      }
    };
    await step('breaches', () => prisma.riskBreach.deleteMany({ where: { portfolioId: { in: portfolioIds } } }));
    await step('cases', () => prisma.riskCase.deleteMany({ where: { OR: [{ createdBy: { in: userIds } }, { portfolioId: { in: portfolioIds } }] } }));
    await step('runs', () => prisma.riskScenarioRun.deleteMany({ where: { portfolioId: { in: portfolioIds } } }));
    await step('scenarios', () => prisma.riskScenario.deleteMany({ where: { name: { in: scenarioNames }, preset: null } }));
    await step('limits', () => prisma.riskLimit.deleteMany({ where: { id: { in: limitIds } } }));
    await step('portfolios', () => prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } }));
    await step('securities', () => prisma.security.deleteMany({ where: { id: { in: securityIds } } }));
    await step('idempotency keys', () => prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } }));
    await step('client links', () => prisma.clientUser.deleteMany({ where: { userId: { in: userIds } } }));
    await step('users', () => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
    await step('clients', () => prisma.client.deleteMany({ where: { id: { in: clientIds } } }));
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
