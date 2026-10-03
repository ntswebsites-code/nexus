/**
 * Accounting & Close checks against a RUNNING API: chart of accounts, balanced double-entry journals (draft ->
 * pending -> posted -> reversed), maker-checker and step-up MFA on posting, immutability, exact reversal, trial
 * balance and ledger maths, period close blocked by every checklist blocker (unposted journals, open recon break,
 * no released NAV, listed together in one 409), closed periods locking posting, reopen needing its own permission and
 * a reason, idempotency, audit events and permission refusals.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-accounting.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API
 * against the same DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP enrolment). Creates throwaway users and a
 * portfolio with a random run id (best-effort removal at the end); disposable DBs only.
 *
 * Fixture (period 2026-09, one entity): J1 cash 5,000.00 DR / capital CR (later reversed); J2 fee 120.50 DR / accrued fee CR.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { invertLines, monthBounds, naturalBalance, validateLines } from '../src/modules/accounting/accounting.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ac-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `ac-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const A = '/api/v1/accounting';

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
    const u = await prisma.user.create({ data: { email: `ac-${run}-${label}@example.test`, name: `AC ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(portal, roleKey)).id } });
    return u;
  };
  const fa = await mkUser('fa', 'fund_accountant'); // valuation.view, accounting.post, accounting.close
  const dir = await mkUser('dir', 'investment_director'); // + accounting.reopen
  const pm = await mkUser('pm', 'portfolio_manager'); // valuation.view only: prepares journals
  const aud = await mkUser('aud', 'auditor'); // read only
  const noView = await mkUser('noview', 'analyst');
  const lp = await mkUser('lp', 'finance', 'investor');
  const cFa = client('admin');
  const cDir = client('admin');
  const cPm = client('admin');
  const cAud = client('admin');
  const cNo = client('admin');
  const cLp = client('investor');
  const anon = client('admin');

  const p = await prisma.portfolio.create({ data: { ref: `ACP-${run}`, name: `AC Entity ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} } });
  portfolioIds.push(p.id);
  const auditCount = (action: string, objectId?: string, actorId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}), ...(actorId ? { actorId } : {}) } });

  try {
    console.log('\nEngine (pure)');
    check('balanced two-line journal is valid', validateLines([{ accountId: 'a', debit: D(10) }, { accountId: 'b', credit: D(10) }]).length === 0);
    check('unbalanced journal is refused (10 vs 9.99)', validateLines([{ accountId: 'a', debit: D(10) }, { accountId: 'b', credit: D('9.99') }]).length === 1);
    check(
      'a line with both sides, or neither, is refused',
      validateLines([{ accountId: 'a', debit: D(1), credit: D(1) }, { accountId: 'b', credit: D(1) }]).length > 0 && validateLines([{ accountId: 'a' }, { accountId: 'b', credit: D(1) }]).length > 0,
    );
    check('one line is refused', validateLines([{ accountId: 'a', debit: D(1) }]).length > 0);
    check('Decimal maths: debits 0.1 + 0.2 equal credit 0.3', validateLines([{ accountId: 'a', debit: D('0.1') }, { accountId: 'b', debit: D('0.2') }, { accountId: 'c', credit: D('0.3') }]).length === 0);
    check('natural balance: asset debit-normal, income credit-normal', naturalBalance('ASSET', D(10), D(4)).toFixed(2) === '6.00' && naturalBalance('INCOME', D(4), D(10)).toFixed(2) === '6.00');
    const inv = invertLines([{ accountId: 'a', debit: D(5), credit: D(0), memo: 'm' }]);
    check('invertLines swaps sides', inv[0]!.credit.toFixed(2) === '5.00' && inv[0]!.debit.toFixed(2) === '0.00');
    check('monthBounds 2026-02 ends on the 28th', monthBounds('2026-02').end.toISOString().slice(0, 10) === '2026-02-28');

    console.log('\nSign-in and permissions');
    for (const [c, u] of [[cFa, fa], [cDir, dir], [cPm, pm], [cAud, aud], [cNo, noView], [cLp, lp]] as const) {
      check(`${u.email.split('@')[0]!.replace(`ac-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    }
    check('fund accountant enrols MFA', await cFa.enrolMfa());
    check('director enrols MFA', await cDir.enrolMfa());
    check('GET /accounting/journals without a session -> 401', (await anon.get(`${A}/journals`)).status === 401);
    check('investor -> 403', (await cLp.get(`${A}/journals`)).status === 403);
    const denied = await cNo.get(`${A}/journals`);
    check('without valuation.view -> 403 permission_denied', denied.status === 403 && denied.body?.error?.code === 'permission_denied', denied.body);
    check('auditor can read journals and periods', (await cAud.get(`${A}/journals`)).status === 200 && (await cAud.get(`${A}/periods`)).status === 200);

    console.log('\nChart of accounts');
    const acct = (code: string, type = 'ASSET') => ({ portfolioId: p.id, code, name: `Account ${code}`, type });
    check('preparer without accounting.post cannot create an account -> 403', (await cPm.post(`${A}/accounts`, acct('1000'), { 'Idempotency-Key': key('x') })).status === 403);
    check('auditor cannot create an account -> 403', (await cAud.post(`${A}/accounts`, acct('1000'), { 'Idempotency-Key': key('x') })).status === 403);
    const mk = async (code: string, name: string, type: string) => (await cFa.post(`${A}/accounts`, { portfolioId: p.id, code, name, type }, { 'Idempotency-Key': key(code) })).body?.data;
    const cash = await mk('1000', 'Cash', 'ASSET');
    const capital = await mk('3000', 'Capital', 'EQUITY');
    const fee = await mk('5000', 'Fees', 'EXPENSE');
    const accrued = await mk('2000', 'Accrued fees', 'LIABILITY');
    check('four accounts created', !!(cash?.id && capital?.id && fee?.id && accrued?.id), cash);
    const dup = await cFa.post(`${A}/accounts`, acct('1000'), { 'Idempotency-Key': key('dup') });
    check('duplicate code -> 409 duplicate_code', dup.status === 409 && dup.body?.error?.code === 'duplicate_code', dup.body);
    check('bad type -> 400', (await cFa.post(`${A}/accounts`, acct('9', 'WEIRD'), { 'Idempotency-Key': key('bt') })).status === 400);
    const dflt = await cFa.post(`${A}/accounts/default-chart`, { portfolioId: p.id });
    check('default chart adds only the missing codes', dflt.status === 201 && dflt.body.skipped === 4 && dflt.body.created > 5, dflt.body);
    const listed = await cPm.get(`${A}/accounts?portfolioId=${p.id}&type=ASSET`);
    check('list filters by type', listed.status === 200 && listed.body.data.every((a: any) => a.type === 'ASSET') && listed.body.data.some((a: any) => a.code === '1000'), listed.body);
    const rename = await cFa.patch(`${A}/accounts/${fee.id}`, { name: 'Management fees' });
    check('rename an account', rename.status === 200 && rename.body.data.name === 'Management fees');

    console.log('\nJournals: validation and lifecycle');
    const j1b = { portfolioId: p.id, entryDate: '2026-09-10', description: 'Initial subscription', lines: [{ accountId: cash.id, debit: '5000.00' }, { accountId: capital.id, credit: '5000.00' }] };
    check('create without Idempotency-Key -> 400', (await cPm.post(`${A}/journals`, j1b)).status === 400);
    const unb = await cPm.post(`${A}/journals`, { ...j1b, lines: [{ accountId: cash.id, debit: '5000.00' }, { accountId: capital.id, credit: '4999.99' }] }, { 'Idempotency-Key': key('unb') });
    check('unbalanced -> 400 with a message', unb.status === 400 && JSON.stringify(unb.body).includes('must be equal'), unb.body);
    check('negative amount -> 400', (await cPm.post(`${A}/journals`, { ...j1b, lines: [{ accountId: cash.id, debit: '-1' }, { accountId: capital.id, credit: '-1' }] }, { 'Idempotency-Key': key('neg') })).status === 400);
    check('both sides on a line -> 400', (await cPm.post(`${A}/journals`, { ...j1b, lines: [{ accountId: cash.id, debit: '1', credit: '1' }, { accountId: capital.id, credit: '1' }] }, { 'Idempotency-Key': key('both') })).status === 400);
    check('unknown account -> 400', (await cPm.post(`${A}/journals`, { ...j1b, lines: [{ accountId: '00000000-0000-4000-8000-000000000000', debit: '1' }, { accountId: capital.id, credit: '1' }] }, { 'Idempotency-Key': key('ua') })).status === 400);
    const k1 = key('j1');
    const c1 = await cPm.post(`${A}/journals`, j1b, { 'Idempotency-Key': k1 });
    const J1 = c1.body?.data;
    check('create -> 201 DRAFT JNL-##### with totals 5,000.00', c1.status === 201 && J1?.status === 'DRAFT' && /^JNL-\d{5}$/.test(J1.ref) && J1.totalDebit === '5000.00' && J1.totalCredit === '5000.00' && J1.makerId === pm.id && J1.lines.length === 2, c1.body);
    const replay = await cPm.post(`${A}/journals`, j1b, { 'Idempotency-Key': k1 });
    check('same key replays the same journal', replay.headers.get('idempotent-replayed') === 'true' && replay.body?.data?.id === J1.id);
    check('same key, different payload -> 409', (await cPm.post(`${A}/journals`, { ...j1b, description: 'Changed' }, { 'Idempotency-Key': k1 })).status === 409);
    check('audit accounting.journal_created by the preparer', (await auditCount('accounting.journal_created', J1.id, pm.id)) === 1);
    const edit = await cPm.patch(`${A}/journals/${J1.id}`, { entryDate: '2026-09-10', description: 'Initial subscription (edited)', lines: j1b.lines });
    check('the creator edits a draft', edit.status === 200 && edit.body.data.description.endsWith('(edited)'), edit.body);
    check('someone else cannot edit it -> 403 not_maker', (await cFa.patch(`${A}/journals/${J1.id}`, { entryDate: '2026-09-10', description: 'Hijack', lines: j1b.lines })).body?.error?.code === 'not_maker');
    check('only the creator can submit -> 403', (await cFa.post(`${A}/journals/${J1.id}/submit`)).status === 403);
    const sub = await cPm.post(`${A}/journals/${J1.id}/submit`);
    check('submit -> PENDING_APPROVAL', sub.status === 200 && sub.body.data.status === 'PENDING_APPROVAL', sub.body);
    check('editing a pending journal -> 409 journal_immutable', (await cPm.patch(`${A}/journals/${J1.id}`, { entryDate: '2026-09-10', description: 'Late edit', lines: j1b.lines })).body?.error?.code === 'journal_immutable');
    check('a view-only preparer cannot post -> 403', (await cPm.post(`${A}/journals/${J1.id}/post`)).status === 403);
    check('an auditor cannot post -> 403', (await cAud.post(`${A}/journals/${J1.id}/post`)).status === 403);
    await prisma.session.updateMany({ where: { userId: fa.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } }); // enrolment counts as a fresh step-up; age it
    check('post without step-up -> 401 step_up_required', (await cFa.post(`${A}/journals/${J1.id}/post`)).body?.error?.code === 'step_up_required');
    check('step-up succeeds', (await cFa.stepUp()).status === 200);

    // a journal the fund accountant creates cannot be posted by the same fund accountant
    const own = await cFa.post(`${A}/journals`, { ...j1b, description: 'FA own journal' }, { 'Idempotency-Key': key('own') });
    await cFa.post(`${A}/journals/${own.body.data.id}/submit`);
    const ownPost = await cFa.post(`${A}/journals/${own.body.data.id}/post`);
    check('maker-checker: the creator cannot post -> 403 segregation_of_duties', ownPost.status === 403 && ownPost.body?.error?.code === 'segregation_of_duties', ownPost.body);
    const disc = await cFa.post(`${A}/journals/${own.body.data.id}/discard`, { reason: 'Test clean-up' });
    check('discard a pending journal', disc.status === 200 && disc.body.data.status === 'DISCARDED');
    check('a discarded journal cannot be submitted -> 409', (await cFa.post(`${A}/journals/${own.body.data.id}/submit`)).status === 409);

    const ret = await cFa.post(`${A}/journals/${J1.id}/return`, { reason: 'Please add detail' });
    check('return to maker -> DRAFT', ret.status === 200 && ret.body.data.status === 'DRAFT', ret.body);
    check('creator resubmits', (await cPm.post(`${A}/journals/${J1.id}/submit`)).body?.data?.status === 'PENDING_APPROVAL');
    const posted = await cFa.post(`${A}/journals/${J1.id}/post`);
    check('post -> POSTED by the fund accountant', posted.status === 200 && posted.body.data.status === 'POSTED' && posted.body.data.postedBy === fa.id && !!posted.body.data.postedAt, posted.body);
    check('audit accounting.journal_posted', (await auditCount('accounting.journal_posted', J1.id, fa.id)) === 1);
    check('posted journal cannot be edited -> 409 journal_immutable', (await cPm.patch(`${A}/journals/${J1.id}`, { entryDate: '2026-09-10', description: 'x y z', lines: j1b.lines })).body?.error?.code === 'journal_immutable');
    check('posted journal cannot be discarded -> 409', (await cPm.post(`${A}/journals/${J1.id}/discard`, { reason: 'trying anyway' })).status === 409);
    check('posting twice -> 409', (await cFa.post(`${A}/journals/${J1.id}/post`)).status === 409);

    console.log('\nTrial balance and ledger');
    check('director steps up', (await cDir.stepUp()).status === 200);
    const j2 = await cPm.post(
      `${A}/journals`,
      { portfolioId: p.id, entryDate: '2026-09-20', description: 'September fee accrual', lines: [{ accountId: fee.id, debit: '120.50', memo: 'Mgmt fee' }, { accountId: accrued.id, credit: '120.50' }] },
      { 'Idempotency-Key': key('j2') },
    );
    await cPm.post(`${A}/journals/${j2.body.data.id}/submit`);
    const p2 = await cDir.post(`${A}/journals/${j2.body.data.id}/post`);
    check('second journal posted by the director', p2.status === 200 && p2.body.data.status === 'POSTED', p2.body);
    const tb = await cAud.get(`${A}/trial-balance?portfolioId=${p.id}&asOf=2026-09-30`);
    const row = (code: string) => tb.body?.data?.rows?.find((r: any) => r.code === code);
    check('trial balance: cash 5,000.00 DR, capital 5,000.00 CR, fees 120.50 DR, accrued 120.50 CR', row('1000')?.debit === '5000.00' && row('3000')?.credit === '5000.00' && row('5000')?.debit === '120.50' && row('2000')?.credit === '120.50', tb.body);
    check('trial balance totals 5,120.50 both sides and balanced', tb.body.data.totalDebit === '5120.50' && tb.body.data.totalCredit === '5120.50' && tb.body.data.balanced === true, tb.body.data);
    const tbEarly = await cAud.get(`${A}/trial-balance?portfolioId=${p.id}&asOf=2026-09-15`);
    check('as of 15 Sep excludes the 20 Sep fee', tbEarly.body.data.totalDebit === '5000.00');
    const lg = await cAud.get(`${A}/ledger?accountId=${cash.id}&from=2026-09-01&to=2026-09-30`);
    check('ledger of cash: opening 0.00, one line, closing 5,000.00', lg.status === 200 && lg.body.data.openingBalance === '0.00' && lg.body.data.lines.length === 1 && lg.body.data.closingBalance === '5000.00' && lg.body.data.lines[0].balance === '5000.00', lg.body);
    const lgLate = await cAud.get(`${A}/ledger?accountId=${cash.id}&from=2026-10-01`);
    check('ledger from 1 Oct carries the opening balance 5,000.00', lgLate.body.data.openingBalance === '5000.00' && lgLate.body.data.lines.length === 0);

    console.log('\nReversal');
    check('reverse without a reason -> 400', (await cFa.post(`${A}/journals/${J1.id}/reverse`, {})).status === 400);
    check('reverse by a view-only user -> 403', (await cPm.post(`${A}/journals/${J1.id}/reverse`, { reason: 'Wrong entity' })).status === 403);
    const rv = await cFa.post(`${A}/journals/${J1.id}/reverse`, { reason: 'Posted to the wrong entity', entryDate: '2026-09-25' });
    const R = rv.body?.data;
    check('reverse -> 201, a new POSTED journal linked to the original', rv.status === 201 && R?.status === 'POSTED' && R.reversalOfId === J1.id && R.reversalOfRef === J1.ref, rv.body);
    check(
      'reversal lines are the exact inverse (cash credit 5,000.00, capital debit 5,000.00)',
      R?.lines?.find((l: any) => l.accountCode === '1000')?.credit === '5000.00' && R?.lines?.find((l: any) => l.accountCode === '3000')?.debit === '5000.00',
      R?.lines,
    );
    const orig = await cAud.get(`${A}/journals/${J1.id}`);
    check('original is REVERSED and points to the reversal', orig.body.data.status === 'REVERSED' && orig.body.data.reversedById === R.id && orig.body.data.reverseReason === 'Posted to the wrong entity', orig.body.data);
    check('reversing again -> 409 already_reversed', (await cFa.post(`${A}/journals/${J1.id}/reverse`, { reason: 'Second time' })).body?.error?.code === 'already_reversed');
    check('a reversal cannot be reversed -> 409', (await cFa.post(`${A}/journals/${R.id}/reverse`, { reason: 'Reverse the reversal' })).status === 409);
    const tb2 = await cAud.get(`${A}/trial-balance?portfolioId=${p.id}&asOf=2026-09-30`);
    check('after reversal cash nets to 0.00 and the books still balance', tb2.body.data.rows.find((r: any) => r.code === '1000').balance === '0.00' && tb2.body.data.balanced === true, tb2.body.data);
    check('audit accounting.journal_reversed', (await auditCount('accounting.journal_reversed', J1.id, fa.id)) === 1);

    console.log('\nPeriods and close');
    const pb = { portfolioId: p.id, month: '2026-09' };
    const pc = await cPm.post(`${A}/periods`, pb, { 'Idempotency-Key': key('period') });
    const P = pc.body?.data;
    check('open a period -> 201 OPEN 2026-09-01..2026-09-30', pc.status === 201 && P?.status === 'OPEN' && P.periodStart === '2026-09-01' && P.periodEnd === '2026-09-30', pc.body);
    check('duplicate period -> 409', (await cPm.post(`${A}/periods`, pb, { 'Idempotency-Key': key('p2') })).body?.error?.code === 'duplicate_period');
    check('bad month -> 400', (await cPm.post(`${A}/periods`, { ...pb, month: '2026-13' }, { 'Idempotency-Key': key('p3') })).status === 400);

    // blockers: a draft journal, an open recon break and no released NAV
    const draft = await cPm.post(
      `${A}/journals`,
      { portfolioId: p.id, entryDate: '2026-09-28', description: 'Unposted accrual', lines: [{ accountId: fee.id, debit: '10.00' }, { accountId: accrued.id, credit: '10.00' }] },
      { 'Idempotency-Key': key('dr') },
    );
    const rr = await prisma.reconRun.create({ data: { ref: `ACR-${run}`, scopeKey: `ac-${run}`, family: 'CASH', asOfDate: day('2026-09-29'), portfolioId: p.id, status: 'BREAKS', runBy: fa.id } });
    const brk = await prisma.reconBreak.create({ data: { ref: `ACB-${run}`, runId: rr.id, family: 'CASH', itemKey: `k-${run}`, kind: 'AMOUNT_DIFF', label: 'Test break', severity: 'HIGH', status: 'NEW', portfolioId: p.id } });
    const startClose = await cPm.post(`${A}/periods/${P.id}/start-close`);
    check('start close -> CLOSING', startClose.status === 200 && startClose.body.data.status === 'CLOSING', startClose.body);
    const detail = await cPm.get(`${A}/periods/${P.id}`);
    check('checklist itemises 4 items, 3 blockers, canClose false', detail.body.data.checklist.length === 4 && detail.body.data.canClose === false && detail.body.data.blockers.length === 3, detail.body.data);
    check('close needs accounting.close -> 403 for a preparer', (await cPm.post(`${A}/periods/${P.id}/close`)).status === 403);
    const blocked = await cFa.post(`${A}/periods/${P.id}/close`);
    const bl: string[] = blocked.body?.error?.details?.blockers ?? [];
    check('close refused 409 close_blocked listing every blocker', blocked.status === 409 && blocked.body.error.code === 'close_blocked' && bl.length === 3, blocked.body);
    check('blockers name the draft journal, the recon break and the missing NAV', bl.some((b) => b.includes(draft.body.data.ref)) && bl.some((b) => b.includes(`ACB-${run}`)) && bl.some((b) => b.includes('NAV')), bl);
    check('period is still not closed', (await prisma.accPeriod.findUniqueOrThrow({ where: { id: P.id } })).status === 'CLOSING');

    check('discard the draft', (await cPm.post(`${A}/journals/${draft.body.data.id}/discard`, { reason: 'Not needed now' })).status === 200);
    const b2 = await cFa.post(`${A}/periods/${P.id}/close`);
    check('two blockers remain (break, NAV)', b2.status === 409 && (b2.body.error.details.blockers as string[]).length === 2, b2.body);
    await prisma.reconBreak.update({ where: { id: brk.id }, data: { status: 'CLOSED' } });
    const nav = await prisma.navRun.create({ data: { ref: `ACN-${run}`, portfolioId: p.id, navDate: day('2026-09-30'), status: 'RELEASED', makerId: pm.id } });
    const closed = await cFa.post(`${A}/periods/${P.id}/close`);
    check('all blockers cleared: close -> CLOSED with a snapshot', closed.status === 200 && closed.body.data.status === 'CLOSED' && !!closed.body.data.closedAt && !!closed.body.data.closeSnapshot, closed.body);
    check('audit accounting.period_closed', (await auditCount('accounting.period_closed', P.id, fa.id)) === 1);

    console.log('\nA closed period locks posting');
    const late = await cPm.post(
      `${A}/journals`,
      { portfolioId: p.id, entryDate: '2026-09-29', description: 'Late entry', lines: [{ accountId: fee.id, debit: '1.00' }, { accountId: accrued.id, credit: '1.00' }] },
      { 'Idempotency-Key': key('late') },
    );
    check('creating a journal dated in the closed period -> 409 period_closed', late.status === 409 && late.body?.error?.code === 'period_closed', late.body);
    check('reversing into the closed period -> 409 period_closed', (await cFa.post(`${A}/journals/${j2.body.data.id}/reverse`, { reason: 'Try late', entryDate: '2026-09-30' })).body?.error?.code === 'period_closed');
    const oct = await cPm.post(
      `${A}/journals`,
      { portfolioId: p.id, entryDate: '2026-10-01', description: 'October entry', lines: [{ accountId: fee.id, debit: '1.00' }, { accountId: accrued.id, credit: '1.00' }] },
      { 'Idempotency-Key': key('oct') },
    );
    check('an October journal is fine', oct.status === 201);
    // a journal that was pending when the period closed cannot post into it
    const pend = await prisma.accJournal.create({
      data: {
        ref: `ACJ-${run}`,
        portfolioId: p.id,
        entryDate: day('2026-09-12'),
        description: 'Pending in closed period',
        totalDebit: D(1),
        totalCredit: D(1),
        status: 'PENDING_APPROVAL',
        makerId: pm.id,
        lines: { create: [{ lineNo: 1, accountId: fee.id, debit: D(1) }, { lineNo: 2, accountId: accrued.id, credit: D(1) }] },
      },
    });
    const pp = await cDir.post(`${A}/journals/${pend.id}/post`);
    check('posting a pending journal into the closed period -> 409 period_closed', pp.status === 409 && pp.body?.error?.code === 'period_closed', pp.body);

    console.log('\nReopen');
    check('reopen needs accounting.reopen -> 403 for the fund accountant', (await cFa.post(`${A}/periods/${P.id}/reopen`, { reason: 'Need to adjust' })).status === 403);
    check('reopen without a reason -> 400', (await cDir.post(`${A}/periods/${P.id}/reopen`, {})).status === 400);
    const reopened = await cDir.post(`${A}/periods/${P.id}/reopen`, { reason: 'Late custodian fee notice' });
    check('director reopens with a reason -> OPEN', reopened.status === 200 && reopened.body.data.status === 'OPEN' && reopened.body.data.reopenReason === 'Late custodian fee notice', reopened.body);
    check('audit accounting.period_reopened carries the reason', (await prisma.auditEvent.count({ where: { action: 'accounting.period_reopened', objectId: P.id, reason: 'Late custodian fee notice' } })) === 1);
    const pp2 = await cDir.post(`${A}/journals/${pend.id}/post`);
    check('posting into the reopened period works', pp2.status === 200 && pp2.body.data.status === 'POSTED', pp2.body);
    check('reopening an OPEN period -> 409', (await cDir.post(`${A}/periods/${P.id}/reopen`, { reason: 'Again please' })).status === 409);
    void nav;
  } finally {
    try {
      await prisma.accJournal.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.accPeriod.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.accAccount.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.reconBreak.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.reconRun.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
      await prisma.navRun.deleteMany({ where: { portfolioId: { in: portfolioIds } } });
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
