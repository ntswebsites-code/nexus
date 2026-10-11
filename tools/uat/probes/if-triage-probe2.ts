/* IF triage probe round 2: onboarding hand-off (IF-02/IF-03), originals (IF-07), cross-scope (IF-13), OMS link (IF-10), filings receipts (IF-12). */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = 'http://localhost:4100';
const users = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8')) as Array<{
  persona: string; email: string; password: string; roles?: string[];
}>;
const byPersona = (p: string) => users.find((u) => u.persona === p)!;

async function session(persona: string, portal?: string) {
  const u = byPersona(persona);
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.password, ...(portal ? { portal } : {}) }),
  });
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', status: res.status };
}

async function api(path: string, cookie: string, opts: { method?: string; body?: string } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, body, text };
}

async function main() {
  // ---- IF-03/IF-02: public draft created server-side, then visible in staff queue
  const draftEmail = 'triage-probe2-' + Date.now() + '@example.invalid';
  const create = await fetch(BASE + '/api/v1/public/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: draftEmail, applicantType: 'Trust / foundation', name: 'UAT Triprobe Trust 2', sendLink: false }),
  });
  const createText = await create.text();
  let draft: any = {};
  try { draft = JSON.parse(createText); } catch { /* ignore */ }
  console.log('IF-02/03 create:', JSON.stringify({ status: create.status, id: draft.id ?? null, token: draft.token ? 'issued' : null, body: createText.slice(0, 200) }));

  if (draft.id && draft.token) {
    // submit the draft (required minimum per submitSchema) -> durable ONB ref + KYC case
    const sub = await fetch(BASE + '/api/v1/public/applications/' + draft.id + '/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-draft-token': draft.token },
      body: JSON.stringify({ form: { entityName: 'UAT Triprobe Trust 2', applicantType: 'Trust / foundation', contactName: 'UAT Triage Probe', contactEmail: draftEmail } }),
    });
    const subText = await sub.text();
    console.log('IF-02/03 submit:', JSON.stringify({ status: sub.status, body: subText.slice(0, 300) }));

    const cs = await session('client_services', 'admin');
    const queue = await api('/api/v1/client-ops/onboarding/queue', cs.cookie);
    const found = queue.text.includes(draft.id) || queue.text.includes(draftEmail);
    console.log('IF-03 handoff:', JSON.stringify({ queueStatus: queue.status, visibleInStaffQueue: found }));
  }

  // ---- IF-07: document download original bytes
  {
    const admin = await session('sysadmin', 'admin');
    const docs = await api('/api/v1/documents', admin.cookie);
    const first = docs.body?.data?.[0];
    console.log('IF-07 doc payload:', JSON.stringify(first).slice(0, 400));
    const versions = first?.versions ?? [];
    const fid = versions[0]?.fileId ?? versions[0]?.file?.id ?? null;
    if (fid) {
      const f = await fetch(BASE + '/api/v1/files/' + fid, { headers: { cookie: admin.cookie } });
      const buf = Buffer.from(await f.arrayBuffer());
      console.log('IF-07 download:', JSON.stringify({ status: f.status, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), head: buf.subarray(0, 8).toString('latin1') }));
    } else {
      console.log('IF-07 download: no fileId in payload shape; versions=' + JSON.stringify(versions).slice(0, 200));
    }
  }

  // ---- IF-13: cross-investor content check
  {
    const a = await session('lp_a_manager', 'investor');
    const b = await session('lp_b_signatory', 'investor');
    const docsA = await api('/api/v1/lp-portal/documents', a.cookie);
    const docsB = await api('/api/v1/lp-portal/documents', b.cookie);
    const idsA = new Set((docsA.body?.data ?? []).map((d: any) => d.id));
    const overlap = (docsB.body?.data ?? []).filter((d: any) => idsA.has(d.id));
    console.log('IF-13 cross-scope:', JSON.stringify({
      aCount: docsA.body?.data?.length ?? 0, bCount: docsB.body?.data?.length ?? 0, overlap: overlap.length,
      bDocs: (docsB.body?.data ?? []).map((d: any) => d.name).slice(0, 5),
    }));
  }

  // ---- IF-10: research case -> linked draft order
  {
    const admin = await session('sysadmin', 'admin');
    const orders = await api('/api/v1/orders', admin.cookie);
    const withSource = (orders.body?.data ?? []).filter((o: any) => o.sourceRefId ?? o.researchCaseId ?? o.sourceType === 'RESEARCH');
    console.log('IF-10 orders:', JSON.stringify({ count: orders.body?.data?.length ?? 0, withResearchLink: withSource.length, sample: JSON.stringify(withSource[0] ?? (orders.body?.data ?? [])[0]).slice(0, 300) }));
  }

  // ---- IF-12: filings with submission receipts
  {
    const admin = await session('sysadmin', 'admin');
    const filings = await api('/api/v1/regulatory/filings', admin.cookie);
    const f0 = filings.body?.data?.[0];
    console.log('IF-12 filing sample:', JSON.stringify(f0).slice(0, 400));
  }

  // ---- IF-01: portals do not reference legacy v33 runtime as live dependency (asset probe)
  {
    const admin = await session('sysadmin', 'admin');
    const calls = await api('/api/v1/admin-core/integrations/calls', admin.cookie);
    console.log('IF-01 integration calls:', JSON.stringify({ status: calls.status, count: Array.isArray(calls.body?.data) ? calls.body.data.length : null, sample: JSON.stringify((calls.body?.data ?? [])[0]).slice(0, 250) }));
  }
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
