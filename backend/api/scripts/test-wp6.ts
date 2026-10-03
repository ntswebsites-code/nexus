/**
 * WP-6 checks (reports PDF and rolling schedules, data-fabric file feeds and cross-table rules, model reviews and
 * bindings used by NAV and risk, configurable KYC risk factors, client change requests, vault disposal and PM evidence
 * files). The first block is pure and needs nothing; the rest runs against a RUNNING API on a disposable DB.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-wp6.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` first. Creates throwaway users and rows tagged with a random run id.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { applyRolling, rollingRange, toCsv } from '../src/modules/reports/reports.engine';
import { renderReportPdf } from '../src/modules/reports/pdf';
import { COMPARE_OPS, compile, validateRule } from '../src/modules/data-fabric/data.engine';
import { evalFeedRule, feedCols, ingestCsv, parseCsv, validateSchema, type FeedSchema } from '../src/modules/data-fabric/data.feed';
import { defaultRiskConfig, documentChangeProblem, ratingFor, scoreRisk } from '../src/modules/clients-onboarding/co.engine';
import { addMonths } from '../src/modules/model-governance/mg.usage';

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

function pure() {
  console.log('\nPure: rolling windows, PDF, feeds, rules, risk config');
  const now = new Date('2026-10-03T10:00:00Z');
  check('PREVIOUS_MONTH of 3 Oct is September', JSON.stringify(rollingRange('PREVIOUS_MONTH', now)) === JSON.stringify({ from: '2026-09-01', to: '2026-09-30' }));
  check('PREVIOUS_QUARTER of Q4 is Q3; QUARTER_TO_DATE starts 1 Oct', rollingRange('PREVIOUS_QUARTER', now).from === '2026-07-01' && rollingRange('PREVIOUS_QUARTER', now).to === '2026-09-30' && rollingRange('QUARTER_TO_DATE', now).from === '2026-10-01');
  check('PREVIOUS_QUARTER across a year end (Jan) is Q4 of last year', rollingRange('PREVIOUS_QUARTER', new Date('2027-01-15T00:00:00Z')).from === '2026-10-01' && rollingRange('PREVIOUS_MONTH', new Date('2027-01-15T00:00:00Z')).from === '2026-12-01');
  check('TRAILING_30D is 30 inclusive days', rollingRange('TRAILING_30D', now).from === '2026-09-04');
  const a = applyRolling('TRANSACTIONS', { portfolioId: 'x', from: '2020-01-01', to: '2020-01-31' }, 'PREVIOUS_MONTH', now);
  const b = applyRolling('TRANSACTIONS', { portfolioId: 'x', from: '2020-01-01', to: '2020-01-31' }, 'PREVIOUS_MONTH', new Date('2026-11-03T10:00:00Z'));
  check('a rolling schedule re-dates from/to each run (no fixed dates repeated)', a.from === '2026-09-01' && b.from === '2026-10-01' && b.to === '2026-10-31' && a.portfolioId === 'x');
  check('point-in-time reports get asOf = window end', applyRolling('CASH', {}, 'PREVIOUS_DAY', now).asOf === '2026-10-02');
  const pdf = renderReportPdf(
    { title: 'Test (report)', meta: [['Portfolio', 'PF-1']], sections: [{ heading: 'Rows', columns: ['A', 'Amount'], rows: Array.from({ length: 180 }, (_, i) => [`row ${i} é`, i * 1.5]) }, { heading: 'Empty', columns: ['x'], rows: [] }], notes: ['n'] },
    now,
  );
  const txt = pdf.toString('latin1');
  check('PDF has a header, xref and EOF, and paginates 180 rows', txt.startsWith('%PDF-1.4') && txt.includes('%%EOF') && txt.includes('startxref') && (txt.match(/\/Type \/Page /g) ?? []).length >= 3);
  check('PDF page footer numbers pages', /Page 1 of \d+/.test(txt) && /Page 3 of \d+/.test(txt));
  check('toCsv still escapes formulas', toCsv({ title: 't', meta: [], sections: [{ heading: 'h', columns: ['a'], rows: [['=1+1']] }] }).includes("'=1+1"));

  const schema: FeedSchema = { keyColumn: 'ticker', columns: [{ name: 'ticker', type: 'text', required: true }, { name: 'price_date', type: 'date', required: true }, { name: 'px', type: 'num', required: true }, { name: 'qty', type: 'num', required: false }] };
  check('schema validator refuses duplicate columns, bad names and a missing key', validateSchema(schema).length === 0 && validateSchema({ ...schema, keyColumn: 'nope' }).length === 1 && validateSchema({ keyColumn: 'a', columns: [{ name: 'A b', type: 'text' }] }).length >= 1);
  check('CSV parser handles quotes, doubled quotes, CRLF and BOM', JSON.stringify(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n')) === JSON.stringify([['a', 'b'], ['x,1', 'he said "hi"']]));
  const csv = ['Ticker,Price_Date,PX,qty,extra', 'AAA,2026-10-01,10.5,5,z', 'BBB,2026-10-01,abc,,z', 'AAA,2026-10-02,11,,z', 'CCC,2026-13-45,3,,z', ',2026-10-01,3,,z', 'DDD,2026-10-03,"1,200.50",7,z'].join('\n');
  const r = ingestCsv(csv, schema);
  check('feed: headers match case-insensitively, extra columns ignored', !r.headerError && r.rowsRead === 6);
  check('feed: bad number, duplicate key, bad date and empty key are refused with reasons', r.accepted.length === 2 && r.rejected.length === 4 && r.rejected.some((x) => /not a number/.test(x.reason)) && r.rejected.some((x) => /Duplicate key/.test(x.reason)) && r.rejected.some((x) => /not a date/.test(x.reason)) && r.rejected.some((x) => /required/.test(x.reason)), r.rejected);
  check('feed: numbers with thousands separators are typed and latest date found', r.accepted.find((x) => x.key === 'DDD')?.data.px === 1200.5 && r.latestRecordAt?.toISOString().slice(0, 10) === '2026-10-03');
  check('feed: missing column is a header error', ingestCsv('ticker,px\nA,1', schema).headerError?.includes('price_date') === true);
  const recs = r.accepted.map((x) => ({ key: x.key, data: x.data as Record<string, unknown> }));
  const types = feedCols(schema);
  check('feed rule NOT_NULL passes when every accepted row has the value', evalFeedRule({ checkType: 'NOT_NULL', col: 'qty', params: null }, recs, types, null).failures === 0);
  check('feed rule RANGE flags out-of-range rows', evalFeedRule({ checkType: 'RANGE', col: 'px', params: { max: 100 } }, recs, types, null).failures === 1);
  check('feed rule CROSS_TABLE flags values missing from the reference set', evalFeedRule({ checkType: 'CROSS_TABLE', col: 'ticker', params: { refDataset: 'securities', refCol: 'ticker' } }, recs, types, new Set(['AAA'])).failures === 1);
  check('feed rule COL_COMPARE on dates', evalFeedRule({ checkType: 'COL_COMPARE', col: 'price_date', params: { op: 'lte', other: 'price_date' } }, recs, types, null).failures === 0);
  check('feed rule FRESHNESS fails when stale', evalFeedRule({ checkType: 'FRESHNESS', col: 'price_date', params: { maxAgeDays: 1 } }, recs, types, null, new Date('2026-10-20T00:00:00Z')).failures === 1);
  check('feed composite uniqueness', evalFeedRule({ checkType: 'COMPOSITE_UQ', col: 'ticker,price_date', params: null }, [...recs, recs[0]!], types, null).failures === 1);

  check('registry: COMPOSITE_UQ compiles and refuses one column or unknown columns', compile({ dataset: 'security_prices', checkType: 'COMPOSITE_UQ', col: 'security_id,price_date' }).failSql.includes('GROUP BY') && validateRule({ dataset: 'security_prices', checkType: 'COMPOSITE_UQ', col: 'security_id' }).length >= 1 && validateRule({ dataset: 'security_prices', checkType: 'COMPOSITE_UQ', col: 'security_id,nope' }).length >= 1);
  check('registry: CROSS_TABLE needs a registry reference dataset and column', validateRule({ dataset: 'orders', checkType: 'CROSS_TABLE', col: 'portfolio_id', params: { refDataset: 'portfolio_positions', refCol: 'portfolio_id' } }).length === 0 && validateRule({ dataset: 'orders', checkType: 'CROSS_TABLE', col: 'portfolio_id', params: { refDataset: 'users; DROP', refCol: 'id' } }).length >= 1 && compile({ dataset: 'orders', checkType: 'CROSS_TABLE', col: 'portfolio_id', params: { refDataset: 'portfolio_positions', refCol: 'portfolio_id' } }).failCountSql.includes('LEFT JOIN `portfolio_positions`'));
  check('registry: COL_COMPARE maps the operator from a fixed table and needs matching types', compile({ dataset: 'cash_journals', checkType: 'COL_COMPARE', col: 'total_debit', params: { op: 'eq', other: 'total_credit' } }).failCountSql.includes('NOT (t.`total_debit` = t.`total_credit`)') && validateRule({ dataset: 'cash_journals', checkType: 'COL_COMPARE', col: 'total_debit', params: { op: 'drop', other: 'total_credit' } }).length >= 1 && validateRule({ dataset: 'cash_journals', checkType: 'COL_COMPARE', col: 'total_debit', params: { op: 'lt', other: 'description' } }).length >= 1 && Object.keys(COMPARE_OPS).length === 6);
  check('registry: a feed dataset validates against its own columns', validateRule({ dataset: 'feed:x', checkType: 'RANGE', col: 'px', params: { min: 0 } }, types).length === 0 && validateRule({ dataset: 'feed:x', checkType: 'RANGE', col: 'ticker', params: { min: 0 } }, types).length >= 1);

  const base = scoreRisk({ country: 'Iran', pep: 'Yes' });
  const cfg = defaultRiskConfig();
  cfg.factors.country!.points = 5;
  cfg.factors.pep!.enabled = false;
  const tuned = scoreRisk({ country: 'Iran', pep: 'Yes' }, cfg);
  check('KYC risk: stored factor points and enabled flags change the score', base.score === 70 && tuned.score === 5, { base: base.score, tuned: tuned.score });
  cfg.medium = 4;
  cfg.high = 50;
  check('KYC risk: configurable rating thresholds', ratingFor(5, cfg) === 'Medium' && ratingFor(50, cfg) === 'High' && ratingFor(3, cfg) === 'Low' && ratingFor(60) === 'High');
  cfg.factors.size_mid = { points: 7, enabled: true, params: { threshold: 100 } };
  check('KYC risk: size threshold comes from params', scoreRisk({ expectedInvestment: 150 }, cfg).score === 7 && scoreRisk({ expectedInvestment: 50 }, cfg).score === 0);
  check('document disposal rules: held and already-disposed refused', documentChangeProblem('DISPOSAL', 'Approved', 'Disposed', true) !== null && documentChangeProblem('DISPOSAL', 'Disposed', 'Disposed', false) !== null && documentChangeProblem('DISPOSAL', 'Approved', 'Disposed', false) === null);
  check('review cadence: month add clamps month ends', addMonths(new Date('2026-08-31T00:00:00Z'), 6).toISOString().slice(0, 10) === '2027-02-28');
}

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  pure();
  console.log(`\n${passes} passed, ${failures} failed (pure block only; set E2E_CONFIRM=throwaway-db for the API flows)`);
  process.exit(failures ? 1 : 0);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Wp-${randomBytes(9).toString('base64url')}`;
const key = (l: string) => `wp6-${run}-${l}-${randomBytes(4).toString('hex')}`;
const dayStr = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

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
    put: (p: string, b?: unknown) => send('PUT', p, b ?? {}),
    patch: (p: string, b?: unknown) => send('PATCH', p, b ?? {}),
    upload: (p: string, name: string, content: string, mime = 'text/csv', fields: Record<string, string> = {}) => {
      const fd = new FormData();
      fd.set('file', new Blob([content], { type: mime }), name);
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
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

async function flows() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `wp6-${run}-${label}@example.test`, name: `WP6 ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: roleKey } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    return u;
  };
  const fa = await mkUser('fa', 'fund_accountant');
  const comp1 = await mkUser('comp1', 'compliance');
  const comp2 = await mkUser('comp2', 'compliance');
  const dir = await mkUser('dir', 'investment_director');
  const adm = await mkUser('adm', 'system_admin');
  const cs = await mkUser('cs', 'client_services');
  const [cFa, cComp1, cComp2, cDir, cAdm, cCs] = [client(), client(), client(), client(), client(), client()];
  const pf = await prisma.portfolio.create({ data: { ref: `PWP-${run}`, name: `WP6 Entity ${run}`, type: 'Test Fund', baseCurrency: 'USD', status: 'Active', mandateJson: {} } });
  const cl = await prisma.client.create({ data: { ref: `CWP-${run}`, name: `WP6 Client ${run}`, type: 'Individual', kycStatus: 'Current', dealingHold: true, holdReason: 'test hold' } });
  const created = { docs: [] as string[], sources: [] as string[], models: [] as string[] };

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[cFa, fa], [cComp1, comp1], [cComp2, comp2], [cDir, dir], [cAdm, adm], [cCs, cs]] as const) check(`${u.email.split('@')[0]} signs in`, (await c.login(u.email)).status === 200);
    check('MFA enrolment', (await cComp1.enrolMfa()) && (await cComp2.enrolMfa()) && (await cDir.enrolMfa()) && (await cFa.enrolMfa()));

    console.log('\nReports: PDF, rolling schedule, email delivery');
    const pdfRun = await cFa.post('/api/v1/reports/runs', { key: 'HOLDINGS', format: 'PDF', params: { portfolioId: pf.id } }, { 'Idempotency-Key': key('pdf') });
    check('PDF run completes with a hash', pdfRun.status === 201 && pdfRun.body.data.format === 'PDF' && pdfRun.body.data.status === 'COMPLETED' && pdfRun.body.data.sha256?.length === 64, pdfRun.body);
    const link = await cFa.get(`/api/v1/reports/runs/${pdfRun.body.data.id}/link`);
    const dl = link.status === 200 ? await fetch(link.body.data.url) : null;
    const buf = dl ? Buffer.from(await dl.arrayBuffer()) : Buffer.alloc(0);
    check('downloaded bytes are a real PDF and match the stored hash', buf.subarray(0, 8).toString() === '%PDF-1.4' && createHash('sha256').update(buf).digest('hex') === pdfRun.body.data.sha256);
    const sch = await cFa.post('/api/v1/reports/schedules', { key: 'TRANSACTIONS', name: `Rolling tx ${run}`, params: { portfolioId: pf.id }, format: 'PDF', frequency: 'MONTHLY', firstRunOn: dayStr(0), rolling: 'PREVIOUS_MONTH', recipients: [`wp6-${run}-rcpt@example.test`] }, { 'Idempotency-Key': key('sch') });
    check('rolling schedule needs no fixed from/to and stores recipients', sch.status === 201 && sch.body.data.rolling === 'PREVIOUS_MONTH' && sch.body.data.recipients.length === 1, sch.body);
    const rn = await cFa.post(`/api/v1/reports/schedules/${sch.body.data.id}/run-now`);
    const rp = rn.body?.data?.params as { from?: string; to?: string } | undefined;
    const want = rollingRange('PREVIOUS_MONTH', new Date());
    check('run-now re-dates the window to the previous month', rn.status === 201 && rp?.from === want.from && rp?.to === want.to, rn.body);
    check('run-now mailed the recipients and recorded the outcome', !!rn.body.data.id && (await prisma.reportRun.findUnique({ where: { id: rn.body.data.id } }))?.deliveryNote?.startsWith('Mailed 1 of 1') === true);
    const em = await cFa.post(`/api/v1/reports/runs/${pdfRun.body.data.id}/email`, { recipients: [`wp6-${run}-x@example.test`] });
    check('manual email of a run is audited', em.status === 200 && (await prisma.auditEvent.count({ where: { action: 'reports.run_emailed', objectId: pdfRun.body.data.id } })) === 1, em.body);
    check('bad recipient -> 400', (await cFa.post(`/api/v1/reports/runs/${pdfRun.body.data.id}/email`, { recipients: ['not-an-email'] })).status === 400);

    console.log('\nData fabric: feed contract, upload, staged rows, rules');
    const srcKey = `wp6-feed-${run}`;
    const mk = await cFa.post('/api/v1/data/sources', { key: srcKey, name: `WP6 feed ${run}`, kind: 'FILE_FEED', system: 'test', owner: 'tester', cadence: 'DAILY' }, { 'Idempotency-Key': key('src') });
    check('file feed registered', mk.status === 201, mk.body);
    created.sources.push(srcKey);
    const csvText = `ticker,price_date,px\nWP6A,${dayStr(0)},10\nWP6B,${dayStr(0)},bad\nWP6C,${dayStr(0)},200\n`;
    check('upload before a contract -> 409 schema_required', (await cFa.upload(`/api/v1/data/sources/${srcKey}/upload`, 'p.csv', csvText)).body?.error?.code === 'schema_required');
    check('invalid contract -> 400', (await cFa.put(`/api/v1/data/sources/${srcKey}/schema`, { keyColumn: 'zzz', columns: [{ name: 'ticker', type: 'text', required: true }] })).status === 400);
    const sc = await cFa.put(`/api/v1/data/sources/${srcKey}/schema`, { keyColumn: 'ticker', columns: [{ name: 'ticker', type: 'text', required: true }, { name: 'price_date', type: 'date', required: true }, { name: 'px', type: 'num', required: true }] });
    check('contract saved', sc.status === 200 && sc.body.data.schemaSpec?.keyColumn === 'ticker', sc.body);
    const up = await cFa.upload(`/api/v1/data/sources/${srcKey}/upload`, 'p.csv', csvText);
    check('upload: job SUCCEEDED, 2 accepted, 1 rejected, file hash kept', up.status === 201 && up.body.data.status === 'SUCCEEDED' && up.body.data.accepted === 2 && up.body.data.rowsRejected === 1 && up.body.data.fileSha256?.length === 64, up.body);
    check('the same file again -> 409 duplicate_file', (await cFa.upload(`/api/v1/data/sources/${srcKey}/upload`, 'p.csv', csvText)).body?.error?.code === 'duplicate_file');
    const rej = await cFa.get(`/api/v1/data/jobs/${up.body.data.ref}/rejected`);
    check('rejected rows are listed with the reason', rej.body.data.length === 1 && /not a number/.test(rej.body.data[0].reason), rej.body);
    const staged = await cFa.get(`/api/v1/data/sources/${srcKey}/staged`);
    check('staged rows are readable', staged.body.total === 2 && staged.body.data[0].key === 'WP6A', staged.body);
    check('all-rejected file fails the job and keeps the previous staged rows', (await cFa.upload(`/api/v1/data/sources/${srcKey}/upload`, 'q.csv', 'ticker,price_date,px\nX,nope,1\n')).body.data.status === 'FAILED' && (await cFa.get(`/api/v1/data/sources/${srcKey}/staged`)).body.total === 2);
    const rule = (k: string, checkType: string, col: string, params?: unknown, dataset = `feed:${srcKey}`) => cFa.post('/api/v1/data/rules', { key: `wp6-${run}-${k}`, name: `WP6 rule ${k}`, dataset, checkType, col, params, severity: 'LOW' }, { 'Idempotency-Key': key(k) });
    const r1 = await rule('range', 'RANGE', 'px', { max: 100 });
    check('feed rule created against the feed dataset', r1.status === 201 && r1.body.data.sourceKey === srcKey, r1.body);
    const run1 = await cFa.post(`/api/v1/data/rules/${r1.body.data.id}/run`);
    check('feed rule run FAILs on the 200 price with an exception', run1.status === 201 && run1.body.data.status === 'FAIL' && run1.body.data.failures === 1, run1.body);
    const exc = await cFa.get(`/api/v1/data/exceptions?ruleId=${r1.body.data.id}`);
    check('exception is keyed by the ticker', exc.body.data.some((e: any) => e.recordKey === 'WP6C'), exc.body);
    check('feed rule on a column the contract lacks -> 400', (await rule('bad', 'NOT_NULL', 'nope')).status === 400);
    const r2 = await rule('xt', 'CROSS_TABLE', 'ticker', { refDataset: 'securities', refCol: 'ticker' });
    check('cross-table feed rule runs against the registry table', (await cFa.post(`/api/v1/data/rules/${r2.body.data.id}/run`)).body?.data?.failures === 2, r2.body);
    const r3 = await rule('cuq', 'COMPOSITE_UQ', 'security_id,price_date', undefined, 'security_prices');
    check('composite uniqueness rule on a registry dataset passes', r3.status === 201 && (await cFa.post(`/api/v1/data/rules/${r3.body.data.id}/run`)).body?.data?.status === 'PASS', r3.body);
    const r4 = await rule('cmp', 'COL_COMPARE', 'total_debit', { op: 'eq', other: 'total_credit' }, 'cash_journals');
    check('column comparison rule on a registry dataset runs', r4.status === 201 && ['PASS', 'FAIL'].includes((await cFa.post(`/api/v1/data/rules/${r4.body.data.id}/run`)).body?.data?.status), r4.body);

    console.log('\nModel governance: reviews and bindings used by NAV and risk');
    const m = await cAdm.post('/api/v1/model-governance/models', { name: `WP6 NAV model ${run}`, purpose: 'Valuation used by the NAV run in tests', modelType: 'PRICING', tier: 1, ownerName: 'Tester', nextReviewOn: dayStr(5) }, { 'Idempotency-Key': key('m') });
    check('model registered', m.status === 201, m.body);
    created.models.push(m.body.data.id);
    const vid = (await cAdm.get(`/api/v1/model-governance/models/${m.body.data.id}`)).body.data.versionList[0].id as string;
    await cAdm.post(`/api/v1/model-governance/versions/${vid}/submit`);
    await cComp1.post(`/api/v1/model-governance/versions/${vid}/validations`, { outcome: 'PASS', scope: 'Back-test against closing prices' }, { 'Idempotency-Key': key('val') });
    await cDir.stepUp();
    const appr = await cDir.post(`/api/v1/model-governance/versions/${vid}/approve`);
    check('model approved by a third person', appr.status === 200 && appr.body.data.status === 'APPROVED', appr.body);
    await cDir.stepUp();
    const bind = await cDir.put(`/api/v1/model-governance/bindings/NAV_VALUATION`, { modelId: m.body.data.id, enforce: false });
    check('binding set (step-up, approved model only)', bind.status === 200, bind.body);
    check('binding refuses an unapproved or unknown model', (await cDir.put('/api/v1/model-governance/bindings/RISK_SCENARIO', { modelId: 'nope' })).status >= 400);
    const nav = await cFa.post('/api/v1/nav/runs', { portfolioId: pf.id, navDate: dayStr(0) }, { 'Idempotency-Key': key('nav') });
    const uses = await prisma.govModelUsage.count({ where: { modelId: m.body.data.id, note: { startsWith: 'Automatic' } } });
    check('a NAV run logged its use of the bound model', (nav.status === 201 || nav.status === 200) && uses === 1, { status: nav.status, uses, body: nav.body?.error });
    const sweep = await cComp1.post('/api/v1/model-governance/reviews/sweep');
    check('sweep opens a review for the model due within 30 days; repeat opens none', sweep.body.data.opened >= 1 && (await cComp1.post('/api/v1/model-governance/reviews/sweep')).body.data.opened === 0, sweep.body);
    const rv = (await cComp1.get(`/api/v1/model-governance/reviews?modelId=${m.body.data.id}`)).body.data[0];
    check('review is OPEN and due', rv?.status === 'OPEN', rv);
    check('the version author cannot review it (SoD)', (await cAdm.post(`/api/v1/model-governance/reviews/${rv.id}/submit`, { outcome: 'CONFIRMED' })).status === 403);
    check('the version approver cannot review it (SoD)', (await cDir.post(`/api/v1/model-governance/reviews/${rv.id}/submit`, { outcome: 'CONFIRMED' })).status === 403);
    check('a non-confirm outcome needs findings', (await cComp1.post(`/api/v1/model-governance/reviews/${rv.id}/submit`, { outcome: 'CHANGES_REQUIRED' })).status === 400);
    const sub = await cComp1.post(`/api/v1/model-governance/reviews/${rv.id}/submit`, { outcome: 'CONFIRMED', findings: 'No issues found in back-test' });
    check('review submitted', sub.body?.data?.status === 'SUBMITTED', sub.body);
    await cComp1.stepUp();
    check('the reviewer cannot approve their own review', (await cComp1.post(`/api/v1/model-governance/reviews/${rv.id}/approve`, { note: 'looks fine to me' })).status === 403);
    await cComp2.stepUp();
    const ap = await cComp2.post(`/api/v1/model-governance/reviews/${rv.id}/approve`, { note: 'Confirmed, next review in a year' });
    const after = await prisma.govModel.findUnique({ where: { id: m.body.data.id } });
    check('approval completes the review and moves the next review date out by the tier cadence', ap.body?.data?.status === 'COMPLETED' && !!after?.nextReviewOn && after.nextReviewOn.toISOString().slice(0, 10) === addMonths(new Date(), 6).toISOString().slice(0, 10), { ap: ap.body, next: after?.nextReviewOn });
    await prisma.govModel.update({ where: { id: m.body.data.id }, data: { nextReviewOn: new Date(`${dayStr(-3)}T00:00:00Z`) } });
    await cDir.stepUp();
    await cDir.put('/api/v1/model-governance/bindings/NAV_VALUATION', { modelId: m.body.data.id, enforce: true });
    const blocked = await cFa.post('/api/v1/nav/runs', { portfolioId: pf.id, navDate: dayStr(-1) }, { 'Idempotency-Key': key('nav2') });
    check('an enforced binding blocks NAV while the model review is overdue', blocked.status === 409 && blocked.body?.error?.code === 'model_not_usable', blocked.body);
    await prisma.govModelBinding.deleteMany({ where: { purpose: 'NAV_VALUATION' } });

    console.log('\nClients: KYC risk factors, change requests');
    const rf = await cComp1.get('/api/v1/client-ops/onboarding/risk-factors');
    check('risk factors listed with defaults and thresholds', rf.status === 200 && rf.body.factors.length >= 14 && rf.body.thresholds.high === 60, rf.body);
    check('changing a factor needs step-up and a reason', (await cComp1.put('/api/v1/client-ops/onboarding/risk-factors/sof', { points: 12, reason: 'ok' })).status >= 400);
    await cComp1.stepUp();
    const ch = await cComp1.put('/api/v1/client-ops/onboarding/risk-factors/sof', { points: 12, reason: 'Compliance committee decision' });
    check('factor points updated and audited', ch.status === 200 && (await prisma.kycRiskFactor.findUnique({ where: { key: 'sof' } }))?.points === 12 && (await prisma.auditEvent.count({ where: { action: 'kyc.risk_factor_changed' } })) >= 1, ch.body);
    await cComp1.put('/api/v1/client-ops/onboarding/risk-factors/sof', { points: 10, reason: 'Restore the default' });
    check('threshold ordering enforced', (await cComp1.put('/api/v1/client-ops/onboarding/risk-factors/rating_medium', { points: 70, reason: 'Invalid on purpose' })).status === 400);

    check('direct dealing-hold release is refused (checker required)', (await cCs.post(`/api/v1/client-ops/clients/${cl.ref}/dealing-hold`, { hold: false, reason: 'direct release attempt' })).status === 409);
    const cr = await cCs.post(`/api/v1/client-ops/clients/${cl.ref}/change-requests`, { kind: 'DEALING_HOLD_RELEASE', reason: 'Documents received, releasing hold' });
    check('release request created PENDING', cr.status === 201 && cr.body.request.status === 'PENDING', cr.body);
    check('a duplicate pending request -> 409', (await cCs.post(`/api/v1/client-ops/clients/${cl.ref}/change-requests`, { kind: 'DEALING_HOLD_RELEASE', reason: 'Documents received again' })).status === 409);
    check('the maker cannot approve (permission or SoD)', (await cCs.post(`/api/v1/client-ops/change-requests/${cr.body.request.id}/approve`, { note: 'self approval attempt' })).status === 403);
    await cComp1.stepUp();
    const apr = await cComp1.post(`/api/v1/client-ops/change-requests/${cr.body.request.id}/approve`, { note: 'Checked the documents' });
    check('checker approval releases the hold', apr.status === 200 && (await prisma.client.findUnique({ where: { id: cl.id } }))?.dealingHold === false, apr.body);
    const mnd = await prisma.mandate.create({ data: { ref: `MWP-${run}`, name: `WP6 mandate ${run}`, type: 'Discretionary', status: 'Shell', clientId: cl.id } }).catch(() => null);
    if (mnd) {
      check('direct mandate activation is refused (checker required)', (await cCs.post(`/api/v1/client-ops/clients/${cl.ref}/mandates/${mnd.ref}/status`, { status: 'Active' })).status === 409);
      const mr = await cCs.post(`/api/v1/client-ops/clients/${cl.ref}/change-requests`, { kind: 'MANDATE_STATUS', mandate: mnd.ref, status: 'Active', reason: 'Onboarding complete' });
      check('activation without an approved cash account is blocked at request time', mr.status === 409 && mr.body?.error?.code === 'activation_blocked', mr.body);
      const rj = await cCs.post(`/api/v1/client-ops/clients/${cl.ref}/change-requests`, { kind: 'MANDATE_STATUS', mandate: mnd.ref, status: 'Closed', reason: 'Client left before activation' });
      await cComp2.stepUp();
      check('closing request rejected by the checker leaves the mandate unchanged', rj.status === 201 && (await cComp2.post(`/api/v1/client-ops/change-requests/${rj.body.request.id}/reject`, { note: 'Not agreed, keep it' })).status === 200 && (await prisma.mandate.findUnique({ where: { id: mnd.id } }))?.status === 'Shell');
    }

    console.log('\nVault: disposal and PM evidence');
    const old = await prisma.document.create({ data: { ref: `DWP-${run}`, name: `WP6 old doc ${run}`, type: 'other', classification: 'Internal', status: 'Approved', documentDate: new Date('2010-01-01T00:00:00Z'), retentionYears: 1, createdBy: cs.id, makerId: cs.id } });
    created.docs.push(old.id);
    const fresh = await prisma.document.create({ data: { ref: `DWQ-${run}`, name: `WP6 fresh doc ${run}`, type: 'other', classification: 'Internal', status: 'Approved', documentDate: new Date(), retentionYears: 7, createdBy: cs.id, makerId: cs.id } });
    created.docs.push(fresh.id);
    check('disposal of a document inside its retention period is refused', (await cCs.post(`/api/v1/client-ops/vault/documents/${fresh.ref}/changes`, { kind: 'DISPOSAL', to: 'Disposed', reason: 'Trying to dispose too early' })).status === 400);
    const dp = await cCs.post(`/api/v1/client-ops/vault/documents/${old.ref}/changes`, { kind: 'DISPOSAL', to: 'Disposed', reason: 'Retention period ended in 2011' });
    check('disposal request for an eligible document is PENDING', dp.status === 201 && dp.body.change.status === 'PENDING', dp.body);
    await cComp1.stepUp();
    const da = await cComp1.post(`/api/v1/client-ops/vault/changes/${dp.body.change.id}/approve`, { note: 'Retention confirmed' });
    check('checker approval marks the document Disposed and logs it', da.status === 200 && (await prisma.document.findUnique({ where: { id: old.id } }))?.status === 'Disposed' && (await prisma.documentAccessLog.count({ where: { documentId: old.id, action: 'dispose' } })) === 1, da.body);
    const held = await prisma.document.create({ data: { ref: `DWR-${run}`, name: `WP6 held doc ${run}`, type: 'other', classification: 'Internal', status: 'Approved', documentDate: new Date('2010-01-01T00:00:00Z'), retentionYears: 1, createdBy: cs.id, makerId: cs.id } });
    created.docs.push(held.id);
    await prisma.documentHold.create({ data: { documentId: held.id, reason: 'litigation', placedBy: cs.id } });
    check('a document on legal hold cannot be disposed', (await cCs.post(`/api/v1/client-ops/vault/documents/${held.ref}/changes`, { kind: 'DISPOSAL', to: 'Disposed', reason: 'Should be refused' })).status === 400);

    const fund = await prisma.pmFund.create({ data: { ref: `PMW-${run}`, name: `WP6 PM fund ${run}`, manager: 'Mgr', strategy: 'BUYOUT', vintage: 2024, createdBy: cs.id } });
    const cm = await prisma.pmCommitment.create({ data: { ref: `PMCW-${run}`, fundId: fund.id, portfolioId: pf.id, amount: '1000', committedOn: new Date(), createdBy: cs.id } });
    const mark = await prisma.pmMark.create({ data: { ref: `PMMW-${run}`, commitmentId: cm.id, asOf: new Date(), nav: '900', method: 'GP_STATEMENT', makerId: cs.id } });
    const ev = await prisma.pmEvidence.create({ data: { markId: mark.id, kind: 'GP_STATEMENT', title: `WP6 GP statement ${run}`, addedBy: cs.id } });
    const att = await cCs.upload(`/api/v1/client-ops/vault/pm-evidence/${ev.id}/file`, 'gp.pdf', '%PDF-1.4 test', 'application/pdf');
    const evAfter = await prisma.pmEvidence.findUnique({ where: { id: ev.id } });
    check('evidence file becomes a vault document linked to the evidence row', att.status === 201 && !!evAfter?.documentId && evAfter.reference === att.body.evidence.document, att.body);
    if (evAfter?.documentId) created.docs.push(evAfter.documentId);
    const att2 = await cCs.upload(`/api/v1/client-ops/vault/pm-evidence/${ev.id}/file`, 'gp2.pdf', '%PDF-1.4 v2', 'application/pdf');
    check('a second file adds a new version of the same document', att2.status === 201 && (await prisma.documentVersion.count({ where: { documentId: evAfter!.documentId! } })) === 2, att2.body);
    check('the PM evidence list shows the document', (await cCs.get('/api/v1/client-ops/vault/pm-evidence')).body.data.some((e: any) => e.id === ev.id && e.document?.id));
    await prisma.pmEvidence.deleteMany({ where: { markId: mark.id } });
    await prisma.pmMark.deleteMany({ where: { id: mark.id } });
    await prisma.pmCommitment.deleteMany({ where: { id: cm.id } });
    await prisma.pmFund.deleteMany({ where: { id: fund.id } });
  } finally {
    console.log(`\n${passes} passed, ${failures} failed`);
    try {
      const srcIds = (await prisma.dataSource.findMany({ where: { key: { in: created.sources } }, select: { id: true } })).map((x) => x.id);
      await prisma.dataStagedRecord.deleteMany({ where: { sourceId: { in: srcIds } } });
      await prisma.reportSchedule.deleteMany({ where: { createdBy: { in: userIds } } });
      await prisma.clientChangeRequest.deleteMany({ where: { clientId: cl.id } });
      await prisma.mandate.deleteMany({ where: { clientId: cl.id } });
      await prisma.client.deleteMany({ where: { id: cl.id } });
      await prisma.portfolio.deleteMany({ where: { id: pf.id } });
    } catch (e) {
      console.log('  (cleanup skipped:', e instanceof Error ? e.message : e, ')');
    }
    await prisma.$disconnect();
    process.exit(failures ? 1 : 0);
  }
}

pure();
flows().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
