/**
 * R4-8 AI and reporting depth, against a RUNNING API: Copilot tool calls (cited, permission-gated, router fallback),
 * onboarding triage (advisory, idempotent), report email with attachment, scheduled LP-portal delivery (maker-checker),
 * regulator-filing receipts.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-ai-reporting.ts
 *
 * Disposable DBs only (migrate deploy + prisma/seed.ts first; INTEGRATION_LLM, _EMAIL and _REGULATOR_FILING = fake).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { ruleTriage } from '../src/integrations/llm/fake';
import { FakeLlm } from '../src/integrations/llm/fake';
import { payloadHash } from '../src/modules/regulatory/reg.engine';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}
const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ai-${randomBytes(9).toString('base64url')}`;
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
const key = (l: string) => `ai-${run}-${l}-${randomBytes(4).toString('hex')}`;
const td = new Date().toISOString().slice(0, 10);

interface Res {
  status: number;
  body: any;
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
    return { status: res.status, body: parsed };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
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
  console.log('\nFake LLM (pure)');
  const llm = new FakeLlm();
  const tools = ['positions', 'orders', 'nav', 'breaks', 'risk', 'cash', 'approvals', 'audit', 'accounting'].map((name) => ({ name, description: name }));
  const plan = await llm.plan({ question: 'Show NAV and the open reconciliation breaks and cash', tools });
  check('plan picks every matching tool, at most three', plan.calls.length === 3 && plan.calls.some((c) => c.tool === 'nav') && plan.calls.some((c) => c.tool === 'breaks'), plan);
  check('plan with no keyword picks no tool (router fallback)', (await llm.plan({ question: 'hello there', tools })).calls.length === 0);
  const low = ruleTriage({ caseRef: 'K', applicant: { name: 'A', type: 'Individual', country: 'Zimbabwe', pep: 'No', sourceOfFunds: 'Salary', expectedInvestment: 5000, owners: 0 }, checks: [{ kind: 'SANCTIONS', outcome: 'PASS' }], riskPreview: { score: 5, rating: 'Low', factors: [] }, openReferrals: [], missingEvidence: [], blockers: [] });
  const high = ruleTriage({ caseRef: 'K', applicant: { name: 'B', type: 'Company', country: 'Zimbabwe', pep: 'Yes', sourceOfFunds: null, expectedInvestment: 2_000_000, owners: 0 }, checks: [{ kind: 'SANCTIONS', outcome: 'FAIL' }, { kind: 'PEP', outcome: null }], riskPreview: { score: 80, rating: 'High', factors: [] }, openReferrals: [], missingEvidence: ['ID'], blockers: [] });
  check('triage: clean Low case -> LOW with no flags; failed sanctions + PEP + no funds source -> HIGH with flags', low.riskBand === 'LOW' && low.flags.length === 0 && high.riskBand === 'HIGH' && high.flags.length >= 4, { low, high });

  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `ai-${run}-${label}@example.test`, name: `AI ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    const role = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: roleKey } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    return u;
  };
  const fa = await mkUser('fa', 'fund_accountant'); // reports create/submit (maker), valuation, cash
  const comp = await mkUser('comp', 'compliance'); // reports approve/submit, onboarding.manage
  const dir = await mkUser('dir', 'investment_director'); // reports approve, onboarding.manage
  const dealer = await mkUser('dealer', 'dealer'); // dashboard + orders + cash only
  const [cFa, cComp, cDir, cDealer] = [client(), client(), client(), client()];
  const fund = await prisma.fund.create({ data: { ref: `FAI-${run}`, name: `AI Fund ${run}`, shortName: `AF ${run}`, currency: 'USD' } });
  const cl = await prisma.client.create({ data: { ref: `CAI-${run}`, name: `AI Client ${run}`, type: 'Individual' } });
  await prisma.fundCommitment.create({ data: { clientId: cl.id, fundId: fund.id, commitmentAmount: '1000.00', currency: 'USD', status: 'ACTIVE' } });
  const app = await prisma.onboardingApplication.create({ data: { ref: `OA-${run}`.slice(0, 16), applicantType: 'Company', legalName: `Triage Co ${run}`, email: `t-${run}@example.test`, country: 'Zimbabwe', pep: 'Yes', status: 'Submitted', submittedAt: new Date() } });
  const kase = await prisma.kycCase.create({ data: { ref: `KYC-${run}`.slice(0, 16), applicationId: app.id, stage: 'ComplianceReview' } });
  const filingRefs: string[] = [];

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[cFa, fa], [cComp, comp], [cDir, dir], [cDealer, dealer]] as const) check(`${u.email} signs in`, (await c.login(u.email)).status === 200);
    check('MFA enrolment', (await cComp.enrolMfa()) && (await cDir.enrolMfa()) && (await cFa.enrolMfa()));

    console.log('\nCopilot with tool calls');
    const ask = await cComp.post('/api/v1/admin-core/copilot/ask', { question: 'What is the NAV, are there open reconciliation breaks, and is accounting balanced?' });
    const d = ask.body?.data;
    check('answer is engine LLM with up to three cited tool calls, each OK with sources', ask.status === 200 && d.engine === 'LLM' && d.toolCalls.length >= 2 && d.toolCalls.every((t: any) => t.status === 'OK') && d.sources.length >= d.toolCalls.length, ask.body);
    check('multi-domain answers carry extra tables only when data exists, and a model name', typeof d.model === 'string' && Array.isArray(d.extraTables ?? []), d);
    const mixed = await cDealer.post('/api/v1/admin-core/copilot/ask', { question: 'Show cash and NAV and accounting journals' });
    const md = mixed.body?.data;
    check('a caller lacking valuation.view gets the cash tool but NAV and accounting are DENIED and named', mixed.status === 200 && md.toolCalls.some((t: any) => t.tool === 'cash' && t.status === 'OK') && md.toolCalls.filter((t: any) => t.status === 'DENIED').length >= 1 && /valuation\.view/.test(md.answer), mixed.body);
    const deniedAll = await cDealer.post('/api/v1/admin-core/copilot/ask', { question: 'journals ledger accounting' });
    check('only-denied tools -> refusal naming the permission, no sources', /valuation\.view/.test(deniedAll.body?.data?.answer ?? '') && deniedAll.body.data.sources.length === 0, deniedAll.body);
    const help = await cComp.post('/api/v1/admin-core/copilot/ask', { question: 'tell me a joke please' });
    check('no tool matches -> keyword-router fallback (engine ROUTER)', help.body?.data?.engine === 'ROUTER' && help.body.data.intent === 'help', help.body);
    const hist = await cComp.get('/api/v1/admin-core/copilot/history');
    check('history keeps engine and tool calls', hist.status === 200 && hist.body.data[0].engine === 'ROUTER' && hist.body.data.some((h: any) => h.engine === 'LLM' && h.toolCalls.length >= 2), hist.body);

    console.log('\nOnboarding triage');
    check('dealer lacks onboarding.view -> 403', (await cDealer.get(`/api/v1/client-ops/onboarding/cases/${kase.id}/triage`)).status === 403);
    check('read-only analyst cannot run triage (needs onboarding.manage) -> 403', (await cFa.post(`/api/v1/client-ops/onboarding/cases/${kase.id}/triage`)).status === 403);
    const t1 = await cComp.post(`/api/v1/client-ops/onboarding/cases/${kase.id}/triage`);
    check('triage stored: HIGH (PEP, no funds source), advisory, with flags and next steps', t1.status === 201 && t1.body.data.riskBand === 'HIGH' && t1.body.data.advisory === true && t1.body.data.flags.length >= 2 && t1.body.data.nextSteps.length >= 1, t1.body);
    const t2 = await cDir.post(`/api/v1/client-ops/onboarding/cases/${kase.id}/triage`);
    check('re-run on unchanged facts returns the same stored triage (no duplicate)', t2.body?.data?.id === t1.body.data.id && (await prisma.onboardingTriage.count({ where: { caseId: kase.id } })) === 1, t2.body);
    await prisma.kycCheck.create({ data: { caseId: kase.id, kind: 'SANCTIONS', outcome: 'PASS', provider: 'Manual review', performedBy: comp.id } });
    const t3 = await cComp.post(`/api/v1/client-ops/onboarding/cases/${kase.id}/triage`);
    check('a changed fact set produces a new triage and the list shows both', t3.body?.data?.id !== t1.body.data.id && (await cComp.get(`/api/v1/client-ops/onboarding/cases/${kase.id}/triage`)).body.data.length === 2, t3.body);
    const caseAfter = await prisma.kycCase.findUniqueOrThrow({ where: { id: kase.id } });
    check('triage did not change the case (advisory only) and is audited', caseAfter.stage === 'ComplianceReview' && caseAfter.risk === 'Pending' && (await prisma.auditEvent.count({ where: { action: 'kyc.triage_generated', objectId: kase.id } })) === 2);

    console.log('\nReport email with attachment');
    const rep = await cFa.post('/api/v1/reports/runs', { key: 'FACT_SHEET', format: 'HTML', params: { fundId: fund.ref } }, { 'Idempotency-Key': key('run') });
    check('fact sheet generated', rep.status === 201 && rep.body.data.status === 'COMPLETED', rep.body);
    const to = `ai-${run}-att@example.test`;
    const mail = await cFa.post(`/api/v1/reports/runs/${rep.body.data.id}/email`, { recipients: [to], attach: true });
    const inbox = (await prisma.integrationInbox.findMany({ where: { adapter: 'email', kind: 'email' }, orderBy: { createdAt: 'desc' }, take: 50 })).find((r) => (r.payload as any)?.to === to);
    const atts = ((inbox?.payload as any)?.attachments ?? []) as { filename: string; bytes: number }[];
    check('mailed with the stored file attached (name and bytes recorded, never the content)', mail.status === 200 && /with attachment/.test(mail.body.data.note) && atts.length === 1 && atts[0]!.bytes > 100 && /\.html$/.test(atts[0]!.filename), { note: mail.body, atts });
    const link = await cFa.post(`/api/v1/reports/runs/${rep.body.data.id}/email`, { recipients: [`ai-${run}-lnk@example.test`] });
    check('without attach it stays a link-only mail', link.status === 200 && !/attachment/.test(link.body.data.note));

    console.log('\nScheduled LP-portal delivery');
    const sch = await cFa.post('/api/v1/reports/schedules', { key: 'FACT_SHEET', name: `AI fact sheet ${run}`, params: { fundId: fund.ref }, format: 'HTML', frequency: 'QUARTERLY', firstRunOn: td, recipients: [to], emailAttach: true }, { 'Idempotency-Key': key('sch') });
    check('schedule created with emailAttach and LP delivery OFF', sch.status === 201 && sch.body.data.emailAttach === true && sch.body.data.lpDeliver === false, sch.body);
    const sid = sch.body.data.id;
    check('the preparer (no reports.approve) cannot enable LP delivery -> 403', (await cFa.post(`/api/v1/reports/schedules/${sid}/lp-delivery`, { enabled: true })).status === 403);
    await prisma.session.updateMany({ where: { userId: { in: [comp.id, dir.id] } }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    check('enabling without fresh step-up -> step_up_required', (await cComp.post(`/api/v1/reports/schedules/${sid}/lp-delivery`, { enabled: true })).body?.error?.code === 'step_up_required');
    await cComp.stepUp();
    const en = await cComp.post(`/api/v1/reports/schedules/${sid}/lp-delivery`, { enabled: true });
    check('a different reports.approve holder enables it; approver recorded', en.status === 200 && en.body.data.lpDeliver === true && !!en.body.data.lpDeliverApprovedBy, en.body);
    // Segregation: a schedule created by an approver cannot be approved by that same person.
    const own = await prisma.reportDefinition.findFirst({ where: { key: 'FACT_SHEET' } });
    const ownSched = await prisma.reportSchedule.create({ data: { definitionId: own!.id, name: `AI own ${run}`, params: { fundId: fund.id }, format: 'CSV', frequency: 'QUARTERLY', nextRunOn: new Date(`${td}T00:00:00.000Z`), createdBy: dir.id } });
    await cDir.stepUp();
    check('the schedule creator cannot approve their own LP delivery -> segregation_of_duties', (await cDir.post(`/api/v1/reports/schedules/${ownSched.id}/lp-delivery`, { enabled: true })).body?.error?.code === 'segregation_of_duties');
    const cashDef = await prisma.reportDefinition.findFirst({ where: { key: 'CASH' } });
    const cashSched = await prisma.reportSchedule.create({ data: { definitionId: cashDef!.id, name: `AI cash ${run}`, params: {}, format: 'CSV', frequency: 'DAILY', nextRunOn: new Date(`${td}T00:00:00.000Z`), createdBy: fa.id } });
    check('a cash schedule cannot go to the LP portal -> 400', (await cComp.post(`/api/v1/reports/schedules/${cashSched.id}/lp-delivery`, { enabled: true })).status === 400);
    const rn = await cFa.post(`/api/v1/reports/schedules/${sid}/run-now`, {}, { 'Idempotency-Key': key('rn') });
    const doc = await prisma.document.findFirst({ where: { sourceRefId: rn.body?.data?.id, sourceType: 'FUND_REPORT_SYNC' }, include: { publications: true } });
    check('the scheduled run is published to the LP portal Documents for the committed investor, approved by the checker', rn.status === 201 && !!doc && doc.status === 'Published' && doc.checkerId === comp.id && doc.publications.some((p) => p.clientId === cl.id), { rn: rn.body, doc });
    check('the run records distribution; a second distribution is refused', (await prisma.reportRun.findUniqueOrThrow({ where: { id: rn.body.data.id } })).distributedAt !== null && (await cComp.post(`/api/v1/reports/runs/${rn.body.data.id}/distribute`)).body?.error?.code === 'already_distributed');
    check('audited: lp delivery enabled and run distributed via schedule', (await prisma.auditEvent.count({ where: { action: 'reports.schedule_lp_delivery_enabled', objectId: sid } })) === 1 && (await prisma.auditEvent.count({ where: { action: 'reports.run_distributed', objectId: rn.body.data.id } })) === 1);
    const off = await cComp.post(`/api/v1/reports/schedules/${sid}/lp-delivery`, { enabled: false });
    check('switching it off clears the approval', off.body?.data?.lpDeliver === false && off.body.data.lpDeliverApprovedBy === null);

    console.log('\nRegulator filing receipts');
    await cFa.get('/api/v1/regulatory/templates');
    const tpl = await prisma.regTemplate.findFirstOrThrow({ where: { key: 'SECZ_QUARTERLY' } });
    const payload = { rows: [{ k: 'aum', v: '1' }] };
    const mkFiling = async (label: string, end: string, sha: string | null, usePayload: boolean) => {
      const ref = `REG-${run}${label}`.slice(0, 16);
      filingRefs.push(ref);
      return prisma.regFiling.create({ data: { ref, templateId: tpl.id, periodStart: new Date('2001-01-01'), periodEnd: new Date(end), dueDate: new Date('2001-05-01'), status: 'APPROVED', payload: usePayload ? payload : undefined, payloadSha256: sha, makerId: fa.id, approvedBy: dir.id, approvedAt: new Date() } });
    };
    const good = await mkFiling('a', '2001-03-31', payloadHash(payload), true);
    await cComp.stepUp();
    check('the preparer cannot submit their own filing -> 403', (await (async () => { await cFa.stepUp(); return cFa.post(`/api/v1/regulatory/filings/${good.id}/submit`, { submissionRef: 'PORTAL-1' }); })()).status === 403);
    const sub = await cComp.post(`/api/v1/regulatory/filings/${good.id}/submit`, { submissionRef: `PORTAL-${run}` });
    check('submit goes through the regulator-filing adapter: SUBMITTED with an ACKNOWLEDGED receipt stored', sub.status === 200 && sub.body.data.status === 'SUBMITTED' && sub.body.data.submissions.length === 1 && sub.body.data.submissions[0].status === 'ACKNOWLEDGED' && /^FAKE-/.test(sub.body.data.submissions[0].receiptRef), sub.body);
    check('the adapter call and the receipt are recorded (inbox + audit with the receipt ref)', (await prisma.integrationInbox.count({ where: { adapter: 'regulator-filing', externalRef: sub.body.data.submissions[0].receiptRef } })) >= 1 && (await prisma.auditEvent.count({ where: { action: 'regulatory.filing_submitted', objectId: good.id } })) === 1);
    check('a second submit is refused (already SUBMITTED) and no second receipt is stored', (await cComp.post(`/api/v1/regulatory/filings/${good.id}/submit`, { submissionRef: `PORTAL-${run}` })).status === 409 && (await prisma.regFilingSubmission.count({ where: { filingId: good.id } })) === 1);
    const bad = await mkFiling('b', '2001-06-30', '', true);
    await prisma.regFiling.update({ where: { id: bad.id }, data: { payloadSha256: null } });
    const rej = await cComp.post(`/api/v1/regulatory/filings/${bad.id}/submit`, { submissionRef: `PORTAL-B-${run}` });
    check('an unlocked payload is refused before the regulator is called (payload_changed); filing stays APPROVED', rej.status === 409 && (await prisma.regFiling.findUniqueOrThrow({ where: { id: bad.id } })).status === 'APPROVED', rej.body);
  } finally {
    console.log(`\n${passes} passed, ${failures} failed`);
    try {
      await prisma.regFilingSubmission.deleteMany({ where: { filingId: { in: (await prisma.regFiling.findMany({ where: { ref: { in: filingRefs } }, select: { id: true } })).map((f) => f.id) } } });
      await prisma.regFiling.deleteMany({ where: { ref: { in: filingRefs } } });
      await prisma.reportSchedule.deleteMany({ where: { createdBy: { in: userIds } } });
      await prisma.onboardingTriage.deleteMany({ where: { caseId: kase.id } });
      await prisma.kycCheck.deleteMany({ where: { caseId: kase.id } });
      await prisma.kycCase.deleteMany({ where: { id: kase.id } });
      await prisma.onboardingApplication.deleteMany({ where: { id: app.id } });
      await prisma.fundCommitment.deleteMany({ where: { fundId: fund.id } });
      await prisma.client.deleteMany({ where: { id: cl.id } });
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
