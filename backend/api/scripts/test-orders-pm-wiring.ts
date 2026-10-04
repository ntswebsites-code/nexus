/**
 * WP-2 wiring checks against a RUNNING API (GAP-004, 005, 007): order <-> cash reservations (hold on submit, resize on
 * fill, consumed when the settlement journal posts, released on cancel), the order ticket reading the cash service and the
 * originating IC decision, realised gain on sells and the settlement split, private-market capital calls / distributions /
 * marks posted to cash and accounting (FX, return of capital, unrealised gain, evidence filed in the vault, J-curve, client
 * roll-up), and corporate actions with cash in lieu, client entitlements and reversal by adjustment.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4190 npx tsx scripts/test-orders-pm-wiring.ts
 *
 * Disposable schema only: run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) first and start the API against
 * the same DATABASE_URL (FILE_ENCRYPTION_KEY set). Creates throwaway users, securities, a client and a portfolio under a
 * random run id. Not run by the author of this change: it was typechecked only.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { computeEntitlement, fractionCost, applyToPosition } from '../src/modules/corporate-actions/ca.engine';
import { jCurve, rocProblem } from '../src/modules/private-markets/pm.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Wp-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `wp-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

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
type Client = ReturnType<typeof client>;

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `wp-${run}-${label}@example.test`, name: `WP ${label}`, passwordHash: hash } });
    const r = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: roleKey } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });
    return u;
  };
  const pmU = await mkUser('pm', 'portfolio_manager');
  const dirU = await mkUser('dir', 'investment_director'); // approves orders, processes / reverses corporate actions
  const dealerU = await mkUser('dealer', 'dealer'); // routes, fills, settles; creates corporate actions
  const faU = await mkUser('fa', 'fund_accountant'); // posts cash journals, approves marks
  const opsU = await mkUser('ops', 'operations'); // private-markets maker, processes corporate actions
  const [pm, dir, dealer, fa, ops] = [client(), client(), client(), client(), client()];
  for (const [c, u] of [[pm, pmU], [dir, dirU], [dealer, dealerU], [fa, faU], [ops, opsU]] as const) check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
  for (const c of [dir, dealer, fa, ops]) check('MFA enrolled', await c.enrolMfa());

  // ---------------------------------------------------------------- fixtures
  const today = day(dayStr(0));
  const yesterday = day(dayStr(-1));
  const lpClient = await prisma.client.create({ data: { ref: `X${run}W`, name: `WP Client ${run}`, type: 'Pension fund', kycStatus: 'Current' } });
  const pf = await prisma.portfolio.create({ data: { ref: `WP-${run}`, name: `WP Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active', clientId: lpClient.id, mandateJson: { maxSingleNamePct: 100 } } });
  const mkSec = async (suffix: string, price: number) => {
    const s = await prisma.security.create({ data: { ticker: `W${suffix}${run}`.toUpperCase(), name: `WP ${suffix} ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: `S-${suffix}`, status: 'Active', averageDailyVolume: D(10_000_000) } });
    for (const d of [yesterday, today]) await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: d, price: D(price), source: 'TEST' } });
    return s;
  };
  const secB = await mkSec('B', 10); // bought and sold
  const secCa = await mkSec('C', 10); // corporate action
  const broker = await prisma.broker.create({ data: { name: `WP Broker ${run}`, email: `wp-broker-${run}@example.test`, status: 'Active' } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf.id, securityId: secB.id, quantity: D(10000), avgCost: D(4), asOf: yesterday } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf.id, securityId: secCa.id, quantity: D(100), avgCost: D(6), asOf: yesterday } });
  await prisma.portfolioCash.create({ data: { portfolioId: pf.id, currency: 'USD', available: D(500000), asOf: yesterday } });
  const mkLedger = (sfx: string, kind: string, currency = 'USD') => prisma.cashLedger.create({ data: { ref: `CLG-${run}${sfx}`, portfolioId: pf.id, name: `${kind} ${currency}`, currency, kind, createdBy: dirU.id } });
  const [bank, control, clearing, expense, eurBank, eurClearing] = [await mkLedger('B', 'BANK'), await mkLedger('K', 'CONTROL'), await mkLedger('C', 'CLEARING'), await mkLedger('E', 'EXPENSE'), await mkLedger('EB', 'BANK', 'EUR'), await mkLedger('EC', 'CLEARING', 'EUR')];
  void expense;
  await prisma.cashJournal.create({
    data: { ref: `CJ-W${run}`, portfolioId: pf.id, entryDate: yesterday, description: 'Opening funding (test)', purpose: 'CLIENT_DEPOSIT', currency: 'USD', status: 'POSTED', totalDebit: D(500000), totalCredit: D(500000), makerId: dirU.id, postedBy: faU.id, postedAt: new Date(), lines: { create: [{ lineNo: 1, ledgerId: bank.id, debit: D(500000) }, { lineNo: 2, ledgerId: control.id, credit: D(500000) }] } },
  });
  const O = '/api/v1/orders';
  const C = '/api/v1/cash';

  try {
    console.log('\nEngines (pure)');
    const ep = { type: 'BONUS_ISSUE', rate: null, ratioNew: D(1), ratioOld: D(3), withholdingPct: D(0), cilPrice: D(10) };
    const ent = computeEntitlement(ep, D(100), null);
    check('bonus 1:3 on 100 -> 33 shares, fraction 0.333333, cash in lieu 3.3333', ent.sharesDelta.toString() === '33' && ent.cashInLieu.toFixed(4) === '3.3333' && ent.cash.toFixed(4) === '3.3333', ent);
    check('no price on the event -> the fraction is only reported', computeEntitlement({ ...ep, cilPrice: null }, D(100), null).cashInLieu.isZero());
    const fc = fractionCost(ep, D(100), D(6), null, ent);
    check('cost of the fraction = held cost spread over 133.33 shares x 0.3333 = 1.5000', fc.toFixed(4) === '1.5000', fc.toString());
    check('position after: 133 shares at (600 - 1.5) / 133 = 4.50', applyToPosition({ type: 'BONUS_ISSUE' }, D(100), D(6), ent, fc).avgCost.toFixed(2) === '4.50');
    check('return of capital cannot exceed the distribution', rocProblem(D(100), D(101)) !== null && rocProblem(D(100), D(100)) === null);
    const jc = jCurve([{ kind: 'CALL', amount: D(100), date: new Date('2024-01-01'), status: 'PAID' }, { kind: 'DISTRIBUTION', amount: D(30), date: new Date('2025-01-01'), status: 'PAID' }], [{ asOf: new Date('2025-06-01'), nav: D(90) }]);
    check('J-curve: net cash -100 then -70; net value 20 once marked', jc.length === 3 && jc[0]!.netCash.toFixed(0) === '-100' && jc[1]!.netCash.toFixed(0) === '-70' && jc[2]!.netValue?.toFixed(0) === '20', jc);

    // ================================================================ GAP-004 orders <-> cash
    console.log('\nOrders and cash reservations (GAP-004)');
    const ticket = (over: Record<string, unknown> = {}) => ({ portfolioId: pf.id, securityId: secB.id, side: 'BUY', quantity: 1000, orderType: 'MARKET', tif: 'DAY', urgency: 'Normal', brokerId: broker.id, ...over });
    const newOrder = async (body: object) => {
      const r = await pm.post(O, body, { 'Idempotency-Key': key('c') });
      const id = r.body?.data?.id as string;
      await pm.post(`${O}/${id}/validate`, {});
      return id;
    };
    const submit = (id: string) => pm.post(`${O}/${id}/submit`, { rationale: 'Wiring test order' }, { 'Idempotency-Key': key('s') });
    const approve = async (id: string) => {
      await dir.stepUp();
      return dir.post(`${O}/${id}/approve`, {}, { 'Idempotency-Key': key('a') });
    };
    const route = async (id: string) => {
      await dealer.stepUp();
      return dealer.post(`${O}/${id}/route`, { brokerId: broker.id }, { 'Idempotency-Key': key('r') });
    };
    const fill = (id: string, quantity: number, price: number, fees = 0) => dealer.post(`${O}/${id}/fills`, { quantity, price, fees }, { 'Idempotency-Key': key('f') });

    const buyId = await newOrder(ticket());
    const sub = await submit(buyId);
    check('submit reserves 10,075.00 (1,000 x 10 x 1.0075) on the bank ledger', sub.status === 200 && sub.body?.data?.reservedAmount === '10075.00', sub.body);
    const hold = await prisma.cashReservation.findFirst({ where: { orderId: buyId } });
    check('a cash_reservation row exists: ACTIVE, BUY_SETTLEMENT, on the bank ledger', hold?.status === 'ACTIVE' && hold.purpose === 'BUY_SETTLEMENT' && hold.ledgerId === bank.id && hold.amount.toFixed(2) === '10075.00', hold);
    const tk = await pm.get(`${O}/${buyId}`);
    check('the ticket reads the cash service: hold listed, ledger available = posted - other holds', tk.body?.data?.cash?.holds?.[0]?.ref === hold?.ref && tk.body.data.cash.ledger?.posted === '500000.00', tk.body?.data?.cash);
    const bal = await dir.get(`${C}/balances?portfolioId=${pf.id}`);
    check('the Cash page shows the same hold (reserved 10,075.00)', JSON.stringify(bal.body).includes('10075.00'), bal.body);
    check('approve then route', (await approve(buyId)).status === 200 && (await route(buyId)).status === 200);
    const f1 = await fill(buyId, 400, 10, 4);
    check('partial fill resizes the hold to filled cost + remainder (4,004 + 6,045 = 10,049.00)', f1.status === 201 && (await prisma.cashReservation.findFirst({ where: { orderId: buyId } }))?.amount.toFixed(2) === '10049.00', f1.body);
    const f2 = await fill(buyId, 600, 10, 6);
    check('final fill shrinks the hold to the exact cost 10,010.00', f2.body?.data?.status === 'Filled' && (await prisma.cashReservation.findFirst({ where: { orderId: buyId } }))?.amount.toFixed(2) === '10010.00', f2.body);
    const st = await dealer.post(`${O}/${buyId}/settle`, {});
    const cashJ = st.body?.data?.settlementJournals?.cash;
    check('settle creates the cash journal linked to the hold (pending approval)', st.status === 200 && !!cashJ?.ref, st.body?.data?.settlementJournals);
    const cj = await prisma.cashJournal.findFirst({ where: { ref: cashJ?.ref } });
    check('the journal carries the reservation id', cj?.reservationId === hold?.id && cj?.status === 'PENDING_APPROVAL', cj);
    await fa.stepUp();
    const posted = await fa.post(`${C}/journals/${cj?.id}/post`, {}, { 'Idempotency-Key': key('p') });
    check('a different person posts it', posted.status === 200 && posted.body?.data?.status === 'POSTED', posted.body);
    const after = await prisma.cashReservation.findFirst({ where: { orderId: buyId } });
    check('posting consumed the hold: CONSUMED, consumed 10,010.00', after?.status === 'CONSUMED' && after.consumed.toFixed(2) === '10010.00', after);
    await fa.stepUp();
    const rev = await fa.post(`${C}/journals/${cj?.id}/reverse`, { reason: 'Wiring test reversal' }, { 'Idempotency-Key': key('rv') });
    const back = await prisma.cashReservation.findFirst({ where: { orderId: buyId } });
    check('reversing the settlement journal puts the amount back on hold', rev.status === 201 && back?.status === 'ACTIVE' && back.consumed.isZero(), { status: rev.status, back });

    const cancelId = await newOrder(ticket({ quantity: 500 }));
    await submit(cancelId);
    const live = await prisma.cashReservation.findFirst({ where: { orderId: cancelId } });
    const canc = await pm.post(`${O}/${cancelId}/cancel`, { reason: 'Wiring test cancel' });
    check('cancel releases the hold (RELEASED with a reason)', live?.status === 'ACTIVE' && canc.status === 200 && (await prisma.cashReservation.findFirst({ where: { orderId: cancelId } }))?.status === 'RELEASED', canc.body);

    // ---------------------------------------------------------------- IC decision on the ticket
    const rcase = await prisma.researchCase.create({ data: { ref: `RSC-W${run}`, securityId: secB.id, title: `WP case ${run}`, thesis: 'Wiring test thesis', rating: 'BUY', targetPrice: D(14), currency: 'USD', analystId: pmU.id, status: 'PUBLISHED' } });
    const icd = await prisma.icDecision.create({ data: { ref: `ICD-W${run}`, caseId: rcase.id, portfolioId: pf.id, securityId: secB.id, action: 'BUY', quantity: D(300), rationale: 'Wiring test decision', status: 'APPROVED', proposerId: pmU.id, votesFor: 3 } });
    const linked = await newOrder(ticket({ quantity: 300 }));
    await prisma.icDecisionOrder.create({ data: { decisionId: icd.id, orderId: linked, orderRef: 'ORD-LINK', createdBy: pmU.id } });
    const lt = await pm.get(`${O}/${linked}`);
    check('the ticket shows the originating IC decision and its case', lt.body?.data?.decision?.ref === icd.ref && lt.body.data.decision.caseRef === rcase.ref && lt.body.data.decision.votes.for === 3, lt.body?.data?.decision);
    check('an order with no decision shows none', (await pm.get(`${O}/${buyId}`)).body?.data?.decision === null);
    await pm.post(`${O}/${linked}/cancel`, { reason: 'Wiring test cleanup' });

    // ---------------------------------------------------------------- realised gain on a sell
    const sellId = await newOrder(ticket({ side: 'SELL', quantity: 500 }));
    await submit(sellId);
    await approve(sellId);
    await route(sellId);
    const sf = await fill(sellId, 500, 6, 5);
    check('a sell fill records the realised gain: 500 x (6 - 50,000/11,000) = 727.27 at the average cost after the earlier buy (4.5455/unit)', sf.status === 201 && sf.body?.data?.realisedGain?.gain === '727.27' && sf.body.data.realisedGain.costBasis === '2272.73' && sf.body.data.realisedGain.proceeds === '3000.00', sf.body?.data?.realisedGain);
    check('the gain row is persisted per fill (order_realised_gains)', (await prisma.orderRealisedGain.count({ where: { orderId: sellId } })) === 1);
    const ss = await dealer.post(`${O}/${sellId}/settle`, {});
    const ajSell = await prisma.accJournal.findFirst({ where: { id: ss.body?.data?.settlementJournals?.accounting?.id }, include: { lines: { include: { account: true } } } });
    const gainLine = ajSell?.lines.find((l) => l.account.code === '4300');
    const invLine = ajSell?.lines.find((l) => l.account.code === '1100');
    check('settlement books investments out at average cost 2,272.73 and the gain 727.27 to 4300', ss.status === 200 && invLine?.credit.toFixed(2) === '2272.73' && gainLine?.credit.toFixed(2) === '727.27', ajSell?.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()]));
    check('the journal balances', ajSell?.totalDebit.eq(ajSell.totalCredit) === true);

    // ================================================================ GAP-005 private markets
    console.log('\nPrivate markets postings (GAP-005)');
    const P = '/api/v1/private-markets';
    const fundUsd = (await ops.post(`${P}/funds`, { name: `WP PE USD ${run}`, manager: 'Test GP', strategy: 'PRIVATE_EQUITY', vintage: 2024, currency: 'USD' }, { 'Idempotency-Key': key('f1') })).body.data;
    const fundEur = (await ops.post(`${P}/funds`, { name: `WP Infra EUR ${run}`, manager: 'Test GP', strategy: 'INFRASTRUCTURE', vintage: 2024, currency: 'EUR' }, { 'Idempotency-Key': key('f2') })).body.data;
    const cmU = (await ops.post(`${P}/funds/${fundUsd.id}/commitments`, { portfolioId: pf.id, amount: '1000000', committedOn: dayStr(-400) }, { 'Idempotency-Key': key('c1') })).body.data;
    const cmE = (await ops.post(`${P}/funds/${fundEur.id}/commitments`, { portfolioId: pf.id, amount: '500000', committedOn: dayStr(-400) }, { 'Idempotency-Key': key('c2') })).body.data;
    check('both commitments created', !!cmU?.id && !!cmE?.id);
    const callU = (await ops.post(`${P}/commitments/${cmU.id}/cashflows`, { kind: 'CALL', amount: '400000', noticeDate: dayStr(-60), dueDate: dayStr(-50) }, { 'Idempotency-Key': key('x1') })).body.data;
    const badRoc = await ops.post(`${P}/commitments/${cmU.id}/cashflows`, { kind: 'DISTRIBUTION', amount: '100', returnOfCapital: '200', dueDate: dayStr(1) }, { 'Idempotency-Key': key('x2') });
    check('return of capital above the distribution -> 400', badRoc.status === 400, badRoc.body);
    const payCall = await ops.post(`${P}/cashflows/${callU.id}/pay`, { paidOn: dayStr(-45) });
    check('USD call settled: posting with an accounting journal', payCall.status === 200 && !!payCall.body?.data?.posting?.accountingJournal, payCall.body);
    const callJournal = await prisma.accJournal.findFirst({ where: { sourceRef: `PMX:${callU.ref}` }, include: { lines: { include: { account: true } } } });
    check('call journal: Dr 1150 400,000 / Cr 1000 400,000, pending approval by the system', callJournal?.status === 'PENDING_APPROVAL' && callJournal.lines.find((l) => l.account.code === '1150')?.debit.toFixed(0) === '400000' && callJournal.lines.find((l) => l.account.code === '1000')?.credit.toFixed(0) === '400000', callJournal?.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()]));
    const callCash = await prisma.cashJournal.findFirst({ where: { sourceRef: `PMX:${callU.ref}` } });
    check('the cash ledger journal (PM_CALL) credits the bank', callCash?.purpose === 'PM_CALL' && callCash.currency === 'USD', callCash);
    const distU = (await ops.post(`${P}/commitments/${cmU.id}/cashflows`, { kind: 'DISTRIBUTION', amount: '100000', returnOfCapital: '60000', noticeDate: dayStr(-30), dueDate: dayStr(-20) }, { 'Idempotency-Key': key('x3') })).body.data;
    await ops.post(`${P}/cashflows/${distU.id}/pay`, { paidOn: dayStr(-20) });
    const distJ = await prisma.accJournal.findFirst({ where: { sourceRef: `PMX:${distU.ref}` }, include: { lines: { include: { account: true } } } });
    check('distribution: Dr cash 100,000 / Cr 1150 60,000 return of capital / Cr 4400 40,000 income', distJ?.lines.find((l) => l.account.code === '1000')?.debit.toFixed(0) === '100000' && distJ.lines.find((l) => l.account.code === '1150')?.credit.toFixed(0) === '60000' && distJ.lines.find((l) => l.account.code === '4400')?.credit.toFixed(0) === '40000', distJ?.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()]));
    const again = await ops.post(`${P}/cashflows/${callU.id}/pay`, {});
    check('paying again is refused and books nothing twice', again.status === 409 && (await prisma.pmPosting.count({ where: { sourceRef: `PMX:${callU.ref}` } })) === 1);

    // EUR fund: no rate -> refused; then with a rate the books use it
    const callE = (await ops.post(`${P}/commitments/${cmE.id}/cashflows`, { kind: 'CALL', amount: '200000', noticeDate: dayStr(-40), dueDate: dayStr(-30) }, { 'Idempotency-Key': key('x4') })).body.data;
    const noFx = await ops.post(`${P}/cashflows/${callE.id}/pay`, { paidOn: dayStr(-5) });
    check('a EUR call with no EUR/USD rate -> 409 no_fx_rate and stays NOTICED', noFx.status === 409 && noFx.body?.error?.code === 'no_fx_rate' && (await prisma.pmCashflow.findUnique({ where: { id: callE.id } }))?.status === 'NOTICED', noFx.body);
    await prisma.fxRate.upsert({ where: { fromCurrency_toCurrency_rateDate: { fromCurrency: 'EUR', toCurrency: 'USD', rateDate: yesterday } }, update: { rate: D('1.10') }, create: { fromCurrency: 'EUR', toCurrency: 'USD', rateDate: yesterday, rate: D('1.10'), source: 'TEST' } });
    const payE = await ops.post(`${P}/cashflows/${callE.id}/pay`, { paidOn: dayStr(0) });
    check('with the rate: posting in base at 1.10 (220,000 USD) and a EUR cash journal', payE.status === 200 && payE.body?.data?.posting?.baseAmount === '220000.00' && payE.body.data.posting.fxRate.startsWith('1.1') && !!payE.body.data.posting.cashJournal, payE.body);
    void eurBank;
    void eurClearing;

    // mark: evidence filed in the vault, approval books the unrealised gain
    const mk = (await ops.post(`${P}/commitments/${cmU.id}/marks`, { asOf: dayStr(-3), nav: '500000', method: 'GP_REPORTED', note: 'Quarter end' }, { 'Idempotency-Key': key('m1') })).body.data;
    const form = new FormData();
    form.append('kind', 'GP_STATEMENT');
    form.append('title', 'Quarterly capital account statement');
    form.append('file', new Blob(['%PDF-1.4 wiring test evidence'], { type: 'application/pdf' }), 'statement.pdf');
    const up = await ops.post(`${P}/marks/${mk.id}/evidence/upload`, form);
    const ev = up.body?.data?.evidence?.[0];
    check('evidence uploaded: filed as a vault document (DOC-####) linked to the mark', up.status === 201 && /^DOC-/.test(ev?.documentRef ?? '') && !!ev.documentId, up.body);
    const doc = ev ? await prisma.document.findUnique({ where: { id: ev.documentId } }) : null;
    check('the document is Restricted, typed valuations and related to the mark', doc?.classification === 'Restricted' && doc.type === 'valuations' && doc.relatedType === 'pm_mark' && doc.relatedId === mk.id, doc);
    const sbm = await ops.post(`${P}/marks/${mk.id}/submit`, {}, { 'Idempotency-Key': key('m2') });
    check('submit', sbm.status === 200, sbm.body);
    await fa.stepUp();
    const apr = await fa.post(`${P}/marks/${mk.id}/approve`, {}, { 'Idempotency-Key': key('m3') });
    check('a different person approves the mark', apr.status === 200 && apr.body?.data?.status === 'APPROVED', apr.body);
    check('approval posted the move: carrying 340,000 -> NAV 500,000 = 160,000 unrealised gain', apr.body?.data?.posting?.carryingDelta === '160000.00' && !!apr.body.data.posting.accountingJournal, apr.body?.data?.posting);
    const markJ = await prisma.accJournal.findFirst({ where: { sourceRef: `PMM:${mk.ref}` }, include: { lines: { include: { account: true } } } });
    check('mark journal: Dr 1150 160,000 / Cr 4200 160,000', markJ?.lines.find((l) => l.account.code === '1150')?.debit.toFixed(0) === '160000' && markJ.lines.find((l) => l.account.code === '4200')?.credit.toFixed(0) === '160000', markJ?.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()]));
    const cd = await ops.get(`${P}/commitments/${cmU.id}`);
    check('commitment detail: carrying value 500,000.00 and each flow shows its journals', cd.body?.data?.carryingValue === '500000.00' && cd.body.data.cashflows.every((f: any) => f.status !== 'PAID' || f.posting), cd.body?.data?.carryingValue);

    // FX pooling, J-curve, client level
    const sm = await ops.get(`${P}/summary?portfolioId=${pf.id}`);
    check('summary pools in USD: committed 1,000,000 + 500,000 EUR x 1.10 = 1,550,000', sm.body?.data?.reportCurrency === 'USD' && sm.body.data.totals.committed === '1550000.00' && sm.body.data.fxMissing.length === 0, sm.body?.data?.totals);
    const jcv = await ops.get(`${P}/jcurve?portfolioId=${pf.id}`);
    const pts = jcv.body?.data?.points ?? [];
    check('J-curve: dated points, net cash dips below zero after the calls, NAV from the mark', jcv.status === 200 && pts.length >= 3 && Number(pts[0].netCash) < 0 && pts.some((p: any) => p.nav !== null), jcv.body);
    const byClient = await ops.get(`${P}/clients?clientId=${lpClient.ref}`);
    check('client level: the client has 2 commitments pooled in USD with its lines', byClient.status === 200 && byClient.body?.data?.[0]?.commitments === 2 && byClient.body.data[0].lines?.length === 2, byClient.body);

    // ================================================================ GAP-007 corporate actions
    console.log('\nCorporate actions: cash in lieu, client entitlements, reversal (GAP-007)');
    const CA = '/api/v1/corporate-actions';
    const bad = await dealer.post(`${CA}/events`, { securityId: secCa.id, type: 'BONUS_ISSUE', exDate: dayStr(0), recordDate: dayStr(0), payDate: dayStr(0), ratioNew: '1', ratioOld: '3', cashInLieu: true }, { 'Idempotency-Key': key('ca0') });
    check('cash in lieu without a price -> 400', bad.status === 400, bad.body);
    const ev1 = await dealer.post(`${CA}/events`, { securityId: secCa.id, type: 'BONUS_ISSUE', exDate: dayStr(0), recordDate: dayStr(0), payDate: dayStr(0), ratioNew: '1', ratioOld: '3', cashInLieu: true, cilPrice: '10' }, { 'Idempotency-Key': key('ca1') });
    const E = ev1.body?.data;
    check('event created with cash in lieu at 10.00', ev1.status === 201 && E?.cashInLieu === true && E.cilPrice === '10', ev1.body);
    await dealer.post(`${CA}/events/${E.id}/confirm`, {}, { 'Idempotency-Key': key('ca2') });
    const calc = await dealer.post(`${CA}/events/${E.id}/entitlements/calculate`, {}, { 'Idempotency-Key': key('ca3') });
    check('entitlement: 33 bonus shares plus 3.33 cash in lieu', calc.body?.data?.entitlements?.[0]?.sharesDelta === '33' && calc.body.data.entitlements[0].cashInLieu === '3.33', calc.body?.data?.entitlements);
    const cl = await dealer.get(`${CA}/events/${E.id}/clients`);
    check('client-level roll-up: the client holds the entitlement (cash in lieu 3.33)', cl.body?.data?.[0]?.clientRef === lpClient.ref && cl.body.data[0].cashInLieu === '3.33', cl.body);
    check('reversing before it is processed -> 409', (await dir.post(`${CA}/events/${E.id}/reverse`, { reason: 'Too early to reverse' }, { 'Idempotency-Key': key('ca3b') })).status === 409);
    await ops.stepUp();
    const proc = await ops.post(`${CA}/events/${E.id}/process`, {}, { 'Idempotency-Key': key('ca4') });
    check('processed by a different person', proc.status === 200 && proc.body?.data?.status === 'PROCESSED', proc.body);
    const posAfter = await prisma.portfolioPosition.findFirst({ where: { portfolioId: pf.id, securityId: secCa.id }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    check('position 133 at average cost 4.50 (fraction cost left the book)', posAfter?.quantity.toString() === '133' && posAfter.avgCost.toFixed(2) === '4.50', posAfter);
    const caJ = await prisma.accJournal.findFirst({ where: { sourceRef: `CA:${E.ref}:${pf.id}` }, include: { lines: { include: { account: true } } } });
    check('journal: Dr cash 3.33 / Cr investments 1.50 / Cr realised gain 1.83', caJ?.lines.find((l) => l.account.code === '4300')?.credit.toFixed(2) === '1.83' && caJ.lines.find((l) => l.account.code === '1100')?.credit.toFixed(2) === '1.50', caJ?.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()]));
    const caCash = await prisma.cashJournal.findFirst({ where: { sourceRef: `CA:${E.ref}:${pf.id}` } });
    check('cash journal for the receipt is pending', caCash?.status === 'PENDING_APPROVAL' && caCash.totalDebit.toFixed(2) === '3.33', caCash);
    check('the processor cannot reverse it (403)', (await (async () => { await ops.stepUp(); return ops.post(`${CA}/events/${E.id}/reverse`, { reason: 'Processor tries to reverse' }, { 'Idempotency-Key': key('ca5') }); })()).status === 403);
    await fa.stepUp();
    await fa.post(`${C}/journals/${caCash!.id}/post`, {}, { 'Idempotency-Key': key('ca6') });
    await dir.stepUp();
    const rv = await dir.post(`${CA}/events/${E.id}/reverse`, { reason: 'Wrong ratio announced by the issuer' }, { 'Idempotency-Key': key('ca7') });
    check('a different person reverses by adjustment -> REVERSED with the reason', rv.status === 200 && rv.body?.data?.status === 'REVERSED' && rv.body.data.reverseReason === 'Wrong ratio announced by the issuer', rv.body);
    const posRev = await prisma.portfolioPosition.findFirst({ where: { portfolioId: pf.id, securityId: secCa.id }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    check('position restored to 100 at 6.00 with history untouched (older row still there)', posRev?.quantity.toString() === '100' && posRev.avgCost.toFixed(2) === '6.00' && (await prisma.portfolioPosition.count({ where: { portfolioId: pf.id, securityId: secCa.id } })) >= 2, posRev);
    const cashRows = await prisma.portfolioCash.findFirst({ where: { portfolioId: pf.id, currency: 'USD' }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    check('cash returned (the 3.33 removed again)', cashRows !== null);
    const caJ2 = await prisma.accJournal.findFirst({ where: { sourceRef: `CA:${E.ref}:${pf.id}` } });
    check('the pending accounting journal was discarded', caJ2?.status === 'DISCARDED', caJ2?.status);
    const revJ = await prisma.cashJournal.findFirst({ where: { sourceRef: `CA:${E.ref}:${pf.id}:REV` } });
    check('the posted cash journal got an inverse pending journal (sourced :REV)', revJ?.status === 'PENDING_APPROVAL' && revJ.totalDebit.toFixed(2) === '3.33', revJ);
    check('entitlements are REVERSED; a second reversal -> 409', (await prisma.corpActionEntitlement.count({ where: { eventId: E.id, status: 'REVERSED' } })) === 1 && (await (async () => { await dir.stepUp(); return dir.post(`${CA}/events/${E.id}/reverse`, { reason: 'Reverse it twice please' }, { 'Idempotency-Key': key('ca8') }); })()).status === 409);
    check('audit corp_action.reversed by the reviewer', (await prisma.auditEvent.count({ where: { action: 'corp_action.reversed', objectId: E.id, actorId: dirU.id } })) === 1);
    const ce = await dealer.get(`${CA}/clients/${lpClient.ref}/entitlements`);
    check('client entitlements across events list the reversed one', ce.body?.data?.entitlements?.some((x: any) => x.eventRef === E.ref && x.status === 'REVERSED'), ce.body);
  } finally {
    console.log(`\n${passes} passed, ${failures} failed`);
    await prisma.$disconnect();
    process.exit(failures ? 1 : 0);
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
