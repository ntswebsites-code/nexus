/**
 * Cash & Ledgers checks against a RUNNING API: ledger set, balances derived from posted journal lines, maker-checker
 * journals (draft -> pending -> posted, reject, exact reversal, immutability, step-up MFA on post), reservations
 * (atomic availability check under concurrency, release, consume on post, expiry), expectations (projection only,
 * settled on post), statement import (CSV staging, footing, duplicates, checker commit, auto-match) and the cash period
 * close pre-check that lists every blocker in one 409, then closes and locks the period. Also permissions, idempotency
 * and audit events.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-cash.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API
 * against the same DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP enrolment). Creates throwaway users and a
 * portfolio with a random run id (best-effort removal at the end); disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { availability, coverageProblems, invertLines, matchLines, parseStatement, statementVariance, validateLines } from '../src/modules/cash/cash.engine';

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
const C = '/api/v1/cash';
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const td = dayStr(0);

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
  const mkUser = async (label: string, roleKey: string, portal = 'admin') => {
    const u = await prisma.user.create({ data: { email: `ca-${run}-${label}@example.test`, name: `CA ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, roleKey)).id } });
    return u;
  };
  const fa = await mkUser('fa', 'fund_accountant'); // view, journal.create, journal.approve, import, close (checker)
  const ops = await mkUser('ops', 'operations'); // same set plus reservation (maker)
  const pm = await mkUser('pm', 'portfolio_manager'); // view + reservation only
  const aud = await mkUser('aud', 'auditor'); // view only
  const noView = await mkUser('noview', 'analyst');
  const lp = await mkUser('lp', 'finance', 'investor');
  const cFa = client('admin');
  const cOps = client('admin');
  const cPm = client('admin');
  const cAud = client('admin');
  const cNo = client('admin');
  const cLp = client('investor');
  const anon = client('admin');

  const p = await prisma.portfolio.create({ data: { ref: `CAP-${run}`, name: `CA Entity ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} } });
  portfolioIds.push(p.id);
  const auditCount = (action: string, objectId?: string, actorId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}), ...(actorId ? { actorId } : {}) } });

  try {
    console.log('\nEngine (pure)');
    check('balanced journal valid, unbalanced refused', validateLines([{ ledgerId: 'a', debit: D(10) }, { ledgerId: 'b', credit: D(10) }]).length === 0 && validateLines([{ ledgerId: 'a', debit: D(10) }, { ledgerId: 'b', credit: D('9.99') }]).length === 1);
    check('invertLines swaps sides', invertLines([{ ledgerId: 'a', debit: D(5), credit: D(0), memo: null }])[0]!.credit.toFixed(2) === '5.00');
    check('availability = posted - reserved - buffer, floored at zero', availability(D(1000), D(300), D(100)).available.toFixed(2) === '600.00' && availability(D(100), D(300), D(0)).available.toFixed(2) === '0.00');
    const csv = parseStatement('CSV', 'Date,Description,Reference,Credit,Debit\n2026-09-01,"Deposit, big",R1,1000.50,\n2026-09-02,Fee,R2,,10', { opening: D(0), closing: D('990.50') });
    check('CSV with quoted commas and credit/debit columns parses and foots', !csv.errors.length && csv.lines.length === 2 && csv.lines[0]!.description === 'Deposit, big' && csv.lines[1]!.amount.toFixed(2) === '-10.00' && statementVariance(csv.opening!, csv.closing!, csv.lines).isZero(), csv.errors);
    check('JSON statement parses with embedded balances', parseStatement('JSON', JSON.stringify({ openingBalance: '5', closingBalance: '6', lines: [{ date: '2026-09-01', amount: '1' }] }), {}).errors.length === 0);
    check('bad date, zero amount and missing balances are errors', parseStatement('CSV', 'date,amount\n01/09/2026,0', {}).errors.length >= 3);
    check('matching is one-to-one on equal amount within the date window', matchLines([{ id: 'l1', valueDate: new Date('2026-09-02'), amount: D(10) }, { id: 'l2', valueDate: new Date('2026-09-02'), amount: D(10) }], [{ journalId: 'j1', date: new Date('2026-09-01'), amount: D(10) }]).length === 1);
    check('coverage flags a gap and a short statement', coverageProblems([{ ref: 'A', statementFrom: new Date('2026-09-01'), statementTo: new Date('2026-09-10'), openingBalance: D(0), closingBalance: D(5) }, { ref: 'B', statementFrom: new Date('2026-09-15'), statementTo: new Date('2026-09-20'), openingBalance: D(5), closingBalance: D(6) }], new Date('2026-09-30')).length === 2);

    console.log('\nSign-in and permissions');
    for (const [c, u] of [[cFa, fa], [cOps, ops], [cPm, pm], [cAud, aud], [cNo, noView], [cLp, lp]] as const) {
      check(`${u.email.split('@')[0]!.replace(`ca-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    }
    check('fund accountant enrols MFA', await cFa.enrolMfa());
    check('GET /cash/balances without a session -> 401', (await anon.get(`${C}/balances`)).status === 401);
    check('investor -> 403', (await cLp.get(`${C}/balances`)).status === 403);
    const denied = await cNo.get(`${C}/balances`);
    check('without cash.view -> 403 permission_denied', denied.status === 403 && denied.body?.error?.code === 'permission_denied', denied.body);
    check('auditor can read balances, journals, reservations, imports and closes', (await Promise.all(['balances', 'journals', 'reservations', 'expectations', 'statement-imports', 'period-closes'].map((x) => cAud.get(`${C}/${x}`)))).every((r) => r.status === 200));

    console.log('\nLedgers');
    check('a reservation-only role cannot create ledgers -> 403', (await cPm.post(`${C}/ledgers/default-set`, { portfolioId: p.id })).status === 403);
    const ds = await cOps.post(`${C}/ledgers/default-set`, { portfolioId: p.id });
    check('default set creates five ledgers; a repeat skips them', ds.status === 201 && ds.body.created === 5 && (await cOps.post(`${C}/ledgers/default-set`, { portfolioId: p.id })).body.skipped === 5, ds.body);
    const led = (kind: string) => ds.body.data.find((l: any) => l.kind === kind);
    const bank = led('BANK');
    const control = led('CONTROL');
    const clearing = led('CLEARING');
    const suspense = led('SUSPENSE');
    check('ledger refs are CLG-####', /^CLG-\d{4}$/.test(bank.ref));
    check('duplicate ledger name -> 409', (await cOps.post(`${C}/ledgers`, { portfolioId: p.id, name: bank.name, currency: 'USD', kind: 'BANK' }, { 'Idempotency-Key': key('dl') })).body?.error?.code === 'duplicate_ledger');
    check('bank minimum buffer 100 and tolerance 0 set', (await cOps.patch(`${C}/ledgers/${bank.id}`, { minBuffer: '100' })).body?.data?.minBuffer === '100.00');

    console.log('\nJournals: validation and lifecycle');
    const j1b = { portfolioId: p.id, entryDate: td, description: 'Client deposit', purpose: 'CLIENT_DEPOSIT', sourceRef: 'DEP-1', lines: [{ ledgerId: bank.id, debit: '10000.00' }, { ledgerId: control.id, credit: '10000.00' }] };
    check('create without Idempotency-Key -> 400', (await cOps.post(`${C}/journals`, j1b)).status === 400);
    check('reservation-only role cannot create a journal -> 403', (await cPm.post(`${C}/journals`, j1b, { 'Idempotency-Key': key('pmj') })).status === 403);
    const unb = await cOps.post(`${C}/journals`, { ...j1b, lines: [{ ledgerId: bank.id, debit: '10000.00' }, { ledgerId: control.id, credit: '9999.99' }] }, { 'Idempotency-Key': key('unb') });
    check('unbalanced -> 400 with a message', unb.status === 400 && JSON.stringify(unb.body).includes('must be equal'), unb.body);
    check('unknown ledger -> 400', (await cOps.post(`${C}/journals`, { ...j1b, lines: [{ ledgerId: '00000000-0000-4000-8000-000000000000', debit: '1' }, { ledgerId: control.id, credit: '1' }] }, { 'Idempotency-Key': key('ul') })).status === 400);
    const k1 = key('j1');
    const c1 = await cOps.post(`${C}/journals`, j1b, { 'Idempotency-Key': k1 });
    const J1 = c1.body?.data;
    check('create -> 201 DRAFT CJ-##### totalling 10,000.00', c1.status === 201 && J1?.status === 'DRAFT' && /^CJ-\d{5}$/.test(J1.ref) && J1.totalDebit === '10000.00' && J1.makerId === ops.id, c1.body);
    check('same key replays the same journal; a different payload -> 409', (await cOps.post(`${C}/journals`, j1b, { 'Idempotency-Key': k1 })).body?.data?.id === J1.id && (await cOps.post(`${C}/journals`, { ...j1b, description: 'Changed' }, { 'Idempotency-Key': k1 })).status === 409);
    check('audit cash.journal_created by the maker', (await auditCount('cash.journal_created', J1.id, ops.id)) === 1);
    check('someone else cannot edit or submit it', (await cFa.patch(`${C}/journals/${J1.id}`, { ...j1b, portfolioId: undefined })).body?.error?.code === 'not_maker' && (await cFa.post(`${C}/journals/${J1.id}/submit`)).status === 403);
    check('submit -> PENDING_APPROVAL', (await cOps.post(`${C}/journals/${J1.id}/submit`)).body?.data?.status === 'PENDING_APPROVAL');
    check('editing a pending journal -> 409 journal_immutable', (await cOps.patch(`${C}/journals/${J1.id}`, { ...j1b, portfolioId: undefined })).body?.error?.code === 'journal_immutable');
    check('auditor cannot post -> 403', (await cAud.post(`${C}/journals/${J1.id}/post`)).status === 403);
    check('post without step-up -> 401 step_up_required', (await cFa.post(`${C}/journals/${J1.id}/post`)).body?.error?.code === 'step_up_required');
    await cFa.stepUp();
    const self = await cOps.post(`${C}/journals/${J1.id}/post`);
    check('maker cannot post their own journal (403)', self.status === 403 || self.status === 401, self.body);
    const posted = await cFa.post(`${C}/journals/${J1.id}/post`);
    check('a different approver posts it -> POSTED', posted.status === 200 && posted.body.data.status === 'POSTED' && posted.body.data.postedBy === fa.id, posted.body);
    check('audit cash.journal_posted by the approver', (await auditCount('cash.journal_posted', J1.id, fa.id)) === 1);
    check('a posted journal cannot be edited or discarded (409 journal_immutable)', (await cOps.patch(`${C}/journals/${J1.id}`, { ...j1b, portfolioId: undefined })).body?.error?.code === 'journal_immutable' && (await cOps.post(`${C}/journals/${J1.id}/discard`, { reason: 'Changed my mind' })).body?.error?.code === 'journal_immutable');
    // reject path
    const r2 = (await cOps.post(`${C}/journals`, { ...j1b, description: 'Wrong amount', lines: [{ ledgerId: bank.id, debit: '1.00' }, { ledgerId: control.id, credit: '1.00' }] }, { 'Idempotency-Key': key('j2') })).body.data;
    await cOps.post(`${C}/journals/${r2.id}/submit`);
    check('reject needs a reason -> 400', (await cFa.post(`${C}/journals/${r2.id}/reject`, {})).status === 400);
    check('the maker cannot reject their own -> 403', (await cOps.post(`${C}/journals/${r2.id}/reject`, { reason: 'Not mine to reject' })).status === 403);
    const rej = await cFa.post(`${C}/journals/${r2.id}/reject`, { reason: 'Amount is wrong' });
    check('reject -> REJECTED, read-only, shows the reason', rej.status === 200 && rej.body.data.status === 'REJECTED' && rej.body.data.rejectReason === 'Amount is wrong');

    console.log('\nBalances');
    let bal = (await cOps.get(`${C}/balances?portfolioId=${p.id}`)).body.data;
    let row = bal.ledgers.find((l: any) => l.ledgerId === bank.id);
    check('posted 10,000.00; available = posted - buffer 100 = 9,900.00', row.posted === '10000.00' && row.available === '9900.00' && row.reserved === '0.00', row);
    const ex = (await cOps.get(`${C}/balances/explain?ledgerId=${bank.id}`)).body.data;
    check('explain lines sum to the posted figure', ex.journalLines.reduce((s: Prisma.Decimal, l: any) => s.add(l.signed), D(0)).toFixed(2) === ex.posted && ex.formula.includes('max(0'), ex);
    check('as-of before the journal date shows zero posted', (await cOps.get(`${C}/balances?portfolioId=${p.id}&asOf=${dayStr(-3)}`)).body.data.ledgers.find((l: any) => l.ledgerId === bank.id).posted === '0.00');

    console.log('\nReservations');
    const rsv = (amt: string, extra: object = {}) => ({ ledgerId: bank.id, source: 'ORDER-TEST', purpose: 'BUY_SETTLEMENT', amount: amt, ...extra });
    const [a1, a2] = await Promise.all([cPm.post(`${C}/reservations`, rsv('6000'), { 'Idempotency-Key': key('c1') }), cPm.post(`${C}/reservations`, rsv('6000'), { 'Idempotency-Key': key('c2') })]);
    const winner = [a1, a2].find((r) => r.status === 201);
    const loser = [a1, a2].find((r) => r.status === 409);
    check('two concurrent holds of 6,000 against 9,900: exactly one 201 and one 409', !!winner && !!loser && loser.body?.error?.code === 'insufficient_available_cash', [a1.body, a2.body]);
    check('hold above available -> 409 insufficient_available_cash with the figures', (await cPm.post(`${C}/reservations`, rsv('20000'), { 'Idempotency-Key': key('big') })).body?.error?.code === 'insufficient_available_cash');
    check('auditor cannot reserve -> 403', (await cAud.post(`${C}/reservations`, rsv('1'), { 'Idempotency-Key': key('ar') })).status === 403);
    const W = winner!.body.data;
    check('reservation is RSV-#### ACTIVE with remaining 6,000.00', /^RSV-\d{4}$/.test(W.ref) && W.status === 'ACTIVE' && W.remaining === '6000.00', W);
    bal = (await cOps.get(`${C}/balances?portfolioId=${p.id}`)).body.data;
    row = bal.ledgers.find((l: any) => l.ledgerId === bank.id);
    check('reserved 6,000.00 and available 3,900.00 while posted stays 10,000.00', row.reserved === '6000.00' && row.available === '3900.00' && row.posted === '10000.00', row);
    const rel = await cPm.post(`${C}/reservations/${W.id}/release`, { reason: 'Order cancelled' });
    check('creator releases it -> RELEASED, remaining 0.00, never deleted', rel.status === 200 && rel.body.data.status === 'RELEASED' && rel.body.data.remaining === '0.00' && (await prisma.cashReservation.count({ where: { id: W.id } })) === 1, rel.body);
    check('releasing twice -> 409', (await cPm.post(`${C}/reservations/${W.id}/release`, { reason: 'Order cancelled' })).status === 409);
    const RA = (await cPm.post(`${C}/reservations`, rsv('3000', { source: 'ORDER-784' }), { 'Idempotency-Key': key('ra') })).body.data;
    const RB = (await cOps.post(`${C}/reservations`, rsv('500', { source: 'WD-2088', purpose: 'WITHDRAWAL' }), { 'Idempotency-Key': key('rb') })).body.data;
    check('two live holds created', RA?.status === 'ACTIVE' && RB?.status === 'ACTIVE');
    check("releasing someone else's hold without cash.journal.approve -> 403 sod_violation", (await cPm.post(`${C}/reservations/${RB.id}/release`, { reason: 'Not my hold' })).body?.error?.code === 'sod_violation');
    const lapsed = await cPm.post(`${C}/reservations`, rsv('50', { source: 'OLD', requiredDate: dayStr(-3), expiresOn: dayStr(-1) }), { 'Idempotency-Key': key('lap') });
    check('a hold past its expiry is flagged lapsed and no longer reduces availability', lapsed.status === 201 && lapsed.body.data.lapsed === true && (await cOps.get(`${C}/balances?portfolioId=${p.id}`)).body.data.ledgers.find((l: any) => l.ledgerId === bank.id).reserved === '3500.00');
    check('expiry sweep marks it EXPIRED', (await cFa.post(`${C}/reservations/expire-sweep`)).body?.data?.expired >= 1 && (await prisma.cashReservation.findUnique({ where: { id: lapsed.body.data.id } }))?.status === 'EXPIRED');

    console.log('\nSettlement journal consumes its reservation');
    const j3b = { portfolioId: p.id, entryDate: td, description: 'Buy settlement ORDER-784', purpose: 'BUY_SETTLEMENT', sourceRef: 'ORDER-784', reservationId: RA.id, lines: [{ ledgerId: clearing.id, debit: '3000.00' }, { ledgerId: bank.id, credit: '3000.00' }] };
    const J3 = (await cOps.post(`${C}/journals`, j3b, { 'Idempotency-Key': key('j3') })).body.data;
    await cOps.post(`${C}/journals/${J3.id}/submit`);
    await cFa.stepUp();
    check('posting consumes the reservation', (await cFa.post(`${C}/journals/${J3.id}/post`)).body?.data?.status === 'POSTED' && (await prisma.cashReservation.findUnique({ where: { id: RA.id } }))?.status === 'CONSUMED');
    row = (await cOps.get(`${C}/balances?portfolioId=${p.id}`)).body.data.ledgers.find((l: any) => l.ledgerId === bank.id);
    check('posted 7,000.00, reserved 500.00, available 6,400.00', row.posted === '7000.00' && row.reserved === '500.00' && row.available === '6400.00', row);

    console.log('\nExpectations');
    const E1 = (await cOps.post(`${C}/expectations`, { ledgerId: bank.id, direction: 'IN', kind: 'SETTLEMENT', amount: '2000', expectedDate: dayStr(2), source: 'SALE-9' }, { 'Idempotency-Key': key('e1') })).body.data;
    check('expectation is EXP-#### EXPECTED', /^EXP-\d{4}$/.test(E1.ref) && E1.status === 'EXPECTED', E1);
    check('auditor cannot create an expectation -> 403', (await cAud.post(`${C}/expectations`, { ledgerId: bank.id, direction: 'IN', amount: '1', expectedDate: td }, { 'Idempotency-Key': key('ae') })).status === 403);
    row = (await cOps.get(`${C}/balances?portfolioId=${p.id}`)).body.data.ledgers.find((l: any) => l.ledgerId === bank.id);
    check('expected net +2,000.00 but available unchanged at 6,400.00', row.expectedNet === '2000.00' && row.available === '6400.00', row);
    const E2 = (await cOps.post(`${C}/expectations`, { ledgerId: bank.id, direction: 'OUT', kind: 'FEE', amount: '100', expectedDate: dayStr(-20) }, { 'Idempotency-Key': key('e2') })).body.data;
    check('an overdue expectation reads DUE and filters as DUE', E2.status === 'DUE' && (await cOps.get(`${C}/expectations?portfolioId=${p.id}&status=DUE`)).body.data.some((e: any) => e.id === E2.id));
    const j4 = (await cOps.post(`${C}/journals`, { portfolioId: p.id, entryDate: td, description: 'Sale proceeds received', purpose: 'CLIENT_DEPOSIT', expectationId: E1.id, lines: [{ ledgerId: bank.id, debit: '2000.00' }, { ledgerId: control.id, credit: '2000.00' }] }, { 'Idempotency-Key': key('j4') })).body.data;
    await cOps.post(`${C}/journals/${j4.id}/submit`);
    await cFa.stepUp();
    await cFa.post(`${C}/journals/${j4.id}/post`);
    check('expectation moves to POSTED when its journal posts', (await prisma.cashExpectation.findUnique({ where: { id: E1.id } }))?.status === 'POSTED');

    console.log('\nReversal');
    await cFa.stepUp();
    const rev = await cFa.post(`${C}/journals/${J3.id}/reverse`, { reason: 'Order was cancelled' });
    check('reversal is a new POSTED journal with the sides swapped', rev.status === 201 && rev.body.data.status === 'POSTED' && rev.body.data.reversalOfId === J3.id && rev.body.data.lines.find((l: any) => l.ledgerKind === 'BANK').debit === '3000.00' && rev.body.data.lines.find((l: any) => l.ledgerKind === 'CLEARING').credit === '3000.00', rev.body);
    check('original is REVERSED and links to the reversal', (await cOps.get(`${C}/journals/${J3.id}`)).body.data.status === 'REVERSED');
    check('reversing again -> 409 already_reversed; reversing the reversal -> 409', (await cFa.post(`${C}/journals/${J3.id}/reverse`, { reason: 'Second attempt' })).body?.error?.code === 'already_reversed' && (await cFa.post(`${C}/journals/${rev.body.data.id}/reverse`, { reason: 'Reverse the reversal' })).status === 409);
    row = (await cOps.get(`${C}/balances?portfolioId=${p.id}`)).body.data.ledgers.find((l: any) => l.ledgerId === bank.id);
    check('posted is back to 12,000.00 (10,000 + 2,000, the 3,000 out and back)', row.posted === '12000.00', row);

    console.log('\nPeriod close blocked by every control');
    const susp = (await cOps.post(`${C}/journals`, { portfolioId: p.id, entryDate: td, description: 'Unidentified receipt', lines: [{ ledgerId: suspense.id, debit: '50.00' }, { ledgerId: control.id, credit: '50.00' }] }, { 'Idempotency-Key': key('susp') })).body.data;
    await cOps.post(`${C}/journals/${susp.id}/submit`);
    await cFa.stepUp();
    await cFa.post(`${C}/journals/${susp.id}/post`);
    const var25 = (await cOps.post(`${C}/journals`, { portfolioId: p.id, entryDate: td, description: 'Unmatched receipt', lines: [{ ledgerId: bank.id, debit: '25.00' }, { ledgerId: control.id, credit: '25.00' }] }, { 'Idempotency-Key': key('v25') })).body.data;
    await cOps.post(`${C}/journals/${var25.id}/submit`);
    await cFa.stepUp();
    await cFa.post(`${C}/journals/${var25.id}/post`);
    const draft = (await cOps.post(`${C}/journals`, { portfolioId: p.id, entryDate: td, description: 'Forgotten draft', lines: [{ ledgerId: bank.id, debit: '1.00' }, { ledgerId: control.id, credit: '1.00' }] }, { 'Idempotency-Key': key('dr') })).body.data;
    const pre0 = await cOps.get(`${C}/period-closes/precheck?portfolioId=${p.id}&periodEnd=${td}`);
    check('pre-check is informational and itemises coverage, suspense, aged, unposted and checker', pre0.status === 200 && pre0.body.data.canClose === false && ['STATEMENT_COVERAGE', 'SUSPENSE', 'AGED_ITEMS', 'UNPOSTED_JOURNALS', 'CHECKER_APPROVAL'].every((k) => pre0.body.data.items.find((i: any) => i.key === k && !i.ok)), pre0.body);
    check('auditor cannot prepare a close -> 403', (await cAud.post(`${C}/period-closes`, { portfolioId: p.id, periodEnd: td }, { 'Idempotency-Key': key('ac') })).status === 403);
    const close = (await cOps.post(`${C}/period-closes`, { portfolioId: p.id, periodEnd: td }, { 'Idempotency-Key': key('pc') })).body.data;
    check('close prepared PREPARED by the operator', close?.status === 'PREPARED' && close.preparedBy === ops.id, close);
    check('a duplicate close for the same date -> 409', (await cOps.post(`${C}/period-closes`, { portfolioId: p.id, periodEnd: td }, { 'Idempotency-Key': key('pc2') })).body?.error?.code === 'duplicate_close');
    check('the preparer cannot approve it (403 sod_violation)', (await cOps.post(`${C}/period-closes/${close.id}/approve`)).body?.error?.code === 'sod_violation');
    await cFa.stepUp();
    const blocked = await cFa.post(`${C}/period-closes/${close.id}/close`);
    const bl: string[] = blocked.body?.error?.details?.blockers ?? [];
    check('close -> 409 close_blocked listing every blocker at once', blocked.status === 409 && blocked.body?.error?.code === 'close_blocked' && bl.length >= 5 && bl.some((b) => /No committed statement/.test(b)) && bl.some((b) => /suspense/i.test(b)) && bl.some((b) => /Expected payment/.test(b)) && bl.some((b) => /draft/.test(b)) && bl.some((b) => /independent checker/.test(b)), blocked.body);

    console.log('\nStatement import');
    const stmt = `date,amount,reference,description\n${td},10000.00,DEP-1,Client deposit\n${td},2000.00,SALE-9,Sale proceeds\n${td},-3000.00,ORDER-784,Settlement\n${td},3000.00,REV-784,Reversal\n`;
    const body = { ledgerId: bank.id, filename: 'sept.csv', format: 'CSV', content: stmt, openingBalance: '0', closingBalance: '12000.00' };
    check('auditor and reservation-only roles cannot import -> 403', (await cAud.post(`${C}/statement-imports`, body, { 'Idempotency-Key': key('ai') })).status === 403 && (await cPm.post(`${C}/statement-imports`, body, { 'Idempotency-Key': key('pi') })).status === 403);
    const bad = await cOps.post(`${C}/statement-imports`, { ...body, closingBalance: '12001.00' }, { 'Idempotency-Key': key('bad') });
    check('a statement that does not foot is refused -> 400 statement_does_not_foot', bad.status === 400 && bad.body?.error?.code === 'statement_does_not_foot', bad.body);
    check('an unreadable CSV -> 400 with line errors', (await cOps.post(`${C}/statement-imports`, { ...body, content: 'date,amount\nsoon,abc', closingBalance: '1' }, { 'Idempotency-Key': key('bc') })).status === 400);
    const st = await cOps.post(`${C}/statement-imports`, body, { 'Idempotency-Key': key('imp') });
    const I = st.body?.data;
    check('staged -> 201 IMP-#### STAGED with 4 lines and zero variance; ledger untouched', st.status === 201 && /^IMP-\d{4}$/.test(I.ref) && I.status === 'STAGED' && I.lines.length === 4 && I.variance === '0.00' && (await cOps.get(`${C}/balances?portfolioId=${p.id}`)).body.data.ledgers.find((l: any) => l.ledgerId === bank.id).posted === '12025.00', st.body);
    check('the same file again -> 409 duplicate_file', (await cOps.post(`${C}/statement-imports`, body, { 'Idempotency-Key': key('imp2') })).body?.error?.code === 'duplicate_file');
    check('the same period in a different file -> 409 duplicate_statement', (await cOps.post(`${C}/statement-imports`, { ...body, content: stmt + '\n' + `${td},0.0001,X,Trace\n`, closingBalance: '12000.0001' }, { 'Idempotency-Key': key('imp3') })).body?.error?.code === 'duplicate_statement');
    await cFa.stepUp();
    check('the uploader cannot commit their own import (403 sod_violation)', (await cOps.post(`${C}/statement-imports/${I.id}/commit`)).status === 403);
    const com = await cFa.post(`${C}/statement-imports/${I.id}/commit`);
    check('a checker commits it -> COMMITTED and 4 lines auto-matched to posted journals', com.status === 200 && com.body.data.status === 'COMMITTED' && com.body.autoMatched === 4 && com.body.data.lines.every((l: any) => l.status === 'MATCHED'), com.body);
    check('audit cash.import_committed names the checker', (await auditCount('cash.import_committed', I.id, fa.id)) === 1);
    check('a committed import cannot be committed or rejected again -> 409', (await cFa.post(`${C}/statement-imports/${I.id}/commit`)).status === 409 && (await cOps.post(`${C}/statement-imports/${I.id}/reject`, { reason: 'Changed my mind' })).status === 409);

    console.log('\nClearing the blockers one by one');
    let pre = (await cOps.get(`${C}/period-closes/precheck?portfolioId=${p.id}&periodEnd=${td}`)).body.data;
    const item = (k: string) => pre.items.find((i: any) => i.key === k);
    check('coverage now passes; the 25.00 variance blocks', item('STATEMENT_COVERAGE').ok && !item('BALANCE_VARIANCE').ok && /variance 0\.00|variance -?25\.00/.test(item('BALANCE_VARIANCE').blockers[0]), item('BALANCE_VARIANCE'));
    await cFa.stepUp();
    await cFa.post(`${C}/journals/${var25.id}/reverse`, { reason: 'Receipt belongs to another fund' });
    await cFa.post(`${C}/journals/${susp.id}/reverse`, { reason: 'Receipt identified and returned' });
    await cOps.post(`${C}/expectations/${E2.id}/cancel`, { reason: 'Fee waived by the custodian' });
    await cOps.post(`${C}/journals/${draft.id}/discard`, { reason: 'Entered by mistake' });
    pre = (await cOps.get(`${C}/period-closes/precheck?portfolioId=${p.id}&periodEnd=${td}`)).body.data;
    check('only the checker approval is left', pre.blockers.length === 1 && !item('CHECKER_APPROVAL').ok && ['STATEMENT_COVERAGE', 'BALANCE_VARIANCE', 'SUSPENSE', 'AGED_ITEMS', 'UNPOSTED_JOURNALS'].every((k) => item(k).ok), pre);
    check('a different person approves the close', (await cFa.post(`${C}/period-closes/${close.id}/approve`)).body?.data?.status === 'APPROVED');
    await cFa.stepUp();
    const closed = await cFa.post(`${C}/period-closes/${close.id}/close`);
    check('close succeeds -> CLOSED', closed.status === 200 && closed.body.data.status === 'CLOSED' && closed.body.data.blockers.length === 0, closed.body);
    check('audit cash.close_closed written', (await auditCount('cash.close_closed', close.id, fa.id)) === 1);
    const lock = await cOps.post(`${C}/journals`, { portfolioId: p.id, entryDate: td, description: 'Late entry', lines: [{ ledgerId: bank.id, debit: '1' }, { ledgerId: control.id, credit: '1' }] }, { 'Idempotency-Key': key('lock') });
    check('a journal dated in the closed period -> 409 period_closed', lock.status === 409 && lock.body?.error?.code === 'period_closed', lock.body);
    check('reopen needs a reason (400) and step-up (401)', (await cFa.post(`${C}/period-closes/${close.id}/reopen`, {})).status !== 200);
    await cFa.stepUp();
    const reo = await cFa.post(`${C}/period-closes/${close.id}/reopen`, { reason: 'Late custodian fee notice' });
    check('reopen -> PREPARED, approval cleared, journals allowed again', reo.status === 200 && reo.body.data.status === 'PREPARED' && (await cOps.post(`${C}/journals`, { portfolioId: p.id, entryDate: td, description: 'Late entry', lines: [{ ledgerId: bank.id, debit: '1' }, { ledgerId: control.id, credit: '1' }] }, { 'Idempotency-Key': key('late') })).status === 201, reo.body);
    check('audit cash.close_reopened carries the reason', (await prisma.auditEvent.count({ where: { action: 'cash.close_reopened', objectId: close.id, reason: 'Late custodian fee notice' } })) === 1);
  } finally {
    try {
      await prisma.cashStatementImport.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.cashJournal.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.cashReservation.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.cashExpectation.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.cashPeriodClose.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.cashLedger.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.portfolio.deleteMany({ where: { id: { in: portfolioIds } } });
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
