/* Wave 3 completion: MOD independent activation, rebalance promotion, REG evidence+review, RPT run+distribute. */
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
  const pm = await login('test_portfolio_manager', 'admin');
  const ops = await login('operations', 'admin');       // independent activator
  const comp = await login('compliance', 'admin');
  const sys = await login('sysadmin', 'admin');
  const cs = await login('client_services', 'admin');

  // ---------- MOD: independent activation of the probe model ----------
  {
    const created = await api('/api/v1/portfolio-lab/models', pm.cookie, {
      method: 'POST', idem: true,
      body: { name: 'UAT MOD Activation Probe', description: 'Independent activation probe', cashTargetPct: 5, weights: [{ securityId: 'cec24b17-6d58-4c23-a2ce-4322e626c1a7', targetPct: 95 }] },
    });
    const m = D(created.body);
    results['MOD create (author pm)'] = { status: created.status, ref: m?.ref };
    if (m?.id) {
      const act = await api('/api/v1/portfolio-lab/models/' + m.id + '/activate', ops.cookie, { method: 'POST', idem: true, body: {} });
      results['MOD activate (independent)'] = { status: act.status, state: D(act.body)?.status ?? null, msg: msg(act) };
      const ret = await api('/api/v1/portfolio-lab/models/' + m.id + '/retire', ops.cookie, { method: 'POST', idem: true, body: {} });
      results['MOD retire'] = { status: ret.status, state: D(ret.body)?.status ?? null, msg: msg(ret) };
    }
  }

  // ---------- CON: rebalance creation + promotion to real OMS orders ----------
  {
    const created = await api('/api/v1/portfolio-lab/rebalances', pm.cookie, {
      method: 'POST', idem: true,
      body: { portfolioId: 'PF-1002', modelId: 'PMD-1001' },
    });
    const rb = D(created.body);
    results['CON rebalance create'] = { status: created.status, ref: rb?.ref ?? rb?.id, msg: msg(created) };
    if (rb?.id) {
      const promote = await api('/api/v1/portfolio-lab/rebalances/' + rb.id + '/orders', pm.cookie, { method: 'POST', idem: true, body: {} });
      results['CON rebalance promote to orders'] = { status: promote.status, msg: msg(promote), created: D(promote.body)?.orders?.length ?? (Array.isArray(D(promote.body)) ? D(promote.body).length : null), detail: D(promote.body) ? JSON.stringify(D(promote.body)).slice(0, 200) : null };
    }
  }

  // ---------- REG: attach evidence then submit-review ----------
  {
    const filings = await api('/api/v1/regulatory/filings', comp.cookie);
    const f = (filings.body?.data ?? []).find((x: any) => (x.status ?? '').includes('DRAFT'));
    if (f) {
      const ev = await api('/api/v1/regulatory/filings/' + f.id + '/evidence', comp.cookie, {
        method: 'POST', idem: true,
        form: (() => { const fd = new FormData(); const pdf = Buffer.from('%PDF-1.4 1 0 obj<</Type/Catalog>>endobj trailer<</Root 1 0 R>> %%EOF', 'latin1'); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'uat-filing-evidence.pdf'); fd.append('label', 'UAT evidence probe'); return fd; })()
      });
      results['REG evidence attach'] = { status: ev.status, msg: msg(ev) };
      const rev = await api('/api/v1/regulatory/filings/' + f.id + '/submit-review', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['REG submit-review'] = { status: rev.status, msg: msg(rev), state: D(rev.body)?.status ?? null };
      const inconsistent = await api('/api/v1/regulatory/filings/' + f.id + '/approve', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['REG approve after submit-review'] = { status: inconsistent.status, msg: msg(inconsistent), state: D(inconsistent.body)?.status ?? null };
    }
  }

  // ---------- RPT: create a run from catalogue + distribute ----------
  {
    const cat = await api('/api/v1/reports/catalogue', cs.cookie);
    const defs: any[] = cat.body?.data ?? [];
    results['RPT catalogue'] = { count: defs.length, sample: defs.slice(0, 5).map((d) => `${d.key ?? d.id}:${d.name ?? d.title}`) };
    const created = await api('/api/v1/reports/runs', cs.cookie, {
      method: 'POST', idem: true,
      body: { key: 'HOLDINGS', params: { portfolioId: 'PF-1002', asOf: '2026-08-31' }, format: 'CSV' },
    });
    const run = D(created.body);
    results['RPT run create'] = { status: created.status, ref: run?.ref ?? run?.id, msg: msg(created) };
    if (run?.id) {
      const dist = await api('/api/v1/reports/runs/' + run.id + '/distribute', cs.cookie, { method: 'POST', idem: true, body: { clientIds: ['CL-00418'] } });
      results['RPT distribute'] = { status: dist.status, msg: msg(dist) };
    }
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/wave3b-probe-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });


