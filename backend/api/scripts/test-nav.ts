/**
 * NAV & Valuation checks against a RUNNING API: hand-computed NAV, NAV per unit and price coverage, every
 * exception type, recalculation versioning, maker review blocked by a material exception, release needing a
 * different user plus step-up MFA, immutability of a released run, superseding the previous released version,
 * the linked fund and the LP portal view of it, audit events, outbox notification and permission refusals.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx scripts/test-nav.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first (for example
 * `nexus_nav_test`) and start the API against the same DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP enrolment).
 * Creates throwaway users, securities, portfolios, a fund and an LP client with a random run id (best-effort removal
 * at the end); disposable DBs only.
 *
 * Fixtures (NAV date 2026-09-30, all USD unless stated; staleness limit 3 days, price-move limit 10%):
 *   P1  NA1 1,000 x 10 (priced on the day) = 10,000; NA2 2,000 x 5 (priced 1 day before) = 10,000; cash 5,000.
 *       Inputs: accruals 100, fees 25, liabilities 50, units 2,500.
 *       NAV = 20,000 + 5,000 + 100 - 25 - 50 = 25,025; NAV/unit = 25,025 / 2,500 = 10.0100; coverage 100%. Linked to fund F1.
 *   P2  ST 100 x 10 (priced 10 days before: stale) = 1,000; TL 1,000 x 12 (was 10 the day before: +20%) = 12,000;
 *       MP 500 with no price (cost 2 = 1,000); MF 100 EUR x 4 with no EUR/USD rate (400 local); cash -500.
 *       Valued = 13,000; NAV = 13,000 - 500 = 12,500; coverage = 13,000 / (13,000 + 1,000 + 400) = 90.2778%.
 *       Exceptions: STALE_PRICE (not material), MISSING_PRICE, MISSING_FX, TOLERANCE (diff 2,000), NEGATIVE_CASH.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { computeNav, feeFromRate, isMaterial, navPerUnit, priceCoverage, daysBetween } from '../src/modules/nav/nav.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Nv-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `nv-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const N = '/api/v1/nav';
const NAV_DATE = '2026-09-30';

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

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];
  const clientIds: string[] = [];
  const fundIds: string[] = [];

  const mkUser = async (label: string, portal: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `nv-${run}-${label}@example.test`, name: `NV ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, roleKey)).id } });
    return u;
  };
  const prep = await mkUser('prep', 'admin', 'fund_accountant'); // valuation.view + valuation.release
  const rel = await mkUser('rel', 'admin', 'investment_director'); // valuation.view + valuation.release
  const pmU = await mkUser('pm', 'admin', 'portfolio_manager'); // valuation.view only
  const noView = await mkUser('noview', 'admin', 'analyst'); // no valuation.view
  const sysU = await mkUser('sys', 'admin', 'system_admin'); // valuation.view, never release
  const lpU = await mkUser('lp', 'investor', 'finance');
  const lpClient = await prisma.client.create({ data: { ref: `X${run}N`, name: `NV LP ${run}`, type: 'Pension fund', portalEnabled: true, kycStatus: 'Current' } });
  clientIds.push(lpClient.id);
  await prisma.clientUser.create({ data: { userId: lpU.id, clientId: lpClient.id, investorRole: 'finance' } });

  const cPrep = client('admin');
  const cRel = client('admin');
  const cPm = client('admin');
  const cNo = client('admin');
  const cSys = client('admin');
  const cLp = client('investor');
  const anon = client('admin');

  // ---- fixtures
  const mkSec = async (label: string, price: [string, string][], opts: { currency?: string } = {}) => {
    const s = await prisma.security.create({
      data: { ticker: `NV${label}-${run}`.toUpperCase(), name: `NV ${label} ${run}`, market: 'VFEX', assetClass: 'Equity', currency: opts.currency ?? 'USD', sector: `Sec-${run}` },
    });
    securityIds.push(s.id);
    for (const [d, p] of price) await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: day(d), price: D(p), source: 'NAVTEST' } });
    return s;
  };
  const mkPortfolio = async (label: string, positions: [{ id: string }, string, string][], cash: string) => {
    const p = await prisma.portfolio.create({ data: { ref: `NVP-${run}-${label}`, name: `NV Fund ${label} ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} } });
    portfolioIds.push(p.id);
    for (const [s, qty, cost] of positions) await prisma.portfolioPosition.create({ data: { portfolioId: p.id, securityId: s.id, quantity: D(qty), avgCost: D(cost), asOf: day('2026-09-01') } });
    await prisma.portfolioCash.create({ data: { portfolioId: p.id, currency: 'USD', available: D(cash), asOf: day('2026-09-01') } });
    return p;
  };
  const sNA1 = await mkSec('NA1', [['2026-09-14', '9.8'], ['2026-09-30', '10']]);
  const sNA2 = await mkSec('NA2', [['2026-09-14', '5'], ['2026-09-29', '5']]);
  const sST = await mkSec('ST', [['2026-09-20', '10']]);
  const sTL = await mkSec('TL', [['2026-09-29', '10'], ['2026-09-30', '12']]);
  const sMP = await mkSec('MP', []);
  const sMF = await mkSec('MF', [['2026-09-30', '4']], { currency: 'EUR' });
  const p1 = await mkPortfolio('P1', [[sNA1, '1000', '8'], [sNA2, '2000', '4']], '5000');
  const p2 = await mkPortfolio('P2', [[sST, '100', '9'], [sTL, '1000', '9'], [sMP, '500', '2'], [sMF, '100', '3']], '-500');
  const fund = await prisma.fund.create({
    data: { ref: `FND-NV${run}`, name: `NV Open Fund ${run}`, shortName: `NV ${run}`, operatingModel: 'OPEN_ENDED', currency: 'USD', status: 'Active', portalVisible: true, defaultShareClass: 'A', valuationStatus: 'PROVISIONAL', asOfDate: day('2026-06-30'), navPerUnit: D('9'), portfolioId: p1.id },
  });
  fundIds.push(fund.id);
  await prisma.fundCommitment.create({ data: { clientId: lpClient.id, fundId: fund.id, commitmentAmount: D('1000'), currency: 'USD', status: 'ACTIVE' } });
  await prisma.lpHolding.create({ data: { clientId: lpClient.id, fundId: fund.id, shareClassCode: 'A', units: D('100'), navPerUnit: D('9'), accountValue: D('900'), currency: 'USD', asOfDate: day('2026-06-30'), valuationStatus: 'PROVISIONAL' } });

  const auditCount = (action: string, objectId?: string, actorId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}), ...(actorId ? { actorId } : {}) } });
  const num = (s: any) => Number(s);

  try {
    // ---------------------------------------------------------------- pure maths
    console.log('\nFormulas (BR-012, BR-013)');
    check('NAV = market value + cash + accruals - fees - liabilities', computeNav({ marketValue: D(20000), cash: D(5000), accruals: D(100), fees: D(25), liabilities: D(50) }).toFixed(2) === '25025.00');
    check('NAV per unit 4 dp: 25,025 / 2,500 = 10.0100', navPerUnit(D(25025), D(2500))?.toFixed(4) === '10.0100');
    check('NAV per unit rounds half-up: 200 / 3 = 66.6667 and 100 / 3 = 33.3333', navPerUnit(D(200), D(3))?.toFixed(4) === '66.6667' && navPerUnit(D(100), D(3))?.toFixed(4) === '33.3333');
    check('NAV per unit with no units is null', navPerUnit(D(100), null) === null && navPerUnit(D(100), D(0)) === null);
    check('price coverage 13,000 / 14,400 = 90.2778', priceCoverage(D(13000), D(1400)).toFixed(4) === '90.2778');
    check('price coverage with nothing to value is 100', priceCoverage(D(0), D(0)).toFixed(4) === '100.0000');
    check('management fee accrual: 3.65% x 25,100 / 365 = 2.51', feeFromRate(D('3.65'), D(25100)).toFixed(2) === '2.51');
    check('materiality: 0.4% of a 10,000 position is not material; 1.5% is; above 50,000 always is', !isMaterial(D(40), D(10000), { tolerancePct: 1, toleranceAbs: 50000 }) && isMaterial(D(150), D(10000), { tolerancePct: 1, toleranceAbs: 50000 }) && isMaterial(D(60000), D(100_000_000), { tolerancePct: 1, toleranceAbs: 50000 }));
    check('daysBetween', daysBetween(day('2026-09-20'), day('2026-09-30')) === 10);

    // ---------------------------------------------------------------- sign-in and permissions
    console.log('\nSign-in, permissions and portal scoping');
    for (const [c, u] of [[cPrep, prep], [cRel, rel], [cPm, pmU], [cNo, noView], [cSys, sysU], [cLp, lpU]] as const) {
      check(`${u.email.split('@')[0]!.replace(`nv-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    }
    check('preparer enrols MFA', await cPrep.enrolMfa());
    check('releaser enrols MFA', await cRel.enrolMfa());
    check('system admin enrols MFA', await cSys.enrolMfa());
    check('GET /nav/runs without a session -> 401', (await anon.get(`${N}/runs`)).status === 401);
    check('GET /nav/runs as an investor -> 403', (await cLp.get(`${N}/runs`)).status === 403);
    const denied = await cNo.get(`${N}/runs`);
    check('GET /nav/runs without valuation.view -> 403 permission_denied', denied.status === 403 && denied.body?.error?.code === 'permission_denied', denied.body);
    const denyCreate = await cNo.post(`${N}/runs`, { portfolioId: p1.id, navDate: NAV_DATE }, { 'Idempotency-Key': key('deny') });
    check('create without valuation.view -> 403', denyCreate.status === 403, denyCreate.body);
    check('a view-only holder can read the list', (await cPm.get(`${N}/runs`)).status === 200);

    // ---------------------------------------------------------------- create P1
    console.log('\nCreate and calculate (P1: NAV 25,025, NAV/unit 10.0100)');
    const b1 = { portfolioId: p1.id, navDate: NAV_DATE, accruals: 100, fees: 25, liabilities: 50, units: 2500, notes: `NV ${run} base case` };
    check('create without Idempotency-Key -> 400', (await cPrep.post(`${N}/runs`, b1)).status === 400);
    check('future NAV date -> 400', (await cPrep.post(`${N}/runs`, { ...b1, navDate: '2999-01-01' }, { 'Idempotency-Key': key('bad') })).status === 400);
    check('unknown portfolio -> 400', (await cPrep.post(`${N}/runs`, { ...b1, portfolioId: '00000000-0000-4000-8000-000000000000' }, { 'Idempotency-Key': key('bad') })).status === 400);
    check('negative accruals -> 400', (await cPrep.post(`${N}/runs`, { ...b1, accruals: -5 }, { 'Idempotency-Key': key('bad') })).status === 400);
    check('fees and a fee rate together -> 400', (await cPrep.post(`${N}/runs`, { ...b1, feeRatePct: 2 }, { 'Idempotency-Key': key('bad') })).status === 400);
    check('unknown field -> 400', (await cPrep.post(`${N}/runs`, { ...b1, nav: 1 }, { 'Idempotency-Key': key('bad') })).status === 400);
    const k1 = key('p1');
    const c1 = await cPrep.post(`${N}/runs`, b1, { 'Idempotency-Key': k1 });
    const R1 = c1.body?.data;
    check('create -> 201 DRAFT, NAV-##### ref, version 1, linked to the fund', c1.status === 201 && R1?.status === 'DRAFT' && /^NAV-\d{5}$/.test(R1.ref) && R1.version === 1 && R1.fundId === fund.id && R1.makerId === prep.id, c1.body);
    check('market value 20,000 and cash 5,000', R1?.marketValue === '20000.00' && R1?.cash === '5000.00', R1);
    check('accruals 100, fees 25, liabilities 50', R1?.accruals === '100.00' && R1?.fees === '25.00' && R1?.liabilities === '50.00', R1);
    check('NAV 25,025.00, units 2,500, NAV/unit 10.0100', R1?.nav === '25025.00' && num(R1?.units) === 2500 && R1?.navPerUnit === '10.0100', R1);
    check('price coverage 100%, 2 positions, no exceptions', R1?.priceCoverage === '100.0000' && R1?.positionCount === 2 && R1?.exceptions?.length === 0, R1?.exceptions);
    const lineNa1 = R1?.lines?.find((l: any) => l.ticker.startsWith('NVNA1'));
    const lineNa2 = R1?.lines?.find((l: any) => l.ticker.startsWith('NVNA2'));
    check('lines carry price, source, date and base value', lineNa1?.price === '10.000000' && lineNa1?.priceSource === 'NAVTEST' && lineNa1?.priceDate === NAV_DATE && lineNa1?.valueBase === '10000.00' && lineNa2?.priceDate === '2026-09-29' && lineNa2?.valueBase === '10000.00', R1?.lines);
    const sum = R1?.bridge?.reduce((s: number, b: any) => s + b.sign * num(b.amount), 0);
    check('NAV bridge adds up to the NAV', Math.abs(sum - 25025) < 0.005 && R1.bridge.at(-1).amount === '25025.00', R1?.bridge);
    check('stage bar has seven stages, Maker review is current once inputs are in', R1?.stageBar?.length === 7 && R1.stageBar.find((s: any) => s.state === 'current')?.key === 'MAKER_REVIEW', R1?.stageBar);
    const replay = await cPrep.post(`${N}/runs`, b1, { 'Idempotency-Key': k1 });
    check('same Idempotency-Key replays the same run', replay.headers.get('idempotent-replayed') === 'true' && replay.body?.data?.id === R1?.id, replay.body);
    check('same key with a different payload -> 409', (await cPrep.post(`${N}/runs`, { ...b1, units: 2400 }, { 'Idempotency-Key': k1 })).status === 409);
    check('audit nav.run_created by the preparer', (await auditCount('nav.run_created', R1.id, prep.id)) === 1);
    const fundDraft = await prisma.fund.findUniqueOrThrow({ where: { id: fund.id } });
    check('a draft run does not touch the fund', fundDraft.navPerUnit?.toFixed(4) === '9.0000' && fundDraft.valuationStatus === 'PROVISIONAL' && fundDraft.asOfDate?.toISOString().slice(0, 10) === '2026-06-30', fundDraft);

    // ---------------------------------------------------------------- inputs
    console.log('\nEditable inputs');
    const fee = await cPrep.patch(`${N}/runs/${R1.id}/inputs`, { feeRatePct: 3.65 });
    check('fee rate 3.65%: fees 2.51, NAV 25,047.49, NAV/unit 10.0190', fee.status === 200 && fee.body.data.fees === '2.51' && fee.body.data.nav === '25047.49' && fee.body.data.navPerUnit === '10.0190' && fee.body.data.feeRatePct === '3.6500', fee.body);
    const manual = await cPrep.patch(`${N}/runs/${R1.id}/inputs`, { fees: 25, notes: 'manual fees' });
    check('manual fees switch the rate off (back to NAV 25,025.00)', manual.status === 200 && manual.body.data.nav === '25025.00' && manual.body.data.feeRatePct === null && manual.body.data.notes === 'manual fees', manual.body);
    check('both fees and a rate -> 400', (await cPrep.patch(`${N}/runs/${R1.id}/inputs`, { fees: 1, feeRatePct: 1 })).status === 400);
    check('empty patch -> 400', (await cPrep.patch(`${N}/runs/${R1.id}/inputs`, {})).status === 400);
    check('audit nav.inputs_updated', (await auditCount('nav.inputs_updated', R1.id, prep.id)) === 2);
    const noUnits = await cPrep.patch(`${N}/runs/${R1.id}/inputs`, { units: null });
    check('clearing units leaves no NAV/unit', noUnits.status === 200 && noUnits.body.data.navPerUnit === null);
    const needUnits = await cPrep.post(`${N}/runs/${R1.id}/maker-review`);
    check('maker review of a fund NAV without units -> 409 units_required', needUnits.status === 409 && needUnits.body?.error?.code === 'units_required', needUnits.body);
    await cPrep.patch(`${N}/runs/${R1.id}/inputs`, { units: 2500 });

    // ---------------------------------------------------------------- versioning
    console.log('\nRecalculation and versions');
    const rc = await cPrep.post(`${N}/runs/${R1.id}/recalculate`);
    const R1b = rc.body?.data;
    check('recalculate -> 201, version 2, new ref, inputs carried over', rc.status === 201 && R1b?.version === 2 && R1b.ref !== R1.ref && R1b.nav === '25025.00' && num(R1b.units) === 2500 && R1b.fees === '25.00', rc.body);
    check('version 1 is SUPERSEDED', (await prisma.navRun.findUniqueOrThrow({ where: { id: R1.id } })).status === 'SUPERSEDED');
    check('version history lists both versions', R1b?.versions?.length === 2 && R1b.versions[0].version === 2, R1b?.versions);
    const old = await cPrep.post(`${N}/runs/${R1.id}/recalculate`);
    check('recalculating a superseded run -> 409 run_immutable', old.status === 409 && old.body?.error?.code === 'run_immutable', old.body);
    check('editing a superseded run -> 409 run_immutable', (await cPrep.patch(`${N}/runs/${R1.id}/inputs`, { accruals: 1 })).body?.error?.code === 'run_immutable');
    const again = await cPrep.post(`${N}/runs`, { portfolioId: p1.id, navDate: NAV_DATE }, { 'Idempotency-Key': key('again') });
    const R1c = again.body?.data;
    check('POST /runs for the same portfolio and date -> version 3, version 2 superseded', again.status === 201 && R1c?.version === 3 && (await prisma.navRun.findUniqueOrThrow({ where: { id: R1b.id } })).status === 'SUPERSEDED', again.body);
    check('inputs are carried over to the new version', R1c?.nav === '25025.00' && num(R1c?.units) === 2500);
    check('audit nav.run_recalculated and nav.run_superseded', (await auditCount('nav.run_recalculated', R1b.id)) === 1 && (await auditCount('nav.run_superseded', R1.id)) === 1);

    // ---------------------------------------------------------------- exceptions (P2)
    console.log('\nExceptions (P2: five types, NAV 12,500, coverage 90.2778%)');
    const c2 = await cPrep.post(`${N}/runs`, { portfolioId: p2.id, navDate: NAV_DATE }, { 'Idempotency-Key': key('p2') });
    const R2 = c2.body?.data;
    const ex = (t: string, d = R2) => d?.exceptions?.find((e: any) => e.type === t);
    check('P2 run created in EXCEPTIONS_OPEN with five exceptions', c2.status === 201 && R2?.status === 'EXCEPTIONS_OPEN' && R2.exceptions.length === 5, c2.body);
    check('NAV 12,500, market value 13,000, cash -500', R2?.nav === '12500.00' && R2?.marketValue === '13000.00' && R2?.cash === '-500.00', R2);
    check('price coverage 90.2778%', R2?.priceCoverage === '90.2778', R2?.priceCoverage);
    check('no units and no fund: NAV/unit empty, not required', R2?.fundId === null && R2?.navPerUnit === null && R2?.units === null);
    check('STALE_PRICE: priced 10 calendar days before (6-8 business days), not material', ex('STALE_PRICE')?.material === false && /\b[678] business days old/.test(ex('STALE_PRICE')?.detail ?? '') && ex('STALE_PRICE')?.ticker?.startsWith('NVST'), ex('STALE_PRICE'));
    check('MISSING_PRICE: material, reference is cost 1,000', ex('MISSING_PRICE')?.material === true && ex('MISSING_PRICE')?.referenceValue === '1000.00' && ex('MISSING_PRICE')?.currentValue === null, ex('MISSING_PRICE'));
    check('MISSING_FX: material, local value 400', ex('MISSING_FX')?.material === true && ex('MISSING_FX')?.referenceValue === '400.00', ex('MISSING_FX'));
    check('TOLERANCE: +20%, current 12,000 vs reference 10,000, difference 2,000, material', ex('TOLERANCE')?.currentValue === '12000.00' && ex('TOLERANCE')?.referenceValue === '10000.00' && ex('TOLERANCE')?.difference === '2000.00' && ex('TOLERANCE')?.material === true, ex('TOLERANCE'));
    check('NEGATIVE_CASH: material', ex('NEGATIVE_CASH')?.material === true && ex('NEGATIVE_CASH')?.currentValue === '-500.00', ex('NEGATIVE_CASH'));
    check('line flags mirror the exceptions', R2?.lines?.some((l: any) => l.flags.includes('STALE_PRICE')) && R2.lines.some((l: any) => l.flags.includes('MISSING_PRICE')) && R2.lines.some((l: any) => l.flags.includes('MISSING_FX')) && R2.lines.some((l: any) => l.flags.includes('TOLERANCE')), R2?.lines);
    const row = (await cPrep.get(`${N}/runs?portfolioId=${p2.id}`)).body?.data?.[0];
    check('list row: 5 open, 4 material', row?.openExceptions === 5 && row?.openMaterialExceptions === 4, row);

    const blocked = await cPrep.post(`${N}/runs/${R2.id}/maker-review`);
    check('maker review blocked while material exceptions are open -> 409', blocked.status === 409 && blocked.body?.error?.code === 'material_exceptions_open', blocked.body);
    check('allowed.makerReview is false and names the blocker', R2?.allowed?.makerReview === false && R2.allowed.makerReviewBlockers.length > 0, R2?.allowed);
    check('resolve without a rationale -> 400', (await cPrep.patch(`${N}/runs/${R2.id}/exceptions/${ex('MISSING_PRICE').id}`, {})).status === 400);
    check('resolve with a too-short rationale -> 400', (await cPrep.patch(`${N}/runs/${R2.id}/exceptions/${ex('MISSING_PRICE').id}`, { resolution: 'ok' })).status === 400);
    check('unknown exception -> 404', (await cPrep.patch(`${N}/runs/${R2.id}/exceptions/00000000-0000-4000-8000-000000000000`, { resolution: 'valid reason' })).status === 404);
    const res1 = await cPrep.patch(`${N}/runs/${R2.id}/exceptions/${ex('MISSING_PRICE').id}`, { resolution: 'Illiquid; carried at cost per valuation policy', evidenceRef: 'DOC-3001' });
    const resolved1 = ex('MISSING_PRICE', res1.body?.data);
    check('resolve stores rationale, evidence ref and the resolver', res1.status === 200 && resolved1?.status === 'RESOLVED' && resolved1.evidenceRef === 'DOC-3001' && resolved1.resolvedBy === prep.id && /carried at cost/.test(resolved1.resolution), res1.body);
    check('resolving twice -> 409 already_resolved', (await cPrep.patch(`${N}/runs/${R2.id}/exceptions/${ex('MISSING_PRICE').id}`, { resolution: 'again please' })).body?.error?.code === 'already_resolved');
    check('audit nav.exception_resolved carries the rationale', (await prisma.auditEvent.count({ where: { action: 'nav.exception_resolved', objectId: R2.id, actorId: prep.id, reason: { contains: 'carried at cost' } } })) === 1);

    const rc2 = await cPrep.post(`${N}/runs/${R2.id}/recalculate`);
    const R2b = rc2.body?.data;
    check('recalculation carries over the unchanged resolution (4 open, MISSING_PRICE resolved)', rc2.status === 201 && R2b?.version === 2 && ex('MISSING_PRICE', R2b)?.status === 'RESOLVED' && R2b.openExceptions === 4 && R2b.openMaterialExceptions === 3, R2b);
    for (const t of ['MISSING_FX', 'TOLERANCE', 'NEGATIVE_CASH']) {
      const r = await cPrep.patch(`${N}/runs/${R2b.id}/exceptions/${ex(t, R2b).id}`, { resolution: `Reviewed ${t}, accepted with support` });
      check(`resolve ${t}`, r.status === 200, r.body);
    }
    const afterRes = (await cPrep.get(`${N}/runs/${R2b.id}`)).body.data;
    check('only the non-material STALE_PRICE is left open (still EXCEPTIONS_OPEN)', afterRes.status === 'EXCEPTIONS_OPEN' && afterRes.openExceptions === 1 && afterRes.openMaterialExceptions === 0, afterRes);

    // ---------------------------------------------------------------- maker review and release (portfolio-only run)
    console.log('\nMaker review and release (P2, no fund)');
    const mr = await cPrep.post(`${N}/runs/${R2b.id}/maker-review`);
    check('maker review passes with only a non-material exception open', mr.status === 200 && mr.body.data.status === 'MAKER_REVIEWED' && mr.body.data.reviewerId === prep.id && mr.body.data.stage === 'RELEASE', mr.body);
    check('audit nav.maker_reviewed', (await auditCount('nav.maker_reviewed', R2b.id, prep.id)) === 1);
    const notif = await prisma.outboxEvent.findMany({ where: { type: 'notify.permission' }, orderBy: { createdAt: 'desc' }, take: 20 });
    check('outbox: users holding valuation.release are notified, linking to the run', notif.some((n) => (n.payload as any)?.permission === 'valuation.release' && String((n.payload as any)?.link).includes(R2b.id)), notif.map((n) => n.payload));
    check('edit after maker review -> 409 run_not_editable', (await cPrep.patch(`${N}/runs/${R2b.id}/inputs`, { accruals: 1 })).body?.error?.code === 'run_not_editable');
    check('resolve after maker review -> 409 run_not_editable', (await cPrep.patch(`${N}/runs/${R2b.id}/exceptions/${ex('STALE_PRICE', R2b).id}`, { resolution: 'late change' })).body?.error?.code === 'run_not_editable');
    check('maker review twice -> 409 invalid_state', (await cPrep.post(`${N}/runs/${R2b.id}/maker-review`)).body?.error?.code === 'invalid_state');

    const detailRel = (await cRel.get(`${N}/runs/${R2b.id}`)).body.data;
    const detailPrep = (await cPrep.get(`${N}/runs/${R2b.id}`)).body.data;
    const detailPm = (await cPm.get(`${N}/runs/${R2b.id}`)).body.data;
    check('allowed.release: yes for another release holder, no for the maker reviewer, no without the permission', detailRel.allowed.release === true && detailPrep.allowed.release === false && detailPm.allowed.release === false && !!detailPrep.allowed.releaseBlocker, [detailRel.allowed, detailPrep.allowed, detailPm.allowed]);

    check('release without valuation.release (PM) -> 403 permission_denied', (await cPm.post(`${N}/runs/${R2b.id}/release`)).body?.error?.code === 'permission_denied');
    const sysRel = await cSys.post(`${N}/runs/${R2b.id}/release`);
    check('system admin cannot release -> 403 permission_denied', sysRel.status === 403 && sysRel.body?.error?.code === 'permission_denied', sysRel.body);
    check('release by the maker reviewer, even with step-up -> 403 segregation_of_duties', (await cPrep.stepUp()).status === 200 && (await cPrep.post(`${N}/runs/${R2b.id}/release`)).body?.error?.code === 'segregation_of_duties');
    await prisma.session.updateMany({ where: { userId: rel.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    const noStep = await cRel.post(`${N}/runs/${R2b.id}/release`);
    check('release with a stale MFA -> 401 step_up_required', noStep.status === 401 && noStep.body?.error?.code === 'step_up_required', noStep.body);
    check('run is still MAKER_REVIEWED after the refusals', (await prisma.navRun.findUniqueOrThrow({ where: { id: R2b.id } })).status === 'MAKER_REVIEWED');
    check('releaser steps up', (await cRel.stepUp()).status === 200);
    const rl = await cRel.post(`${N}/runs/${R2b.id}/release`);
    check('a different user with step-up releases -> RELEASED, checker set', rl.status === 200 && rl.body.data.status === 'RELEASED' && rl.body.data.checkerId === rel.id && !!rl.body.data.releasedAt && rl.body.data.stage === 'DONE', rl.body);
    check('audit nav.released by the releaser, with the reviewer recorded', (await prisma.auditEvent.count({ where: { action: 'nav.released', objectId: R2b.id, actorId: rel.id } })) === 1);
    check('a portfolio-only release has no fund update', rl.body.data.fundUpdate === null && (await prisma.fund.findUniqueOrThrow({ where: { id: fund.id } })).navPerUnit?.toFixed(4) === '9.0000');

    console.log('\nReleased runs are immutable');
    check('PATCH inputs -> 409 run_immutable', (await cPrep.patch(`${N}/runs/${R2b.id}/inputs`, { accruals: 5 })).body?.error?.code === 'run_immutable');
    check('resolve an exception -> 409 run_immutable', (await cPrep.patch(`${N}/runs/${R2b.id}/exceptions/${ex('STALE_PRICE', R2b).id}`, { resolution: 'too late now' })).body?.error?.code === 'run_immutable');
    check('recalculate -> 409 run_immutable', (await cPrep.post(`${N}/runs/${R2b.id}/recalculate`)).body?.error?.code === 'run_immutable');
    check('maker review -> 409 run_immutable', (await cPrep.post(`${N}/runs/${R2b.id}/maker-review`)).body?.error?.code === 'run_immutable');
    await cRel.stepUp();
    check('release again -> 409 run_immutable', (await cRel.post(`${N}/runs/${R2b.id}/release`)).body?.error?.code === 'run_immutable');
    const frozen = await prisma.navRun.findUniqueOrThrow({ where: { id: R2b.id } });
    check('stored figures did not change', frozen.nav.toFixed(2) === '12500.00' && frozen.status === 'RELEASED');

    console.log('\nA later version supersedes the released one');
    const c2v3 = await cPrep.post(`${N}/runs`, { portfolioId: p2.id, navDate: NAV_DATE, accruals: 100 }, { 'Idempotency-Key': key('p2v3') });
    const R2c = c2v3.body?.data;
    check('new version 3 is a draft with the resolutions carried and the released v2 untouched', c2v3.status === 201 && R2c?.version === 3 && R2c.status === 'EXCEPTIONS_OPEN' && R2c.openMaterialExceptions === 0 && R2c.accruals === '100.00' && R2c.nav === '12600.00' && (await prisma.navRun.findUniqueOrThrow({ where: { id: R2b.id } })).status === 'RELEASED', c2v3.body);
    await cPrep.post(`${N}/runs/${R2c.id}/maker-review`);
    await cRel.stepUp();
    const rl3 = await cRel.post(`${N}/runs/${R2c.id}/release`);
    check('releasing v3 supersedes the previously released v2', rl3.status === 200 && rl3.body.data.status === 'RELEASED' && (await prisma.navRun.findUniqueOrThrow({ where: { id: R2b.id } })).status === 'SUPERSEDED', rl3.body);
    check('exactly one RELEASED version for the portfolio and date', (await prisma.navRun.count({ where: { portfolioId: p2.id, navDate: day(NAV_DATE), status: 'RELEASED' } })) === 1);
    check('audit records the supersede of the released version', (await auditCount('nav.run_superseded', R2b.id)) >= 1);

    // ---------------------------------------------------------------- fund and LP portal
    console.log('\nFund update and the LP portal (P1 -> fund)');
    const sessionBefore = await cLp.get('/api/v1/lp-portal/session');
    const fundOf = (b: any) => (b?.data ?? b)?.funds?.find((f: any) => f.fundId === fund.id);
    check('LP session before release: PROVISIONAL, as of 2026-06-30', fundOf(sessionBefore.body)?.valuationStatus === 'PROVISIONAL' && fundOf(sessionBefore.body)?.asOfDate === '2026-06-30', sessionBefore.body);
    const dashBefore = await cLp.get(`/api/v1/lp-portal/dashboard?fundId=${fund.id}`);
    const oeBefore = (dashBefore.body?.data ?? dashBefore.body)?.openEndedSummary;
    check('LP dashboard before release: NAV per unit 9', num(oeBefore?.navPerUnit) === 9, dashBefore.body);

    const mrP1 = await cPrep.post(`${N}/runs/${R1c.id}/maker-review`);
    check('P1 version 3 passes maker review (no exceptions)', mrP1.status === 200 && mrP1.body.data.status === 'MAKER_REVIEWED', mrP1.body);
    await cRel.stepUp();
    const rlP1 = await cRel.post(`${N}/runs/${R1c.id}/release`);
    check('release P1', rlP1.status === 200 && rlP1.body.data.status === 'RELEASED' && rlP1.body.data.fundUpdate?.navPerUnit === '10.0100', rlP1.body);
    const fundAfter = await prisma.fund.findUniqueOrThrow({ where: { id: fund.id } });
    check('fund row: NAV per unit 10.0100, total NAV 25,025, as-of 2026-09-30, FINAL', fundAfter.navPerUnit?.toFixed(4) === '10.0100' && fundAfter.totalNav?.toFixed(2) === '25025.00' && fundAfter.asOfDate?.toISOString().slice(0, 10) === NAV_DATE && fundAfter.valuationStatus === 'FINAL', fundAfter);
    const hist = (fundAfter.dealingRulesJson as any)?.navHistory;
    check('NAV history point stored on the fund', Array.isArray(hist) && hist.some((h: any) => h.date === NAV_DATE && h.navPerUnit === '10.0100'), hist);
    const holding = await prisma.lpHolding.findFirstOrThrow({ where: { fundId: fund.id, clientId: lpClient.id } });
    check('LP holding revalued: 100 units x 10.0100 = 1,001', holding.navPerUnit.toFixed(4) === '10.0100' && holding.accountValue.toFixed(2) === '1001.00' && holding.valuationStatus === 'FINAL', holding);
    const sessionAfter = await cLp.get('/api/v1/lp-portal/session');
    check('LP session after release: FINAL, as of 2026-09-30', fundOf(sessionAfter.body)?.valuationStatus === 'FINAL' && fundOf(sessionAfter.body)?.asOfDate === NAV_DATE, sessionAfter.body);
    const dashAfter = await cLp.get(`/api/v1/lp-portal/dashboard?fundId=${fund.id}`);
    const oeAfter = (dashAfter.body?.data ?? dashAfter.body)?.openEndedSummary;
    check('LP dashboard after release: NAV per unit 10.01 and account value 1,001', num(oeAfter?.navPerUnit) === 10.01 && num(oeAfter?.accountValue) === 1001, dashAfter.body);
    check('audit nav.released records the fund before and after', (await prisma.auditEvent.count({ where: { action: 'nav.released', objectId: R1c.id, actorId: rel.id } })) === 1 && JSON.stringify((await prisma.auditEvent.findFirstOrThrow({ where: { action: 'nav.released', objectId: R1c.id } })).after).includes('"fundBefore"'));

    // an older NAV date must not roll the fund back
    const old1 = await cPrep.post(`${N}/runs`, { portfolioId: p1.id, navDate: '2026-09-15', units: 2500 }, { 'Idempotency-Key': key('old') });
    await cPrep.post(`${N}/runs/${old1.body.data.id}/maker-review`);
    await cRel.stepUp();
    const oldRel = await cRel.post(`${N}/runs/${old1.body.data.id}/release`);
    const fundKept = await prisma.fund.findUniqueOrThrow({ where: { id: fund.id } });
    check('releasing an older NAV date leaves the fund NAV and as-of date alone (history only)', oldRel.status === 200 && fundKept.asOfDate?.toISOString().slice(0, 10) === NAV_DATE && fundKept.navPerUnit?.toFixed(4) === '10.0100' && (fundKept.dealingRulesJson as any).navHistory.length >= 2, oldRel.body);

    // ---------------------------------------------------------------- list, pack, detail
    console.log('\nList, filters and pack');
    const all = await cPrep.get(`${N}/runs?portfolioId=${p1.id}`);
    check('list by portfolio returns that portfolio only, newest date first', all.status === 200 && all.body.data.length >= 4 && all.body.data.every((r: any) => r.portfolioId === p1.id) && all.body.data[0].navDate >= all.body.data.at(-1).navDate, all.body);
    const byRef = await cPrep.get(`${N}/runs?portfolioId=${p1.ref}`);
    check('portfolio filter accepts the ref', byRef.status === 200 && byRef.body.total === all.body.total, byRef.body);
    const rel1 = await cPrep.get(`${N}/runs?portfolioId=${p1.id}&status=RELEASED`);
    check('status filter', rel1.body.data.length === 2 && rel1.body.data.every((r: any) => r.status === 'RELEASED') && rel1.body.summary.released === 2, rel1.body);
    check('multi-status filter and summary', (await cPrep.get(`${N}/runs?portfolioId=${p1.id}&status=RELEASED,SUPERSEDED`)).body.total === all.body.total);
    check('date filter', (await cPrep.get(`${N}/runs?portfolioId=${p1.id}&from=${NAV_DATE}&to=${NAV_DATE}`)).body.data.every((r: any) => r.navDate === NAV_DATE));
    check('bad date filter -> 400', (await cPrep.get(`${N}/runs?from=yesterday`)).status === 400);
    check('get by ref works', (await cPrep.get(`${N}/runs/${R1c.ref}`)).body?.data?.id === R1c.id);
    check('unknown run -> 404', (await cPrep.get(`${N}/runs/NAV-99999`)).status === 404);
    const pack = await cPrep.get(`${N}/runs/${R1c.id}/pack`);
    const pk = pack.body?.data;
    check('pack: KPIs, bridge, approvals, fund impact', pack.status === 200 && pk.kpis.nav === '25025.00' && pk.kpis.navPerUnit === '10.0100' && pk.bridge.length === 6 && pk.approvals.preparedBy === 'NV prep' && pk.approvals.reviewedBy === 'NV prep' && pk.approvals.releasedBy === 'NV rel' && pk.fund?.ref === fund.ref && pk.draft === false && pk.topPositions.length === 2, pack.body);
    check('pack is permission-gated', (await cNo.get(`${N}/runs/${R1c.id}/pack`)).status === 403);

    // ---------------------------------------------------------------- audit
    console.log('\nAudit');
    for (const a of ['nav.run_created', 'nav.run_recalculated', 'nav.run_superseded', 'nav.inputs_updated', 'nav.exception_resolved', 'nav.maker_reviewed', 'nav.released']) {
      check(`audit event ${a} exists`, (await prisma.auditEvent.count({ where: { action: a, actorId: { in: [prep.id, rel.id] } } })) > 0);
    }
  } finally {
    // best-effort cleanup (disposable database)
    try {
      await prisma.navRun.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.fund.deleteMany({ where: { id: { in: fundIds } } });
      await prisma.portfolioPosition.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.portfolioCash.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.securityPrice.deleteMany({ where: { securityId: { in: securityIds } } });
      await prisma.security.deleteMany({ where: { id: { in: securityIds } } });
      await prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
      await prisma.clientUser.deleteMany({ where: { clientId: { in: clientIds } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
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
