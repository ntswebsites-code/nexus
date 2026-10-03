/**
 * Reports & BI, Regulatory Reporting, Data Fabric and Model Governance checks against a RUNNING API: engine maths,
 * permissions, report generation to CSV/JSON/HTML with stored hash and signed download, scheduling, LP distribution,
 * filing maker-checker (evidence, hash lock, step-up, segregation), data-quality rules over live tables with the
 * exceptions list, ingestion profiling, model versions with author/validator/approver separation and the usage gate.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-reports.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` (role catalogue) on a disposable schema first and start the API
 * against the same DATABASE_URL (FILE_ENCRYPTION_KEY set). Creates throwaway users, a fund, a client and rows with a
 * random run id (best-effort removal at the end); disposable DBs only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { nextRunAfter, toCsv } from '../src/modules/reports/reports.engine';
import { canMove, dueDateFor, lastClosedPeriod, payloadHash, periodContaining } from '../src/modules/regulatory/reg.engine';
import { compile, validateRule } from '../src/modules/data-fabric/data.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Rp-${randomBytes(9).toString('base64url')}`;
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
const key = (l: string) => `rp-${run}-${l}-${randomBytes(4).toString('hex')}`;
const dayStr = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
const td = dayStr(0);

interface Res {
  status: number;
  body: any;
}
function client() {
  const origin = config.portalUrls.admin;
  let cookie = '';
  let secret = '';
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, form?: FormData): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (cookie) h.Cookie = cookie;
    let payload: string | FormData | undefined = form;
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
    patch: (p: string, b?: unknown) => send('PATCH', p, b ?? {}),
    upload: (p: string, name: string, content: string) => {
      const fd = new FormData();
      fd.set('file', new Blob([content], { type: 'text/plain' }), name);
      return send('POST', p, undefined, {}, fd);
    },
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
  console.log('\nEngine (pure)');
  check('CSV neutralises a formula cell and quotes commas', toCsv({ title: 't', meta: [], sections: [{ heading: 'h', columns: ['a'], rows: [['=1+1'], ['x,y']] }] }).includes("'=1+1") && toCsv({ title: 't', meta: [], sections: [{ heading: 'h', columns: ['a'], rows: [['x,y']] }] }).includes('"x,y"'));
  check('monthly schedule clamps 31 Jan to 28/29 Feb; quarterly adds three months', nextRunAfter(new Date('2027-01-31'), 'MONTHLY').toISOString().slice(0, 10) === '2027-02-28' && nextRunAfter(new Date('2026-11-15'), 'QUARTERLY').toISOString().slice(0, 10) === '2027-02-15');
  const lq = lastClosedPeriod('QUARTERLY', new Date('2026-10-03'));
  check('last closed quarter of 3 Oct 2026 is Q3; due 30 days after', lq.start.toISOString().slice(0, 10) === '2026-07-01' && lq.end.toISOString().slice(0, 10) === '2026-09-30' && dueDateFor(lq.end, 30).toISOString().slice(0, 10) === '2026-10-30');
  check('annual period containing 2026-05-05 is the calendar year', periodContaining('ANNUAL', new Date('2026-05-05')).end.toISOString().slice(0, 10) === '2026-12-31');
  check('payload hash ignores key order and detects change', payloadHash({ a: 1, b: { c: 2, d: 3 } }) === payloadHash({ b: { d: 3, c: 2 }, a: 1 }) && payloadHash({ a: 1 }) !== payloadHash({ a: 2 }));
  check('filing moves: approve only from IN_REVIEW, submit only from APPROVED', canMove('approve', 'IN_REVIEW') && !canMove('approve', 'DRAFT') && canMove('submit', 'APPROVED') && !canMove('submit', 'IN_REVIEW'));
  check('rule compiler accepts a valid rule and refuses unknown column, dataset and injection', compile({ dataset: 'clients', checkType: 'NOT_NULL', col: 'email' }).failSql.includes('`clients`') && validateRule({ dataset: 'clients', checkType: 'NOT_NULL', col: 'email; DROP TABLE x' }).length === 1 && validateRule({ dataset: 'users', checkType: 'NOT_NULL', col: 'email' }).length === 1);
  check('range needs a numeric column and a bound; freshness needs a date column', validateRule({ dataset: 'clients', checkType: 'RANGE', col: 'email', params: { min: 1 } }).length >= 1 && validateRule({ dataset: 'orders', checkType: 'RANGE', col: 'quantity', params: {} }).length === 1 && validateRule({ dataset: 'funds', checkType: 'FRESHNESS', col: 'name', params: { maxAgeDays: 5 } }).length >= 1);

  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `rp-${run}-${label}@example.test`, name: `RP ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: roleKey } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    return u;
  };
  const fa = await mkUser('fa', 'fund_accountant'); // reports view/create/submit, data.manage (maker)
  const comp = await mkUser('comp', 'compliance'); // reports approve/submit, model.approve, risk.manage (checker, validator)
  const dir = await mkUser('dir', 'investment_director'); // reports.approve, model.approve (second approver)
  const adm = await mkUser('adm', 'system_admin'); // risk.manage, data.manage (model author)
  const aud = await mkUser('aud', 'auditor'); // read only
  const dealer = await mkUser('dealer', 'dealer'); // none of reports.view
  const [cFa, cComp, cDir, cAdm, cAud, cDealer, anon] = [client(), client(), client(), client(), client(), client(), client()];
  const fund = await prisma.fund.create({ data: { ref: `FRP-${run}`, name: `Report Fund ${run}`, shortName: `RF ${run}`, currency: 'USD' } });
  const cl = await prisma.client.create({ data: { ref: `CRP-${run}`, name: `Report Client ${run}`, type: 'Individual' } });
  const dupRef = `DUP-${run}`;
  const cl2 = await prisma.client.create({ data: { ref: `CRQ-${run}`, name: `Report Client B ${run}`, type: 'Individual', registrationRef: dupRef } });
  const cl3 = await prisma.client.create({ data: { ref: `CRR-${run}`, name: `Report Client C ${run}`, type: 'Individual', registrationRef: dupRef, email: `c-${run}@example.test` } });
  await prisma.fundCommitment.create({ data: { clientId: cl.id, fundId: fund.id, commitmentAmount: '1000.00', currency: 'USD', status: 'ACTIVE' } });
  const pf = await prisma.portfolio.create({ data: { ref: `PRP-${run}`, name: `Report Entity ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} } });
  const auditCount = (action: string, objectId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}) } });

  try {
    console.log('\nSign-in and permissions');
    for (const [c, u] of [[cFa, fa], [cComp, comp], [cDir, dir], [cAdm, adm], [cAud, aud], [cDealer, dealer]] as const) check(`${u.email.split('@')[0]!.replace(`rp-${run}-`, '')} signs in`, (await c.login(u.email)).status === 200);
    check('MFA enrolment for the checkers', (await cComp.enrolMfa()) && (await cDir.enrolMfa()) && (await cFa.enrolMfa()));
    for (const p of ['/reports/catalogue', '/regulatory/calendar', '/data/summary', '/model-governance/models']) check(`anonymous ${p} -> 401`, (await anon.get(`/api/v1${p}`)).status === 401);
    check('dealer lacks reports.view -> 403 on reports and regulatory', (await cDealer.get('/api/v1/reports/catalogue')).status === 403 && (await cDealer.get('/api/v1/regulatory/calendar')).status === 403);
    check('auditor reads reports, regulatory, data and models', (await Promise.all(['/reports/runs', '/regulatory/filings', '/data/rules', '/model-governance/models'].map((p) => cAud.get(`/api/v1${p}`)))).every((r) => r.status === 200));

    console.log('\nReports');
    const cat = await cFa.get('/api/v1/reports/catalogue');
    check('catalogue lists the five reports', cat.status === 200 && cat.body.data.length === 5, cat.body);
    check('auditor cannot generate -> 403', (await cAud.post('/api/v1/reports/runs', { key: 'CASH', format: 'CSV' }, { 'Idempotency-Key': key('a') })).status === 403);
    check('unknown parameter -> 400', (await cFa.post('/api/v1/reports/runs', { key: 'CASH', format: 'CSV', params: { bogus: 1 } }, { 'Idempotency-Key': key('b') })).status === 400);
    check('transactions needs a date range -> 400', (await cFa.post('/api/v1/reports/runs', { key: 'TRANSACTIONS', params: {} }, { 'Idempotency-Key': key('c') })).status === 400);
    const k1 = key('cash');
    const cash = await cFa.post('/api/v1/reports/runs', { key: 'CASH', format: 'CSV', params: { portfolioId: pf.ref } }, { 'Idempotency-Key': k1 });
    check('cash report COMPLETED, RPT-#####, hash stored, portfolio ref resolved to id', cash.status === 201 && /^RPT-\d{5}$/.test(cash.body.data.ref) && cash.body.data.status === 'COMPLETED' && cash.body.data.sha256?.length === 64 && cash.body.data.params.portfolioId === pf.id, cash.body);
    check('same Idempotency-Key replays the same run', (await cFa.post('/api/v1/reports/runs', { key: 'CASH', format: 'CSV', params: { portfolioId: pf.ref } }, { 'Idempotency-Key': k1 })).body?.data?.id === cash.body.data.id);
    const link = await cFa.get(`/api/v1/reports/runs/${cash.body.data.id}/link`);
    const dl = link.status === 200 ? await fetch(link.body.data.url) : null;
    const dlBuf = dl ? Buffer.from(await dl.arrayBuffer()) : Buffer.alloc(0);
    check('signed download returns the stored bytes (hash matches) and is CSV', !!dl && dl.status === 200 && createHash('sha256').update(dlBuf).digest('hex') === cash.body.data.sha256 && dlBuf.toString().startsWith('Cash report'), link.body);
    for (const [k, params] of [['HOLDINGS', { portfolioId: pf.id }], ['NAV_PACK', { portfolioId: pf.id, from: dayStr(-30), to: td }], ['TRANSACTIONS', { from: dayStr(-30), to: td }], ['FACT_SHEET', { fundId: fund.ref }]] as const) {
      for (const f of ['JSON', 'HTML'] as const) {
        const r = await cFa.post('/api/v1/reports/runs', { key: k, format: f, params }, { 'Idempotency-Key': key(`${k}${f}`) });
        check(`${k} as ${f} completes`, r.status === 201 && r.body.data.status === 'COMPLETED' && r.body.data.format === f, r.body);
      }
    }
    const html = await fetch((await cFa.get(`/api/v1/reports/runs/${(await cFa.get('/api/v1/reports/runs?report=FACT_SHEET&limit=1')).body.data[0].id}/link`)).body.data.url).then((r) => r.text());
    check('HTML output is print-ready, escaped and names the fund', html.startsWith('<!doctype html>') && html.includes(`Report Fund`.slice(0, 6)) && !html.includes('<script'));
    const fs = (await cFa.get('/api/v1/reports/runs?report=FACT_SHEET&format=HTML')).body.data.find((r: any) => r.format === 'HTML');
    check('the preparer cannot distribute (needs reports.approve) -> 403', (await cFa.post(`/api/v1/reports/runs/${fs.id}/distribute`)).status === 403);
    await prisma.session.updateMany({ where: { userId: comp.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } }); // enrolment/earlier step-up counts as fresh; age it
    check('distribute without step-up -> 401', (await cComp.post(`/api/v1/reports/runs/${fs.id}/distribute`)).body?.error?.code === 'step_up_required');
    await cComp.stepUp();
    const dist = await cComp.post(`/api/v1/reports/runs/${fs.id}/distribute`);
    const pubs = await prisma.publication.count({ where: { clientId: cl.id, document: { fundId: fund.id, sourceRefId: fs.id } } });
    check('fact sheet distributed: Documents row published to the investor with an active commitment', dist.status === 200 && dist.body.data.investors === 1 && pubs === 1, dist.body);
    check('a second distribution -> 409 already_distributed', (await cComp.post(`/api/v1/reports/runs/${fs.id}/distribute`)).body?.error?.code === 'already_distributed');
    const cashRun = cash.body.data;
    check('a cash report cannot go to the LP portal -> 400', (await cComp.post(`/api/v1/reports/runs/${cashRun.id}/distribute`)).status === 400);
    check('audit reports.run_generated and reports.run_distributed', (await auditCount('reports.run_generated', cashRun.id)) === 1 && (await auditCount('reports.run_distributed', fs.id)) === 1);
    const sch = await cFa.post('/api/v1/reports/schedules', { key: 'HOLDINGS', name: `Holdings ${run}`, params: { portfolioId: pf.id }, format: 'CSV', frequency: 'WEEKLY', firstRunOn: td }, { 'Idempotency-Key': key('sch') });
    check('schedule created with next run today', sch.status === 201 && sch.body.data.nextRunOn === td, sch.body);
    check('a past first run date -> 400', (await cFa.post('/api/v1/reports/schedules', { key: 'CASH', name: 'Past one', params: {}, frequency: 'DAILY', firstRunOn: dayStr(-2) }, { 'Idempotency-Key': key('sch2') })).status === 400);
    const due = await cFa.post('/api/v1/reports/schedules/run-due');
    const after = (await cFa.get('/api/v1/reports/schedules')).body.data.find((s: any) => s.id === sch.body.data.id);
    check('run-due generates the report and advances the schedule by a week', due.body.data.ran >= 1 && after.nextRunOn === dayStr(7) && after.lastRunId, { due: due.body, after });
    check('a second run-due does not repeat it', (await cFa.post('/api/v1/reports/schedules/run-due')).body.data.ran === 0 || (await prisma.reportRun.count({ where: { scheduleId: sch.body.data.id } })) === 1);
    check('pause a schedule', (await cFa.patch(`/api/v1/reports/schedules/${sch.body.data.id}`, { active: false })).body?.data?.active === false);

    console.log('\nRegulatory');
    check('four templates', (await cFa.get('/api/v1/regulatory/templates')).body.data.length === 4);
    const gen = await cFa.post('/api/v1/regulatory/calendar/generate');
    check('calendar generate opens filings; a repeat opens none', gen.status === 201 && (await cFa.post('/api/v1/regulatory/calendar/generate')).body.data.count === 0, gen.body);
    const f1 = await cFa.post('/api/v1/regulatory/filings', { templateKey: 'FIU_KYC_RISK', periodEnd: dayStr(-120) }, { 'Idempotency-Key': key('f1') });
    check('filing created and populated from live data (figures present)', f1.status === 201 && f1.body.data.status === 'DRAFT' && f1.body.data.payload?.figures?.length >= 4 && /^REG-\d{5}$/.test(f1.body.data.ref), f1.body);
    check('duplicate period -> 409', (await cFa.post('/api/v1/regulatory/filings', { templateKey: 'FIU_KYC_RISK', periodEnd: dayStr(-120) }, { 'Idempotency-Key': key('f1b') })).body?.error?.code === 'duplicate_filing');
    const F = f1.body.data;
    check('review without evidence -> 409 evidence_required', (await cFa.post(`/api/v1/regulatory/filings/${F.id}/submit-review`)).body?.error?.code === 'evidence_required');
    const ev = await cFa.upload(`/api/v1/regulatory/filings/${F.id}/evidence`, 'screening-log.txt', 'evidence');
    check('evidence attached with hash', ev.status === 201 && ev.body.data.sha256?.length === 64, ev.body);
    check('auditor cannot send for review -> 403', (await cAud.post(`/api/v1/regulatory/filings/${F.id}/submit-review`)).status === 403);
    check('send for review -> IN_REVIEW with locked hash', (await cFa.post(`/api/v1/regulatory/filings/${F.id}/submit-review`)).body?.data?.payloadSha256?.length === 64);
    check('evidence cannot change in review -> 409', (await cFa.upload(`/api/v1/regulatory/filings/${F.id}/evidence`, 'late.txt', 'x')).status === 409);
    check('the preparer cannot approve (no reports.approve) -> 403', (await cFa.post(`/api/v1/regulatory/filings/${F.id}/approve`)).status === 403);
    await prisma.session.updateMany({ where: { userId: comp.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } }); // enrolment/earlier step-up counts as fresh; age it
    check('approve without step-up -> 401', (await cComp.post(`/api/v1/regulatory/filings/${F.id}/approve`)).body?.error?.code === 'step_up_required');
    await cComp.stepUp();
    check('return needs a reason -> 400', (await cComp.post(`/api/v1/regulatory/filings/${F.id}/return`, {})).status === 400);
    check('return -> RETURNED with the reason', (await cComp.post(`/api/v1/regulatory/filings/${F.id}/return`, { reason: 'Add the sanctions log' })).body?.data?.status === 'RETURNED');
    check('rebuild and resend', (await cFa.post(`/api/v1/regulatory/filings/${F.id}/populate`)).status === 200 && (await cFa.post(`/api/v1/regulatory/filings/${F.id}/submit-review`)).body?.data?.status === 'IN_REVIEW');
    const ap = await cComp.post(`/api/v1/regulatory/filings/${F.id}/approve`);
    check('a different person approves -> APPROVED', ap.status === 200 && ap.body.data.status === 'APPROVED' && ap.body.data.approvedBy === 'RP comp', ap.body);
    check('submit needs a regulator reference -> 400', (await cComp.post(`/api/v1/regulatory/filings/${F.id}/submit`, {})).status === 400);
    await cFa.stepUp();
    check('the preparer cannot submit own filing -> 403 sod', (await cFa.post(`/api/v1/regulatory/filings/${F.id}/submit`, { submissionRef: 'ACK-1' })).body?.error?.code === 'sod_violation');
    const sub = await cComp.post(`/api/v1/regulatory/filings/${F.id}/submit`, { submissionRef: `ACK-${run}` });
    check('submitted by another person with the regulator reference', sub.status === 200 && sub.body.data.status === 'SUBMITTED' && sub.body.data.submissionRef === `ACK-${run}`, sub.body);
    check('a submitted filing cannot be rebuilt or waived -> 409', (await cFa.post(`/api/v1/regulatory/filings/${F.id}/populate`)).status === 409 && (await cComp.post(`/api/v1/regulatory/filings/${F.id}/waive`, { reason: 'Changed my mind' })).status === 409);
    check('CSV export has the period and figures', (await cFa.get(`/api/v1/regulatory/filings/${F.id}/export`)).body.data.csv.includes('Active clients'));
    check('audit trail on the filing: created, review, approve, return, submit', (await prisma.auditEvent.count({ where: { objectType: 'reg_filing', objectId: F.id } })) >= 8);
    // hash lock
    const f2 = (await cFa.post('/api/v1/regulatory/filings', { templateKey: 'FIU_CTR', periodEnd: dayStr(-100) }, { 'Idempotency-Key': key('f2') })).body.data;
    await cFa.upload(`/api/v1/regulatory/filings/${f2.id}/evidence`, 'ev.txt', 'evidence');
    await cFa.post(`/api/v1/regulatory/filings/${f2.id}/submit-review`);
    await prisma.regFiling.update({ where: { id: f2.id }, data: { payload: { ...(f2.payload as object), tampered: true } } });
    await cComp.stepUp();
    check('figures changed after review -> approval refused 409 payload_changed', (await cComp.post(`/api/v1/regulatory/filings/${f2.id}/approve`)).body?.error?.code === 'payload_changed');
    const cal = await cFa.get('/api/v1/regulatory/calendar');
    check('calendar shows counts and derived OVERDUE for past-due open filings', cal.status === 200 && cal.body.counts.overdue >= 1 && cal.body.data.some((x: any) => x.effectiveStatus === 'OVERDUE'), cal.body.counts);

    console.log('\nData Fabric');
    const ds = await cFa.get('/api/v1/data/datasets');
    check('datasets registry with live row counts', ds.status === 200 && ds.body.data.length >= 9 && ds.body.data.find((d: any) => d.key === 'clients').rows === (await prisma.client.count()), ds.body.data?.map((d: any) => [d.key, d.rows]));
    check('auditor cannot register a source -> 403', (await cAud.post('/api/v1/data/sources', { key: `x-${run}`, name: 'X source', kind: 'MANUAL', system: 'x', owner: 'x' }, { 'Idempotency-Key': key('s0') })).status === 403);
    check('table source without dataset -> 400', (await cFa.post('/api/v1/data/sources', { key: `t-${run}`, name: 'Table source', kind: 'TABLE', system: 'db', owner: 'ops' }, { 'Idempotency-Key': key('s1') })).status === 400);
    const src = await cFa.post('/api/v1/data/sources', { key: `clients-${run}`, name: `Clients ${run}`, kind: 'TABLE', dataset: 'clients', system: 'db', owner: 'ops' }, { 'Idempotency-Key': key('s2') });
    check('table source registered', src.status === 201, src.body);
    const ing = await cFa.post(`/api/v1/data/sources/${src.body.data.id}/ingest`, {}, { 'Idempotency-Key': key('i1') });
    const liveCount = await prisma.client.count({ where: { archivedAt: null } });
    check('profiling job reads the live row count and newest record', ing.status === 201 && ing.body.data.status === 'SUCCEEDED' && Math.abs(ing.body.data.rowsRead - liveCount) <= 5 && !!ing.body.data.latestRecordAt && /^JOB-\d{5}$/.test(ing.body.data.ref), ing.body);
    const feed = await cFa.post('/api/v1/data/sources', { key: `feed-${run}`, name: `Feed ${run}`, kind: 'FILE_FEED', system: 'sftp', owner: 'ops' }, { 'Idempotency-Key': key('s3') });
    check('a feed run needs row counts -> 400, then records', (await cFa.post(`/api/v1/data/sources/${feed.body.data.id}/ingest`, {}, { 'Idempotency-Key': key('i2') })).status === 400 && (await cFa.post(`/api/v1/data/sources/${feed.body.data.id}/ingest`, { rowsRead: 100, rowsRejected: 2 }, { 'Idempotency-Key': key('i3') })).body?.data?.rowsRejected === 2);
    check('a failed feed run marks the source ERROR; a paused source refuses jobs', (await cFa.post(`/api/v1/data/sources/${feed.body.data.id}/ingest`, { status: 'FAILED', error: 'Timeout' }, { 'Idempotency-Key': key('i4') })).body?.data?.status === 'FAILED' && (await cFa.get('/api/v1/data/sources')).body.data.find((s: any) => s.key === `feed-${run}`).status === 'ERROR');
    const bad = await cFa.post('/api/v1/data/rules', { key: `bad-${run}`, name: 'Bad rule here', dataset: 'clients', checkType: 'NOT_NULL', col: 'email; DROP TABLE clients' }, { 'Idempotency-Key': key('r0') });
    check('rule with an unknown column (injection attempt) -> 400', bad.status === 400);
    const rEmail = (await cFa.post('/api/v1/data/rules', { key: `email-${run}`, name: `Email present ${run}`, dataset: 'clients', checkType: 'NOT_NULL', col: 'email', severity: 'HIGH', sourceKey: `clients-${run}` }, { 'Idempotency-Key': key('r1') })).body.data;
    const rUniq = (await cFa.post('/api/v1/data/rules', { key: `uniq-${run}`, name: `Registration unique ${run}`, dataset: 'clients', checkType: 'UNIQUE', col: 'registration_ref' }, { 'Idempotency-Key': key('r2') })).body.data;
    const rFresh = (await cFa.post('/api/v1/data/rules', { key: `fresh-${run}`, name: `Clients touched lately ${run}`, dataset: 'clients', checkType: 'FRESHNESS', col: 'updated_at', params: { maxAgeDays: 3650 } }, { 'Idempotency-Key': key('r3') })).body.data;
    const rRange = (await cFa.post('/api/v1/data/rules', { key: `range-${run}`, name: `Quantity positive ${run}`, dataset: 'orders', checkType: 'RANGE', col: 'quantity', params: { min: 0.000001 } }, { 'Idempotency-Key': key('r4') })).body.data;
    const rOrph = (await cFa.post('/api/v1/data/rules', { key: `orph-${run}`, name: `Orders have portfolio ${run}`, dataset: 'orders', checkType: 'ORPHAN', col: 'portfolio_id', params: { relation: 'portfolio' } }, { 'Idempotency-Key': key('r5') })).body.data;
    check('five rules created over whitelisted datasets', [rEmail, rUniq, rFresh, rRange, rOrph].every((r) => r?.id));
    check('auditor cannot run a rule -> 403', (await cAud.post(`/api/v1/data/rules/${rEmail.id}/run`)).status === 403);
    const run1 = await cFa.post(`/api/v1/data/rules/${rEmail.id}/run`);
    check('NOT_NULL fails on the client without an email', run1.status === 201 && run1.body.data.status === 'FAIL' && run1.body.data.failures >= 2, run1.body);
    const exc = (await cFa.get(`/api/v1/data/exceptions?status=OPEN&dataset=clients&severity=HIGH&limit=200`)).body;
    const mine = exc.data.find((e: any) => e.recordKey === `CRP-${run}` && e.ruleKey === `email-${run}`);
    check('the exceptions list names the failing record', !!mine, exc.data?.slice(0, 3));
    check('UNIQUE finds the duplicate registration reference', (await cFa.post(`/api/v1/data/rules/${rUniq.id}/run`)).body?.data?.failures === 2);
    check('FRESHNESS, RANGE and ORPHAN execute without error', (await Promise.all([rFresh, rRange, rOrph].map((r) => cFa.post(`/api/v1/data/rules/${r.id}/run`)))).every((r) => r.status === 201 && r.body.data.status !== 'ERROR'));
    check('acknowledge, then resolve needs a reason', (await cFa.post(`/api/v1/data/exceptions/${mine.id}/acknowledge`)).status === 200 && (await cFa.post(`/api/v1/data/exceptions/${mine.id}/resolve`, {})).status === 400);
    check('waive with a reason', (await cFa.post(`/api/v1/data/exceptions/${mine.id}/waive`, { reason: 'Test client has no email' })).body?.data?.status === 'WAIVED');
    check('a waived exception cannot be resolved -> 409', (await cFa.post(`/api/v1/data/exceptions/${mine.id}/resolve`, { reason: 'Fixed later on' })).status === 409);
    await prisma.client.update({ where: { id: cl.id }, data: { email: `cl-${run}@example.test` } });
    await prisma.client.update({ where: { id: cl2.id }, data: { email: `cl2-${run}@example.test`, registrationRef: `U2-${run}` } });
    const run2 = await cFa.post(`/api/v1/data/rules/${rEmail.id}/run`);
    const stillOpen = (await cFa.get(`/api/v1/data/exceptions?status=OPEN,ACKNOWLEDGED,WAIVED&limit=200`)).body.data.filter((e: any) => e.ruleKey === `email-${run}` && [`CRP-${run}`, `CRQ-${run}`].includes(e.recordKey));
    check('after the data is fixed the next run clears those exceptions', run2.body.data.status === 'FAIL' || run2.body.data.status === 'PASS', run2.body);
    check('fixed records no longer appear as open or waived', stillOpen.length === 0, stillOpen);
    const all = await cFa.post('/api/v1/data/runs/run-all');
    check('run-all executes every active rule', all.status === 201 && all.body.data.length >= 5, all.body);
    const sum = (await cFa.get('/api/v1/data/summary')).body.data;
    check('summary counts sources, rules and open exceptions', sum.activeRules >= 5 && typeof sum.openExceptions === 'number' && sum.sources.ACTIVE >= 1, sum);
    check('audit data.rule_run and data.ingestion_succeeded', (await auditCount('data.rule_run', rEmail.id)) >= 2 && (await auditCount('data.ingestion_succeeded', src.body.data.id)) === 1);

    console.log('\nModel governance');
    const mb = { name: `Pricing model ${run}`, purpose: 'Prices unlisted holdings from comparable multiples.', modelType: 'PRICING', tier: 1, ownerName: 'Fund Accounting' };
    check('analyst-style role without risk.manage cannot register -> 403', (await cFa.post('/api/v1/model-governance/models', mb, { 'Idempotency-Key': key('m0') })).status === 403);
    const mc = await cAdm.post('/api/v1/model-governance/models', mb, { 'Idempotency-Key': key('m1') });
    const M = mc.body.data;
    check('model registered as DRAFT MDL-#### with version 1.0 drafted', mc.status === 201 && /^MDL-\d{4}$/.test(M.ref) && M.status === 'DRAFT' && M.versions === 1, mc.body);
    check('duplicate name -> 409', (await cAdm.post('/api/v1/model-governance/models', mb, { 'Idempotency-Key': key('m1b') })).body?.error?.code === 'duplicate_model');
    check('usage before approval -> 409 model_not_approved', (await cAdm.post(`/api/v1/model-governance/models/${M.id}/usage`, { context: 'NAV pricing' })).body?.error?.code === 'model_not_approved');
    const det = (await cAdm.get(`/api/v1/model-governance/models/${M.id}`)).body.data;
    const v1 = det.versionList[0];
    check('only the author can submit', (await cComp.post(`/api/v1/model-governance/versions/${v1.id}/submit`)).status === 403 && (await cAdm.post(`/api/v1/model-governance/versions/${v1.id}/submit`)).status === 200);
    check('validation needs scope; findings required unless PASS', (await cComp.post(`/api/v1/model-governance/versions/${v1.id}/validations`, { outcome: 'PASS_WITH_FINDINGS', scope: 'Back-test of 24 months' }, { 'Idempotency-Key': key('v0') })).status === 400);
    check('the author cannot validate -> 403', (await cAdm.post(`/api/v1/model-governance/versions/${v1.id}/validations`, { outcome: 'PASS', scope: 'Back-test of 24 months' }, { 'Idempotency-Key': key('v1') })).status === 403);
    const val = await cComp.post(`/api/v1/model-governance/versions/${v1.id}/validations`, { outcome: 'PASS', scope: 'Back-test of 24 months', evidenceRef: 'VAL-2026-07' }, { 'Idempotency-Key': key('v2') });
    check('independent validation -> version VALIDATED', val.status === 201 && val.body.data.versionStatus === 'VALIDATED', val.body);
    await cComp.stepUp();
    check('the validator cannot also approve -> 403 sod', (await cComp.post(`/api/v1/model-governance/versions/${v1.id}/approve`)).body?.error?.code === 'sod_violation');
    await prisma.session.updateMany({ where: { userId: dir.id }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } }); // enrolment/earlier step-up counts as fresh; age it
    check('approve without step-up -> 401', (await cDir.post(`/api/v1/model-governance/versions/${v1.id}/approve`)).body?.error?.code === 'step_up_required');
    await cDir.stepUp();
    const apv = await cDir.post(`/api/v1/model-governance/versions/${v1.id}/approve`);
    check('a third person approves -> model APPROVED with current version 1.0', apv.status === 200 && apv.body.data.status === 'APPROVED' && apv.body.data.currentVersion === '1.0' && !!apv.body.data.nextReviewOn, apv.body);
    const use = await cAdm.post(`/api/v1/model-governance/models/${M.id}/usage`, { context: 'NAV pricing for the June close', objectRef: 'NAV-00012' });
    check('usage logged against the approved version', use.status === 201 && use.body.data.version === '1.0', use.body);
    check('the usage log lists it and the model counts one use', (await cAud.get(`/api/v1/model-governance/usage?modelId=${M.id}`)).body.total === 1 && (await cAud.get('/api/v1/model-governance/models')).body.data.find((m: any) => m.id === M.id).usageCount === 1);
    check('a read-only user cannot log usage -> 403', (await cAud.post(`/api/v1/model-governance/models/${M.id}/usage`, { context: 'NAV pricing' })).status === 403);
    const v11 = await cAdm.post(`/api/v1/model-governance/models/${M.id}/versions`, { version: '1.1', changeNote: 'Add a liquidity discount' }, { 'Idempotency-Key': key('mv') });
    check('new version drafted; a second in-flight draft -> 409', v11.status === 201 && (await cAdm.post(`/api/v1/model-governance/models/${M.id}/versions`, { version: '1.2', changeNote: 'Another change' }, { 'Idempotency-Key': key('mv2') })).body?.error?.code === 'version_in_flight');
    check('a draft version cannot be used -> 409 version_not_approved', (await cAdm.post(`/api/v1/model-governance/models/${M.id}/usage`, { context: 'Trial', versionId: v11.body.data.id })).body?.error?.code === 'version_not_approved');
    await cAdm.post(`/api/v1/model-governance/versions/${v11.body.data.id}/submit`);
    const fail = await cComp.post(`/api/v1/model-governance/versions/${v11.body.data.id}/validations`, { outcome: 'FAIL', scope: 'Back-test of 12 months', findings: 'Discount is not supported by the data' }, { 'Idempotency-Key': key('v3') });
    check('a failed validation rejects the version; the approved one stays current', fail.body?.data?.versionStatus === 'REJECTED' && (await cAdm.get(`/api/v1/model-governance/models/${M.id}`)).body.data.currentVersion === '1.0');
    check('retire needs step-up and a reason', (await cDir.post(`/api/v1/model-governance/models/${M.id}/retire`, {})).status === 400);
    const ret = await cDir.post(`/api/v1/model-governance/models/${M.id}/retire`, { reason: 'Replaced by the vendor curve' });
    check('retired model -> RETIRED and unusable', ret.body?.data?.status === 'RETIRED' && (await cAdm.post(`/api/v1/model-governance/models/${M.id}/usage`, { context: 'NAV pricing' })).body?.error?.code === 'model_not_approved');
    check('audit trail on the model includes approval and use', (await prisma.auditEvent.count({ where: { objectType: 'gov_model', objectId: M.id, action: { in: ['model.version_approved', 'model.used', 'model.validation_recorded', 'model.retired'] } } })) >= 4);
    check('summary reports counts', (await cAud.get('/api/v1/model-governance/summary')).body.data.byStatus.RETIRED >= 1);
  } finally {
    console.log(`\n${passes} passed, ${failures} failed`);
    try {
      await prisma.reportSchedule.deleteMany({ where: { createdBy: { in: userIds } } });
      await prisma.fundCommitment.deleteMany({ where: { fundId: fund.id } });
      await prisma.client.deleteMany({ where: { id: { in: [cl.id, cl2.id, cl3.id] } } });
      await prisma.portfolio.deleteMany({ where: { id: pf.id } });
    } catch (e) {
      console.log('  (cleanup skipped:', e instanceof Error ? e.message : e, ')');
    }
    await prisma.$disconnect();
    process.exit(failures ? 1 : 0);
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
