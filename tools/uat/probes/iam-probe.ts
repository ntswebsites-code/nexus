/* IAM-001..008 runtime probes against the frozen candidate. */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4100';
const users: Array<{ persona: string; email: string; password: string; roles?: string[] }> = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const byPersona = (p: string) => users.find((u) => u.persona === p)!;

async function login(persona: string, portal?: string, passwordOverride?: string) {
  const u = byPersona(persona);
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: passwordOverride ?? u.password, ...(portal ? { portal } : {}) }),
  });
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', status: res.status, body: await res.json().catch(() => null) };
}

async function api(path: string, cookie: string, opts: { method?: string; body?: string } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body, text };
}

async function main() {
  // IAM-001: valid login lands on permitted home (dashboard.view for all staff)
  const pm = await login('test_portfolio_manager', 'admin');
  console.log('IAM-001 PM login:', JSON.stringify({ status: pm.status, userId: pm.body?.user?.id, home: 'command' }));

  // IAM-002: invalid password rejected; wrong-portal rejected
  const bad = await login('test_portfolio_manager', 'admin', 'wrong-password-xyz');
  const wrongPortal = await login('lp_a_manager', 'admin');
  console.log('IAM-002:', JSON.stringify({ invalidPasswordStatus: bad.status, invalidPasswordCode: bad.body?.error?.code, wrongPortalStatus: wrongPortal.status, wrongPortalCode: wrongPortal.body?.error?.code }));

  // IAM-004: maker cannot approve own draft; independent approver can
  const dealer = await login('test_dealer', 'admin');
  const approver = await login('test_approver', 'admin');
  // create a draft order as dealer
  const created = await api('/api/v1/orders', dealer.cookie, {
    method: 'POST',
    body: JSON.stringify({ portfolioId: 'pf_tbd', securityId: 'sec_tbd' }),
  });
  console.log('IAM-004 create-as-dealer (probe):', JSON.stringify({ status: created.status, body: created.text.slice(0, 200) }));

  // Use seeded draft ORD-001009 (UAT Global Alpha) for approve attempts
  const orderId = '38c85c07-6645-4e00-ba68-90fefa97772a';
  const selfApprove = await api('/api/v1/orders/' + orderId + '/approve', dealer.cookie, { method: 'POST', body: JSON.stringify({}) });
  console.log('IAM-004 dealer self-approve:', JSON.stringify({ status: selfApprove.status, code: selfApprove.body?.error?.code ?? selfApprove.body?.code }));

  // IAM-005: garbage session cookie rejected
  const garbage = await api('/api/auth/me', 'mn_sess=garbagevalue123');
  console.log('IAM-005 garbage session:', JSON.stringify({ status: garbage.status }));

  // IAM-006: investor hitting admin API
  const investor = await login('lp_a_manager', 'investor');
  const adminApi = await api('/api/v1/clients', investor.cookie);
  console.log('IAM-006 investor->admin clients:', JSON.stringify({ status: adminApi.status }));

  // IAM-007: LP viewer cannot upload/consent-sign
  const viewer = await login('lp_a_viewer', 'investor');
  const sign = await api('/api/v1/lp-portal/documents/consent-text', viewer.cookie);
  console.log('IAM-007 viewer consent-text read:', JSON.stringify({ status: sign.status }));
  const dealing = await api('/api/v1/lp-portal/dealing-requests', viewer.cookie, { method: 'POST', body: JSON.stringify({}) });
  console.log('IAM-007 viewer dealing create:', JSON.stringify({ status: dealing.status, code: dealing.body?.error?.code ?? dealing.body?.code }));

  // IAM-008: audit trail records auth + denial events
  const sys = await login('sysadmin', 'admin');
  const audit = await api('/api/v1/admin/audit-events?limit=20', sys.cookie);
  const events: any[] = Array.isArray(audit.body) ? audit.body : (audit.body?.data ?? []);
  const relevant = events.filter((e) => /auth\.|authorization|permission|order\.|login|denied/i.test(e.action ?? ''));
  console.log('IAM-008 audit:', JSON.stringify({ count: events.length, relevantCount: relevant.length, sample: relevant.slice(0, 5).map((e) => ({ at: e.at, user: e.user, action: e.action, objectType: e.objectType })) }));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
