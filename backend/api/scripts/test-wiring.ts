/**
 * Cross-module wiring checks against a RUNNING API:
 *  - Orders <-> Cash: the order ticket reads cash-ledger availability; submit holds cash (row-locked), approve keeps a
 *    single hold, fills resize it, cancel and reject release it, settle creates PENDING_APPROVAL trade journals made by
 *    the system actor (idempotent per order), posting the cash journal consumes the hold, reversing it restores the hold.
 *  - Automatic journals: a released NAV books its fee/accrual journal, a processed corporate action books its cash
 *    journals, each PENDING_APPROVAL, maker = system, unique per source, postable by a human.
 *  - Operations Control: live status, persisted runbook tasks (create, idempotency, start, block, complete, dependency
 *    rule, generate is idempotent), permissions and audit; Command Centre /dashboard/today.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-wiring.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API
 * against the same DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP enrolment). Creates throwaway users, a portfolio and
 * a security with a random run id; disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { SYSTEM_ACTOR_ID } from '../src/lib/system';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Wr-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `wr-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const td = dayStr(0);

interface Res {
  status: number;
  body: any;
  headers: Headers;
}

function client(portal: 'admin' | 'investor' = 'admin') {
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
const errCode = (r: Res) => r.body?.error?.code;

const O = '/api/v1/orders';
const C = '/api/v1/cash';
const A = '/api/v1/accounting';
const OP = '/api/v1/operations';

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, ...roleKeys: string[]) => {
    const u = await prisma.user.create({ data: { email: `wr-${run}-${label}@example.test`, name: `WR ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    for (const k of roleKeys) await prisma.userRole.create({ data: { userId: u.id, roleId: (await role('admin', k)).id } });
    return u;
  };
  const pmU = await mkUser('pm', 'portfolio_manager'); // orders.create, operations.view, dashboard.view
  const dirU = await mkUser('dir', 'investment_director'); // orders.approve, accounting.post, valuation.release
  const dealerU = await mkUser('dealer', 'dealer'); // orders.route
  const faU = await mkUser('fa', 'fund_accountant'); // cash journal create/approve, accounting.post, process CA
  const opsU = await mkUser('ops', 'operations'); // cash journal approve, operations.view, process CA
  const audU = await mkUser('aud', 'auditor'); // operations.view, no dashboard.view
  const analystU = await mkUser('analyst', 'analyst'); // dashboard.view only
  const pm = client();
  const dir = client();
  const dealer = client();
  const fa = client();
  const ops = client();
  const aud = client();
  const analyst = client();
  const anon = client();

  const yesterday = day(dayStr(-1));
  const portfolio = await prisma.portfolio.create({ data: { ref: `WR-${run}`, name: `WR Entity ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active', mandateJson: { maxSingleNamePct: 90 } } });
  await prisma.portfolioCash.create({ data: { portfolioId: portfolio.id, currency: 'USD', available: D(100000), asOf: yesterday } });
  const sec = await prisma.security.create({ data: { ticker: `W${run}`.toUpperCase(), name: `Wiring ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: `Sector-${run}`, status: 'Active', averageDailyVolume: D(1000000) } });
  for (const d of [dayStr(-2), dayStr(-1)]) await prisma.securityPrice.create({ data: { securityId: sec.id, priceDate: day(d), price: D(50), source: 'TEST' } });
  const broker = await prisma.broker.create({ data: { name: `WR Broker ${run}`, email: `wr-broker-${run}@example.test`, status: 'Active' } });
  const orderIds: string[] = [];

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[pm, pmU], [dir, dirU], [dealer, dealerU], [fa, faU], [ops, opsU], [aud, audU], [analyst, analystU]] as const) check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    for (const [n, c] of [['dir', dir], ['dealer', dealer], ['fa', fa], ['ops', ops]] as const) check(`${n} enrols TOTP`, await c.enrolMfa());

    console.log('\nCash ledger set-up (opening balance 100,000)');
    const ds = await fa.post(`${C}/ledgers/default-set`, { portfolioId: portfolio.id, currency: 'USD' });
    check('standard ledgers created', ds.status === 201 && ds.body?.created === 5, ds.body);
    const ledgers = (await prisma.cashLedger.findMany({ where: { portfolioId: portfolio.id } })) as { id: string; kind: string; ref: string }[];
    const L = (k: string) => ledgers.find((l) => l.kind === k)!;
    const openJ = await fa.post(`${C}/journals`, { portfolioId: portfolio.id, entryDate: dayStr(-1), description: 'Opening balance', purpose: 'CLIENT_DEPOSIT', lines: [{ ledgerId: L('BANK').id, debit: '100000' }, { ledgerId: L('CONTROL').id, credit: '100000' }] }, { 'Idempotency-Key': key('oj') });
    check('opening journal drafted', openJ.status === 201, openJ.body);
    await fa.post(`${C}/journals/${openJ.body.data.id}/submit`, {});
    await ops.stepUp();
    const openPost = await ops.post(`${C}/journals/${openJ.body.data.id}/post`, {});
    check('opening journal posted by a second person', openPost.status === 200 && openPost.body?.data?.status === 'POSTED', openPost.body);
    const bal = async () => (await fa.get(`${C}/balances?portfolioId=${portfolio.id}`)).body?.data?.ledgers?.find((l: any) => l.ref === L('BANK').ref);
    check('derived bank balance is 100,000.00 with nothing held', (await bal())?.posted === '100000.00' && (await bal())?.reserved === '0.00', await bal());

    console.log('\nOrder ticket reads the cash ledger; submit holds cash');
    const ticket = (q: number) => ({ portfolioId: portfolio.id, securityId: sec.id, side: 'BUY', quantity: q, orderType: 'MARKET', tif: 'DAY', urgency: 'Normal', brokerId: broker.id });
    const create = async (q: number) => {
      const r = await pm.post(O, ticket(q), { 'Idempotency-Key': key('c') });
      if (r.body?.data?.id) orderIds.push(r.body.data.id);
      return r;
    };
    const o1 = (await create(1000)).body.data;
    const v1 = await pm.post(`${O}/${o1.id}/validate`, {});
    const cashCheck = v1.body?.data?.precheck?.checks?.find((c: any) => c.key === 'cash');
    check('cash check passes and names the cash ledger as its source', cashCheck?.result === 'Pass' && String(cashCheck?.metrics?.source).startsWith('cash ledger'), cashCheck);
    const sub1 = await pm.post(`${O}/${o1.id}/submit`, { rationale: 'Rebalance towards the target allocation' }, { 'Idempotency-Key': key('s') });
    check('submit succeeds', sub1.status === 200 && sub1.body?.data?.status === 'AwaitingApproval', sub1.body);
    const rsv1 = await prisma.cashReservation.findMany({ where: { orderId: o1.id } });
    check('exactly one live reservation for the order on the bank ledger', rsv1.length === 1 && rsv1[0]!.status === 'ACTIVE' && rsv1[0]!.ledgerId === L('BANK').id && rsv1[0]!.amount.eq(D(sub1.body.data.reservedAmount)), rsv1);
    check('ledger shows the hold and availability fell', (await bal())?.reserved === D(sub1.body.data.reservedAmount).toFixed(2), await bal());
    check('audit has cash.reservation_created', (await prisma.auditEvent.count({ where: { action: 'cash.reservation_created', objectId: rsv1[0]!.id } })) === 1);

    const o2 = (await create(1500)).body.data;
    const v2 = await pm.post(`${O}/${o2.id}/validate`, {});
    const c2 = v2.body?.data?.precheck?.checks?.find((c: any) => c.key === 'cash');
    check('a second buy is blocked: ledger availability net of the first hold is too small', c2?.result === 'Fail', c2);

    console.log('\nApprove, route, fills resize the hold');
    await dir.stepUp();
    const ap = await dir.post(`${O}/${o1.id}/approve`, {}, { 'Idempotency-Key': key('a') });
    check('approve succeeds', ap.status === 200 && ap.body?.data?.status === 'Approved', ap.body);
    check('approve keeps a single hold (no duplicate)', (await prisma.cashReservation.count({ where: { orderId: o1.id, status: 'ACTIVE' } })) === 1);
    await dealer.stepUp();
    const rt = await dealer.post(`${O}/${o1.id}/route`, { brokerId: broker.id }, { 'Idempotency-Key': key('r') });
    check('route succeeds', rt.status === 200 && rt.body?.data?.status === 'Routing', rt.body);
    const f1 = await dealer.post(`${O}/${o1.id}/fills`, { quantity: 400, price: 50 }, { 'Idempotency-Key': key('f') });
    check('partial fill recorded', f1.status === 201 && f1.body?.data?.status === 'PartiallyFilled', f1.body);
    const afterPartial = await prisma.cashReservation.findFirstOrThrow({ where: { orderId: o1.id } });
    check('hold still live after a partial fill', afterPartial.status === 'ACTIVE' && afterPartial.amount.gt(D(400 * 50)), afterPartial);
    const f2 = await dealer.post(`${O}/${o1.id}/fills`, { quantity: 600, price: 51, fees: 10 }, { 'Idempotency-Key': key('f') });
    check('final fill recorded -> Filled', f2.status === 201 && f2.body?.data?.status === 'Filled', f2.body);
    const exact = D(400 * 50 + 600 * 51 + 10);
    const afterFull = await prisma.cashReservation.findFirstOrThrow({ where: { orderId: o1.id } });
    check('hold shrinks to the exact cost (50,610.00) and is still waiting for settlement', afterFull.status === 'ACTIVE' && afterFull.amount.eq(exact), afterFull);

    console.log('\nSettle: system-made PENDING_APPROVAL trade journals, idempotent');
    check('settle needs orders.route (pm gets 403)', (await pm.post(`${O}/${o1.id}/settle`, {})).status === 403);
    const st = await dealer.post(`${O}/${o1.id}/settle`, {});
    check('settle -> Settled with both journals', st.status === 200 && st.body?.data?.status === 'Settled' && st.body.data.settlementJournals?.cash?.created === true && st.body.data.settlementJournals?.accounting?.created === true, st.body);
    const cj = await prisma.cashJournal.findFirstOrThrow({ where: { sourceRef: `ORDER:${o1.ref ?? st.body.data.ref}:SETTLE` }, include: { lines: true } });
    check('cash journal is PENDING_APPROVAL, made by the system actor, linked to the hold', cj.status === 'PENDING_APPROVAL' && cj.makerId === SYSTEM_ACTOR_ID && cj.reservationId === afterFull.id && cj.purpose === 'BUY_SETTLEMENT', cj);
    check('cash journal credits the bank ledger with the exact cost', cj.lines.some((l) => l.ledgerId === L('BANK').id && l.credit.eq(exact)), cj.lines);
    const aj = await prisma.accJournal.findFirstOrThrow({ where: { sourceRef: `ORDER:${st.body.data.ref}:SETTLE` }, include: { lines: true } });
    check('accounting journal is PENDING_APPROVAL, system maker, balanced', aj.status === 'PENDING_APPROVAL' && aj.makerId === SYSTEM_ACTOR_ID && aj.totalDebit.eq(exact) && aj.totalCredit.eq(exact), aj);
    const again = await dealer.post(`${O}/${o1.id}/settle`, {});
    check('settling again is refused (409) and creates nothing', again.status === 409 && (await prisma.cashJournal.count({ where: { sourceRef: cj.sourceRef! } })) === 1 && (await prisma.accJournal.count({ where: { sourceRef: aj.sourceRef! } })) === 1, again.body);
    const detail = await fa.get(`${C}/journals/${cj.id}`);
    check('journal view shows the maker as System', detail.body?.data?.makerName === 'System', detail.body?.data?.makerName);

    console.log('\nPosting consumes the hold; reversing restores it');
    await ops.stepUp();
    const postCash = await ops.post(`${C}/journals/${cj.id}/post`, {});
    check('a human posts the system cash journal', postCash.status === 200 && postCash.body?.data?.status === 'POSTED', postCash.body);
    const consumed = await prisma.cashReservation.findUniqueOrThrow({ where: { id: afterFull.id } });
    check('hold is CONSUMED for the full cost', consumed.status === 'CONSUMED' && consumed.consumed.eq(exact), consumed);
    check('posted bank balance is now 49,390.00 with nothing held', (await bal())?.posted === '49390.00' && (await bal())?.reserved === '0.00', await bal());
    await dir.stepUp();
    const postAcc = await dir.post(`${A}/journals/${aj.id}/post`, {});
    check('a human posts the system accounting journal', postAcc.status === 200 && postAcc.body?.data?.status === 'POSTED', postAcc.body);
    await ops.stepUp();
    const rev = await ops.post(`${C}/journals/${cj.id}/reverse`, { reason: 'Broker settlement failed, reinstating the hold' });
    check('reversal posted', rev.status === 201 && rev.body?.data?.status === 'POSTED', rev.body);
    const restored = await prisma.cashReservation.findUniqueOrThrow({ where: { id: afterFull.id } });
    check('reversal restores the consumed reservation (ACTIVE, consumed 0)', restored.status === 'ACTIVE' && restored.consumed.isZero(), restored);
    check('audit has cash.reservation_restored', (await prisma.auditEvent.count({ where: { action: 'cash.reservation_restored', objectId: afterFull.id } })) === 1);
    check('balance back to 100,000.00 with the hold re-applied', (await bal())?.posted === '100000.00' && (await bal())?.reserved === exact.toFixed(2), await bal());
    await ops.post(`${C}/reservations/${afterFull.id}/release`, { reason: 'Test cleanup of restored hold' });

    console.log('\nCancel and reject release the hold');
    const o3 = (await create(200)).body.data;
    await pm.post(`${O}/${o3.id}/validate`, {});
    await pm.post(`${O}/${o3.id}/submit`, { rationale: 'Rebalance towards the target allocation' }, { 'Idempotency-Key': key('s') });
    check('o3 holds cash', (await prisma.cashReservation.count({ where: { orderId: o3.id, status: 'ACTIVE' } })) === 1);
    const cn = await pm.post(`${O}/${o3.id}/cancel`, { reason: 'No longer needed' });
    check('cancel -> Cancelled', cn.status === 200 && cn.body?.data?.status === 'Cancelled', cn.body);
    check('cancel releases the hold', (await prisma.cashReservation.count({ where: { orderId: o3.id, status: 'RELEASED' } })) === 1 && (await prisma.cashReservation.count({ where: { orderId: o3.id, status: 'ACTIVE' } })) === 0);
    const o4 = (await create(200)).body.data;
    await pm.post(`${O}/${o4.id}/validate`, {});
    await pm.post(`${O}/${o4.id}/submit`, { rationale: 'Rebalance towards the target allocation' }, { 'Idempotency-Key': key('s') });
    await dir.stepUp();
    const rj = await dir.post(`${O}/${o4.id}/reject`, { reason: 'Outside the investment plan' });
    check('reject releases the hold', rj.status === 200 && (await prisma.cashReservation.count({ where: { orderId: o4.id, status: 'RELEASED' } })) === 1, rj.body);

    console.log('\nNAV release books the fee and accrual journal');
    const nav = await fa.post('/api/v1/nav/runs', { portfolioId: portfolio.id, navDate: dayStr(-1), fees: '100', accruals: '50' }, { 'Idempotency-Key': key('nav') });
    check('NAV run created', nav.status === 201, nav.body);
    const navId = nav.body?.data?.id;
    const mr = await fa.post(`/api/v1/nav/runs/${navId}/maker-review`, {});
    check('maker review done', mr.status === 200 && mr.body?.data?.status === 'MAKER_REVIEWED', mr.body);
    await dir.stepUp();
    const rel = await dir.post(`/api/v1/nav/runs/${navId}/release`, {});
    check('NAV released by a second person', rel.status === 200 && rel.body?.data?.status === 'RELEASED', rel.body);
    const navJ = await prisma.accJournal.findUnique({ where: { sourceRef: `NAV:${nav.body.data.ref}` }, include: { lines: { include: { account: true } } } });
    check('fee and accrual journal is PENDING_APPROVAL, system maker', navJ?.status === 'PENDING_APPROVAL' && navJ.makerId === SYSTEM_ACTOR_ID, navJ);
    check('journal carries fees 100.00 (5000/2000) and accruals 50.00 (1200/4100)', !!navJ && navJ.totalDebit.eq(D(150)) && navJ.lines.some((l) => l.account.code === '5000' && l.debit.eq(D(100))) && navJ.lines.some((l) => l.account.code === '4100' && l.credit.eq(D(50))), navJ?.lines);

    console.log('\nCorporate action processing books cash journals');
    const ca = await ops.post('/api/v1/corporate-actions/events', { securityId: sec.id, type: 'CASH_DIVIDEND', exDate: td, recordDate: td, payDate: td, rate: '0.5', withholdingPct: '10' }, { 'Idempotency-Key': key('ca') });
    check('dividend announced', ca.status === 201, ca.body);
    const caId = ca.body?.data?.id;
    await fa.post(`/api/v1/corporate-actions/events/${caId}/confirm`, {});
    await fa.post(`/api/v1/corporate-actions/events/${caId}/entitlements/calculate`, {});
    await fa.stepUp();
    const pr = await fa.post(`/api/v1/corporate-actions/events/${caId}/process`, {});
    check('dividend processed', pr.status === 200 && pr.body?.data?.status === 'PROCESSED', pr.body);
    const caJ = await prisma.accJournal.findFirst({ where: { sourceRef: { startsWith: `CA:${ca.body?.data?.ref}:` }, portfolioId: portfolio.id }, include: { lines: { include: { account: true } } } });
    check('accounting journal: net cash, withholding and dividend income, PENDING_APPROVAL by system', !!caJ && caJ.status === 'PENDING_APPROVAL' && caJ.makerId === SYSTEM_ACTOR_ID && caJ.lines.some((l) => l.account.code === '4000') && caJ.lines.some((l) => l.account.code === '5300'), caJ?.lines);
    const caCash = await prisma.cashJournal.findFirst({ where: { sourceRef: caJ?.sourceRef ?? 'none' } });
    check('cash ledger journal: PENDING_APPROVAL, system maker, purpose CORPORATE_ACTION', caCash?.status === 'PENDING_APPROVAL' && caCash.makerId === SYSTEM_ACTOR_ID && caCash.purpose === 'CORPORATE_ACTION', caCash);
    check('a runbook task and notification exist for the approvals', (await prisma.opsTask.count({ where: { sourceRef: `CA:${ca.body?.data?.ref}:JOURNALS` } })) === 1 && (await prisma.outboxEvent.count({ where: { type: 'notify.permission', payload: { path: '$.link', equals: `/ops/corporate-actions/${caId}` } } })) >= 1);

    console.log('\nOperations Control');
    check('anonymous -> 401', (await anon.get(`${OP}/status`)).status === 401);
    check('analyst (no operations.view) -> 403', (await analyst.get(`${OP}/status`)).status === 403);
    const status = await aud.get(`${OP}/status`);
    check('auditor reads live status', status.status === 200 && Array.isArray(status.body?.data?.dependencies) && status.body.data.dependencies.length === 4, status.body);
    check('status reflects the pending system journals', status.body?.data?.accounting?.systemJournals >= 1 && status.body?.data?.cash?.systemJournals >= 1, status.body?.data?.accounting);
    check('status lists the processed corporate action work', typeof status.body?.data?.corporateActions?.count === 'number');
    const gen1 = await ops.post(`${OP}/tasks/generate`, {});
    const gen2 = await ops.post(`${OP}/tasks/generate`, {});
    check('generate builds tasks from live conditions', gen1.status === 200 && (gen1.body?.data?.created ?? 0) + (await prisma.opsTask.count({ where: { sourceRef: { startsWith: 'ACC:JOURNALS:' } } })) >= 1, gen1.body);
    check('generate is idempotent (second run creates nothing)', gen2.status === 200 && gen2.body?.data?.created === 0, gen2.body);
    check('auditor (operations.view) can read the runbook', (await aud.get(`${OP}/tasks`)).status === 200);

    const tkey = key('t');
    const body = { area: 'CASH', title: `Chase custodian statement ${run}`, detail: 'Statement missing for the operating account', dueAt: `${td}T09:00` };
    const t1 = await ops.post(`${OP}/tasks`, body, { 'Idempotency-Key': tkey });
    check('task created (201) with a reference', t1.status === 201 && /^OPT-\d+$/.test(t1.body?.data?.ref) && t1.body.data.state === 'DUE', t1.body);
    const t1r = await ops.post(`${OP}/tasks`, body, { 'Idempotency-Key': tkey });
    check('create is idempotent (replay returns the same task)', t1r.status === 201 && t1r.headers.get('idempotent-replayed') === 'true' && t1r.body?.data?.id === t1.body.data.id, t1r.body);
    check('create without Idempotency-Key -> 400', (await ops.post(`${OP}/tasks`, body)).status === 400);
    check('bad link rejected', (await ops.post(`${OP}/tasks`, { ...body, link: 'https://evil.example' }, { 'Idempotency-Key': key('t') })).status === 400);
    const t2 = await ops.post(`${OP}/tasks`, { area: 'REPORTING', title: `Publish pack ${run}`, dueAt: `${td}T16:00`, dependsOnId: t1.body.data.id }, { 'Idempotency-Key': key('t') });
    check('dependent task shows BLOCKED while its dependency is open', t2.status === 201 && t2.body?.data?.state === 'BLOCKED', t2.body);
    const t2c = await ops.post(`${OP}/tasks/${t2.body.data.id}/complete`, {});
    check('a task cannot complete before its dependency (409 dependency_open)', t2c.status === 409 && errCode(t2c) === 'dependency_open', t2c.body);
    const st1 = await ops.post(`${OP}/tasks/${t1.body.data.id}/start`, {});
    check('start -> IN_PROGRESS and owner assigned', st1.status === 200 && st1.body?.data?.status === 'IN_PROGRESS' && !!st1.body.data.ownerId, st1.body);
    const noReason = await ops.post(`${OP}/tasks/${t1.body.data.id}/block`, { reason: 'x' });
    check('block needs a reason (400)', noReason.status === 400);
    const bl = await ops.post(`${OP}/tasks/${t1.body.data.id}/block`, { reason: 'Custodian portal is down' });
    check('block -> BLOCKED with reason', bl.status === 200 && bl.body?.data?.state === 'BLOCKED' && bl.body.data.blockedReason === 'Custodian portal is down', bl.body);
    const cm = await ops.post(`${OP}/tasks/${t1.body.data.id}/complete`, { note: 'Statement received by email' });
    check('complete -> DONE', cm.status === 200 && cm.body?.data?.status === 'DONE' && !!cm.body.data.completedAt, cm.body);
    const cm2 = await ops.post(`${OP}/tasks/${t1.body.data.id}/complete`, {});
    check('completing twice is refused (409)', cm2.status === 409, cm2.body);
    const t2ok = await ops.post(`${OP}/tasks/${t2.body.data.id}/complete`, {});
    check('dependent task completes once the dependency is done', t2ok.status === 200 && t2ok.body?.data?.status === 'DONE', t2ok.body);
    const ro = await ops.post(`${OP}/tasks/${t1.body.data.id}/reopen`, { reason: 'Statement was for the wrong account' });
    check('reopen -> OPEN', ro.status === 200 && ro.body?.data?.status === 'OPEN', ro.body);
    const list = await ops.get(`${OP}/tasks?filter=due`);
    check('due filter lists the reopened task with counts', list.status === 200 && list.body?.data?.some((t: any) => t.id === t1.body.data.id) && list.body.summary.due >= 1, list.body?.summary);
    const csv = await fetch(`${API}${OP}/tasks?format=csv`, { headers: { Origin: config.portalUrls.admin } });
    check('CSV export needs a session (401 anonymously)', csv.status === 401);
    for (const a of ['operations.task_created', 'operations.task_started', 'operations.task_blocked', 'operations.task_completed', 'operations.task_reopened']) {
      check(`audit has ${a}`, (await prisma.auditEvent.count({ where: { action: a, objectId: t1.body.data.id } })) >= 1);
    }

    console.log('\nCommand Centre: GET /dashboard/today');
    check('anonymous -> 401', (await anon.get('/api/v1/dashboard/today')).status === 401);
    check('auditor (no dashboard.view) -> 403', (await aud.get('/api/v1/dashboard/today')).status === 403);
    const today = await dir.get('/api/v1/dashboard/today');
    const t = today.body?.data;
    check('director sees AUM, orders, breaks, approvals, cash, NAV and risk', today.status === 200 && t?.aum && t?.ordersWorking && t?.breaks && t?.approvals && t?.cash && t?.nav && t?.risk, today.body);
    check('approval queue counts the pending accounting journals', t?.approvals?.items?.find((i: any) => i.key === 'accounting')?.count >= 1, t?.approvals);
    check('cash KPI carries the bank ledger position in USD', t?.cash?.byCurrency?.some((c: any) => c.currency === 'USD'), t?.cash);
    const lim = await analyst.get('/api/v1/dashboard/today');
    check('a role without portfolio, order and cash permissions gets those sections as null', lim.status === 200 && lim.body.data.ordersWorking === null && lim.body.data.cash === null && lim.body.data.nav === null && lim.body.data.breaks === null, lim.body?.data);
  } finally {
    console.log('\nCleanup');
    try {
      const pid = portfolio.id;
      await prisma.cashReservation.deleteMany({ where: { portfolioId: pid } });
      await prisma.cashJournal.deleteMany({ where: { portfolioId: pid } });
      await prisma.cashExpectation.deleteMany({ where: { portfolioId: pid } });
      await prisma.cashLedger.deleteMany({ where: { portfolioId: pid } });
      await prisma.accJournal.deleteMany({ where: { portfolioId: pid } });
      await prisma.accAccount.deleteMany({ where: { portfolioId: pid } });
      await prisma.accPeriod.deleteMany({ where: { portfolioId: pid } });
      await prisma.navRun.deleteMany({ where: { portfolioId: pid } });
      await prisma.corpActionEntitlement.deleteMany({ where: { portfolioId: pid } });
      await prisma.corpActionEvent.deleteMany({ where: { securityId: sec.id } });
      await prisma.orderFill.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.brokerInstruction.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { portfolioId: pid } });
      await prisma.portfolioPosition.deleteMany({ where: { portfolioId: pid } });
      await prisma.portfolioCash.deleteMany({ where: { portfolioId: pid } });
      await prisma.securityPrice.deleteMany({ where: { securityId: sec.id } });
      await prisma.opsTask.deleteMany({ where: { OR: [{ title: { contains: run } }, { createdBy: { in: userIds } }] } });
      await prisma.portfolio.delete({ where: { id: pid } }).catch(() => undefined);
      await prisma.security.delete({ where: { id: sec.id } }).catch(() => undefined);
      await prisma.broker.delete({ where: { id: broker.id } }).catch(() => undefined);
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch (e) {
      console.log('  (cleanup is best-effort; audit rows and sequences remain)', e instanceof Error ? e.message : e);
    }
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
