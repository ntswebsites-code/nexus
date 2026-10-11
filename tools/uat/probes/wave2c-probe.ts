/* Wave 2 Part B completion: RSK limits (as compliance), FIN facility check, ONB full flow. */
import { readFileSync, writeFileSync } from 'node:fs';
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
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', status: res.status };
}

async function api(path: string, cookie: string, opts: { method?: string; body?: unknown; idem?: boolean; form?: FormData } = {}) {
  const headers: Record<string, string> = { cookie };
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
  const comp = await login('compliance', 'admin');
  const ops = await login('operations', 'admin');
  const sys = await login('sysadmin', 'admin');

  // ---------- RSK: limit create -> submit -> independent approve ----------
  {
    const created = await api('/api/v1/risk/limits', comp.cookie, {
      method: 'POST', idem: true,
      body: { metric: 'SINGLE_NAME_PCT', scopeType: 'FIRM', threshold: 10, ownerUserId: 'ec89196f-4678-4fe2-96d2-c5eed783bf34', breachAction: 'ALERT', description: 'UAT issuer concentration probe' },
    });
    const lim = D(created.body);
    results['RSK limit create'] = { status: created.status, ref: lim?.ref ?? lim?.id, msg: msg(created) };
    const rid = lim?.id;
    if (rid) {
      const sub = await api('/api/v1/risk/limits/' + rid + '/submit', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['RSK limit submit'] = { status: sub.status, state: D(sub.body)?.status ?? null, msg: msg(sub) };
      const selfAppr = await api('/api/v1/risk/limits/' + rid + '/approve', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['RSK limit self-approve (segregation)'] = { status: selfAppr.status, code: selfAppr.body?.error?.code ?? null };
      const appr = await api('/api/v1/risk/limits/' + rid + '/approve', sys.cookie, { method: 'POST', idem: true, body: {} });
      results['RSK limit independent approve'] = { status: appr.status, state: D(appr.body)?.status ?? null, msg: msg(appr) };
    }
  }

  // ---------- FIN: facility check (compliance has financing.manage) ----------
  {
    const facs = await api('/api/v1/financing/facilities', comp.cookie);
    const items: any[] = facs.body?.data ?? [];
    if (items[0]) {
      const check = await api('/api/v1/financing/facilities/' + items[0].id + '/check', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['FIN facility check'] = { status: check.status, msg: msg(check), data: D(check.body) ? JSON.stringify(D(check.body)).slice(0, 220) : null };
    }
    const mon = await api('/api/v1/financing/monitor', ops.cookie);
    results['FIN monitor'] = { status: mon.status, body: typeof mon.body === 'string' ? mon.body.slice(0, 120) : (mon.body?.data ? JSON.stringify(mon.body.data).slice(0, 200) : null) };
  }

  // ---------- ONB: full public flow with form values + readiness ----------
  {
    const email = 'wave2c-onb-' + Date.now() + '@example.invalid';
    const create = await fetch(BASE + '/api/v1/public/applications', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        applicantType: 'Pension Fund',
        name: 'UAT Wave2 Pension Trust',
        form: { entityName: 'UAT Wave2 Pension Trust', contactName: 'Wave Two', contactEmail: email, registration: 'REG-2026-9999', investmentObjective: 'Growth', reportingCurrency: 'USD' },
        sendLink: false,
      }),
    });
    const draft = await create.json().catch(() => null);
    const dd = draft?.data ?? draft ?? {};
    results['ONB draft create'] = { status: create.status, draftId: dd.id, tokenIssued: !!dd.token, entityName: dd.form?.entityName ?? null };
    if (dd.id && dd.token) {
      const get = await fetch(BASE + '/api/v1/public/applications/' + dd.id, { headers: { 'x-draft-token': dd.token } });
      const g = await get.json().catch(() => null);
      results['ONB draft read-back'] = { status: get.status, entityName: (g?.data ?? g)?.form?.entityName ?? null, contactName: (g?.data ?? g)?.form?.contactName ?? null };
      const ready = await fetch(BASE + '/api/v1/public/applications/' + dd.id + '/readiness', { headers: { 'x-draft-token': dd.token } });
      const rb = await ready.json().catch(() => null);
      results['ONB readiness'] = { status: ready.status, missing: (rb?.data ?? rb)?.missing ?? (rb?.data ?? rb)?.required ?? (rb?.data ?? rb)?.requiredCount ?? null, sample: JSON.stringify(rb?.data ?? rb).slice(0, 200) };
    }
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/wave2c-probe-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });

