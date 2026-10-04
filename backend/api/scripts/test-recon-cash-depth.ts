/**
 * Package S2 (reconciliation and cash depth) checks against a RUNNING API:
 *  - BR-065: no break is classified until the counterparty population has been received (SOURCE_MISSING, no MISSING_EXTERNAL).
 *  - FR-REC-006: "Accept candidate match" pairs the two breaks of one trade, both go to an independent checker.
 *  - FR-REC-017: manual uploads and connector pulls share the counterpart_imports pipeline (channel, file name, record count, SHA-256).
 *  - FR-CASH-017: CAMT.053 and MT940 statements parse, foot, normalise signs and refuse duplicates; MT535 holdings feed.
 *  - FR-CASH-018: the cash close pre-check ties the bank sub-ledger to GL account 1000.
 *  - FR-CASH-009/010: client and cash-account filters on balances, explain lines (holds, pending withdrawals, policy) that tie.
 *  - FR-FIN-002/004 (BR-070): funding or dispute disposition of a margin call needs an independent checker; funding raises a
 *    cash expectation and links a cash journal.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-recon-cash-depth.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` on a disposable schema first and start the API against the same
 * DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP). Creates throwaway users and records with a random run id.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { parseStatement, tieOut } from '../src/modules/cash/cash.engine';
import { CANDIDATE_KINDS, matchTrades, populationReceived, scoreCandidate, type ExtTrade, type IntFill } from '../src/modules/recon/recon.engine';
import { parseMt535, renderMt535 } from '../src/modules/recon/recon.swift';
import { dispositionProblems } from '../src/modules/financing/fin.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Sd-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `sd-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const R = '/api/v1/recon';
const C = '/api/v1/cash';
const F = '/api/v1/financing';

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
const errCode = (r: Res) => r.body?.error?.code;

async function main() {
  // ---------------------------------------------------------------- pure rules
  console.log('\nRules and parsers (pure)');
  const ext = (o: Partial<ExtTrade> & { tradeRef: string }): ExtTrade => ({ id: o.tradeRef, ticker: 'AAA', side: 'BUY', quantity: D(100), price: D(10), currency: 'USD', counterpartyId: 'c', counterpartyRef: 'C1', accountRef: 'a', portfolioId: 'p', ...o });
  const int = (o: Partial<IntFill> & { id: string }): IntFill => ({ refs: [], orderRef: 'O', ticker: 'AAA', side: 'BUY', quantity: D(100), price: D(10), currency: 'USD', portfolioId: 'p', ...o });
  const open = matchTrades([], [int({ id: 'i1' })], D('0.01'));
  const gated = matchTrades([], [int({ id: 'i1' })], D('0.01'), undefined, { suppressMissingExternal: true });
  check('BR-065 engine: an unconfirmed internal fill is a break only when the population is complete', open.detected.length === 1 && open.detected[0]!.kind === 'MISSING_EXTERNAL' && gated.detected.length === 0);
  check('BR-065: population is received by executions or by a day-end package', populationReceived(3, false) && populationReceived(0, true) && !populationReceived(0, false));
  const a = { ticker: 'AAA', side: 'BUY', quantity: D(40), price: D(10) as Prisma.Decimal | null };
  check('candidate score: same security, side, quantity and price = 100', scoreCandidate(a, { ...a })?.score === 100);
  check('candidate score: quantity within 5% still qualifies (90); a different security never does', scoreCandidate(a, { ...a, quantity: D(41) })?.score === 90 && scoreCandidate(a, { ...a, ticker: 'BBB' }) === null);
  check('candidate score: wrong side and far quantity falls below the threshold', scoreCandidate(a, { ticker: 'AAA', side: 'SELL', quantity: D(80), price: D(10) }) === null);
  check('candidate kinds pair MISSING_INTERNAL with MISSING_EXTERNAL', CANDIDATE_KINDS.MISSING_INTERNAL === 'MISSING_EXTERNAL' && CANDIDATE_KINDS.MISSING_EXTERNAL === 'MISSING_INTERNAL');

  const camt = (opening: string, closing: string, entries: string, ccy = 'USD', extra = '') => `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>S1</Id><Acct><Id><IBAN>ZW00TEST</IBAN></Id><Ccy>${ccy}</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="${ccy}">${opening.replace('-', '')}</Amt><CdtDbtInd>${opening.startsWith('-') ? 'DBIT' : 'CRDT'}</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="${ccy}">${closing.replace('-', '')}</Amt><CdtDbtInd>${closing.startsWith('-') ? 'DBIT' : 'CRDT'}</CdtDbtInd></Bal>${entries}</Stmt>${extra}</BkToCstmrStmt></Document>`;
  const ntry = (amt: string, dir: 'CRDT' | 'DBIT', date: string, ref: string, info: string, extra = '') => `<Ntry><Amt Ccy="USD">${amt}</Amt><CdtDbtInd>${dir}</CdtDbtInd>${extra}<ValDt><Dt>${date}</Dt></ValDt><AcctSvcrRef>${ref}</AcctSvcrRef><AddtlNtryInf>${info}</AddtlNtryInf></Ntry>`;
  const c1 = parseStatement('CAMT053', camt('1000.00', '1299.50', ntry('500.00', 'CRDT', '2026-09-02', 'REF1', 'Wire &amp; co') + ntry('200.50', 'DBIT', '2026-09-03', 'REF2', 'Fee')), {});
  check('CAMT.053: balances, signs (debit negative) and entities', !c1.errors.length && c1.opening!.toFixed(2) === '1000.00' && c1.closing!.toFixed(2) === '1299.50' && c1.lines[0]!.amount.toFixed(2) === '500.00' && c1.lines[1]!.amount.toFixed(2) === '-200.50' && c1.lines[0]!.description === 'Wire & co' && c1.currency === 'USD' && c1.accountRef === 'ZW00TEST', c1.errors);
  const c2 = parseStatement('CAMT053', camt('100.00', '90.00', ntry('10.00', 'CRDT', '2026-09-02', 'RV1', 'Reversal of a credit', '<RvslInd>true</RvslInd>')), {});
  check('CAMT.053: a reversal of a credit is cash out', !c2.errors.length && c2.lines[0]!.amount.toFixed(2) === '-10.00', c2);
  const c3 = parseStatement('CAMT053', camt('0', '0', '', 'USD', '').replace('</BkToCstmrStmt>', '<Stmt><Id>S2</Id></Stmt></BkToCstmrStmt>'), {});
  check('CAMT.053: two statements in one file are refused', c3.errors.some((e) => /one statement per file/.test(e.message)), c3.errors);
  check('CAMT.053: not an XML statement is refused', parseStatement('CAMT053', 'date,amount\n2026-01-01,5', {}).errors.length === 1);
  const mt = `:20:STMT1\n:25:12345678/USD\n:28C:1/1\n:60F:C260901USD1000,00\n:61:2609020902C500,00NTRFREF123//BANK9\n:86:Incoming wire ACME\n:61:2609030903D200,50NCHGFEE1\n:86:Bank fee\n:62F:C260903USD1299,50\n-}`;
  const m1 = parseStatement('MT940', mt, {});
  check('MT940: opening, closing, signs, references and narrative', !m1.errors.length && m1.opening!.toFixed(2) === '1000.00' && m1.closing!.toFixed(2) === '1299.50' && m1.lines[0]!.amount.toFixed(2) === '500.00' && m1.lines[0]!.reference === 'BANK9' && m1.lines[0]!.description === 'Incoming wire ACME' && m1.lines[1]!.amount.toFixed(2) === '-200.50' && m1.currency === 'USD' && m1.accountRef === '12345678', m1.errors);
  check('MT940: an unreadable :61: line is reported, a file without :60F: is refused', parseStatement('MT940', mt.replace(':61:2609030903D200,50NCHGFEE1', ':61:garbage'), {}).errors.length >= 1 && parseStatement('MT940', 'hello', {}).errors.length === 1);
  const mt535 = renderMt535({ accountRef: 'SAFE-1', asOfDate: '2026-09-30', rows: [{ ticker: 'DLTA.ZW', isin: 'ZW0009012345', quantity: '1500' }, { ticker: 'CBZ.ZW', quantity: '20.5' }] });
  const p535 = parseMt535(mt535);
  check('MT535: account, date, instruments and decimal-comma quantities', !p535.errors.length && p535.accountRef === 'SAFE-1' && p535.asOfDate === '2026-09-30' && p535.rows.length === 2 && p535.rows[0]!.ticker === 'DLTA.ZW' && p535.rows[0]!.isin === 'ZW0009012345' && p535.rows[0]!.quantity === '1500' && p535.rows[1]!.quantity === '20.5', p535);
  check('MT535: an instrument without a balance, a duplicate and a non-MT535 text are errors', parseMt535(':16R:FIN\n:35B:ISIN ZW0009012345\n/ZW/AAA\n:16S:FIN').errors.length >= 1 && parseMt535(mt535 + '\n' + mt535.split('\n').slice(-3).join('\n')).errors.length >= 1 && parseMt535('hello').errors.length >= 1);
  check('sub-ledger tie-out: equal and within tolerance pass, one cent beyond fails', tieOut(D(100), D(100), D(0)).ok && tieOut(D(100), D('100.01'), D('0.01')).ok && !tieOut(D(100), D('100.02'), D('0.01')).ok);
  check('disposition rules: funding needs a ledger and an open call; a dispute needs evidence, house calc and outcome', dispositionProblems('FUNDED', 'ACKNOWLEDGED', { fundingLedgerId: 'x' }).length === 0 && dispositionProblems('FUNDED', 'DISPUTED', { fundingLedgerId: 'x' }).length === 1 && dispositionProblems('DISPUTE_RESOLVED', 'DISPUTED', {}).length === 4 && dispositionProblems('DISPUTE_RESOLVED', 'DISPUTED', { counterpartyEvidenceRef: 'e', houseCalcAmount: '0', houseCalcNote: 'note!', outcome: 'CALL_STANDS' }).length === 0);

  // ---------------------------------------------------------------- fixtures
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `sd-${run}-${label}@example.test`, name: `SD ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(roleKey)).id } });
    return u;
  };
  const opsU = await mkUser('ops', 'operations'); // recon.manage + recon.signoff, financing.manage, cash maker
  const faU = await mkUser('fa', 'fund_accountant'); // cash checker, recon.signoff
  const compU = await mkUser('comp', 'compliance'); // financing.manage + financing.approve, recon.signoff
  const comp2U = await mkUser('comp2', 'compliance');
  const pmU = await mkUser('pm', 'portfolio_manager'); // operations.view only for recon
  const ops = client();
  const fa = client();
  const comp = client();
  const comp2 = client();
  const pm = client();
  const staleMfa = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });

  const createdPortfolios: string[] = [];
  const createdSecurities: string[] = [];
  const createdCps: string[] = [];
  const createdClients: string[] = [];
  const auditCount = (action: string, objectId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}) } });

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[ops, opsU], [fa, faU], [comp, compU], [comp2, comp2U], [pm, pmU]] as const) check(`${u.name} signs in`, (await c.login(u.email)).status === 200);
    for (const [n, c] of [['ops', ops], ['fa', fa], ['comp', comp], ['comp2', comp2]] as const) check(`${n} enrols MFA`, await c.enrolMfa());

    // ================================================================ BR-065 and candidate matches
    const D0 = dayStr(-9);
    const D1 = dayStr(-8);
    const secA = await prisma.security.create({ data: { ticker: `S${run}A`.toUpperCase(), name: `S2 A ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: 'S', status: 'Active' } });
    createdSecurities.push(secA.id);
    const pf = await prisma.portfolio.create({ data: { ref: `SD-${run}`, name: `SD Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
    createdPortfolios.push(pf.id);
    const acc = `ACC-${run}`;
    const cp = await prisma.counterparty.create({ data: { ref: `CPS${run}`, name: `SD Custodian ${run}`, type: 'CUSTODIAN', accounts: [acc] } });
    createdCps.push(cp.id);
    check('map the custodian account to the portfolio', (await ops.put(`${R}/account-map`, { counterpartyId: cp.id, accountRef: acc, portfolioId: pf.id })).status === 200);
    let seq = 0;
    const mkFill = async (qty: number, price: string, date: string, ref: string | null = null) => {
      const o = await prisma.order.create({ data: { ref: `SD${run}${++seq}`, portfolioId: pf.id, securityId: secA.id, side: 'BUY', quantity: D(qty), orderType: 'MARKET', currency: 'USD', decisionPrice: D(price), status: 'Filled', makerId: opsU.id, filledQty: D(qty), avgPrice: D(price) } });
      return prisma.orderFill.create({ data: { orderId: o.id, quantity: D(qty), price: D(price), executedAt: new Date(`${date}T10:00:00.000Z`), source: 'CONTRACT_NOTE', sourceRef: ref, recordedBy: opsU.id } });
    };
    const mkExec = (tradeRef: string, qty: number, price: string, date: string) =>
      prisma.counterpartyExecution.create({ data: { ref: `X${run}${++seq}`, counterpartyId: cp.id, tradeRef, executionAt: new Date(`${date}T10:00:00.000Z`), accountRef: acc, ticker: secA.ticker, side: 'BUY', quantity: D(qty), price: D(price), currency: 'USD', status: 'Received', submittedById: opsU.id } });
    const runReq = (c: ReturnType<typeof client>, body: object, label: string) => c.post(`${R}/runs`, body, { 'Idempotency-Key': key(label) });

    console.log('\nBR-065: no break before the counterparty population is received');
    await mkFill(40, '10.00', D0);
    const r0 = await runReq(ops, { family: 'TRADES', asOfDate: D0, counterpartyId: cp.id }, 'br065a');
    check('no executions and no day-end package: run is SOURCE_MISSING with no break', r0.status === 201 && r0.body.data.status === 'SOURCE_MISSING' && r0.body.data.breakCount === 0, r0.body);
    const run0 = await prisma.reconRun.findUnique({ where: { id: r0.body.data.id } });
    check('the missing source names the account', JSON.stringify(run0?.summary).includes(acc), run0?.summary);
    const ready0 = await ops.get(`${R}/signoffs/readiness?family=TRADES&asOf=${D0}&counterpartyId=${cp.id}`);
    check('sign-off readiness lists the missing source for TRADES', (ready0.body?.data?.missingSources ?? []).some((m: any) => m.accountRef === acc) && ready0.body?.data?.ready === false, ready0.body);
    await prisma.counterpartyDayEndPackage.create({ data: { ref: `D${run}0`, counterpartyId: cp.id, accountRef: acc, statementDate: day(D0), currency: 'USD', closingCash: D(0), holdingsMv: D(0), tradeCount: 0, sha256: 'b'.repeat(64), submittedById: opsU.id } });
    const r0b = await runReq(ops, { family: 'TRADES', asOfDate: D0, counterpartyId: cp.id }, 'br065b');
    const b0 = await prisma.reconBreak.findMany({ where: { runId: r0b.body.data.id } });
    check('once the day-end package is in, the unconfirmed fill is a MISSING_EXTERNAL break', r0b.body.data.status === 'BREAKS' && b0.length === 1 && b0[0]!.kind === 'MISSING_EXTERNAL', { s: r0b.body.data.status, b0: b0.map((b) => b.kind) });

    console.log('\nFR-REC-006: accept candidate match');
    // custodian says 41, the book says 40: no exact match, so two breaks that are really one trade
    await mkFill(40, '10.00', D1);
    await mkExec('CAND-1', 41, '10.01', D1);
    await prisma.counterpartyDayEndPackage.create({ data: { ref: `D${run}1`, counterpartyId: cp.id, accountRef: acc, statementDate: day(D1), currency: 'USD', closingCash: D(0), holdingsMv: D(0), tradeCount: 1, sha256: 'c'.repeat(64), submittedById: opsU.id } });
    const r1 = await runReq(ops, { family: 'TRADES', asOfDate: D1, counterpartyId: cp.id }, 'cand');
    const bs = await prisma.reconBreak.findMany({ where: { runId: r1.body.data.id } });
    const bInt = bs.find((b) => b.kind === 'MISSING_INTERNAL');
    const bExt = bs.find((b) => b.kind === 'MISSING_EXTERNAL');
    check('a quantity that is not exact leaves one break on each side', r1.body.data.breakCount === 2 && !!bInt && !!bExt, bs.map((b) => b.kind));
    const detail = await ops.get(`${R}/breaks/${bInt!.id}`);
    check('the server offers accept-candidate to the maker on a trade break', detail.body?.allowed?.acceptCandidate === true, detail.body?.allowed);
    const cands = await pm.get(`${R}/breaks/${bInt!.id}/candidates`);
    check('candidates (readable with operations.view) list the other side, scored 90', cands.status === 200 && cands.body.data.length === 1 && cands.body.data[0].id === bExt!.id && cands.body.data[0].score === 90, cands.body);
    const pmAccept = await pm.post(`${R}/breaks/${bInt!.id}/accept-candidate`, { candidateBreakId: bExt!.id, cause: 'BOOKING_ERROR', rationale: 'Same trade, booked 40 not 41' });
    check('a viewer cannot accept -> 403', pmAccept.status === 403, pmAccept.body);
    const notCand = await ops.post(`${R}/breaks/${bInt!.id}/accept-candidate`, { candidateBreakId: b0[0]!.id, cause: 'BOOKING_ERROR', rationale: 'Not the same trade at all' });
    check('a break that is not a candidate -> 400', notCand.status === 400, notCand.body);
    const shortWhy = await ops.post(`${R}/breaks/${bInt!.id}/accept-candidate`, { candidateBreakId: bExt!.id, cause: 'BOOKING_ERROR', rationale: 'short' });
    check('a rationale under 10 characters -> 400', shortWhy.status === 400, shortWhy.body);
    const acc1 = await ops.post(`${R}/breaks/${bInt!.id}/accept-candidate`, { candidateBreakId: bExt!.id, cause: 'BOOKING_ERROR', rationale: 'Same trade, booked 40 not 41', version: detail.body.data.version }, { 'Idempotency-Key': key('acc') });
    check('maker accepts the candidate -> both PENDING_CHECKER', acc1.status === 200 && acc1.body.data.status === 'PENDING_CHECKER' && acc1.body.data.candidate.status === 'PENDING_CHECKER', acc1.body);
    const after = await prisma.reconBreak.findMany({ where: { id: { in: [bInt!.id, bExt!.id] } } });
    check('both breaks carry the maker, cause, candidate reference and evidence', after.every((b) => b.status === 'PENDING_CHECKER' && b.makerId === opsU.id && b.cause === 'BOOKING_ERROR' && b.evidenceRef?.startsWith('Candidate match REC-') && (b.acceptedCandidate as any)?.score === 90), after.map((b) => [b.status, b.evidenceRef]));
    check('the case history records the acceptance on both', (await prisma.reconBreakEvent.count({ where: { breakId: { in: [bInt!.id, bExt!.id] }, action: { in: ['candidate_accepted', 'candidate_accepted_peer'] } } })) === 2 && (await auditCount('recon.break_candidate_accepted', bInt!.id)) === 1);
    const again = await ops.post(`${R}/breaks/${bInt!.id}/accept-candidate`, { candidateBreakId: bExt!.id, cause: 'BOOKING_ERROR', rationale: 'Trying to accept again' });
    check('accepting again while pending -> 409', again.status === 409, again.body);
    await ops.stepUp();
    const selfApprove = await ops.post(`${R}/breaks/${bInt!.id}/approve`, {});
    check('the maker cannot approve their own acceptance (maker-checker)', selfApprove.status === 403, selfApprove.body);
    await fa.stepUp();
    const ap1 = await fa.post(`${R}/breaks/${bInt!.id}/approve`, {});
    const ap2 = await fa.post(`${R}/breaks/${bExt!.id}/approve`, {});
    check('an independent checker approves both -> CLOSED', ap1.status === 200 && ap2.status === 200 && ap1.body.data.status === 'CLOSED' && ap2.body.data.status === 'CLOSED', [ap1.body, ap2.body]);

    // ================================================================ FR-REC-017 and FR-CASH-017 feeds
    console.log('\nFR-REC-017: one counterpart_imports pipeline for manual and connector imports');
    const FD = dayStr(-3);
    const FD2 = dayStr(-4);
    const rows = [{ ticker: secA.ticker, quantity: '40' }];
    const up = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: FD, rows }, { 'Idempotency-Key': key('feed1') });
    check('manual positions upload -> 201 with a FEED batch and an import id', up.status === 201 && /^FEED-\d{5}$/.test(up.body.batchRef) && !!up.body.importId, up.body);
    const imp1 = await prisma.reconCounterpartImport.findUnique({ where: { id: up.body.importId } });
    check('the batch records channel, feed, account, file name, record count and SHA-256', imp1?.source === 'MANUAL' && imp1.feed === 'POSITIONS' && imp1.accountRef === acc && imp1.recordCount === 1 && /^[0-9a-f]{64}$/.test(imp1.sha256) && imp1.filename.length > 0 && imp1.status === 'RECEIVED' && imp1.ref === up.body.batchRef, imp1);
    const up2 = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: FD, rows: [{ ticker: secA.ticker, quantity: '45' }] }, { 'Idempotency-Key': key('feed2') });
    check('a replacement file supersedes the earlier batch', up2.status === 200 && up2.body.replaced === true && (await prisma.reconCounterpartImport.findUnique({ where: { id: up.body.importId } }))?.status === 'SUPERSEDED');
    const list = await pm.get(`${R}/counterpart-imports?asOf=${FD}&counterpartyId=${cp.id}`);
    check('GET /counterpart-imports lists both batches, newest first, with the counterparty name', list.status === 200 && list.body.data.length === 2 && list.body.data[0].status === 'RECEIVED' && list.body.data[0].counterparty.name === cp.name, list.body);
    check('the list filters by channel', (await pm.get(`${R}/counterpart-imports?source=CONNECTOR&counterpartyId=${cp.id}`)).body.data.length === 0);
    check('a viewer cannot upload -> 403', (await pm.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: FD, rows })).status === 403);

    console.log('\nFR-CASH-017 / FR-REC-017: MT535 holdings statement through the same pipeline');
    const goodMt = renderMt535({ accountRef: acc, asOfDate: FD2, rows: [{ ticker: secA.ticker, isin: 'ZW0009012345', quantity: '1500' }, { ticker: `S${run}Z`.toUpperCase(), quantity: '20.5' }] });
    const mtUp = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: FD2, content: goodMt }, { 'Idempotency-Key': key('mt535') });
    check('MT535 upload -> 201, two rows, format MT535', mtUp.status === 201 && mtUp.body.rows === 2, mtUp.body);
    const mtImp = await prisma.reconCounterpartImport.findUnique({ where: { id: mtUp.body.importId } });
    check('the MT535 batch is recorded as MT535 with 2 records', mtImp?.format === 'MT535' && mtImp.recordCount === 2 && mtImp.feed === 'POSITIONS', mtImp);
    const stored = await prisma.reconCustodyPosition.findMany({ where: { counterpartyId: cp.id, accountRef: acc, asOfDate: day(FD2) }, orderBy: { ticker: 'asc' } });
    check('quantities were read with the SWIFT decimal comma', stored.length === 2 && stored.some((p) => p.quantity.toFixed(1) === '1500.0') && stored.some((p) => p.quantity.toFixed(1) === '20.5'), stored.map((p) => p.quantity.toString()));
    const wrongAcc = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: FD2, content: renderMt535({ accountRef: 'OTHER-ACC', asOfDate: FD2, rows: [{ ticker: secA.ticker, quantity: '1' }] }) }, { 'Idempotency-Key': key('mt535b') });
    check('an MT535 for another safekeeping account -> 400 naming both', wrongAcc.status === 400 && /OTHER-ACC/.test(JSON.stringify(wrongAcc.body)), wrongAcc.body);
    const wrongDay = await ops.post(`${R}/custody-positions`, { counterpartyId: cp.id, accountRef: acc, asOfDate: FD2, content: renderMt535({ accountRef: acc, asOfDate: FD, rows: [{ ticker: secA.ticker, quantity: '1' }] }) }, { 'Idempotency-Key': key('mt535c') });
    check('an MT535 dated differently from the file date -> 400', wrongDay.status === 400, wrongDay.body);

    console.log('\nFR-REC-017: connector pull');
    const CD = dayStr(-5);
    const fileId = '00000000-0000-4000-8000-' + randomBytes(6).toString('hex');
    await prisma.counterpartyDayEndPackage.create({ data: { ref: `D${run}9`, counterpartyId: cp.id, accountRef: acc, statementDate: day(CD), currency: 'USD', closingCash: D(10), holdingsMv: D(400), tradeCount: 0, sha256: 'd'.repeat(64), note: `Imported from ${run}.csv (custodian feed)`, submittedById: opsU.id } });
    await prisma.custodianFeedHolding.create({ data: { fileId, counterpartyId: cp.id, accountRef: acc, statementDate: day(CD), ticker: secA.ticker, quantity: D(40), currency: 'USD' } });
    const pull = await ops.post(`${R}/connector-imports`, { counterpartyId: cp.id, accountRef: acc, asOfDate: CD }, { 'Idempotency-Key': key('pull') });
    if (pull.status === 201) {
      const ci = await prisma.reconCounterpartImport.findUnique({ where: { id: pull.body.importId } });
      check('connector pull -> batch with source CONNECTOR and the adapter name', ci?.source === 'CONNECTOR' && ci.connector === pull.body.connector && ci.feed === 'POSITIONS' && ci.recordCount === 1 && /connector-/.test(ci.filename), ci);
      check('the pulled holdings landed in the same custody position table and receipt', (await prisma.reconCustodyPosition.count({ where: { counterpartyId: cp.id, accountRef: acc, asOfDate: day(CD) } })) === 1 && !!(await prisma.reconSourceReceipt.findFirst({ where: { counterpartyId: cp.id, accountRef: acc, asOfDate: day(CD), feed: 'POSITIONS' } })));
    } else check('connector answers cleanly when the configured adapter has no data (404 or 503, never 500)', [404, 503].includes(pull.status), pull.body);
    const noStmt = await ops.post(`${R}/connector-imports`, { counterpartyId: cp.id, accountRef: acc, asOfDate: dayStr(-20) }, { 'Idempotency-Key': key('pull2') });
    check('a date the connector has no statement for -> 404 or 503', [404, 503].includes(noStmt.status), noStmt.body);
    check('a viewer cannot pull -> 403', (await pm.post(`${R}/connector-imports`, { counterpartyId: cp.id, accountRef: acc, asOfDate: CD })).status === 403);

    // ================================================================ cash: statements, tie-out, explain, context
    console.log('\nCash fixtures');
    const cashClient = await prisma.client.create({ data: { ref: `X${run}C`, name: `SD Client ${run}`, type: 'Pension fund', portalEnabled: false, kycStatus: 'Current' } });
    const otherClient = await prisma.client.create({ data: { ref: `X${run}D`, name: `SD Other Client ${run}`, type: 'Pension fund', portalEnabled: false, kycStatus: 'Current' } });
    createdClients.push(cashClient.id, otherClient.id);
    const cashAcct = await prisma.cashAccount.create({ data: { ref: `CC${run}`.slice(0, 16), clientId: cashClient.id, legalEntity: `SD Client ${run}`, currency: 'USD', masked: '****4321', status: 'ACTIVE' } });
    const cpf = await prisma.portfolio.create({ data: { ref: `SC-${run}`, name: `SD Cash Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active', clientId: cashClient.id } });
    const opf = await prisma.portfolio.create({ data: { ref: `SO-${run}`, name: `SD Other Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active', clientId: otherClient.id } });
    createdPortfolios.push(cpf.id, opf.id);
    for (const p of [cpf, opf]) check(`standard ledgers for ${p.ref}`, (await fa.post(`${C}/ledgers/default-set`, { portfolioId: p.id }, { 'Idempotency-Key': key('ls' + p.ref) })).status === 201);
    const ledgersOf = async (pid: string) => (await prisma.cashLedger.findMany({ where: { portfolioId: pid } }));
    const cl = await ledgersOf(cpf.id);
    const bank = cl.find((l) => l.kind === 'BANK')!;
    const control = cl.find((l) => l.kind === 'CONTROL')!;
    const clearing = cl.find((l) => l.kind === 'CLEARING')!;
    await prisma.cashLedger.update({ where: { id: bank.id }, data: { cashAccountId: cashAcct.id, minBuffer: D(1000) } });
    const postedJournal = async (pid: string, ledgerDr: string, ledgerCr: string, amount: number, date: string, purpose = 'CLIENT_DEPOSIT', status = 'POSTED') => {
      const j = await prisma.cashJournal.create({ data: { ref: `CJ${run}${++seq}`.slice(0, 16), portfolioId: pid, entryDate: day(date), description: `S2 ${purpose} ${amount}`, purpose, currency: 'USD', status, totalDebit: D(amount), totalCredit: D(amount), makerId: opsU.id, postedBy: status === 'POSTED' ? faU.id : null, postedAt: status === 'POSTED' ? new Date() : null } });
      await prisma.cashJournalLine.createMany({ data: [{ journalId: j.id, lineNo: 1, ledgerId: ledgerDr, debit: D(amount), credit: D(0) }, { journalId: j.id, lineNo: 2, ledgerId: ledgerCr, debit: D(0), credit: D(amount) }] });
      return j;
    };
    await postedJournal(cpf.id, bank.id, control.id, 100000, dayStr(-30));

    console.log('\nFR-CASH-009: context bar filters');
    const ctx = await fa.get(`${C}/context`);
    check('context lists the client, portfolio, linked cash account and currencies', ctx.status === 200 && ctx.body.data.clients.some((c: any) => c.id === cashClient.id) && ctx.body.data.portfolios.some((p: any) => p.id === cpf.id && p.clientId === cashClient.id) && ctx.body.data.cashAccounts.some((a: any) => a.id === cashAcct.id && a.portfolioIds.includes(cpf.id)) && ctx.body.data.currencies.includes('USD'), ctx.body);
    check('anonymous cannot read the context', (await client().get(`${C}/context`)).status === 401);
    const byClient = await fa.get(`${C}/balances?clientId=${cashClient.id}`);
    check('balances by client returns only that client\'s ledgers', byClient.status === 200 && byClient.body.data.ledgers.length >= 1 && byClient.body.data.ledgers.every((l: any) => l.portfolioId === cpf.id), byClient.body.data?.ledgers?.map((l: any) => l.portfolioId));
    const byOther = await fa.get(`${C}/balances?clientId=${otherClient.id}`);
    check('another client sees only its own ledgers, not this one', byOther.body.data.ledgers.length >= 1 && byOther.body.data.ledgers.every((l: any) => l.portfolioId === opf.id));
    const crossed = await fa.get(`${C}/balances?clientId=${otherClient.id}&portfolioId=${cpf.id}`);
    check('a portfolio outside the chosen client yields nothing', crossed.status === 200 && crossed.body.data.ledgers.length === 0, crossed.body.data?.ledgers?.length);
    const byAcct = await fa.get(`${C}/balances?cashAccountId=${cashAcct.id}`);
    check('balances by cash account returns the linked bank ledger with its account id', byAcct.body.data.ledgers.length === 1 && byAcct.body.data.ledgers[0].ledgerId === bank.id && byAcct.body.data.ledgers[0].cashAccountId === cashAcct.id && byAcct.body.data.ledgers[0].posted === '100000.00', byAcct.body.data);
    check('a currency that has no ledger yields nothing', (await fa.get(`${C}/balances?clientId=${cashClient.id}&currency=ZWG`)).body.data.ledgers.length === 0);

    console.log('\nFR-CASH-010: explain with holds, pending withdrawals and policy lines');
    await prisma.cashReservation.create({ data: { ref: `RS${run}1`.slice(0, 16), portfolioId: cpf.id, ledgerId: bank.id, source: 'ORDER-S2', purpose: 'BUY_SETTLEMENT', currency: 'USD', amount: D(20000), requiredDate: day(dayStr(1)), createdBy: opsU.id } });
    await prisma.cashReservation.create({ data: { ref: `RS${run}2`.slice(0, 16), portfolioId: cpf.id, ledgerId: bank.id, source: 'WD-S2', purpose: 'WITHDRAWAL', currency: 'USD', amount: D(5000), requiredDate: day(dayStr(1)), createdBy: opsU.id } });
    await postedJournal(cpf.id, control.id, bank.id, 3000, dayStr(0), 'CLIENT_WITHDRAWAL', 'PENDING_APPROVAL');
    const ex = await fa.get(`${C}/balances/explain?ledgerId=${bank.id}`);
    const x = ex.body?.data;
    check('explain: posted 100,000 - holds 20,000 - reserved withdrawal 5,000 - buffer 1,000 = 74,000 available', ex.status === 200 && x.posted === '100000.00' && x.reserved === '25000.00' && x.minBuffer === '1000.00' && x.available === '74000.00', x);
    check('explain: holds and reserved withdrawals are listed separately', x?.holds.length === 1 && x.holds[0].source === 'ORDER-S2' && x.pendingWithdrawals.reserved.length === 1 && x.pendingWithdrawals.reserved[0].source === 'WD-S2', x?.pendingWithdrawals);
    check('explain: a withdrawal awaiting approval is listed but not in availability', x?.pendingWithdrawals.awaitingApproval.length === 1 && x.pendingWithdrawals.awaitingApproval[0].amount === '3000.00' && x.pendingWithdrawals.awaitingApproval[0].inAvailability === false, x?.pendingWithdrawals?.awaitingApproval);
    check('explain: the buffer is a policy line', x?.policyLines.length === 1 && x.policyLines[0].key === 'MIN_BUFFER' && x.policyLines[0].amount === '1000.00');
    check('explain: contributions sum to the minor unit and tie to the available figure', x?.contributionSum === '74000.00' && x.rawAvailable === '74000.00' && x.ties === true && x.contributions.length === 4, { sum: x?.contributionSum, raw: x?.rawAvailable, ties: x?.ties, n: x?.contributions?.length });

    console.log('\nFR-CASH-017: CAMT.053 and MT940 statement import');
    const stmt = (fmt: 'CAMT053' | 'MT940', content: string, name: string, ledgerId = bank.id) => fa.post(`${C}/statement-imports`, { ledgerId, filename: name, format: fmt, content }, { 'Idempotency-Key': key('st' + name) });
    const camtOk = camt('100000.00', '100300.00', ntry('500.00', 'CRDT', dayStr(-20), `RF${run}1`, 'Wire in') + ntry('200.00', 'DBIT', dayStr(-19), `RF${run}2`, 'Bank fee'));
    const s1 = await stmt('CAMT053', camtOk, 'stmt.xml');
    check('CAMT.053 stages: 2 lines, opening 100,000, closing 100,300, signs normalised', s1.status === 201 && s1.body.data.lineCount === 2 && s1.body.data.openingBalance === '100000.00' && s1.body.data.closingBalance === '100300.00' && s1.body.data.format === 'CAMT053', s1.body);
    const lines1 = await prisma.cashStatementLine.findMany({ where: { importId: s1.body.data.id }, orderBy: { lineNo: 'asc' } });
    check('credit is cash in, debit is cash out', lines1[0]!.amount.toFixed(2) === '500.00' && lines1[1]!.amount.toFixed(2) === '-200.00', lines1.map((l) => l.amount.toString()));
    const s1b = await stmt('CAMT053', camtOk, 'stmt-again.xml');
    check('re-uploading the same file -> 409 duplicate_file', s1b.status === 409 && errCode(s1b) === 'duplicate_file', s1b.body);
    const sBad = await stmt('CAMT053', camt('100.00', '999.00', ntry('1.00', 'CRDT', dayStr(-10), `RF${run}9`, 'x')), 'bad.xml');
    check('arithmetic outside tolerance -> 400 statement_does_not_foot', sBad.status === 400 && errCode(sBad) === 'statement_does_not_foot', sBad.body);
    const sCcy = await stmt('CAMT053', camt('0.00', '1.00', ntry('1.00', 'CRDT', dayStr(-10), `RF${run}8`, 'x'), 'EUR'), 'eur.xml');
    check('a statement in another currency than the ledger -> 400', sCcy.status === 400 && /EUR/.test(JSON.stringify(sCcy.body)), sCcy.body);
    const mt940 = `:20:S${run}\n:25:ZW123/USD\n:28C:1/1\n:60F:C${dayStr(-12).slice(2).replace(/-/g, '')}USD100300,00\n:61:${dayStr(-11).slice(2).replace(/-/g, '')}C250,00NTRFM${run}1\n:86:Dividend\n:62F:C${dayStr(-11).slice(2).replace(/-/g, '')}USD100550,00\n-}`;
    const s2 = await stmt('MT940', mt940, 'stmt.sta');
    check('MT940 stages: 1 line, opening 100,300, closing 100,550', s2.status === 201 && s2.body.data.lineCount === 1 && s2.body.data.openingBalance === '100300.00' && s2.body.data.closingBalance === '100550.00' && s2.body.data.format === 'MT940', s2.body);
    const sGarbage = await stmt('MT940', 'this is not a statement', 'junk.sta');
    check('an unreadable MT940 -> 400 listing the problem', sGarbage.status === 400, sGarbage.body);

    console.log('\nFR-CASH-018: sub-ledger to GL tie-out at close');
    const PE = dayStr(0);
    const pre0 = await fa.get(`${C}/period-closes/precheck?portfolioId=${cpf.id}&periodEnd=${PE}`);
    const g0 = pre0.body?.data?.items?.find((i: any) => i.key === 'SUBLEDGER_GL');
    check('a portfolio without a general ledger has nothing to tie out', pre0.status === 200 && g0?.ok === true && /nothing to tie out/.test(g0.detail), g0);
    const gl = await prisma.accAccount.create({ data: { portfolioId: cpf.id, code: '1000', name: 'Cash at bank', type: 'ASSET', createdBy: opsU.id } });
    const eq = await prisma.accAccount.create({ data: { portfolioId: cpf.id, code: '3000', name: 'Capital', type: 'EQUITY', createdBy: opsU.id } });
    const preA = await fa.get(`${C}/period-closes/precheck?portfolioId=${cpf.id}&periodEnd=${PE}`);
    const gA = preA.body.data.items.find((i: any) => i.key === 'SUBLEDGER_GL');
    check('a general ledger with no cash while the bank holds 100,000 blocks the close with the amounts', gA.ok === false && gA.blockers.length === 1 && /100000\.00/.test(gA.blockers[0]) && /USD/.test(gA.blockers[0]) && preA.body.data.canClose === false, gA);
    const glj = async (amount: number, status = 'POSTED') => {
      const j = await prisma.accJournal.create({ data: { ref: `GJ${run}${++seq}`.slice(0, 16), portfolioId: cpf.id, entryDate: day(dayStr(-29)), description: 'S2 GL cash', currency: 'USD', status, totalDebit: D(amount), totalCredit: D(amount), makerId: opsU.id, postedBy: faU.id, postedAt: new Date() } });
      await prisma.accJournalLine.createMany({ data: [{ journalId: j.id, lineNo: 1, accountId: gl.id, debit: D(amount), credit: D(0) }, { journalId: j.id, lineNo: 2, accountId: eq.id, debit: D(0), credit: D(amount) }] });
      return j;
    };
    await glj(99000);
    const preB = await fa.get(`${C}/period-closes/precheck?portfolioId=${cpf.id}&periodEnd=${PE}`);
    const gB = preB.body.data.items.find((i: any) => i.key === 'SUBLEDGER_GL');
    check('a 1,000 difference is itemised with both sides and the difference', gB.ok === false && /100000\.00/.test(gB.blockers[0]) && /99000\.00/.test(gB.blockers[0]) && /-1000\.00/.test(gB.blockers[0]), gB);
    await glj(1000);
    const preC = await fa.get(`${C}/period-closes/precheck?portfolioId=${cpf.id}&periodEnd=${PE}`);
    const gC = preC.body.data.items.find((i: any) => i.key === 'SUBLEDGER_GL');
    check('once the general ledger agrees the item passes', gC.ok === true && gC.blockers.length === 0, gC);
    await glj(7, 'PENDING_APPROVAL');
    const preD = await fa.get(`${C}/period-closes/precheck?portfolioId=${cpf.id}&periodEnd=${PE}`);
    check('a GL journal still awaiting approval does not count toward the tie-out', preD.body.data.items.find((i: any) => i.key === 'SUBLEDGER_GL').ok === true);
    await prisma.policy.upsert({ where: { key: 'cash_gl_tieout' }, create: { key: 'cash_gl_tieout', value: false }, update: { value: false } });
    await glj(500);
    const preE = await fa.get(`${C}/period-closes/precheck?portfolioId=${cpf.id}&periodEnd=${PE}`);
    const gE = preE.body.data.items.find((i: any) => i.key === 'SUBLEDGER_GL');
    check('the policy cash_gl_tieout = false switches the gate off (and reports why)', gE.ok === true && /policy/i.test(gE.detail), gE);
    await prisma.policy.delete({ where: { key: 'cash_gl_tieout' } }).catch(() => undefined);

    // ================================================================ margin disposition
    console.log('\nFR-FIN-002 / FR-FIN-004: margin disposition with an independent checker');
    const fac = await prisma.finFacility.create({ data: { ref: `FS${run}`.slice(0, 16), name: `S2 line ${run}`, type: 'MARGIN_LOAN', lender: 'S2 Bank', portfolioId: cpf.id, currency: 'USD', limitAmount: D(1000000), initialRatio: D('1.5'), maintenanceRatio: D('1.25'), status: 'ACTIVE', makerId: opsU.id, approverId: compU.id, approvedAt: new Date() } });
    const mkCall = (n: number, status: string, amount = 25000) =>
      prisma.finMarginCall.create({ data: { ref: `MS${run}${n}`.slice(0, 16), facilityId: fac.id, status, calledAmount: D(amount), drawn: D(500000), eligibleValue: D(600000), coverageRatio: D('1.2'), dueAt: new Date(Date.now() + 2 * 86_400_000), issuedBy: opsU.id } });
    const call1 = await mkCall(1, 'ACKNOWLEDGED');
    const call2 = await mkCall(2, 'ACKNOWLEDGED');
    const call3 = await mkCall(3, 'DISPUTED');
    const call4 = await mkCall(4, 'DISPUTED');
    const zwgLedger = await prisma.cashLedger.create({ data: { ref: `CLZ${run}`.slice(0, 16), portfolioId: cpf.id, name: 'ZWG bank', currency: 'ZWG', kind: 'BANK', createdBy: opsU.id } });
    await ops.stepUp();
    const noStep = await (async () => { await staleMfa(opsU.id); return ops.post(`${F}/calls/${call1.id}/disposition`, { kind: 'FUNDED', reason: 'Wired to the lender', fundingLedgerId: bank.id }); })();
    check('a proposal needs step-up MFA -> 401', noStep.status === 401, noStep.body);
    await ops.stepUp();
    const viewerProp = await fa.post(`${F}/calls/${call1.id}/disposition`, { kind: 'FUNDED', reason: 'Wired to the lender', fundingLedgerId: bank.id });
    check('a user without financing.manage cannot propose -> 403', viewerProp.status === 403, viewerProp.body);
    const wrongLedger = await ops.post(`${F}/calls/${call1.id}/disposition`, { kind: 'FUNDED', reason: 'Wired to the lender', fundingLedgerId: zwgLedger.id });
    check('a ledger in another currency -> 400', wrongLedger.status === 400 && /ZWG/.test(JSON.stringify(wrongLedger.body)), wrongLedger.body);
    const otherPfLedger = (await ledgersOf(opf.id)).find((l) => l.kind === 'BANK')!;
    const foreign = await ops.post(`${F}/calls/${call1.id}/disposition`, { kind: 'FUNDED', reason: 'Wired to the lender', fundingLedgerId: otherPfLedger.id });
    check('a ledger of another portfolio -> 400', foreign.status === 400, foreign.body);
    const shortReason = await ops.post(`${F}/calls/${call1.id}/disposition`, { kind: 'FUNDED', reason: 'short', fundingLedgerId: bank.id });
    check('a reason under 10 characters -> 400', shortReason.status === 400, shortReason.body);
    const fundDisputed = await ops.post(`${F}/calls/${call3.id}/disposition`, { kind: 'FUNDED', reason: 'Wired to the lender', fundingLedgerId: bank.id });
    check('funding a disputed call -> 400 (resolve the dispute first)', fundDisputed.status === 400, fundDisputed.body);
    const resolveAck = await ops.post(`${F}/calls/${call1.id}/disposition`, { kind: 'DISPUTE_RESOLVED', reason: 'Not actually disputed', outcome: 'CALL_STANDS', counterpartyEvidenceRef: 'x1', houseCalcAmount: '1', houseCalcNote: 'note here' });
    check('resolving a dispute on a call that is not disputed -> 400', resolveAck.status === 400, resolveAck.body);

    const prop1 = await ops.post(`${F}/calls/${call1.id}/disposition`, { kind: 'FUNDED', reason: 'Wired to the lender today', fundingLedgerId: bank.id, fundingAmount: '25000' }, { 'Idempotency-Key': key('p1') });
    check('maker proposes funding -> PENDING_CHECK with the disposition recorded', prop1.status === 200 && prop1.body.data.status === 'PENDING_CHECK' && prop1.body.data.disposition.kind === 'FUNDED' && prop1.body.data.disposition.proposedBy === opsU.id && prop1.body.data.disposition.fundingAmount === '25000.00', prop1.body);
    const exp1 = await prisma.cashExpectation.findUnique({ where: { id: prop1.body.data.disposition.expectationId } });
    check('funding raised a cash expectation: OUT, MARGIN_CALL, 25,000, source MC:<ref>, on the chosen ledger', exp1?.direction === 'OUT' && exp1.kind === 'MARGIN_CALL' && exp1.amount.toFixed(2) === '25000.00' && exp1.source === `MC:${call1.ref}` && exp1.ledgerId === bank.id && exp1.status === 'EXPECTED', exp1);
    check('audit fin.margin_disposition_proposed', (await auditCount('fin.margin_disposition_proposed', call1.id)) === 1);
    const dup = await ops.post(`${F}/calls/${call1.id}/disposition`, { kind: 'FUNDED', reason: 'Wired to the lender again', fundingLedgerId: bank.id });
    check('a second proposal while one is pending -> 409', dup.status === 409, dup.body);
    for (const verb of ['resolve', 'waive', 'cancel']) {
      const body = verb === 'resolve' ? { note: 'Collateral posted today' } : { reason: 'Trying to bypass the checker' };
      await ops.stepUp();
      await comp.stepUp();
      const r = await (verb === 'waive' ? comp : ops).post(`${F}/calls/${call1.id}/${verb}`, body);
      check(`${verb} while a disposition awaits its checker -> 409`, r.status === 409, r.body);
    }
    await ops.stepUp();
    const selfOps = await ops.post(`${F}/calls/${call1.id}/disposition/approve`, {});
    check('the proposer (no financing.approve) cannot approve -> 403', selfOps.status === 403, selfOps.body);
    const expBefore = await prisma.cashExpectation.count({ where: { source: `MC:${call1.ref}` } });
    await comp.stepUp();
    const approve1 = await comp.post(`${F}/calls/${call1.id}/disposition/approve`, { note: 'Confirmed with the lender' }, { 'Idempotency-Key': key('a1') });
    check('an independent approver approves -> FUNDED', approve1.status === 200 && approve1.body.data.status === 'FUNDED' && approve1.body.data.resolvedByName, approve1.body);
    const fundedRow = await prisma.finMarginCall.findUnique({ where: { id: call1.id } });
    const jr = fundedRow?.journalId ? await prisma.cashJournal.findUnique({ where: { id: fundedRow.journalId }, include: { lines: true } }) : null;
    check('a cash journal is linked: PENDING_APPROVAL, TRANSFER, credits the bank ledger, debits clearing, carries the expectation', approve1.body.journal.created === true && jr?.status === 'PENDING_APPROVAL' && jr.purpose === 'TRANSFER' && jr.expectationId === exp1!.id && jr.lines.some((l) => l.ledgerId === bank.id && l.credit.toFixed(2) === '25000.00') && jr.lines.some((l) => l.ledgerId === clearing.id && l.debit.toFixed(2) === '25000.00'), { j: approve1.body.journal, jr });
    check('no second expectation was created on approval and the audit records both people', expBefore === 1 && (await prisma.cashExpectation.count({ where: { source: `MC:${call1.ref}` } })) === 1 && (await auditCount('fin.margin_disposition_approved', call1.id)) === 1);
    await fa.stepUp();
    const post = await fa.post(`${C}/journals/${jr!.id}/post`, {}, { 'Idempotency-Key': key('post1') });
    check('posting the linked journal -> POSTED', post.status === 200 && post.body.data.status === 'POSTED', post.body);
    const exp1b = await prisma.cashExpectation.findUnique({ where: { id: exp1!.id } });
    check('posting settled the expectation (POSTED, linked to the journal)', exp1b?.status === 'POSTED' && exp1b.journalId === jr!.id, exp1b);
    await comp.stepUp();
    const approveAgain = await comp.post(`${F}/calls/${call1.id}/disposition/approve`, {});
    check('a funded call has nothing left to approve -> 409', approveAgain.status === 409, approveAgain.body);

    const prop2 = await comp.post(`${F}/calls/${call2.id}/disposition`, { kind: 'FUNDED', reason: 'Funding by the compliance officer', fundingLedgerId: bank.id });
    check('a person holding both permissions can propose', prop2.status === 200, prop2.body);
    await comp.stepUp();
    const selfApp = await comp.post(`${F}/calls/${call2.id}/disposition/approve`, {});
    check('and cannot approve their own proposal -> 403 sod_violation', selfApp.status === 403 && errCode(selfApp) === 'sod_violation', selfApp.body);
    const exp2Id = prop2.body.data.disposition.expectationId as string;
    await comp2.stepUp();
    const ret = await comp2.post(`${F}/calls/${call2.id}/disposition/return`, { reason: 'Wrong amount, redo it' });
    check('another approver returns it -> back to ACKNOWLEDGED with the proposal cleared', ret.status === 200 && ret.body.data.status === 'ACKNOWLEDGED' && ret.body.data.disposition === null, ret.body);
    check('returning cancelled the funding expectation', (await prisma.cashExpectation.findUnique({ where: { id: exp2Id } }))?.status === 'CANCELLED' && (await auditCount('fin.margin_disposition_returned', call2.id)) === 1);

    const dispMissing = await ops.post(`${F}/calls/${call3.id}/disposition`, { kind: 'DISPUTE_RESOLVED', reason: 'Lender used a stale price', outcome: 'CALL_WITHDRAWN' });
    const dm = JSON.stringify(dispMissing.body);
    check('a dispute resolution without counterparty evidence and house calculation -> 400 naming both', dispMissing.status === 400 && /counterpartyEvidenceRef/.test(dm) && /houseCalcAmount/.test(dm) && /houseCalcNote/.test(dm), dispMissing.body);
    await ops.stepUp();
    const disp3 = await ops.post(`${F}/calls/${call3.id}/disposition`, { kind: 'DISPUTE_RESOLVED', reason: 'Lender used a stale price', outcome: 'CALL_WITHDRAWN', counterpartyEvidenceRef: 'Lender statement 2026-10-01', houseCalcAmount: '0', houseCalcNote: 'Recomputed at the closing price: no deficit' });
    check('dispute resolution recorded with evidence and house calculation -> PENDING_CHECK', disp3.status === 200 && disp3.body.data.status === 'PENDING_CHECK' && disp3.body.data.disposition.counterpartyEvidenceRef === 'Lender statement 2026-10-01' && disp3.body.data.disposition.houseCalcAmount === '0.00' && disp3.body.data.disposition.priorStatus === 'DISPUTED', disp3.body);
    await comp.stepUp();
    const ap3 = await comp.post(`${F}/calls/${call3.id}/disposition/approve`, {});
    check('approving a withdrawn call -> CANCELLED', ap3.status === 200 && ap3.body.data.status === 'CANCELLED' && ap3.body.journal.created === false, ap3.body);
    await ops.stepUp();
    const disp4 = await ops.post(`${F}/calls/${call4.id}/disposition`, { kind: 'DISPUTE_RESOLVED', reason: 'House number confirms the lender', outcome: 'CALL_STANDS', counterpartyEvidenceRef: 'Lender email 2026-10-02', houseCalcAmount: '25000', houseCalcNote: 'Recomputed: 25,000 is due' });
    await comp.stepUp();
    const ap4 = await comp.post(`${F}/calls/${call4.id}/disposition/approve`, {});
    check('approving a call that stands -> back to ACKNOWLEDGED (the call remains open to fund)', disp4.status === 200 && ap4.status === 200 && ap4.body.data.status === 'ACKNOWLEDGED', [disp4.body, ap4.body]);
    check('audit trail holds before/after for the dispute approval', (await auditCount('fin.margin_disposition_approved', call4.id)) === 1);
    const view = await comp.get(`${F}/calls/${call1.id}`);
    check('the call detail exposes the disposition with its journal and expectation links', view.body.data.disposition?.journalId === fundedRow?.journalId && view.body.data.disposition?.expectationId === exp1!.id && view.body.data.portfolioId === cpf.id, view.body.data);
    // cleanup of fixtures that reference other rows
    await prisma.finMarginCall.deleteMany({ where: { facilityId: fac.id } });
    await prisma.finFacility.delete({ where: { id: fac.id } }).catch(() => undefined);
  } finally {
    // Best-effort removal of what this run created (the database is disposable anyway).
    try {
      await prisma.reconBreakEvent.deleteMany({ where: { brk: { portfolioId: { in: createdPortfolios } } } });
      await prisma.reconBreak.deleteMany({ where: { portfolioId: { in: createdPortfolios } } });
      await prisma.reconRun.deleteMany({ where: { OR: [{ counterpartyId: { in: createdCps } }, { portfolioId: { in: createdPortfolios } }] } });
      await prisma.reconCounterpartImport.deleteMany({ where: { counterpartyId: { in: createdCps } } });
      await prisma.reconSourceReceipt.deleteMany({ where: { counterpartyId: { in: createdCps } } });
      await prisma.reconCustodyPosition.deleteMany({ where: { counterpartyId: { in: createdCps } } });
      await prisma.custodianFeedHolding.deleteMany({ where: { counterpartyId: { in: createdCps } } });
      await prisma.counterpartyExecution.deleteMany({ where: { counterpartyId: { in: createdCps } } });
      await prisma.counterpartyDayEndPackage.deleteMany({ where: { counterpartyId: { in: createdCps } } });
      await prisma.reconAccountMap.deleteMany({ where: { counterpartyId: { in: createdCps } } });
      await prisma.counterparty.deleteMany({ where: { id: { in: createdCps } } });
    } catch (e) {
      console.log('  (cleanup skipped:', (e as Error).message.slice(0, 120), ')');
    }
  }
  void createdSecurities;
  void createdClients;
  void userIds;
  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
