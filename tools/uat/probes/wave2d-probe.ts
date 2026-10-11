/* Wave 2 Part D: custodian executions, PM capital call, FIN draw, PER, OPS, CLI/POR verify, AUD export. */
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
  const submitter = await login('custodian_submitter', 'custodian');
  const approver = await login('custodian_approver', 'custodian');
  const fa = await login('test_fund_accountant', 'admin');
  const comp = await login('compliance', 'admin');
  const pm = await login('test_portfolio_manager', 'admin');
  const sys = await login('sysadmin', 'admin');

  // ---------- Custodian: submit execution batch, dedupe, approve ----------
  {
    const exec = {
      tradeRef: 'UAT-CUST-EXEC-1', executionAt: '2026-08-31T15:30:00+02:00', accountRef: 'CUST-CL-00418',
      ticker: 'ZIM.VX', side: 'BUY', quantity: '50', price: '2.29', currency: 'USD', broker: 'UAT Broker',
    };
    const sub = await api('/api/v1/custodian/executions', submitter.cookie, { method: 'POST', idem: true, body: { executions: [exec] } });
    results['CST execution submit'] = { status: sub.status, accepted: D(sub.body)?.accepted ?? null, rejected: D(sub.body)?.rejected ?? null, msg: msg(sub) };
    const sub2 = await api('/api/v1/custodian/executions', submitter.cookie, { method: 'POST', idem: true, body: { executions: [exec] } });
    results['CST duplicate submit (dedupe)'] = { status: sub2.status, accepted: D(sub2.body)?.accepted ?? null, duplicates: D(sub2.body)?.duplicates ?? null, msg: msg(sub2) };
    const list = await api('/api/v1/custodian/executions', submitter.cookie);
    results['CST executions list'] = { status: list.status, count: Array.isArray(list.body?.items) ? list.body.items.length : null };
  }

  // ---------- PM: capital call lifecycle ----------
  {
    const calls = await api('/api/v1/financing/calls', fa.cookie);
    const items: any[] = calls.body?.data ?? [];
    results['PM capital calls'] = { status: calls.status, count: items.length, sample: items.slice(0, 2).map((c) => `${c.ref}:${c.status}:${c.amount}`) };
    const funds = await api('/api/v1/private-markets/funds', pm.cookie);
    const fund = (funds.body?.data ?? [])[0];
    if (fund) {
      const comms = await api('/api/v1/private-markets/funds/' + fund.id + '/commitments', pm.cookie);
      results['PM commitments'] = { status: comms.status, count: Array.isArray(comms.body?.data) ? comms.body.data.length : null };
    }
  }

  // ---------- FIN: draw ----------
  {
    const facs = await api('/api/v1/financing/facilities', comp.cookie);
    const fac = (facs.body?.data ?? [])[0];
    if (fac) {
      const draw = await api('/api/v1/financing/facilities/' + fac.id + '/draw', comp.cookie, { method: 'POST', idem: true, body: { amount: 10000, note: 'UAT F10 test draw', valueDate: '2026-08-31' } });
      results['FIN draw'] = { status: draw.status, msg: msg(draw), data: D(draw.body) ? JSON.stringify(D(draw.body)).slice(0, 180) : null };
    }
  }

  // ---------- PER: returns with params ----------
  {
    const r = await api('/api/v1/performance/returns?portfolioId=PF-1001', pm.cookie);
    results['PER returns (PF-1001)'] = { status: r.status, rows: Array.isArray(r.body?.data) ? r.body.data.length : null, sample: Array.isArray(r.body?.data) ? JSON.stringify(r.body.data.slice(0, 2)).slice(0, 200) : msg(r) };
  }

  // ---------- OPS: settlement tasks ----------
  {
    const tasks = await api('/api/v1/platform-ops/tasks', fa.cookie).catch(() => null);
    const opsTasks = await api('/api/v1/admin-core/ops-health', fa.cookie);
    results['OPS health'] = { status: opsTasks.status, keys: opsTasks.body?.data ? Object.keys(opsTasks.body.data).slice(0, 8) : null };
  }

  // ---------- CLI/POR: client + portfolio verification ----------
  {
    const clients = await api('/api/v1/clients', sys.cookie);
    results['CLI clients'] = { status: clients.status, count: Array.isArray(clients.body?.data) ? clients.body.data.length : null };
    const ports = await api('/api/v1/portfolios', sys.cookie);
    results['POR portfolios'] = { status: ports.status, count: Array.isArray(ports.body?.data) ? ports.body.data.length : null };
  }

  // ---------- AUD: export as auditor-role identity ----------
  {
    const auditor = await login('lp_a_viewer', 'investor');
    const audit = await api('/api/v1/admin/audit-events?limit=5', auditor.cookie);
    results['AUD auditor export (denial)'] = { status: audit.status, code: audit.body?.error?.code ?? null };
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/wave2d-probe-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });

