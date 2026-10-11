/* Wave 3: CON (IC decision + rebalance promotion), MOD (model gov), REG (filing), RPT (report run). */
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

async function api(path: string, cookie: string, opts: { method?: string; body?: unknown; idem?: boolean } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { cookie, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.idem ? { 'Idempotency-Key': randomUUID() } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 250); }
  return { status: res.status, body, text };
}
const D = (b: any) => b?.data ?? b;
const msg = (r: any) => r.body?.error?.message ?? (typeof r.body === 'string' ? r.body.slice(0, 140) : null);
const results: Record<string, unknown> = {};

async function main() {
  const pm = await login('test_portfolio_manager', 'admin');   // CON maker
  const dir = await login('test_approver', 'admin');            // IC approver
  const settings = await login('test_settings_admin', 'admin'); // MOD maker
  const comp = await login('compliance', 'admin');              // MOD validator / REG approver
  const sys = await login('sysadmin', 'admin');
  const rpt = await login('client_services', 'admin');          // reports

  // ---------- CON: research case -> IC decision ----------
  {
    const cases = await api('/api/v1/research/cases', pm.cookie);
    const items: any[] = cases.body?.data ?? [];
    results['CON research cases'] = { status: cases.status, count: items.length, sample: items.slice(0, 2).map((c) => `${c.ref ?? c.id}:${c.title ?? c.subject}:${c.status}`) };
    const c = items.find((x) => (x.status ?? '').toLowerCase().includes('published')) ?? items[0];
    if (c) {
      const dec = await api('/api/v1/research/decisions', dir.cookie, {
        method: 'POST', idem: true,
        body: { caseId: c.id, action: 'BUY', quantity: 100, rationale: 'UAT Wave 3 investment committee decision probe' },
      });
      results['CON IC decision (independent)'] = { status: dec.status, msg: msg(dec), ref: D(dec.body)?.ref ?? D(dec.body)?.id };
    }
    // ---------- CON: rebalance -> promote to real OMS orders ----------
    const rebalances = await api('/api/v1/portfolio-lab/rebalances', pm.cookie);
    const rbItems: any[] = rebalances.body?.data ?? [];
    results['CON rebalances'] = { status: rebalances.status, count: rbItems.length };
    const rb = rbItems.find((r) => (r.status ?? '').toLowerCase().includes('ready') || r.status === 'DRAFT' || !r.status) ?? rbItems[0];
    if (rb) {
      const promote = await api('/api/v1/portfolio-lab/rebalances/' + rb.id + '/orders', pm.cookie, { method: 'POST', idem: true, body: {} });
      results['CON rebalance promote'] = { status: promote.status, msg: msg(promote), created: D(promote.body)?.orders?.length ?? (Array.isArray(D(promote.body)) ? D(promote.body).length : null) };
    }
  }

  // ---------- MOD: model lifecycle ----------
  {
    const models = await api('/api/v1/portfolio-lab/models', pm.cookie);
    const items: any[] = models.body?.data ?? [];
    results['MOD models'] = { status: models.status, count: items.length, sample: items.slice(0, 3).map((m) => `${m.ref ?? m.id}:${m.name ?? ''}:${m.status}`) };
    const created = await api('/api/v1/portfolio-lab/models', pm.cookie, {
      method: 'POST', idem: true,
      body: { name: 'UAT Wave3 Probe Model', description: 'UAT probe model for governance lifecycle', cashTargetPct: 10, weights: [{ securityId: 'cec24b17-6d58-4c23-a2ce-4322e626c1a7', targetPct: 90 }] },
    });
    const m = D(created.body);
    results['MOD model create'] = { status: created.status, ref: m?.ref ?? m?.id, msg: msg(created) };
    if (m?.id) {
      const patch = await api('/api/v1/portfolio-lab/models/' + m.id, pm.cookie, { method: 'PATCH', idem: true, body: { description: 'UAT probe model revised for governance' } });
      results['MOD model revise (version)'] = { status: patch.status, msg: msg(patch) };
      results['MOD model revise'] = 'see revise';
      const appr = await api('/api/v1/portfolio-lab/models/' + m.id + '/activate', pm.cookie, { method: 'POST', idem: true, body: {} });
      results['MOD model approve (independent)'] = { status: appr.status, msg: msg(appr), state: D(appr.body)?.status ?? null };
      // new version invalidates prior approval
      const ver = await api('/api/v1/portfolio-lab/models/' + m.id, pm.cookie, { method: 'PATCH', idem: true, body: { cashTargetPct: 20 } });
      results['MOD post-activation change (invalidation)'] = { status: ver.status, msg: msg(ver), state: D(ver.body)?.status ?? null };
    }
  }

  // ---------- REG: filing populate -> evidence -> submit-review -> approve ----------
  {
    const filings = await api('/api/v1/regulatory/filings', comp.cookie);
    const items: any[] = filings.body?.data ?? [];
    results['REG filings'] = { status: filings.status, count: items.length, sample: items.slice(0, 3).map((f) => `${f.ref}:${f.regulator ?? f.regulatorKey}:${f.status}`) };
    const templates = await api('/api/v1/regulatory/templates', comp.cookie);
    results['REG templates'] = { status: templates.status, count: Array.isArray(templates.body?.data) ? templates.body.data.length : null };
    const f = items.find((x) => (x.status ?? '').toLowerCase().includes('draft'));
    if (f) {
      const pop = await api('/api/v1/regulatory/filings/' + f.id + '/populate', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['REG populate'] = { status: pop.status, msg: msg(pop) };
      const rev = await api('/api/v1/regulatory/filings/' + f.id + '/submit-review', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['REG submit-review'] = { status: rev.status, msg: msg(rev) };
      const appr = await api('/api/v1/regulatory/filings/' + f.id + '/approve', sys.cookie, { method: 'POST', idem: true, body: {} });
      results['REG approve (independent)'] = { status: appr.status, msg: msg(appr) };
      const exp = await api('/api/v1/regulatory/filings/' + f.id + '/export', comp.cookie);
      results['REG export'] = { status: exp.status, contentType: (exp.body && exp.body.format) ?? typeof exp.body };
    }
  }

  // ---------- RPT: runs + distribute ----------
  {
    const runs = await api('/api/v1/reports/runs', rpt.cookie);
    results['RPT runs'] = { status: runs.status, count: Array.isArray(runs.body?.data) ? runs.body.data.length : null, sample: Array.isArray(runs.body?.data) ? runs.body.data.slice(0, 3).map((r) => `${r.ref ?? r.id}:${r.status}`) : null };
    const catalogue = await api('/api/v1/reports/catalogue', rpt.cookie);
    results['RPT catalogue'] = { status: catalogue.status, count: Array.isArray(catalogue.body?.data) ? catalogue.body.data.length : null };
    const run = (runs.body?.data ?? [])[0];
    if (run) {
      const dist = await api('/api/v1/reports/runs/' + run.id + '/distribute', rpt.cookie, { method: 'POST', idem: true, body: { clientIds: ['CL-00418'] } });
      results['RPT distribute'] = { status: dist.status, msg: msg(dist) };
      const link = await api('/api/v1/reports/runs/' + run.id + '/link', rpt.cookie, { method: 'POST', idem: true, body: { documentId: 'DOC-3005' } });
      results['RPT link document'] = { status: link.status, msg: msg(link) };
    }
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/wave3-probe-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });





