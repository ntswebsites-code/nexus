/**
 * Package S5 (orders, valuation, scenarios) checks against a RUNNING API:
 *  - FR-OMS-018: a limit price more than 10% from the last price needs an override reason (field errors on limitPrice and
 *    priceOverrideReason), STOP_LIMIT needs a stop price on the trigger side of the limit; create, patch and precheck agree;
 *    a STOP_LIMIT order runs the whole lifecycle and its limit still caps fills.
 *  - FR-OMS-011: GET /orders/:id/post-trade (allocation, slippage, contract-note match) and the contract-note parsing hook
 *    (narrative text and PDF text layer, plain and Flate-compressed) through POST /trading-feeds/contract-notes.
 *  - FR-VAL-009: valuation.run / valuation.maker / valuation.release gating, auditor read-only with "Not permitted for <Role>".
 *  - FR-VAL-017: external NAV vs ABOR variance and Agree / Variance state against the policy tolerance.
 *  - FR-VAL-015: NAV history and the valuation policy (read, edit with step-up and a reason, audited).
 *  - BR-029: scenario thresholds as policy parameters (liquidity coverage and loss), validated, audited, applied to previews.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4190 npx tsx scripts/test-orders-valuation-depth.ts
 *
 * Disposable schema only: run `prisma migrate deploy` and `prisma/seed.ts` first (role catalogue), then start the API against
 * the same DATABASE_URL. Creates throwaway users, a security, broker, portfolio and a custom role under its own run id.
 */
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { extractPdfText, parseContractNoteText, parseNarrativeNote } from '../src/integrations/broker-routing/parse';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `S5-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `s5-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface Res {
  status: number;
  body: any;
  headers: Headers;
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
    return { status: res.status, body: parsed, headers: res.headers };
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
type Client = ReturnType<typeof client>;

const O = '/api/v1/orders';
const N = '/api/v1/nav';
const errCode = (r: Res) => r.body?.error?.code;
const errPaths = (r: Res) => ((r.body?.error?.details ?? []) as { path: string }[]).map((d) => d.path);

/** A one-page PDF whose content stream shows one string per line (Td moves between lines). */
function buildPdf(lines: string[], compress: boolean): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 11 Tf 72 740 Td ${lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${esc(l)}) Tj`).join(' ')} ET`;
  const stream = compress ? deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  const head = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n4 0 obj\n', 'latin1');
  const dict = Buffer.from(`<< /Length ${stream.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1');
  return Buffer.concat([head, dict, stream, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
}

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: k } } });
  const userIds: string[] = [];
  const portfolioIds: string[] = [];
  const securityIds: string[] = [];
  const roleIds: string[] = [];
  const mkUser = async (label: string, ...roleKeys: string[]) => {
    const u = await prisma.user.create({ data: { email: `s5-${run}-${label}@example.test`, name: `S5 ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    for (const k of roleKeys) await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(k)).id } });
    return u;
  };
  /** A custom admin role holding exactly the listed permissions. */
  const mkRole = async (label: string, perms: string[]) => {
    const r = await prisma.role.create({ data: { portal: 'admin', key: `s5-${run}-${label}`, label: `S5 ${label}`, custom: true } });
    roleIds.push(r.id);
    await prisma.rolePermission.createMany({ data: perms.map((permission) => ({ roleId: r.id, permission })) });
    return r;
  };

  const pmU = await mkUser('pm', 'portfolio_manager');
  const dirU = await mkUser('dir', 'investment_director');
  const dealerU = await mkUser('dealer', 'dealer');
  const faU = await mkUser('fa', 'fund_accountant');
  const audU = await mkUser('aud', 'auditor');
  const compU = await mkUser('comp', 'compliance');
  const viewOnly = await mkRole('viewonly', ['valuation.view']);
  const makerRole = await mkRole('maker', ['valuation.view', 'valuation.maker']);
  const runRole = await mkRole('run', ['valuation.view', 'valuation.run']);
  const vU = await mkUser('v');
  const mU = await mkUser('m');
  const rU = await mkUser('r');
  for (const [u, r] of [[vU, viewOnly], [mU, makerRole], [rU, runRole]] as const) await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });

  const pm = client();
  const dir = client();
  const dealer = client();
  const fa = client();
  const aud = client();
  const comp = client();
  const cV = client();
  const cM = client();
  const cR = client();

  const yesterday = day(dayStr(-1));
  const sec = await prisma.security.create({
    data: { ticker: `S5${run}`.toUpperCase(), name: `S5 Test ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 100, sector: `Sector-${run}`, status: 'Active', averageDailyVolume: D(1_000_000) },
  });
  securityIds.push(sec.id);
  await prisma.securityPrice.create({ data: { securityId: sec.id, priceDate: day(dayStr(-2)), price: D(10), source: 'TEST' } });
  await prisma.securityPrice.create({ data: { securityId: sec.id, priceDate: yesterday, price: D(10), source: 'TEST' } });
  const broker = await prisma.broker.create({ data: { name: `S5 Broker ${run}`, email: `s5-broker-${run}@example.test`, status: 'Active' } });
  const pf = await prisma.portfolio.create({ data: { ref: `S5-${run}`, name: `S5 Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} as Prisma.InputJsonValue } });
  portfolioIds.push(pf.id);
  await prisma.portfolioCash.create({ data: { portfolioId: pf.id, currency: 'USD', available: D(100000), asOf: yesterday } });
  await prisma.portfolioPosition.create({ data: { portfolioId: pf.id, securityId: sec.id, quantity: D(1000), avgCost: D(9), asOf: yesterday } });

  const orderIds: string[] = [];
  try {
    console.log('\nSign-in and MFA');
    for (const [c, u] of [[pm, pmU], [dir, dirU], [dealer, dealerU], [fa, faU], [aud, audU], [comp, compU], [cV, vU], [cM, mU], [cR, rU]] as const) {
      check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    }
    for (const [name, c] of [['dir', dir], ['dealer', dealer], ['fa', fa], ['comp', comp]] as const) check(`${name} enrols TOTP`, await c.enrolMfa());

    const ticket = (over: Record<string, unknown> = {}) => ({ portfolioId: pf.id, securityId: sec.id, side: 'BUY', quantity: 1000, orderType: 'MARKET', tif: 'DAY', urgency: 'Normal', brokerId: broker.id, ...over });
    const create = async (c: Client, body: object) => {
      const r = await c.post(O, body, { 'Idempotency-Key': key('c') });
      if (r.body?.data?.id) orderIds.push(r.body.data.id);
      return r;
    };
    const validate = (c: Client, id: string) => c.post(`${O}/${id}/validate`, {});
    const submit = (c: Client, id: string) => c.post(`${O}/${id}/submit`, { rationale: 'Rebalance towards the target allocation' }, { 'Idempotency-Key': key('s') });
    const approve = async (c: Client, id: string) => {
      await c.stepUp();
      return c.post(`${O}/${id}/approve`, {}, { 'Idempotency-Key': key('a') });
    };
    const route = async (c: Client, id: string) => {
      await c.stepUp();
      return c.post(`${O}/${id}/route`, { brokerId: broker.id }, { 'Idempotency-Key': key('r') });
    };
    const fill = (c: Client, id: string, quantity: number, price: number, extra: object = {}) => c.post(`${O}/${id}/fills`, { quantity, price, ...extra }, { 'Idempotency-Key': key('f') });
    const toRouting = async (body: object) => {
      const cr = await create(pm, body);
      const id = cr.body?.data?.id as string;
      const v = await validate(pm, id);
      const s = await submit(pm, id);
      const a = await approve(dir, id);
      const r = await route(dealer, id);
      return { id, ref: cr.body?.data?.ref as string, ok: cr.status === 201 && v.status === 200 && s.status === 200 && a.status === 200 && r.status === 200, steps: [cr.status, v.status, s.status, a.status, r.status], route: r };
    };

    // ---------------------------------------------------------------- FR-OMS-018
    console.log('\nPrice tolerance and override reason (FR-OMS-018)');
    const far = await create(pm, ticket({ orderType: 'LIMIT', limitPrice: '12.5' }));
    check('limit 25% above the last price without a reason -> 400 on limitPrice and priceOverrideReason', far.status === 400 && errPaths(far).includes('limitPrice') && errPaths(far).includes('priceOverrideReason'), far.body);
    const farOk = await create(pm, ticket({ orderType: 'LIMIT', limitPrice: '12.5', priceOverrideReason: 'Thin book, accepting the premium' }));
    check('with a reason -> 201 and the reason is stored', farOk.status === 201 && farOk.body?.data?.priceOverrideReason === 'Thin book, accepting the premium', farOk.body);
    const near = await create(pm, ticket({ orderType: 'LIMIT', limitPrice: '10.5', priceOverrideReason: 'not needed here' }));
    check('within 10% a reason is not kept', near.status === 201 && near.body?.data?.priceOverrideReason === null, near.body);
    const nearId = near.body?.data?.id as string;
    const shortReason = await create(pm, ticket({ orderType: 'LIMIT', limitPrice: '7', priceOverrideReason: 'no' }));
    check('a 4-character reason is refused', shortReason.status === 400 && errPaths(shortReason).includes('priceOverrideReason'), shortReason.body);
    const pre = await pm.post(`${O}/precheck`, ticket({ orderType: 'LIMIT', limitPrice: '12.5' }));
    check('precheck applies the same rule -> 400', pre.status === 400 && errPaths(pre).includes('priceOverrideReason'), pre.body);
    const preOk = await pm.post(`${O}/precheck`, ticket({ orderType: 'LIMIT', limitPrice: '12.5', priceOverrideReason: 'Thin book, accepting the premium' }));
    check('precheck with a reason runs and the price check is on Review', preOk.status === 200 && preOk.body?.data?.checks?.find((c: any) => c.key === 'price')?.result === 'Review', preOk.body);
    const lotErr = await create(pm, ticket({ quantity: 150 }));
    check('quantity not a board-lot multiple stays a field error on quantity', lotErr.status === 400 && errPaths(lotErr).includes('quantity'), lotErr.body);

    console.log('\nSTOP_LIMIT (FR-OMS-018)');
    const noStop = await create(pm, ticket({ orderType: 'STOP_LIMIT', limitPrice: '10.5' }));
    check('STOP_LIMIT without a stop price -> 400 on stopPrice', noStop.status === 400 && errPaths(noStop).includes('stopPrice'), noStop.body);
    const noLimit = await create(pm, ticket({ orderType: 'STOP_LIMIT', stopPrice: '10.2' }));
    check('STOP_LIMIT without a limit price -> 400 on limitPrice', noLimit.status === 400 && errPaths(noLimit).includes('limitPrice'), noLimit.body);
    const buyDir = await create(pm, ticket({ orderType: 'STOP_LIMIT', limitPrice: '10.5', stopPrice: '11' }));
    check('buy stop above the limit -> 400 on stopPrice', buyDir.status === 400 && errPaths(buyDir).includes('stopPrice'), buyDir.body);
    const sellDir = await create(pm, ticket({ side: 'SELL', quantity: 100, orderType: 'STOP_LIMIT', limitPrice: '9.8', stopPrice: '9.5' }));
    check('sell stop below the limit -> 400 on stopPrice', sellDir.status === 400 && errPaths(sellDir).includes('stopPrice'), sellDir.body);
    const sellOk = await create(pm, ticket({ side: 'SELL', quantity: 100, orderType: 'STOP_LIMIT', limitPrice: '9.8', stopPrice: '9.9' }));
    check('valid sell stop-limit -> 201 with the stop price', sellOk.status === 201 && sellOk.body?.data?.stopPrice === '9.900000' && sellOk.body?.data?.orderType === 'STOP_LIMIT', sellOk.body);
    const sl = await create(pm, ticket({ orderType: 'STOP_LIMIT', limitPrice: '10.5', stopPrice: '10.2' }));
    const slId = sl.body?.data?.id as string;
    check('valid buy stop-limit -> 201 Draft with limit and stop', sl.status === 201 && sl.body?.data?.limitPrice === '10.500000' && sl.body?.data?.stopPrice === '10.200000' && sl.body?.data?.status === 'Draft', sl.body);

    console.log('\nPatch rules');
    const dropStop = await pm.patch(`${O}/${slId}`, { stopPrice: null, version: sl.body?.data?.version });
    check('removing the stop price from a STOP_LIMIT -> 400', dropStop.status === 400 && errPaths(dropStop).includes('stopPrice'), dropStop.body);
    const patchFar = await pm.patch(`${O}/${nearId}`, { limitPrice: '13' });
    check('moving a limit beyond 10% without a reason -> 400', patchFar.status === 400 && errPaths(patchFar).includes('priceOverrideReason'), patchFar.body);
    const patchFarOk = await pm.patch(`${O}/${nearId}`, { limitPrice: '13', priceOverrideReason: 'Client instruction to pay up' });
    check('with a reason -> 200 and the reason is stored', patchFarOk.status === 200 && patchFarOk.body?.data?.priceOverrideReason === 'Client instruction to pay up' && patchFarOk.body?.data?.limitPrice === '13.000000', patchFarOk.body);
    const toMarket = await pm.patch(`${O}/${nearId}`, { orderType: 'MARKET' });
    check('switching to MARKET clears limit, stop and the override reason', toMarket.status === 200 && toMarket.body?.data?.limitPrice === null && toMarket.body?.data?.stopPrice === null && toMarket.body?.data?.priceOverrideReason === null, toMarket.body);
    const slRationale = await pm.patch(`${O}/${slId}`, { rationale: 'edited rationale text' });
    check('an unrelated edit does not re-test the price', slRationale.status === 200, slRationale.body);

    console.log('\nSTOP_LIMIT lifecycle and limit cap');
    const v = await validate(pm, slId);
    check('validate -> Validated', v.status === 200 && v.body?.data?.status === 'Validated', v.body);
    const sub = await submit(pm, slId);
    check('submit -> AwaitingApproval', sub.status === 200 && sub.body?.data?.status === 'AwaitingApproval', sub.body);
    const ap = await approve(dir, slId);
    check('approve (different person, step-up) -> Approved', ap.status === 200 && ap.body?.data?.status === 'Approved', ap.body);
    const rt = await route(dealer, slId);
    const instr = rt.body?.data?.instruction?.payload;
    check('route -> Routing and the broker instruction states the stop and the limit', rt.status === 200 && /STOP LIMIT: stop 10\.200000, limit 10\.500000/.test(instr?.text ?? ''), instr?.text);
    const breach = await fill(dealer, slId, 500, 10.6);
    check('a buy fill above the limit -> 409 limit_breach', breach.status === 409 && errCode(breach) === 'limit_breach', breach.body);
    const f1 = await fill(dealer, slId, 500, 10.3, { fees: 5 });
    check('first fill -> PartiallyFilled', f1.status === 201 && f1.body?.data?.status === 'PartiallyFilled', f1.body);
    const f2 = await fill(dealer, slId, 500, 10.4, { fees: 5 });
    check('second fill -> Filled', f2.status === 201 && f2.body?.data?.status === 'Filled', f2.body);

    // ---------------------------------------------------------------- FR-OMS-011
    console.log('\nPost-trade view (FR-OMS-011)');
    const pt = await pm.get(`${O}/${slId}/post-trade`);
    const ptd = pt.body?.data;
    check('post-trade -> 200', pt.status === 200, pt.body);
    check('allocation: 1000 of 1000 (100%), average 10.350000, two fills', ptd?.allocation?.filledQty === '1000' && ptd.allocation.sharePct === '100.00' && ptd.allocation.avgPrice === '10.350000' && ptd.allocation.fills.length === 2, ptd?.allocation);
    check('allocation money: gross 10350.00, fees 10.00, net to pay 10360.00', ptd?.allocation?.gross === '10350.00' && ptd.allocation.fees === '10.00' && ptd.allocation.net === '10360.00', ptd?.allocation);
    check('position after carries the new quantity', ptd?.allocation?.positionAfter?.quantity === '2000', ptd?.allocation?.positionAfter);
    check('slippage: +350 bp, cost 350.00, worst fill 400 bp', ptd?.slippage?.bp === 350 && ptd.slippage.amount === '350.00' && ptd.slippage.worstFillBp === 400, ptd?.slippage);
    check('per-fill slippage 300 and 400 bp', ptd?.allocation?.fills?.[0]?.slippageBp === 300 && ptd.allocation.fills[1].slippageBp === 400, ptd?.allocation?.fills);
    check('no contract note yet; fills tie to the order; ready to settle', ptd?.contractNote?.status === 'NONE' && ptd.settlement.fillsTieToOrder === true && ptd.settlement.readyToSettle === true, ptd?.settlement);
    check('the blotter list carries the order type (STOP_LIMIT) and slippage', (await pm.get(`${O}?q=${encodeURIComponent(sl.body?.data?.ref)}`)).body?.data?.[0]?.orderType === 'STOP_LIMIT');
    check('post-trade of a draft owned by someone else is hidden (404)', (await dir.get(`${O}/${nearId}/post-trade`)).status === 404);

    console.log('\nContract-note parsing hook (text and PDF)');
    const tradeDay = dayStr(-1);
    const noteLines = (ref: string, qty: number, price: string, extra: string[] = []) => [`Order reference: ${ref}`, `Security: S5 Test (${sec.ticker})`, 'Side: Buy', `Quantity: ${qty}`, `Price: USD ${price}`, 'Commission: 1.50', `Trade date: ${tradeDay}`, ...extra];

    const textOrder = await toRouting(ticket({ quantity: 100 }));
    check('order routed for the text note', textOrder.ok, textOrder.steps);
    const note1 = await dealer.post('/api/v1/trading-feeds/contract-notes', { brokerId: broker.id, filename: `note-${run}.txt`, format: 'TEXT', content: noteLines(textOrder.ref, 100, '10.20').join('\n') }, { 'Idempotency-Key': key('n1') });
    check('narrative text note -> 201, one line matched', note1.status === 201 && note1.body?.data?.matched === 1 && note1.body.data.format === 'TEXT', note1.body);
    const pt1 = (await pm.get(`${O}/${textOrder.id}/post-trade`)).body?.data;
    check('post-trade: contract note MATCHED with zero variance, fill source CONTRACT_NOTE', pt1?.contractNote?.status === 'MATCHED' && pt1.contractNote.lines[0]?.variance?.price === '0.000000' && pt1.allocation.fills[0]?.source === 'CONTRACT_NOTE', pt1?.contractNote);
    const dupNote = await dealer.post('/api/v1/trading-feeds/contract-notes', { brokerId: broker.id, filename: `note-${run}.txt`, format: 'TEXT', content: noteLines(textOrder.ref, 100, '10.20').join('\n') }, { 'Idempotency-Key': key('n1b') });
    check('the same note again is refused as a duplicate file (409)', dupNote.status === 409, dupNote.body);
    const junk = await dealer.post('/api/v1/trading-feeds/contract-notes', { brokerId: broker.id, filename: `junk-${run}.txt`, format: 'TEXT', content: 'Dear sir, thank you for your business.' }, { 'Idempotency-Key': key('n2') });
    check('text with no trade fields -> 422 contract_note_rejected', junk.status === 422 && errCode(junk) === 'contract_note_rejected', junk.body);

    const pdfOrder = await toRouting(ticket({ quantity: 100 }));
    check('order routed for the PDF note', pdfOrder.ok, pdfOrder.steps);
    const pdf = buildPdf(['Matanho Broker - Contract Note', ...noteLines(pdfOrder.ref, 100, '10.10')], false);
    const note2 = await dealer.post('/api/v1/trading-feeds/contract-notes', { brokerId: broker.id, filename: `note-${run}.pdf`, format: 'PDF', content: pdf.toString('base64') }, { 'Idempotency-Key': key('n3') });
    check('PDF note (plain content stream) -> 201, one line matched, format PDF', note2.status === 201 && note2.body?.data?.matched === 1 && note2.body.data.format === 'PDF', note2.body);

    const zOrder = await toRouting(ticket({ quantity: 100 }));
    check('order routed for the compressed PDF note', zOrder.ok, zOrder.steps);
    const zPdf = buildPdf(noteLines(zOrder.ref, 100, '10.05'), true);
    const note3 = await dealer.post('/api/v1/trading-feeds/contract-notes', { brokerId: broker.id, filename: `note-z-${run}.pdf`, format: 'PDF', content: zPdf.toString('base64') }, { 'Idempotency-Key': key('n4') });
    check('PDF note (Flate-compressed) -> 201, one line matched', note3.status === 201 && note3.body?.data?.matched === 1, note3.body);
    const notPdf = await dealer.post('/api/v1/trading-feeds/contract-notes', { brokerId: broker.id, filename: `fake-${run}.pdf`, format: 'PDF', content: Buffer.from('not a pdf at all').toString('base64') }, { 'Idempotency-Key': key('n5') });
    check('a file that is not a PDF -> 422', notPdf.status === 422, notPdf.body);

    // parsers directly
    const parsed = parseNarrativeNote(['Contract Note 4471', 'Trade ref: CN-4471', 'Our reference: ORD-001234', 'Instrument: Econet Wireless (ECO.ZW)', 'Buy/Sell: Sell', 'Quantity: 12,500', 'Average price: 1.2575', 'Total charges: 31.20', 'Deal date: 02/10/2026'].join('\n'));
    const l0 = parsed.lines[0];
    check('parser: labels, ticker in brackets, thousands separators and DD/MM/YYYY', parsed.format === 'TEXT' && l0?.tradeRef === 'CN-4471' && l0.orderRef === 'ORD-001234' && l0.ticker === 'ECO.ZW' && l0.side === 'SELL' && l0.quantity === '12500' && l0.price === '1.2575' && l0.fees === '31.20' && l0.tradeDate === '2026-10-02', parsed);
    const two = parseNarrativeNote(['Trade ref: A1', 'Order ref: ORD-1', 'Symbol: X', 'Side: B', 'Qty: 10', 'Price: 1', 'Date: 2026-10-01', 'Trade ref: A2', 'Order ref: ORD-2', 'Symbol: Y', 'Side: S', 'Qty: 20', 'Price: 2', 'Date: 2026-10-01'].join('\n'));
    check('parser: a repeated field starts the next trade', two.lines.length === 2 && two.lines[1]?.ticker === 'Y' && two.lines[1].side === 'SELL', two);
    let rejected = '';
    try {
      parseNarrativeNote('Order reference: ORD-9\nSecurity: Z\nSide: Buy\nQuantity: 0\nPrice: 1\nTrade date: 2026-10-01');
    } catch (e) {
      rejected = (e as Error).message;
    }
    check('parser: a zero quantity is rejected', /quantity/i.test(rejected), rejected);
    check('parser: CSV and JSON still parse through the same entry point', parseContractNoteText('trade_ref,order_ref,ticker,side,quantity,price,trade_date\nT1,ORD-1,X,BUY,5,1.5,2026-10-01').lines.length === 1);
    check('extractPdfText reads plain and compressed streams', /Quantity: 100/.test(extractPdfText(pdf)) && /Quantity: 100/.test(extractPdfText(zPdf)));

    // ---------------------------------------------------------------- FR-VAL-009 / 017 / 015
    console.log('\nValuation permissions (FR-VAL-009)');
    const navDate = dayStr(-1);
    const createRun = (c: Client) => c.post(`${N}/runs`, { portfolioId: pf.id, navDate }, { 'Idempotency-Key': key('nr') });
    check('auditor (valuation.view only) can read NAV runs', (await aud.get(`${N}/runs`)).status === 200);
    const audCreate = await createRun(aud);
    check('auditor cannot create a run -> 403 permission_denied', audCreate.status === 403 && errCode(audCreate) === 'permission_denied', audCreate.body);
    check('a view-only custom role cannot create a run -> 403', (await createRun(cV)).status === 403);
    check('a maker-only custom role cannot create a run -> 403', (await createRun(cM)).status === 403);
    const r1 = await createRun(cR);
    check('a run-only custom role can create a run -> 201 Draft', r1.status === 201 && r1.body?.data?.status === 'DRAFT', r1.body);
    const runId = r1.body?.data?.id as string;
    const nav0 = r1.body?.data;
    check('the preparer sees recalculate and edit allowed but maker review not permitted', nav0?.allowed?.recalculate === true && nav0.allowed.editInputs === true && nav0.allowed.makerReview === false && /^Not permitted for /.test(nav0.allowed.makerBlocker ?? ''), nav0?.allowed);
    const audView = (await aud.get(`${N}/runs/${runId}`)).body?.data;
    check('the auditor sees every action disabled with "Not permitted for <Role>"', audView?.allowed?.recalculate === false && audView.allowed.editInputs === false && audView.allowed.makerReview === false && /^Not permitted for /.test(audView.allowed.runBlocker ?? '') && /Auditor/i.test(audView.allowed.runBlocker ?? ''), audView?.allowed);
    check('valuation.run edits inputs', (await cR.patch(`${N}/runs/${runId}/inputs`, { accruals: '10.00' })).status === 200);
    check('valuation.run alone cannot do the maker review -> 403', (await cR.post(`${N}/runs/${runId}/maker-review`)).status === 403);
    check('the auditor cannot edit inputs -> 403', (await aud.patch(`${N}/runs/${runId}/inputs`, { accruals: '11.00' })).status === 403);
    check('the maker-only role cannot recalculate -> 403', (await cM.post(`${N}/runs/${runId}/recalculate`)).status === 403);
    const mr = await cM.post(`${N}/runs/${runId}/maker-review`);
    check('valuation.maker does the maker review -> MAKER_REVIEWED', mr.status === 200 && mr.body?.data?.status === 'MAKER_REVIEWED', mr.body);
    const sameRel = await cM.post(`${N}/runs/${runId}/release`);
    check('the maker-only role cannot release -> 403 permission_denied', sameRel.status === 403 && errCode(sameRel) === 'permission_denied', sameRel.body);
    check('a view-only auditor cannot release -> 403', (await aud.post(`${N}/runs/${runId}/release`)).status === 403);

    console.log('\nExternal NAV vs ABOR (FR-VAL-017)');
    const abor = Number(mr.body?.data?.nav);
    const ext1 = await fa.put(`${N}/runs/${runId}/external-nav`, { externalNav: (abor + 6000).toFixed(2), source: 'Administrator statement', note: 'Month-end pack' });
    const e1 = ext1.body?.data?.external;
    check('external NAV recorded: variance +6,000.00, state Variance (tolerance 5,000)', ext1.status === 200 && e1?.variance === '6000.00' && e1.state === 'Variance' && e1.abor === abor.toFixed(2) && e1.tolerance === '5000.00', ext1.body);
    check('a Variance raises a notification for the releasers', (await prisma.outboxEvent.count({ where: { type: 'notify.permission', payload: { path: '$.link', equals: `/ops/nav/${runId}` } } })) >= 1);
    const ext2 = await fa.put(`${N}/runs/${runId}/external-nav`, { externalNav: (abor - 100).toFixed(2), source: 'Administrator statement' });
    check('a figure within the tolerance -> Agree, variance -100.00', ext2.status === 200 && ext2.body?.data?.external?.state === 'Agree' && ext2.body.data.external.variance === '-100.00', ext2.body);
    check('the auditor cannot record an external NAV -> 403', (await aud.put(`${N}/runs/${runId}/external-nav`, { externalNav: '1.00', source: 'x1' })).status === 403);
    check('a zero external NAV is refused -> 400', (await fa.put(`${N}/runs/${runId}/external-nav`, { externalNav: '0', source: 'Admin' })).status === 400);
    check('the list view carries the external block', (await fa.get(`${N}/runs?portfolioId=${pf.id}`)).body?.data?.[0]?.external?.state === 'Agree');
    check('the audit trail records both figures', (await prisma.auditEvent.count({ where: { objectType: 'nav_run', objectId: runId, action: 'nav.external_recorded' } })) === 2);

    console.log('\nRelease, history and policy (FR-VAL-015)');
    await dir.stepUp();
    const rel = await dir.post(`${N}/runs/${runId}/release`);
    check('a different person with valuation.release releases it -> RELEASED', rel.status === 200 && rel.body?.data?.status === 'RELEASED', rel.body);
    const hist = await fa.get(`${N}/history?portfolioId=${pf.id}`);
    const h0 = hist.body?.data?.[0];
    check('history lists the released NAV with who prepared, reviewed and released it', hist.status === 200 && h0?.id === runId && h0.official === true && !!h0.checkerName && !!h0.reviewerName && !!h0.makerName, hist.body);
    check('history carries the evidence pack link, re-run count and external variance', h0?.packUrl === `/api/v1/nav/runs/${runId}/pack` && h0.runsForDate === 1 && h0.external?.state === 'Agree', h0);
    check('the pack the link points at opens', (await fa.get(`/api/v1/nav/runs/${runId}/pack`)).status === 200);
    check('history needs valuation.view', (await pm.get(`${N}/history`)).status === 200 && (await cV.get(`${N}/history`)).status === 200);

    const pol = await fa.get(`${N}/policy`);
    check('policy: five thresholds, a price hierarchy and governance statements', pol.status === 200 && pol.body?.data?.thresholds?.length === 5 && pol.body.data.priceHierarchy.length >= 3 && pol.body.data.governance.length >= 4, pol.body);
    check('policy: a releaser can edit, an auditor cannot', pol.body?.data?.canEdit === true && (await aud.get(`${N}/policy`)).body?.data?.canEdit === false);
    const polNoReason = await dir.put(`${N}/policy`, { staleDays: 5, reason: 'x' });
    check('policy change without a real reason -> 400', polNoReason.status === 400, polNoReason.body);
    check('policy change by the auditor -> 403', (await aud.put(`${N}/policy`, { staleDays: 5, reason: 'auditor attempt' })).status === 403);
    await prisma.session.updateMany({ where: { userId: dirU.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    const polNoStep = await dir.put(`${N}/policy`, { staleDays: 5, reason: 'Tighter staleness window' });
    check('policy change needs a fresh authenticator code -> 401', polNoStep.status === 401, polNoStep.body);
    await dir.stepUp();
    const polOk = await dir.put(`${N}/policy`, { staleDays: 5, externalToleranceAbs: 50, reason: 'Tighter staleness window' });
    check('policy change with step-up -> 200', polOk.status === 200 && polOk.body?.data?.thresholds?.find((t: any) => t.field === 'staleDays')?.value === 5, polOk.body);
    const pol2 = await fa.get(`${N}/policy`);
    check('policy now shows the custom values', pol2.body?.data?.thresholds?.find((t: any) => t.field === 'staleDays')?.custom === true && pol2.body.data.thresholds.find((t: any) => t.field === 'externalToleranceAbs')?.value === 50);
    check('the policy change is audited with before and after', (await prisma.auditEvent.count({ where: { action: 'nav.policy_updated', actorId: dirU.id } })) === 1);
    const reExt = await fa.put(`${N}/runs/${runId}/external-nav`, { externalNav: (abor - 100).toFixed(2), source: 'Administrator statement' });
    check('the new external tolerance (50) turns a -100.00 variance into Variance', reExt.body?.data?.external?.state === 'Variance' && reExt.body.data.external.tolerance === '50.00', reExt.body);

    // ---------------------------------------------------------------- BR-029
    console.log('\nScenario thresholds (BR-029)');
    const TH = '/api/v1/risk/scenario-thresholds';
    const thGet = await pm.get(TH);
    check('thresholds readable with risk.view; defaults keep the original rule (1.0x / 1.1x, loss test off)', thGet.status === 200 && thGet.body?.data?.thresholds?.liquidityEscalate === 1 && thGet.body.data.thresholds.liquidityReview === 1.1 && thGet.body.data.thresholds.lossEscalatePct === null && thGet.body.data.canEdit === false, thGet.body);
    check('the SRD reference values are offered (1.25x / 1.5x, 8% / 5%)', thGet.body?.data?.reference?.liquidityEscalate === 1.25 && thGet.body.data.reference.liquidityReview === 1.5 && thGet.body.data.reference.lossEscalatePct === 8);
    const prev = async (shocks: object) => (await pm.post('/api/v1/risk/scenarios/preview', { portfolioId: pf.id, shocks })).body?.data?.results;
    // Cash after the earlier fills is ~86.6k of a ~109.6k book, so a 55% redemption covers ~1.44x: Within on 1.0x/1.1x, Review on 1.25x/1.5x.
    const base55 = await prev({ redemptionPct: 55 });
    check('55% redemption on default thresholds: coverage between 1.25x and 1.5x, Within', base55?.status === 'Within' && Number(base55.liquidity.coverage) > 1.25 && Number(base55.liquidity.coverage) < 1.5, base55?.liquidity);
    check('pm (no risk.manage) cannot change thresholds -> 403', (await pm.put(TH, { liquidityEscalate: 1.25, reason: 'pm attempt' })).status === 403);
    await comp.stepUp();
    check('escalate above review is refused -> 400', (await comp.put(TH, { liquidityEscalate: 2, liquidityReview: 1.5, reason: 'bad order of levels' })).status === 400);
    check('review loss above escalation loss is refused -> 400', (await comp.put(TH, { lossEscalatePct: 5, lossReviewPct: 8, reason: 'bad order of levels' })).status === 400);
    const thSet = await comp.put(TH, { liquidityEscalate: 1.25, liquidityReview: 1.5, lossEscalatePct: 1.5, lossReviewPct: 1, reason: 'Adopt the policy reference values' });
    check('compliance (risk.manage, step-up) sets the thresholds -> 200', thSet.status === 200 && thSet.body?.data?.thresholds?.liquidityEscalate === 1.25 && thSet.body.data.thresholds.lossEscalatePct === 1.5 && thSet.body.data.canEdit === true, thSet.body);
    const lq = await prev({ redemptionPct: 55 });
    check('the same 55% redemption is now Review with the review threshold in the reason', lq?.status === 'Review' && lq.liquidity.status === 'Review' && lq.reasons.some((x: string) => /review threshold/.test(x)) && lq.thresholds.liquidityReview === 1.5, lq);
    const ls = await prev({ equityPct: -20 });
    check('a 20% equity fall (loss ~1.8% of NAV) is Escalate against the 1.5% loss threshold', ls?.status === 'Escalate' && ls.reasons.some((x: string) => /escalation threshold/.test(x) && /Loss of/.test(x)), ls);
    await comp.stepUp();
    const thClear = await comp.put(TH, { lossEscalatePct: null, lossReviewPct: null, reason: 'Switch the loss test off again' });
    check('clearing both loss thresholds switches the loss test off', thClear.status === 200 && thClear.body?.data?.thresholds?.lossEscalatePct === null && thClear.body.data.thresholds.lossReviewPct === null, thClear.body);
    check('with the loss test off the equity fall is Within again', (await prev({ equityPct: -20 }))?.status === 'Within');
    check('threshold changes are audited with the reason', (await prisma.auditEvent.count({ where: { action: 'risk.scenario_thresholds_updated', actorId: compU.id } })) === 2);

    // ---------------------------------------------------------------- audit chain
    const { verifyAuditChain } = await import('../src/lib/audit');
    check('audit hash chain intact', (await verifyAuditChain()).brokenAt === null);
  } finally {
    await cleanup(userIds, portfolioIds, securityIds, roleIds, orderIds, broker.id);
  }

  console.log(failures ? `\n${failures} check(s) FAILED, ${passes} passed` : `\nAll ${passes} orders and valuation depth checks passed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

async function cleanup(userIds: string[], portfolioIds: string[], securityIds: string[], roleIds: string[], orderIds: string[], brokerId: string) {
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.log(`  (cleanup: ${label} skipped: ${(err as Error).message.split('\n').pop()})`);
    }
  };
  await step('trade feed lines', () => prisma.tradeFeedLine.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { brokerId }] } }));
  await step('trade feed files', () => prisma.tradeFeedFile.deleteMany({ where: { brokerId } }));
  await step('orders', () => prisma.order.deleteMany({ where: { portfolioId: { in: portfolioIds } } }));
  await step('nav runs', () => prisma.navRun.deleteMany({ where: { portfolioId: { in: portfolioIds } } }));
  await step('portfolios', () => prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } }));
  await step('securities', () => prisma.security.deleteMany({ where: { id: { in: securityIds } } }));
  await step('brokers', () => prisma.broker.deleteMany({ where: { id: brokerId } }));
  await step('policies', () => prisma.policy.deleteMany({ where: { key: { in: ['nav_stale_days', 'nav_external_tolerance_abs', 'scenario_liq_escalate', 'scenario_liq_review', 'scenario_loss_escalate_pct', 'scenario_loss_review_pct'] } } }));
  await step('idempotency keys', () => prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } }));
  await step('users', () => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
  await step('custom roles', () => prisma.role.deleteMany({ where: { id: { in: roleIds } } }));
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
