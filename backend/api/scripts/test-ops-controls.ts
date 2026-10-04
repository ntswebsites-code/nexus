/**
 * Package S1 (Operations controls) checks against a RUNNING API:
 *  - FR-OPS-012: `operations.task.manage` gates create, edit, start, complete, block, cancel, reopen and refresh; viewers and
 *    auditors read the runbook and export it, granted additively to operations, fund_accountant and investment_director.
 *  - BR-063: the creator of a control task cannot mark it Done (403 segregation_of_duties); a colleague can.
 *  - FR-OPS-010: completing (or cancelling) a task hands off to the tasks that depended on it: the next owner (or the team)
 *    is notified through the outbox, the dependant is cleared, one audit event per hand-off.
 *  - FR-OPS-011: runbook and calendar export as CSV and XLSX (audited, formula-safe CSV, session required).
 *  - FR-OPS-013: workload click-through filters (owner, area, due day) on the task list.
 *  - Idempotency-Key replay on Start / Complete.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-ops-controls.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API against
 * the same DATABASE_URL. Creates throwaway users and tasks with a random run id; disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Oc-${randomBytes(9).toString('base64url')}`;
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
const key = (label: string) => `oc-${run}-${label}-${randomBytes(4).toString('hex')}`;
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const td = dayStr(0);

interface Res {
  status: number;
  body: any;
  headers: Headers;
}

function client() {
  const origin = config.portalUrls.admin;
  let cookie = '';
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
      /* non-JSON (csv / xlsx) */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    patch: (p: string, b?: unknown, h?: Record<string, string>) => send('PATCH', p, b ?? {}, h),
    login: (email: string) => send('POST', '/api/auth/login', { email, password, portal: 'admin' }),
  };
}
const errCode = (r: Res) => r.body?.error?.code;
const OP = '/api/v1/operations';

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `oc-${run}-${label}@example.test`, name: `OC ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(roleKey)).id } });
    return u;
  };
  const opsU = await mkUser('ops', 'operations');
  const faU = await mkUser('fa', 'fund_accountant');
  const dirU = await mkUser('dir', 'investment_director');
  const audU = await mkUser('aud', 'auditor');
  const pmU = await mkUser('pm', 'portfolio_manager');
  const ops = client();
  const fa = client();
  const dir = client();
  const aud = client();
  const pm = client();
  const anon = client();

  try {
    console.log('\nSign-in and role catalogue');
    for (const [c, u] of [[ops, opsU], [fa, faU], [dir, dirU], [aud, audU], [pm, pmU]] as const) check(`${u.name} signs in`, (await c.login(u.email)).status === 200);
    const grants = async (k: string) => (await prisma.rolePermission.count({ where: { roleId: (await role(k)).id, permission: 'operations.task.manage' } })) === 1;
    check('operations, fund_accountant, investment_director hold operations.task.manage', (await grants('operations')) && (await grants('fund_accountant')) && (await grants('investment_director')));
    check('auditor and portfolio_manager do not', !(await grants('auditor')) && !(await grants('portfolio_manager')));
    check('every role keeps operations.view where it had it', (await prisma.rolePermission.count({ where: { roleId: (await role('auditor')).id, permission: 'operations.view' } })) === 1);

    console.log('\nPermission gating (FR-OPS-012)');
    const body = { area: 'CASH', title: `Chase statement ${run}`, detail: 'Statement missing', dueAt: `${td}T09:00` };
    check('auditor can read the runbook', (await aud.get(`${OP}/tasks`)).status === 200);
    check('portfolio manager can read the runbook', (await pm.get(`${OP}/tasks`)).status === 200);
    check('auditor cannot create a task -> 403', (await aud.post(`${OP}/tasks`, body, { 'Idempotency-Key': key('x') })).status === 403);
    check('portfolio manager (operations.view only) cannot create -> 403', (await pm.post(`${OP}/tasks`, body, { 'Idempotency-Key': key('x') })).status === 403);
    check('auditor cannot refresh the runbook -> 403', (await aud.post(`${OP}/tasks/generate`, {})).status === 403);
    check('anonymous -> 401', (await anon.post(`${OP}/tasks`, body, { 'Idempotency-Key': key('x') })).status === 401);
    const plain = await ops.post(`${OP}/tasks`, body, { 'Idempotency-Key': key('p') });
    check('operations creates a task (201), not a control task', plain.status === 201 && plain.body?.data?.isControl === false, plain.body);
    const pid = plain.body.data.id;
    for (const verb of ['start', 'complete', 'block', 'cancel', 'reopen']) {
      const r = await aud.post(`${OP}/tasks/${pid}/${verb}`, { reason: 'Not allowed for me', note: 'x' });
      check(`auditor ${verb} -> 403`, r.status === 403, r.body);
    }
    check('auditor cannot edit -> 403', (await aud.patch(`${OP}/tasks/${pid}`, { title: 'Changed by auditor', version: plain.body.data.version })).status === 403);
    check('auditor can still comment (operations.view)', (await aud.post(`${OP}/tasks/${pid}/comments`, { body: 'Seen' })).status === 201);

    console.log('\nIdempotency-Key on Start and Complete');
    const sk = key('start');
    const s1 = await ops.post(`${OP}/tasks/${pid}/start`, {}, { 'Idempotency-Key': sk });
    const s2 = await ops.post(`${OP}/tasks/${pid}/start`, {}, { 'Idempotency-Key': sk });
    check('start -> IN_PROGRESS', s1.status === 200 && s1.body?.data?.status === 'IN_PROGRESS', s1.body);
    check('same key replays the start (no second transition, no 409)', s2.status === 200 && s2.headers.get('idempotent-replayed') === 'true', s2.status);
    check('audit has exactly one task_started', (await prisma.auditEvent.count({ where: { action: 'operations.task_started', objectId: pid } })) === 1);
    const ck = key('complete');
    const c1 = await ops.post(`${OP}/tasks/${pid}/complete`, { note: 'Received' }, { 'Idempotency-Key': ck });
    const c2 = await ops.post(`${OP}/tasks/${pid}/complete`, { note: 'Received' }, { 'Idempotency-Key': ck });
    check('a non-control task can be completed by its creator', c1.status === 200 && c1.body?.data?.status === 'DONE', c1.body);
    check('same key replays the complete', c2.status === 200 && c2.headers.get('idempotent-replayed') === 'true');

    console.log('\nControl task: creator cannot complete (BR-063)');
    const ctl = await ops.post(`${OP}/tasks`, { area: 'RISK', title: `Four-eyes check ${run}`, dueAt: `${td}T11:00`, isControl: true }, { 'Idempotency-Key': key('ctl') });
    check('control task created with isControl and creator id', ctl.status === 201 && ctl.body?.data?.isControl === true && ctl.body.data.createdById === opsU.id, ctl.body);
    const self = await ops.post(`${OP}/tasks/${ctl.body.data.id}/complete`, {}, { 'Idempotency-Key': key('self') });
    check('creator completing own control task -> 403 segregation_of_duties', self.status === 403 && errCode(self) === 'segregation_of_duties', self.body);
    check('the task is still open', (await prisma.opsTask.findUniqueOrThrow({ where: { id: ctl.body.data.id } })).status === 'OPEN');
    const other = await fa.post(`${OP}/tasks/${ctl.body.data.id}/complete`, { note: 'Checked independently' }, { 'Idempotency-Key': key('other') });
    check('a colleague completes it', other.status === 200 && other.body?.data?.status === 'DONE' && other.body.data.completedByName === faU.name, other.body);
    const ctl2 = await ops.post(`${OP}/tasks`, { area: 'CLOSE', title: `Second control ${run}`, dueAt: `${td}T12:00`, isControl: true }, { 'Idempotency-Key': key('ctl') });
    const cancelOwn = await ops.post(`${OP}/tasks/${ctl2.body.data.id}/cancel`, { reason: 'No longer needed' }, { 'Idempotency-Key': key('cx') });
    check('the creator may still cancel a control task (cancel is audited, not a sign-off)', cancelOwn.status === 200 && cancelOwn.body?.data?.status === 'CANCELLED', cancelOwn.body);

    console.log('\nHand-off to the next owner (FR-OPS-010)');
    const a = await ops.post(`${OP}/tasks`, { area: 'CASH', title: `Step A ${run}`, dueAt: `${td}T08:00`, ownerId: faU.id }, { 'Idempotency-Key': key('a') });
    const b = await ops.post(`${OP}/tasks`, { area: 'REPORTING', title: `Step B ${run}`, dueAt: `${td}T14:00`, ownerId: dirU.id, dependsOnId: a.body.data.id }, { 'Idempotency-Key': key('b') });
    const c = await ops.post(`${OP}/tasks`, { area: 'REPORTING', title: `Step C ${run}`, dueAt: `${dayStr(3)}T14:00`, dependsOnId: a.body.data.id }, { 'Idempotency-Key': key('c') });
    check('B and C show BLOCKED while A is open', b.body?.data?.state === 'BLOCKED' && c.body?.data?.state === 'BLOCKED', [b.body, c.body]);
    const done = await fa.post(`${OP}/tasks/${a.body.data.id}/complete`, { note: 'Done' }, { 'Idempotency-Key': key('adone') });
    const ho = (done.body?.data?.handOff ?? []) as { ref: string; state: string; notified: string }[];
    check('complete returns the hand-offs', done.status === 200 && ho.length === 2, done.body);
    check('B (owned, due today) is handed to its owner as DUE', ho.some((h) => h.ref === b.body.data.ref && h.state === 'DUE' && h.notified === 'owner'), ho);
    check('C (no owner, due later) is handed to the team as SCHEDULED', ho.some((h) => h.ref === c.body.data.ref && h.state === 'SCHEDULED' && h.notified === 'team'), ho);
    const outbox = await prisma.outboxEvent.findMany({ where: { type: { in: ['notify.users', 'notify.permission'] } }, orderBy: { id: 'desc' }, take: 60 });
    const pay = (ref: string) => outbox.find((o) => (o.payload as any)?.type === 'ops.task_handoff' && String((o.payload as any).title).includes(ref));
    check('B owner notification queued (notify.users to the owner)', o2(pay(b.body.data.ref), 'notify.users', (p) => Array.isArray(p.userIds) && p.userIds.includes(dirU.id)), pay(b.body.data.ref));
    check('C team notification queued (notify.permission operations.task.manage)', o2(pay(c.body.data.ref), 'notify.permission', (p) => p.permission === 'operations.task.manage'), pay(c.body.data.ref));
    check('one task_handoff audit event per dependant', (await prisma.auditEvent.count({ where: { action: 'operations.task_handoff', objectId: { in: [b.body.data.id, c.body.data.id] } } })) === 2);
    const bNow = (await ops.get(`${OP}/tasks/${b.body.data.id}`)).body?.data;
    check('B is no longer BLOCKED in the runbook', bNow?.state === 'DUE', bNow);
    // cancelling a task also clears what waited on it
    const d = await ops.post(`${OP}/tasks`, { area: 'CASH', title: `Step D ${run}`, dueAt: `${td}T08:00` }, { 'Idempotency-Key': key('d') });
    const e = await ops.post(`${OP}/tasks`, { area: 'CASH', title: `Step E ${run}`, dueAt: `${td}T09:00`, ownerId: faU.id, dependsOnId: d.body.data.id }, { 'Idempotency-Key': key('e') });
    const dc = await ops.post(`${OP}/tasks/${d.body.data.id}/cancel`, { reason: 'Replaced by another step' }, { 'Idempotency-Key': key('dc') });
    check('cancelling D hands E off too', dc.status === 200 && dc.body?.data?.handOff?.[0]?.ref === e.body.data.ref, dc.body);

    console.log('\nWorkload click-through filters (FR-OPS-013)');
    const mine = await prisma.opsTask.create({ data: { ref: `OPT-OC${run}`, area: 'SETTLEMENT', title: `Filter probe ${run}`, dueAt: new Date(`${dayStr(2)}T10:00:00Z`), status: 'OPEN', ownerId: pmU.id, createdBy: opsU.id } });
    const byOwner = await ops.get(`${OP}/tasks?ownerId=${pmU.id}`);
    check('ownerId filter lists only that owner', byOwner.status === 200 && byOwner.body.data.length >= 1 && byOwner.body.data.every((t: any) => t.ownerId === pmU.id || t.ownerName?.includes('pm')), byOwner.body?.data?.length);
    check('ownerId=none lists unassigned tasks only', (await ops.get(`${OP}/tasks?ownerId=none`)).body.data.every((t: any) => !t.ownerName));
    const byDay = await ops.get(`${OP}/tasks?dueDate=${dayStr(2)}&area=SETTLEMENT`);
    check('dueDate + area filter returns the probe task', byDay.status === 200 && byDay.body.data.some((t: any) => t.id === mine.id), byDay.body);
    const wl = await ops.get(`${OP}/workload`);
    check('workload carries ownerId and day date for click-through', wl.status === 200 && wl.body.data.byOwner.some((o: any) => o.ownerId === pmU.id) && wl.body.data.dueByDay.every((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)), wl.body);
    check('bad dueDate -> 400', (await ops.get(`${OP}/tasks?dueDate=tomorrow`)).status === 400);

    console.log('\nExports (FR-OPS-011)');
    const evil = await ops.post(`${OP}/tasks`, { area: 'CASH', title: `=HYPERLINK("http://x") ${run}`, dueAt: `${td}T15:00` }, { 'Idempotency-Key': key('evil') });
    check('formula-looking title accepted as data', evil.status === 201, evil.body);
    const csv = await aud.get(`${OP}/tasks?format=csv`);
    check('CSV export for a viewer: text/csv attachment', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') ?? '') && /runbook\.csv/.test(csv.headers.get('content-disposition') ?? ''), csv.status);
    check('CSV header carries the control column and the formula cell is neutralised', typeof csv.body === 'string' && csv.body.split('\n')[0]!.includes('"control"') && csv.body.includes(`"'=HYPERLINK`) && !csv.body.includes(`"=HYPERLINK`), String(csv.body).slice(0, 200));
    const xl = await aud.get(`${OP}/tasks?format=xlsx`);
    check('XLSX export for a viewer: spreadsheetml attachment, zip signature', xl.status === 200 && /spreadsheetml/.test(xl.headers.get('content-type') ?? '') && /runbook\.xlsx/.test(xl.headers.get('content-disposition') ?? '') && typeof xl.body === 'string' && xl.body.startsWith('PK'), xl.status);
    const calCsv = await aud.get(`${OP}/calendar?from=${dayStr(-1)}&to=${dayStr(10)}&format=csv`);
    const calXlsx = await aud.get(`${OP}/calendar?from=${dayStr(-1)}&to=${dayStr(10)}&format=xlsx`);
    check('calendar exports as CSV with its header', calCsv.status === 200 && typeof calCsv.body === 'string' && calCsv.body.startsWith('"date","type","item"'), String(calCsv.body).slice(0, 120));
    check('calendar exports as XLSX', calXlsx.status === 200 && /spreadsheetml/.test(calXlsx.headers.get('content-type') ?? '') && String(calXlsx.body).startsWith('PK'));
    check('calendar JSON still works', (await aud.get(`${OP}/calendar?from=${dayStr(-1)}&to=${dayStr(10)}`)).body?.data?.events !== undefined);
    check('exports need a session (401)', (await anon.get(`${OP}/tasks?format=xlsx`)).status === 401 && (await anon.get(`${OP}/calendar?format=csv`)).status === 401);
    check('export is audited (runbook and calendar)', (await prisma.auditEvent.count({ where: { action: 'operations.runbook_exported', actorId: audU.id } })) >= 2 && (await prisma.auditEvent.count({ where: { action: 'operations.calendar_exported', actorId: audU.id } })) >= 2);
    check('an export with a bad format -> 400', (await aud.get(`${OP}/tasks?format=pdf`)).status === 400);
  } finally {
    console.log('\nCleanup');
    try {
      const ids = (await prisma.opsTask.findMany({ where: { OR: [{ title: { contains: run } }, { createdBy: { in: userIds } }] }, select: { id: true } })).map((t) => t.id);
      await prisma.opsTaskComment.deleteMany({ where: { taskId: { in: ids } } }).catch(() => undefined);
      await prisma.opsTask.updateMany({ where: { id: { in: ids } }, data: { dependsOnId: null } });
      await prisma.opsTask.deleteMany({ where: { id: { in: ids } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => console.log('  (users kept: audit rows reference them)'));
    } catch (e) {
      console.log('  cleanup incomplete:', (e as Error).message);
    }
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
}

function o2(row: { type: string; payload: unknown } | undefined, type: string, pred: (p: any) => boolean) {
  return !!row && row.type === type && pred(row.payload);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
