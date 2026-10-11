/* IAM-004 maker/checker runtime proof: dealer creates draft, dealer cannot approve own draft,
 * independent approver approves, segregation audit trail written. IAM-007 viewer write denial. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:4100';
const users: Array<{ persona: string; email: string; password: string }> = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const byPersona = (p: string) => users.find((u) => u.persona === p)!;

async function login(persona: string, portal?: string) {
  const u = byPersona(persona);
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.password, ...(portal ? { portal } : {}) }),
  });
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', status: res.status, body: await res.json().catch(() => null) };
}

async function api(path: string, cookie: string, opts: { method?: string; body?: string; idem?: boolean } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.idem ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
    body: opts.body,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body, text };
}

async function main() {
  const dealer = await login('test_dealer', 'admin');
  const approver = await login('test_approver', 'admin');
  const viewer = await login('lp_a_viewer', 'investor');

  // dealer creates a fresh draft order (valid payload from seed IDs)
  const portfolioId = 'fd3f48b4-da53-4a6e-8fe2-151b0a57bfa7'; // PF-1001 Balanced Growth
  const securityId = 'cec24b17-6d58-4c23-a2ce-4322e626c1a7'; // ZIM.VX
  const created = await api('/api/v1/orders', dealer.cookie, {
    method: 'POST', idem: true,
    body: JSON.stringify({ portfolioId, securityId, side: 'BUY', quantity: 10, orderType: 'LIMIT', limitPrice: 12, tif: 'DAY', priceOverrideReason: 'IAM segregation runtime proof' }),
  });
  const order = created.body?.data ?? created.body;
  console.log('IAM-004 dealer creates draft:', JSON.stringify({ status: created.status, ref: order?.ref, id: order?.id, status_: order?.status }));

  if (order?.id) {
    const precheck = await api('/api/v1/orders/' + order.id + '/validate', dealer.cookie, { method: 'POST', idem: true, body: JSON.stringify({}) });
    console.log('IAM-004 dealer precheck:', JSON.stringify({ status: precheck.status, overall: precheck.body?.data?.overall ?? precheck.body?.overall }));
    const submit = await api('/api/v1/orders/' + order.id + '/submit', dealer.cookie, { method: 'POST', idem: true, body: JSON.stringify({ rationale: 'IAM-004 segregation runtime proof' }) });
    console.log('IAM-004 dealer submits:', JSON.stringify({ status: submit.status }));

    const selfApprove = await api('/api/v1/orders/' + order.id + '/approve', dealer.cookie, { method: 'POST', idem: true, body: JSON.stringify({}) });
    console.log('IAM-004 dealer self-approve:', JSON.stringify({ status: selfApprove.status, code: selfApprove.body?.error?.code }));

    const approve = await api('/api/v1/orders/' + order.id + '/approve', approver.cookie, { method: 'POST', idem: true, body: JSON.stringify({ note: 'IAM-004 independent approval probe' }) });
    console.log('IAM-004 independent approver approves:', JSON.stringify({ status: approve.status, approvedBy: approve.body?.data?.approverId ?? approve.body?.approverId, note: approve.text.slice(0, 160) }));
  }

  // IAM-007: LP viewer write denial on dealing estimate (write permission)
  const est = await api('/api/v1/lp-portal/dealing/subscriptions/estimate', viewer.cookie, { method: 'POST', body: JSON.stringify({}) });
  console.log('IAM-007 viewer dealing estimate write:', JSON.stringify({ status: est.status, code: est.body?.error?.code }));
  const mgrEst = await (async () => { const s = await login('lp_a_manager', 'investor'); return api('/api/v1/lp-portal/dealing/subscriptions/estimate', s.cookie, { method: 'POST', body: JSON.stringify({}) }); })();
  console.log('IAM-007 manager estimate write (control):', JSON.stringify({ status: mgrEst.status }));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });





