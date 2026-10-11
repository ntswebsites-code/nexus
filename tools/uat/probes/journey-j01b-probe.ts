/* J01 complete: public application with evidence -> submit -> triage -> KYC stages -> client. */
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
const msg = (r: any) => r.body?.error?.message ?? (typeof r.body === 'string' ? r.body.slice(0, 160) : null);
const results: Record<string, unknown> = {};

async function main() {
  const cs = await login('client_services', 'admin');
  const comp = await login('compliance', 'admin');

  // 1. public draft
  const email = 'j01b-' + Date.now() + '@example.invalid';
  const create = await fetch(BASE + '/api/v1/public/applications', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, applicantType: 'Pension Fund', name: 'UAT J01b Pension Trust', sendLink: false }),
  });
  const draft = D(await create.json().catch(() => null));
  const token = draft?.token;
  results['J01-1 draft'] = { status: create.status, draftId: draft?.id, token: !!token };

  // 2. upload the four required documents (doc1..doc4 for Pension Fund type)
  if (draft?.id && token) {
    const slots = ['doc1', 'doc9', 'doc4', 'doc10', 'doc2', 'doc5', 'doc3', 'doc6', 'doc7'];
    const uploaded: Record<string, unknown> = {};
    for (const slot of slots) {
      const fd = new FormData();
      const pdf = Buffer.from(`%PDF-1.4 UAT-J01-${slot} original evidence marker endobj trailer<</Root 1 0 R>> %%EOF`, 'latin1');
      fd.append('file', new Blob([pdf], { type: 'application/pdf' }), `uat-j01-${slot}.pdf`);
      fd.append('slot', slot);
      const up = await fetch(BASE + '/api/v1/public/applications/' + draft.id + '/evidence', { method: 'POST', headers: { 'x-draft-token': token }, body: fd });
      uploaded[slot] = up.status;
    }
    results['J01-2 evidence upload'] = uploaded;
  }

  // 3. submit with consent + complete form
  if (draft?.id && token) {
    const sub = await api('/api/v1/public/applications/' + draft.id + '/submit', cs.cookie, {
      method: 'POST', idem: true, token,
      body: {
        consent: true,
        form: {
          formVersion: 'v65',
          legalName: 'UAT J01b Pension Trust', registrationRef: 'REG-J01-001', jurisdiction: 'Zimbabwe',
          registeredAddress: '1 Samora Machel Avenue, Harare, Zimbabwe',
          primaryEmail: email, primaryContact: 'J One',
          sourceFundsNarrative: 'Member pension contributions', expectedActivity: 'Quarterly subscriptions and annual withdrawal claims',
          taxResidence: 'Zimbabwe', bankName: 'Test Bank', bankHolder: 'UAT J01b Pension Trust',
          bankCountry: 'Zimbabwe', bankAccount: 'ZW21TEST000100200300',
          signatureName: 'Auth Signatory One', signatureCapacity: 'Chief Investment Officer',
          investorType: 'Pension / provident fund', relationship: 'LP investor', mandate: 'Matanho Growth Fund I',
        },
        directors: [{ name: 'Director One', role: 'Trustee' }],
        owners: [{ name: 'Beneficial Owner One', pct: 60 }, { name: 'Beneficial Owner Two', pct: 40 }],
        signatories: [{ name: 'Auth Signatory One', role: 'Authorised signatory' }],
      },
    });
    results['J01-3 submit'] = { status: sub.status, msg: msg(sub), detail: sub.body?.error?.details ? JSON.stringify(sub.body.error.details).slice(0, 300) : null, publicAppId: D(sub.body)?.publicAppId ?? null, onboardingRef: D(sub.body)?.onboardingRef ?? D(sub.body)?.ref ?? null };

    // 4. staff queue
    const queue = await api('/api/v1/client-ops/onboarding/queue', cs.cookie);
    const items: any[] = queue.body?.data?.items ?? queue.body?.data ?? [];
    results['J01-4 staff queue'] = { status: queue.status, queueCount: items.length, visible: items.some((q) => JSON.stringify(q).includes(email)) };

    // 5. KYC case
    const cases = await api('/api/v1/kyc/cases', comp.cookie);
    const cItems: any[] = cases.body?.data ?? cases.body?.items ?? (Array.isArray(cases.body) ? cases.body : []);
    const kyc = cItems.find((c) => JSON.stringify(c).includes('J01b')) ?? cItems[0];
    const stageFlow = ['ComplianceReview', 'ClientAction', 'ComplianceReview', 'Approved', 'Activation'];
    results['J01-5 KYC case'] = { status: cases.status, caseCount: cItems.length, ref: kyc?.ref, stage: kyc?.stage ?? kyc?.status };

    // 6. advance the case to activation
    if (kyc?.id) {
      // Screening -> ComplianceReview (advance), then compliance decision (approve), then activate
      const adv = await api('/api/v1/kyc/cases/' + kyc.id + '/advance', comp.cookie, { method: 'POST', idem: true, body: { toStage: 'ComplianceReview', reason: 'UAT J01b journey progression' } });
      results['J01-6 advance to ComplianceReview'] = { status: adv.status, msg: msg(adv) };
      const dec = await api('/api/v1/kyc/cases/' + kyc.id + '/decision', comp.cookie, { method: 'POST', idem: true, body: { decision: 'approve', reason: 'UAT J01b journey: evidence complete, screening clear' } });
      results['J01-6 decision approve'] = { status: dec.status, msg: msg(dec), stage: D(dec.body)?.stage ?? null };
      const act = await api('/api/v1/kyc/cases/' + kyc.id + '/activate', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['J01-7 activate'] = { status: act.status, msg: msg(act), clientId: D(act.body)?.clientId ?? null, detail: D(act.body) ? JSON.stringify(D(act.body)).slice(0, 200) : null };
    }
  }

  // 7. clients after activation
  {
    const clients = await api('/api/v1/clients', cs.cookie);
    const items: any[] = clients.body?.data ?? [];
    results['J01-8 clients'] = { status: clients.status, count: items.length, j01Visible: items.some((c) => JSON.stringify(c).includes('J01b')), names: items.map((c) => c.name) };
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/j01b-journey-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });






