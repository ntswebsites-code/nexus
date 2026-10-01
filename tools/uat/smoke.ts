/**
 * UAT smoke suite S1-S12 (DEV-PLAN section 8) against a RUNNING stack. Exit code 1 when any
 * check FAILs; SKIP (domain NOT LIVE, endpoint not built, write step in read-only mode) does not fail.
 *
 *   npx tsx tools/uat/smoke.ts            (from the repo root, or ../../tools/uat/smoke.ts from backend/api)
 *
 * Env:
 *   SMOKE_API            API base URL (required, e.g. http://api:4100 inside the compose network)
 *   SMOKE_USERS_FILE     persona credentials file (falls back to SEED_USERS_FILE)
 *   SMOKE_MODE           readonly (default) | full. full also runs the write steps S8 (acknowledge +
 *                        payment confirmation) and S10 (investee submit + staff accept).
 *   SMOKE_MAILPIT        Mailpit base URL (e.g. http://mailpit:8025); S12 SKIPs when unset
 *   SMOKE_MAIL_TRIGGER   1 (default) sends a password-reset mail to the analyst persona for S12
 *                        (creates a reset token only; the password is unchanged). 0: reachability only.
 *   SMOKE_PORTAL_ADMIN|INVESTOR|ONBOARDING|COMPANY|CUSTODIAN  portal base URLs checked for
 *                        reachability (only those set); defaults http://localhost:3100..3104
 *   SMOKE_ORIGIN_<PORTAL> Origin header per portal; defaults to <PORTAL>_PORTAL_URL (present in the
 *                        container via .env.production), then SMOKE_PORTAL_<PORTAL>
 *   SMOKE_SEED_DATA      dataset used for value checks (default tools/uat/seed-data/uat-seed.json)
 *   SMOKE_REPORT         JSON report path (optional)
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient, errorCode, isNotBuilt, isNotLive, loadPersonas, login, type ApiResponse, type PersonaCredentials } from './lib';
import type { UatSeed } from './seed-types';

const API = (process.env.SMOKE_API ?? '').replace(/\/$/, '');
if (!API) {
  console.error('SMOKE_API is required');
  process.exit(2);
}
const FULL = process.env.SMOKE_MODE === 'full';
const MAILPIT = process.env.SMOKE_MAILPIT?.replace(/\/$/, '');
const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(process.env.SMOKE_SEED_DATA ?? path.join(here, 'seed-data/uat-seed.json'), 'utf8')) as UatSeed;
const PORTALS = {
  admin: process.env.SMOKE_PORTAL_ADMIN ?? 'http://localhost:3100',
  investor: process.env.SMOKE_PORTAL_INVESTOR ?? 'http://localhost:3101',
  onboarding: process.env.SMOKE_PORTAL_ONBOARDING ?? 'http://localhost:3102',
  company: process.env.SMOKE_PORTAL_COMPANY ?? 'http://localhost:3103',
  custodian: process.env.SMOKE_PORTAL_CUSTODIAN ?? 'http://localhost:3104',
} as const;
type Portal = keyof typeof PORTALS;
/** Origin header per portal: must be on the API allow-list, i.e. the public portal URL, not the internal one. */
const origin = (p: Portal) => process.env[`SMOKE_ORIGIN_${p.toUpperCase()}`] ?? process.env[`${p.toUpperCase()}_PORTAL_URL`] ?? PORTALS[p];
const LP = '/api/v1/lp-portal';

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'WARN';
const results: { id: string; name: string; status: Status; detail: string }[] = [];
function record(id: string, name: string, status: Status, detail = '') {
  results.push({ id, name, status, detail });
  console.log(`  ${status.padEnd(4)}  ${id.padEnd(4)} ${name}${detail ? `  - ${detail}` : ''}`);
}
const brief = (r: ApiResponse) => `HTTP ${r.status} ${errorCode(r)}`.trim();

/** LP domain flags from /platform/flags. With the flag off the UI keeps its fixtures, so an empty WS0 stub is not a failure. */
let lpFlags: Record<string, boolean> = {};
function notLive(domain: string, r: ApiResponse | null, empty: boolean): string | null {
  if (!r) return 'no session';
  if (isNotLive(r)) return `${domain} domain NOT LIVE (503)`;
  if (empty && lpFlags[domain] === false) return `${domain} flag off and the API returns no records yet (stub)`;
  return null;
}

let creds: Map<string, PersonaCredentials>;
const sessions = new Map<string, ApiClient | null>();
async function as(persona: string, portal: Portal): Promise<ApiClient | null> {
  const key = `${persona}@${portal}`;
  if (sessions.has(key)) return sessions.get(key)!;
  const cred = creds.get(persona);
  if (!cred) {
    sessions.set(key, null);
    return null;
  }
  const c = new ApiClient(API, origin(portal));
  const r = await login(c, cred, portal === 'company' ? undefined : portal);
  sessions.set(key, r.ok ? c : null);
  if (!r.ok) record('S2', `sign-in ${persona} (${portal})`, 'FAIL', r.reason);
  return r.ok ? c : null;
}

/** Follows one signed-URL redirect hop and checks a non-empty body. */
async function download(c: ApiClient, p: string): Promise<{ ok: boolean; detail: string }> {
  const r = await c.request('GET', p, undefined, {}, true);
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
    const loc = new URL(r.headers.get('location')!, API).toString();
    const f = await fetch(loc);
    const n = (await f.arrayBuffer()).byteLength;
    return { ok: f.ok && n > 0, detail: `redirect -> HTTP ${f.status}, ${n} bytes` };
  }
  if (r.status === 200 && r.headers.get('content-type')?.includes('application/json')) {
    const j = await c.get(p);
    const url = j.body?.data?.url ?? j.body?.url ?? j.body?.data?.downloadUrl;
    if (url) {
      const f = await fetch(new URL(url, API));
      const n = (await f.arrayBuffer()).byteLength;
      return { ok: f.ok && n > 0, detail: `signed url -> HTTP ${f.status}, ${n} bytes` };
    }
  }
  return { ok: r.status === 200 && !!r.bytes, detail: `HTTP ${r.status}, ${r.bytes ?? 0} bytes` };
}

const items = (r: ApiResponse): any[] => (Array.isArray(r.body?.data) ? r.body.data : (r.body?.data?.items ?? []));

async function main() {
  creds = loadPersonas(process.env.SMOKE_USERS_FILE ?? process.env.SEED_USERS_FILE);
  console.log(`\nUAT smoke - API ${API}, mode ${FULL ? 'full' : 'readonly'}\n`);
  const anon = new ApiClient(API, origin('admin'));

  // S1 health, flags, portals
  const h = await anon.get('/api/health?deep=1');
  record('S1', 'API health (deep)', h.status === 200 ? 'PASS' : 'FAIL', `${brief(h)}${h.body?.status ? ` status=${h.body.status}` : ''}`);
  const fl = await anon.get('/api/v1/platform/flags');
  lpFlags = fl.body?.lp ?? {};
  record('S1', 'platform flags', fl.status === 200 && fl.body?.lp ? 'PASS' : 'FAIL', fl.status === 200 ? `LP live: ${Object.entries(fl.body?.lp ?? {}).filter(([, v]) => v).map(([k]) => k).join(',') || 'none'}` : brief(fl));
  record('S1', 'migration version', 'SKIP', 'not exposed by /api/health; deploy.sh records prisma migrate status in migrations-after.txt');
  for (const [name, url] of Object.entries(PORTALS)) {
    if (!process.env[`SMOKE_PORTAL_${name.toUpperCase()}`]) continue;
    try {
      const r = await fetch(url, { redirect: 'manual' });
      record('S1', `portal ${name} reachable`, r.status < 500 ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
    } catch (err) {
      record('S1', `portal ${name} reachable`, 'FAIL', String(err));
    }
  }

  // S2 sign-in per persona type
  const staff = await as('sysadmin', 'admin');
  if (staff) {
    const me = await staff.get('/api/auth/me');
    const roles: any[] = me.body?.user?.roles ?? me.body?.roles ?? [];
    record('S2', 'staff sign-in (sysadmin)', me.status === 200 && roles.some((r) => r.portal === 'admin') ? 'PASS' : 'FAIL', brief(me));
    const ops = await staff.get('/api/v1/ops/health');
    record('S2', 'staff ops console API', ops.status === 200 ? 'PASS' : 'FAIL', `${brief(ops)} live=${ops.body?.live}`);
  } else record('S2', 'staff sign-in (sysadmin)', creds.has('sysadmin') ? 'FAIL' : 'SKIP', creds.has('sysadmin') ? '' : 'persona not in users file');

  const lpA = await as('lp_a_manager', 'investor');
  const sA = lpA ? await lpA.get(`${LP}/session`) : null;
  record('S2', 'LP sign-in (client A manager)', sA?.status === 200 ? 'PASS' : 'FAIL', sA ? brief(sA) : 'sign-in failed');

  const inv = await as('investee_101_contributor', 'company');
  if (inv) {
    const ws = await inv.get('/api/v1/company/workspace');
    record('S2', 'investee sign-in (company 101 contributor)', ws.status === 200 ? 'PASS' : 'FAIL', `${brief(ws)} company=${ws.body?.company?.id ?? ws.body?.company?.name ?? '?'}`);
    const facade = await inv.get('/api/v1/investee-portal/health');
    record('S2', 'investee facade access', facade.status === 200 ? 'PASS' : 'WARN', facade.status === 403 ? `${brief(facade)} - the role catalogue has no company portal role, so CompanyUser members are refused by requirePortalAccess('company')` : brief(facade));
  } else record('S2', 'investee sign-in', 'FAIL', 'sign-in failed');

  const cust = await as('custodian_submitter', 'custodian');
  if (cust) {
    const ch = await cust.get('/api/v1/custodian/health');
    record('S2', 'custodian sign-in (submitter)', ch.status === 200 ? 'PASS' : 'FAIL', `${brief(ch)} live=${ch.body?.live}`);
  } else record('S2', 'custodian sign-in', 'FAIL', 'sign-in failed');

  // S3 LP scoping
  const clientA = seed.clients.find((c) => c.key === 'A')!;
  const clientB = seed.clients.find((c) => c.key === 'B')!;
  const dA = sA?.body?.data;
  record('S3', 'client A session is client A', dA?.client?.investorId === clientA.ref ? 'PASS' : 'FAIL', `investorId=${dA?.client?.investorId ?? '?'}`);
  const lpB = await as('lp_b_signatory', 'investor');
  if (lpB) {
    const sB = await lpB.get(`${LP}/session`);
    record('S3', 'client B session is client B', sB.body?.data?.client?.investorId === clientB.ref ? 'PASS' : 'FAIL', `investorId=${sB.body?.data?.client?.investorId ?? brief(sB)}`);
    const foreign = await lpB.get(`${LP}/session?client=${encodeURIComponent(clientA.ref)}`);
    record('S3', 'client B cannot select client A', foreign.status === 403 || foreign.status === 404 ? 'PASS' : 'FAIL', brief(foreign));
    const docsA = lpA ? await lpA.get(`${LP}/documents?pageSize=50`) : null;
    const skip = notLive('documents', docsA, !docsA || !items(docsA).length);
    if (skip) record('S3', "client B gets 404 for client A's document", 'SKIP', skip);
    else if (docsA) {
      const own = new Set(items(await lpB.get(`${LP}/documents?pageSize=50`)).map((d) => d.id));
      const target = items(docsA).find((d) => !own.has(d.id));
      if (!target) record('S3', "client B gets 404 for client A's document", 'SKIP', 'no client-A-only document listed');
      else {
        const x = await lpB.get(`${LP}/documents/${encodeURIComponent(target.id)}`);
        record('S3', "client B gets 404 for client A's document", x.status === 404 ? 'PASS' : 'FAIL', brief(x));
      }
    }
  } else record('S3', 'client B isolation', creds.has('lp_b_signatory') ? 'FAIL' : 'SKIP', 'client B persona unavailable');

  // S4 dashboard values equal the seed
  if (dA) {
    const want = seed.commitments.filter((c) => c.client === 'A');
    const bad = want.filter((c) => {
      const fund = seed.funds.find((f) => f.ref === c.fund)!;
      const got = (dA.funds ?? []).find((f: any) => f.fundName === fund.name);
      return !got || Math.abs(Number(got.commitmentAmount) - Number(c.amount)) > 0.005;
    });
    record('S4', 'session commitments equal seed', bad.length ? 'FAIL' : 'PASS', bad.length ? `mismatch: ${bad.map((c) => c.fund).join(', ')}` : `${want.length} commitments`);
    const dash = await lpA!.get(`${LP}/dashboard`);
    if (isNotLive(dash)) record('S4', 'dashboard', 'SKIP', 'dashboard domain NOT LIVE');
    else record('S4', 'dashboard answers in LP envelope', dash.status === 200 && dash.body?.success ? 'PASS' : 'FAIL', `${brief(dash)} (value-level comparison: contract harness)`);
  } else record('S4', 'dashboard values', 'FAIL', 'no client A session');

  // S5 documents + signed download
  if (lpA) {
    const docs = await lpA.get(`${LP}/documents?pageSize=50`);
    const skip = notLive('documents', docs, !items(docs).length);
    if (skip) record('S5', 'documents list + download', 'SKIP', skip);
    else {
      const list = items(docs);
      const expected = seed.documents.filter((d) => d.client === 'A').length;
      record('S5', 'documents list', docs.status === 200 && list.length >= expected ? 'PASS' : 'FAIL', `${brief(docs)} ${list.length}/${expected} documents`);
      if (list[0]) {
        const dl = await download(lpA, `${LP}/documents/${encodeURIComponent(list[0].id)}/download`);
        record('S5', 'document download', dl.ok ? 'PASS' : 'FAIL', dl.detail);
      }
    }
  }

  // S6 notices; S7 capital call visibility; S9 settled calls
  const opsProbe = async (p: string) => (staff ? staff.get(p) : null);
  if (lpA) {
    const n = await lpA.get(`${LP}/notices?pageSize=50`);
    const nSkip = notLive('notices', n, !items(n).length);
    if (nSkip) record('S6', 'LP sees seeded notices', 'SKIP', nSkip);
    else {
      const titles = new Set(items(n).map((x) => x.title));
      const missing = seed.notices.filter((x) => x.client === 'A' && !titles.has(x.title)).length;
      record('S6', 'LP sees seeded notices', n.status === 200 && !missing ? 'PASS' : 'FAIL', `${brief(n)} missing=${missing}`);
    }
    const calls = await lpA.get(`${LP}/capital-calls?pageSize=50`);
    const cSkip = notLive('capital', calls, !items(calls).length);
    if (cSkip) {
      record('S7', 'LP sees issued capital call', 'SKIP', cSkip);
      record('S9', 'LP sees settled (Paid) calls', 'SKIP', cSkip);
    } else {
      const list = items(calls);
      const open = seed.capitalCalls.find((c) => c.status !== 'PAID');
      const seen = list.find((c) => c.callNo === open?.callNo);
      record('S7', 'LP sees issued capital call', seen ? 'PASS' : 'FAIL', seen ? `#${seen.callNo} ${seen.status}` : `${brief(calls)} call #${open?.callNo} not listed`);
      const paid = list.filter((c) => String(c.status).toUpperCase() === 'PAID').length;
      record('S9', 'LP sees settled (Paid) calls', paid >= seed.capitalCalls.filter((c) => c.status === 'PAID').length ? 'PASS' : 'FAIL', `${paid} paid`);
    }
  }
  for (const [id, label, p] of [
    ['S6', 'staff notice publish', '/api/v1/ops/notices'],
    ['S7', 'staff capital call issue', '/api/v1/ops/capital-calls'],
    ['S9', 'staff settlement', '/api/v1/ops/capital-calls'],
  ] as const) {
    const r = await opsProbe(p);
    if (!r) record(id, label, 'SKIP', 'no staff session');
    else if (isNotBuilt(r)) record(id, label, 'SKIP', 'ops endpoint not built yet (501) - manual UAT step');
    else record(id, label, r.status === 200 ? 'SKIP' : 'FAIL', r.status === 200 ? 'ops API live; the write step is a manual UAT step (not automated)' : brief(r));
  }

  // S8 acknowledge + payment confirmation (write)
  if (!FULL) record('S8', 'LP acknowledge + payment confirmation', 'SKIP', 'write step (SMOKE_MODE=full)');
  else if (lpA) {
    const calls = await lpA.get(`${LP}/capital-calls?pageSize=50`);
    const open = items(calls).find((c) => c.callNo === seed.capitalCalls.find((x) => x.status !== 'PAID')?.callNo);
    const aSkip = notLive('capital', calls, !items(calls).length);
    if (aSkip) record('S8', 'LP acknowledge + payment confirmation', 'SKIP', aSkip);
    else if (!open) record('S8', 'LP acknowledge + payment confirmation', 'FAIL', 'open call not listed');
    else {
      const ack = await lpA.request('POST', `${LP}/capital-calls/${open.id}/acknowledge`, {}, { 'Idempotency-Key': randomUUID() });
      record('S8', 'LP acknowledge capital call', ack.status === 200 || ack.status === 409 ? 'PASS' : isNotLive(ack) ? 'SKIP' : 'FAIL', brief(ack));
      const form = new FormData();
      form.set('file', new Blob([Buffer.from('%PDF-1.4\n% smoke payment confirmation\n%%EOF\n')], { type: 'application/pdf' }), 'smoke-payment.pdf');
      form.set('amountClaimed', String(open.outstanding ?? open.callAmount ?? '1'));
      const up = await lpA.upload(`${LP}/capital-calls/${open.id}/payment-confirmations`, form, { 'Idempotency-Key': randomUUID() });
      record('S8', 'LP payment confirmation upload', up.status === 200 || up.status === 201 ? 'PASS' : isNotLive(up) ? 'SKIP' : 'FAIL', brief(up));
    }
  }

  // S10 investee period submit + staff accept
  if (inv) {
    const ws = await inv.get('/api/v1/company/workspace');
    const periods: any[] = ws.body?.periods ?? [];
    record('S10', 'investee periods present', periods.length >= 4 ? 'PASS' : 'FAIL', `${periods.length} periods (${periods.map((p) => p.status).join(',')})`);
    if (!FULL) record('S10', 'investee submit + staff accept', 'SKIP', 'write step (SMOKE_MODE=full)');
    else {
      const cur = ws.body?.currentPeriod;
      if (!cur || !['open', 'returned'].includes(cur.status)) record('S10', 'investee submit + staff accept', 'SKIP', 'no open period (already submitted)');
      else {
        for (const it of (cur.items as any[]).filter((i) => i.required && !i.files?.length)) {
          const ext = String(it.accept).split(',')[0]!.trim() || '.pdf';
          const form = new FormData();
          form.set('files', new Blob([Buffer.from(`smoke ${it.id}\n`)]), `smoke-${it.id}${ext}`);
          const r = await inv.upload(`/api/v1/company/periods/${cur.id}/items/${it.id}/files`, form);
          if (r.status !== 201) record('S10', `upload ${it.id}`, 'FAIL', brief(r));
        }
        const sub = await inv.request('POST', `/api/v1/company/periods/${cur.id}/submit`, {});
        record('S10', 'investee submits period', sub.status === 200 ? 'PASS' : 'FAIL', brief(sub));
        const reviewer = (await as('analyst', 'admin')) ?? (await as('investment_director', 'admin')) ?? staff;
        if (sub.status === 200 && reviewer) {
          const acc = await reviewer.request('POST', `/api/v1/private-markets/reporting-packs/${sub.body?.period?.uuid}/accept`, { note: 'UAT smoke' });
          record('S10', 'staff accepts period', acc.status === 200 && acc.body?.period?.status === 'accepted' ? 'PASS' : 'FAIL', brief(acc));
        }
      }
    }
  }

  // S11 audit chain
  if (staff) {
    const v = await staff.get('/api/v1/admin/audit-events/verify');
    record('S11', 'audit chain verifies', v.status === 200 && v.body?.brokenAt == null ? 'PASS' : 'FAIL', `${brief(v)} checked=${v.body?.checked ?? '?'} brokenAt=${v.body?.brokenAt ?? 'none'}`);
  } else record('S11', 'audit chain verifies', 'SKIP', 'no staff session');

  // S12 mail arrives in Mailpit
  if (!MAILPIT) record('S12', 'mail arrives in Mailpit', 'SKIP', 'SMOKE_MAILPIT not set');
  else {
    try {
      const info = await fetch(`${MAILPIT}/api/v1/info`);
      if (!info.ok) record('S12', 'Mailpit reachable', 'FAIL', `HTTP ${info.status}`);
      else if (process.env.SMOKE_MAIL_TRIGGER === '0' || !creds.get('analyst')) record('S12', 'Mailpit reachable', 'PASS', 'delivery not triggered');
      else {
        const to = creds.get('analyst')!.email;
        const since = Date.now() - 5_000;
        const f = await anon.request('POST', '/api/auth/password/forgot', { email: to, portal: 'admin' });
        let found = false;
        for (let i = 0; i < 24 && !found && f.status === 200; i++) {
          await new Promise((r) => setTimeout(r, 2_500));
          const s = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
          const j: any = s.ok ? await s.json() : {};
          found = (j.messages ?? []).some((m: any) => new Date(m.Created).getTime() >= since);
        }
        record('S12', 'mail arrives in Mailpit', found ? 'PASS' : 'FAIL', found ? 'password-reset mail delivered via outbox worker' : `${brief(f)}; no mail within 60 s (worker running? SMTP_HOST=mailpit?)`);
      }
    } catch (err) {
      record('S12', 'mail arrives in Mailpit', 'FAIL', String(err));
    }
  }

  const count = (s: Status) => results.filter((r) => r.status === s).length;
  console.log(`\n${count('PASS')} pass, ${count('FAIL')} fail, ${count('WARN')} warn, ${count('SKIP')} skip`);
  if (process.env.SMOKE_REPORT) writeFileSync(process.env.SMOKE_REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), api: API, mode: FULL ? 'full' : 'readonly', results }, null, 2));
  process.exit(count('FAIL') ? 1 : 0);
}

main().catch((err) => {
  console.error(`[smoke] ${err instanceof Error ? err.message : err}`);
  process.exit(2);
});
