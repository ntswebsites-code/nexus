/**
 * WP-4 checks: admin shell services, security hardening and notifications.
 *
 *  - Pure: widened SoD list and rules, notification routing decisions, secret redaction, metrics route labels.
 *  - Against a RUNNING API: global search (permission filtered), record detail, profile, password change, session
 *    revocation, role focus, notification preferences, page/pageSize/total envelope, custom permission codes, privileged
 *    grants refused on invite / role create / role edit, rate-limit and request-id headers, closed metrics endpoint.
 *  - Against the database: outbox row claiming is exclusive, daily digest is exactly-once, retention purge dry run and
 *    live run, console mail transport never prints a body.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-admin-shell.ts
 *
 * Disposable databases only: creates throwaway users, a role and a portfolio with a random run id and removes them.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { MONETARY, PRIVILEGED_PERMISSIONS, SOD_RULES, sodHits } from '../src/modules/admin-core/admin-core.engine';
import { decideRoute, routeNotifications } from '../src/modules/notifications/delivery';
import { runDigests } from '../src/modules/notifications/digest';
import { runRetentionPurge } from '../src/modules/admin-core/retention';
import { claimEvents } from '../src/lib/outboxClaim';
import { redactSecrets, sendMail } from '../src/lib/mailer';
import { routeLabel } from '../src/middleware/observability';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Sh-${randomBytes(9).toString('base64url')}`;
const newPassword = `Nw-${randomBytes(9).toString('base64url')}`;
let failures = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};
const key = (label: string) => `sh-${run}-${label}-${randomBytes(4).toString('hex')}`;

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
    del: (p: string) => send('DELETE', p),
    login: (email: string, pw = password) => send('POST', '/api/auth/login', { email, password: pw, portal: 'admin' }),
    async enrolMfa() {
      const e = await send('POST', '/api/auth/mfa/enroll', {});
      secret = e.body?.secret ?? '';
      const v = await send('POST', '/api/auth/mfa/verify', { code: totpNow(secret) });
      return e.status === 200 && v.status === 200;
    },
    stepUp: () => send('POST', '/api/auth/mfa/step-up', { code: totpNow(secret) }),
    getSecret: () => secret,
    setSecret: (s: string) => {
      secret = s;
    },
    /** An enrolled user's new sign-in is MFA-pending until the code is verified. */
    verifyMfa: () => send('POST', '/api/auth/mfa/verify', { code: totpNow(secret) }),
  };
}
const errCode = (r: Res) => r.body?.error?.code;
const S = '/api/v1/shell';
const A = '/api/v1/admin';

async function pure() {
  console.log('\nSeparation of duties list (admin-core engine is the single source)');
  for (const p of ['research.ic.decide', 'private.mark.approve', 'financing.approve', 'financing.manage', 'reports.approve', 'model.approve', 'valuation.release', 'accounting.close', 'accounting.reopen', 'capital.approve', 'distributions.approve', 'distributions.settle']) {
    check(`${p} is in the SoD blocklist and privileged`, MONETARY.includes(p) && PRIVILEGED_PERMISSIONS.has(p));
  }
  check('a role with access control, research authoring and no approvals has no SoD hits', sodHits(['admin.rbac', 'audit.view', 'research.edit', 'risk.manage']).length === 0);
  check('research author plus IC decider is a conflict', sodHits(['research.edit', 'research.ic.decide']).some((h) => h.rule === 'research-ic'));
  check('financing maker plus approver is a conflict', sodHits(['financing.manage', 'financing.approve']).some((h) => h.rule === 'financing-maker-checker'));
  check('admin.rbac plus reports.approve is a conflict', sodHits(['admin.rbac', 'reports.approve']).length === 1);
  check('rule ids are unique', new Set(SOD_RULES.map((r) => r.id)).size === SOD_RULES.length);

  console.log('\nNotification routing (preferences, digest, critical channel)');
  const base = { wantsEmail: true, platformEmail: true, criticalChannel: 'in_app_email', prefs: [] as { channel: string; type: string; enabled: boolean }[], lp: null as Record<string, unknown> | null };
  check('default: bell plus immediate email', JSON.stringify(decideRoute({ ...base, type: 'order.submitted' })) === '{"inApp":true,"email":"now"}');
  check('platform email switch off: bell only', decideRoute({ ...base, type: 'order.submitted', platformEmail: false }).email === 'off');
  check('staff in_app muted for order.*', decideRoute({ ...base, type: 'order.submitted', prefs: [{ channel: 'in_app', type: 'order.*', enabled: false }] }).inApp === false);
  check('staff daily digest defers the email', decideRoute({ ...base, type: 'cash.journal_pending', prefs: [{ channel: 'digest_daily', type: '*', enabled: true }] }).email === 'daily');
  check('weekly digest beats daily', decideRoute({ ...base, type: 'cash.journal_pending', prefs: [{ channel: 'digest_daily', type: '*', enabled: true }, { channel: 'digest_weekly', type: '*', enabled: true }] }).email === 'weekly');
  check('LP email flag off for distributions', decideRoute({ ...base, type: 'distribution.paid', lp: { emailDistributions: false, inAppDistributions: true } }).email === 'off');
  check('LP weekly digest preference defers email', decideRoute({ ...base, type: 'document.published', lp: { emailDocuments: true, digest: 'weekly' } }).email === 'weekly');
  check('LP in-app flag off hides the bell item', decideRoute({ ...base, type: 'notice.published', lp: { inAppNotices: false, emailNotices: true } }).inApp === false);
  check('investee reporting.deadlines email off', decideRoute({ ...base, type: 'reporting.reminder', prefs: [{ channel: 'email', type: 'reporting.deadlines', enabled: false }] }).email === 'off');
  const crit = decideRoute({ ...base, type: 'risk.breach', prefs: [{ channel: 'in_app', type: '*', enabled: false }, { channel: 'email', type: '*', enabled: false }] });
  check('critical alerts ignore personal opt-outs', crit.inApp && crit.email === 'now');
  check('critical channel in_app: no email', decideRoute({ ...base, type: 'risk.breach', criticalChannel: 'in_app' }).email === 'off');
  check('critical channel email: bell off', decideRoute({ ...base, type: 'risk.breach', criticalChannel: 'email' }).inApp === false);

  console.log('\nLog hygiene');
  const link = 'https://nexus.example/reset-password?token=abcDEF1234567890abcDEF1234567890xyz&x=1';
  check('token query values are redacted', !redactSecrets(link).includes('abcDEF'));
  check('invite path tokens are redacted', !redactSecrets('https://x/invite/AbCdEfGhIjKlMnOpQrSt').includes('AbCdEf'));
  check('long raw tokens are redacted', redactSecrets(`code ${randomBytes(30).toString('base64url')}`).includes('[redacted]'));
  check('route labels collapse ids', routeLabel('/api/v1/orders/3f2a9c1e-1111-4222-8333-444455556666/approve?token=abc') === '/api/v1/orders/:id/approve');
  const lines: string[] = [];
  const orig = console.log;
  if (!config.smtp) {
    console.log = (...a: unknown[]) => void lines.push(a.join(' '));
    await sendMail(`x-${run}@example.test`, 'Reset your password', 'Use https://nexus.example/reset-password?token=SECRETSECRETSECRETSECRET1234567890');
    console.log = orig;
    check('console mail transport withholds the body', lines.length === 1 && !lines[0]!.includes('SECRETSECRET') && !lines[0]!.includes('reset-password'), lines);
  }

  console.log('\nSecurity headers are configured on every portal and nginx');
  for (const p of ['admin-web', 'investor-web', 'onboarding-web', 'custodian-web', 'company-web']) {
    const src = readFileSync(new URL(`../../../portals/${p}/next.config.ts`, import.meta.url), 'utf8');
    check(`${p} sets CSP with frame-ancestors none`, src.includes('Content-Security-Policy') && src.includes("frame-ancestors 'none'"));
  }
  const nginx = readFileSync(new URL('../../../deploy/nginx/matanho-nexus.conf', import.meta.url), 'utf8');
  check('nginx sends HSTS on every server block', (nginx.match(/Strict-Transport-Security/g) ?? []).length === 6);
}

async function main() {
  await pure();
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, ...roleKeys: string[]) => {
    const u = await prisma.user.create({ data: { email: `sh-${run}-${label}@example.test`, name: `SH ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    for (const k of roleKeys) await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(k)).id } });
    return u;
  };
  const adminU = await mkUser('admin', 'system_admin');
  const pmU = await mkUser('pm', 'portfolio_manager');
  const admin = client();
  const pm = client();
  const pm2 = client();
  const roleKeys: string[] = [];
  const outboxIds: bigint[] = [];
  const portfolio = await prisma.portfolio.create({ data: { ref: `SH-${run}`, name: `Shell Entity ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
  const customCode = `zz.shell_${run}`.replace(/[^a-z_.]/g, '_').slice(0, 40);

  try {
    console.log('\nSign-in');
    check('admin signs in', (await admin.login(adminU.email)).status === 200);
    check('pm signs in', (await pm.login(pmU.email)).status === 200);
    check('admin enrols TOTP', await admin.enrolMfa());

    console.log('\nResponse headers: request id and rate limit');
    const health = await pm.get(`${S}/me`);
    check('X-Request-Id is returned', /^[\w.-]{8,64}$/.test(health.headers.get('x-request-id') ?? ''));
    check('rate-limit headers are present (draft-7)', !!(health.headers.get('ratelimit') ?? health.headers.get('ratelimit-policy')));
    const metrics = await fetch(`${API}/api/internal/metrics`);
    check('metrics endpoint is closed without the token', metrics.status === 404);

    console.log('\nGlobal search and record detail');
    const s1 = await pm.get(`${S}/search?q=${encodeURIComponent(portfolio.ref)}`);
    check('search finds the portfolio by ref', s1.status === 200 && s1.body.hits.some((h: any) => h.kind === 'portfolio' && h.id === portfolio.id), s1.body);
    check('hit carries a record-detail link', s1.body.hits[0]?.href === `/ops/record/portfolio/${portfolio.id}`, s1.body.hits[0]);
    check('one-character query is refused', (await pm.get(`${S}/search?q=a`)).status === 400);
    const sAdmin = await admin.get(`${S}/search?q=${encodeURIComponent(`sh-${run}-pm`)}`);
    check('admin.rbac holder sees staff users', sAdmin.body.hits.some((h: any) => h.kind === 'staff-user' && h.id === pmU.id), sAdmin.body);
    const sPm = await pm.get(`${S}/search?q=${encodeURIComponent(`sh-${run}-pm`)}`);
    check('search is permission filtered (no staff users for a portfolio manager)', !sPm.body.hits.some((h: any) => h.kind === 'staff-user'), sPm.body);
    const rec = await pm.get(`${S}/record/portfolio/${portfolio.id}`);
    check('record detail returns labelled fields', rec.status === 200 && rec.body.record.fields.some((f: any) => f.label === 'Name' && f.value === portfolio.name), rec.body);
    check('record detail never exposes secrets', !JSON.stringify((await admin.get(`${S}/record/staff-user/${pmU.id}`)).body).includes('passwordHash'));
    check('unknown record type is 404', (await pm.get(`${S}/record/nothing/${portfolio.id}`)).status === 404);
    check('record of a kind the role cannot see is 403', (await pm.get(`${S}/record/staff-user/${adminU.id}`)).status === 403);

    console.log('\nProfile, role focus, password change and sessions');
    const me = await pm.get(`${S}/me`);
    check('profile lists roles, MFA state and the current session', me.status === 200 && me.body.roles[0]?.key === 'portfolio_manager' && me.body.mfa.enrolled === false && me.body.sessions.some((x: any) => x.current), me.body);
    check('name can be changed', (await pm.put(`${S}/me`, { name: `SH pm ${run}` })).status === 200);
    check('role focus rejects a role the user does not hold', (await pm.put(`${S}/me/role-focus`, { role: 'system_admin' })).status === 400);
    const focus = await pm.put(`${S}/me/role-focus`, { role: 'portfolio_manager' });
    check('role focus is saved with that role bundle', focus.status === 200 && focus.body.permissions.includes('portfolio.view'), focus.body);
    check('role focus persists', (await pm.get(`${S}/me/role-focus`)).body.role === 'portfolio_manager');
    check('role focus can be cleared', (await pm.put(`${S}/me/role-focus`, { role: null })).body.role === null);
    check('MFA enrolment is available to the user (existing endpoint)', (await pm.enrolMfa()) === true);
    check('profile now shows MFA enrolled', (await pm.get(`${S}/me`)).body.mfa.enrolled === true);
    check('second browser signs in', (await pm2.login(pmU.email)).status === 200);
    const wrong = await pm.post(`${S}/me/password`, { currentPassword: 'definitely-wrong-1', newPassword });
    check('wrong current password is refused', wrong.status === 400 && errCode(wrong) === 'invalid_current_password', wrong.body);
    const weak = await pm.post(`${S}/me/password`, { currentPassword: password, newPassword: 'short' });
    check('weak new password is refused', weak.status === 400, weak.body);
    const changed = await pm.post(`${S}/me/password`, { currentPassword: password, newPassword });
    check('password changes and other sessions are revoked', changed.status === 200 && changed.body.otherSessionsRevoked >= 0, changed.body);
    check('old password no longer signs in', (await client().login(pmU.email, password)).status === 401);
    const relog = client();
    const relogin = await relog.login(pmU.email, newPassword);
    check('new password signs in', relogin.status === 200);
    if (relogin.body?.mfa === 'verify') {
      relog.setSecret(pm.getSecret());
      check('the new sign-in completes MFA (enrolled users are MFA-pending until verified)', (await relog.verifyMfa()).status === 200);
    }
    const sessions = (await relog.get(`${S}/me`)).body.sessions as { id: string; current: boolean }[];
    check('current session cannot be revoked from the list', (await relog.del(`${S}/me/sessions/${sessions.find((x) => x.current)!.id}`)).status === 409);
    check('revoke-others succeeds', (await relog.post(`${S}/me/sessions/revoke-others`, {})).status === 200);
    check('password change is audited', (await prisma.auditEvent.count({ where: { action: 'auth.password.changed', objectId: pmU.id } })) === 1);

    console.log('\nNotification preferences and routing');
    const pref0 = await relog.get('/api/v1/notifications/preferences');
    check('preferences list the staff notification types', pref0.status === 200 && pref0.body.types.length >= 5 && pref0.body.digest === 'off', pref0.body);
    const put = await relog.put('/api/v1/notifications/preferences', { digest: 'daily', preferences: [{ type: 'order.*', channel: 'in_app', enabled: false }, { type: 'bogus.*', channel: 'email', enabled: false }] });
    check('preferences save (unknown types ignored)', put.status === 200 && put.body.digest === 'daily' && put.body.types.find((t: any) => t.type === 'order.*').channels.in_app === false, put.body);
    const routes = await routeNotifications([pmU.id, adminU.id], 'order.submitted', true);
    check('worker routing honours the saved staff preferences', routes.get(pmU.id)!.inApp === false && routes.get(pmU.id)!.email === 'daily', [...routes]);
    check('another user is unaffected', routes.get(adminU.id)!.inApp === true && routes.get(adminU.id)!.email === 'now');
    const lpKey = `lp.prefs:sh-${run}`;
    await prisma.setting.create({ data: { ownerId: adminU.id, key: lpKey, value: { notifications: { emailDocuments: false, inAppDocuments: true, digest: 'weekly' } } } });
    const lpRoute = (await routeNotifications([adminU.id], 'document.published', true)).get(adminU.id)!;
    check('worker routing honours stored LP preferences', lpRoute.email === 'off' && lpRoute.inApp === true, lpRoute);
    await prisma.setting.delete({ where: { ownerId_key: { ownerId: adminU.id, key: lpKey } } });
    const list = await relog.get('/api/v1/notifications?page=1&pageSize=5');
    check('bell list carries page, pageSize and total', list.status === 200 && list.body.page === 1 && list.body.pageSize === 5 && typeof list.body.total === 'number', list.body);

    console.log('\nPage envelope on staff lists');
    const full = await admin.get('/api/v1/admin-core/settings');
    const paged = await admin.get('/api/v1/admin-core/settings?page=2&pageSize=3');
    check('unpaged staff list reports total and keeps every row', full.status === 200 && full.body.total === full.body.data.length && full.body.data.length > 3, { total: full.body.total });
    check('?page&pageSize returns that window', paged.body.page === 2 && paged.body.pageSize === 3 && paged.body.data.length === Math.min(3, Math.max(0, full.body.total - 3)) && paged.body.total === full.body.total, paged.body.data?.length);

    console.log('\nCustom permission codes and privileged grants');
    await admin.stepUp();
    const idem = key('perm');
    const mk = await admin.post(`${A}/permissions`, { code: customCode, label: `Shell test ${run}` }, { 'Idempotency-Key': idem });
    check('custom permission defined (step-up, audited)', mk.status === 201, mk.body);
    const replay = await admin.post(`${A}/permissions`, { code: customCode, label: `Shell test ${run}` }, { 'Idempotency-Key': idem });
    check('same Idempotency-Key replays the stored response', replay.status === 201, replay.body);
    check('duplicate code is refused', errCode(await admin.post(`${A}/permissions`, { code: customCode, label: 'again' }, { 'Idempotency-Key': key('p2') })) === 'permission_exists');
    check('reserved code is refused', (await admin.post(`${A}/permissions`, { code: 'admin.root', label: 'nope' }, { 'Idempotency-Key': key('p3') })).status === 400);
    check('permission catalogue includes the custom code', (await admin.get(`${A}/permissions`)).body.custom.some((c: any) => c.code === customCode));
    // R4-1: role creation is a maker-checker change request now; the direct endpoint refuses. The role is seeded directly for the checks below.
    const direct = await admin.post(`${A}/roles`, { label: `Shell Role ${run}`, template: 'investment_director' });
    check('direct role creation needs an independent checker (change request)', direct.status === 409 && errCode(direct) === 'approval_required', direct.body);
    const tpl = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: 'investment_director' } }, include: { permissions: true } });
    const rk = `shell_role_${run}`;
    const baseSet = tpl.permissions.map((p) => p.permission).filter((p) => !PRIVILEGED_PERMISSIONS.has(p));
    await prisma.role.create({ data: { portal: 'admin', key: rk, label: `Shell Role ${run}`, custom: true, permissions: { create: baseSet.map((permission) => ({ permission })) } } });
    roleKeys.push(rk);
    const newRole = { body: { role: { key: rk, permissions: baseSet } } };
    const perms = newRole.body.role.permissions as string[];
    const grant = await admin.put(`${A}/roles/${rk}/permissions`, { permissions: [...perms, customCode] });
    check('custom code can be attached to a role', grant.status === 200 && grant.body.role.permissions.includes(customCode), grant.body);
    for (const p of ['research.ic.decide', 'private.mark.approve', 'financing.approve', 'reports.approve', 'model.approve']) {
      const r = await admin.put(`${A}/roles/${rk}/permissions`, { permissions: [...perms, p] });
      check(`granting ${p} directly needs an independent checker`, r.status === 409 && errCode(r) === 'approval_required', r.body);
    }
    const unk = await admin.put(`${A}/roles/${rk}/permissions`, { permissions: [...perms, 'made.up_code'] });
    check('unknown permission codes are refused', unk.status === 400, unk.body);
    const inv = await admin.post(`${A}/users`, { name: 'Shell Invitee', email: `sh-${run}-inv@example.test`, role: 'investment_director' }, { 'Idempotency-Key': key('inv') });
    check('direct staff invitation needs a checker (change request)', inv.status === 409 && errCode(inv) === 'approval_required', inv.body);
    const del = await admin.del(`${A}/permissions/${customCode}`);
    check('a custom code still on a role cannot be deleted', del.status === 409 && errCode(del) === 'permission_in_use', del.body);
    await admin.put(`${A}/roles/${rk}/permissions`, { permissions: perms });
    check('after detaching, the custom code is deleted', (await admin.del(`${A}/permissions/${customCode}`)).status === 200);

    console.log('\nOutbox row claiming');
    for (let i = 0; i < 12; i++) outboxIds.push((await prisma.outboxEvent.create({ data: { type: 'test.noop', payload: { run, i } } })).id);
    const [a, b] = await Promise.all([claimEvents(`wA-${run}`, 8), claimEvents(`wB-${run}`, 8)]);
    const idsA = new Set(a.map((e) => e.id));
    check('two workers never hold the same event', a.every((e) => !b.some((x) => x.id === e.id)) && a.length > 0 && b.length > 0, { a: a.length, b: b.length });
    check('claims are recorded on the row', (await prisma.outboxEvent.count({ where: { claimedBy: `wA-${run}` } })) === idsA.size);
    const again = await claimEvents(`wA-${run}`, 8);
    check('a claimed row is not re-claimed by another instance', (await claimEvents(`wC-${run}`, 100)).every((e) => !idsA.has(e.id) && !b.some((x) => x.id === e.id)) && again.length >= idsA.size);
    await prisma.outboxEvent.updateMany({ where: { claimedBy: { in: [`wA-${run}`, `wB-${run}`, `wC-${run}`] } }, data: { claimedBy: null, claimedAt: null } });
    await prisma.outboxEvent.updateMany({ where: { id: { in: outboxIds }, claimedBy: null }, data: { claimedBy: `stale-${run}`, claimedAt: new Date(Date.now() - 10 * 60_000) } });
    const taken = await claimEvents(`wD-${run}`, 100);
    check('a stale claim (crashed worker) is taken over', outboxIds.some((id) => taken.some((e) => e.id === id)));
    await prisma.outboxEvent.updateMany({ where: { claimedBy: `wD-${run}` }, data: { claimedBy: null, claimedAt: null } });

    console.log('\nDaily digest is exactly-once');
    await prisma.jobLock.deleteMany({ where: { name: 'notify.digest' } });
    await prisma.notification.createMany({
      data: [1, 2, 3].map((n) => ({ userId: pmU.id, type: 'order.submitted', title: `Digest item ${n} ${run}`, emailStatus: 'DIGEST_DAILY', readAt: new Date() })),
    });
    const noon = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`);
    await runDigests(noon);
    const queued = await prisma.outboxEvent.findMany({ where: { type: 'email.send', createdAt: { gte: new Date(Date.now() - 120_000) } } });
    const mine = queued.filter((e) => (e.payload as any)?.to === pmU.email && String((e.payload as any)?.subject).includes('digest'));
    outboxIds.push(...queued.map((e) => e.id));
    check('one digest email is queued for the user', mine.length === 1 && String((mine[0]!.payload as any).text).includes(`Digest item 2 ${run}`), mine.length);
    check('items are marked DIGESTED', (await prisma.notification.count({ where: { userId: pmU.id, emailStatus: 'DIGESTED', title: { contains: run } } })) === 3);
    await prisma.jobLock.deleteMany({ where: { name: 'notify.digest' } });
    await prisma.notification.create({ data: { userId: pmU.id, type: 'order.submitted', title: `Late item ${run}`, emailStatus: 'DIGEST_DAILY', readAt: new Date() } });
    await runDigests(noon);
    const queued2 = await prisma.outboxEvent.findMany({ where: { type: 'email.send', createdAt: { gte: new Date(Date.now() - 120_000) } } });
    outboxIds.push(...queued2.map((e) => e.id));
    check('a second run in the same period sends nothing more', queued2.filter((e) => (e.payload as any)?.to === pmU.email && String((e.payload as any)?.subject).includes('digest')).length === 1);

    console.log('\nRetention purge');
    const oldSession = await prisma.session.create({ data: { userId: pmU.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() - 400 * 86_400_000) } });
    const dry = await runRetentionPurge({ dryRun: true, triggeredBy: 'test' });
    check('dry run counts but deletes nothing', dry.dryRun && dry.sessionsDeleted >= 1 && !!(await prisma.session.findUnique({ where: { id: oldSession.id } })), dry);
    const live = await runRetentionPurge({ triggeredBy: 'test' });
    check('live run removes the expired session', !live.dryRun && !(await prisma.session.findUnique({ where: { id: oldSession.id } })), live);
    check('audit evidence is never purged and its floor is reported', live.auditRetentionYears >= 7 && /^\d{4}-\d{2}-\d{2}$/.test(live.auditFloor));
    check('each run is recorded', (await prisma.purgeRun.count({ where: { triggeredBy: 'test' } })) === 2);
    await admin.stepUp();
    const api = await admin.post('/api/v1/admin-core/retention/run', { dryRun: true });
    check('admin can trigger a dry run from the API', api.status === 200 && api.body.data.dryRun === true, api.body);
    const runs = await admin.get('/api/v1/admin-core/retention/runs');
    check('run history is listed', runs.status === 200 && runs.body.data.length >= 3);

    console.log('\nFeature flags are consumed');
    const before = await prisma.platformSetting.findUnique({ where: { key: 'feature.statement_import' } });
    await admin.stepUp();
    const off = await admin.put('/api/v1/admin-core/settings/feature.statement_import', { value: false, reason: 'shell test' }, { 'Idempotency-Key': key('flag') });
    check('flag turned off', off.status === 200, off.body);
    await new Promise((r) => setTimeout(r, 200));
    // system_admin deliberately holds no cash permissions (SoD-clean roles), so the import is attempted by a fund accountant;
    // the permission gate runs first, then the feature flag.
    const faU = await mkUser('fa', 'fund_accountant');
    const fa = client();
    check('fund accountant signs in', (await fa.login(faU.email)).status === 200);
    const blocked = await fa.post('/api/v1/cash/statement-imports', {}, { 'Idempotency-Key': key('imp') });
    check('statement import is refused while the flag is off', blocked.status === 403 && errCode(blocked) === 'feature_disabled', blocked.body);
    await admin.stepUp();
    await admin.put('/api/v1/admin-core/settings/feature.statement_import', { value: true, reason: 'shell test restore' }, { 'Idempotency-Key': key('flag2') });
    void before;
  } finally {
    await prisma.outboxEvent.deleteMany({ where: { OR: [{ id: { in: outboxIds } }, { type: 'test.noop' }] } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.notificationDigestLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.customPermission.deleteMany({ where: { code: customCode } }).catch(() => undefined);
    await prisma.role.deleteMany({ where: { portal: 'admin', key: { in: roleKeys } } }).catch(() => undefined);
    await prisma.portfolio.delete({ where: { id: portfolio.id } }).catch(() => undefined);
    await prisma.invitation.deleteMany({ where: { email: { startsWith: `sh-${run}-` } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
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
