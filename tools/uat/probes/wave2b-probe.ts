/* Wave 2 Part B: ORD golden order lifecycle, PM, FIN, PER, RSK, CA, ONB. */
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
  const dealer = await login('test_dealer', 'admin');
  const approver = await login('test_approver', 'admin');
  const fa = await login('test_fund_accountant', 'admin');
  const comp = await login('compliance', 'admin');
  const pm = await login('test_portfolio_manager', 'admin');
  const ops = await login('operations', 'admin');

  // ---------- ORD: golden order lifecycle (F04) ----------
  {
    // pick a portfolio/security; use limit near last price to avoid override noise
    const secs = await api('/api/v1/securities?limit=5', pm.cookie);
    const items: any[] = secs.body?.data ?? [];
    const sec = items[0];
    const ports = await api('/api/v1/portfolios', pm.cookie);
    const pItems: any[] = ports.body?.data ?? [];
    const port = pItems.find((p) => p.ref === 'PF-1002') ?? pItems[0];
    if (sec && port) {
      const created = await api('/api/v1/orders', dealer.cookie, { method: 'POST', idem: true, body: { portfolioId: port.id, securityId: sec.id, side: 'BUY', quantity: 100, orderType: 'LIMIT', limitPrice: sec.last ?? 2.29, tif: 'DAY', priceOverrideReason: 'UAT golden order lifecycle probe' } });
      const order = D(created.body);
      results['ORD-001 create draft'] = { status: created.status, ref: order?.ref, state: order?.status, msg: msg(created) };
      if (order?.id) {
        const pre = await api('/api/v1/orders/' + order.id + '/validate', dealer.cookie, { method: 'POST', idem: true, body: {} });
        results['ORD-002 precheck'] = { status: pre.status, overall: D(pre.body)?.overall ?? null };
        const sub = await api('/api/v1/orders/' + order.id + '/submit', dealer.cookie, { method: 'POST', idem: true, body: { rationale: 'UAT golden order probe' } });
        results['ORD-004 submit'] = { status: sub.status, state: D(sub.body)?.status ?? null, msg: msg(sub) };
        const appr = await api('/api/v1/orders/' + order.id + '/approve', approver.cookie, { method: 'POST', idem: true, body: {} });
        results['ORD-006 approve'] = { status: appr.status, state: D(appr.body)?.status ?? null, msg: msg(appr) };
        const f1 = await api('/api/v1/orders/' + order.id + '/fills', dealer.cookie, { method: 'POST', idem: true, body: { quantity: 60, price: 10, fees: 5, source: 'CONTRACT_NOTE', sourceRef: 'UAT-FILL-1' } });
        results['ORD-008 partial fill 1'] = { status: f1.status, filled: D(f1.body)?.filledQuantity ?? null, msg: msg(f1) };
        const f2 = await api('/api/v1/orders/' + order.id + '/fills', dealer.cookie, { method: 'POST', idem: true, body: { quantity: 40, price: 10, fees: 5, source: 'CONTRACT_NOTE', sourceRef: 'UAT-FILL-2' } });
        results['ORD-008 partial fill 2'] = { status: f2.status, filled: D(f2.body)?.filledQuantity ?? null, state: D(f2.body)?.status ?? null, msg: msg(f2) };
        const det = await api('/api/v1/orders/' + order.id, dealer.cookie);
        results['ORD final state'] = { status: det.status, state: D(det.body)?.status ?? null, fills: D(det.body)?.fills?.length ?? (D(det.body)?._count?.fills ?? null) };
      }
    }
  }

  // ---------- PM: commitment, capital call, distribution ----------
  {
    const summary = await api('/api/v1/private-markets/summary', pm.cookie);
    results['PM summary'] = { status: summary.status, keys: summary.body?.data ? Object.keys(summary.body.data).slice(0, 8) : null };
    const funds = await api('/api/v1/private-markets/funds', pm.cookie);
    const fundItems: any[] = funds.body?.data ?? [];
    results['PM funds'] = { status: funds.status, count: fundItems.length, sample: fundItems.slice(0, 3).map((f) => `${f.ref ?? f.id}:${f.name}`) };
    if (fundItems[0]) {
      const fid = fundItems[0].id ?? fundItems[0].ref;
      const calls = await api('/api/v1/financing/calls?limit=5', fa.cookie);
      results['PM capital calls'] = { status: calls.status, count: Array.isArray(calls.body?.data) ? calls.body.data.length : null };
    }
    const look = await api('/api/v1/private-markets/lookthrough', pm.cookie);
    results['PM lookthrough'] = { status: look.status, rows: Array.isArray(look.body?.data) ? look.body.data.length : null };
  }

  // ---------- FIN: facility check + monitor ----------
  {
    const facs = await api('/api/v1/financing/facilities', fa.cookie);
    const items: any[] = facs.body?.data ?? [];
    results['FIN facilities'] = { status: facs.status, count: items.length, sample: items.slice(0, 3).map((f) => `${f.ref}:${f.name}:${f.status}`) };
    if (items[0]) {
      const check = await api('/api/v1/financing/facilities/' + items[0].id + '/check', fa.cookie, { method: 'POST', idem: true, body: {} });
      results['FIN facility check'] = { status: check.status, msg: msg(check), result: D(check.body) ? Object.keys(D(check.body)).slice(0, 6) : null };
    }
    const mon = await api('/api/v1/financing/monitor', fa.cookie);
    results['FIN monitor'] = { status: mon.status, keys: mon.body?.data ? Object.keys(mon.body.data).slice(0, 8) : null };
  }

  // ---------- PER: performance ----------
  {
    const summary = await api('/api/v1/performance/summary', pm.cookie);
    results['PER summary'] = { status: summary.status, keys: summary.body?.data ? Object.keys(summary.body.data).slice(0, 8) : null };
    const returns = await api('/api/v1/performance/returns', pm.cookie);
    results['PER returns'] = { status: returns.status, rows: Array.isArray(returns.body?.data) ? returns.body.data.length : null };
    const periods = await api('/api/v1/performance/periods', pm.cookie);
    results['PER periods'] = { status: periods.status, rows: Array.isArray(periods.body?.data) ? periods.body.data.length : null };
  }

  // ---------- RSK: limits + monitor ----------
  {
    const limits = await api('/api/v1/risk/limits', pm.cookie);
    const items: any[] = limits.body?.data ?? [];
    results['RSK limits'] = { status: limits.status, count: items.length, sample: items.slice(0, 3).map((l) => `${l.ref ?? l.id}:${l.name ?? l.metric}:${l.status}`) };
    const created = await api('/api/v1/risk/limits', pm.cookie, { method: 'POST', idem: true, body: { name: 'UAT issuer concentration probe', metric: 'ISSUER_CONCENTRATION', limitPct: 10, scope: 'GLOBAL', effectiveFrom: '2026-09-01' } });
    results['RSK limit create'] = { status: created.status, ref: D(created.body)?.ref ?? null, msg: msg(created) };
    const rid = D(created.body)?.id;
    if (rid) {
      const sub = await api('/api/v1/risk/limits/' + rid + '/submit', pm.cookie, { method: 'POST', idem: true, body: {} });
      results['RSK limit submit'] = { status: sub.status };
      const appr = await api('/api/v1/risk/limits/' + rid + '/approve', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['RSK limit approve (independent)'] = { status: appr.status, msg: msg(appr) };
    }
    const mon = await api('/api/v1/risk/monitor', pm.cookie);
    results['RSK monitor'] = { status: mon.status, breaches: Array.isArray(mon.body?.data) ? mon.body.data.length : (mon.body?.data?.breaches ? mon.body.data.breaches.length : null) };
  }

  // ---------- CA: corporate actions ----------
  {
    const events = await api('/api/v1/corporate-actions/events', ops.cookie);
    const items: any[] = events.body?.data ?? [];
    results['CA events'] = { status: events.status, count: items.length, sample: items.slice(0, 3).map((e) => `${e.ref}:${e.type}:${e.status}`) };
    if (items[0]) {
      const id = items[0].id;
      const ent = await api('/api/v1/corporate-actions/events/' + id + '/entitlements/calculate', ops.cookie, { method: 'POST', idem: true, body: {} });
      results['CA entitlements calculate'] = { status: ent.status, msg: msg(ent) };
    }
  }

  // ---------- ONB: public application persistence + submission ----------
  {
    const email = 'wave2b-onb-' + Date.now() + '@example.invalid';
    const create = await fetch(BASE + '/api/v1/public/applications', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, applicantType: 'Pension Fund', name: 'UAT Wave2 Pension Trust', sendLink: false }),
    });
    const draft = await create.json().catch(() => null);
    const did = (draft?.data ?? draft)?.id;
    const token = (draft?.data ?? draft)?.token;
    results['ONB draft create'] = { status: create.status, draftId: did, tokenIssued: !!token };
    if (did && token) {
      const get1 = await fetch(BASE + '/api/v1/public/applications/' + did, { headers: { 'x-draft-token': token } });
      const g1 = await get1.json().catch(() => null);
      const saved = await fetch(BASE + '/api/v1/public/applications/' + did, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-draft-token': token },
        body: JSON.stringify({ form: { entityName: 'UAT Wave2 Pension Trust', contactName: 'Wave Two', contactEmail: email, ownership: [{ name: 'Owner One', pct: 60 }, { name: 'Owner Two', pct: 40 }] } }),
      });
      results['ONB draft persist+edit'] = { getStatus: get1.status, draftPresent: !!g1, saveStatus: saved.status, msg: saved.status === 200 ? null : (await saved.text()).slice(0, 120) };
      const get2 = await fetch(BASE + '/api/v1/public/applications/' + did, { headers: { 'x-draft-token': token } });
      const g2 = await get2.json().catch(() => null);
      const form2 = (g2?.data ?? g2)?.form ?? (g2?.data ?? g2)?.draft?.form ?? {};
      results['ONB resume after edit'] = { status: get2.status, contactName: form2.contactName ?? null, owners: form2.ownership?.length ?? null };
    }
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/wave2b-probe-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
