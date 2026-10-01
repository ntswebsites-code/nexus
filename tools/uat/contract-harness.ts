/**
 * LP contract harness: signs a persona in to a RUNNING API, calls every read method of the LP
 * Portal contract, calls the investor-web mock (the contract oracle) for the same method, and
 * compares shape (keys, types, list envelope, enum values) plus money values numerically.
 * Read-only: only GETs and the two side-effect-free estimate POSTs are sent.
 *
 *   npx tsx --tsconfig tools/uat/tsconfig.json tools/uat/contract-harness.ts
 *
 * Env:
 *   HARNESS_API          API base URL (default http://127.0.0.1:4158)
 *   HARNESS_ORIGIN       Origin header (default http://localhost:3101, the investor portal)
 *   HARNESS_USERS_FILE   persona credentials file (falls back to SEED_USERS_FILE)
 *   HARNESS_PERSONA      persona key (default lp_a_manager)
 *   HARNESS_VALUES       1/0: compare money values of matched records (default 1 for lp_a_manager, else 0)
 *   HARNESS_REPORT       JSON report path (default <tmp>/nexus-contract-<persona>.json)
 *   HARNESS_STRICT_WARN  1: warnings fail the run too
 *
 * A 503 LP_DOMAIN_NOT_LIVE answer is reported as NOT LIVE, not as a failure. Exit code 1 when
 * any live domain FAILs.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mockLpPortalApi as mock } from '../../portals/investor-web/src/lib/lp-portal/mock-api';
import { getMockStore, MOCK_FUND_IDS } from '../../portals/investor-web/src/lib/lp-portal/mock-store';
import { ApiClient, isNotLive, loadPersonas, login, type ApiResponse } from './lib';

const API = (process.env.HARNESS_API ?? 'http://127.0.0.1:4158').replace(/\/$/, '');
const ORIGIN = process.env.HARNESS_ORIGIN ?? 'http://localhost:3101';
const PERSONA = process.env.HARNESS_PERSONA ?? 'lp_a_manager';
const VALUES = (process.env.HARNESS_VALUES ?? (PERSONA === 'lp_a_manager' ? '1' : '0')) === '1';
const REPORT = process.env.HARNESS_REPORT ?? path.join(tmpdir(), `nexus-contract-${PERSONA}.json`);
const LP = '/api/v1/lp-portal';

type Level = 'FAIL' | 'WARN';
interface Finding {
  level: Level;
  path: string;
  msg: string;
}
type Status = 'PASS' | 'FAIL' | 'NOT_LIVE' | 'ERROR' | 'SKIP';
interface CheckResult {
  domain: string;
  name: string;
  request: string;
  status: Status;
  http?: number;
  findings: Finding[];
  matched?: number;
}

// ---------------------------------------------------------------- comparison rules
const MONEY = /(amount|value|total|paid|commitment|outstanding|balance|net|gross|nav|units|called|uncalled|distributed|contribut|fee|cost|proceeds|cash)/i;
const NOT_MONEY = /(^total$|count|date|at$|id$|percent|pct|ratio|multiple|irr|tvpi|dpi|rvpi|moic|rank|page|size|version|number$|no$)/i;
const STRICT_ENUMS: Record<string, string[]> = {
  lpRole: ['VIEWER', 'SIGNATORY', 'MANAGER'],
  operatingModel: ['PRIVATE_CAPITAL', 'OPEN_ENDED'],
  requestType: ['SUBSCRIPTION', 'REDEMPTION'],
};
const ENUM_KEYS = /^(status|type|category|entryType|valuationStatus|priority|severity|kind|relatedType|authorType|inputMode|redemptionMode|direction|jobType|channel)$/;
const LIST_KEYS = ['items', 'page', 'pageSize', 'total', 'totalPages'];

const naturalKey = (x: any): string | null => {
  if (!x || typeof x !== 'object') return null;
  for (const k of ['reference', 'callNo', 'subject', 'title', 'name', 'maskedAccountNumber', 'accountNumberMasked', 'email', 'fundName']) {
    if (x[k] !== undefined && x[k] !== null && x[k] !== '') return `${k}:${String(x[k]).toLowerCase()}`;
  }
  const type = x.entryType ?? x.type ?? x.requestType ?? '';
  const when = String(x.transactionDate ?? x.date ?? x.requestedDealingDate ?? x.createdAt ?? '').slice(0, 10);
  const amt = Math.abs(Number(x.amount ?? x.netAmount ?? 0)).toFixed(2);
  return type || when ? `${type}|${when}|${amt}` : null;
};

/** Values seen in the mock response for each enum-like key (oracle for non-strict enums). */
function collectEnums(v: unknown, out = new Map<string, Set<string>>()) {
  if (Array.isArray(v)) v.forEach((x) => collectEnums(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && ENUM_KEYS.test(k)) (out.get(k) ?? out.set(k, new Set()).get(k)!).add(x);
      else collectEnums(x, out);
    }
  return out;
}

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const numeric = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN);

function compare(m: unknown, r: unknown, at: string, f: Finding[], enums: Map<string, Set<string>>, values: boolean, key = '') {
  if (m === undefined) return;
  if (r === undefined) return void f.push({ level: 'FAIL', path: at, msg: 'missing key' });
  if (m === null) return;
  if (r === null) return void f.push({ level: 'WARN', path: at, msg: `null where the mock has ${kind(m)}` });
  if (kind(m) !== kind(r)) return void f.push({ level: 'FAIL', path: at, msg: `type ${kind(r)}, mock ${kind(m)}` });

  if (Array.isArray(m) && Array.isArray(r)) {
    if (values && m.length && !r.length) f.push({ level: 'WARN', path: at, msg: `empty list; the mock has ${m.length} records (stub or seed not loaded?)` });
    if (!m.length || !r.length) return;
    const keyed = m.every((x) => naturalKey(x)) && r.every((x) => naturalKey(x));
    if (values && keyed) {
      const byKey = new Map(r.map((x) => [naturalKey(x), x]));
      for (const x of m) {
        const k = naturalKey(x)!;
        const other = byKey.get(k);
        if (other) compare(x, other, `${at}[${k}]`, f, enums, values);
        else f.push({ level: 'WARN', path: `${at}[${k}]`, msg: 'record in mock not returned by API' });
      }
    } else {
      // Shape only: every real element against a mock element of the same natural kind.
      const sample = m[0];
      r.slice(0, 5).forEach((x, i) => compare(sample, x, `${at}[${i}]`, f, enums, false));
    }
    return;
  }
  if (typeof m === 'object' && typeof r === 'object') {
    const ro = r as Record<string, unknown>;
    for (const [k, mv] of Object.entries(m as Record<string, unknown>)) compare(mv, ro[k], at ? `${at}.${k}` : k, f, enums, values, k);
    const extra = Object.keys(ro).filter((k) => !(k in (m as object)));
    if (extra.length) f.push({ level: 'WARN', path: at || '(root)', msg: `extra keys: ${extra.join(', ')}` });
    return;
  }
  if (typeof r === 'string' && key in STRICT_ENUMS && !STRICT_ENUMS[key]!.includes(r)) f.push({ level: 'FAIL', path: at, msg: `enum value "${r}" not in ${STRICT_ENUMS[key]!.join('|')}` });
  else if (typeof r === 'string' && ENUM_KEYS.test(key) && enums.get(key) && !enums.get(key)!.has(r)) f.push({ level: 'WARN', path: at, msg: `enum value "${r}" not seen in mock (${[...enums.get(key)!].join('|')})` });
  if (values && MONEY.test(key) && !NOT_MONEY.test(key)) {
    const a = numeric(m);
    const b = numeric(r);
    if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) > 0.005) f.push({ level: 'FAIL', path: at, msg: `value ${r} != mock ${m}` });
  }
}

// ---------------------------------------------------------------- checks
interface Ctx {
  realFund: Map<string, string>; // mock fund id -> real fund id
  pairs: Map<string, { mockId: string; realId: string }>; // list check name -> first matched pair
}
interface Check {
  domain: string;
  name: string;
  mock: (c: Ctx) => Promise<any> | any;
  real: (c: Ctx) => string | { method: 'POST'; path: string; body: unknown } | null;
  /** Response kind: LP envelope list page (default detection), raw file download, or plain data. */
  file?: boolean;
  /** Remember the first matched record of a list (for the detail check). */
  pair?: (x: any) => string;
}

const { GROWTH, EQUITY } = MOCK_FUND_IDS;
const data = async (p: Promise<any>) => (await p).data;
const fid = (c: Ctx, mockId: string) => c.realFund.get(mockId) ?? '';
const q = (o: Record<string, string | number | undefined>) => {
  const s = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};
const detail = (name: string, prefix: string, suffix = '') => (c: Ctx) => {
  const p = c.pairs.get(name);
  return p ? `${LP}/${prefix}/${encodeURIComponent(p.realId)}${suffix}` : null;
};
const mockPair = (c: Ctx, name: string) => c.pairs.get(name)?.mockId ?? '';
const byId = (x: any) => x.id;

const CHECKS: Check[] = [
  // session
  { domain: 'session', name: 'session', mock: () => data(mock.getSession()), real: () => `${LP}/session` },
  { domain: 'session', name: 'realtime', mock: () => data(mock.getRealtime()), real: () => `${LP}/realtime` },
  { domain: 'session', name: 'notifications', mock: () => data(mock.getNotifications(10)), real: () => `${LP}/notifications?limit=10` },
  // dashboard
  { domain: 'dashboard', name: 'dashboard (consolidated)', mock: () => data(mock.getDashboard()), real: () => `${LP}/dashboard` },
  { domain: 'dashboard', name: 'dashboard (private capital fund)', mock: () => data(mock.getDashboard({ fundId: GROWTH })), real: (c) => `${LP}/dashboard${q({ fundId: fid(c, GROWTH) })}` },
  { domain: 'dashboard', name: 'dashboard (open-ended fund)', mock: () => data(mock.getDashboard({ fundId: EQUITY })), real: (c) => `${LP}/dashboard${q({ fundId: fid(c, EQUITY) })}` },
  { domain: 'dashboard', name: 'dashboard actions', mock: () => data(mock.getDashboardActions()), real: () => `${LP}/dashboard/actions` },
  { domain: 'dashboard', name: 'recent activity', mock: () => data(mock.getDashboardRecentActivity(10)), real: () => `${LP}/dashboard/activity/recent?limit=10` },
  // capital
  { domain: 'capital', name: 'capital calls', mock: () => data(mock.getCapitalCalls()), real: () => `${LP}/capital-calls`, pair: byId },
  { domain: 'capital', name: 'capital call summary', mock: () => data(mock.getCapitalCallSummary(GROWTH)), real: (c) => `${LP}/capital-calls/summary${q({ fundId: fid(c, GROWTH) })}` },
  { domain: 'capital', name: 'capital call detail', mock: (c) => data(mock.getCapitalCall(mockPair(c, 'capital calls'))), real: detail('capital calls', 'capital-calls') },
  { domain: 'capital', name: 'capital call documents', mock: (c) => data(mock.getCapitalCallDocuments(mockPair(c, 'capital calls'))), real: detail('capital calls', 'capital-calls', '/documents') },
  { domain: 'capital', name: 'capital call notice download', file: true, mock: () => null, real: detail('capital calls', 'capital-calls', '/notice/download') },
  { domain: 'capital', name: 'distributions', mock: () => data(mock.getDistributions()), real: () => `${LP}/distributions`, pair: byId },
  { domain: 'capital', name: 'distribution detail', mock: (c) => data(mock.getDistribution(mockPair(c, 'distributions'))), real: detail('distributions', 'distributions') },
  { domain: 'capital', name: 'distribution download', file: true, mock: () => null, real: detail('distributions', 'distributions', '/download') },
  // activity
  { domain: 'activity', name: 'account activity', mock: () => data(mock.getAccountActivity()), real: () => `${LP}/account-activity`, pair: (x) => x.entryId ?? x.id },
  { domain: 'activity', name: 'ledger', mock: () => data(mock.getLedger()), real: () => `${LP}/ledger` },
  { domain: 'activity', name: 'ledger entry', mock: (c) => data(mock.getLedgerEntry(mockPair(c, 'account activity'))), real: detail('account activity', 'ledger') },
  { domain: 'activity', name: 'account activity export', file: true, mock: () => null, real: () => `${LP}/account-activity/export?format=csv` },
  // dealing
  { domain: 'dealing', name: 'bank accounts', mock: () => data(mock.getDealingBankAccounts()), real: () => `${LP}/dealing/bank-accounts` },
  { domain: 'dealing', name: 'dealing overview', mock: () => data(mock.getDealingOverview(EQUITY)), real: (c) => `${LP}/dealing/overview${q({ fundId: fid(c, EQUITY) })}` },
  { domain: 'dealing', name: 'dealing rules', mock: () => data(mock.getDealingRules(EQUITY)), real: (c) => `${LP}/dealing/rules${q({ fundId: fid(c, EQUITY) })}` },
  { domain: 'dealing', name: 'dealing requests', mock: () => data(mock.getDealingRequests()), real: () => `${LP}/dealing/requests` },
  {
    domain: 'dealing',
    name: 'subscription estimate',
    mock: () => data(mock.estimateSubscription({ fundId: EQUITY, shareClass: 'Class A USD', amount: '100000', currency: 'USD' })),
    real: (c) => ({ method: 'POST', path: `${LP}/dealing/subscriptions/estimate`, body: { fundId: fid(c, EQUITY), shareClass: 'Class A USD', amount: '100000', currency: 'USD' } }),
  },
  {
    domain: 'dealing',
    name: 'redemption estimate',
    mock: () => data(mock.estimateRedemption({ fundId: EQUITY, shareClass: 'Class A USD', mode: 'UNITS', units: '1000', earliestDealingDate: '2026-08-01' })),
    real: (c) => ({ method: 'POST', path: `${LP}/dealing/redemptions/estimate`, body: { fundId: fid(c, EQUITY), shareClass: 'Class A USD', mode: 'UNITS', units: '1000', earliestDealingDate: '2026-08-01' } }),
  },
  // performance
  { domain: 'performance', name: 'performance', mock: () => data(mock.getPerformance({ fundId: GROWTH })), real: (c) => `${LP}/performance${q({ fundId: fid(c, GROWTH) })}` },
  { domain: 'performance', name: 'performance history', mock: () => data(mock.getPerformanceHistory({ fundId: GROWTH })), real: (c) => `${LP}/performance/history${q({ fundId: fid(c, GROWTH) })}` },
  { domain: 'performance', name: 'performance by fund', mock: () => data(mock.getPerformanceByFund()), real: () => `${LP}/performance/by-fund` },
  { domain: 'performance', name: 'benchmarks', mock: () => data(mock.getPerformanceBenchmarks({ fundId: GROWTH })), real: (c) => `${LP}/performance/benchmarks${q({ fundId: fid(c, GROWTH) })}` },
  // documents
  { domain: 'documents', name: 'documents', mock: () => data(mock.getDocuments({ pageSize: 50 })), real: () => `${LP}/documents?pageSize=50`, pair: byId },
  { domain: 'documents', name: 'documents summary', mock: () => data(mock.getDocumentsSummary()), real: () => `${LP}/documents/summary` },
  { domain: 'documents', name: 'document detail', mock: (c) => data(mock.getDocument(mockPair(c, 'documents'))), real: detail('documents', 'documents') },
  { domain: 'documents', name: 'document download', file: true, mock: () => null, real: detail('documents', 'documents', '/download') },
  { domain: 'documents', name: 'vault', mock: () => data(mock.getVault({})), real: () => `${LP}/vault`, pair: (x) => x.documentId },
  { domain: 'documents', name: 'vault verify', mock: (c) => data(mock.verifyVaultDocument(mockPair(c, 'vault'))), real: detail('vault', 'vault', '/verify') },
  // notices
  { domain: 'notices', name: 'notices', mock: () => data(mock.getNotices({ pageSize: 50 })), real: () => `${LP}/notices?pageSize=50`, pair: byId },
  { domain: 'notices', name: 'notice detail', mock: (c) => data(mock.getNotice(mockPair(c, 'notices'))), real: detail('notices', 'notices') },
  // requests
  { domain: 'requests', name: 'requests', mock: () => data(mock.getRequests({ pageSize: 50 })), real: () => `${LP}/requests?pageSize=50`, pair: (x) => x.reference },
  { domain: 'requests', name: 'request detail', mock: (c) => data(mock.getRequest(mockPair(c, 'requests'))), real: detail('requests', 'requests') },
  { domain: 'requests', name: 'message threads', mock: () => data(mock.getMessages({ pageSize: 50 })), real: () => `${LP}/messages?pageSize=50`, pair: byId },
  { domain: 'requests', name: 'message thread detail', mock: (c) => data(mock.getMessageThread(mockPair(c, 'message threads'))), real: detail('message threads', 'messages') },
  // organisation
  { domain: 'organisation', name: 'organisation', mock: () => data(mock.getOrganisation()), real: () => `${LP}/organisation` },
  { domain: 'organisation', name: 'colleagues', mock: () => data(mock.getColleagues()), real: () => `${LP}/colleagues` },
  { domain: 'organisation', name: 'bank instruction changes', mock: () => data(mock.getBankInstructionChanges()), real: () => `${LP}/bank-instructions/changes` },
  // settings
  { domain: 'settings', name: 'settings', mock: () => data(mock.getSettings()), real: () => `${LP}/settings` },
  { domain: 'settings', name: 'mfa settings', mock: () => data(mock.getMfaSettings()), real: () => `${LP}/settings/mfa` },
  // reports
  { domain: 'reports', name: 'reports', mock: () => data(mock.getReports()), real: () => `${LP}/reports` },
];

// ---------------------------------------------------------------- run
async function runCheck(api: ApiClient, c: Check, ctx: Ctx): Promise<CheckResult> {
  const req = c.real(ctx);
  const base = { domain: c.domain, name: c.name, findings: [] as Finding[] };
  if (!req) return { ...base, request: '-', status: 'SKIP', findings: [{ level: 'WARN', path: '', msg: 'no matched record to address (list empty, NOT LIVE or unmatched)' }] };
  const label = typeof req === 'string' ? `GET ${req}` : `${req.method} ${req.path}`;
  let res: ApiResponse;
  try {
    res = typeof req === 'string' ? await api.request('GET', req, undefined, {}, !!c.file) : await api.request(req.method, req.path, req.body);
  } catch (err) {
    return { ...base, request: label, status: 'ERROR', findings: [{ level: 'FAIL', path: '', msg: String(err) }] };
  }
  if (isNotLive(res)) return { ...base, request: label, status: 'NOT_LIVE', http: 503 };
  const f = base.findings;
  if (c.file) {
    if (res.status !== 200) f.push({ level: 'FAIL', path: '', msg: `HTTP ${res.status}` });
    else if (!res.bytes) f.push({ level: 'FAIL', path: '', msg: 'empty file' });
    return { ...base, request: label, status: f.some((x) => x.level === 'FAIL') ? 'FAIL' : 'PASS', http: res.status };
  }
  if (res.status !== 200) {
    f.push({ level: 'FAIL', path: '', msg: `HTTP ${res.status} ${res.body?.code ?? ''} ${res.body?.message ?? ''}`.trim() });
    return { ...base, request: label, status: 'FAIL', http: res.status };
  }
  const env = res.body;
  if (env?.success !== true || typeof env?.timestamp !== 'string' || !('data' in env)) f.push({ level: 'FAIL', path: '(envelope)', msg: 'not an LP envelope {success, data, timestamp}' });
  if (!env?.meta?.requestId) f.push({ level: 'WARN', path: '(envelope)', msg: 'meta.requestId missing' });

  let mockData: any;
  try {
    mockData = await c.mock(ctx);
  } catch (err) {
    f.push({ level: 'WARN', path: '', msg: `mock threw: ${String(err)}` });
  }
  const real = env?.data;
  if (mockData && typeof mockData === 'object' && !Array.isArray(mockData) && LIST_KEYS.every((k) => k in mockData)) {
    for (const k of LIST_KEYS) if (!(real && k in real)) f.push({ level: 'FAIL', path: k, msg: 'list envelope key missing' });
  }
  if (mockData !== undefined) compare(mockData, real, '', f, collectEnums(mockData), VALUES);

  let matched: number | undefined;
  if (c.pair) {
    const mItems: any[] = Array.isArray(mockData) ? mockData : (mockData?.items ?? []);
    const rItems: any[] = Array.isArray(real) ? real : (real?.items ?? []);
    const rByKey = new Map(rItems.map((x) => [naturalKey(x), x]));
    matched = 0;
    for (const m of mItems) {
      const r = rByKey.get(naturalKey(m));
      if (!r) continue;
      matched++;
      if (!ctx.pairs.has(c.name) && c.pair(m) && c.pair(r)) ctx.pairs.set(c.name, { mockId: String(c.pair(m)), realId: String(c.pair(r)) });
    }
    if (!ctx.pairs.has(c.name) && rItems.length && mItems.length) {
      ctx.pairs.set(c.name, { mockId: String(c.pair(mItems[0])), realId: String(c.pair(rItems[0])) });
      f.push({ level: 'WARN', path: '', msg: 'no record matched by natural key; detail check uses the first record of each side' });
    }
  }
  const fail = f.some((x) => x.level === 'FAIL') || (process.env.HARNESS_STRICT_WARN === '1' && f.length > 0);
  return { ...base, request: label, status: fail ? 'FAIL' : 'PASS', http: res.status, matched };
}

async function main() {
  const cred = loadPersonas(process.env.HARNESS_USERS_FILE ?? process.env.SEED_USERS_FILE).get(PERSONA);
  if (!cred) throw new Error(`persona "${PERSONA}" not found in the users file`);
  const api = new ApiClient(API, ORIGIN);
  const li = await login(api, cred, 'investor');
  if (!li.ok) throw new Error(`sign-in failed for ${PERSONA}: ${li.reason}`);

  const ctx: Ctx = { realFund: new Map(), pairs: new Map() };
  const session = await api.get(`${LP}/session`);
  const store = getMockStore();
  for (const rf of session.body?.data?.funds ?? []) {
    const mf = store.session.funds.find((x: any) => x.fundName === rf.fundName || x.publicReference === rf.publicReference);
    if (mf) ctx.realFund.set(mf.fundId, rf.fundId);
  }

  const results: CheckResult[] = [];
  for (const c of CHECKS) results.push(await runCheck(api, c, ctx));

  const domains = [...new Set(CHECKS.map((c) => c.domain))].map((d) => {
    const rs = results.filter((r) => r.domain === d);
    const live = rs.filter((r) => r.status !== 'NOT_LIVE' && r.status !== 'SKIP');
    const status = rs.every((r) => r.status === 'NOT_LIVE' || r.status === 'SKIP') && rs.some((r) => r.status === 'NOT_LIVE') ? 'NOT LIVE' : live.some((r) => r.status === 'FAIL' || r.status === 'ERROR') ? 'FAIL' : live.length ? 'PASS' : 'SKIP';
    return {
      domain: d,
      status,
      checks: rs.length,
      pass: rs.filter((r) => r.status === 'PASS').length,
      fail: rs.filter((r) => r.status === 'FAIL' || r.status === 'ERROR').length,
      notLive: rs.filter((r) => r.status === 'NOT_LIVE').length,
      warnings: rs.reduce((n, r) => n + r.findings.filter((x) => x.level === 'WARN').length, 0),
    };
  });

  console.log(`\nLP contract harness - persona ${PERSONA}, API ${API}, values ${VALUES ? 'on' : 'off'}`);
  console.log(`${'domain'.padEnd(14)}${'result'.padEnd(10)}${'checks'.padStart(7)}${'pass'.padStart(6)}${'fail'.padStart(6)}${'notLive'.padStart(9)}${'warn'.padStart(6)}`);
  for (const d of domains) console.log(`${d.domain.padEnd(14)}${d.status.padEnd(10)}${String(d.checks).padStart(7)}${String(d.pass).padStart(6)}${String(d.fail).padStart(6)}${String(d.notLive).padStart(9)}${String(d.warnings).padStart(6)}`);
  for (const r of results.filter((x) => x.status === 'FAIL' || x.status === 'ERROR')) {
    console.log(`\n  FAIL ${r.domain} / ${r.name}  (${r.request})`);
    for (const x of r.findings.filter((y) => y.level === 'FAIL').slice(0, 12)) console.log(`       ${x.path || '(root)'}: ${x.msg}`);
  }

  writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), api: API, persona: PERSONA, values: VALUES, domains, results }, null, 2));
  console.log(`\nreport: ${REPORT}`);
  process.exit(domains.some((d) => d.status === 'FAIL') ? 1 : 0);
}

main().catch((err) => {
  console.error(`[harness] ${err instanceof Error ? err.message : err}`);
  process.exit(2);
});
