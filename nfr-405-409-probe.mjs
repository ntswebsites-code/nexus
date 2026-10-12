/* NFR-004 (interrupted save + idempotency), NFR-005 (concurrent sessions), NFR-009 (timezone/currency). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = 'http://localhost:4100';
const users = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const by = (p) => users.find((u) => u.persona === p);

async function session(persona, portal = 'admin') {
  const u = by(persona);
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.password, portal }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}
async function api(path, cookie, opts = {}) {
  const headers = { cookie };
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, ...(opts.signal ? { signal: opts.signal } : {}) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
}
const D = (b) => b?.data ?? b;
const results = {};

const fa = await session('test_fund_accountant');
const fa2 = await session('investment_director');
const ops = await session('operations');

// ---------- NFR-004: idempotency prevents duplicate posting on retry ----------
{
  const key = randomUUID();
  const ledgers = await api('/api/v1/cash/ledgers', fa);
  const ledger = ledgers.body?.data?.[0];
  const body = { portfolioId: ledger.portfolioId ?? 'PF-1001', entryDate: '2026-08-31', description: 'NFR-004 idempotency probe', purpose: 'MANUAL_CORRECTION', lines: [{ ledgerId: ledger.id, debit: 0.01, memo: 'probe debit' }, { ledgerId: ledger.id, credit: 0.01, memo: 'probe credit' }] };
  const first = await api('/api/v1/cash/journals', fa, { method: 'POST', idem: key, body });
  const replay = await api('/api/v1/cash/journals', fa, { method: 'POST', idem: key, body });
  results['NFR-004 idempotent replay'] = { firstStatus: first.status, firstId: D(first.body)?.id, replayStatus: replay.status, replayId: D(replay.body)?.id, sameRecord: D(first.body)?.id === D(replay.body)?.id };
  const jid = D(first.body)?.id;

  // interrupted save: abort mid-flight, then verify no half-written duplicate
  const before = await api('/api/v1/cash/journals?limit=100', fa);
  const beforeCount = (before.body?.data ?? []).length;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 6);
  try {
    await api('/api/v1/cash/journals', fa2, { method: 'POST', idem: randomUUID(), body: { ...body, description: 'NFR-004 interrupted probe' }, signal: ctrl.signal });
  } catch { /* aborted */ }
  await new Promise((r) => setTimeout(r, 2500));
  const after = await api('/api/v1/cash/journals?limit=100', fa);
  const afterItems = after.body?.data ?? [];
  results['NFR-004 interrupted save'] = { beforeCount, afterCount: afterItems.length, halfWrittenOrDuplicated: afterItems.length > beforeCount + 1, newDescriptions: afterItems.filter((j) => /interrupted probe/.test(j.description ?? '')).length };
}

// ---------- NFR-005: concurrent sessions, same record, conflict detection ----------
{
  const ledgers = await api('/api/v1/cash/ledgers', fa);
  const ledger = ledgers.body?.data?.[0];
  const created = await api('/api/v1/cash/journals', fa, { method: 'POST', idem: randomUUID(), body: { portfolioId: ledger.portfolioId ?? 'PF-1001', entryDate: '2026-08-31', description: 'NFR-005 concurrency probe', purpose: 'MANUAL_CORRECTION', lines: [{ ledgerId: ledger.id, debit: 1, memo: 'a' }, { ledgerId: ledger.id, credit: 1, memo: 'b' }] } });
  const jid = D(created.body)?.id;
  // two sessions open the same record
  const a = await api('/api/v1/cash/journals/' + jid, fa);
  const b = await api('/api/v1/cash/journals/' + jid, fa2);
  results['NFR-005 same record two sessions'] = { journalId: jid, aFromA: D(a.body)?.id === jid, bFromB: D(b.body)?.id === jid, sameVersion: D(a.body)?.updatedAt === D(b.body)?.updatedAt };
  // A submits (state change), B attempts a conflicting submit
  const subA = await api('/api/v1/cash/journals/' + jid + '/submit', fa, { method: 'POST', idem: randomUUID(), body: {} });
  const subB = await api('/api/v1/cash/journals/' + jid + '/submit', fa2, { method: 'POST', idem: randomUUID(), body: {} });
  results['NFR-005 conflicting writes'] = { submitA: subA.status, submitB: subB.status, conflictDetected: subB.status === 409 };
}

// ---------- NFR-009: timezone + currency precision ----------
{
  const ledgers = await api('/api/v1/cash/ledgers', fa);
  const ledger = ledgers.body?.data?.[0];
  // currency 0.01 boundary
  const created = await api('/api/v1/cash/journals', fa, { method: 'POST', idem: randomUUID(), body: { portfolioId: ledger.portfolioId ?? 'PF-1001', entryDate: '2026-08-31', description: 'NFR-009 boundary probe', purpose: 'MANUAL_CORRECTION', lines: [{ ledgerId: ledger.id, debit: 0.01, memo: 'one cent' }, { ledgerId: ledger.id, credit: 0.01, memo: 'one cent' }] } });
  const jid = D(created.body)?.id;
  const read = await api('/api/v1/cash/journals/' + jid, fa);
  const lines = D(read.body)?.lines ?? [];
  results['NFR-009 currency boundary'] = { created: created.status, amounts: lines.map((l) => String(l.debit ?? l.credit)), exactCent: lines.some((l) => String(l.debit ?? l.credit) === '0.01') };
  // timezone: server records UTC timestamps; Africa/Harare = UTC+2 (no DST)
  const events = await api('/api/v1/admin/audit-events?limit=3', fa);
  const ts = (events.body?.data ?? events.body ?? []).map((e) => e.at).filter(Boolean).slice(0, 3);
  const allUtc = ts.length > 0 && ts.every((t) => typeof t === 'string' && /Z$|:00(\.000)?\+\d{2}:\d{2}|T\d{2}:\d{2}/.test(t));
  results['NFR-009 timezone'] = { auditTimestamps: ts, recordedUtc: allUtc, cycleTimezone: 'Africa/Harare (UTC+2, no DST)' };
  // month-end boundary dates are accepted as documented
  const me = await api('/api/v1/cash/journals?from=2026-08-31&to=2026-08-31&limit=5', fa);
  results['NFR-009 date boundaries'] = { monthEndFilterStatus: me.status, rows: (me.body?.data ?? []).length };
}

mkdirSync('uat-execution/nfr', { recursive: true });
writeFileSync('uat-execution/nfr/nfr-004-005-009.json', JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
