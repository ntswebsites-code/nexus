/**
 * Package S7 flow: investee forecast versions and P&L (BR-208, BR-209, BR-263), the drawdown ledger and tranche
 * control (BR-229, BR-230, BR-270, BR-272, BR-273, FR-CMP-035), requisition review and RFQ steps, reserved matters and
 * the decision due date (CMP-030, BR-218), compliance health (BR-221), and the term sheet extras (BR-212, GAP-020).
 *
 *   E2E_CONFIRM=local npx tsx --env-file-if-exists=../../.env scripts/test-investee-deals.ts
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { decryptField } from '../src/lib/crypto';
import { totpNow } from '../src/lib/totp';

if (process.env.E2E_CONFIRM !== 'local') {
  console.error('Refusing to run: set E2E_CONFIRM=local');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://127.0.0.1:${config.port}`;
const run = randomBytes(3).toString('hex');
let passes = 0;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 800));
  }
};

type Res = { status: number; body: any };
const users = JSON.parse(readFileSync(new URL('../../../secrets/uat-users.json', import.meta.url), 'utf8')) as { email: string; password: string }[];
const pw = (email: string) => users.find((u) => u.email === email)?.password ?? '';

function client(portal: 'investor' | 'admin' | 'company') {
  const origin = config.portalUrls[portal];
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: string | FormData, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, { method, headers: h, body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed };
  };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const once = () => send(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? headers : { 'Content-Type': 'application/json', ...headers });
    let res = await once();
    for (let i = 0; i < 8 && res.status === 409 && String(res.body?.error?.code ?? res.body?.code ?? '').includes('in_progress'); i++) {
      await new Promise((r) => setTimeout(r, 200));
      res = await once();
    }
    return res;
  };
  return { call, get: (path: string) => call('GET', path) };
}

async function codeFor(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { mfaFactors: { where: { verifiedAt: { not: null } } } } });
  const secret = decryptField(user.mfaFactors[0]?.secretEnc ?? null);
  if (!secret) throw new Error(`no TOTP for ${email}`);
  return totpNow(secret);
}

async function signIn(portal: 'admin' | 'company', email: string, loginPortal: string | null = portal) {
  const c = client(portal);
  const login = await c.call('POST', '/api/auth/login', { email, password: pw(email), ...(loginPortal ? { portal: loginPortal } : {}) });
  if (login.body?.mfa === 'verify') {
    const verified = await c.call('POST', '/api/auth/mfa/verify', { code: await codeFor(email) });
    check(`${email} signs in`, verified.status === 200, verified.body);
  } else {
    check(`${email} signs in`, login.status === 200, login.body);
  }
  return c;
}

const key = (s: string) => ({ 'Idempotency-Key': `s7-${run}-${s}` });
const dataOf = (res: Res) => res.body?.data ?? res.body;
const P = '/api/v1/investee-portal';
const OPS = '/api/v1/ops';
const TRANCHE_MESSAGE = 'Drawdown Request Exceeds Available Investment Tranche.';
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (offset: number) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function staffWith(permission: string, not: string[] = []) {
  const rows = await prisma.user.findMany({
    where: { email: { notIn: not }, roles: { some: { role: { portal: 'admin', permissions: { some: { permission } } } } } },
    select: { email: true },
    take: 20,
  });
  return rows.find((r) => pw(r.email))?.email;
}

async function main() {
  const investee = 'investee_102_admin@uat.matanho.test';
  const company = await signIn('company', investee, null);
  const link = await prisma.companyUser.findFirst({ where: { user: { email: investee }, status: 'active' }, select: { companyId: true } });
  if (!link) throw new Error('investee has no company');
  const companyId = link.companyId;

  const reviewer = await staffWith('research.edit');
  if (!reviewer) throw new Error('no staff user with research.edit and a UAT password');
  const ops = await signIn('admin', reviewer);

  await forecastSection(company, ops, companyId);
  await drawdownSection(company, ops, companyId);
  await governanceSection(company, ops, companyId);
  await termSheetSection(companyId);

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

type Client = ReturnType<typeof client>;

// ------------------------------------------------------------------ forecast: versions, P&L, cash roll-forward
async function forecastSection(company: Client, ops: Client, companyId: string) {
  const m0 = monthKey(0);
  const m1 = monthKey(1);
  const ws = await prisma.investeeWorkspace.findUnique({ where: { companyId } });
  const startVersion = ws?.forecastWorkingVersion ?? 1;
  const metrics = ['merchantRevenue', 'enterpriseRevenue', 'otherRevenue', 'processingCosts', 'supportLosses', 'salesMarketing', 'productEngineering', 'generalAdmin', 'operatingCash', 'capex', 'financing', 'openingCash', 'minimumCash'];

  const saved = await company.call('PUT', `${P}/forecast`, {
    scenario: 'Base case',
    cells: {
      merchantRevenue: { [m0]: 600, [m1]: 700 },
      enterpriseRevenue: { [m0]: 300, [m1]: 300 },
      otherRevenue: { [m0]: 100, [m1]: 0 },
      processingCosts: { [m0]: 200, [m1]: 250 },
      supportLosses: { [m0]: 50 },
      salesMarketing: { [m0]: 100 },
      productEngineering: { [m0]: 150 },
      generalAdmin: { [m0]: 50 },
      capex: { [m0]: 100 },
      financing: { [m1]: 400 },
      minimumCash: { [m0]: 300, [m1]: 300 },
      openingCash: { [m0]: 1000 },
    },
    baseVersion: startVersion,
  });
  const pnl = dataOf(saved).pnl?.months as Record<string, Record<string, number>> | undefined;
  check('forecast saves the P&L cells', saved.status === 200, saved.body);
  check('total revenue is merchant + enterprise + other', pnl?.[m0]?.totalRevenue === 1000, pnl?.[m0]);
  check('gross profit, EBITDA and margin are computed on the server', pnl?.[m0]?.grossProfit === 750 && pnl?.[m0]?.ebitda === 450 && pnl?.[m0]?.ebitdaMargin === 45, pnl?.[m0]);
  check('closing cash = opening + operating - capex + financing', pnl?.[m0]?.openingCash === 1000 && pnl?.[m0]?.closingCash === 1350, pnl?.[m0]);
  check('opening cash of the next month is the closing cash of the month before (BR-209)', pnl?.[m1]?.openingCash === pnl?.[m0]?.closingCash, pnl);
  check('the stored revenue total follows the components', dataOf(saved).forecast?.[m0] === 1000, dataOf(saved).forecast);

  const badOpening = await company.call('PUT', `${P}/forecast`, { cells: { openingCash: { [m1]: 5 } } });
  check('opening cash cannot be typed for a later month', badOpening.status === 400 && /previous month/i.test(JSON.stringify(badOpening.body)), badOpening.body);
  const negative = await company.call('PUT', `${P}/forecast`, { cells: { merchantRevenue: { [m1]: -5 } } });
  check('negative revenue is refused', negative.status === 400, negative.body);

  const first = await company.call('POST', `${P}/forecast/submit`, undefined, key('fc1'));
  check('submitting freezes version 1 and opens the next working version', first.status === 200 && dataOf(first).workingVersion === startVersion + 1 && dataOf(first).latestSubmittedVersion === startVersion, first.body);
  const again = await company.call('POST', `${P}/forecast/submit`, undefined, key('fc2'));
  check('an unchanged forecast cannot be submitted again', again.status === 409 && again.body?.error?.code === 'unchanged_forecast', again.body);
  const stale = await company.call('PUT', `${P}/forecast`, { cells: { merchantRevenue: { [m0]: 650 } }, baseVersion: startVersion });
  check('editing a submitted version is a version_conflict', stale.status === 409 && stale.body?.error?.code === 'version_conflict', stale.body);

  const edit = await company.call('PUT', `${P}/forecast`, { cells: { merchantRevenue: { [m0]: 650 } }, baseVersion: startVersion + 1 });
  check('the new working version starts from the latest and can be edited', edit.status === 200 && dataOf(edit).pnl?.months?.[m0]?.totalRevenue === 1050, edit.body);
  const second = await company.call('POST', `${P}/forecast/submit`, undefined, key('fc3'));
  check('the changed working version submits as the next version', second.status === 200 && dataOf(second).latestSubmittedVersion === startVersion + 1, second.body);
  const v1 = await company.get(`${P}/forecast/versions/${startVersion}`);
  check('a submitted version is immutable: version 1 still has the original figures', v1.status === 200 && dataOf(v1).data?.cells?.merchantRevenue?.[m0] === 600, v1.body);

  const staffList = await ops.get(`${OPS}/investee-requests/forecasts/${companyId}`);
  const versions = (dataOf(staffList) as { versionNo: number }[]) ?? [];
  check('the fund sees submitted versions only', staffList.status === 200 && versions.some((v) => v.versionNo === startVersion) && versions.every((v) => v.versionNo < startVersion + 2), staffList.body);
  const unknown = await ops.get(`${OPS}/investee-requests/forecasts/${companyId}/${startVersion + 5}`);
  check('the working version is not visible to the fund', unknown.status === 404, unknown.body);

  await prisma.investeeForecastVersion.deleteMany({ where: { companyId, versionNo: { gte: startVersion } } });
  await prisma.investeeWorkspace.update({ where: { companyId }, data: { forecastWorkingVersion: startVersion } });
  await prisma.investeeForecastCell.deleteMany({ where: { companyId, metric: { in: metrics } } });
  await prisma.investeeForecastCell.deleteMany({ where: { companyId, metric: 'revenue', period: { in: [m0, m1] } } });
}

// ------------------------------------------------------------------ drawdown ledger, tranche, review, RFQ, SLA
async function drawdownSection(company: Client, ops: Client, companyId: string) {
  const before = await prisma.portfolioCompany.findUniqueOrThrow({ where: { id: companyId }, select: { totalCommittedAmount: true } });
  const base = await ops.get(`${OPS}/investee-requests/tranche/${companyId}`);
  const reservedBefore = dataOf(base).reserved as number;
  check('staff reads the tranche ledger', base.status === 200 && typeof dataOf(base).committed === 'number', base.body);

  const set = await ops.call('PUT', `${OPS}/investee-requests/tranche/${companyId}`, { totalCommittedAmount: reservedBefore + 300000 }, key('tranche'));
  check('staff sets the committed tranche', set.status === 200 && dataOf(set).committed === reservedBefore + 300000 && dataOf(set).available === 300000, set.body);
  const audit = await prisma.auditEvent.findFirst({ where: { action: 'company.tranche.committed_set', objectId: companyId }, orderBy: { occurredAt: 'desc' } });
  check('setting the tranche is audited', Boolean(audit));

  const mk = (title: string, amount: number, extra: Record<string, unknown> = {}) =>
    company.call('POST', `${P}/procurement`, { title: `${title} ${run}`, description: 'Drawdown test', type: 'Capital request', category: 'Growth capital', currency: 'USD', amount, needBy: '2027-03-31', priority: 'High', ...extra }, key(`req-${title}`));

  const first = await mk('Tranche A', 200000);
  const firstId = dataOf(first).id as string;
  check('a request within the tranche is submitted', first.status === 201 && dataOf(first).status === 'SUBMITTED', first.body);
  const panel = await company.get(`${P}/procurement`);
  const tr = dataOf(panel).tranche;
  check('the tranche panel shows committed, reserved and available', tr?.committed === reservedBefore + 300000 && tr?.reserved === reservedBefore + 200000 && tr?.available === 100000 && tr?.configured === true, tr);

  const over = await mk('Tranche over', 150000);
  check('over-draw is refused with the exact message', over.status === 409 && over.body?.error?.message === TRANCHE_MESSAGE, over.body);
  const draft = await mk('Tranche draft', 150000, { draft: true });
  const draftId = dataOf(draft).id as string;
  check('a draft is saved without the check', draft.status === 201 && dataOf(draft).status === 'DRAFT', draft.body);
  const submitDraft = await company.call('POST', `${P}/procurement/${draftId}/submit`, undefined, key('submit-draft'));
  check('submitting the draft is refused for the same reason', submitDraft.status === 409 && submitDraft.body?.error?.message === TRANCHE_MESSAGE, submitDraft.body);

  const noReason = await ops.call('POST', `${OPS}/investee-requests/${companyId}/${firstId}/decide`, { status: 'RETURNED' }, key('ret0'));
  check('returning needs a reason', noReason.status === 400, noReason.body);
  const returned = await ops.call('POST', `${OPS}/investee-requests/${companyId}/${firstId}/decide`, { status: 'RETURNED', note: 'Add the quotes' }, key('ret1'));
  check('VC review returns the request', returned.status === 200 && dataOf(returned).status === 'RETURNED' && dataOf(returned).canResubmit === true, returned.body);
  const afterReturn = await company.get(`${P}/procurement`);
  check('a returned request releases its reservation', dataOf(afterReturn).tranche?.reserved === reservedBefore, dataOf(afterReturn).tranche);

  const same = await company.call('POST', `${P}/procurement/${firstId}/resubmit`, {}, key('re0'));
  check('resubmission with no change is refused (BR-273)', same.status === 409 && same.body?.error?.code === 'unchanged_resubmission', same.body);
  const reOver = await company.call('POST', `${P}/procurement/${firstId}/resubmit`, { amount: 400000 }, key('re-over'));
  check('a resubmission is also held to the tranche', reOver.status === 409 && reOver.body?.error?.message === TRANCHE_MESSAGE, reOver.body);
  const changed = await company.call('POST', `${P}/procurement/${firstId}/resubmit`, { amount: 120000, description: 'Quotes attached' }, key('re1'));
  check('a changed request resubmits', changed.status === 200 && dataOf(changed).status === 'SUBMITTED' && dataOf(changed).estimatedAmount === 120000, changed.body);

  // only the requester may resubmit
  const other = await prisma.companyUser.findFirst({ where: { companyId, status: 'active', user: { email: { not: 'investee_102_admin@uat.matanho.test' } } }, select: { user: { select: { email: true } } } });
  const second = await mk('Tranche B', 50000);
  const secondId = dataOf(second).id as string;
  await ops.call('POST', `${OPS}/investee-requests/${companyId}/${secondId}/decide`, { status: 'REJECTED', note: 'Not now' }, key('rej'));
  if (other && pw(other.user.email)) {
    const colleague = await signIn('company', other.user.email, null);
    const hijack = await colleague.call('POST', `${P}/procurement/${secondId}/resubmit`, { amount: 40000 }, key('hijack'));
    check('only the requester may resubmit', hijack.status === 403 || hijack.status === 404, hijack.body);
  }

  const badStep = await ops.call('POST', `${OPS}/investee-requests/${companyId}/${firstId}/decide`, { status: 'CONVERTED_TO_PO' }, key('bad'));
  check('a request cannot skip the RFQ step', badStep.status === 409, badStep.body);
  const approve = await ops.call('POST', `${OPS}/investee-requests/${companyId}/${firstId}/decide`, { status: 'APPROVED', note: 'Approved' }, key('app'));
  check('VC review approves the request and stamps approval', approve.status === 200 && dataOf(approve).status === 'APPROVED' && typeof dataOf(approve).approvedAt === 'string', approve.body);
  const ledger = await ops.get(`${OPS}/investee-requests/tranche/${companyId}`);
  check('approved this quarter and total approved include the request (BR-229, BR-272)', dataOf(ledger).approvedThisQuarter >= 120000 && dataOf(ledger).totalApproved >= 120000, dataOf(ledger));
  const rfq = await ops.call('POST', `${OPS}/investee-requests/${companyId}/${firstId}/decide`, { status: 'RFQ_SENT', note: 'RFQ to three vendors' }, key('rfq'));
  check('the RFQ step is recorded', rfq.status === 200 && dataOf(rfq).status === 'RFQ_SENT' && typeof dataOf(rfq).rfqSentAt === 'string', rfq.body);
  const po = await ops.call('POST', `${OPS}/investee-requests/${companyId}/${firstId}/decide`, { status: 'CONVERTED_TO_PO', poRef: `PO-${run}` }, key('po'));
  check('the request converts to a purchase order', po.status === 200 && dataOf(po).status === 'CONVERTED_TO_PO' && dataOf(po).poRef === `PO-${run}`, po.body);
  const stillReserved = await company.get(`${P}/procurement`);
  check('a converted request still counts against the tranche', dataOf(stillReserved).tranche?.reserved === reservedBefore + 120000, dataOf(stillReserved).tranche);

  // 48 hour SLA queue (BR-230)
  const slaReq = await mk('Tranche SLA', 10000);
  const slaId = dataOf(slaReq).id as string;
  const fresh = await ops.get(`${OPS}/investee-requests/sla`);
  check('a fresh request is not in the SLA queue', !(dataOf(fresh) as { id: string }[]).some((r) => r.id === slaId), fresh.body);
  await prisma.investeeRequisition.updateMany({ where: { companyId, ref: slaId }, data: { submittedAt: new Date(Date.now() - 49 * 3600000) } });
  const late = await ops.get(`${OPS}/investee-requests/sla`);
  const lateRow = (dataOf(late) as { id: string; slaBreached: boolean; hoursPending: number }[]).find((r) => r.id === slaId);
  check('a request pending 49 hours appears in the SLA queue', Boolean(lateRow) && lateRow?.slaBreached === true && (lateRow?.hoursPending ?? 0) >= 49, late.body);

  await prisma.investeeRequisition.deleteMany({ where: { companyId, title: { contains: run } } });
  await prisma.portfolioCompany.update({ where: { id: companyId }, data: { totalCommittedAmount: before.totalCommittedAmount } });
}

// ------------------------------------------------------------------ reserved matters, due date, compliance health
async function governanceSection(company: Client, ops: Client, companyId: string) {
  const name = `Facility ${run}`;
  const add = await ops.call('POST', `${OPS}/investee-requests/reserved-matters/${companyId}`, { name, detail: 'Test matter', noticeDays: 30 }, key('matter'));
  check('staff adds a reserved matter with a notice period', add.status === 201 && (dataOf(add).matters as { name: string }[]).some((m) => m.name === name), add.body);
  const dup = await ops.call('POST', `${OPS}/investee-requests/reserved-matters/${companyId}`, { name, noticeDays: 5 }, key('matter2'));
  check('a duplicate matter is refused', dup.status === 409, dup.body);

  const consent = await company.call('POST', `${P}/governance/consents`, { title: `Consent ${run}`, basis: name }, key('consent'));
  const row = (dataOf(consent).consents as { title: string; due: string }[])?.find((c) => c.title === `Consent ${run}`);
  const expected = ymd(new Date(Date.now() + 30 * 86400000));
  check('the decision due date defaults to submission plus the notice period (BR-218)', consent.status === 201 && row?.due === expected, { row, expected });
  check('the portal shows the staff-maintained reserved matters', (dataOf(consent).reservedMatters as { name: string; noticeDays: number }[]).some((m) => m.name === name && m.noticeDays === 30), dataOf(consent).reservedMatters);
  const health = dataOf(consent).metrics?.complianceHealth as { due: number; onTime: number; ratio: number | null } | undefined;
  check('compliance health carries obligations due and on time (BR-221)', health !== undefined && typeof health.due === 'number' && health.onTime <= health.due && (health.due === 0 ? health.ratio === null : health.ratio === Math.round((health.onTime / health.due) * 1000) / 10), health);

  const matter = (dataOf(add).matters as { id: string; name: string }[]).find((m) => m.name === name);
  const upd = await ops.call('PATCH', `${OPS}/investee-requests/reserved-matters/${companyId}/${matter?.id}`, { active: false }, key('matter3'));
  check('a matter can be retired', upd.status === 200, upd.body);
  await prisma.investeeConsent.deleteMany({ where: { companyId, title: { contains: run } } });
  await prisma.investeeReservedMatter.deleteMany({ where: { companyId, name } });
}

// ------------------------------------------------------------------ term sheets: deal stage, reject, void, amend, templates
async function termSheetSection(companyId: string) {
  const approverEmail = await staffWith('term_sheets.approve');
  const creatorEmail = await staffWith('term_sheets.create');
  if (!approverEmail || !creatorEmail) {
    check('staff users with term_sheets.approve and term_sheets.create exist', false, { approverEmail, creatorEmail });
    return;
  }
  const approverUser = await prisma.user.findUniqueOrThrow({ where: { email: approverEmail }, select: { id: true } });
  const other = await prisma.user.findFirstOrThrow({ where: { id: { not: approverUser.id } }, select: { id: true } });
  const approver = await signIn('admin', approverEmail);
  const creator = await signIn('admin', creatorEmail);

  let n = 0;
  const sheet = async (status: string, extra: Record<string, unknown> = {}) => {
    n += 1;
    return prisma.termSheet.create({
      data: {
        ref: `TS-S7${run}${n}`.slice(0, 16),
        companyId,
        title: `S7 sheet ${run} ${n}`,
        status,
        investmentAmount: 1000,
        valuation: 10000,
        equityPercentage: 10,
        currency: 'USD',
        createdById: other.id,
        issuedById: other.id,
        ...extra,
      },
    });
  };

  // BR-212: both signed advances the deal
  const a = await sheet('SIGNED_BY_COMPANY');
  const cs = await approver.call('POST', `${OPS}/term-sheets/${a.id}/countersign`, undefined, key('cs-a'));
  check('the fund countersigns the term sheet', cs.status === 200 && dataOf(cs).status === 'COUNTERSIGNED', cs.body);
  const dealA = await prisma.investeeDeal.findUnique({ where: { termSheetId: a.id } });
  check('countersigning advances the deal to UNDER_BOARD_REVIEW (BR-212)', dealA?.stage === 'UNDER_BOARD_REVIEW', dealA);
  const stageAudit = await prisma.auditEvent.findFirst({ where: { action: 'deal.stage_advanced', objectId: dealA?.id ?? '-' } });
  check('the stage change is audited', Boolean(stageAudit));

  const b = await sheet('SIGNED_BY_COMPANY');
  const movedOn = await prisma.investeeDeal.create({ data: { ref: `DEAL-S7${run}`.slice(0, 16), companyId, termSheetId: b.id, stage: 'APPROVED' } });
  const csB = await approver.call('POST', `${OPS}/term-sheets/${b.id}/countersign`, undefined, key('cs-b'));
  const afterB = await prisma.investeeDeal.findUnique({ where: { id: movedOn.id } });
  check('a deal that already moved on is never regressed', csB.status === 200 && afterB?.stage === 'APPROVED', afterB);

  // fund-side reject
  const c = await sheet('SIGNED_BY_COMPANY');
  const shortReason = await approver.call('POST', `${OPS}/term-sheets/${c.id}/reject`, { reason: 'x' }, key('rej0'));
  check('a rejection needs a reason', shortReason.status === 400, shortReason.body);
  const rej = await approver.call('POST', `${OPS}/term-sheets/${c.id}/reject`, { reason: 'Valuation not agreed' }, key('rej1'));
  check('the fund rejects a company-signed sheet', rej.status === 200 && dataOf(rej).status === 'REJECTED_BY_FUND' && dataOf(rej).closeReason === 'Valuation not agreed', rej.body);
  const csAfterReject = await approver.call('POST', `${OPS}/term-sheets/${c.id}/countersign`, undefined, key('cs-c'));
  check('a rejected sheet cannot be countersigned', csAfterReject.status === 409, csAfterReject.body);

  // void
  const d = await sheet('COUNTERSIGNED');
  const voided = await approver.call('POST', `${OPS}/term-sheets/${d.id}/void`, { reason: 'Superseded by new terms' }, key('void1'));
  check('a countersigned sheet can be voided', voided.status === 200 && dataOf(voided).status === 'VOIDED', voided.body);
  const e = await sheet('EXECUTED');
  const voidExec = await approver.call('POST', `${OPS}/term-sheets/${e.id}/void`, { reason: 'Too late to void' }, key('void2'));
  check('an executed sheet cannot be voided', voidExec.status === 409, voidExec.body);

  // amendment versioning
  const f = await sheet('ISSUED', { versionNo: 1 });
  const dealF = await prisma.investeeDeal.create({ data: { ref: `DEAL-S7F${run}`.slice(0, 16), companyId, termSheetId: f.id, stage: 'TERM_SHEET' } });
  const amend = await creator.call('POST', `${OPS}/term-sheets/${f.id}/amend`, { reason: 'Change the equity split' }, key('amend1'));
  const newId = dataOf(amend).id as string;
  check('amending creates the next version as a draft', amend.status === 201 && dataOf(amend).status === 'DRAFT' && dataOf(amend).versionNo === 2 && dataOf(amend).parentId === f.id, amend.body);
  const old = await prisma.termSheet.findUnique({ where: { id: f.id } });
  check('the amended sheet is superseded', old?.status === 'SUPERSEDED');
  const dealAfter = await prisma.investeeDeal.findUnique({ where: { id: dealF.id } });
  check('the deal follows the new version and moves to negotiation', dealAfter?.termSheetId === newId && dealAfter.stage === 'TERM_SHEET_NEGOTIATION', dealAfter);
  const amendAgain = await creator.call('POST', `${OPS}/term-sheets/${f.id}/amend`, { reason: 'Again' }, key('amend2'));
  check('a superseded sheet cannot be amended twice', amendAgain.status === 409, amendAgain.body);
  const history = await creator.get(`${OPS}/term-sheets/${newId}/history`);
  check('the version history lists both versions in order', (dataOf(history) as { versionNo: number }[]).map((h) => h.versionNo).join(',') === '1,2', history.body);

  // template library
  const tplName = `Template ${run}`;
  const tpl = await creator.call('POST', `${OPS}/term-sheets/templates`, { name: tplName, description: 'S7', keyTerms: { Instrument: 'Preferred' }, conditions: 'Due diligence complete', timeline: 'Sign in 14 days' }, key('tpl'));
  const tplId = dataOf(tpl).id as string;
  check('staff adds a template to the library', tpl.status === 201 && dataOf(tpl).name === tplName, tpl.body);
  const list = await creator.get(`${OPS}/term-sheets/templates`);
  check('the library lists active templates', (dataOf(list) as { name: string }[]).some((t) => t.name === tplName), list.body);
  const company = await prisma.portfolioCompany.findUniqueOrThrow({ where: { id: companyId }, select: { ref: true } });
  const fromTpl = await creator.call('POST', `${OPS}/term-sheets`, { company: company.ref, title: `From template ${run}`, investmentAmount: 5000, valuation: 50000, equityPercentage: 10, templateId: tplId }, key('from-tpl'));
  check('a term sheet starts from a template', fromTpl.status === 201 && dataOf(fromTpl).conditions === 'Due diligence complete' && dataOf(fromTpl).timeline === 'Sign in 14 days', fromTpl.body);
  const archive = await creator.call('PATCH', `${OPS}/term-sheets/templates/${tplId}`, { status: 'ARCHIVED' }, key('tpl2'));
  check('a template can be archived', archive.status === 200 && dataOf(archive).status === 'ARCHIVED', archive.body);
  const archivedUse = await creator.call('POST', `${OPS}/term-sheets`, { company: company.ref, title: `Archived ${run}`, investmentAmount: 5000, valuation: 50000, equityPercentage: 10, templateId: tplId }, key('from-tpl2'));
  check('an archived template cannot be used', archivedUse.status === 404, archivedUse.body);

  const ids = (await prisma.termSheet.findMany({ where: { companyId, title: { contains: run } }, select: { id: true } })).map((t) => t.id);
  await prisma.investeeDeal.deleteMany({ where: { OR: [{ termSheetId: { in: ids } }, { ref: { contains: run } }] } });
  await prisma.termSheet.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
  await prisma.termSheet.deleteMany({ where: { id: { in: ids } } });
  await prisma.termSheetTemplate.deleteMany({ where: { name: tplName } });
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
