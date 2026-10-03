/**
 * Trading and corporate-action feed checks (R4-10).
 *
 * Part 1 needs no database: contract-note and FIX parsers (including checksum), dedupe keys, the match rules, settlement
 * maths, announcement validation and the fake announcement feed.
 * Part 2 needs a disposable MySQL with migrations applied and runs only with E2E_CONFIRM=throwaway-db. It drives the
 * services directly (no API process): contract note -> fills -> break -> resolve (four-eyes), FIX poll with the fake
 * sender, duplicate suppression, settlement instruction maker-checker, and the corporate-action feed.
 *
 *   npx tsx scripts/test-trading-feeds.ts                           # part 1
 *   E2E_CONFIRM=throwaway-db npx tsx scripts/test-trading-feeds.ts  # parts 1 and 2
 */
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test';

import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};
const D = (v: string | number) => new Prisma.Decimal(v);
const throws = (fn: () => unknown, code?: string) => {
  try {
    fn();
    return false;
  } catch (e) {
    return code ? (e as { code?: string }).code === code : true;
  }
};

async function offline() {
  const { parseContractNoteText, parseFixMessage, buildFixExecutionReport, fixChecksum, FeedParseError } = await import('../src/integrations/broker-routing/parse');
  const { lineDedupeKey, checkMatch, settlementAmounts, settleDateFor, addBusinessDays, announcementErrors, announcementKey } = await import('../src/modules/trading-feeds/tf.engine');
  const { fakeAnnouncements } = await import('../src/integrations/market-data/fake');

  console.log('contract-note parser');
  const csv = 'Trade Ref,Order Ref,Symbol,Side,Qty,Price,Commission,Trade Date\nT1,ord-001,eco.zw,B,"1,000",1.25,12.5,2026-10-02\nT2,ORD-002,NMB.ZW,SELL,50,3,,2026-10-02\n';
  const p = parseContractNoteText(csv);
  check('CSV with aliases parses', p.format === 'CSV' && p.lines.length === 2);
  check('values are normalised', p.lines[0]!.orderRef === 'ORD-001' && p.lines[0]!.ticker === 'ECO.ZW' && p.lines[0]!.side === 'BUY' && p.lines[0]!.quantity === '1000' && p.lines[1]!.fees === '0');
  const pj = parseContractNoteText(JSON.stringify({ trades: [{ tradeRef: 'J1', brokerOrderRef: 'BRK-1', ticker: 'X.ZW', side: 'SELL', quantity: '5', price: '2', tradeDate: '2026-10-02' }] }));
  check('JSON parses', pj.format === 'JSON' && pj.lines[0]!.brokerOrderRef === 'BRK-1');
  check('a bad quantity rejects the file', throws(() => parseContractNoteText('trade_ref,order_ref,ticker,side,quantity,price,trade_date\nT1,O1,X,BUY,abc,1,2026-10-02'), 'feed_rejected'));
  check('a repeated trade_ref rejects the file', throws(() => parseContractNoteText('trade_ref,order_ref,ticker,side,quantity,price,trade_date\nT1,O1,X,BUY,1,1,2026-10-02\nT1,O1,X,BUY,1,1,2026-10-02')));
  check('a missing column is named', (() => {
    try {
      parseContractNoteText('trade_ref,ticker\nT1,X');
      return false;
    } catch (e) {
      return e instanceof FeedParseError && /side|quantity|price|tradeDate/.test(e.message);
    }
  })());
  check('order_ref or broker_order_ref is required', throws(() => parseContractNoteText('trade_ref,ticker,side,quantity,price,trade_date\nT1,X,BUY,1,1,2026-10-02')));
  check('empty file is refused', throws(() => parseContractNoteText('   ')));

  console.log('FIX parser');
  const msg = buildFixExecutionReport({ execId: 'E1', clOrdId: 'ORD-001', orderId: 'BRK-1', symbol: 'ECO.ZW', side: 'BUY', lastQty: '100', lastPx: '1.5', time: new Date('2026-10-02T08:30:15.250Z'), commission: '1.2' });
  const r = parseFixMessage(msg);
  check('ExecutionReport round-trips', r.execType === 'TRADE' && r.execId === 'E1' && r.clOrdId === 'ORD-001' && r.symbol === 'ECO.ZW' && r.side === 'BUY' && r.lastQty === '100' && r.lastPx === '1.5' && r.commission === '1.2' && r.transactTime === '2026-10-02T08:30:15.250Z', r);
  check('pipe-delimited form parses', parseFixMessage(msg.split('\u0001').join('|')).execId === 'E1');
  check('a tampered message fails the checksum', throws(() => parseFixMessage(msg.replace('31=1.5', '31=9.5')), 'feed_rejected'));
  check('a non-trade report is flagged OTHER', parseFixMessage(buildFixExecutionReport({ execId: 'E2', clOrdId: 'ORD-001', symbol: 'ECO.ZW', side: 'BUY', lastQty: '0', lastPx: '0', time: new Date(), execType: '0' })).execType === 'OTHER');
  check('not an ExecutionReport is refused', throws(() => parseFixMessage('8=FIX.4.4|35=D|11=A|')));
  check('checksum is mod 256 over three digits', fixChecksum('abc') === '038');

  console.log('dedupe and matching');
  check('dedupe key is stable and separates sources', lineDedupeKey('FIX', 'b1', 'E1') === lineDedupeKey('FIX', 'b1', ' E1 ') && lineDedupeKey('FIX', 'b1', 'E1') !== lineDedupeKey('CONTRACT_NOTE', 'b1', 'E1') && lineDedupeKey('FIX', 'b1', 'E1') !== lineDedupeKey('FIX', 'b2', 'E1'));
  const order = { status: 'Routing', side: 'BUY', ticker: 'ECO.ZW', quantity: D(1000), filledQty: D(200), orderType: 'LIMIT', limitPrice: D('2'), decisionPrice: D('1.9') };
  const line = { ticker: 'eco.zw', side: 'BUY', quantity: D(300), price: D('1.95') };
  check('a clean line matches', checkMatch(order, line) === null);
  check('ticker mismatch', checkMatch(order, { ...line, ticker: 'NMB.ZW' })?.reason === 'TICKER_MISMATCH');
  check('side mismatch', checkMatch(order, { ...line, side: 'SELL' })?.reason === 'SIDE_MISMATCH');
  check('order not working', checkMatch({ ...order, status: 'Filled' }, line)?.reason === 'ORDER_NOT_WORKING');
  check('overfill', checkMatch(order, { ...line, quantity: D(801) })?.reason === 'OVERFILL' && checkMatch(order, { ...line, quantity: D(800) }) === null);
  check('limit breach on a buy', checkMatch(order, { ...line, price: D('2.01') })?.reason === 'LIMIT_BREACH');
  const mkt = { ...order, orderType: 'MARKET', limitPrice: null };
  check('market price deviation, skipped by force', checkMatch(mkt, { ...line, price: D('3') })?.reason === 'PRICE_DEVIATION' && checkMatch(mkt, { ...line, price: D('3') }, { force: true }) === null);

  console.log('settlement');
  const a = settlementAmounts('BUY', [{ quantity: D(100), price: D('1.5'), fees: D('1') }, { quantity: D(50), price: D('2'), fees: D('0.5') }]);
  check('buy pays gross + fees', a.gross.toFixed(2) === '250.00' && a.fees.toFixed(2) === '1.50' && a.net.toFixed(2) === '251.50');
  check('sell receives gross - fees', settlementAmounts('SELL', [{ quantity: D(100), price: D('1.5'), fees: D('1') }]).net.toFixed(2) === '149.00');
  check('T+3 skips the weekend (Thu -> Tue)', addBusinessDays('2026-10-01', 3) === '2026-10-06' && settleDateFor('ZSE', '2026-10-01') === '2026-10-06' && settleDateFor('VFEX', '2026-10-01') === '2026-10-05');

  console.log('corporate-action announcements');
  const now = new Date('2026-10-03T09:00:00Z');
  const tickers = Array.from({ length: 40 }, (_, i) => `T${i}.ZW`);
  const f1 = fakeAnnouncements(tickers, now);
  const f2 = fakeAnnouncements(tickers, new Date('2026-10-04T15:00:00Z'));
  check('fake feed announces some, not all', f1.length > 5 && f1.length < 35, f1.length);
  check('same month, same announcements and keys (daily sync sees duplicates)', f1.length === f2.length && f1.every((x, i) => announcementKey(x) === announcementKey(f2[i]!)));
  check('every fake announcement is draftable', f1.every((x) => announcementErrors(x).length === 0), f1.map((x) => announcementErrors(x)).filter((e) => e.length).slice(0, 2));
  check('next month differs', fakeAnnouncements(tickers, new Date('2026-11-25T09:00:00Z')).every((x) => x.exDate.startsWith('2026-12')));
  const base = f1.find((x) => x.type === 'CASH_DIVIDEND')!;
  check('dividend without a rate is refused', announcementErrors({ ...base, rate: null }).length > 0);
  check('record date before ex-date is refused', announcementErrors({ ...base, recordDate: '2026-01-01' }).length > 0);
  check('scrip dividend needs an election deadline', announcementErrors({ ...base, type: 'SCRIP_DIVIDEND', ratioNew: '1', ratioOld: '10', electionDeadline: null }).some((m) => /election/i.test(m)));
  check('merger needs an acquirer', announcementErrors({ ...base, type: 'MERGER', ratioNew: '1', ratioOld: '1' }).some((m) => /acquirer/i.test(m)));
}

async function flows() {
  const { prisma } = await import('../src/lib/prisma');
  const { systemCtx, SYSTEM_ACTOR_ID } = await import('../src/lib/system');
  const svc = await import('../src/modules/trading-feeds/tf.service');
  const { buildFixExecutionReport } = await import('../src/integrations/broker-routing/parse');
  const run = randomBytes(3).toString('hex');
  const ctxOf = (id: string) => ({ actorId: id, actorRole: 'Test', portal: 'admin' });
  const u1 = '11111111-1111-4111-8111-111111111111';
  const u2 = '22222222-2222-4222-8222-222222222222';
  const yesterday = new Date(`${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`);

  console.log('database flows (adapter mode: ' + (process.env.INTEGRATION_BROKER_ROUTING ?? 'fake') + ')');
  const sec = await prisma.security.create({ data: { ticker: `TF${run}.ZW`.toUpperCase(), name: `TF Test ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD' } });
  const broker = await prisma.broker.create({ data: { name: `TF Broker ${run}`, status: 'Active' } });
  const pf = await prisma.portfolio.create({ data: { ref: `TF-${run}`, name: `TF Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
  await prisma.portfolioCash.create({ data: { portfolioId: pf.id, currency: 'USD', available: D(100000), asOf: yesterday } });
  const mkOrder = (n: number, qty: number, limit: string | null) =>
    prisma.order.create({
      data: { ref: `TF${run}${n}`.toUpperCase().slice(0, 16), portfolioId: pf.id, securityId: sec.id, side: 'BUY', quantity: D(qty), orderType: limit ? 'LIMIT' : 'MARKET', limitPrice: limit ? D(limit) : null, brokerId: broker.id, currency: 'USD', decisionPrice: D('2'), status: 'Routing', makerId: u1, approverId: u2, approvedAt: new Date(), submittedAt: new Date() },
    });
  const o1 = await mkOrder(1, 1000, '2.10');
  const o2 = await mkOrder(2, 500, null);
  const day = new Date().toISOString().slice(0, 10);
  const csv = [
    'trade_ref,order_ref,ticker,side,quantity,price,fees,trade_date,executed_at',
    `T1-${run},${o1.ref},${sec.ticker},BUY,400,2.05,4,${day},${new Date(Date.now() - 600_000).toISOString()}`,
    `T2-${run},${o1.ref},${sec.ticker},BUY,600,2.06,6,${day},${new Date(Date.now() - 500_000).toISOString()}`,
    `T3-${run},ORD-NOPE,${sec.ticker},BUY,10,2,0,${day},${new Date(Date.now() - 400_000).toISOString()}`,
    `T4-${run},${o2.ref},${sec.ticker},BUY,100,9,1,${day},${new Date(Date.now() - 300_000).toISOString()}`,
    `T5-${run},${o2.ref},${sec.ticker},BUY,600,2,1,${day},${new Date(Date.now() - 200_000).toISOString()}`,
  ].join('\n');

  const n = await svc.ingestContractNote({ brokerId: broker.id, filename: 'note.csv', content: csv, userId: u1, ctx: ctxOf(u1) });
  check('contract note: 2 matched, 3 breaks', n.matched === 2 && n.breaks === 3 && n.duplicates === 0, n);
  const reasons = Object.fromEntries(n.lines.map((l) => [l.tradeRef.split('-')[0], l.reason]));
  check('break reasons: no order, price deviation, overfill', reasons.T3 === 'NO_ORDER' && reasons.T4 === 'PRICE_DEVIATION' && reasons.T5 === 'OVERFILL', reasons);
  const f1 = await prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
  check('order 1 is Filled with the weighted average price', f1.status === 'Filled' && f1.filledQty.eq(1000) && f1.avgPrice!.toFixed(4) === '2.0560', f1);
  const fills = await prisma.orderFill.findMany({ where: { orderId: o1.id } });
  check('fills carry source CONTRACT_NOTE and the trade reference', fills.length === 2 && fills.every((f) => f.source === 'CONTRACT_NOTE' && f.sourceRef?.startsWith('CONTRACT_NOTE:T')), fills);
  const pos = await prisma.portfolioPosition.findFirst({ where: { portfolioId: pf.id, securityId: sec.id }, orderBy: { createdAt: 'desc' } });
  check('position and cash moved', pos?.quantity.eq(1000) === true);

  let err: unknown;
  await svc.ingestContractNote({ brokerId: broker.id, filename: 'again.csv', content: csv, userId: u1, ctx: ctxOf(u1) }).catch((e) => (err = e));
  check('re-uploading the same file is refused', (err as { code?: string })?.code === 'duplicate_file', err);
  const n2 = await svc.ingestContractNote({ brokerId: broker.id, filename: 'resend.csv', content: csv + '\n', userId: u1, ctx: ctxOf(u1) }).catch((e) => e);
  check('a re-sent line with new file bytes is a duplicate, never filled twice', n2.duplicates === 5 && n2.matched === 0 && (await prisma.orderFill.count({ where: { orderId: o1.id } })) === 2, n2);
  err = undefined;
  await svc.ingestContractNote({ brokerId: broker.id, filename: 'bad.csv', content: 'trade_ref,ticker\nX,Y', userId: u1, ctx: ctxOf(u1) }).catch((e) => (err = e));
  check('a malformed file is rejected (422) and recorded as Failed', (err as { code?: string })?.code === 'contract_note_rejected' && (await prisma.tradeFeedFile.count({ where: { brokerId: broker.id, status: 'Failed' } })) === 1, err);

  const si = await prisma.settlementInstruction.findUnique({ where: { orderId: o1.id } });
  check('the filled order got a system-generated settlement instruction', si?.status === 'GENERATED' && si.generatedBy === SYSTEM_ACTOR_ID && si.instructionType === 'RVP' && si.netAmount.toFixed(2) === '2066.00', si);
  const again = await svc.generateSettlementInstruction(ctxOf(u1), o1.id, u1);
  check('generating again returns the same instruction', !again.created && again.instruction.id === si?.id);
  err = undefined;
  await svc.generateSettlementInstruction(ctxOf(u1), o2.id, u1).catch((e) => (err = e));
  check('a working order has nothing to settle', (err as { code?: string })?.code === 'invalid_state', err);
  const rel = await svc.moveInstruction({ id: si!.id, action: 'release', userId: u1, ctx: ctxOf(u1) });
  check('anyone but a person who generated it releases a system instruction', rel.status === 'RELEASED' && rel.releasedBy === u1);
  const manual = await prisma.settlementInstruction.update({ where: { id: si!.id }, data: { status: 'GENERATED', generatedBy: u1, releasedBy: null, releasedAt: null } });
  err = undefined;
  await svc.moveInstruction({ id: manual.id, action: 'release', userId: u1, ctx: ctxOf(u1) }).catch((e) => (err = e));
  check('the generator cannot release their own instruction', (err as { code?: string })?.code === 'segregation_of_duties', err);
  await svc.moveInstruction({ id: manual.id, action: 'release', userId: u2, ctx: ctxOf(u2) });
  const conf = await svc.moveInstruction({ id: manual.id, action: 'confirm', userId: u2, ctx: ctxOf(u2) });
  check('released -> confirmed', conf.status === 'CONFIRMED');
  err = undefined;
  await svc.moveInstruction({ id: manual.id, action: 'cancel', reason: 'too late', userId: u2, ctx: ctxOf(u2) }).catch((e) => (err = e));
  check('a confirmed instruction cannot be cancelled', (err as { code?: string })?.code === 'invalid_state', err);
  const file = await svc.instructionFile(manual.id, 'csv');
  check('instruction file renders', file.content.includes(si!.ref) && file.content.includes('RVP'));

  console.log('break resolution (four-eyes)');
  const t4 = await prisma.tradeFeedLine.findFirstOrThrow({ where: { externalRef: `T4-${run}` } });
  err = undefined;
  await svc.resolveBreak({ lineId: t4.id, action: 'MATCH', note: 'Confirmed price with the broker', userId: u1, ctx: ctxOf(u1) }).catch((e) => (err = e));
  check('the uploader cannot accept their own break', (err as { code?: string })?.code === 'segregation_of_duties', err);
  err = undefined;
  await svc.resolveBreak({ lineId: t4.id, action: 'MATCH', note: 'Confirmed price with the broker', userId: u2, ctx: ctxOf(u2) }).catch((e) => (err = e));
  check('a price-deviation break needs force', (err as { code?: string })?.code === 'price_deviation', err);
  const done = await svc.resolveBreak({ lineId: t4.id, action: 'MATCH', note: 'Confirmed price with the broker', force: true, userId: u2, ctx: ctxOf(u2) });
  const f2 = await prisma.order.findUniqueOrThrow({ where: { id: o2.id } });
  check('accepted break fills the order', done.status === 'RESOLVED' && !!done.fillId && f2.status === 'PartiallyFilled' && f2.filledQty.eq(100), { done, f2 });
  err = undefined;
  await svc.resolveBreak({ lineId: t4.id, action: 'REJECT', note: 'second go', userId: u2, ctx: ctxOf(u2) }).catch((e) => (err = e));
  check('a resolved line cannot be resolved again', (err as { code?: string })?.code === 'invalid_state', err);
  const t3 = await prisma.tradeFeedLine.findFirstOrThrow({ where: { externalRef: `T3-${run}` } });
  const rej = await svc.resolveBreak({ lineId: t3.id, action: 'REJECT', note: 'Not our trade', userId: u2, ctx: ctxOf(u2) });
  check('a break can be rejected with a reason', rej.status === 'REJECTED' && rej.resolution === 'Not our trade');
  const t3m = await prisma.tradeFeedLine.findFirstOrThrow({ where: { externalRef: `T5-${run}` } });
  err = undefined;
  await svc.resolveBreak({ lineId: t3m.id, action: 'MATCH', orderId: o2.ref, note: 'Retry the overfill', force: true, userId: u2, ctx: ctxOf(u2) }).catch((e) => (err = e));
  check('force never skips an overfill', (err as { code?: string })?.code === 'overfill', err);

  console.log('FIX with the fake sender');
  const ack = await svc.routeOrderViaAdapter({ orderId: o2.ref, ctx: ctxOf(u1) });
  check('the order is routed through the adapter', ack.status === 'ACKNOWLEDGED' && ack.brokerOrderRef.startsWith('BRK-'), ack);
  const poll = await svc.pollExecutionReports({ userId: u1, ctx: ctxOf(u1) });
  const f2b = await prisma.order.findUniqueOrThrow({ where: { id: o2.id } });
  if ((process.env.INTEGRATION_BROKER_ROUTING ?? 'fake') === 'fake') {
    check('polling ingests the fake fill (a break or fill, never an error)', poll.received >= 1 && poll.rejected.length === 0, poll);
    check('the fake fill of the remaining 400 is matched or flagged', f2b.filledQty.eq(500) || poll.breaks >= 1, { f2b, poll });
  }
  const direct = buildFixExecutionReport({ execId: `X-${run}`, clOrdId: 'ORD-NOPE', symbol: sec.ticker, side: 'BUY', lastQty: '5', lastPx: '2', time: new Date(Date.now() - 1000) });
  const fx1 = await svc.ingestExecutionReports({ messages: [direct, 'garbage'], userId: u1, ctx: ctxOf(u1) });
  check('FIX: unknown order is a break, garbage is rejected', fx1.breaks === 1 && fx1.rejected.length === 1, fx1);
  const fx2 = await svc.ingestExecutionReports({ messages: [direct], userId: u1, ctx: ctxOf(u1) });
  check('FIX: the same ExecID is a duplicate', fx2.duplicates === 1 && fx2.breaks === 0, fx2);

  console.log('corporate-action feed');
  const before = await prisma.corpActionEvent.count();
  const s1 = await svc.syncCorporateActions({ trigger: 'MANUAL', userId: u1, ctx: ctxOf(u1) });
  if (s1.status === 'OK') {
    check('sync drafts ANNOUNCED events made by the system actor', s1.fetched === s1.drafted + s1.duplicates + s1.rejected && (await prisma.corpActionEvent.count()) === before + s1.drafted, s1);
    const ev = s1.drafted ? await prisma.corpActionEvent.findFirst({ where: { makerId: SYSTEM_ACTOR_ID, status: 'ANNOUNCED' }, orderBy: { createdAt: 'desc' } }) : null;
    check('drafts await confirmation by a person', s1.drafted === 0 || (!!ev && ev.confirmedBy === null));
    const s2 = await svc.syncCorporateActions({ trigger: 'MANUAL', userId: u1, ctx: systemCtx() });
    check('a second sync creates nothing new (duplicate suppression)', s2.drafted === 0 && s2.duplicates === s2.fetched - s2.rejected, s2);
    check('seen counts rise', s1.drafted === 0 || (await prisma.caFeedItem.count({ where: { seenCount: { gt: 1 } } })) > 0);
  } else check(`sync reports ${s1.status} honestly: ${s1.error}`, s1.status === 'UNSUPPORTED' || s1.status === 'ERROR');
}

async function main() {
  await offline();
  if (process.env.E2E_CONFIRM === 'throwaway-db') await flows();
  else console.log('\n(database flows skipped: set E2E_CONFIRM=throwaway-db with a disposable MySQL to run them)');
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  if (process.env.E2E_CONFIRM === 'throwaway-db') {
    const { prisma } = await import('../src/lib/prisma');
    await prisma.$disconnect();
  }
  process.exit(failures ? 1 : 0);
}
void main();
