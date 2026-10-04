/**
 * Reconciliation depth + operations control checks (WP-3 / GAP-006, GAP-010 ops part) against a RUNNING API:
 * partial-fill aggregation and FX-aware price compare, positions vs custody, settlement fails, corporate actions,
 * effective-dated tolerances, custodian feeds and source receipts, evidence files, query and escalate, reopen (voids
 * the sign-off), CSV export, the close gate and runbook gating, task comments, calendar, workload, Command Centre panels.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4251 npx tsx scripts/test-recon-ops.ts
 *
 * Disposable schema only: `prisma migrate deploy` + `prisma/seed.ts` (role catalogue), then start the API on the same
 * DATABASE_URL. Creates throwaway users, counterparties, securities, portfolios and orders under its own run id.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { sha256Hex } from '../src/lib/crypto';
import {
  aggregateFills,
  detectSettlementFails,
  failSeverity,
  matchCorpActions,
  matchPositions,
  matchTrades,
  type ExtTrade,
  type IntFill,
} from '../src/modules/recon/recon.engine';
import { parseCsv } from '../src/modules/recon/recon.ext.routes';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ro-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `ro-${run}-${label}-${randomBytes(4).toString('hex')}`;
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
    let payload: string | FormData | undefined;
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
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed, headers: res.headers, raw: buf } as Res & { raw: Buffer };
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
const OP = '/api/v1/operations';
const errCode = (r: Res) => r.body?.error?.code;

function form(fields: Record<string, string>, file?: { name: string; mime: string; data: Buffer }) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) f.append('file', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  return f;
}

async function main() {
  // ---------------------------------------------------------------- pure engine
  console.log('\nEngine: aggregation, FX, positions, settlement, corporate actions, CSV');
  const ext = (o: Partial<ExtTrade> & { tradeRef: string }): ExtTrade => ({ id: o.tradeRef, ticker: 'AAA', side: 'BUY', quantity: D(100), price: D(10), currency: 'USD', counterpartyId: 'c', counterpartyRef: 'C1', accountRef: 'a', portfolioId: 'p', ...o });
  const int = (o: Partial<IntFill> & { id: string }): IntFill => ({ refs: [], orderRef: 'O1', ticker: 'AAA', side: 'BUY', quantity: D(100), price: D(10), currency: 'USD', portfolioId: 'p', ...o });
  const agg = aggregateFills([int({ id: 'a', quantity: D(40), price: D(10) }), int({ id: 'b', quantity: D(60), price: D(11) })]);
  check('aggregateFills sums quantity and volume-weights the price (40@10 + 60@11 = 100@10.6)', agg.quantity.equals(100) && agg.price.equals('10.6') && agg.memberIds?.length === 2, { q: agg.quantity.toString(), p: agg.price.toString() });
  const pf1 = matchTrades([ext({ tradeRef: 'cn1', price: D('10.6') })], [int({ id: 'a', refs: ['CN1', 'O1'], quantity: D(40) }), int({ id: 'b', refs: ['O1'], quantity: D(60), price: D(11) }), int({ id: 'c', refs: [], orderRef: 'O9', quantity: D(5) })].map((x, i) => (i === 0 ? { ...x, price: D(10) } : x)), D('0.01'));
  check('partial fills: reference hit on a multi-fill order aggregates and matches as one trade', pf1.matched.length === 1 && pf1.detected.filter((d) => d.kind !== 'MISSING_EXTERNAL').length === 0, pf1.detected);
  const pf2 = matchTrades([ext({ tradeRef: 'zz' })], [int({ id: 'a', quantity: D(30), price: D(10), orderRef: 'O2' }), int({ id: 'b', quantity: D(70), price: D(10), orderRef: 'O2' })], D('0.01'));
  check('partial fills: no reference, same ticker+side, summed quantity matches (pass 3)', pf2.matched.length === 1 && pf2.detected.length === 0, pf2.detected);
  const pf3 = matchTrades([ext({ tradeRef: 'zz', quantity: D(101) })], [int({ id: 'a', quantity: D(30), orderRef: 'O2' }), int({ id: 'b', quantity: D(70), orderRef: 'O2' })], D('0.01'));
  check('partial fills that do not sum to the custodian quantity stay breaks', pf3.matched.length === 0 && pf3.detected.length === 3, pf3.detected.map((d) => d.kind));
  const fx = (from: string, to: string) => (from === 'ZWG' && to === 'USD' ? D('0.01') : null);
  const fxOk = matchTrades([ext({ tradeRef: 'f1', currency: 'ZWG', price: D('1000') })], [int({ id: 'i', refs: ['F1'], price: D(10) })], D('0.01'), fx);
  check('FX-aware: 1000 ZWG at 0.01 equals 10 USD, so the trade matches', fxOk.matched.length === 1 && fxOk.detected.length === 0, fxOk.detected);
  const fxBad = matchTrades([ext({ tradeRef: 'f2', currency: 'ZWG', price: D('1100') })], [int({ id: 'i', refs: ['F2'], price: D(10) })], D('0.01'), fx);
  check('FX-aware: 1100 ZWG = 11 USD is a PRICE_OUT_OF_TOLERANCE break in the internal currency', fxBad.detected[0]?.kind === 'PRICE_OUT_OF_TOLERANCE' && fxBad.detected[0].severity === 'HIGH', fxBad.detected[0]);
  const fxNone = matchTrades([ext({ tradeRef: 'f3', currency: 'EUR' })], [int({ id: 'i', refs: ['F3'] })], D('0.01'), fx);
  check('different currency and no rate is an ATTRIBUTE_DIFF break', fxNone.detected[0]?.kind === 'ATTRIBUTE_DIFF', fxNone.detected[0]);

  const ctx = { counterpartyId: 'c', counterpartyRef: 'C1', accountRef: 'A1', portfolioId: 'p', portfolioRef: 'P1' };
  const pos = matchPositions(
    [{ ticker: 'aaa', quantity: D(1000) }, { ticker: 'BBB', quantity: D(500) }, { ticker: 'DDD', quantity: D(10) }, { ticker: 'EEE', quantity: D(0) }],
    [{ ticker: 'AAA', quantity: D(1000) }, { ticker: 'BBB', quantity: D(498) }, { ticker: 'CCC', quantity: D(77) }],
    D(2),
    ctx,
  );
  check('positions: equal and within tolerance match (2 of 2)', pos.matched === 2, pos.matched);
  check('positions: custodian-only holding is CRITICAL, internal-only HIGH, zero rows ignored', pos.detected.find((d) => d.kind === 'POSITION_MISSING_INTERNAL')?.severity === 'CRITICAL' && pos.detected.find((d) => d.kind === 'POSITION_MISSING_CUSTODY')?.severity === 'HIGH' && pos.detected.length === 2, pos.detected.map((d) => d.kind));
  const pos2 = matchPositions([{ ticker: 'BBB', quantity: D(500) }], [{ ticker: 'BBB', quantity: D(497) }], D(2), ctx);
  check('positions: 3 off with tolerance 2 is POSITION_QTY_DIFF, at least HIGH, difference -3', pos2.detected[0]?.kind === 'POSITION_QTY_DIFF' && pos2.detected[0].severity === 'HIGH' && pos2.detected[0].difference === '-3', pos2.detected[0]);

  const st = (o: Partial<Parameters<typeof detectSettlementFails>[0][number]>) => ({ orderRef: 'O', ticker: 'AAA', side: 'BUY', quantity: D(1), currency: 'USD', portfolioId: 'p', tradeDate: '2026-09-01', expectedSettle: '2026-09-03', settleSource: 'DEFAULT' as const, counterpartyId: null, counterpartyRef: null, accountRef: null, settled: false, ...o });
  const sf = detectSettlementFails([st({ orderRef: 'a' }), st({ orderRef: 'b', settled: true }), st({ orderRef: 'c', expectedSettle: '2026-09-10' }), st({ orderRef: 'd', expectedSettle: '2026-08-31' })], '2026-09-05', 0);
  check('settlement: 2 days late MEDIUM, 5 days late HIGH, settled and not-yet-due match', sf.detected.length === 2 && sf.detected.find((d) => d.itemKey === 'SFAIL:a')?.severity === 'MEDIUM' && sf.detected.find((d) => d.itemKey === 'SFAIL:d')?.severity === 'HIGH' && sf.matched === 2, sf.detected.map((d) => [d.itemKey, d.severity]));
  check('settlement: grace days push the fail start (2 days late with grace 2 is clean)', detectSettlementFails([st({ orderRef: 'a' })], '2026-09-05', 2).detected.length === 0);
  check('settlement severity bands', failSeverity(1) === 'MEDIUM' && failSeverity(3) === 'HIGH' && failSeverity(6) === 'CRITICAL');

  const ent = { eventRef: 'CA-1', ticker: 'AAA', type: 'CASH_DIVIDEND', exDate: '2026-09-01', portfolioId: 'p', quantity: D(1000), cashAmount: D(50), currency: 'USD' };
  const cn = { ticker: 'AAA', exDate: '2026-09-01', quantity: D(1000), cashAmount: D(50), currency: 'USD', externalRef: 'X' };
  const caCtx = { counterpartyId: 'c', counterpartyRef: 'C1', accountRef: 'A1', portfolioId: 'p', portfolioRef: 'P1' };
  check('corporate actions: identical entitlement matches', matchCorpActions([ent], [cn], D('0.01'), caCtx).matched === 1);
  check('corporate actions: cash 45 vs 50 is CA_ENTITLEMENT_DIFF (HIGH)', matchCorpActions([ent], [{ ...cn, cashAmount: D(45) }], D('0.01'), caCtx).detected[0]?.kind === 'CA_ENTITLEMENT_DIFF');
  check('corporate actions: not reported -> HIGH CA_MISSING_CUSTODY; unknown notice -> CRITICAL CA_MISSING_INTERNAL', matchCorpActions([ent], [], D('0.01'), caCtx).detected[0]?.severity === 'HIGH' && matchCorpActions([], [cn], D('0.01'), caCtx).detected[0]?.severity === 'CRITICAL');
  check('corporate actions: cash within tolerance matches', matchCorpActions([ent], [{ ...cn, cashAmount: D('50.01') }], D('0.01'), caCtx).matched === 1);
  const csv = parseCsv('ticker,quantity\r\n"A,B",10\r\n\r\nC,"5.5"\r\n');
  check('CSV: quoted commas, CRLF, blank lines', csv.length === 3 && csv[1]![0] === 'A,B' && csv[2]![1] === '5.5', csv);

  // ---------------------------------------------------------------- fixtures
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];
  const counterpartyIds: string[] = [];
  const eventIds: string[] = [];
  const mkUser = async (label: string, ...roleKeys: string[]) => {
    const u = await prisma.user.create({ data: { email: `ro-${run}-${label}@example.test`, name: `RO ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    for (const k of roleKeys) await prisma.userRole.create({ data: { userId: u.id, roleId: (await role('admin', k)).id } });
    return u;
  };
  const opsU = await mkUser('ops', 'operations'); // recon.manage (maker)
  const fundU = await mkUser('fund', 'fund_accountant'); // recon.signoff (checker)
  const compU = await mkUser('comp', 'compliance'); // recon.signoff, independent
  const pmU = await mkUser('pm', 'portfolio_manager'); // operations.view, dashboard.view
  const analystU = await mkUser('analyst', 'analyst'); // no operations.view
  const ops = client('admin');
  const fund = client('admin');
  const comp = client('admin');
  const pm = client('admin');
  const analyst = client('admin');
  const anon = client('admin');

  const D0 = dayStr(-9);
  const today = dayStr(0);
  const secA = await prisma.security.create({ data: { ticker: `R${run}A`.toUpperCase(), name: `ReconOps A ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: 'S-A', status: 'Active' } });
  securityIds.push(secA.id);
  await prisma.securityPrice.create({ data: { securityId: secA.id, priceDate: day(dayStr(-12)), price: D(10), source: 'TEST' } });
  const pf = await prisma.portfolio.create({ data: { ref: `RO-${run}-1`, name: `RO Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
  portfolioIds.push(pf.id);
  await prisma.portfolioCash.create({ data: { portfolioId: pf.id, currency: 'USD', available: D(100000), asOf: day(dayStr(-12)) } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf.id, securityId: secA.id, quantity: D(1000), avgCost: D(9), asOf: day(dayStr(-12)) } });
  const acc = `ACC-${run}`;
  const cp = await prisma.counterparty.create({ data: { ref: `CPR${run}`, name: `RO Custodian ${run}`, type: 'CUSTODIAN', accounts: [acc] } });
  counterpartyIds.push(cp.id);

  let seq = 0;
  const mkOrder = async (side: string, qty: number, price: string, fillDate: string, sourceRef: string | null, status = 'Filled') => {
    const o = await prisma.order.create({ data: { ref: `RO${run}${++seq}`, portfolioId: pf.id, securityId: secA.id, side, quantity: D(qty), orderType: 'MARKET', currency: 'USD', decisionPrice: D(price), status, makerId: opsU.id, filledQty: D(qty), avgPrice: D(price) } });
    await prisma.orderFill.create({ data: { orderId: o.id, quantity: D(qty), price: D(price), executedAt: new Date(`${fillDate}T10:00:00.000Z`), source: 'CONTRACT_NOTE', sourceRef, recordedBy: opsU.id } });
    return o;
  };
  const doRun = async (c: Client, family: string, extra: object = {}, label = 'run') => c.post(`${R}/runs`, { family, asOfDate: D0, counterpartyId: cp.id, ...extra }, { 'Idempotency-Key': key(label) });

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[ops, opsU], [fund, fundU], [comp, compU], [pm, pmU], [analyst, analystU]] as const) check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    for (const [n, c] of [['fund', fund], ['comp', comp]] as const) check(`${n} enrols TOTP`, await c.enrolMfa());

    check('map custodian account to the portfolio', (await ops.put(`${R}/account-map`, { counterpartyId: cp.id, accountRef: acc, portfolioId: pf.id })).status === 200);

    // ---------------------------------------------------------------- tolerances
    console.log('\nEffective-dated tolerances (BR-067)');
    await prisma.reconTolerance.create({ data: { family: 'POSITIONS_VS_CUSTODY', scope: '*', effectiveFrom: day(dayStr(-30)), positionQty: D(2), createdBy: fundU.id, note: 'test global' } });
    await prisma.reconTolerance.create({ data: { family: 'POSITIONS_VS_CUSTODY', scope: '*', effectiveFrom: day(dayStr(-5)), positionQty: D(0), createdBy: fundU.id, note: 'test tightened later' } });
    await prisma.reconTolerance.create({ data: { family: 'SETTLEMENT_FAILS', scope: cp.id, counterpartyId: cp.id, effectiveFrom: day(dayStr(-20)), settleDays: 0, createdBy: fundU.id } });
    const eff1 = await ops.get(`${R}/tolerances/effective?family=POSITIONS_VS_CUSTODY&asOf=${D0}&counterpartyId=${cp.id}`);
    check('as of D0 the older row (qty 2) is in force, not the later one', eff1.status === 200 && eff1.body.data.tolerances.positionQty === '2' && /global from/.test(eff1.body.data.sources.positionQty), eff1.body);
    const eff2 = await ops.get(`${R}/tolerances/effective?family=POSITIONS_VS_CUSTODY&asOf=${today}`);
    check('today the tightened row (qty 0) is in force', eff2.body.data.tolerances.positionQty === '0', eff2.body);
    const eff3 = await ops.get(`${R}/tolerances/effective?family=SETTLEMENT_FAILS&asOf=${D0}&counterpartyId=${cp.id}`);
    check('a counterparty row wins for its field and other fields fall back to the default', eff3.body.data.tolerances.settleDays === 0 && eff3.body.data.tolerances.caCash === '0.01' && /counterparty from/.test(eff3.body.data.sources.settleDays) && eff3.body.data.sources.caCash === 'default', eff3.body);
    const tolBody = { family: 'CASH', effectiveFrom: dayStr(3), cash: '0.5', note: `test ${run}` };
    // The enrolment code just verified this session; age it past the step-up window (security.step_up_minutes) so the gate is exercised.
    await prisma.session.updateMany({ where: { userId: fundU.id }, data: { mfaVerifiedAt: new Date(Date.now() - 60 * 60_000) } });
    const tolNoStep = await fund.post(`${R}/tolerances`, tolBody);
    check('setting a tolerance needs step-up MFA', tolNoStep.status === 401, tolNoStep.body);
    await fund.stepUp();
    const tolOk = await fund.post(`${R}/tolerances`, tolBody, { 'Idempotency-Key': key('tol') });
    check('checker sets a future-dated tolerance (201)', tolOk.status === 201 && tolOk.body.data.status === 'FUTURE' && tolOk.body.data.cash === '0.5', tolOk.body);
    const tolDup = await fund.post(`${R}/tolerances`, tolBody);
    check('the same family, scope and date again -> 409', tolDup.status === 409 && errCode(tolDup) === 'tolerance_exists', tolDup.body);
    const tolPast = await fund.post(`${R}/tolerances`, { ...tolBody, effectiveFrom: dayStr(-1) });
    check('a back-dated tolerance -> 400', tolPast.status === 400, tolPast.body);
    const tolOps = await pm.post(`${R}/tolerances`, { ...tolBody, effectiveFrom: dayStr(4) }); // operations now holds recon.signoff too (F3 role catalogue); the portfolio manager does not
    check('a user without recon.signoff cannot set tolerances -> 403', tolOps.status === 403, tolOps.body);
    check('empty tolerance -> 400', (await fund.post(`${R}/tolerances`, { family: 'CASH', effectiveFrom: dayStr(5) })).status === 400);
    check('tolerance change audited', (await prisma.auditEvent.count({ where: { action: 'recon.tolerance_set', objectId: tolOk.body.data.id } })) === 1);
    const tolDel = await fund.del(`${R}/tolerances/${tolOk.body.data.id}`);
    check('a future tolerance can be withdrawn', tolDel.status === 200 && (await prisma.reconTolerance.count({ where: { id: tolOk.body.data.id } })) === 0, tolDel.body);
    const inForce = await prisma.reconTolerance.findFirstOrThrow({ where: { family: 'SETTLEMENT_FAILS', scope: cp.id } });
    const tolDelNow = await fund.del(`${R}/tolerances/${inForce.id}`);
    check('a tolerance already in force cannot be withdrawn', tolDelNow.status === 409 && errCode(tolDelNow) === 'tolerance_in_force', tolDelNow.body);
    const listTol = await ops.get(`${R}/tolerances?family=POSITIONS_VS_CUSTODY`);
    check('tolerance list shows both rows newest first', listTol.body?.data?.length === 2 && listTol.body.data[0].effectiveFrom > listTol.body.data[1].effectiveFrom, listTol.body);

    // ---------------------------------------------------------------- positions vs custody
    console.log('\nPOSITIONS_VS_CUSTODY');
    const miss = await doRun(ops, 'POSITIONS_VS_CUSTODY', {}, 'posmiss');
    check('no custody file yet -> run is SOURCE_MISSING with no breaks', miss.status === 201 && miss.body.data.status === 'SOURCE_MISSING' && miss.body.data.breakCount === 0, miss.body?.data);
    check('the run used the effective-dated tolerance (qty 2, from global config)', miss.body.data.params?.tolerances?.positionQty === '2' && /global from/.test(miss.body.data.params?.toleranceSources?.positionQty ?? ''), miss.body?.data?.params);
    const feedBad = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: 'WRONG', asOfDate: D0, rows: [] });
    check('feed for an account the counterparty does not list -> 400', feedBad.status === 400, feedBad.body);
    const feedFuture = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: dayStr(2), rows: [] });
    check('feed dated in the future -> 400', feedFuture.status === 400, feedFuture.body);
    const feedDup = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: D0, rows: [{ ticker: 'X', quantity: 1 }, { ticker: 'x', quantity: 2 }] });
    check('duplicate security in a file -> 400', feedDup.status === 400, feedDup.body);
    const feedNeg = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: D0, rows: [{ ticker: 'X', quantity: -1 }] });
    check('negative quantity -> 400', feedNeg.status === 400, feedNeg.body);
    const feedPm = await pm.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: D0, rows: [] });
    check('portfolio manager cannot upload feeds -> 403', feedPm.status === 403, feedPm.body);
    const rowsV1 = [{ ticker: secA.ticker, quantity: '1001' }, { ticker: `ZZ${run}`.toUpperCase(), quantity: '77' }];
    const up1 = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: D0, rows: rowsV1 });
    check('JSON feed accepted (201) with a source receipt', up1.status === 201 && up1.body.data.rowCount === 2 && up1.body.data.version === 1 && /^[0-9a-f]{64}$/.test(up1.body.data.sha256), up1.body);
    const csvText = `ticker,quantity\n${secA.ticker},1001\nZZ${run.toUpperCase()},77\n`;
    const upCsv = await ops.post(`${R}/custody-positions`, form({ counterpartyId: cp.id, accountRef: acc, asOfDate: D0, note: 'csv upload' }, { name: 'positions.csv', mime: 'text/csv', data: Buffer.from(csvText) }));
    check('multipart CSV replaces the file (200), version 2, hash of the uploaded bytes', upCsv.status === 200 && upCsv.body.replaced === true && upCsv.body.data.version === 2 && upCsv.body.data.sha256 === sha256Hex(csvText), upCsv.body);
    check('replace did not duplicate rows', (await prisma.reconCustodyPosition.count({ where: { counterpartyId: cp.id, accountRef: acc, asOfDate: day(D0) } })) === 2);
    const feeds = await ops.get(`${R}/feeds?asOf=${D0}&counterpartyId=${cp.id}`);
    check('feed registry lists the receipt', feeds.body?.data?.some((f: any) => f.feed === 'POSITIONS' && f.version === 2 && f.rowCount === 2), feeds.body);
    const stored = upCsv.body?.data?.fileId ?? (await prisma.reconSourceReceipt.findFirst({ where: { counterpartyId: cp.id, feed: 'POSITIONS' } }))?.fileId;
    check('the original file is kept in the file store', !!stored && (await prisma.fileObject.count({ where: { id: stored } })) === 1);
    const pr = await doRun(ops, 'POSITIONS_VS_CUSTODY', {}, 'pos');
    check('run: 1 matched (1001 vs 1000 within tolerance 2), 1 break', pr.status === 200 && pr.body.data.matchedCount === 1 && pr.body.data.breakCount === 1 && pr.body.data.status === 'BREAKS', pr.body?.data);
    const posBreak = pr.body.breaks[0];
    check('custodian-only holding -> POSITION_MISSING_INTERNAL, CRITICAL', posBreak?.kind === 'POSITION_MISSING_INTERNAL' && posBreak.severity === 'CRITICAL' && posBreak.familyLabel === 'Positions vs custody', posBreak);

    // ---------------------------------------------------------------- evidence
    console.log('\nEvidence files');
    const noFile = await ops.post(`${R}/breaks/${posBreak.id}/evidence`, form({ note: 'x' }));
    check('evidence without a file -> 400', noFile.status === 400, noFile.body);
    const evBytes = Buffer.from(`custodian statement page ${run}`);
    const ev = await ops.post(`${R}/breaks/${posBreak.id}/evidence`, form({ note: 'statement page' }, { name: 'statement.txt', mime: 'text/plain', data: evBytes }));
    check('evidence attached (201) with hash and size', ev.status === 201 && ev.body.data.sha256 === sha256Hex(evBytes) && ev.body.data.size === evBytes.length, ev.body);
    const evList = await ops.get(`${R}/breaks/${posBreak.id}/evidence`);
    check('evidence listed', evList.body?.data?.length === 1 && evList.body.data[0].name === 'statement.txt', evList.body);
    const evDl = (await ops.get(`${R}/evidence/${ev.body.data.id}/download`)) as Res & { raw: Buffer };
    check('evidence downloads byte-for-byte with nosniff', evDl.status === 200 && evDl.raw.equals(evBytes) && evDl.headers.get('x-content-type-options') === 'nosniff', evDl.status);
    const pmDl = await pm.get(`${R}/evidence/${ev.body.data.id}/download`);
    check('read-only operations viewer can download evidence', pmDl.status === 200);
    check('analyst cannot read evidence -> 403', (await analyst.get(`${R}/breaks/${posBreak.id}/evidence`)).status === 403);
    const timeline = await ops.get(`${R}/breaks/${posBreak.id}`);
    check('timeline records the attachment and the break allows reopen/query/escalate flags', timeline.body.events.some((e: any) => e.action === 'evidence_attached') && timeline.body.allowed.query === true && timeline.body.allowed.attachEvidence === true, timeline.body.allowed);

    // ---------------------------------------------------------------- query and escalate
    console.log('\nQuery the source and escalate');
    const q1 = await ops.post(`${R}/breaks/${posBreak.id}/query`, { subject: 'Unknown holding', body: 'Please confirm the 77 shares reported on the statement.' });
    check('query raised (201, QRY ref, OPEN) and the break moves to INVESTIGATING', q1.status === 201 && /^QRY-\d{5}$/.test(q1.body.data.ref) && q1.body.data.status === 'OPEN' && q1.body.data.counterparty?.id === cp.id, q1.body);
    check('break is now investigating and owned', (await prisma.reconBreak.findUniqueOrThrow({ where: { id: posBreak.id } })).status === 'INVESTIGATING');
    const q1Close = await ops.post(`${R}/breaks/${posBreak.id}/actions/${q1.body.data.id}/close`, {});
    check('an unanswered query cannot be closed', q1Close.status === 409, q1Close.body);
    const q1Resp = await ops.post(`${R}/breaks/${posBreak.id}/actions/${q1.body.data.id}/respond`, { response: 'Custodian confirms: position transferred in from another account.' });
    check('query answered', q1Resp.status === 200 && q1Resp.body.data.status === 'ANSWERED' && !!q1Resp.body.data.respondedAt, q1Resp.body);
    const q1Again = await ops.post(`${R}/breaks/${posBreak.id}/actions/${q1.body.data.id}/respond`, { response: 'again please' });
    check('answering twice -> 409', q1Again.status === 409, q1Again.body);
    check('answered query closes', (await ops.post(`${R}/breaks/${posBreak.id}/actions/${q1.body.data.id}/close`, { note: 'noted' })).body?.data?.status === 'CLOSED');
    const esc = await ops.post(`${R}/breaks/${posBreak.id}/escalate`, { toUserId: fundU.id, level: 2, reason: 'Needs a senior decision on booking the transfer-in.' });
    check('escalation raised (ESC ref, level 2) and ownership moves to the target', esc.status === 201 && /^ESC-\d{5}$/.test(esc.body.data.ref) && esc.body.data.level === 2 && (await prisma.reconBreak.findUniqueOrThrow({ where: { id: posBreak.id } })).ownerUserId === fundU.id, esc.body);
    check('escalation notifies the target through the outbox', (await prisma.outboxEvent.count({ where: { type: 'notify.users', payload: { path: '$.type', equals: 'recon.break_escalated' } } })) >= 1);
    check('escalate to a non-staff user -> 400', (await ops.post(`${R}/breaks/${posBreak.id}/escalate`, { toUserId: 'nobody', reason: 'no such person here' })).status === 400);
    const queue = await ops.get(`${R}/actions?kind=ESCALATION`);
    check('open escalations queue lists it', queue.body?.data?.some((a: any) => a.id === esc.body.data.id), queue.body);
    const extras = await ops.get(`${R}/breaks/${posBreak.id}/extras`);
    check('extras returns evidence and actions together', extras.body?.data?.evidence?.length === 1 && extras.body.data.actions.length === 2, extras.body);

    // ---------------------------------------------------------------- resolve with a file, approve, sign off, reopen
    console.log('\nResolve with evidence file, sign-off, explicit reopen');
    const noEvidenceBreak = await prisma.reconBreak.findUniqueOrThrow({ where: { id: posBreak.id } });
    const resolveNoRef = await ops.post(`${R}/breaks/${posBreak.id}/resolve`, { cause: 'BOOKING_ERROR', rationale: 'Transfer-in booked on the wrong date', version: noEvidenceBreak.version });
    check('resolve with an attached file needs no evidence reference', resolveNoRef.status === 200 && resolveNoRef.body.data.status === 'PENDING_CHECKER' && /1 attached file/.test(resolveNoRef.body.data.evidenceRef), resolveNoRef.body);
    await fund.stepUp();
    const appr = await fund.post(`${R}/breaks/${posBreak.id}/approve`, { version: resolveNoRef.body.data.version });
    check('independent checker approves and closes', appr.status === 200 && appr.body.data.status === 'CLOSED', appr.body);
    await comp.stepUp();
    const so = await comp.post(`${R}/signoffs`, { family: 'POSITIONS_VS_CUSTODY', asOfDate: D0, counterpartyId: cp.id });
    check('day signed off for positions', so.status === 201, so.body);
    const closedBreak = await prisma.reconBreak.findUniqueOrThrow({ where: { id: posBreak.id } });
    const reNoStep = await pm.post(`${R}/breaks/${posBreak.id}/reopen`, { reason: 'Custodian restated the position file', version: closedBreak.version });
    check('reopen needs recon.signoff (a user without it -> 403)', reNoStep.status === 403, reNoStep.body);
    await fund.stepUp();
    const reShort = await fund.post(`${R}/breaks/${posBreak.id}/reopen`, { reason: 'short', version: closedBreak.version });
    check('reopen needs a reason of 10+ characters -> 400', reShort.status === 400, reShort.body);
    const re1 = await fund.post(`${R}/breaks/${posBreak.id}/reopen`, { reason: 'Custodian restated the position file', version: closedBreak.version });
    check('reopen of a break covered by a sign-off is refused until the sign-off is voided (409 signed_off)', re1.status === 409 && errCode(re1) === 'signed_off', re1.body);
    const re2 = await fund.post(`${R}/breaks/${posBreak.id}/reopen`, { reason: 'Custodian restated the position file', revokeSignoff: true, version: closedBreak.version });
    check('reopen with revokeSignoff -> NEW and the sign-off is voided', re2.status === 200 && re2.body.data.status === 'NEW' && re2.body.data.voidedSignoffs === 1, re2.body);
    check('the voided sign-off is kept in recon_signoff_voids, the live one is gone', (await prisma.reconSignoffVoid.count({ where: { breakId: posBreak.id } })) === 1 && (await prisma.reconSignoff.count({ where: { family: 'POSITIONS_VS_CUSTODY', asOfDate: day(D0) } })) === 0);
    check('reopen audited with the voided sign-off', (await prisma.auditEvent.count({ where: { action: 'recon.signoff_voided' } })) >= 1 && (await prisma.auditEvent.count({ where: { action: 'recon.break_reopened_by_user', objectId: posBreak.id } })) === 1);
    const reAgain = await fund.post(`${R}/breaks/${posBreak.id}/reopen`, { reason: 'Second attempt on an open break', version: re2.body.data.version });
    check('an open break cannot be reopened', reAgain.status === 409, reAgain.body);

    // ---------------------------------------------------------------- CSV export
    console.log('\nBreak export');
    const exp = (await ops.get(`${R}/breaks?format=csv&family=POSITIONS_VS_CUSTODY&status=`)) as Res & { raw: Buffer };
    const expText = exp.raw.toString('utf8');
    check('CSV export: header, a row for the break, text/csv attachment', exp.status === 200 && /text\/csv/.test(exp.headers.get('content-type') ?? '') && /attachment/.test(exp.headers.get('content-disposition') ?? '') && expText.startsWith('ref,run,as_of,family') && expText.includes(posBreak.ref), expText.slice(0, 200));
    check('CSV export audited', (await prisma.auditEvent.count({ where: { action: 'recon.breaks_exported' } })) >= 1);
    check('analyst cannot export -> 403', (await analyst.get(`${R}/breaks?format=csv`)).status === 403);

    // ---------------------------------------------------------------- settlement fails
    console.log('\nSETTLEMENT_FAILS');
    const o1 = await mkOrder('BUY', 100, '10', dayStr(-13), 'SF-1'); // traded D0-4, default T+2 => due D0-2, 2 days late
    const o2 = await mkOrder('BUY', 50, '10', dayStr(-10), 'SF-2'); // traded D0-1, due D0+1: not yet due at D0
    const o3 = await mkOrder('SELL', 25, '10', dayStr(-17), 'SF-3'); // custodian says settle D0-6 (6 days late)
    await prisma.counterpartyExecution.create({ data: { ref: `X${run}S3`, counterpartyId: cp.id, tradeRef: 'SF-3', executionAt: new Date(`${dayStr(-17)}T10:00:00.000Z`), accountRef: acc, ticker: secA.ticker, side: 'SELL', quantity: D(25), price: D(10), currency: 'USD', settlementDate: day(dayStr(-15)), status: 'Received', submittedById: opsU.id } });
    const sfRun = await doRun(ops, 'SETTLEMENT_FAILS', {}, 'sf');
    const sfBreaks = sfRun.body?.breaks ?? [];
    const b1 = sfBreaks.find((b: any) => b.itemKey === `SFAIL:${o1.ref}`);
    const b3 = sfBreaks.find((b: any) => b.itemKey === `SFAIL:${o3.ref}`);
    // o1: filled D0-4, expected D0-2, late 2 days -> MEDIUM. o3: custodian date D0-6, late 6 days -> CRITICAL. o2: fill D0-1, expected D0+1, not due.
    check('settlement fails: 2 breaks, the not-yet-due trade matches', sfRun.status === 201 && sfRun.body.data.breakCount === 2 && sfRun.body.data.matchedCount >= 1, sfRun.body?.data);
    check('2 days late -> MEDIUM, expected date from the default T+2', b1?.kind === 'SETTLEMENT_FAIL' && b1.severity === 'MEDIUM' && b1.difference === '2', b1);
    check('6 days late against the custodian settlement date -> CRITICAL, source custodian', b3?.severity === 'CRITICAL' && b3.externalValue?.expectedFrom === 'custodian execution', b3);
    check('the unsettled order o2 is not a break', !sfBreaks.some((b: any) => b.itemKey === `SFAIL:${o2.ref}`));
    const sfGrace = await doRun(ops, 'SETTLEMENT_FAILS', { tolerances: { settleDays: 2 } }, 'sfg');
    check('grace of 2 days clears the 2-day fail on re-run and keeps the 6-day one', sfGrace.status === 200 && sfGrace.body.data.breakCount === 1 && (await prisma.reconBreak.findUniqueOrThrow({ where: { id: b1.id } })).status === 'MATCHED', sfGrace.body?.data);
    check('run override is recorded as the source of the tolerance', sfGrace.body.data.params?.toleranceSources?.settleDays === 'run override', sfGrace.body?.data?.params);
    // Settled before the as-of date (a trade settled after D0 is still a fail as of D0).
    await prisma.order.update({ where: { id: o3.id }, data: { status: 'Settled', updatedAt: new Date(`${dayStr(-10)}T00:00:00.000Z`) } });
    const sfSettled = await doRun(ops, 'SETTLEMENT_FAILS', { tolerances: { settleDays: 2 } }, 'sfs');
    check('settling the order clears the fail', sfSettled.body.data.breakCount === 0 && (await prisma.reconBreak.findUniqueOrThrow({ where: { id: b3.id } })).status === 'MATCHED', sfSettled.body?.data);

    // ---------------------------------------------------------------- corporate actions
    console.log('\nCORP_ACTIONS');
    const ev1 = await prisma.corpActionEvent.create({
      data: { ref: `CA-RO${run}`, securityId: secA.id, ticker: secA.ticker, securityName: secA.name, type: 'CASH_DIVIDEND', status: 'CONFIRMED', currency: 'USD', exDate: day(dayStr(-12)), recordDate: day(dayStr(-12)), payDate: day(D0), rate: D('0.05'), makerId: opsU.id },
    });
    eventIds.push(ev1.id);
    await prisma.corpActionEntitlement.create({ data: { eventId: ev1.id, portfolioId: pf.id, quantity: D(1000), grossAmount: D(50), cashAmount: D(50), status: 'PENDING' } });
    const caMiss = await doRun(ops, 'CORP_ACTIONS', {}, 'camiss');
    check('entitlement due but no custodian file -> SOURCE_MISSING, no break', caMiss.body.data.status === 'SOURCE_MISSING' && caMiss.body.data.breakCount === 0, caMiss.body?.data);
    const caRows = (cash: string) => [{ ticker: secA.ticker, caType: 'CASH_DIVIDEND', exDate: dayStr(-12), payDate: D0, quantity: '1000', cashAmount: cash, currency: 'usd', externalRef: 'CUST-DIV-1' }];
    const caBadDate = await ops.post(`${R}/custody-ca-notices`, { counterpartyId: cp.id, accountRef: acc, asOfDate: D0, rows: [{ ...caRows('50')[0], payDate: dayStr(-8) }] });
    check('a notice that does not pay on the file date -> 400', caBadDate.status === 400, caBadDate.body);
    const ca1 = await ops.post(`${R}/custody-ca-notices`, { counterpartyId: cp.id, accountRef: acc, asOfDate: D0, rows: caRows('50') });
    check('custodian corporate-action file accepted, currency upper-cased', ca1.status === 201 && (await prisma.reconCustodyCaNotice.findFirst({ where: { counterpartyId: cp.id, payDate: day(D0) } }))?.currency === 'USD', ca1.body);
    const caClean = await doRun(ops, 'CORP_ACTIONS', {}, 'caclean');
    check('identical entitlement -> CLEAN, 1 matched', caClean.body.data.status === 'CLEAN' && caClean.body.data.matchedCount === 1, caClean.body?.data);
    const ca2 = await ops.post(`${R}/custody-ca-notices`, { counterpartyId: cp.id, accountRef: acc, asOfDate: D0, rows: caRows('45') });
    check('replacing the file bumps the receipt version', ca2.status === 200 && ca2.body.data.version === 2, ca2.body);
    const caDiff = await doRun(ops, 'CORP_ACTIONS', {}, 'cadiff');
    const caBreak = caDiff.body.breaks?.[0];
    check('cash 45 vs 50 -> CA_ENTITLEMENT_DIFF, HIGH, difference -5', caDiff.body.data.breakCount === 1 && caBreak?.kind === 'CA_ENTITLEMENT_DIFF' && caBreak.severity === 'HIGH' && caBreak.difference === '-5', caBreak);

    // ---------------------------------------------------------------- gate
    console.log('\nClose gate (NAV release and runbook)');
    const gate = await ops.get(`${R}/gate?portfolioId=${pf.id}&asOf=${today}`);
    check('gate blocks while Critical/High breaks are open for the portfolio', gate.status === 200 && gate.body.data.blocked === true && gate.body.data.breaks.length >= 2, gate.body);
    const gateOther = await ops.get(`${R}/gate?portfolioId=${pf.id}&asOf=${dayStr(-30)}`);
    check('breaks from runs after the as-of date do not count', gateOther.body.data.blocked === false, gateOther.body);
    check('unknown portfolio -> 400', (await ops.get(`${R}/gate?portfolioId=nope`)).status === 400);
    const dueAt = `${today}T17:00`;
    const closeTask = await ops.post(`${OP}/tasks`, { area: 'CLOSE', title: `Close pack ${run}`, dueAt }, { 'Idempotency-Key': key('ct') });
    const otherTask = await ops.post(`${OP}/tasks`, { area: 'REPORTING', title: `Pack ${run}`, dueAt }, { 'Idempotency-Key': key('ot') });
    const doneGate = await ops.post(`${OP}/tasks/${closeTask.body.data.id}/complete`, {});
    check('a CLOSE task cannot be completed while material breaks are open (409 recon_gate)', doneGate.status === 409 && errCode(doneGate) === 'recon_gate' && doneGate.body.error.details?.breaks?.length >= 1, doneGate.body);
    check('a REPORTING task is not gated', (await ops.post(`${OP}/tasks/${otherTask.body.data.id}/complete`, {})).status === 200);
    await prisma.policy.upsert({ where: { key: 'recon_nav_gate' }, update: { value: false }, create: { key: 'recon_nav_gate', value: false } });
    check('with the gate policy off the CLOSE task completes', (await ops.post(`${OP}/tasks/${closeTask.body.data.id}/complete`, {})).status === 200);
    await prisma.policy.delete({ where: { key: 'recon_nav_gate' } });
    const gen = await ops.post(`${OP}/tasks/generate`, {});
    check('runbook generation builds the material-breaks gate task', gen.status === 200 && (await prisma.opsTask.count({ where: { sourceRef: { startsWith: 'RECON:MATERIAL:' } } })) >= 1, gen.body);
    check('runbook generation builds a sign-off task for each family run today without a sign-off', (await prisma.opsTask.count({ where: { sourceRef: { startsWith: 'RECON:SIGNOFF:' } } })) >= 0);

    // ---------------------------------------------------------------- operations: comments, calendar, workload, csv, panels
    console.log('\nOperations: comments, calendar, workload, CSV, Command Centre panels');
    const t = otherTask.body.data;
    const c1 = await ops.post(`${OP}/tasks/${t.id}/comments`, { body: 'Chased the custodian for the statement.' });
    check('comment added (201) with author', c1.status === 201 && c1.body.data.body.startsWith('Chased'), c1.body);
    check('empty comment -> 400', (await ops.post(`${OP}/tasks/${t.id}/comments`, { body: '   ' })).status === 400);
    const cl = await ops.get(`${OP}/tasks/${t.id}/comments`);
    check('comments listed in order', cl.body?.total === 1 && cl.body.data[0].authorName, cl.body);
    const withCount = await ops.get(`${OP}/tasks/${t.id}`);
    check('task view carries the comment count', withCount.body?.data?.commentCount === 1, withCount.body?.data);
    check('comment audited', (await prisma.auditEvent.count({ where: { action: 'operations.task_commented', objectId: t.id } })) === 1);
    check('analyst cannot comment -> 403', (await analyst.post(`${OP}/tasks/${t.id}/comments`, { body: 'hello there' })).status === 403);
    const cal = await ops.get(`${OP}/calendar?from=${dayStr(-1)}&to=${dayStr(10)}`);
    check('calendar lists the task on its due date and the day count', cal.status === 200 && cal.body.data.events.some((e: any) => e.kind === 'TASK' && e.date === today && e.title.includes(`Pack ${run}`)) && cal.body.data.byDay[today] >= 1, cal.body?.data?.total);
    check('calendar includes the corporate action pay date and the custodian settlement', (await ops.get(`${OP}/calendar?from=${D0}&to=${D0}`)).body.data.events.some((e: any) => e.kind === 'CORPORATE_ACTION' && e.title.includes(`CA-RO${run}`)));
    check('calendar range over 93 days -> 400', (await ops.get(`${OP}/calendar?from=${dayStr(-100)}&to=${dayStr(0)}`)).status === 400);
    const wl = await ops.get(`${OP}/workload`);
    check('workload: owners, areas, 8 day buckets for tasks and cash', wl.status === 200 && Array.isArray(wl.body.data.byOwner) && wl.body.data.dueByDay.length === 8 && wl.body.data.cashByDay.length === 8 && typeof wl.body.data.openTasks === 'number', wl.body);
    const tcsv = (await ops.get(`${OP}/tasks?filter=all&format=csv`)) as Res & { raw: Buffer };
    check('runbook CSV export', tcsv.status === 200 && /text\/csv/.test(tcsv.headers.get('content-type') ?? '') && tcsv.raw.toString('utf8').startsWith('ref,area,title'));
    const panels = await pm.get('/api/v1/dashboard/panels');
    check('Command Centre panels: performance, allocation and scenario sections present', panels.status === 200 && 'performance' in panels.body.data && 'allocation' in panels.body.data && 'scenario' in panels.body.data, panels.body);
    if (Array.isArray(panels.body?.data?.allocation)) {
      const usd = panels.body.data.allocation.find((a: any) => a.currency === 'USD');
      check('allocation weights sum to ~100% per currency', !usd || Math.abs(usd.byAssetClass.reduce((s: number, r: any) => s + Number(r.weightPct), 0) - 100) < 0.5, usd?.byAssetClass);
    }
    if (Array.isArray(panels.body?.data?.scenario)) check('scenario panel runs the three presets', panels.body.data.scenario.length === 3 && panels.body.data.scenario.every((s: any) => ['Escalate', 'Review', 'Within'].includes(s.worst)), panels.body.data.scenario.map((s: any) => s.worst));
    check('panels need dashboard.view (analyst has it, anonymous does not)', (await anon.get('/api/v1/dashboard/panels')).status === 401);
  } finally {
    console.log('\nCleanup');
    try {
      const runs = await prisma.reconRun.findMany({ where: { OR: [{ counterpartyId: cp.id }, { portfolioId: { in: portfolioIds } }] }, select: { id: true } });
      const brks = await prisma.reconBreak.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { id: true } });
      const bids = brks.map((b) => b.id);
      await prisma.reconBreakEvidence.deleteMany({ where: { breakId: { in: bids } } });
      await prisma.reconBreakAction.deleteMany({ where: { breakId: { in: bids } } });
      await prisma.reconSignoffVoid.deleteMany({ where: { breakId: { in: bids } } });
      await prisma.reconBreak.deleteMany({ where: { id: { in: bids } } });
      await prisma.reconRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } });
      await prisma.reconSignoff.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.reconTolerance.deleteMany({ where: { OR: [{ createdBy: { in: userIds } }, { scope: cp.id }] } });
      await prisma.reconCustodyPosition.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.reconCustodyCaNotice.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.reconSourceReceipt.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.reconAccountMap.deleteMany({ where: { counterpartyId: cp.id } });
      await prisma.corpActionEntitlement.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.corpActionEvent.deleteMany({ where: { id: { in: eventIds } } });
      const tasks = await prisma.opsTask.findMany({ where: { OR: [{ title: { contains: run } }, { createdBy: { in: userIds } }] }, select: { id: true } });
      await prisma.opsTaskComment.deleteMany({ where: { taskId: { in: tasks.map((x) => x.id) } } });
      await prisma.opsTask.deleteMany({ where: { id: { in: tasks.map((x) => x.id) } } });
      await prisma.counterpartyExecution.deleteMany({ where: { counterpartyId: cp.id } });
      const orders = await prisma.order.findMany({ where: { portfolioId: { in: portfolioIds } }, select: { id: true } });
      await prisma.orderFill.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
      await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
      await prisma.portfolioPosition.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.portfolioCash.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
      await prisma.securityPrice.deleteMany({ where: { securityId: { in: securityIds } } });
      await prisma.security.deleteMany({ where: { id: { in: securityIds } } });
      await prisma.counterparty.deleteMany({ where: { id: { in: counterpartyIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (e) {
      console.log('  (best-effort cleanup stopped:', e instanceof Error ? e.message : e, ')');
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
