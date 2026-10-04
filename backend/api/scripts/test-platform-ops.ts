/**
 * Package S8 (platform and ops tooling) checks against a RUNNING API:
 *  - NFR-OPS-007: /api/health?deep=1 carries queue depth and age; /api/internal/metrics exposes nexus_queue_* gauges.
 *  - NFR-PERF-005: SQL paging with total on clients, cash accounts and the staff document list.
 *  - FR-DOC-017: retention schedules (create, duplicate, optimistic version, edit, audit), enforcement at the
 *    nightly purge (raises, never lowers, never deletes; legal hold counted) and on a retention change request.
 *  - Build-plan S26: portal flags and demo-mode switch (admin.settings, step-up, reason, audit, version conflict).
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4190 npx tsx scripts/test-platform-ops.ts
 *
 * Disposable schema only. Creates throwaway staff, documents and schedule rows under its own run id and removes them.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { enforcedRetention, matchSchedule } from '../src/lib/retention-schedule';
import { mergeFlags, normaliseOverrides, PORTAL_FLAGS_KEY } from '../src/lib/portal-flags';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `S8-${randomBytes(9).toString('base64url')}`;
let failures = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 1200));
  }
};

type Res = { status: number; body: any; headers: Headers };

function client(portal: 'investor' | 'admin' = 'admin') {
  const origin = config.portalUrls[portal];
  const jar = new Map<string, string>();
  let secret = '';
  const send = async (method: string, path: string, init: { body?: string | FormData; headers?: Record<string, string> } = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...(init.headers ?? {}) };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, { method, headers: h, body: init.body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/max-age=0/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: buf, headers: res.headers };
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
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const once = () =>
      send(method, path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      });
    let res = await once();
    for (let i = 0; i < 10 && res.status === 409 && res.body?.code === 'LP_IDEMPOTENCY_IN_PROGRESS'; i++) {
      await new Promise((r) => setTimeout(r, 300));
      res = await once();
    }
    return res;
  };
  return {
    call,
    get: (path: string) => call('GET', path),
    post: (path: string, body: unknown = {}, headers: Record<string, string> = {}) => call('POST', path, body, headers),
    patch: (path: string, body: unknown = {}, headers: Record<string, string> = {}) => call('PATCH', path, body, headers),
    del: (path: string) => call('DELETE', path),
    upload: (path: string, name: string, mime: string, data: Buffer, headers: Record<string, string> = {}) => {
      const form = new FormData();
      form.append('file', new Blob([data], { type: mime }), name);
      return send('POST', path, { body: form, headers });
    },
    login: (email: string, pw = password, mfa = false) => call('POST', '/api/auth/login', { email, password: pw, portal }).then((r) => (mfa ? r : r)),
    async enrolMfa() {
      const e = await send('POST', '/api/auth/mfa/enroll', { body: '{}', headers: { 'Content-Type': 'application/json' } });
      secret = e.body?.secret ?? '';
      const v = await call('POST', '/api/auth/mfa/verify', { code: totpNow(secret) });
      return e.status === 200 && v.status === 200;
    },
    stepUp: () => call('POST', '/api/auth/mfa/step-up', { code: totpNow(secret) }),
    code: () => totpNow(secret),
  };
}
type Client = ReturnType<typeof client>;

const key = (s: string) => ({ 'Idempotency-Key': `s8-${run}-${s}-${randomBytes(3).toString('hex')}` });
const V = '/api/v1';
const CO = `${V}/client-ops/vault/retention-schedules`;

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const created = { users: [] as string[], roles: [] as string[], docs: [] as string[], schedules: [] as string[] };

  const mkRole = async (label: string, perms: string[]) => {
    const r = await prisma.role.create({ data: { portal: 'admin', key: `s8-${run}-${label}`, label: `S8 ${label}`, custom: true } });
    created.roles.push(r.id);
    await prisma.rolePermission.createMany({ data: perms.map((permission) => ({ roleId: r.id, permission })) });
    return r;
  };
  const opsRole = await mkRole('ops', ['admin.settings', 'documents.view', 'documents.edit', 'documents.approve', 'clients.view', 'cash.view', 'audit.view']);
  const viewRole = await mkRole('view', ['documents.view']);
  const mk = async (label: string, r: { id: string }) => {
    const u = await prisma.user.create({ data: { email: `s8-${run}-${label}@example.test`, name: `S8 ${label}`, passwordHash: hash } });
    created.users.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });
    return u;
  };
  const admin = await mk('admin', opsRole);
  const viewer = await mk('viewer', viewRole);
  const flagsBefore = await prisma.platformSetting.findUnique({ where: { key: PORTAL_FLAGS_KEY } });

  try {
    const a = client('admin');
    const v = client('admin');
    check('admin logs in', (await a.login(admin.email)).status === 200);
    check('viewer logs in', (await v.login(viewer.email)).status === 200);
    check('admin enrols MFA', await a.enrolMfa());

    console.log('\nQueue metrics (NFR-OPS-007)');
    const h = await a.get('/api/health?deep=1');
    const q = h.body?.queue;
    check('deep health carries queue depth and age', !!q && typeof q.pending === 'number' && typeof q.oldestPendingSeconds === 'number' && typeof q.dead === 'number' && typeof q.liveWorkers === 'number', h.body);
    check('shallow health stays cheap (no queue block)', (await a.get('/api/health')).body?.queue === undefined);
    if (config.metricsToken) {
      const m = await fetch(`${API}/api/internal/metrics`, { headers: { Authorization: `Bearer ${config.metricsToken}` } });
      const text = await m.text();
      check('metrics expose nexus_queue_depth and age gauges', text.includes('nexus_queue_depth{queue="outbox",state="pending"}') && text.includes('nexus_queue_oldest_age_seconds'), text.slice(-400));
    }

    console.log('\nSQL paging with total (NFR-PERF-005)');
    for (const path of [`${V}/clients`, `${V}/cash-accounts`]) {
      const p1 = await a.get(`${path}?page=1&pageSize=1`);
      check(`${path} paged: at most one row, pageSize 1, numeric total`, p1.status === 200 && Array.isArray(p1.body?.data) && p1.body.data.length <= 1 && p1.body.pageSize === 1 && typeof p1.body.total === 'number', p1.body && { status: p1.status, total: p1.body.total, pageSize: p1.body.pageSize });
      const all = await a.get(path);
      check(`${path} unpaged keeps the full list and reports the same total`, all.status === 200 && all.body?.total === p1.body?.total && all.body.data.length === Math.min(all.body.total, 5000), { total: all.body?.total });
      if ((p1.body?.total ?? 0) > 1) {
        const p2 = await a.get(`${path}?page=2&pageSize=1`);
        check(`${path} page 2 differs from page 1`, JSON.stringify(p2.body?.data?.[0]) !== JSON.stringify(p1.body?.data?.[0]));
      }
    }
    const docsPaged = await a.get(`${V}/documents?page=1&pageSize=2`);
    check('staff documents list is paged with total', docsPaged.status === 200 && typeof docsPaged.body?.total === 'number' && docsPaged.body?.pageSize === 2 && docsPaged.body.data.length <= 2, docsPaged.body && { status: docsPaged.status });

    console.log('\nRetention schedules (FR-DOC-017)');
    check('pure matcher: most specific row wins', matchSchedule([{ docType: '*', classification: '*', retentionYears: 5 }, { docType: 'tax', classification: '*', retentionYears: 7 }, { docType: 'tax', classification: 'Restricted', retentionYears: 10 }], 'tax', 'Restricted')?.retentionYears === 10);
    const list0 = await v.get(CO);
    check('viewer can read the schedules', list0.status === 200 && Array.isArray(list0.body?.data));
    const spec = { docType: 'research', classification: 'Restricted', retentionYears: 12, basis: 'S8 test', reason: 'S8 test schedule' };
    check('viewer cannot create -> 403', (await v.post(CO, spec, key('v'))).status === 403);
    check('years below 1 -> 400', (await a.post(CO, { ...spec, retentionYears: 0 }, key('y0'))).status === 400);
    check('unknown type -> 400', (await a.post(CO, { ...spec, docType: 'nonsense' }, key('ut'))).status === 400);
    const c1 = await a.post(CO, spec, key('c1'));
    const sid = c1.body?.schedule?.id as string;
    if (sid) created.schedules.push(sid);
    check('approver creates a schedule -> 201', c1.status === 201 && !!sid, c1.body);
    check('duplicate type and classification -> 409', (await a.post(CO, spec, key('c2'))).status === 409);
    check('create audited with reason', (await prisma.auditEvent.count({ where: { action: 'document.retention_schedule_created', objectId: sid } })) === 1);
    const stale = await a.patch(`${CO}/${sid}`, { retentionYears: 15, version: 99, reason: 'stale write' }, key('p0'));
    check('stale version -> 409', stale.status === 409, stale.body);
    const p = await a.patch(`${CO}/${sid}`, { retentionYears: 15, version: 1, reason: 'Policy raised to 15' }, key('p1'));
    check('edit with the current version -> 200 and version bumps', p.status === 200 && p.body?.schedule?.retentionYears === 15 && p.body.schedule.version === 2, p.body);
    check('edit audited', (await prisma.auditEvent.count({ where: { action: 'document.retention_schedule_updated', objectId: sid } })) === 1);
    check('enforcedRetention raises a lower request and keeps a higher one', (await enforcedRetention('research', 'Restricted', 3)) === 15 && (await enforcedRetention('research', 'Restricted', 20)) === 20);

    const mkDoc = async (n: string, years: number, held = false) => {
      const d = await prisma.document.create({ data: { ref: `S8D${run}${n}`, name: `S8 doc ${n} ${run}`, type: 'research', status: 'Approved', classification: 'Restricted', retentionYears: years, documentDate: new Date('2001-01-01T00:00:00Z') } });
      created.docs.push(d.id);
      if (held) await prisma.documentHold.create({ data: { documentId: d.id, reason: 'S8 hold', placedBy: admin.id } });
      return d;
    };
    const low = await mkDoc('low', 2);
    const high = await mkDoc('high', 40);
    const heldDoc = await mkDoc('held', 2, true);
    const retention = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id } })).retentionYears;
    const dry = await a.post(`${CO}/apply`, { dryRun: true }, key('a0'));
    check('dry run counts raised documents and changes nothing', dry.status === 200 && dry.body?.raised >= 2 && (await retention(low.id)) === 2, dry.body);
    const real = await a.post(`${CO}/apply`, { dryRun: false }, key('a1'));
    check('apply raises the low-retention documents to the schedule', real.status === 200 && (await retention(low.id)) === 15 && (await retention(heldDoc.id)) === 15, real.body);
    check('apply never lowers a longer retention', (await retention(high.id)) === 40);
    check('nothing was deleted', (await prisma.document.count({ where: { id: { in: [low.id, high.id, heldDoc.id] } } })) === 3);
    check('documents dated 2001 are past retention; the one on hold is counted as held', real.body?.eligible >= 1 && real.body?.heldPastRetention >= 1, real.body);
    const ch = await a.post(`${V}/client-ops/vault/documents/${low.id}/changes`, { kind: 'RETENTION', to: 3, reason: 'try to shorten below the schedule' }, key('ch'));
    check('a retention change below the schedule is refused -> 400', ch.status === 400, ch.body);
    const chOk = await a.post(`${V}/client-ops/vault/documents/${low.id}/changes`, { kind: 'RETENTION', to: 20, reason: 'lengthen above the schedule' }, key('ch2'));
    check('a retention change at or above the schedule is accepted -> 201', chOk.status === 201, chOk.body);
    const off = await a.patch(`${CO}/${sid}`, { active: false, version: 2, reason: 'retire the S8 schedule' }, key('p2'));
    check('deactivating a schedule stops enforcement', off.status === 200 && (await enforcedRetention('research', 'Restricted', 3)) !== 15);

    console.log('\nPortal flags and demo mode (S26)');
    const pub = await a.get(`${V}/platform/flags`);
    check('public flags answer with the effective values', pub.status === 200 && !!pub.body?.lp, pub.body);
    check('viewer cannot read the admin flags -> 403', (await v.get(`${V}/platform/flags/admin`)).status === 403);
    const adm = await a.get(`${V}/platform/flags/admin`);
    check('admin reads env, overrides, effective and version', adm.status === 200 && !!adm.body?.env && !!adm.body?.overrides && typeof adm.body.version === 'number', adm.body);
    const ver = adm.body.version as number;
    const putBody = { demoMode: true, lp: {}, investeeLiveActions: null, custodianLive: null, onboardingLive: null, reason: 'S8 demo switch' };
    await prisma.session.updateMany({ where: { userId: admin.id }, data: { mfaVerifiedAt: new Date(Date.now() - 24 * 3600_000) } });
    const noStep = await a.call('PUT', `${V}/platform/flags/admin`, { ...putBody, version: ver }, key('f0'));
    check('PUT without step-up -> 401', noStep.status === 401, noStep.body);
    check('step-up succeeds', (await a.stepUp()).status === 200);
    check('missing reason -> 400', (await a.call('PUT', `${V}/platform/flags/admin`, { ...putBody, reason: '', version: ver }, key('f1'))).status === 400);
    const unknown = await a.call('PUT', `${V}/platform/flags/admin`, { ...putBody, lp: { nope: true }, version: ver }, key('f2'));
    check('unknown domain -> 400', unknown.status === 400, unknown.body);
    const on = await a.call('PUT', `${V}/platform/flags/admin`, { ...putBody, version: ver }, key('f3'));
    check('demo mode on -> 200 and version bumps', on.status === 200 && on.body?.overrides?.demoMode === true && on.body.version === ver + 1, on.body);
    const eff = await a.get(`${V}/platform/flags`);
    check('public flags now show every LP domain as demo', eff.status === 200 && Object.values(eff.body?.lp ?? { x: true }).every((x) => x === false) && eff.body?.custodian?.live === false, eff.body);
    check('stale version -> 409', (await a.call('PUT', `${V}/platform/flags/admin`, { ...putBody, demoMode: false, version: ver }, key('f4'))).status === 409);
    check('no-op change -> 400', (await a.call('PUT', `${V}/platform/flags/admin`, { ...putBody, version: ver + 1 }, key('f5'))).status === 400);
    check('flag change audited', (await prisma.auditEvent.count({ where: { action: 'platform.flags_changed', objectId: PORTAL_FLAGS_KEY, reason: 'S8 demo switch' } })) >= 1);
    check('change history row written', (await prisma.platformSettingChange.count({ where: { key: PORTAL_FLAGS_KEY, reason: 'S8 demo switch' } })) >= 1);
    const off2 = await a.call('PUT', `${V}/platform/flags/admin`, { ...putBody, demoMode: false, reason: 'S8 demo switch off', version: ver + 1 }, key('f6'));
    check('demo mode off restores the environment defaults', off2.status === 200 && JSON.stringify(off2.body?.effective?.lp) === JSON.stringify(off2.body?.env?.lp), off2.body);
    check('pure merge: override beats env, demo forces off', mergeFlags(off2.body.env, normaliseOverrides({ lp: { documents: false } })).lp.documents === false && mergeFlags(off2.body.env, normaliseOverrides({ demoMode: true })).lp.documents === false);
  } finally {
    await prisma.documentChange.deleteMany({ where: { documentId: { in: created.docs } } });
    await prisma.documentHold.deleteMany({ where: { documentId: { in: created.docs } } });
    await prisma.document.deleteMany({ where: { id: { in: created.docs } } });
    await prisma.documentRetentionSchedule.deleteMany({ where: { id: { in: created.schedules } } });
    await prisma.platformSettingChange.deleteMany({ where: { changedBy: { in: created.users } } });
    if (flagsBefore) await prisma.platformSetting.update({ where: { key: PORTAL_FLAGS_KEY }, data: { value: flagsBefore.value as object, version: flagsBefore.version } });
    else await prisma.platformSetting.deleteMany({ where: { key: PORTAL_FLAGS_KEY } });
    await prisma.notification.deleteMany({ where: { userId: { in: created.users } } }).catch(() => undefined);
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch((e) => console.log('  (user cleanup skipped: audit rows reference them)', String(e).slice(0, 80)));
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: created.roles } } });
    await prisma.role.deleteMany({ where: { id: { in: created.roles } } }).catch(() => undefined);
  }

  console.log(failures ? `\n${failures} check(s) FAILED, ${passes} passed` : `\nAll ${passes} S8 checks passed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
