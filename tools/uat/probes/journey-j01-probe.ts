/* J01: public application -> staff triage -> KYC case workup -> approval -> client activation. */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:4100';
const users: Array<{ persona: string; email: string; password: string }> = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const byPersona = (p: string) => users.find((u) => u.persona === p)!;

async function login(persona: string, portal?: string) {
  const u = byPersona(persona);
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.password, ...(portal ? { portal } : {}) }),
  });
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', status: res.status };
}

async function api(path: string, cookie: string, opts: { method?: string; body?: unknown; idem?: boolean; token?: string; form?: FormData } = {}) {
  const headers: Record<string, string> = { cookie };
  if (opts.token) headers['x-draft-token'] = opts.token;
  if (opts.idem) headers['Idempotency-Key'] = randomUUID();
  if (opts.body !== undefined && !opts.form) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method: opts.method ?? 'GET', headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 250); }
  return { status: res.status, body, text };
}
const D = (b: any) => b?.data ?? b;
const msg = (r: any) => r.body?.error?.message ?? (typeof r.body === 'string' ? r.body.slice(0, 140) : null);
const results: Record<string, unknown> = {};

async function main() {
  const cs = await login('client_services', 'admin');
  const comp = await login('compliance', 'admin');

  // 1. public application (applicant) - durable draft with token
  const email = 'j01-journey-' + Date.now() + '@example.invalid';
  const create = await fetch(BASE + '/api/v1/public/applications', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, applicantType: 'Pension Fund', name: 'UAT J01 Pension Trust', sendLink: false }),
  });
  const draft = D(await create.json().catch(() => null));
  results['J01-1 public draft'] = { status: create.status, draftId: draft?.id, token: !!draft?.token };

  // 2. submit (staff sees it in the queue only after submission)
  if (draft?.id && draft?.token) {
    const sub = await api('/api/v1/public/applications/' + draft.id + '/submit', cs.cookie, { method: 'POST', idem: true, token: draft.token, body: { consent: true, form: { entityName: 'UAT J01 Pension Trust', applicantType: 'Pension Fund', contactName: 'J One', contactEmail: email } } });
    results['J01-2 submit'] = { status: sub.status, msg: msg(sub), publicAppId: D(sub.body)?.publicAppId ?? D(sub.body)?.onboardingApplicationId ?? null };

    // 3. staff queue visibility
    const queue = await api('/api/v1/client-ops/onboarding/queue', cs.cookie);
    const items: any[] = queue.body?.data?.items ?? queue.body?.data ?? [];
    const mine = items.find((q) => JSON.stringify(q).includes(email));
    results['J01-3 staff queue'] = { status: queue.status, queueCount: items.length, visible: !!mine };

    // 4. KYC case for the application
    const cases = await api('/api/v1/kyc/cases', comp.cookie);
    const cItems: any[] = cases.body?.data ?? cases.body?.items ?? [];
    const kyc = cItems.find((c) => JSON.stringify(c).includes('UAT J01')) ?? cItems.find((c) => (c.status ?? '').toLowerCase().includes('active'));
    results['J01-4 KYC case'] = { status: cases.status, caseCount: cItems.length, caseRef: kyc?.ref ?? kyc?.id ?? null, stage: kyc?.stage ?? kyc?.status ?? null };

    if (kyc?.id) {
      const workup = await api('/api/v1/kyc/cases/' + kyc.id, comp.cookie);
      results['J01-4 workup'] = { status: workup.status, stage: D(workup.body)?.stage ?? null };

      // 5. advance stages until activation potential
      let cur = D(workup.body);
      const stageFlow = ['Screening', 'EnhancedReview', 'ComplianceReview', 'Approval'];
      for (const _ of stageFlow) {
        if (!cur?.id) break;
        const adv = await api('/api/v1/kyc/cases/' + cur.id + '/advance', comp.cookie, { method: 'POST', idem: true, body: { decision: 'approve', notes: 'UAT J01 journey approval' } });
        results['J01-5 advance'] = { status: adv.status, stage: D(adv.body)?.stage ?? null, msg: msg(adv) };
        cur = D(adv.body)?.id ? D(adv.body) : cur;
      }
      // 6. activation
      if (cur?.id) {
        const act = await api('/api/v1/kyc/cases/' + cur.id + '/activate', comp.cookie, { method: 'POST', idem: true, body: {} });
        results['J01-6 activate'] = { status: act.status, msg: msg(act), clientId: D(act.body)?.clientId ?? null, detail: D(act.body) ? JSON.stringify(D(act.body)).slice(0, 180) : null };
      }
    }
  }

  // 7. clients after activation
  {
    const clients = await api('/api/v1/clients', cs.cookie);
    const items: any[] = clients.body?.data ?? [];
    results['J01-7 clients'] = { status: clients.status, count: items.length, j01Visible: items.some((c) => JSON.stringify(c).includes('J01')) };
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/j01-journey-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
