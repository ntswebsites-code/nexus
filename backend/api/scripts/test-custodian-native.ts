/**
 * R4-7 native custodian portal API against a RUNNING API (CUSTODIAN_LIVE=true, INTEGRATION_CUSTODIAN_FEED=file-drop or fake):
 *   dashboard, day-end control totals, statement and holdings upload through the custodian-feed ingest path
 *   (validation, scope, idempotency, duplicate refusal, approvable package), users and roles (invite, role change,
 *   deactivate, self-change, last approver, permission gating) and audit rows.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4154 npx tsx scripts/test-custodian-native.ts
 *
 * Creates a throwaway counterparty and users and removes them at the end; disposable databases only.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { fakeStatementFile } from '../src/integrations/custodian-feed/fake';
import { isoDay, lastWeekdayOnOrBefore } from '../src/integrations/common';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Cx-${randomBytes(9).toString('base64url')}`;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};

type Res = { status: number; body: any };
function client(origin: string) {
  let cookie = '';
  let n = 0;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET' && !h['Idempotency-Key']) h['Idempotency-Key'] = `nat-${run}-${++n}`;
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
  return { call, login: (email: string, portal: string) => call('POST', '/api/auth/login', { email, password, portal }, { 'Idempotency-Key': 'login' }) };
}

const C = '/api/v1/custodian';

async function main() {
  console.log(`API ${API} · run ${run}`);
  const bcrypt = (await import('bcryptjs')).default;
  const users: string[] = [];
  const mk = async (label: string, role: string) => {
    const u = await prisma.user.create({ data: { email: `cxnat-${run}-${label}@example.test`, name: `CN ${label}`, passwordHash: await bcrypt.hash(password, 4) } });
    users.push(u.id);
    const r = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'custodian', key: role } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });
    return u;
  };
  const cp = await prisma.counterparty.create({ data: { ref: `CPN${run}`, name: `CN Custodian ${run}`, accounts: ['NAT-001'] } });
  const sub = await mk('sub', 'submitter');
  const appr = await mk('appr', 'approver');
  const appr2 = await mk('appr2', 'approver');
  await prisma.counterpartyUser.createMany({
    data: [
      { counterpartyId: cp.id, userId: sub.id, role: 'submitter' },
      { counterpartyId: cp.id, userId: appr.id, role: 'approver' },
      { counterpartyId: cp.id, userId: appr2.id, role: 'approver' },
    ],
  });
  const origin = config.portalUrls.custodian;
  const s = client(origin);
  const a = client(origin);
  const anon = client(origin);
  const invitationIds: string[] = [];
  try {
    check('submitter signs in', (await s.login(sub.email, 'custodian')).status === 200);
    check('approver signs in', (await a.login(appr.email, 'custodian')).status === 200);
    check('unauthenticated dashboard -> 401', (await anon.call('GET', `${C}/dashboard`)).status === 401);

    // ---- dashboard
    const dash0 = await s.call('GET', `${C}/dashboard`);
    check('dashboard: counterparty, role and empty counts', dash0.status === 200 && dash0.body.counterparty.ref === cp.ref && dash0.body.role === 'submitter' && dash0.body.submittedToday === 0 && dash0.body.awaitingApproval.length === 0, dash0.body);

    // ---- control totals from executions
    const when = new Date(Date.now() - 3_600_000).toISOString();
    const today = when.slice(0, 10);
    const e1 = await s.call('POST', `${C}/executions`, { executions: [{ tradeRef: `N1-${run}`, executionAt: when, accountRef: 'NAT-001', ticker: 'DLTA.ZW', side: 'BUY', quantity: '100', price: '2.5', currency: 'USD' }, { tradeRef: `N2-${run}`, executionAt: when, accountRef: 'NAT-001', ticker: 'CBZ.ZW', side: 'SELL', quantity: '40', price: '1', currency: 'USD' }] });
    check('executions submitted for the control total check', e1.status === 201 && e1.body.created.length === 2, e1.body);
    const ct = await s.call('GET', `${C}/control-totals?date=${today}`);
    const row = ct.body?.items?.find((i: any) => i.accountRef === 'NAT-001' && i.currency === 'USD');
    check('control totals: count, quantity and notional of the day', ct.status === 200 && row?.executions === 2 && row.quantity === '140.00000000' && row.notional === '290.00', ct.body);
    check('control totals: bad date -> 400', (await s.call('GET', `${C}/control-totals?date=nope`)).status === 400);
    const dash1 = await s.call('GET', `${C}/dashboard`);
    check('dashboard: counts reflect the submissions', dash1.body.submittedToday === 2 && dash1.body.executions.Received === 2, dash1.body);

    // ---- statements and holdings
    const date = lastWeekdayOnOrBefore(isoDay(new Date()));
    const file = fakeStatementFile(`cx-${run}`, 'NAT-001', date, 'CSV', 'USD');
    const filename = `nat-${run}.csv`;
    const foreignFile = fakeStatementFile(`cx-${run}`, 'OTHER-999', date, 'CSV', 'USD');
    const foreign = await s.call('POST', `${C}/statements/validate`, { filename: 'foreign.csv', content: foreignFile.content });
    check('statements: account outside the counterparty is rejected (422)', foreign.status === 422 && foreign.body?.error?.code === 'statement_rejected' && /OTHER-999/.test(JSON.stringify(foreign.body)), foreign.body);
    const garbage = await s.call('POST', `${C}/statements/validate`, { filename: 'junk.csv', content: 'this,is,not\na,statement,at all' });
    check('statements: unparseable file -> 422', garbage.status === 422, garbage.body);
    const val = await s.call('POST', `${C}/statements/validate`, { filename, content: file.content });
    check('statements: validate summarises trades and holdings without storing', val.status === 200 && val.body.valid && val.body.statements[0].accountRef === 'NAT-001' && val.body.statements[0].holdings === 3 && (await prisma.custodianFeedFile.count({ where: { counterpartyId: cp.id } })) === 0, val.body);
    const key = `stmt-${run}`;
    const up = await s.call('POST', `${C}/statements`, { filename, content: file.content }, { 'Idempotency-Key': key });
    const st = up.body?.data?.statements?.[0];
    check('statements: upload loads trades, holdings and a day-end package', up.status === 201 && st?.tradesImported === 2 && st.holdings === 3 && !!st.dayEndRef, up.body);
    const replay = await s.call('POST', `${C}/statements`, { filename, content: file.content }, { 'Idempotency-Key': key });
    check('statements: same idempotency key replays the stored response', replay.status === 201 && replay.body?.data?.fileId === up.body?.data?.fileId, replay.body);
    const dup = await s.call('POST', `${C}/statements`, { filename, content: file.content });
    check('statements: identical content again -> 409 duplicate_file', dup.status === 409 && dup.body?.error?.code === 'duplicate_file', dup.body);
    check('statements: one file row, three holdings lines', (await prisma.custodianFeedFile.count({ where: { counterpartyId: cp.id, status: 'Imported' } })) === 1 && (await prisma.custodianFeedHolding.count({ where: { counterpartyId: cp.id } })) === 3);
    const list = await s.call('GET', `${C}/statements`);
    check('statements: file list and adapter statements', list.status === 200 && list.body.files.length === 1 && Array.isArray(list.body.statements) && ['file-drop', 'fake'].includes(list.body.mode), list.body);
    const fileId = up.body.data.fileId;
    const detail = await s.call('GET', `${C}/statements/files/${fileId}`);
    check('statements: file detail lists holdings', detail.status === 200 && detail.body.holdings.length === 3, detail.body);
    const hold = await s.call('GET', `${C}/holdings?accountRef=NAT-001`);
    check('holdings: latest statement date and lines', hold.status === 200 && hold.body.date === date && hold.body.items.length === 3, hold.body);
    check('holdings: foreign account -> 403', (await s.call('GET', `${C}/holdings?accountRef=OTHER-999`)).status === 403);
    const tpl = await s.call('GET', `${C}/statements/template/CSV`);
    check('statements: template download', tpl.status === 200 && /NAT-001/.test(tpl.body.data.content), tpl.body);

    // The package from the statement is approvable by a second user: its fingerprint is the portal's canonical hash.
    const pkgId = (await prisma.counterpartyDayEndPackage.findFirstOrThrow({ where: { counterpartyId: cp.id, ref: st.dayEndRef } })).id;
    const selfApprove = await s.call('POST', `${C}/day-end/${pkgId}/approve`, {});
    check('statement package: submitter cannot approve (403)', selfApprove.status === 403, selfApprove.body);
    const approve = await a.call('POST', `${C}/day-end/${pkgId}/approve`, {});
    check('statement package: approver approves (fingerprint verified)', approve.status === 200 && approve.body.package.status === 'Approved', approve.body);
    const locked = await s.call('POST', `${C}/statements/validate`, { filename: 'again.csv', content: fakeStatementFile(`cx-${run}`, 'NAT-001', date, 'JSON', 'USD').content, format: 'JSON' });
    check('statements: a day with an approved package is locked', locked.status === 422 && /already covers/.test(JSON.stringify(locked.body)), locked.body);
    const dash2 = await s.call('GET', `${C}/dashboard`);
    check('dashboard: last statement shown', dash2.body.lastStatement?.filename === filename, dash2.body);

    // ---- users and roles
    const users0 = await s.call('GET', `${C}/users`);
    check('users: list with canManage false for a submitter', users0.status === 200 && users0.body.canManage === false && users0.body.items.length === 3, users0.body);
    const subInvite = await s.call('POST', `${C}/users/invite`, { email: `cxnat-${run}-x@example.test`, role: 'submitter' });
    check('users: submitter cannot invite (403)', subInvite.status === 403, subInvite.body);
    const inviteKey = `inv-${run}`;
    const invEmail = `cxnat-${run}-new@example.test`;
    const inv = await a.call('POST', `${C}/users/invite`, { email: invEmail, name: 'New Colleague', role: 'submitter' }, { 'Idempotency-Key': inviteKey });
    check('users: approver invites a colleague', inv.status === 201 && inv.body.invitation.role === 'submitter', inv.body);
    if (inv.body?.invitation?.id) invitationIds.push(inv.body.invitation.id);
    const invAgain = await a.call('POST', `${C}/users/invite`, { email: invEmail, name: 'New Colleague', role: 'submitter' }, { 'Idempotency-Key': inviteKey });
    check('users: retry with the same key creates no second invitation', invAgain.status === 201 && (await prisma.invitation.count({ where: { email: invEmail } })) === 1, invAgain.body);
    const dupInvite = await a.call('POST', `${C}/users/invite`, { email: sub.email, role: 'submitter' });
    check('users: inviting an existing member -> 409', dupInvite.status === 409 && dupInvite.body?.error?.code === 'already_member', dupInvite.body);
    const grant = await prisma.setting.findFirst({ where: { ownerId: inv.body.invitation.id, key: 'invite.grant' } });
    check('users: invitation grant is tied to this counterparty', (grant?.value as any)?.counterpartyId === cp.id, grant);

    const self = await a.call('PATCH', `${C}/users/${appr.id}`, { role: 'submitter', reason: 'Changing my own role' });
    check('users: cannot change your own access (403)', self.status === 403 && self.body?.error?.code === 'self_change', self.body);
    const noReason = await a.call('PATCH', `${C}/users/${sub.id}`, { role: 'approver' });
    check('users: a reason is mandatory (400)', noReason.status === 400, noReason.body);
    const promote = await a.call('PATCH', `${C}/users/${sub.id}`, { role: 'approver', reason: 'Covering approvals this week' });
    const subRole = await prisma.userRole.findMany({ where: { userId: sub.id }, include: { role: true } });
    check('users: promote to approver updates the link and the portal role', promote.status === 200 && promote.body.user.role === 'approver' && subRole.length === 1 && subRole[0]!.role.key === 'approver', [promote.body, subRole.map((r) => r.role.key)]);
    const demote = await a.call('PATCH', `${C}/users/${sub.id}`, { role: 'submitter', reason: 'Back to submitting only' });
    check('users: demote back to submitter', demote.status === 200 && demote.body.user.role === 'submitter', demote.body);
    const off = await a.call('PATCH', `${C}/users/${sub.id}`, { status: 'inactive', reason: 'Left the organisation' });
    check('users: deactivate', off.status === 200 && off.body.user.status === 'inactive', off.body);
    check('users: deactivated user loses access (403 no_counterparty)', (await s.call('GET', `${C}/me`)).status === 403);
    const on = await a.call('PATCH', `${C}/users/${sub.id}`, { status: 'active', reason: 'Returned to the team' });
    check('users: reactivate restores access', on.status === 200 && (await s.call('GET', `${C}/me`)).status === 200, on.body);
    const a2 = client(origin);
    await a2.login(appr2.email, 'custodian');
    const d1 = await a2.call('PATCH', `${C}/users/${appr.id}`, { status: 'inactive', reason: 'Approver 1 leaves' });
    check('users: one approver may deactivate another while a third remains', d1.status === 200, d1.body);
    const noop = await a2.call('PATCH', `${C}/users/${sub.id}`, { role: 'submitter', reason: 'Nothing actually changes' });
    check('users: unchanged request -> 400', noop.status === 400, noop.body);
    const gone = await a.call('GET', `${C}/me`);
    check('users: the deactivated approver is locked out (403)', gone.status === 403, gone.body);

    // ---- audit
    const actions = (await prisma.auditEvent.findMany({ where: { OR: [{ objectId: { in: [pkgId, fileId, sub.id, ...invitationIds] } }] }, select: { action: true } })).map((r) => r.action);
    check('audit: statement, package approval, invite and user changes are recorded', ['custodian.statement.uploaded', 'custodian.dayend.approved', 'custodian.user.invited', 'custodian.user.updated'].every((x) => actions.includes(x)), actions);
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: users } } });
    await prisma.setting.deleteMany({ where: { ownerId: { in: (await prisma.invitation.findMany({ where: { email: { contains: `cxnat-${run}` } }, select: { id: true } })).map((i) => i.id) } } });
    await prisma.invitation.deleteMany({ where: { email: { contains: `cxnat-${run}` } } });
    await prisma.custodianFeedHolding.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.custodianFeedFile.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.custodianExecutionEvent.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.counterpartyExecution.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.counterpartyDayEndPackage.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.counterparty.delete({ where: { id: cp.id } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll native custodian checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
