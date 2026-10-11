/* Wave 2 Part A (v2): NAV, CSH, REC, DOC P0 lifecycle probes with correct schemas. */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';

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
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, body, text };
}

const results: Record<string, unknown> = {};
const D = (b: any) => b?.data ?? b;

async function main() {
  const fa = await login('test_fund_accountant', 'admin');   // maker (FA-01)
  const dir = await login('test_approver', 'admin');          // checker (NAV-02)
  const ops = await login('operations', 'admin');             // independent poster
  const comp = await login('compliance', 'admin');            // document approver

  // ---------- NAV full lifecycle ----------
  {
    const created = await api('/api/v1/nav/runs', fa.cookie, { method: 'POST', idem: true, body: { portfolioId: 'PF-1006', navDate: '2026-08-31', liabilities: 100, units: 100000, fees: 0 } });
    const run = D(created.body);
    results['NAV create'] = { status: created.status, ref: run?.ref, state: run?.status };
    if (run?.id) {
      const recalc = await api('/api/v1/nav/runs/' + run.id + '/recalculate', fa.cookie, { method: 'POST', idem: true, body: {} });
      const rd = D(recalc.body);
      results['NAV recalculate'] = { status: recalc.status, state: rd?.status, navPerUnit: rd?.navPerUnit ?? null, netAssets: rd?.netAssets ?? null };
      const recalcId = D(recalc.body)?.id ?? run.id;
      const runs = await api('/api/v1/nav/runs/' + recalcId, fa.cookie);
      const cur = D(runs.body);
      results['NAV run detail'] = { status: runs.status, state: cur?.status, exceptions: cur?._count?.exceptions ?? (cur?.exceptions ? cur.exceptions.length : null) };
      // resolve material exceptions if any
      const liveId = recalcId;
      if (cur?.exceptions?.length) {
        for (const ex of cur.exceptions) {
          const res = await api('/api/v1/nav/runs/' + liveId + '/exceptions/' + ex.id, fa.cookie, { method: 'POST', idem: true, body: { resolution: 'UAT probe: approved fresh evidence attached', evidenceRef: 'EV-NAV-002-01' } });
          results['NAV exception resolve'] = { status: res.status, exId: ex.id };
        }
      }
      const maker = await api('/api/v1/nav/runs/' + liveId + '/maker-review', fa.cookie, { method: 'POST', idem: true, body: {} });
      results['NAV maker review'] = { status: maker.status, state: D(maker.body)?.status ?? maker.body?.code ?? maker.body?.error?.message ?? null };
      const selfRelease = await api('/api/v1/nav/runs/' + liveId + '/release', fa.cookie, { method: 'POST', idem: true, body: {} });
      results['NAV self-release (segregation)'] = { status: selfRelease.status, code: selfRelease.body?.error?.code ?? selfRelease.body?.code ?? null };
      const release = await api('/api/v1/nav/runs/' + liveId + '/release', dir.cookie, { method: 'POST', idem: true, body: {} });
      results['NAV independent release'] = { status: release.status, state: D(release.body)?.status ?? null, navPerUnit: D(release.body)?.navPerUnit ?? null };
    }
  }

  // ---------- CSH journal lifecycle ----------
  {
    const ledgers = await api('/api/v1/cash/ledgers', fa.cookie);
    const items: any[] = ledgers.body?.data ?? [];
    const ledger = items[0];
    results['CSH ledgers'] = { status: ledgers.status, count: items.length, sample: items.slice(0, 3).map((l) => `${l.ref}:${l.kind}:${l.status}`) };
    if (ledger) {
      const created = await api('/api/v1/cash/journals', fa.cookie, {
        method: 'POST', idem: true,
        body: {
          portfolioId: ledger.portfolioId ?? 'PF-1001',
          entryDate: '2026-08-31',
          description: 'UAT bank fee journal probe',
          purpose: 'MANUAL_CORRECTION',
          lines: [
            { ledgerId: ledger.id, debit: 150, memo: 'UAT bank fee debit' },
            { ledgerId: ledger.id, credit: 150, memo: 'UAT bank fee credit' },
          ],
        },
      });
      const j = D(created.body);
      results['CSH create journal'] = { status: created.status, ref: j?.ref, message: created.body?.error?.message ?? (typeof created.body === 'string' ? created.body.slice(0, 120) : null) };
      if (j?.id) {
        const submit = await api('/api/v1/cash/journals/' + j.id + '/submit', fa.cookie, { method: 'POST', idem: true, body: {} });
        results['CSH submit'] = { status: submit.status, state: D(submit.body)?.status ?? null };
        const selfPost = await api('/api/v1/cash/journals/' + j.id + '/post', fa.cookie, { method: 'POST', idem: true, body: {} });
        results['CSH self-post (segregation)'] = { status: selfPost.status, code: selfPost.body?.error?.code ?? null };
        const post = await api('/api/v1/cash/journals/' + j.id + '/post', ops.cookie, { method: 'POST', idem: true, body: {} });
        results['CSH independent post'] = { status: post.status, state: D(post.body)?.status ?? null };
      }
    }
  }

  // ---------- REC statement import ----------
  {
    const ledgers = await api('/api/v1/cash/ledgers?kind=BANK', ops.cookie);
    const items: any[] = ledgers.body?.data ?? [];
    const bank = items[0];
    if (bank) {
      const csv = 'externalId,valueDate,amount,currency,reference\nUAT-REC-1,2026-08-31,1000.00,USD,UAT probe credit\nUAT-REC-2,2026-08-31,-250.50,USD,UAT probe debit\nUAT-REC-1,2026-08-31,1000.00,USD,duplicate row';
      const created = await api('/api/v1/cash/statement-imports', ops.cookie, { method: 'POST', idem: true, body: { ledgerId: bank.id, filename: 'uat-counterpart-probe.csv', format: 'CSV', content: csv, openingBalance: 5000, closingBalance: 6749.50 } });
      const imp = D(created.body);
      results['REC statement import stage'] = { status: created.status, importId: imp?.id, lines: imp?.lineCount ?? null, message: created.body?.error?.message ?? (typeof created.body === 'string' ? created.body.slice(0, 150) : null) };
      if (imp?.id) {
        const commit = await api('/api/v1/cash/statement-imports/' + imp.id + '/commit', fa.cookie, { method: 'POST', idem: true, body: {} });
        results['REC statement import commit (independent)'] = { status: commit.status, message: commit.body?.error?.message ?? (typeof commit.body === 'string' ? commit.body.slice(0, 120) : null) };
      }
    } else {
      results['REC statement import stage'] = { skipped: 'no BANK ledger seeded' };
    }
  }

  // ---------- DOC document lifecycle with original bytes ----------
  {
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 52>>stream\nBT /F1 12 Tf 72 720 Td (UAT-BANK-ORIGINAL-P2-0042) Tj ET\nendstream endobj\n5 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 6 0 R>>endobj\n6 0 obj<</Length 52>>stream\nBT /F1 12 Tf 72 720 Td (UAT-BANK-ORIGINAL-P2-0042) Tj ET\nendstream endobj\nxref\n0 7\ntrailer<</Root 1 0 R>>\n%%EOF',
      'latin1',
    );
    const sha = createHash('sha256').update(pdf).digest('hex');
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'uat-bank-statement.pdf');
    fd.append('name', 'UAT Bank Statement Probe');
    fd.append('type', 'statement');
    fd.append('classification', 'Client');
    const up = await api('/api/v1/documents', fa.cookie, { method: 'POST', form: fd });
    const doc = D(up.body)?.document ?? D(up.body);
    const v1sha = doc?.versions?.[0]?.sha256 ?? null;
    results['DOC create + original'] = { status: up.status, ref: doc?.ref, docId: doc?.id, v1sha, computedSha: sha, hashMatch: v1sha === sha, bytes: pdf.length };
    if (doc?.id) {
      const submit = await api('/api/v1/documents/' + doc.id + '/submit', fa.cookie, { method: 'POST', idem: true, body: {} });
      results['DOC submit'] = { status: submit.status, state: (submit.body?.document ?? D(submit.body))?.status ?? null };
      const approve = await api('/api/v1/documents/' + doc.id + '/approve', comp.cookie, { method: 'POST', idem: true, body: {} });
      results['DOC approve (independent)'] = { status: approve.status, state: (approve.body?.document ?? D(approve.body))?.status ?? null };
      const publish = await api('/api/v1/documents/' + doc.id + '/publish', comp.cookie, { method: 'POST', idem: true, body: { clientIds: ['CL-00418'] } });
      results['DOC publish'] = { status: publish.status, state: (publish.body?.document ?? D(publish.body))?.status ?? null };
      const fid = doc.versions[0].fileId;
      const sysadmin = await login('sysadmin', 'admin');
      const dl = await fetch(BASE + '/api/v1/files/' + fid + '/download', { headers: { cookie: sysadmin.cookie } });
      const buf = Buffer.from(await dl.arrayBuffer());
      const dlSha = createHash('sha256').update(buf).digest('hex');
      results['DOC download original'] = { status: dl.status, bytes: buf.length, sha256: dlSha, match: dlSha === sha, magic: buf.subarray(0, 5).toString('latin1') };
      // version replacement
      const pdf2 = Buffer.from(pdf.toString('latin1').replace('UAT-BANK-ORIGINAL-P2-0042', 'UAT-BANK-REPLACEMENT-P2-0042'), 'latin1');
      const fd2 = new FormData();
      fd2.append('file', new Blob([pdf2], { type: 'application/pdf' }), 'uat-bank-statement-v2.pdf');
      const ver = await api('/api/v1/documents/' + doc.id + '/versions', fa.cookie, { method: 'POST', form: fd2 });
      results['DOC version replacement'] = { status: ver.status, v2: (ver.body?.document ?? D(ver.body))?.versions?.[0]?.version ?? null, state: (ver.body?.document ?? D(ver.body))?.status ?? null };
    }
  }

  console.log(JSON.stringify(results, null, 1));
  writeFileSync('uat-execution/wave2a-probe-output.json', JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });



