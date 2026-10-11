/* IF-01..IF-15 runtime triage probes against the frozen candidate. */
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
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { cookie, status: res.status };
}

async function api(path: string, cookie: string, opts: { method?: string; body?: string } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
}

async function main() {
  // ---- IF-13: backend enforcement + cross-client denial
  {
    const viewer = await session('lp_a_viewer', 'investor');
    const adminWrite = await api('/api/v1/orders', viewer.cookie, { method: 'POST', body: JSON.stringify({}) });
    const ownRead = await api('/api/v1/lp-portal/dashboard', viewer.cookie);
    const bInv = await session('lp_b_signatory', 'investor');
    const cross = await api('/api/v1/lp-portal/documents', bInv.cookie);
    console.log('IF-13:', JSON.stringify({ viewerAdminWriteStatus: adminWrite.status, viewerOwnReadStatus: ownRead.status, investorBDocumentsStatus: cross.status }));
  }

  // ---- IF-03/IF-02: public onboarding -> durable record -> staff queue
  {
    const pub = await fetch(BASE + '/api/v1/public/onboarding/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityName: 'UAT Triprobe Trust',
        entityType: 'TRUST',
        contactName: 'UAT Triage Probe',
        contactEmail: 'triage-probe@example.invalid',
        docs: ['doc1', 'doc2', 'doc3', 'doc4', 'doc5', 'doc6', 'doc7', 'doc8'],
      }),
    });
    const pubText = await pub.text();
    let appId: string | null = null;
    try { const j = JSON.parse(pubText); appId = j?.data?.id ?? j?.application?.id ?? j?.id ?? null; } catch { /* ignore */ }
    const cs = await session('client_services', 'admin');
    const queue = await api('/api/v1/client-ops/onboarding', cs.cookie);
    const found = appId ? JSON.stringify(queue.body).includes(appId) : false;
    console.log('IF-03:', JSON.stringify({ publicSubmitStatus: pub.status, appId, staffQueueStatus: queue.status, handoffVisible: found }));
    console.log('IF-02:', JSON.stringify({ publicSubmitStatus: pub.status, docsSubmitted: 8, responseHasAppId: !!appId, publicBody: pubText.slice(0, 300) }));
  }

  // ---- IF-04: integration test performs real adapter call
  {
    const admin = await session('sysadmin', 'admin');
    const list = await api('/api/v1/admin-core/integrations', admin.cookie);
    const names: string[] = Array.isArray(list.body?.data) ? list.body.data.map((i: any) => i.name ?? i.adapter ?? i.key) : [];
    let testStatus = 0, testBody: unknown = null;
    if (names.length) {
      const t = await api('/api/v1/admin-core/integrations/' + encodeURIComponent(names[0]) + '/test', admin.cookie, { method: 'POST' });
      testStatus = t.status; testBody = t.body;
    }
    console.log('IF-04:', JSON.stringify({ listStatus: list.status, adapters: names, testStatus, testBody: JSON.stringify(testBody).slice(0, 300) }));
  }

  // ---- IF-07: original document bytes + sha256
  {
    const admin = await session('sysadmin', 'admin');
    const docs = await api('/api/v1/documents', admin.cookie);
    const first = docs.body?.data?.[0];
    let fileStatus = 0, sha: string | null = null, bytes = 0;
    const fileId = first?.versions?.[0]?.fileId ?? first?.fileId ?? null;
    if (fileId) {
      const f = await fetch(BASE + '/api/v1/files/' + fileId, { headers: { cookie: admin.cookie } });
      fileStatus = f.status;
      const buf = Buffer.from(await f.arrayBuffer());
      bytes = buf.length;
      sha = createHash('sha256').update(buf).digest('hex');
    }
    console.log('IF-07:', JSON.stringify({ docsStatus: docs.status, docCount: docs.body?.data?.length ?? null, firstDoc: first?.name ?? null, fileStatus, bytes, sha256: sha }));
  }

  // ---- IF-09: NAV runs
  {
    const admin = await session('sysadmin', 'admin');
    const nav = await api('/api/v1/nav/runs', admin.cookie);
    console.log('IF-09:', JSON.stringify({ navRunsStatus: nav.status, navRunsCount: Array.isArray(nav.body?.data) ? nav.body.data.length : null, body: JSON.stringify(nav.body).slice(0, 200) }));
  }

  // ---- IF-10: construction/OMS promotion linked draft
  {
    const admin = await session('sysadmin', 'admin');
    const cases = await api('/api/v1/research/cases', admin.cookie);
    const lab = await api('/api/v1/portfolio-lab/models', admin.cookie);
    console.log('IF-10:', JSON.stringify({ researchCasesStatus: cases.status, portfolioLabStatus: lab.status, labCount: Array.isArray(lab.body?.data) ? lab.body.data.length : null }));
  }

  // ---- IF-08: company submissions durable
  {
    const comp = await session('investee_101_contributor');
    const periods = await api('/api/v1/investee-portal/reporting/history', comp.cookie);
    console.log('IF-08:', JSON.stringify({ companyHistoryStatus: periods.status, periods: Array.isArray(periods.body?.data) ? periods.body.data.length : null, sample: JSON.stringify(periods.body).slice(0, 200) }));
  }

  // ---- IF-12: regulatory filings/receipts + report schedules
  {
    const admin = await session('sysadmin', 'admin');
    const filings = await api('/api/v1/regulatory/filings', admin.cookie);
    const sched = await api('/api/v1/reports/schedules', admin.cookie);
    console.log('IF-12:', JSON.stringify({ filingsStatus: filings.status, filingsCount: Array.isArray(filings.body?.data) ? filings.body.data.length : null, schedulesStatus: sched.status, schedulesCount: Array.isArray(sched.body?.data) ? sched.body.data.length : null }));
  }

  // ---- IF-14: market data provenance
  {
    const admin = await session('sysadmin', 'admin');
    const md = await api('/api/v1/market-data/status', admin.cookie);
    console.log('IF-14:', JSON.stringify({ marketDataStatus: md.status, body: JSON.stringify(md.body).slice(0, 250) }));
  }
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
