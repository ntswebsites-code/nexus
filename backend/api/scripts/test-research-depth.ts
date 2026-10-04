/**
 * Package S4 (research depth, private-markets pipeline, portfolio list and evidence, saved views, IBOR paging and
 * async refresh, performance chart markers) checks against a RUNNING API:
 *  - FR-RES-006/007/008/009: issuer universe with as-of and source, financials, filing import to the vault, valuation
 *    model with ranges and versions, timestamped notes, catalysts and risks.
 *  - FR-PM-002: pipeline deal, diligence case and cashflow scenario records with their validation and maker-checker.
 *  - FR-PORT-009/010/011/015: strategy, risk and manager filters, saved views per user, summary KPIs computed from the
 *    rows, evidence file in the vault on create, owner-only delete of a saved scenario.
 *  - FR-IBOR-002/004/007: SQL paging with ISIN search, asynchronous refresh job with status and a lock, column chooser
 *    persisted per user.  FR-PERF-006: chart event markers.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-research-depth.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` on a disposable schema first and start the API against the same
 * DATABASE_URL. Creates throwaway users and records with a random run id.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { runValuation, valuationInputs } from '../src/modules/research/research.valuation';
import { scenarioMetrics } from '../src/modules/private-markets/pm.pipeline';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Rd-${randomBytes(9).toString('base64url')}`;
let failures = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 900));
  }
};
const key = (label: string) => ({ 'Idempotency-Key': `rd-${run}-${label}-${randomBytes(4).toString('hex')}` });
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

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
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
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
      /* not JSON */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    put: (p: string, b?: unknown, h?: Record<string, string>) => send('PUT', p, b ?? {}, h),
    patch: (p: string, b?: unknown, h?: Record<string, string>) => send('PATCH', p, b ?? {}, h),
    del: (p: string) => send('DELETE', p),
    form: (p: string, fd: FormData, h?: Record<string, string>) => send('POST', p, fd, h),
    login: (email: string) => send('POST', '/api/auth/login', { email, password, portal: 'admin' }),
  };
}
const errCode = (r: Res) => r.body?.error?.code;
const auditCount = (action: string, objectId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}) } });
const file = (name: string, content: Buffer | string, mime = 'application/pdf') => new Blob([content as unknown as Uint8Array], { type: mime });

async function main() {
  // ---------------------------------------------------------------- pure maths
  console.log('\nValuation and scenario maths (pure)');
  const goodInputs = { revenue: 1_000_000_000, sharesOutstanding: 500_000_000, netDebt: 50_000_000, terminalGrowthPct: 2, growthPct: { low: 5, base: 10, high: 14 }, marginPct: { low: 8, base: 11, high: 13 }, discountPct: { low: 14, base: 17, high: 21 } };
  const vr = runValuation(valuationInputs.parse(goodInputs));
  check('low <= base <= high per share and every value is finite', vr.prices.low <= vr.prices.base && vr.prices.base <= vr.prices.high && Number.isFinite(vr.prices.base) && vr.prices.base > 0, vr.prices);
  check('growth above 500% is refused', !valuationInputs.safeParse({ ...goodInputs, growthPct: { low: 5, base: 10, high: 501 } }).success);
  check('margin below -100% and above 100% are refused', !valuationInputs.safeParse({ ...goodInputs, marginPct: { low: -101, base: 0, high: 5 } }).success && !valuationInputs.safeParse({ ...goodInputs, marginPct: { low: 1, base: 2, high: 101 } }).success);
  check('discount rate above 50% is refused; below terminal growth is refused', !valuationInputs.safeParse({ ...goodInputs, discountPct: { low: 14, base: 17, high: 51 } }).success && !valuationInputs.safeParse({ ...goodInputs, discountPct: { low: 1, base: 17, high: 21 } }).success);
  check('a range with low above base is refused', !valuationInputs.safeParse({ ...goodInputs, growthPct: { low: 12, base: 10, high: 14 } }).success);
  const sm = scenarioMetrics([
    { date: '2027-01-01', kind: 'CALL', amount: D('1000') },
    { date: '2028-01-01', kind: 'CALL', amount: D('500') },
    { date: '2031-01-01', kind: 'DISTRIBUTION', amount: D('3000') },
  ]);
  check('scenario metrics: called 1,500, distributed 3,000, MOIC 2.00, peak net -1,500, IRR positive', sm.called === '1500.00' && sm.distributed === '3000.00' && sm.moic === '2.00' && sm.peakNet === '-1500.00' && Number(sm.irrPct) > 10, sm);

  // ---------------------------------------------------------------- fixtures
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `rd-${run}-${label}@example.test`, name: `RD ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(roleKey)).id } });
    return u;
  };
  const anU = await mkUser('an', 'analyst'); // research.edit, portfolio.view
  const dirU = await mkUser('dir', 'investment_director'); // everything incl. portfolio.manage, research.ic.decide
  const pmU = await mkUser('pm', 'portfolio_manager'); // portfolio.manage, research.edit
  const audU = await mkUser('aud', 'auditor'); // read only
  const opsU = await mkUser('ops', 'operations'); // portfolio.manage, no research
const setU = await mkUser('set', 'settings_admin'); // no portfolio.view
  const an = client();
  const dir = client();
  const pm = client();
  const aud = client();
  const ops = client();
const set = client();

  const secIds: string[] = [];
  const pfIds: string[] = [];
  const docRefs: string[] = [];
  let caseIds: string[] = [];
  try {
    console.log('\nSign-in');
    for (const [c, u] of [[an, anU], [dir, dirU], [pm, pmU], [aud, audU], [ops, opsU], [set, setU]] as const) check(`${u.name} signs in`, (await c.login(u.email)).status === 200);

    const mkSec = async (n: number, assetClass = 'Equity') => {
      const s = await prisma.security.create({ data: { ticker: `K${run}${n}`.toUpperCase(), isin: `ZW${run}0${n}`.toUpperCase(), name: `KT ${run} Issuer ${n}`, market: 'ZSE', assetClass, currency: 'USD', boardLot: 1, sector: 'Banks', status: 'Active' } });
      secIds.push(s.id);
      await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: day(dayStr(-2)), price: D(`${10 + n}`), source: 'RDTEST' } });
      await prisma.securityPrice.create({ data: { securityId: s.id, priceDate: day(dayStr(-1)), price: D(`${10 + n}.5`), source: 'RDTEST' } });
      return s;
    };
    const s1 = await mkSec(1);
    const s2 = await mkSec(2);
    const s3 = await mkSec(3, 'Fixed income');
    const R = '/api/v1/research';
    const P = '/api/v1/private-markets';

    // ================================================================ FR-RES-006 issuers
    console.log('\nFR-RES-006: issuer universe, prices, financials, filings');
    const iss = await aud.get(`${R}/issuers?q=${s1.ticker}`);
    const row = iss.body?.data?.find((x: any) => x.id === s1.id);
    check('the auditor (research.view) lists the issuer with its latest price, as-of date and source', iss.status === 200 && row?.latestPrice?.price === '11.500000' && row.latestPrice.asOf === dayStr(-1) && row.latestPrice.source === 'RDTEST', iss.body);
    const sm1 = await aud.get(`/api/v1/securities?q=${s1.ticker}`);
    const smRow = (sm1.body?.data ?? []).find((x: any) => x.id === s1.id);
    check('the security master (Orders) shows the same last price, date and source', smRow?.latestPrice?.price === row?.latestPrice?.price && smRow?.latestPrice?.priceDate === row?.latestPrice?.asOf && smRow?.latestPrice?.source === row?.latestPrice?.source, smRow);
    check('ISIN search finds the issuer', ((await aud.get(`${R}/issuers?q=${s1.isin}`)).body?.data ?? []).some((x: any) => x.id === s1.id));
    check('a user without research.view (operations) -> 403', (await ops.get(`${R}/issuers`)).status === 403);

    const fin = { period: 'FY2025', periodType: 'FY', periodEnd: '2025-06-30', revenue: 1200000, ebitda: 300000, netIncome: 150000, eps: 0.25, source: 'Annual report FY2025', asOf: dayStr(-3) };
    check('an auditor cannot add financials -> 403', (await aud.post(`${R}/issuers/${s1.id}/financials`, fin, key('f0'))).status === 403);
    check('a future as-of date -> 400', (await an.post(`${R}/issuers/${s1.id}/financials`, { ...fin, asOf: dayStr(5) }, key('f1'))).status === 400);
    check('no figure at all -> 400', (await an.post(`${R}/issuers/${s1.id}/financials`, { period: 'FY2024', periodType: 'FY', periodEnd: '2024-06-30', source: 'x1', asOf: dayStr(-3) }, key('f2'))).status === 400);
    const f1 = await an.post(`${R}/issuers/${s1.id}/financials`, fin, key('f3'));
    check('the analyst adds FY2025 financials with source and as-of', f1.status === 201 && f1.body.data.period === 'FY2025' && f1.body.data.source === 'Annual report FY2025' && f1.body.data.asOf === dayStr(-3) && f1.body.data.revenue === '1200000.0000', f1.body);
    check('the same period again -> 409 duplicate_period', errCode(await an.post(`${R}/issuers/${s1.id}/financials`, fin, key('f4'))) === 'duplicate_period');
    const corr = await an.patch(`/api/v1/research/financials/${f1.body.data.id}`, { netIncome: 155000, source: 'Annual report FY2025 (restated)' });
    check('a correction updates the figure and is audited with before and after', corr.status === 200 && corr.body.data.netIncome === '155000.0000' && (await auditCount('research.financial_corrected', f1.body.data.id)) === 1, corr.body);

    // ================================================================ FR-RES-009 filing import
    console.log('\nFR-RES-009: import a filing into the vault');
    const mkFiling = (over: Record<string, string> = {}, withFile = true) => {
      const fd = new FormData();
      const fields: Record<string, string> = { filingType: 'ANNUAL_REPORT', title: 'Annual report 2025', period: 'FY2025', periodEnd: '2025-06-30', filedOn: dayStr(-4), source: 'ZSE announcements', ...over };
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      if (withFile) fd.set('file', file('ar.pdf', PDF), 'ar2025.pdf');
      return fd;
    };
    check('an auditor cannot import a filing -> 403', (await aud.form(`${R}/issuers/${s1.id}/filings`, mkFiling(), key('fl0'))).status === 403);
    check('no file -> 400', (await an.form(`${R}/issuers/${s1.id}/filings`, mkFiling({}, false), key('fl1'))).status === 400);
    check('a future filing date -> 400', (await an.form(`${R}/issuers/${s1.id}/filings`, mkFiling({ filedOn: dayStr(3) }), key('fl2'))).status === 400);
    check('an unknown filing type -> 400', (await an.form(`${R}/issuers/${s1.id}/filings`, mkFiling({ filingType: 'GOSSIP' }), key('fl3'))).status === 400);
    const fl = await an.form(`${R}/issuers/${s1.id}/filings`, mkFiling(), key('fl4'));
    check('the filing is imported and listed with its vault reference and version 1', fl.status === 201 && /^DOC-\d+$/.test(fl.body?.data?.documentRef) && fl.body.data.documentVersion === 1 && fl.body.data.filingType === 'ANNUAL_REPORT', fl.body);
    if (fl.body?.data?.documentRef) docRefs.push(fl.body.data.documentRef);
    const vdoc = await prisma.document.findFirst({ where: { ref: fl.body?.data?.documentRef ?? '-' }, include: { versions: true } });
    check('the Document Vault holds the same document: related to the issuer, version 1, internal, not published', vdoc?.relatedType === 'security' && vdoc.relatedId === s1.id && vdoc.versions.length === 1 && vdoc.versions[0]!.version === 1 && vdoc.classification === 'Internal' && vdoc.status === 'Draft', vdoc);
    const detail = await aud.get(`${R}/issuers/${s1.id}`);
    check('the issuer view lists the filing and the financials with as-of and source', detail.body?.data?.filings?.length === 1 && detail.body.data.financials[0]?.source && detail.body.data.latestPrice.source === 'RDTEST' && detail.body.data.priceHistory.length === 2, detail.body);
    const dl = await aud.get(`${R}/filings/${fl.body.data.id}/download-url`);
    check('a viewer gets a signed download link, and the download is audited', dl.status === 200 && typeof dl.body?.url === 'string' && (await auditCount('research.filing_downloaded', fl.body.data.id)) === 1, dl.body);
    check('import is audited with the hash', (await auditCount('research.filing_imported', fl.body.data.id)) === 1);

    // ================================================================ FR-RES-008 entries
    console.log('\nFR-RES-008: notes, catalysts and risks');
    const e = (b: Record<string, unknown>, label: string, who = an) => who.post(`${R}/entries`, { securityId: s1.id, ...b }, key(label));
    check('a note needs text -> 400', (await e({ kind: 'NOTE', title: 'Call with the CFO' }, 'e0')).status === 400);
    check('a catalyst needs a date and a trigger -> 400', (await e({ kind: 'CATALYST', title: 'Results day' }, 'e1')).status === 400);
    check('a risk needs a rating -> 400', (await e({ kind: 'RISK', title: 'Currency' }, 'e2')).status === 400);
    check('an auditor cannot add entries -> 403', (await e({ kind: 'NOTE', title: 'Nope', body: 'x' }, 'e3', aud)).status === 403);
    const n1 = await e({ kind: 'NOTE', title: 'Call with the CFO', body: 'Margins recover in H2.' }, 'e4');
    await sleep(1100);
    const c1 = await e({ kind: 'CATALYST', title: 'Results day', eventDate: dayStr(20), trigger: 'Audited results published', impact: 'POSITIVE' }, 'e5');
    const r1 = await e({ kind: 'RISK', title: 'Currency pass-through', severity: 'HIGH', body: 'Lags inflation.' }, 'e6');
    check('note, catalyst and risk are recorded with author, time and the right opening status', n1.status === 201 && c1.status === 201 && r1.status === 201 && n1.body.data.status === 'RECORDED' && c1.body.data.status === 'PENDING' && r1.body.data.status === 'OPEN' && c1.body.data.trigger === 'Audited results published' && n1.body.data.authorName === 'RD an', [n1.body, c1.body, r1.body]);
    const hist = (await aud.get(`${R}/entries?securityId=${s1.id}`)).body;
    check('history lists all entries newest first', hist.data.length === 3 && hist.data[0].id === r1.body.data.id && hist.data[2].id === n1.body.data.id && hist.total === 3, hist);
    check('the issuer entries filter by kind', (await aud.get(`${R}/entries?securityId=${s1.id}&kind=CATALYST`)).body.data.length === 1);
    check('an invalid outcome for a catalyst -> 409', (await an.post(`${R}/entries/${c1.body.data.id}/resolve`, { status: 'MITIGATED', note: 'wrong kind' })).status === 409);
    const rs = await an.post(`${R}/entries/${c1.body.data.id}/resolve`, { status: 'OCCURRED', note: 'Results published on the day' });
    check('a catalyst is resolved with a note and resolver', rs.status === 200 && rs.body.data.status === 'OCCURRED' && rs.body.data.resolutionNote === 'Results published on the day' && rs.body.data.resolvedByName === 'RD an', rs.body);
    check('resolving twice -> 409; audited', (await an.post(`${R}/entries/${c1.body.data.id}/resolve`, { status: 'MISSED', note: 'again' })).status === 409 && (await auditCount('research.catalyst_resolved', c1.body.data.id)) === 1);

    // ================================================================ FR-RES-007 valuation
    console.log('\nFR-RES-007: valuation model with ranges, versions and target');
    const kase = await an.post(`${R}/cases`, { securityId: s1.id, title: `Valuation case ${run}`, thesis: 'A thesis of more than twenty characters for the case.', rating: 'BUY', targetPrice: '14.00' }, key('c0'));
    const CASE = kase.body?.data;
    if (CASE) caseIds.push(CASE.id);
    check('case created as the analyst', kase.status === 201 && CASE?.status === 'DRAFT', kase.body);
    const vb = (over: Record<string, unknown> = {}) => ({ inputs: { ...goodInputs, ...over }, note: 'Initial assumptions' });
    check('an auditor cannot save a model -> 403', (await aud.put(`${R}/cases/${CASE.id}/valuation`, vb(), key('v0'))).status === 403);
    check('growth above 500% -> 400', (await an.put(`${R}/cases/${CASE.id}/valuation`, vb({ growthPct: { low: 5, base: 10, high: 501 } }), key('v1'))).status === 400);
    check('margin above 100% -> 400', (await an.put(`${R}/cases/${CASE.id}/valuation`, vb({ marginPct: { low: 8, base: 11, high: 101 } }), key('v2'))).status === 400);
    check('discount above 50% -> 400', (await an.put(`${R}/cases/${CASE.id}/valuation`, vb({ discountPct: { low: 14, base: 17, high: 51 } }), key('v3'))).status === 400);
    check('a target override of zero -> 400', (await an.put(`${R}/cases/${CASE.id}/valuation`, { ...vb(), targetPrice: 0 }, key('v4'))).status === 400);
    const v1 = await an.put(`${R}/cases/${CASE.id}/valuation`, vb(), key('v5'));
    const cur1 = v1.body?.data?.current;
    check('the first save creates version 1 with low <= target <= high and the upside against the latest price', v1.status === 201 && v1.body.data.currentVersion === 1 && Number(cur1.lowPrice) <= Number(cur1.targetPrice) && Number(cur1.targetPrice) <= Number(cur1.highPrice) && cur1.upsidePct !== null && cur1.authorName === 'RD an', v1.body);
    const v2 = await an.put(`${R}/cases/${CASE.id}/valuation`, { inputs: { ...goodInputs, growthPct: { low: 6, base: 12, high: 15 } }, targetPrice: 15.5, note: 'Raised growth, own target' }, key('v6'));
    check('a second save creates version 2 with the analyst target; versions are listed newest first with author and time', v2.status === 201 && v2.body.data.currentVersion === 2 && v2.body.data.current.targetPrice === '15.500000' && v2.body.data.versions.length === 2 && v2.body.data.versions[1].version === 1 && v2.body.data.versions[0].createdAt, v2.body);
    check('version 1 is unchanged (immutable history)', v2.body.data.versions[1].targetPrice === cur1.targetPrice);
    const cdet = await an.get(`${R}/cases/${CASE.id}`);
    check('the case view carries the model target and upside for the hero', cdet.body?.data?.valuation?.current?.targetPrice === '15.500000' && cdet.body.data.valuation.current.upsidePct === ((15.5 / 11.5 - 1) * 100).toFixed(1), cdet.body?.data?.valuation);
    check('only the author applies the model target to the case -> 403 for another analyst role holder', (await pm.post(`${R}/cases/${CASE.id}/valuation/apply-target`, {})).status === 403);
    const ap = await an.post(`${R}/cases/${CASE.id}/valuation/apply-target`, {});
    check('the author applies it: the draft case target becomes 15.50; audited', ap.status === 200 && (await prisma.researchCase.findUnique({ where: { id: CASE.id } }))?.targetPrice.toFixed(2) === '15.50' && (await auditCount('research.valuation_applied', CASE.id)) === 1, ap.body);
    await an.post(`${R}/cases/${CASE.id}/submit`, {}, key('sub'));
    check('once in review the target cannot be applied -> 409', (await an.post(`${R}/cases/${CASE.id}/valuation/apply-target`, {})).status === 409);

    // ================================================================ FR-PM-002 pipeline
    console.log('\nFR-PM-002: pipeline, diligence case, cashflow scenario');
    const deal = (over: Record<string, unknown> = {}) => ({ name: `Deal ${run}`, sponsor: 'Kopje Partners', strategy: 'PRIVATE_EQUITY', vintage: 2025, currency: 'ZWG', proposedAmount: '2500000', expectedClose: dayStr(60), fairValueLevel: 3, valuationDate: dayStr(-5), ...over });
    check('an auditor cannot create a deal -> 403', (await aud.post(`${P}/pipeline`, deal(), key('d0'))).status === 403);
    check('name required -> 400', (await pm.post(`${P}/pipeline`, deal({ name: '' }), key('d1'))).status === 400);
    check('amount must be above zero -> 400', (await pm.post(`${P}/pipeline`, deal({ proposedAmount: '0' }), key('d2'))).status === 400);
    check('vintage before 1990 -> 400; vintage in the future -> 400', (await pm.post(`${P}/pipeline`, deal({ vintage: 1989 }), key('d3'))).status === 400 && (await pm.post(`${P}/pipeline`, deal({ vintage: new Date().getUTCFullYear() + 1 }), key('d4'))).status === 400);
    check('valuation date in the future -> 400; fair-value level 4 -> 400; level 0 -> 400', (await pm.post(`${P}/pipeline`, deal({ valuationDate: dayStr(3) }), key('d5'))).status === 400 && (await pm.post(`${P}/pipeline`, deal({ fairValueLevel: 4 }), key('d6'))).status === 400 && (await pm.post(`${P}/pipeline`, deal({ fairValueLevel: 0 }), key('d7'))).status === 400);
    check('an unknown currency -> 400', (await pm.post(`${P}/pipeline`, deal({ currency: 'XXX' }), key('d8'))).status === 400);
    const d1 = await pm.post(`${P}/pipeline`, deal(), key('d9'));
    const DEAL = d1.body?.data;
    check('a deal quoted in ZWG is created PMP-#### at SOURCED, owned by its creator', d1.status === 201 && /^PMP-\d{4}$/.test(DEAL?.ref) && DEAL.stage === 'SOURCED' && DEAL.currency === 'ZWG' && DEAL.ownerName === 'RD pm', d1.body);
    check('the saved record appears in the inventory', ((await aud.get(`${P}/pipeline?q=${encodeURIComponent(DEAL.name)}`)).body?.data ?? []).some((x: any) => x.id === DEAL.id));
    check('SOURCED -> IC is not allowed (409)', (await pm.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'IC' })).status === 409);
    check('SOURCED -> SCREENING', (await pm.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'SCREENING' })).body?.data?.stage === 'SCREENING');
    check('declining needs a reason -> 400', (await pm.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'DECLINED' })).status === 400);
    check('SCREENING -> DILIGENCE', (await pm.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'DILIGENCE' })).body?.data?.stage === 'DILIGENCE');
    check('to IC without a completed diligence case -> 409', (await pm.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'IC' })).status === 409);
    check('a diligence case needs a title -> 400', (await pm.post(`${P}/pipeline/${DEAL.id}/diligence`, { title: '' }, key('dc0'))).status === 400);
    const dc = await pm.post(`${P}/pipeline/${DEAL.id}/diligence`, { title: 'Commercial and legal' }, key('dc1'));
    const DC = dc.body?.data;
    check('the case opens as DDC-#### with the 8-item checklist all open', dc.status === 201 && /^DDC-\d{4}$/.test(DC?.ref) && DC.checklist.length === 8 && DC.progress.done === 0, dc.body);
    check('completing with open items -> 409', (await pm.post(`${P}/diligence/${DC.id}/complete`, {}, key('dc2'))).status === 409);
    check('flagging an item without a note -> 400', (await pm.patch(`${P}/diligence/${DC.id}`, { items: [{ key: 'legal', status: 'FLAGGED' }] })).status === 400);
    const allKeys = DC.checklist.map((i: any) => i.key);
    const upd = await pm.patch(`${P}/diligence/${DC.id}`, { items: allKeys.map((k: string) => (k === 'legal' ? { key: k, status: 'FLAGGED', note: 'Side letter gives one investor a fee rebate' } : { key: k, status: 'DONE' })), findings: 'One legal flag.', recommendation: 'PROCEED' });
    check('items updated: 7 done, 1 flagged; the case moves to IN_REVIEW', upd.status === 200 && upd.body.data.progress.done === 8 && upd.body.data.progress.flagged === 1 && upd.body.data.status === 'IN_REVIEW', upd.body);
    check('a flagged item with a plain "proceed" recommendation cannot complete -> 409', (await pm.post(`${P}/diligence/${DC.id}/complete`, {}, key('dc3'))).status === 409);
    await pm.patch(`${P}/diligence/${DC.id}`, { recommendation: 'PROCEED_WITH_CONDITIONS' });
    const done = await pm.post(`${P}/diligence/${DC.id}/complete`, {}, key('dc4'));
    check('with "proceed with conditions" the case completes; audited', done.status === 200 && done.body.data.status === 'COMPLETE' && (await auditCount('pm.diligence_completed', DC.id)) === 1, done.body);
    check('a completed case cannot be edited (409)', (await pm.patch(`${P}/diligence/${DC.id}`, { findings: 'late edit' })).status === 409);
    check('DILIGENCE -> IC now', (await pm.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'IC' })).body?.data?.stage === 'IC');
    const selfAp = await pm.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'APPROVED', note: 'self' });
    check('the owner cannot approve their own deal -> 403 sod_violation', selfAp.status === 403 && errCode(selfAp) === 'sod_violation', selfAp.body);
    const ap2 = await dir.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'APPROVED', note: 'IC carried it' });
    check('a different person approves; decision recorded with who and when', ap2.status === 200 && ap2.body.data.stage === 'APPROVED' && ap2.body.data.decidedByName === 'RD dir' && ap2.body.data.decidedAt, ap2.body);
    check('an approved deal cannot be edited into another stage but CLOSED (SCREENING -> 409)', (await dir.post(`${P}/pipeline/${DEAL.id}/stage`, { stage: 'SCREENING' })).status === 409);
    check('every stage move is audited', (await auditCount('pm.pipeline_stage_changed', DEAL.id)) === 4);
    const sc = (over: Record<string, unknown> = {}) => ({ name: `Base case ${run}`, kind: 'BASE', currency: 'USD', dealId: DEAL.id, flows: [{ date: dayStr(100), kind: 'CALL', amount: '1000000' }, { date: dayStr(400), kind: 'CALL', amount: '500000' }, { date: dayStr(1500), kind: 'DISTRIBUTION', amount: '2400000' }], ...over });
    check('a scenario needs a name -> 400; a single flow -> 400; a zero amount -> 400', (await pm.post(`${P}/scenarios`, sc({ name: '' }), key('s0'))).status === 400 && (await pm.post(`${P}/scenarios`, sc({ flows: [{ date: dayStr(1), kind: 'CALL', amount: '5' }] }), key('s1'))).status === 400 && (await pm.post(`${P}/scenarios`, sc({ flows: [{ date: dayStr(1), kind: 'CALL', amount: '0' }, { date: dayStr(9), kind: 'DISTRIBUTION', amount: '4' }] }), key('s2'))).status === 400);
    check('a scenario without a distribution -> 400', (await pm.post(`${P}/scenarios`, sc({ flows: [{ date: dayStr(1), kind: 'CALL', amount: '5' }, { date: dayStr(2), kind: 'CALL', amount: '6' }] }), key('s3'))).status === 400);
    const s1r = await pm.post(`${P}/scenarios`, sc(), key('s4'));
    check('the scenario is saved as PMS-#### with MOIC 1.60, called 1,500,000, positive IRR, owned by its creator', s1r.status === 201 && /^PMS-\d{4}$/.test(s1r.body?.data?.ref) && s1r.body.data.metrics.moic === '1.60' && s1r.body.data.metrics.called === '1500000.00' && Number(s1r.body.data.metrics.irrPct) > 0 && s1r.body.data.mine === true, s1r.body);
    check('scenarios list by deal; another user sees it as not theirs', (await dir.get(`${P}/scenarios?dealId=${DEAL.id}`)).body?.data?.[0]?.mine === false);
    check('only the owner deletes a scenario -> 403 for another user', (await dir.del(`${P}/scenarios/${s1r.body.data.id}`)).status === 403);
    check('the owner deletes it; audited; it is gone from the list', (await pm.del(`${P}/scenarios/${s1r.body.data.id}`)).status === 200 && (await auditCount('pm.scenario_deleted', s1r.body.data.id)) === 1 && ((await pm.get(`${P}/scenarios?dealId=${DEAL.id}`)).body?.data ?? []).length === 0);
    check('the fund vintage rule matches: 2100 -> 400', (await pm.post(`${P}/funds`, { name: `Fund ${run}`, manager: 'Mgr X', strategy: 'PRIVATE_EQUITY', vintage: 2100 }, key('fv'))).status === 400);

    // ================================================================ portfolios
    console.log('\nFR-PORT-009/010/011: portfolio create with evidence, filters, KPIs, saved views');
    const strat = `Alpha${run}`;
    const pbody = (name: string, risk: string, extra: Record<string, unknown> = {}) => ({ name, type: 'Balanced Fund', baseCurrency: 'USD', strategy: strat, riskProfile: risk, status: 'Setup', managerUserId: pmU.id, ...extra });
    check('an auditor cannot create a portfolio -> 403', (await aud.post('/api/v1/portfolios', pbody(`RD A ${run}`, 'HIGH'), key('p0'))).status === 403);
    check('an invalid risk profile -> 400', (await pm.post('/api/v1/portfolios', pbody(`RD A ${run}`, 'WILD'), key('p1'))).status === 400);
    const fdA = new FormData();
    fdA.set('payload', JSON.stringify(pbody(`RD A ${run}`, 'HIGH', { evidenceKind: 'MANDATE' })));
    fdA.set('evidence', file('mandate.pdf', PDF), 'mandate.pdf');
    const pa = await pm.form('/api/v1/portfolios', fdA, key('p2'));
    const PA = pa.body?.data?.portfolio;
    if (PA) pfIds.push(PA.id);
    check('portfolio A is created in Setup with strategy, risk and manager', pa.status === 201 && PA?.status === 'Setup' && PA.strategy === strat && PA.riskProfile === 'HIGH' && PA.managerUserId === pmU.id, pa.body);
    const ev = await aud.get(`/api/v1/portfolios/${PA.id}/evidence`);
    check('the evidence file is in the vault, linked to the portfolio, restricted', ev.status === 200 && ev.body.data.length === 1 && /^DOC-\d+$/.test(ev.body.data[0].documentRef) && ev.body.data[0].version === 1, ev.body);
    if (ev.body?.data?.[0]) docRefs.push(ev.body.data[0].documentRef);
    const edoc = await prisma.document.findFirst({ where: { relatedType: 'portfolio', relatedId: PA.id } });
    check('the vault record is type compliance, classification Restricted', edoc?.type === 'compliance' && edoc.classification === 'Restricted');
    check('evidence download link is issued and audited', (await aud.get(`/api/v1/portfolios/${PA.id}/evidence/${ev.body.data[0].documentRef}/download-url`)).status === 200 && (await auditCount('portfolio.evidence_downloaded', PA.id)) === 1);
    check('a portfolio created in Setup raises 3 real activation tasks', (await prisma.opsTask.count({ where: { sourceRef: { startsWith: `portfolio-activation:${PA.id}:` } } })) === 3);
    const pb = await pm.post('/api/v1/portfolios', pbody(`RD B ${run}`, 'LOW', { status: 'Active', managerUserId: dirU.id }), key('p3'));
    const PB = pb.body?.data?.portfolio;
    if (PB) pfIds.push(PB.id);
    check('portfolio B (no evidence, Active) is created and raises no activation tasks', pb.status === 201 && (await prisma.opsTask.count({ where: { sourceRef: { startsWith: `portfolio-activation:${PB.id}:` } } })) === 0, pb.body);
    const late = await pm.form(`/api/v1/portfolios/${PB.id}/evidence`, (() => { const f = new FormData(); f.set('kind', 'APPROVAL'); f.set('file', file('ok.pdf', PDF), 'approval.pdf'); return f; })(), key('p4'));
    check('evidence can also be added after creation', late.status === 201 && /^DOC-/.test(late.body?.data?.documentRef), late.body);
    if (late.body?.data?.documentRef) docRefs.push(late.body.data.documentRef);

    // positions so the KPIs and the ledger have numbers
    const pos = async (pid: string, secId: string, qty: number) => prisma.portfolioPosition.create({ data: { portfolioId: pid, securityId: secId, quantity: D(qty), avgCost: D('10'), asOf: day(dayStr(-3)) } });
    await pos(PA.id, s1.id, 1000);
    await pos(PA.id, s2.id, 500);
    await pos(PA.id, s3.id, 200);
    await pos(PB.id, s1.id, 3000);
    const lim = await prisma.riskLimit.create({ data: { ref: `LR${run}`, metric: 'SINGLE_NAME_PCT', scopeType: 'FIRM', threshold: D('15'), ownerUserId: dirU.id, makerId: dirU.id, status: 'ACTIVE' } });
    await prisma.riskBreach.create({ data: { limitId: lim.id, portfolioId: PA.id, detectedOn: day(dayStr(-1)), value: D('40'), threshold: D('15'), status: 'OPEN' } });
    await prisma.riskBreach.create({ data: { limitId: lim.id, portfolioId: PB.id, detectedOn: day(dayStr(-1)), value: D('60'), threshold: D('15'), status: 'OPEN' } });
    await prisma.riskBreach.create({ data: { limitId: lim.id, portfolioId: PB.id, detectedOn: day(dayStr(-2)), value: D('61'), threshold: D('15'), status: 'RESOLVED' } });
    const mkPeriod = (pid: string, twr: string, n: number) =>
      prisma.perfPeriod.create({ data: { ref: `PR${run}${n}`, portfolioId: pid, periodStart: day(dayStr(-30)), periodEnd: day(dayStr(-1)), status: 'LOCKED', baseCurrency: 'USD', startValue: D('1000'), endValue: D('1100'), twrPct: D(twr), dayCount: 29, series: [], dataHash: 'x'.repeat(64), makerId: anU.id, checkerId: dirU.id, lockedAt: new Date() } });
    await mkPeriod(PA.id, '10', 1);
    await mkPeriod(PB.id, '20', 2);

    const list = await pm.get(`/api/v1/portfolios?strategy=${strat}&kpis=1`);
    const rows: any[] = list.body?.data ?? [];
    check('the strategy filter returns exactly portfolios A and B', list.status === 200 && rows.length === 2 && list.body.total === 2, list.body);
    check('risk filter HIGH returns only A; risk LOW only B', ((await pm.get(`/api/v1/portfolios?strategy=${strat}&riskProfile=HIGH`)).body.data ?? []).map((r: any) => r.id).join() === PA.id && ((await pm.get(`/api/v1/portfolios?strategy=${strat}&riskProfile=LOW`)).body.data ?? []).map((r: any) => r.id).join() === PB.id);
    check('the manager filter returns only that manager\'s portfolios', ((await pm.get(`/api/v1/portfolios?strategy=${strat}&managerId=${dirU.id}`)).body.data ?? []).map((r: any) => r.id).join() === PB.id);
    const mvA = rows.find((r) => r.id === PA.id)!.marketValueBase;
    const mvB = rows.find((r) => r.id === PB.id)!.marketValueBase;
    const k = list.body.kpis;
    check('Total AUM equals the sum of the rows (base currency USD)', k?.currency === 'USD' && D(k.totalAum).eq(D(mvA).add(D(mvB))), { k, mvA, mvB });
    const exp = D(mvA).mul(10).add(D(mvB).mul(20)).div(D(mvA).add(D(mvB)));
    check('Weighted TWR equals the AUM-weighted return of the locked periods', k?.weightedTwrPct !== null && D(k.weightedTwrPct).sub(exp).abs().lt(D('0.0002')), { k, exp: exp.toFixed(4) });
    check('Open breaches counts only OPEN breaches on the listed portfolios (2, not the resolved one)', k?.openBreaches === 2, k);
    check('KPIs follow the filter: HIGH only gives A\'s AUM and 1 breach', await (async () => { const r = (await pm.get(`/api/v1/portfolios?strategy=${strat}&riskProfile=HIGH&kpis=1`)).body.kpis; return D(r.totalAum).eq(D(mvA)) && r.openBreaches === 1 && D(r.weightedTwrPct).eq(D('10')); })());
    const zw = await pm.post('/api/v1/portfolios', pbody(`RD ZWG ${run}`, 'LOW', { status: 'Active', baseCurrency: 'XQZ' }), key('p5'));
    if (zw.body?.data?.portfolio) pfIds.push(zw.body.data.portfolio.id);
    const kz = (await pm.get(`/api/v1/portfolios?strategy=${strat}&kpis=1`)).body.kpis;
    check('a portfolio whose currency has no FX rate is named and left out of AUM, never guessed', kz.portfolios === 3 && kz.fxMissing.includes('XQZ') && D(kz.totalAum).eq(D(mvA).add(D(mvB))), kz);
    const facets = await pm.get('/api/v1/portfolios/facets');
    check('facets list the strategy, risk profiles and managers present', facets.status === 200 && facets.body.data.strategies.includes(strat) && facets.body.data.riskProfiles.includes('HIGH') && facets.body.data.managers.some((m: any) => m.id === pmU.id), facets.body);

    // ---- saved views
    const V = '/api/v1/views';
    check('an unknown scope -> 400', (await pm.put(V, { scope: 'nope', name: 'x', config: {} })).status === 400);
    check('a view needs a name -> 400; an unknown filter key -> 400', (await pm.put(V, { scope: 'portfolio.list', name: '', config: {} })).status === 400 && (await pm.put(V, { scope: 'portfolio.list', name: 'x', config: { hack: 1 } })).status === 400);
    const sv = await pm.put(V, { scope: 'portfolio.list', name: 'High risk growth', config: { strategy: strat, riskProfile: 'HIGH' }, isDefault: true });
    check('the user saves a portfolio view', sv.status === 200 && sv.body.data.isDefault === true && sv.body.data.config.riskProfile === 'HIGH', sv.body);
    const sv2 = await pm.put(V, { scope: 'portfolio.list', name: 'Low risk', config: { riskProfile: 'LOW' }, isDefault: true });
    const lv = (await pm.get(`${V}?scope=portfolio.list`)).body.data;
    check('only one view is the default; the list restores the saved filters for the same user', lv.length === 2 && lv.filter((x: any) => x.isDefault).length === 1 && lv[0].name === 'Low risk' && lv.find((x: any) => x.name === 'High risk growth').config.strategy === strat, lv);
    check('another user does not see it', (await dir.get(`${V}?scope=portfolio.list`)).body.data.length === 0);
    check('another user cannot delete it -> 404', (await dir.del(`${V}/${sv.body.data.id}`)).status === 404);
    check('the owner deletes it; audited', (await pm.del(`${V}/${sv.body.data.id}`)).status === 200 && (await auditCount('view.deleted', sv.body.data.id)) === 1 && (await pm.get(`${V}?scope=portfolio.list`)).body.data.length === 1);
    void sv2;
    check('re-saving the same name replaces it (no duplicate)', (await pm.put(V, { scope: 'portfolio.list', name: 'Low risk', config: { riskProfile: 'MODERATE' } })).status === 200 && (await pm.get(`${V}?scope=portfolio.list`)).body.data.length === 1);

    // ================================================================ FR-PORT-015 lab scenarios
    console.log('\nFR-PORT-015: save, list, delete scenarios (owner)');
    const L = '/api/v1/portfolio-lab';
    const mdl = await pm.post(`${L}/models`, { name: `Scenario ${run}`, cashTargetPct: '10', weights: [{ securityId: s1.ticker, targetPct: '45' }, { securityId: s2.ticker, targetPct: '45' }] }, key('m1'));
    const MODEL = mdl.body?.data;
    check('the scenario is saved with its weights', mdl.status === 201 && MODEL?.status === 'DRAFT', mdl.body);
    check('mine=1 lists only the user\'s scenarios and flags ownership', (await pm.get(`${L}/models?mine=1`)).body.data.some((m: any) => m.id === MODEL.id && m.mine === true) && !(await dir.get(`${L}/models?mine=1`)).body.data.some((m: any) => m.id === MODEL.id) && (await dir.get(`${L}/models`)).body.data.find((m: any) => m.id === MODEL.id)?.mine === false);
    check('another user cannot delete it -> 403', (await dir.del(`${L}/models/${MODEL.id}`)).status === 403);
    const act = await dir.post(`${L}/models/${MODEL.id}/activate`);
    check('an active scenario cannot be deleted until retired (409)', act.status === 200 && (await pm.del(`${L}/models/${MODEL.id}`)).status === 409);
    const mdl2 = await pm.post(`${L}/models`, { name: `Scenario B ${run}`, cashTargetPct: '10', weights: [{ securityId: s1.ticker, targetPct: '90' }] }, key('m2'));
    const del = await pm.del(`${L}/models/${mdl2.body.data.id}`);
    check('the owner deletes a draft scenario; audited; it is gone', del.status === 200 && (await auditCount('lab.model_deleted', mdl2.body.data.id)) === 1 && (await prisma.modelPortfolio.count({ where: { id: mdl2.body.data.id } })) === 0, del.body);

    // ================================================================ IBOR
    console.log('\nFR-IBOR-002/004/007: SQL paging, async refresh, column chooser');
    const I = '/api/v1/ibor';
    const l1 = await aud.get(`${I}/ledger?portfolioId=${PA.id}&limit=2&offset=0`);
    check('page 1 of the ledger: 2 rows of 3, answered by SQL paging, lines valued', l1.status === 200 && l1.body.paging === 'sql' && l1.body.data.length === 2 && l1.body.total === 3 && l1.body.data.every((r: any) => r.marketValueBase !== null), l1.body);
    const l2 = await aud.get(`${I}/ledger?portfolioId=${PA.id}&limit=2&offset=2`);
    check('page 2 holds the remaining row and no row repeats', l2.body.data.length === 1 && ![...l1.body.data, ...l2.body.data].some((r: any, i: number, a: any[]) => a.findIndex((x) => x.securityId === r.securityId) !== i), l2.body);
    const byIsin = await aud.get(`${I}/ledger?portfolioId=${PA.id}&q=${s2.isin}`);
    check('searching by ISIN finds exactly that line', byIsin.body.total === 1 && byIsin.body.data[0].securityId === s2.id, byIsin.body);
    check('search by ticker and by portfolio name', (await aud.get(`${I}/ledger?portfolioId=${PA.id}&q=${s3.ticker.toLowerCase()}`)).body.total === 1 && (await aud.get(`${I}/ledger?portfolioId=${PA.id}&q=RD%20A`)).body.total === 3);
    check('a "%" in the search is literal, not a wildcard', (await aud.get(`${I}/ledger?portfolioId=${PA.id}&q=%25`)).body.total === 0);
    const fi = await aud.get(`${I}/ledger?portfolioId=${PA.id}&assetClass=${encodeURIComponent('Fixed income')}`);
    check('the asset class filter runs in SQL', fi.body.total === 1 && fi.body.data[0].securityId === s3.id && fi.body.paging === 'sql', fi.body);
    const sd = await aud.get(`${I}/ledger?portfolioId=${PA.id}&sort=quantity&dir=desc`);
    check('sorting by quantity descending', sd.body.data.map((r: any) => r.quantity).join() === ['1000.000000', '500.000000', '200.000000'].join(), sd.body.data.map((r: any) => r.quantity));
    const st = await aud.get(`${I}/ledger?portfolioId=${PA.id}&state=Review`);
    check('the data-state filter falls back to the in-memory path and says so', st.status === 200 && st.body.paging === 'memory', st.body);
    check('a bad sort key -> 400', (await aud.get(`${I}/ledger?sort=hack`)).status === 400);

    check('an auditor (no portfolio.manage) cannot refresh -> 403', (await aud.post(`${I}/refresh`, { portfolioId: PA.id, async: true }, key('r0'))).status === 403);
    const busy = await prisma.iborRefreshJob.create({ data: { portfolioId: PA.id, activeKey: PA.id, status: 'RUNNING', requestedBy: pmU.id, startedAt: new Date() } });
    const r409 = await pm.post(`${I}/refresh`, { portfolioId: PA.id, async: true }, key('r1'));
    check('a refresh of a portfolio already refreshing -> 409 refresh_in_progress', r409.status === 409 && errCode(r409) === 'refresh_in_progress', r409.body);
    check('a whole-book refresh while any refresh runs -> 409', (await pm.post(`${I}/refresh`, { async: true }, key('r2'))).status === 409);
    await prisma.iborRefreshJob.update({ where: { id: busy.id }, data: { status: 'SUCCEEDED', activeKey: null, finishedAt: new Date() } });
    const q1 = await pm.post(`${I}/refresh`, { portfolioId: PA.id, async: true }, key('r3'));
    const JOB = q1.body?.data;
    check('the refresh is queued: 202 with a job id and a QUEUED or RUNNING status', q1.status === 202 && JOB?.id && ['QUEUED', 'RUNNING'].includes(JOB.status), q1.body);
    check('queueing is audited', (await auditCount('ibor.refresh_queued', JOB.id)) === 1);
    let fin2: any = null;
    for (let i = 0; i < 60 && !fin2; i++) {
      await sleep(500);
      const j = (await aud.get(`${I}/refresh-jobs/${JOB.id}`)).body?.data;
      if (j && ['SUCCEEDED', 'FAILED'].includes(j.status)) fin2 = j;
    }
    check('the job finishes SUCCEEDED with timing, a snapshot and the counts', fin2?.status === 'SUCCEEDED' && fin2.startedAt && fin2.finishedAt && fin2.snapshotId && fin2.result?.lotsOpened === 3 && fin2.durationMs >= 0, fin2);
    check('the snapshot exists and the lots were built', (await prisma.iborSnapshot.count({ where: { id: fin2?.snapshotId ?? '-' } })) === 1 && (await prisma.iborLot.count({ where: { portfolioId: PA.id } })) === 3);
    check('the job lock is released: a new refresh is accepted', (await prisma.iborRefreshJob.findUnique({ where: { id: JOB.id } }))?.activeKey === null && (await pm.post(`${I}/refresh`, { portfolioId: PA.id, async: true }, key('r4'))).status === 202);
    for (let i = 0; i < 60; i++) {
      if (!(await prisma.iborRefreshJob.count({ where: { status: { in: ['QUEUED', 'RUNNING'] }, portfolioId: PA.id } }))) break;
      await sleep(500);
    }
    check('jobs list newest first', (await aud.get(`${I}/refresh-jobs?limit=5`)).body.data[0].requestedAt >= JOB.requestedAt);
    const stale = await prisma.iborRefreshJob.create({ data: { portfolioId: null, activeKey: 'ALL', status: 'RUNNING', requestedBy: pmU.id, requestedAt: new Date(Date.now() - 30 * 60_000), startedAt: new Date(Date.now() - 30 * 60_000) } });
    const sl = (await aud.get(`${I}/refresh-jobs/${stale.id}`)).body.data;
    check('a job lost in a restart is marked FAILED and releases its lock', sl.status === 'FAILED' && /did not finish/.test(sl.error) && (await prisma.iborRefreshJob.findUnique({ where: { id: stale.id } }))?.activeKey === null, sl);
    const sync = await pm.post(`${I}/refresh`, { portfolioId: PB.id }, key('r5'));
    check('the synchronous call still works and answers 201', sync.status === 201 && sync.body.data.ref, sync.body);

    const C = '/api/v1/views';
    check('a column chooser needs at least one group; unknown groups are refused', (await aud.put(C, { scope: 'ibor.columns', name: 'default', config: { groups: [] } })).status === 400 && (await aud.put(C, { scope: 'ibor.columns', name: 'default', config: { groups: ['nope'] } })).status === 400);
    const cc = await aud.put(C, { scope: 'ibor.columns', name: 'default', config: { groups: ['position', 'cost'] }, isDefault: true });
    check('the column groups are saved for the user', cc.status === 200 && cc.body.data.config.groups.join() === 'position,cost', cc.body);
    check('they persist across sessions (a fresh sign-in reads them back) and are private', await (async () => { const again = client(); await again.login(audU.email); const g = (await again.get(`${C}?scope=ibor.columns`)).body.data; return g.length === 1 && g[0].config.groups.join() === 'position,cost' && (await pm.get(`${C}?scope=ibor.columns`)).body.data.length === 0; })());
    check('a user without portfolio.view cannot save or read column choices -> 403', (await set.put(C, { scope: 'ibor.columns', name: 'default', config: { groups: ['position'] } })).status === 403 && (await set.get(`${C}?scope=ibor.columns`)).status === 403);

    // ================================================================ FR-PERF-006 markers
    console.log('\nFR-PERF-006: chart event markers');
    const jr = await prisma.cashJournal.create({ data: { ref: `CJ-R${run}`.slice(0, 16), portfolioId: PA.id, entryDate: day(dayStr(-10)), description: 'Client top-up', purpose: 'CLIENT_DEPOSIT', currency: 'USD', status: 'POSTED', totalDebit: D('50000'), totalCredit: D('50000'), makerId: opsU.id } });
    const rbm = await prisma.modelPortfolio.findFirstOrThrow({ where: { id: MODEL.id } });
    const rb = await prisma.plRebalance.create({ data: { ref: `RB-R${run}`.slice(0, 16), portfolioId: PA.id, modelId: rbm.id, status: 'PROPOSED', driftThresholdPct: D('1'), totalValueBase: D('100000'), baseCurrency: 'USD', constraints: [], turnoverPct: D('7.5'), cashAfterPct: D('10'), createdBy: pmU.id, createdAt: new Date(`${dayStr(-6)}T10:00:00.000Z`) } });
    const icCase = CASE.id;
    const ic = await prisma.icDecision.create({ data: { ref: `ICD-R${run}`.slice(0, 16), caseId: icCase, portfolioId: PA.id, securityId: s1.id, action: 'BUY', quantity: D('100'), rationale: 'Chart marker test decision.', status: 'APPROVED', proposerId: pmU.id, ratifiedBy: dirU.id, ratifiedAt: new Date(`${dayStr(-3)}T09:00:00.000Z`) } });
    const ev2 = await aud.get(`/api/v1/performance/events?portfolioId=${PA.id}&from=${dayStr(-20)}&to=${dayStr(-1)}`);
    const kinds = (ev2.body?.data ?? []).map((x: any) => x.kind);
    check('the window returns a cash flow, a rebalance and an IC decision in date order', ev2.status === 200 && kinds.join() === 'CASH_FLOW,REBALANCE,IC_DECISION', ev2.body);
    const byKind = (kd: string) => (ev2.body?.data ?? []).find((x: any) => x.kind === kd);
    check('each marker has a label, a date and a link to its own record', /Deposit USD 50000\.00/.test(byKind('CASH_FLOW')?.label) && byKind('CASH_FLOW').href === `/ops/cash?journal=${jr.id}` && byKind('REBALANCE').href === `/ops/portfolio-lab?rebalance=${rb.id}` && byKind('IC_DECISION').href === `/ops/research?decision=${ic.id}` && /BUY/.test(byKind('IC_DECISION').label) && byKind('REBALANCE').date === dayStr(-6), ev2.body);
    const narrow = await aud.get(`/api/v1/performance/events?portfolioId=${PA.id}&from=${dayStr(-5)}&to=${dayStr(-1)}`);
    check('markers outside the window are left out', narrow.body.data.length === 1 && narrow.body.data[0].kind === 'IC_DECISION', narrow.body);
    check('an unknown portfolio -> 400', (await aud.get(`/api/v1/performance/events?portfolioId=nope&from=${dayStr(-5)}&to=${dayStr(-1)}`)).status === 400);
  } finally {
    // best-effort cleanup of rows with foreign keys or unique refs; the schema is disposable anyway
    await prisma.icDecision.deleteMany({ where: { ref: `ICD-R${run}`.slice(0, 16) } }).catch(() => undefined);
    await prisma.plRebalance.deleteMany({ where: { ref: `RB-R${run}`.slice(0, 16) } }).catch(() => undefined);
    await prisma.perfPeriod.deleteMany({ where: { portfolioId: { in: pfIds } } }).catch(() => undefined);
    await prisma.riskBreach.deleteMany({ where: { portfolioId: { in: pfIds } } }).catch(() => undefined);
    await prisma.riskLimit.deleteMany({ where: { ref: `LR${run}` } }).catch(() => undefined);
    await prisma.iborRefreshJob.deleteMany({ where: { requestedBy: { in: userIds } } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    console.log('\n(throwaway records are left in the disposable schema; sessions, refresh jobs, periods and breaches removed where possible)');
    void caseIds;
    void docRefs;
    void secIds;
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
