/**
 * Research & IC, Private Markets, Portfolio Construction and Collateral & Financing checks against a RUNNING API:
 * engine maths (IRR / TVPI / DPI, IC tally, rebalance sizing, haircut and margin), permissions, maker-checker and
 * step-up on every approval, case publish, IC vote and ratification (quorum, proposer cannot ratify), approved
 * decision -> draft order link, capital calls capped by the commitment, NAV marks needing evidence and a second
 * approver, model activation by a second person, what-if and saved rebalances producing draft orders with checks,
 * facility approval, draw limits and collateral, margin call lifecycle, idempotency and audit.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-research-privates.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API
 * against the same DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP enrolment). Creates throwaway users, a security,
 * a portfolio and a model with a random run id (best-effort removal at the end); disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { icOutcome, tally, upsidePct } from '../src/modules/research/research.engine';
import { callProblem, markMovePct, performance, xirr } from '../src/modules/private-markets/pm.engine';
import { checkConstraints, modelProblems, proposeRebalance } from '../src/modules/portfolio-lab/lab.engine';
import { margin, pickRule, termsProblems, valuePool } from '../src/modules/financing/fin.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Rp-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `rp-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const td = dayStr(0);

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
    patch: (p: string, b?: unknown, h?: Record<string, string>) => send('PATCH', p, b ?? {}, h),
    put: (p: string, b?: unknown, h?: Record<string, string>) => send('PUT', p, b ?? {}, h),
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

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `rp-${run}-${label}@example.test`, name: `RP ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    const r = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: roleKey } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });
    return u;
  };
  const dir = await mkUser('dir', 'investment_director'); // IC checker, orders.create, mark approve, financing.*
  const pm = await mkUser('pm', 'portfolio_manager'); // research.edit + ic.decide, portfolio.manage, financing.manage
  const an = await mkUser('an', 'analyst'); // research.edit only
  const comp = await mkUser('comp', 'compliance'); // financing.manage + approve
  const ops = await mkUser('ops', 'operations'); // portfolio.manage, financing.manage
  const fa = await mkUser('fa', 'fund_accountant'); // private.mark.approve
  const aud = await mkUser('aud', 'auditor'); // views only
  const [cDir, cPm, cAn, cComp, cOps, cFa, cAud] = [client(), client(), client(), client(), client(), client(), client()];
  const anon = client();
  const SEC_CLASS = `Test${run}`;

  const sec1 = await prisma.security.create({ data: { ticker: `T1${run}.VX`.toUpperCase(), name: `Test One ${run}`, market: 'VFEX', assetClass: SEC_CLASS, currency: 'USD', boardLot: 1, sector: 'Materials', status: 'Active' } });
  const sec2 = await prisma.security.create({ data: { ticker: `T2${run}.VX`.toUpperCase(), name: `Test Two ${run}`, market: 'VFEX', assetClass: SEC_CLASS, currency: 'USD', boardLot: 1, sector: 'Financials', status: 'Active' } });
  for (const s of [sec1, sec2]) await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: new Date(`${td}T00:00:00Z`), price: D('10'), source: 'MANUAL' } });
  const pf = await prisma.portfolio.create({ data: { ref: `RPF-${run}`, name: `RP Entity ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: { maxSingleNamePct: 60, maxSectorPct: 80, cashFloorPct: 1 } } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf.id, securityId: sec1.id, quantity: D('100000'), avgCost: D('8'), asOf: new Date(`${td}T00:00:00Z`) } });
  await prisma.portfolioCash.create({ data: { portfolioId: pf.id, currency: 'USD', available: D('200000'), asOf: new Date(`${td}T00:00:00Z`) } });
  const auditCount = (action: string, objectId?: string, actorId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}), ...(actorId ? { actorId } : {}) } });
  const created = { cases: [] as string[], funds: [] as string[], models: [] as string[], facilities: [] as string[], pools: [] as string[] };

  try {
    console.log('\nEngines (pure)');
    check('IRR of -100 then +121 two years later is 10%', Math.abs((xirr([{ date: new Date('2024-01-01'), amount: -100 }, { date: new Date('2026-01-01'), amount: 121 }]) ?? 0) - 0.1) < 0.002);
    check('IRR is undefined without an inflow', xirr([{ date: new Date('2024-01-01'), amount: -100 }]) === null);
    const pf1 = performance(D(1000), [{ kind: 'CALL', amount: D(400), date: new Date('2024-01-01'), status: 'PAID' }, { kind: 'DISTRIBUTION', amount: D(100), date: new Date('2025-01-01'), status: 'PAID' }, { kind: 'CALL', amount: D(100), date: new Date('2026-12-01'), status: 'NOTICED' }], { nav: D(500), asOf: new Date('2026-01-01') });
    check('DPI 0.25, RVPI 1.25, TVPI 1.50, unfunded 500 after a noticed call', pf1.dpi!.toFixed(2) === '0.25' && pf1.rvpi!.toFixed(2) === '1.25' && pf1.tvpi!.toFixed(2) === '1.50' && pf1.unfunded.toFixed(0) === '500' && pf1.calledUnpaid.toFixed(0) === '100', pf1);
    check('a call over the unfunded commitment is refused', callProblem(D(1000), D(900), D(101)) !== null && callProblem(D(1000), D(900), D(100)) === null);
    check('mark move percent', markMovePct(D(100), D(140))!.toFixed(1) === '40.0' && markMovePct(null, D(1)) === null);
    check('IC: quorum, majority and tie', icOutcome(tally([{ vote: 'FOR' }, { vote: 'FOR' }, { vote: 'AGAINST' }]), 3).outcome === 'APPROVED' && icOutcome(tally([{ vote: 'FOR' }, { vote: 'AGAINST' }, { vote: 'ABSTAIN' }]), 3).outcome === 'REJECTED' && icOutcome(tally([{ vote: 'FOR' }]), 3).outcome === 'NO_QUORUM');
    check('upside against price', upsidePct(D(12), D(10))!.toFixed(1) === '20.0');
    check('model over 100% refused; active must total 100%', modelProblems([{ securityId: 'a', targetPct: D(60) }, { securityId: 'b', targetPct: D(50) }], D(0), false).length === 1 && modelProblems([{ securityId: 'a', targetPct: D(60) }], D(10), true).length === 1 && modelProblems([{ securityId: 'a', targetPct: D(90) }], D(10), true).length === 0);
    const h = (id: string, qty: number, lot = 1) => ({ securityId: id, ticker: id, sector: 'S', assetClass: 'Equity', market: 'VFEX', currency: 'USD', boardLot: lot, quantity: D(qty), price: D(10), fx: D(1) });
    const rb = proposeRebalance({ holdings: [h('a', 1000), h('b', 0)], targets: new Map([['a', D(30)], ['b', D(40)]]), cashBase: D(10000), cashTargetPct: D(10), driftThresholdPct: D('0.5') });
    check('rebalance: total 20,000; sell 400 of A (to 30%) and buy 800 of B (to 40%)', rb.totalValueBase.toFixed(0) === '20000' && rb.lines.length === 2 && rb.lines.find((l) => l.ticker === 'a')!.side === 'SELL' && rb.lines.find((l) => l.ticker === 'a')!.quantity.toFixed(0) === '400' && rb.lines.find((l) => l.ticker === 'b')!.quantity.toFixed(0) === '800', rb.lines);
    check('rebalance respects board lots and the cash reserve', (() => { const r = proposeRebalance({ holdings: [h('a', 0, 100)], targets: new Map([['a', D(95)]]), cashBase: D(10000), cashTargetPct: D(10), driftThresholdPct: D(1) }); return r.lines[0]!.quantity.mod(100).isZero() && r.cashAfterPct.gte(10); })());
    check('a full exit sells everything held', proposeRebalance({ holdings: [h('a', 777), h('b', 100)], targets: new Map([['b', D(10)]]), cashBase: D(1000), cashTargetPct: D(0), driftThresholdPct: D(50) }).lines.find((l) => l.ticker === 'a')!.quantity.toFixed(0) === '777');
    check('mandate constraints: single name over limit fails, restricted buy fails', checkConstraints({ maxSingleNamePct: 30, restrictedTickers: ['X'] }, [{ securityId: 'a', ticker: 'a', sector: 'S', market: 'VFEX', assetClass: 'Equity', pct: D(40) }], D(5), ['X']).filter((c) => c.state === 'Fail').length === 2);
    const rules = [{ assetClass: 'Equity', market: 'VFEX', eligible: true, haircutPct: D(25), maxPoolPct: null }, { assetClass: 'Equity', market: '', eligible: true, haircutPct: D(40), maxPoolPct: null }, { assetClass: 'Private', market: '', eligible: false, haircutPct: D(100), maxPoolPct: null }];
    check('most specific haircut rule wins', pickRule(rules, 'Equity', 'VFEX')!.haircutPct.toFixed(0) === '25' && pickRule(rules, 'Equity', 'ZSE')!.haircutPct.toFixed(0) === '40');
    const vp = valuePool([{ itemId: '1', securityId: 'a', ticker: 'a', assetClass: 'Equity', market: 'VFEX', quantity: D(1), marketValue: D(1000) }, { itemId: '2', securityId: 'b', ticker: 'b', assetClass: 'Private', market: 'OTC', quantity: D(1), marketValue: D(500) }, { itemId: '3', securityId: 'c', ticker: 'c', assetClass: 'Equity', market: 'VFEX', quantity: D(1), marketValue: null }], rules);
    check('collateral: 1,000 at 25% haircut counts 750; private and unpriced count zero', vp.counted.toFixed(0) === '750' && vp.ineligible.toFixed(0) === '500' && vp.warnings.length === 1, vp);
    const capped = valuePool([{ itemId: '1', securityId: 'a', ticker: 'a', assetClass: 'Equity', market: 'VFEX', quantity: D(1), marketValue: D(1000) }, { itemId: '2', securityId: 'b', ticker: 'b', assetClass: 'Fund', market: '', quantity: D(1), marketValue: D(1000) }], [{ assetClass: 'Equity', market: 'VFEX', eligible: true, haircutPct: D(0), maxPoolPct: D(25) }, { assetClass: 'Fund', market: '', eligible: true, haircutPct: D(0), maxPoolPct: null }]);
    check('a pool cap limits a group to its share', capped.counted.lt(2000) && capped.lines[0]!.capped, capped);
    const terms = { limitAmount: D(1000), initialRatio: D('1.5'), maintenanceRatio: D('1.25') };
    const mg = margin(terms, D(100), D(110));
    check('margin: coverage 1.10 below 1.25 is a deficit; call restores 1.5x (40)', mg.state === 'DEFICIT' && mg.callAmount.toFixed(0) === '40' && margin(terms, D(100), D(200)).state === 'OK' && margin(terms, D(0), D(0)).state === 'NO_DRAWINGS');
    check('terms: initial below maintenance and maintenance below 1 are refused', termsProblems({ limitAmount: D(1), initialRatio: D('1.1'), maintenanceRatio: D('1.2') }).length === 1 && termsProblems({ limitAmount: D(1), initialRatio: D('1.1'), maintenanceRatio: D('0.9') }).length >= 1);

    console.log('\nSign-in and permissions');
    for (const [c, u] of [[cDir, dir], [cPm, pm], [cAn, an], [cComp, comp], [cOps, ops], [cFa, fa], [cAud, aud]] as const) check(`${u.email.split('@')[0]!.replace(`rp-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    for (const [n, c] of [['dir', cDir], ['pm', cPm], ['comp', cComp], ['ops', cOps], ['fa', cFa]] as const) check(`${n} enrols MFA`, await c.enrolMfa());
    for (const path of ['/research/summary', '/private-markets/summary', '/portfolio-lab/models', '/financing/summary']) check(`GET ${path} without a session -> 401`, (await anon.get(`/api/v1${path}`)).status === 401);
    check('auditor reads research, private markets, models and financing', (await Promise.all(['/research/cases', '/private-markets/funds', '/portfolio-lab/models', '/financing/facilities'].map((p) => cAud.get(`/api/v1${p}`)))).every((r) => r.status === 200));

    console.log('\nResearch cases');
    const R = '/api/v1/research';
    const caseBody = { securityId: sec1.ticker, title: `Test thesis ${run}`, thesis: 'A sufficiently long thesis paragraph for the test case.', rating: 'BUY', targetPrice: '13.50', horizonMonths: 12, conviction: 4 };
    check('an auditor cannot create a case -> 403', (await cAud.post(`${R}/cases`, caseBody, { 'Idempotency-Key': key('c0') })).status === 403);
    check('create without Idempotency-Key -> 400', (await cAn.post(`${R}/cases`, caseBody)).status === 400);
    const kc = key('c1');
    const c1 = await cAn.post(`${R}/cases`, caseBody, { 'Idempotency-Key': kc });
    const CASE = c1.body?.data;
    if (CASE) created.cases.push(CASE.id);
    check('create -> 201 RSC-#### DRAFT with 35% upside', c1.status === 201 && CASE?.status === 'DRAFT' && /^RSC-\d{4}$/.test(CASE.ref) && CASE.upsidePct === '35.0', c1.body);
    check('same key replays; a different body -> 409', (await cAn.post(`${R}/cases`, caseBody, { 'Idempotency-Key': kc })).body?.data?.id === CASE.id && (await cAn.post(`${R}/cases`, { ...caseBody, title: 'Other title' }, { 'Idempotency-Key': kc })).status === 409);
    check('a bad rating -> 400', (await cAn.post(`${R}/cases`, { ...caseBody, rating: 'MOON' }, { 'Idempotency-Key': key('c2') })).status === 400);
    check('another user cannot edit or submit the draft', (await cPm.patch(`${R}/cases/${CASE.id}`, { conviction: 2 })).body?.error?.code === 'not_maker' && (await cPm.post(`${R}/cases/${CASE.id}/submit`)).status === 403);
    check('author edits the draft', (await cAn.patch(`${R}/cases/${CASE.id}`, { targetPrice: '14.00' })).body?.data?.targetPrice === '14.000000');
    check('the author cannot publish (no ic.decide) -> 403', (await cAn.post(`${R}/cases/${CASE.id}/publish`)).status === 403);
    check('publishing a DRAFT -> 409', (await cPm.post(`${R}/cases/${CASE.id}/publish`)).body?.error?.code === 'invalid_state');
    check('submit -> IN_REVIEW', (await cAn.post(`${R}/cases/${CASE.id}/submit`)).body?.data?.status === 'IN_REVIEW');
    check('return needs a reason -> 400; with one the case is a draft again', (await cPm.post(`${R}/cases/${CASE.id}/return`, {})).status === 400 && (await cPm.post(`${R}/cases/${CASE.id}/return`, { reason: 'Add the valuation bridge' })).body?.data?.returnReason === 'Add the valuation bridge');
    await cAn.post(`${R}/cases/${CASE.id}/submit`);
    const pub = await cPm.post(`${R}/cases/${CASE.id}/publish`);
    check('a different reviewer publishes -> PUBLISHED with a rating history row', pub.status === 200 && pub.body.data.status === 'PUBLISHED' && pub.body.data.history.length === 1, pub.body);
    check('audit research.case_published by the reviewer', (await auditCount('research.case_published', CASE.id, pm.id)) === 1);
    // author == reviewer is refused
    const own = (await cPm.post(`${R}/cases`, { ...caseBody, title: `PM own case ${run}` }, { 'Idempotency-Key': key('own') })).body.data;
    created.cases.push(own.id);
    await cPm.post(`${R}/cases/${own.id}/submit`);
    check('an IC reviewer cannot publish their own case (sod_violation)', (await cPm.post(`${R}/cases/${own.id}/publish`)).body?.error?.code === 'sod_violation');
    check('a published case cannot be edited (409)', (await cAn.patch(`${R}/cases/${CASE.id}`, { conviction: 1 })).body?.error?.code === 'invalid_state');

    console.log('\nIC meeting, decision, votes');
    const mk = await cPm.post(`${R}/meetings`, { title: `IC ${run}`, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), quorum: 3 }, { 'Idempotency-Key': key('m1') });
    const MEET = mk.body?.data;
    check('meeting created ICM-#### with quorum 3', mk.status === 201 && /^ICM-\d{4}$/.test(MEET?.ref) && MEET.quorum === 3, mk.body);
    check('an unpublished case cannot go to the committee', (await cPm.post(`${R}/decisions`, { caseId: own.id, action: 'HOLD', rationale: 'Premature proposal' }, { 'Idempotency-Key': key('d0') })).body?.error?.code === 'invalid_state');
    check('a BUY without a quantity -> 400', (await cPm.post(`${R}/decisions`, { caseId: CASE.id, action: 'BUY', rationale: 'No quantity given here' }, { 'Idempotency-Key': key('d00') })).status === 400);
    const dBody = { caseId: CASE.id, meetingId: MEET.id, portfolioId: pf.id, action: 'BUY', quantity: '5000', rationale: 'Add on the published BUY rating.' };
    const dc = await cPm.post(`${R}/decisions`, dBody, { 'Idempotency-Key': key('d1') });
    const DEC = dc.body?.data;
    check('decision created ICD-#### PROPOSED', dc.status === 201 && DEC?.status === 'PROPOSED' && /^ICD-\d{4}$/.test(DEC.ref) && DEC.proposerId === pm.id, dc.body);
    check('voting before it opens -> 409', (await cAn.post(`${R}/decisions/${DEC.id}/vote`, { vote: 'FOR' })).body?.error?.code === 'invalid_state');
    check('only the proposer opens voting', (await cAn.post(`${R}/decisions/${DEC.id}/open-voting`)).status === 403 && (await cPm.post(`${R}/decisions/${DEC.id}/open-voting`)).body?.data?.status === 'VOTING');
    check('an auditor cannot vote -> 403', (await cAud.post(`${R}/decisions/${DEC.id}/vote`, { vote: 'FOR' })).status === 403);
    await cPm.post(`${R}/decisions/${DEC.id}/vote`, { vote: 'FOR', comment: 'Proposer supports it' });
    await cStepUp(cDir);
    const early = await cDir.post(`${R}/decisions/${DEC.id}/ratify`, {});
    check('ratify without quorum -> 409 no_quorum', early.body?.error?.code === 'no_quorum', early.body);
    await cAn.post(`${R}/decisions/${DEC.id}/vote`, { vote: 'FOR' });
    const chg = await cAn.post(`${R}/decisions/${DEC.id}/vote`, { vote: 'ABSTAIN' });
    check('a voter can change their vote; one vote each', chg.body?.data?.votes.length === 2 && chg.body.data.myVote === 'ABSTAIN');
    await cDir.post(`${R}/decisions/${DEC.id}/vote`, { vote: 'FOR' });
    await cStepUp(cPm);
    const self = await cPm.post(`${R}/decisions/${DEC.id}/ratify`, {});
    check('the proposer cannot ratify -> 403 sod_violation', self.status === 403 && self.body?.error?.code === 'sod_violation', self.body);
    check('ratify requires the ic.decide permission', (await cAn.post(`${R}/decisions/${DEC.id}/ratify`, {})).status === 403);
    const rat = await cDir.post(`${R}/decisions/${DEC.id}/ratify`, { note: 'Carried 2-0 with one abstention' });
    check('a different checker ratifies -> APPROVED with the tally', rat.status === 200 && rat.body.data.status === 'APPROVED' && rat.body.data.tally.for === 2 && rat.body.data.tally.abstain === 1, rat.body);
    check('audit research.decision_ratified by the checker', (await auditCount('research.decision_ratified', DEC.id, dir.id)) === 1);
    check('voting after ratification -> 409', (await cAn.post(`${R}/decisions/${DEC.id}/vote`, { vote: 'FOR' })).body?.error?.code === 'invalid_state');
    check('creating the order needs orders.create (analyst -> 403)', (await cAn.post(`${R}/decisions/${DEC.id}/orders`, {}, { 'Idempotency-Key': key('o0') })).status === 403);
    const ord = await cDir.post(`${R}/decisions/${DEC.id}/orders`, {}, { 'Idempotency-Key': key('o1') });
    check('approved decision -> a DRAFT order for 5,000 linked back to it', ord.status === 201 && /^ORD-/.test(ord.body?.data?.orderRef) && ord.body.data.decision.orders.length === 1, ord.body);
    const orow = await prisma.order.findUnique({ where: { id: ord.body.data.orderId } });
    check('the order is Draft, a BUY of 5,000 at the latest price, made by the requester', orow?.status === 'Draft' && orow.side === 'BUY' && orow.quantity.toFixed(0) === '5000' && orow.makerId === dir.id && orow.decisionPrice.toFixed(2) === '10.00');
    check('a second live order for the same portfolio -> 409 order_exists', (await cDir.post(`${R}/decisions/${DEC.id}/orders`, {}, { 'Idempotency-Key': key('o2') })).body?.error?.code === 'order_exists');
    check('the order links back to its decision', (await cAud.get(`${R}/orders/${ord.body.data.orderId}/decision`)).body?.data?.ref === DEC.ref);
    // rejection path: tie
    const d2 = (await cPm.post(`${R}/decisions`, { caseId: CASE.id, action: 'HOLD', rationale: 'Stay at the current weight.' }, { 'Idempotency-Key': key('d2') })).body.data;
    await cPm.post(`${R}/decisions/${d2.id}/open-voting`);
    await cAn.post(`${R}/decisions/${d2.id}/vote`, { vote: 'FOR' });
    await cDir.post(`${R}/decisions/${d2.id}/vote`, { vote: 'AGAINST' });
    await cPm.post(`${R}/decisions/${d2.id}/vote`, { vote: 'ABSTAIN' });
    const rej = await cDir.post(`${R}/decisions/${d2.id}/ratify`, {});
    check('a tie is ratified as REJECTED', rej.body?.data?.status === 'REJECTED', rej.body);
    check('a rejected decision cannot create orders', (await cDir.post(`${R}/decisions/${d2.id}/orders`, {}, { 'Idempotency-Key': key('o3') })).body?.error?.code === 'invalid_state');
    const d3 = (await cPm.post(`${R}/decisions`, { caseId: CASE.id, action: 'HOLD', rationale: 'Second hold proposal for withdraw.' }, { 'Idempotency-Key': key('d3') })).body.data;
    check('only the proposer withdraws; needs a reason', (await cAn.post(`${R}/decisions/${d3.id}/withdraw`, { reason: 'Not my proposal' })).status === 403 && (await cPm.post(`${R}/decisions/${d3.id}/withdraw`, { reason: 'Superseded by the new case' })).body?.data?.status === 'WITHDRAWN');
    check('meeting summary lists its decisions', (await cAud.get(`${R}/meetings/${MEET.id}`)).body?.data?.decisionList?.length === 1);

    console.log('\nPrivate markets');
    const P = '/api/v1/private-markets';
    check('the company hub routes still answer (GET /companies)', [200, 403].includes((await cAud.get(`${P}/companies`)).status));
    check('an auditor cannot create a fund -> 403', (await cAud.post(`${P}/funds`, {}, { 'Idempotency-Key': key('f0') })).status === 403);
    const fund = await cOps.post(`${P}/funds`, { name: `Test PE Fund ${run}`, manager: 'Test GP', strategy: 'PRIVATE_EQUITY', vintage: 2024 }, { 'Idempotency-Key': key('f1') });
    const FUND = fund.body?.data;
    if (FUND) created.funds.push(FUND.id);
    check('fund created PMF-####', fund.status === 201 && /^PMF-\d{4}$/.test(FUND?.ref), fund.body);
    const cm = await cOps.post(`${P}/funds/${FUND.id}/commitments`, { portfolioId: pf.id, amount: '1000000', committedOn: dayStr(-400) }, { 'Idempotency-Key': key('cm1') });
    const COM = cm.body?.data;
    check('commitment of 1,000,000 created; a duplicate -> 409', cm.status === 201 && (await cOps.post(`${P}/funds/${FUND.id}/commitments`, { portfolioId: pf.id, amount: '5', committedOn: td }, { 'Idempotency-Key': key('cm2') })).body?.error?.code === 'duplicate_commitment', cm.body);
    const over = await cOps.post(`${P}/commitments/${COM.id}/cashflows`, { kind: 'CALL', amount: '1000000.01', dueDate: dayStr(10) }, { 'Idempotency-Key': key('x0') });
    check('a call above the commitment -> 409 exceeds_commitment', over.body?.error?.code === 'exceeds_commitment', over.body);
    const call = await cOps.post(`${P}/commitments/${COM.id}/cashflows`, { kind: 'CALL', amount: '400000', noticeDate: dayStr(-380), dueDate: dayStr(-370) }, { 'Idempotency-Key': key('x1') });
    check('call noticed (PMX-#####)', call.status === 201 && /^PMX-\d{5}$/.test(call.body?.data?.ref) && call.body.data.status === 'NOTICED', call.body);
    check('only unfunded 600,000 left: a 700,000 call -> 409', (await cOps.post(`${P}/commitments/${COM.id}/cashflows`, { kind: 'CALL', amount: '700000', dueDate: dayStr(10) }, { 'Idempotency-Key': key('x2') })).status === 409);
    check('settling in the future -> 400', (await cOps.post(`${P}/cashflows/${call.body.data.id}/pay`, { paidOn: dayStr(5) })).status === 400);
    check('pay the call', (await cOps.post(`${P}/cashflows/${call.body.data.id}/pay`, { paidOn: dayStr(-365) })).body?.data?.status === 'PAID');
    check('paying twice -> 409', (await cOps.post(`${P}/cashflows/${call.body.data.id}/pay`, {})).status === 409);
    const dist = await cOps.post(`${P}/commitments/${COM.id}/cashflows`, { kind: 'DISTRIBUTION', amount: '100000', noticeDate: dayStr(-200), dueDate: dayStr(-190) }, { 'Idempotency-Key': key('x3') });
    await cOps.post(`${P}/cashflows/${dist.body.data.id}/pay`, { paidOn: dayStr(-190) });
    const mark = await cOps.post(`${P}/commitments/${COM.id}/marks`, { asOf: dayStr(-10), nav: '500000', method: 'GP_REPORTED', note: 'Quarter end' }, { 'Idempotency-Key': key('mk1') });
    const MARK = mark.body?.data;
    check('mark created DRAFT (PMM-#####); a duplicate date -> 409', mark.status === 201 && MARK?.status === 'DRAFT' && (await cOps.post(`${P}/commitments/${COM.id}/marks`, { asOf: dayStr(-10), nav: '1', method: 'COST' }, { 'Idempotency-Key': key('mk2') })).body?.error?.code === 'duplicate_mark', mark.body);
    check('submit without evidence -> 409 evidence_required', (await cOps.post(`${P}/marks/${MARK.id}/submit`)).body?.error?.code === 'evidence_required');
    check('only the maker adds evidence', (await cPm.post(`${P}/marks/${MARK.id}/evidence`, { kind: 'GP_STATEMENT', title: 'Not mine' })).status === 403);
    check('maker adds evidence', (await cOps.post(`${P}/marks/${MARK.id}/evidence`, { kind: 'GP_STATEMENT', title: 'Q3 capital account statement', reference: 'VAULT-1' })).body?.data?.evidence.length === 1);
    check('submit -> PENDING_APPROVAL', (await cOps.post(`${P}/marks/${MARK.id}/submit`)).body?.data?.status === 'PENDING_APPROVAL');
    check('a portfolio manager without mark.approve cannot approve -> 403', (await cPm.post(`${P}/marks/${MARK.id}/approve`)).status === 403);
    await prisma.session.updateMany({ where: { userId: fa.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } }); // enrolment/earlier step-up counts as fresh; age it
    check('approve without step-up -> 401 step_up_required', (await cFa.post(`${P}/marks/${MARK.id}/approve`)).body?.error?.code === 'step_up_required');
    await cStepUp(cFa);
    const ap = await cFa.post(`${P}/marks/${MARK.id}/approve`);
    check('a different person approves -> APPROVED', ap.status === 200 && ap.body.data.status === 'APPROVED' && ap.body.data.approverName, ap.body);
    check('audit pm.mark_approved by the approver', (await auditCount('pm.mark_approved', MARK.id, fa.id)) === 1);
    const det = (await cAud.get(`${P}/commitments/${COM.id}`)).body.data;
    check('performance: paid-in 400,000; DPI 0.25; RVPI 1.25; TVPI 1.50', det.paidIn === '400000.00' && det.dpi === '0.2500' && det.rvpi === '1.2500' && det.tvpi === '1.5000' && Number(det.irrPct) > 0, det);
    const big = (await cOps.post(`${P}/commitments/${COM.id}/marks`, { asOf: dayStr(-1), nav: '900000', method: 'ADJUSTED' }, { 'Idempotency-Key': key('mk3') })).body.data;
    await cOps.post(`${P}/marks/${big.id}/evidence`, { kind: 'VALUATION_REPORT', title: 'Revaluation memo' });
    check('a NAV move over 30% needs an explanation -> 409', (await cOps.post(`${P}/marks/${big.id}/submit`)).body?.error?.code === 'explanation_required');
    const sm = (await cAud.get(`${P}/summary?portfolioId=${pf.id}`)).body.data;
    check('summary pools the portfolio: one commitment, TVPI 1.5, one stale-or-fresh flag', sm.commitments.length === 1 && sm.totals.tvpi === '1.5000' && typeof sm.pendingMarks === 'number', sm);

    console.log('\nPortfolio lab');
    const L = '/api/v1/portfolio-lab';
    const mBody = { name: `Test model ${run}`, cashTargetPct: '10', weights: [{ securityId: sec1.ticker, targetPct: '40' }, { securityId: sec2.ticker, targetPct: '50' }] };
    check('an auditor cannot create a model -> 403', (await cAud.post(`${L}/models`, mBody, { 'Idempotency-Key': key('ml0') })).status === 403);
    check('weights over 100% -> 400', (await cPm.post(`${L}/models`, { ...mBody, weights: [{ securityId: sec1.ticker, targetPct: '95' }, { securityId: sec2.ticker, targetPct: '50' }] }, { 'Idempotency-Key': key('ml00') })).status === 400);
    const mdl = await cPm.post(`${L}/models`, mBody, { 'Idempotency-Key': key('ml1') });
    const MODEL = mdl.body?.data;
    if (MODEL) created.models.push(MODEL.id);
    check('model created PMD-#### DRAFT totalling 100%', mdl.status === 201 && MODEL?.status === 'DRAFT' && MODEL.totalPct === '100.0000' && /^PMD-\d{4}$/.test(MODEL.ref), mdl.body);
    check('what-if before activation -> 409', (await cPm.post(`${L}/whatif`, { portfolioId: pf.id, modelId: MODEL.id })).body?.error?.code === 'invalid_state');
    check('the author cannot activate -> 403 sod_violation', (await cPm.post(`${L}/models/${MODEL.id}/activate`)).body?.error?.code === 'sod_violation');
    check('a second person activates -> ACTIVE', (await cOps.post(`${L}/models/${MODEL.id}/activate`)).body?.data?.status === 'ACTIVE');
    check('an active model cannot be edited (409)', (await cPm.patch(`${L}/models/${MODEL.id}`, { name: 'Renamed' })).body?.error?.code === 'invalid_state');
    const wi = await cAud.post(`${L}/whatif`, { portfolioId: pf.id, modelId: MODEL.id });
    check('an auditor (portfolio.view) can run a what-if; nothing saved', wi.status === 200 && wi.body.data.lines.length === 2 && (await prisma.plRebalance.count({ where: { portfolioId: pf.id } })) === 0, wi.body);
    const buys = wi.body.data.lines.filter((l: any) => l.side === 'BUY');
    const sells = wi.body.data.lines.filter((l: any) => l.side === 'SELL');
    check('portfolio value 1,200,000: sell 52,000 of T1 (to 40%), buy 60,000 of T2 (to 50%)', wi.body.data.totalValueBase === '1200000.00' && sells[0]?.ticker === sec1.ticker && sells[0].quantity === '52000' && buys[0]?.ticker === sec2.ticker && buys[0].quantity === '60000', wi.body.data.lines);
    check('every line carries a check result and the book constraints pass', wi.body.data.lines.every((l: any) => ['Pass', 'Review', 'Fail'].includes(l.checkResult)) && wi.body.data.constraintsPassed, wi.body.data.constraints);
    check('an auditor cannot save a rebalance -> 403', (await cAud.post(`${L}/rebalances`, { portfolioId: pf.id, modelId: MODEL.id }, { 'Idempotency-Key': key('rb0') })).status === 403);
    const rb1 = await cPm.post(`${L}/rebalances`, { portfolioId: pf.id, modelId: MODEL.id }, { 'Idempotency-Key': key('rb1') });
    const RB = rb1.body?.data;
    check('rebalance saved RBL-##### PROPOSED with 2 lines', rb1.status === 201 && /^RBL-\d{5}$/.test(RB?.ref) && RB.status === 'PROPOSED' && RB.lines.length === 2, rb1.body);
    check('creating orders needs orders.create (operations -> 403)', (await cOps.post(`${L}/rebalances/${RB.id}/orders`, {}, { 'Idempotency-Key': key('rb2') })).status === 403);
    const ro = await cDir.post(`${L}/rebalances/${RB.id}/orders`, {}, { 'Idempotency-Key': key('rb3') });
    check('DRAFT orders created for the lines that did not fail', ro.status === 201 && ro.body.data.orders.length + ro.body.data.skipped === 2 && ro.body.data.rebalance.status === 'ORDERS_CREATED', ro.body);
    const rbOrders = await prisma.order.findMany({ where: { portfolioId: pf.id, rationale: { startsWith: `Rebalance ${RB.ref}` } } });
    check('the orders are Draft and made by the requester', rbOrders.length === ro.body.data.orders.length && rbOrders.every((o) => o.status === 'Draft' && o.makerId === dir.id));
    check('orders cannot be created twice -> 409', (await cDir.post(`${L}/rebalances/${RB.id}/orders`, {}, { 'Idempotency-Key': key('rb4') })).body?.error?.code === 'invalid_state');
    const small = await cPm.post(`${L}/rebalances`, { portfolioId: pf.id, modelId: MODEL.id, driftThresholdPct: '60' }, { 'Idempotency-Key': key('rb5') });
    check('a threshold above every drift -> 409 nothing_to_trade', small.body?.error?.code === 'nothing_to_trade', small.body);
    const rb2 = (await cPm.post(`${L}/rebalances`, { portfolioId: pf.id, modelId: MODEL.id, driftThresholdPct: '1' }, { 'Idempotency-Key': key('rb6') })).body.data;
    check('discard needs a reason and moves it to DISCARDED', (await cPm.post(`${L}/rebalances/${rb2.id}/discard`, {})).status === 400 && (await cPm.post(`${L}/rebalances/${rb2.id}/discard`, { reason: 'Prices moved' })).body?.data?.status === 'DISCARDED');

    console.log('\nFinancing');
    const F = '/api/v1/financing';
    check('an analyst cannot create facilities -> 403', (await cAn.post(`${F}/facilities`, {}, { 'Idempotency-Key': key('fa0') })).status === 403);
    await cStepUp(cOps);
    const rule = await cOps.put(`${F}/rules`, { assetClass: SEC_CLASS, market: 'VFEX', eligible: true, haircutPct: '20' });
    check('haircut rule set (needs step-up)', rule.status === 200 && rule.body.data.haircutPct === '20.00', rule.body);
    const pool = await cOps.post(`${F}/pools`, { name: `Test pool ${run}`, portfolioId: pf.id }, { 'Idempotency-Key': key('p1') });
    const POOL = pool.body?.data;
    if (POOL) created.pools.push(POOL.id);
    check('pool created POOL-####', pool.status === 201 && /^POOL-\d{4}$/.test(POOL?.ref), pool.body);
    check('pledging more than the free holding -> 409 insufficient_holding', (await cOps.post(`${F}/pools/${POOL.id}/collateral`, { securityId: sec1.ticker, quantity: '100001' }, { 'Idempotency-Key': key('p2') })).body?.error?.code === 'insufficient_holding');
    check('a security the portfolio does not hold cannot be pledged -> 409', (await cOps.post(`${F}/pools/${POOL.id}/collateral`, { securityId: sec2.ticker, quantity: '1' }, { 'Idempotency-Key': key('p3') })).body?.error?.code === 'insufficient_holding');
    const pl = await cOps.post(`${F}/pools/${POOL.id}/collateral`, { securityId: sec1.ticker, quantity: '60000' }, { 'Idempotency-Key': key('p4') });
    check('60,000 pledged: market 600,000, counted 480,000 after a 20% haircut', pl.status === 201 && pl.body.data.valuation.marketValue === '600000.00' && pl.body.data.valuation.counted === '480000.00', pl.body);
    check('only the unpledged 40,000 remains', (await cOps.post(`${F}/pools/${POOL.id}/collateral`, { securityId: sec1.ticker, quantity: '40001' }, { 'Idempotency-Key': key('p5') })).body?.error?.code === 'insufficient_holding');
    const fbody = { name: `Test margin line ${run}`, type: 'MARGIN_LOAN', lender: 'Test Bank', portfolioId: pf.id, poolId: POOL.id, currency: 'USD', limitAmount: '500000', ratePct: '9', initialRatio: '1.5', maintenanceRatio: '1.25', callDueDays: 2 };
    check('maintenance below 1 -> 400', (await cOps.post(`${F}/facilities`, { ...fbody, maintenanceRatio: '0.9' }, { 'Idempotency-Key': key('fc0') })).status === 400);
    const fc = await cOps.post(`${F}/facilities`, fbody, { 'Idempotency-Key': key('fc1') });
    const FAC = fc.body?.data;
    if (FAC) created.facilities.push(FAC.id);
    check('facility created FAC-#### DRAFT', fc.status === 201 && FAC?.status === 'DRAFT' && /^FAC-\d{4}$/.test(FAC.ref), fc.body);
    check('drawing on a draft facility -> 409', (await cOps.post(`${F}/facilities/${FAC.id}/draw`, { amount: '1000' }, { 'Idempotency-Key': key('dr0') })).status !== 201);
    check('submit -> PENDING_APPROVAL', (await cOps.post(`${F}/facilities/${FAC.id}/submit`)).body?.data?.status === 'PENDING_APPROVAL');
    await cStepUp(cComp);
    const sodFac = await cOps.post(`${F}/facilities/${FAC.id}/approve`);
    check('the maker cannot approve (no financing.approve) -> 403', sodFac.status === 403, sodFac.body);
    const apF = await cComp.post(`${F}/facilities/${FAC.id}/approve`);
    check('a different approver activates -> ACTIVE', apF.status === 200 && apF.body.data.status === 'ACTIVE' && apF.body.data.approverName, apF.body);
    check('audit fin.facility_approved by the approver', (await auditCount('fin.facility_approved', FAC.id, comp.id)) === 1);
    await cStepUp(cOps);
    const bigDraw = await cOps.post(`${F}/facilities/${FAC.id}/draw`, { amount: '400000' }, { 'Idempotency-Key': key('dr1') });
    check('a draw that leaves coverage under 1.5x -> 409 insufficient_collateral', bigDraw.body?.error?.code === 'insufficient_collateral', bigDraw.body);
    const dr = await cOps.post(`${F}/facilities/${FAC.id}/draw`, { amount: '300000' }, { 'Idempotency-Key': key('dr2') });
    check('draw 300,000 -> coverage 1.60x, state OK', dr.status === 201 && dr.body.data.margin.drawn === '300000.00' && dr.body.data.margin.coverage === '1.6000' && dr.body.data.margin.state === 'OK', dr.body);
    check('a draw above the limit -> 409 exceeds_limit', (await cOps.post(`${F}/facilities/${FAC.id}/draw`, { amount: '600000' }, { 'Idempotency-Key': key('dr3') })).body?.error?.code === 'exceeds_limit');
    check('a repayment above the balance -> 409', (await cOps.post(`${F}/facilities/${FAC.id}/repay`, { amount: '300001' }, { 'Idempotency-Key': key('rp0') })).body?.error?.code === 'exceeds_drawn');
    const ck = await cOps.post(`${F}/facilities/${FAC.id}/check`);
    check('a healthy facility raises no call', ck.status === 200 && ck.body.data.raised === false, ck.body);
    check('releasing collateral that would breach margin -> 409', (await cOps.post(`${F}/pools/${POOL.id}/collateral/${pl.body.data.valuation.lines[0].itemId}/release`, { reason: 'Rebalancing the pool' })).body?.error?.code === 'would_breach_margin');
    // The haircut jumps: coverage falls under maintenance.
    await cOps.put(`${F}/rules`, { assetClass: SEC_CLASS, market: 'VFEX', eligible: true, haircutPct: '70' });
    const ck2 = await cOps.post(`${F}/facilities/${FAC.id}/check`);
    const CALL = ck2.body?.data?.callId;
    check('haircut 70% -> collateral 180,000 / drawn 300,000 = 0.60x, call raised for 270,000', ck2.body?.data?.raised === true && ck2.body.data.margin.state === 'DEFICIT' && ck2.body.data.margin.callAmount === '270000.00', ck2.body);
    const callRow = (await cOps.get(`${F}/calls/${CALL}`)).body?.data;
    check('call MC-#### ISSUED with a due date', /^MC-\d{4}$/.test(callRow?.ref) && callRow.status === 'ISSUED' && callRow.dueAt, callRow);
    check('a second check does not duplicate the open call', (await cOps.post(`${F}/facilities/${FAC.id}/check`)).body?.data?.raised === false);
    check('drawing is blocked while a call is open', (await cOps.post(`${F}/facilities/${FAC.id}/draw`, { amount: '1' }, { 'Idempotency-Key': key('dr4') })).body?.error?.code === 'open_margin_call');
    check('acknowledge -> ACKNOWLEDGED', (await cOps.post(`${F}/calls/${CALL}/acknowledge`)).body?.data?.status === 'ACKNOWLEDGED');
    await cStepUp(cOps);
    check('resolve while coverage is short -> 409 call_not_met', (await cOps.post(`${F}/calls/${CALL}/resolve`, { note: 'Collateral posted today' })).body?.error?.code === 'call_not_met');
    check('the issuer cannot waive -> 403 (no financing.approve)', (await cOps.post(`${F}/calls/${CALL}/waive`, { reason: 'Lender agreed to waive' })).status === 403);
    await cStepUp(cDir);
    check('the issuer cannot cancel a call that still stands -> 409', (await cOps.post(`${F}/calls/${CALL}/cancel`, { reason: 'Raised in error' })).body?.error?.code === 'still_in_deficit');
    // Meet it by repaying down: drawn 50,000 -> 180,000 / 50,000 = 3.6x
    const rp = await cOps.post(`${F}/facilities/${FAC.id}/repay`, { amount: '250000' }, { 'Idempotency-Key': key('rp1') });
    check('repay 250,000 -> coverage restored', rp.status === 201 && rp.body.data.margin.state === 'OK', rp.body);
    await cStepUp(cOps);
    const met = await cOps.post(`${F}/calls/${CALL}/resolve`, { note: 'Repaid 250,000 to restore cover' });
    check('resolve -> MET with the coverage after', met.status === 200 && met.body.data.status === 'MET' && Number(met.body.data.coverageAfter) >= 1.5, met.body);
    check('audit fin.margin_call_met', (await auditCount('fin.margin_call_met', CALL, ops.id)) === 1);
    check('a met call cannot be waived (409)', (await cDir.post(`${F}/calls/${CALL}/waive`, { reason: 'Too late to waive' })).body?.error?.code === 'invalid_state');
    // second call, waived by a different person
    await cOps.put(`${F}/rules`, { assetClass: SEC_CLASS, market: 'VFEX', eligible: true, haircutPct: '95' });
    const ck3 = await cOps.post(`${F}/facilities/${FAC.id}/check`);
    check('another deficit raises another call', ck3.body?.data?.raised === true);
    const waive = await cDir.post(`${F}/calls/${ck3.body.data.callId}/waive`, { reason: 'Lender granted a one-day waiver' });
    check('a different person with financing.approve waives it -> WAIVED', waive.status === 200 && waive.body.data.status === 'WAIVED', waive.body);
    check('closing a facility with a balance -> 409', (await cOps.post(`${F}/facilities/${FAC.id}/close`, { reason: 'Facility ended' })).body?.error?.code === 'outstanding_balance');
    check('summary and monitor answer', (await cAud.get(`${F}/summary`)).status === 200 && (await cOps.post(`${F}/monitor`)).status === 200);
  } finally {
    try {
      await prisma.finMarginCall.deleteMany({ where: { facilityId: { in: created.facilities } } });
      await prisma.finMovement.deleteMany({ where: { facilityId: { in: created.facilities } } });
      await prisma.finFacility.deleteMany({ where: { id: { in: created.facilities } } });
      await prisma.finPool.deleteMany({ where: { id: { in: created.pools } } });
      await prisma.finEligibilityRule.deleteMany({ where: { assetClass: SEC_CLASS } });
      await prisma.plRebalance.deleteMany({ where: { portfolioId: pf.id } });
      await prisma.modelPortfolio.deleteMany({ where: { id: { in: created.models } } });
      await prisma.pmFund.findMany({ where: { id: { in: created.funds } } }).then(async (fs) => {
        const cs = await prisma.pmCommitment.findMany({ where: { fundId: { in: fs.map((f) => f.id) } }, select: { id: true } });
        await prisma.pmCashflow.deleteMany({ where: { commitmentId: { in: cs.map((c) => c.id) } } });
        await prisma.pmMark.deleteMany({ where: { commitmentId: { in: cs.map((c) => c.id) } } });
        await prisma.pmCommitment.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
        await prisma.pmFund.deleteMany({ where: { id: { in: fs.map((f) => f.id) } } });
      });
      await prisma.icDecisionOrder.deleteMany({ where: { decision: { caseId: { in: created.cases } } } });
      await prisma.icDecision.deleteMany({ where: { caseId: { in: created.cases } } });
      await prisma.icMeeting.deleteMany({ where: { createdBy: { in: userIds } } });
      await prisma.researchCase.deleteMany({ where: { id: { in: created.cases } } });
      await prisma.order.deleteMany({ where: { portfolioId: pf.id } });
      await prisma.portfolio.deleteMany({ where: { id: pf.id } });
      await prisma.securityPrice.deleteMany({ where: { securityId: { in: [sec1.id, sec2.id] } } });
      await prisma.security.deleteMany({ where: { id: { in: [sec1.id, sec2.id] } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    } catch (e) {
      console.log('  (cleanup skipped:', e instanceof Error ? e.message.split('\n').pop() : e, ')');
    }
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

async function cStepUp(c: { stepUp: () => Promise<Res> }) {
  await c.stepUp();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
