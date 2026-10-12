/* Local NFR-003 concurrency: 25 concurrent users (login limit is 200 in dev). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://localhost:4100';
const users = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const pick = ['sysadmin', 'test_portfolio_manager', 'test_dealer', 'test_approver', 'test_fund_accountant', 'test_settings_admin', 'test_compliance', 'compliance', 'operations', 'analyst', 'client_services', 'investment_director', 'lp_a_manager', 'lp_a_signatory', 'lp_a_viewer', 'lp_b_signatory', 'custodian_submitter', 'custodian_approver', 'investee_101_approver', 'investee_101_contributor', 'investee_101_viewer', 'investee_102_admin', 'local_admin', 'test_custodian_approver', 'sysadmin']
const personas = pick.map((p) => users.find((u) => u.persona === p)).filter(Boolean).slice(0, 25);

const adminEps = ['/api/v1/dashboard/today', '/api/v1/portfolios?kpis=1', '/api/v1/orders?limit=100', '/api/v1/clients', '/api/v1/recon/overview', '/api/v1/documents'];
const investorEps = ['/api/v1/lp-portal/dashboard', '/api/v1/lp-portal/documents', '/api/v1/lp-portal/notices', '/api/v1/lp-portal/capital-activity'];
const custodianEps = ['/api/v1/custodian/dashboard', '/api/v1/custodian/executions', '/api/v1/custodian/notifications'];
const investeeEps = ['/api/v1/investee-portal/dashboard', '/api/v1/investee-portal/reporting/history', '/api/v1/investee-portal/notices'];
const role = (u) => (u.roles?.[0] ?? (/investee/.test(u.email) ? 'company:company' : ''));
const epsFor = (u) => (role(u).startsWith('custodian') ? custodianEps : role(u).startsWith('company') ? investeeEps : role(u).startsWith('investor') ? investorEps : adminEps);
const portalFor = (u) => (role(u).startsWith('custodian') ? 'custodian' : role(u).startsWith('investor') || role(u).startsWith('company') ? 'investor' : 'admin');

const start = performance.now();
const results = await Promise.all(personas.map(async (u, i) => {
  try {
    const l = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password, portal: portalFor(u) === 'investor' && !u.roles?.length ? undefined : portalFor(u) }) });
    if (!l.ok) return { ok: false, stage: 'login', status: l.status };
    const c = l.headers.get('set-cookie')?.split(';')[0] ?? '';
    const eps = epsFor(u);
    const ep = eps[i % eps.length];
    const t0 = performance.now();
    const r = await fetch(BASE + ep, { headers: { cookie: c } });
    const txt = await r.text();
    return { ok: r.ok, stage: 'read', ms: Math.round(performance.now() - t0), status: r.status, body: txt.slice(0, 100) };
  } catch (e) {
    return { ok: false, stage: 'error', err: String(e).slice(0, 80) };
  }
}));
const wall = Math.round(performance.now() - start);
const ok = results.filter((r) => r.ok).length;
const readMs = results.filter((r) => r.stage === 'read').map((r) => r.ms).sort((a, b) => a - b);
const p95 = readMs.length ? readMs[Math.floor(0.95 * readMs.length)] : null;
console.log(JSON.stringify({ users: personas.length, ok, failed: results.map((r, i) => ({ who: personas[i]?.persona ?? personas[i]?.email, ...r })).filter((r) => !r.ok).map((r) => ({ who: r.who, status: r.status })), wallMs: wall, readP95Ms: p95, readMaxMs: readMs[readMs.length - 1] ?? null }, null, 1));
mkdirSync('uat-execution/nfr', { recursive: true });
writeFileSync('uat-execution/nfr/nfr-003-concurrency-local.json', JSON.stringify({ users: personas.length, ok, wallMs: wall, readP95Ms: p95, samples: results }, null, 1));
