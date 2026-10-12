/* NFR-005 follow-up: state-conflict protection (double submit with different keys). */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const BASE = 'http://localhost:4100';
const users = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const fa = users.find((u) => u.persona === 'test_fund_accountant');
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: fa.email, password: fa.password, portal: 'admin' }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
const api = async (path, opts = {}) => {
  const headers = { cookie };
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 150); }
  return { status: res.status, body };
};
const D = (b) => b?.data ?? b;
const ledgers = await api('/api/v1/cash/ledgers');
const ledger = ledgers.body?.data?.[0];
const created = await api('/api/v1/cash/journals', { method: 'POST', idem: randomUUID(), body: { portfolioId: ledger.portfolioId ?? 'PF-1001', entryDate: '2026-08-31', description: 'NFR-005 state-conflict probe', purpose: 'MANUAL_CORRECTION', lines: [{ ledgerId: ledger.id, debit: 2, memo: 'a' }, { ledgerId: ledger.id, credit: 2, memo: 'b' }] } });
const jid = D(created.body)?.id;
const sub1 = await api('/api/v1/cash/journals/' + jid + '/submit', { method: 'POST', idem: randomUUID(), body: {} });
const sub2 = await api('/api/v1/cash/journals/' + jid + '/submit', { method: 'POST', idem: randomUUID(), body: {} });
const post1 = await api('/api/v1/cash/journals/' + jid + '/post', { method: 'POST', idem: randomUUID(), body: {} });
console.log(JSON.stringify({
  submit1: sub1.status, submit2: sub2.status, submit2Code: sub2.body?.error?.code ?? sub2.body?.code ?? null,
  stateProtected: sub2.status === 409,
  post1SameUser: post1.status, postCode: post1.body?.error?.code ?? null,
}, null, 1));
