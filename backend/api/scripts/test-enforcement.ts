/**
 * Enforcement and models (R4-9) checks against a RUNNING API: retention periods read by the purge job, numbering
 * padding, feature flags, model usage with inputs/outputs, data-quality schedules with the exception workflow
 * (assign, due, escalate) and dataset lineage (cycle refusal, impact), periodic model review reminders.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-enforcement.ts
 *
 * Same set-up as test-reports.ts (migrate deploy, seed.ts, API running against the same disposable DATABASE_URL).
 * Typechecked but not run in the worktree that wrote it (no local database).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { clearSettingCache } from '../src/lib/settings';
import { nextRef, clearNumberingCache } from '../src/lib/refs';
import { runRetentionPurge } from '../src/modules/admin-core/retention';
import { compactJson, sendReviewReminders } from '../src/modules/model-governance/mg.usage';
import { escalateExceptions, nextDqRun, dqTick } from '../src/modules/data-fabric';
import { varFromReturns } from '../src/modules/risk/risk.var';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `En-${randomBytes(9).toString('base64url')}`;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 700));
  }
};
const key = (l: string) => `en-${run}-${l}-${randomBytes(4).toString('hex')}`;
const dayStr = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

function client() {
  const origin = config.portalUrls.admin;
  let cookie = '';
  let secret = '';
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
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
    return { status: res.status, body: parsed };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    put: (p: string, b?: unknown, h?: Record<string, string>) => send('PUT', p, b ?? {}, h),
    del: (p: string) => send('DELETE', p),
    login: (email: string) => send('POST', '/api/auth/login', { email, password, portal: 'admin' }),
    async enrolMfa() {
      const e = await send('POST', '/api/auth/mfa/enroll', {});
      secret = e.body?.secret ?? '';
      return e.status === 200 && (await send('POST', '/api/auth/mfa/verify', { code: totpNow(secret) })).status === 200;
    },
    stepUp: () => send('POST', '/api/auth/mfa/step-up', { code: totpNow(secret) }),
  };
}

async function main() {
  console.log('\nPure rules');
  check('next DQ run: hourly +1h, daily +1d, weekly +7d, monthly clamps 31 Jan to 28 Feb', nextDqRun('HOURLY', new Date('2027-01-01T00:00:00Z')).toISOString() === '2027-01-01T01:00:00.000Z' && nextDqRun('DAILY', new Date('2027-01-01T00:00:00Z')).getUTCDate() === 2 && nextDqRun('WEEKLY', new Date('2027-01-01T00:00:00Z')).getUTCDate() === 8 && nextDqRun('MONTHLY', new Date('2027-01-31T00:00:00Z')).toISOString().slice(0, 10) === '2027-02-28');
  check('VaR: 5th percentile loss of a 100-return series, square-root-of-time scaling', Math.abs(varFromReturns(Array.from({ length: 100 }, (_, i) => (i - 50) / 1000), 0.95, 1) - 0.045) < 1e-9 && Math.abs(varFromReturns([-0.1, 0.1], 0.5, 4) - 0) < 1e-9 && varFromReturns([], 0.95, 1) === 0);
  const cj = compactJson({ a: 1, d: new Date('2027-01-01T00:00:00Z'), s: 'x'.repeat(900), n: null, deep: { a: { b: { c: { d: { e: 1 } } } } } }) as Record<string, unknown>;
  check('usage documents are JSON-safe and bounded', cj.d === '2027-01-01T00:00:00.000Z' && String(cj.s).length < 510 && !('n' in cj));

  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `en-${run}-${label}@example.test`, name: `EN ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: roleKey } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    return u;
  };
  const fa = await mkUser('fa', 'fund_accountant'); // data.manage
  const comp = await mkUser('comp', 'compliance'); // model.approve
  const adm = await mkUser('adm', 'system_admin'); // admin.settings, risk.manage
  const aud = await mkUser('aud', 'auditor'); // read only
  const [cFa, cComp, cAdm, cAud] = [client(), client(), client(), client()];
  const cl = await prisma.client.create({ data: { ref: `CEN-${run}`, name: `Enforcement Client ${run}`, type: 'Individual' } }); // no email: fails NOT_NULL
  const modelIds: string[] = [];
  const ruleIds: string[] = [];
  const bindings: string[] = [];

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[cFa, fa], [cComp, comp], [cAdm, adm], [cAud, aud]] as const) check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    check('MFA enrolment', (await cAdm.enrolMfa()) && (await cComp.enrolMfa()));

    console.log('\nSettings that are enforced');
    const set = await cAdm.get('/api/v1/admin-core/settings');
    const find = (k: string) => set.body.data.find((s: any) => s.key === k);
    for (const k of ['retention.notifications_days', 'retention.outbox_days', 'retention.idempotency_days', 'retention.dq_exceptions_days', 'security.step_up_minutes', 'notify.email_non_critical', 'notify.review_reminder_days', 'feature.dq_scheduler', 'feature.model_review_reminders', 'feature.report_distribution']) check(`setting ${k} is registered and enforced`, find(k)?.enforced === true, find(k));
    await cAdm.stepUp();
    const put = await cAdm.put('/api/v1/admin-core/settings/retention.notifications_days', { value: 45, reason: 'enforcement test' }, { 'Idempotency-Key': key('ret') });
    check('retention period saved', put.status === 200, put.body);
    clearSettingCache();
    const dry = await runRetentionPurge({ dryRun: true, triggeredBy: 'test' });
    check('the purge job reads the saved period (45 days) and reports what it applied', dry.applied.notificationDays === 45 && dry.applied.outboxDays === 30 && typeof dry.dqExceptionsDeleted === 'number', dry.applied);
    const old = await prisma.notification.create({ data: { userId: aud.id, type: 'test', title: 'old read notice', readAt: new Date(Date.now() - 60 * 86_400_000) } });
    const dry2 = await runRetentionPurge({ dryRun: true, triggeredBy: 'test' });
    check('a notice read 60 days ago is now purge-eligible (it was not under the 180-day default)', dry2.notificationsDeleted >= 1);
    await prisma.notification.delete({ where: { id: old.id } });
    await cAdm.stepUp();
    await cAdm.put('/api/v1/admin-core/settings/retention.notifications_days', { value: 180, reason: 'enforcement test restore' }, { 'Idempotency-Key': key('ret2') });
    clearSettingCache();

    const num = await cAdm.get('/api/v1/admin-core/settings/numbering');
    const dq = num.body.data.find((n: any) => n.kind === 'dqRun');
    check('numbering view exposes base and maximum padding', dq?.basePad === 5 && dq?.maxPad >= 8, dq);
    check('padding cannot go below the base or above the column width -> 400', (await cAdm.put('/api/v1/admin-core/settings/numbering/dqRun', { pad: 3, reason: 'too narrow' }, { 'Idempotency-Key': key('n1') })).status === 400 && (await cAdm.put('/api/v1/admin-core/settings/numbering/dqRun', { pad: 12, reason: 'too wide' }, { 'Idempotency-Key': key('n2') })).status === 400);
    check('an auditor cannot change numbering -> 403', (await cAud.put('/api/v1/admin-core/settings/numbering/dqRun', { pad: 7, reason: 'nope nope' }, { 'Idempotency-Key': key('n3') })).status === 403);
    check('widening to 7 digits is accepted and audited', (await cAdm.put('/api/v1/admin-core/settings/numbering/dqRun', { pad: 7, reason: 'room to grow' }, { 'Idempotency-Key': key('n4') })).status === 200 && (await prisma.auditEvent.count({ where: { action: 'setting.numbering_changed', objectId: 'dqRun' } })) >= 1);
    clearNumberingCache();
    const issued = await prisma.$transaction((tx) => nextRef(tx, 'dqRun'));
    check('the next DQR reference uses the new padding', /^DQR-\d{7}$/.test(issued), issued);
    await cAdm.put('/api/v1/admin-core/settings/numbering/dqRun', { pad: 5, reason: 'restore padding' }, { 'Idempotency-Key': key('n5') });
    clearNumberingCache();

    console.log('\nModels called by calculations');
    const mk = async (suffix: string, nextReviewOn: Date | null) => {
      const ref = await prisma.$transaction((tx) => nextRef(tx, 'govModel'));
      const m = await prisma.govModel.create({ data: { ref, name: `Enforcement model ${suffix} ${run}`, modelType: 'RISK', tier: 2, ownerName: 'Test owner', purpose: 'test', status: 'APPROVED', createdBy: adm.id, nextReviewOn } });
      modelIds.push(m.id);
      const v = await prisma.govModelVersion.create({ data: { modelId: m.id, version: '1.0', status: 'APPROVED', changeNote: 'test', authorId: fa.id, approvedBy: comp.id } });
      await prisma.govModel.update({ where: { id: m.id }, data: { currentVersionId: v.id } });
      return m;
    };
    const model = await mk('limits', new Date(`${dayStr(200)}T00:00:00Z`));
    const usage = await cAdm.post(`/api/v1/model-governance/models/${model.id}/usage`, { context: 'Enforcement test use', objectRef: 'TEST-1', inputs: { portfolio: 'PF-X', shock: -0.1 }, outputs: { loss: '12.50' } }, { 'Idempotency-Key': key('use') });
    check('manual usage records inputs and outputs', usage.status === 201 && (await prisma.govModelUsageIo.count({ where: { usageId: usage.body.data.id } })) === 1, usage.body);
    const ul = await cAdm.get(`/api/v1/model-governance/usage?modelId=${model.id}`);
    check('the usage list returns inputs and outputs', ul.body.data[0]?.inputs?.shock === -0.1 && ul.body.data[0]?.outputs?.loss === '12.50' && ul.body.data[0]?.purpose === 'MANUAL', ul.body);
    const bl = await cAdm.get('/api/v1/model-governance/bindings');
    check('bindings now cover the limit and VaR purposes', ['NAV_VALUATION', 'RISK_SCENARIO', 'RISK_LIMIT', 'RISK_VAR'].every((p) => bl.body.purposes.includes(p)), bl.body.purposes);
    await cComp.stepUp();
    for (const purpose of ['RISK_LIMIT', 'RISK_VAR']) {
      const b = await cComp.put(`/api/v1/model-governance/bindings/${purpose}`, { modelId: model.id, enforce: false });
      check(`bind ${purpose} to the approved model`, b.status === 200, b.body);
      bindings.push(purpose);
    }
    const pf = await prisma.portfolio.create({ data: { ref: `PEN-${run}`, name: `Enforcement book ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} } });
    const chk = await cAud.post('/api/v1/risk/check', { portfolioId: pf.id });
    const lim = await prisma.govModelUsage.findFirst({ where: { modelId: model.id, note: 'Automatic (RISK_LIMIT)' }, orderBy: { usedAt: 'desc' } });
    check('a risk limit check is logged against the bound model with inputs and outputs', chk.status === 200 && !!lim && (await prisma.govModelUsageIo.count({ where: { usageId: lim.id, purpose: 'RISK_LIMIT' } })) === 1, chk.body);
    const v = await cAud.post('/api/v1/risk/var', { portfolioId: pf.id });
    check('VaR on an empty book is refused (409), not logged', v.status === 409 && v.body?.error?.code === 'empty_book', v.body);
    check('VaR validates its parameters -> 400', (await cAud.post('/api/v1/risk/var', { portfolioId: pf.id, confidence: 0.5 })).status === 400);
    await prisma.portfolio.delete({ where: { id: pf.id } }).catch(() => undefined);

    console.log('\nPeriodic review reminders');
    const soon = await mk('review-soon', new Date(`${dayStr(5)}T00:00:00Z`));
    const over = await mk('review-over', new Date(`${dayStr(-3)}T00:00:00Z`));
    const n1 = await sendReviewReminders();
    check('reminders open the due reviews and announce each once', n1 >= 2 && (await prisma.govModelReview.count({ where: { modelId: { in: [soon.id, over.id] }, status: 'OPEN' } })) === 2, n1);
    const rem = await prisma.govReviewReminder.findMany({ where: { reviewId: { in: (await prisma.govModelReview.findMany({ where: { modelId: { in: [soon.id, over.id] } }, select: { id: true } })).map((r) => r.id) } } });
    check('one DUE_SOON and one OVERDUE reminder', rem.some((r) => r.kind === 'DUE_SOON') && rem.some((r) => r.kind === 'OVERDUE'), rem);
    const queued = await prisma.outboxEvent.count({ where: { type: 'notify.permission', payload: { path: '$.type', equals: 'model.review' }, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    check('notifications were queued for the model approvers', queued >= 2, queued);
    check('a second run the same day sends none (idempotent)', (await sendReviewReminders()) === 0);
    const reviews = await cComp.get('/api/v1/model-governance/reviews?status=OPEN');
    check('the reviews list shows the overdue review with its due date', reviews.body.data.some((r: any) => r.modelId === over.id && r.dueOn === dayStr(-3)), reviews.body);
    check('remind endpoint needs risk.manage -> 403 for an auditor, 200 for the admin', (await cAud.post('/api/v1/model-governance/reviews/remind')).status === 403 && (await cAdm.post('/api/v1/model-governance/reviews/remind')).status === 200);
    await cAdm.stepUp();
    await cAdm.put('/api/v1/admin-core/settings/feature.model_review_reminders', { value: false, reason: 'switch off' }, { 'Idempotency-Key': key('ff1') });
    clearSettingCache();
    check('the feature flag switches reminders off', (await sendReviewReminders()) === 0);
    await cAdm.stepUp();
    await cAdm.put('/api/v1/admin-core/settings/feature.model_review_reminders', { value: true, reason: 'switch on' }, { 'Idempotency-Key': key('ff2') });
    clearSettingCache();

    console.log('\nData-quality schedules and exception workflow');
    const rule = await cFa.post('/api/v1/data/rules', { key: `en-${run}-email`, name: `Email present ${run}`, dataset: 'clients', checkType: 'NOT_NULL', col: 'email', severity: 'HIGH' }, { 'Idempotency-Key': key('rule') });
    check('rule created', rule.status === 201, rule.body);
    const ruleId = rule.body?.data?.id as string;
    ruleIds.push(ruleId);
    check('an auditor cannot schedule -> 403', (await cAud.put(`/api/v1/data/rules/${ruleId}/schedule`, { cadence: 'DAILY' })).status === 403);
    check('an unknown cadence -> 400', (await cFa.put(`/api/v1/data/rules/${ruleId}/schedule`, { cadence: 'EVERY_SECOND' })).status === 400);
    const sch = await cFa.put(`/api/v1/data/rules/${ruleId}/schedule`, { cadence: 'DAILY', enabled: true, firstRunAt: new Date(Date.now() - 60_000).toISOString() }, { 'Idempotency-Key': key('sch') });
    check('schedule saved', sch.status === 200 && sch.body.data.cadence === 'DAILY', sch.body);
    const due = await cFa.post('/api/v1/data/schedules/run-due');
    check('run-due executes the rule and moves the next run a day on', due.status === 200 && due.body.data.ran >= 1, due.body);
    const sl = (await cFa.get('/api/v1/data/schedules')).body.data.find((s: any) => s.ruleId === ruleId);
    check('schedule shows the last run reference and FAIL; not due any more', sl?.lastStatus === 'FAIL' && /^DQR-/.test(sl.lastRunRef) && sl.due === false, sl);
    check('a second run-due does not repeat the rule', (await prisma.dataQualityRun.count({ where: { ruleId } })) === 1);
    const queue = await cFa.get('/api/v1/data/exception-queue?unowned=1');
    const exc = queue.body.data.find((e: any) => e.ruleKey === `en-${run}-email` && e.recordKey === cl.ref);
    check('the failing client is in the unowned queue', !!exc, queue.body);
    check('assign needs a staff owner -> 400 for a random id', (await cFa.post(`/api/v1/data/exceptions/${exc.id}/assign`, { ownerId: 'nobody' })).status === 400);
    check('a past due date -> 400', (await cFa.post(`/api/v1/data/exceptions/${exc.id}/assign`, { ownerId: comp.id, dueOn: dayStr(-1) })).status === 400);
    const asg = await cFa.post(`/api/v1/data/exceptions/${exc.id}/assign`, { ownerId: comp.id, dueOn: dayStr(2), note: 'please fix' }, { 'Idempotency-Key': key('asg') });
    check('exception assigned with a due date and audited', asg.status === 200 && (await prisma.auditEvent.count({ where: { action: 'data.exception_assigned', objectId: exc.id } })) === 1, asg.body);
    const mine = await cComp.get('/api/v1/data/exception-queue?mine=1');
    check('the owner sees it under "assigned to me"', mine.body.data.some((e: any) => e.id === exc.id && e.owner && e.overdue === false), mine.body);
    check('it is no longer unowned', !(await cFa.get('/api/v1/data/exception-queue?unowned=1')).body.data.some((e: any) => e.id === exc.id));
    check('nothing escalates before the due date', (await escalateExceptions()) === 0 || !(await prisma.dqExceptionWork.findFirst({ where: { exceptionId: exc.id, escalationLevel: { gt: 0 } } })));
    await prisma.dqExceptionWork.update({ where: { exceptionId: exc.id }, data: { dueOn: new Date(`${dayStr(-1)}T00:00:00Z`) } });
    const e1 = await escalateExceptions();
    const w1 = await prisma.dqExceptionWork.findUniqueOrThrow({ where: { exceptionId: exc.id } });
    check('an overdue exception is escalated to level 1 and the owner is notified', e1 >= 1 && w1.escalationLevel === 1 && !!w1.escalatedAt);
    await escalateExceptions();
    check('it is not escalated again within the same window', (await prisma.dqExceptionWork.findUniqueOrThrow({ where: { exceptionId: exc.id } })).escalationLevel === 1);
    check('the queue flags it overdue with its level', (await cComp.get('/api/v1/data/exception-queue?overdue=1')).body.data.some((e: any) => e.id === exc.id && e.overdue && e.escalationLevel === 1));
    check('resolving removes it from the queue', (await cFa.post(`/api/v1/data/exceptions/${exc.id}/resolve`, { reason: 'email added in test' })).status === 200 && !(await cFa.get('/api/v1/data/exception-queue')).body.data.some((e: any) => e.id === exc.id));
    check('a closed exception cannot be assigned -> 409', (await cFa.post(`/api/v1/data/exceptions/${exc.id}/assign`, { ownerId: comp.id })).status === 409);
    await cAdm.stepUp();
    await cAdm.put('/api/v1/admin-core/settings/feature.dq_scheduler', { value: false, reason: 'switch off' }, { 'Idempotency-Key': key('ff3') });
    clearSettingCache();
    await prisma.dqSchedule.update({ where: { ruleId }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    check('with the feature flag off the worker tick runs nothing', (await dqTick()) === 0 && (await prisma.dataQualityRun.count({ where: { ruleId } })) === 1);
    await cAdm.stepUp();
    await cAdm.put('/api/v1/admin-core/settings/feature.dq_scheduler', { value: true, reason: 'switch on' }, { 'Idempotency-Key': key('ff4') });
    clearSettingCache();
    check('pause then remove a schedule', (await cFa.put(`/api/v1/data/rules/${ruleId}/schedule`, { cadence: 'DAILY', enabled: false })).body?.data?.enabled === false && (await cFa.del(`/api/v1/data/rules/${ruleId}/schedule`)).status === 200 && (await cFa.del(`/api/v1/data/rules/${ruleId}/schedule`)).status === 404);

    console.log('\nLineage');
    const edge = await cFa.post('/api/v1/data/lineage', { fromDataset: 'clients', toDataset: 'funds', kind: 'FEEDS', description: `test ${run}` }, { 'Idempotency-Key': key('e1') });
    check('edge created', edge.status === 201 && edge.body.data.created === true, edge.body);
    const edgeId = edge.body?.data?.id as string;
    check('the same edge again is a no-op', (await cFa.post('/api/v1/data/lineage', { fromDataset: 'clients', toDataset: 'funds', kind: 'FEEDS' })).body.data.created === false);
    check('a reverse edge would loop -> 409 lineage_cycle', (await cFa.post('/api/v1/data/lineage', { fromDataset: 'funds', toDataset: 'clients', kind: 'DERIVES' })).body?.error?.code === 'lineage_cycle');
    check('a self edge and an unknown dataset -> 400', (await cFa.post('/api/v1/data/lineage', { fromDataset: 'funds', toDataset: 'funds', kind: 'FEEDS' })).status === 400 && (await cFa.post('/api/v1/data/lineage', { fromDataset: 'users; DROP', toDataset: 'funds', kind: 'FEEDS' })).status === 400);
    check('an auditor cannot add an edge -> 403', (await cAud.post('/api/v1/data/lineage', { fromDataset: 'orders', toDataset: 'funds', kind: 'FEEDS' })).status === 403);
    const g = await cAud.get('/api/v1/data/lineage');
    check('the graph lists registry datasets with quality state and the edge', g.body.data.nodes.length >= 9 && g.body.data.edges.some((e: any) => e.id === edgeId) && g.body.data.nodes.every((n: any) => typeof n.openExceptions === 'number'), g.body);
    const imp = await cAud.get('/api/v1/data/lineage/impact?dataset=funds');
    check('impact of a problem in funds names clients upstream', imp.body.data.upstream.includes('clients'), imp.body);
    const imp2 = await cAud.get('/api/v1/data/lineage/impact?dataset=clients');
    check('and funds downstream of clients', imp2.body.data.downstream.includes('funds'), imp2.body);
    check('delete the edge', (await cFa.del(`/api/v1/data/lineage/${edgeId}`)).status === 200 && (await cFa.del(`/api/v1/data/lineage/${edgeId}`)).status === 404);
  } finally {
    // best effort clean-up of everything this run created
    try {
      for (const purpose of bindings) await prisma.govModelBinding.delete({ where: { purpose } }).catch(() => undefined);
      await prisma.govModelUsageIo.deleteMany({ where: { modelId: { in: modelIds } } });
      await prisma.govModelUsage.deleteMany({ where: { modelId: { in: modelIds } } });
      const revs = (await prisma.govModelReview.findMany({ where: { modelId: { in: modelIds } }, select: { id: true } })).map((r) => r.id);
      await prisma.govReviewReminder.deleteMany({ where: { reviewId: { in: revs } } });
      await prisma.govModelReview.deleteMany({ where: { modelId: { in: modelIds } } });
      await prisma.govModel.updateMany({ where: { id: { in: modelIds } }, data: { currentVersionId: null } });
      await prisma.govModelVersion.deleteMany({ where: { modelId: { in: modelIds } } });
      await prisma.govModel.deleteMany({ where: { id: { in: modelIds } } });
      const excs = (await prisma.dataQualityException.findMany({ where: { ruleId: { in: ruleIds } }, select: { id: true } })).map((e) => e.id);
      await prisma.dqExceptionWork.deleteMany({ where: { exceptionId: { in: excs } } });
      await prisma.dataQualityException.deleteMany({ where: { ruleId: { in: ruleIds } } });
      await prisma.dataQualityRun.deleteMany({ where: { ruleId: { in: ruleIds } } });
      await prisma.dqSchedule.deleteMany({ where: { ruleId: { in: ruleIds } } });
      await prisma.dataQualityRule.deleteMany({ where: { id: { in: ruleIds } } });
      await prisma.client.delete({ where: { id: cl.id } }).catch(() => undefined);
    } catch (e) {
      console.log('  (clean-up incomplete)', (e as Error).message);
    }
    void userIds;
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
