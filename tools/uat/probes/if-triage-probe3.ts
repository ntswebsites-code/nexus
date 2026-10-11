import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
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
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', status: res.status };
}

async function api(path: string, cookie: string, opts: { method?: string; body?: string } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, body, text };
}

async function main() {
  // ---- IF-02/03: create + submit with consent, then staff queue visibility
  const draftEmail = 'triage-probe3-' + Date.now() + '@example.invalid';
  const create = await fetch(BASE + '/api/v1/public/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: draftEmail, applicantType: 'Trust / foundation', name: 'UAT Triprobe Trust 3', sendLink: false }),
  });
  const draft = JSON.parse(await create.text());
  console.log('IF-02/03 create:', JSON.stringify({ status: create.status, id: draft.id }));

  const sub = await fetch(BASE + '/api/v1/public/applications/' + draft.id + '/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-draft-token': draft.token },
    body: JSON.stringify({ consent: true, form: { entityName: 'UAT Triprobe Trust 3', applicantType: 'Trust / foundation', contactName: 'UAT Triage Probe', contactEmail: draftEmail } }),
  });
  const subText = await sub.text();
  console.log('IF-02/03 submit:', JSON.stringify({ status: sub.status, body: subText.slice(0, 300) }));

  const cs = await session('client_services', 'admin');
  const queue = await api('/api/v1/client-ops/onboarding/queue', cs.cookie);
  const queueItems = queue.body?.data?.items ?? queue.body?.data ?? [];
  const found = queueItems.some((c: any) => JSON.stringify(c).includes(draftEmail));
  console.log('IF-03 handoff:', JSON.stringify({ queueStatus: queue.status, queueCount: queueItems.length, visibleInStaffQueue: found }));

  // ---- IF-07: original bytes: DB fileId -> download -> recompute sha256
  {
    const admin = await session('sysadmin', 'admin');
    const dv = await prisma.documentVersion.findFirst({
      where: { document: { status: 'Published' } },
      include: { document: true },
    });
    if (dv) {
      const file = await prisma.fileObject.findUnique({ where: { id: dv.fileId } });
      const f = await fetch(BASE + '/api/v1/files/' + dv.fileId, { headers: { cookie: admin.cookie } });
      const buf = Buffer.from(await f.arrayBuffer());
      const computed = createHash('sha256').update(buf).digest('hex');
      console.log('IF-07 download:', JSON.stringify({
        status: f.status, bytes: buf.length,
        recordedSha256: dv.sha256, computedSha256: computed,
        match: computed === dv.sha256, dbFileSha: file?.sha256 ?? null,
        dbFileSize: file?.size ?? null,
        pdfMagic: buf.subarray(0, 5).toString('latin1'),
        doc: dv.document.name,
      }));
    } else {
      console.log('IF-07: no published document version found');
    }
  }

  // ---- IF-13: cross-investor document overlap (LP shape)
  {
    const a = await session('lp_a_manager', 'investor');
    const b = await session('lp_b_signatory', 'investor');
    const docsA = await api('/api/v1/lp-portal/documents', a.cookie);
    const docsB = await api('/api/v1/lp-portal/documents', b.cookie);
    const itemsA = docsA.body?.data?.items ?? [];
    const itemsB = docsB.body?.data?.items ?? [];
    const idsA = new Set(itemsA.map((d: any) => d.id));
    const overlap = itemsB.filter((d: any) => idsA.has(d.id));
    console.log('IF-13 cross-scope:', JSON.stringify({
      aCount: itemsA.length, bCount: itemsB.length, overlap: overlap.length,
      bDocNames: itemsB.map((d: any) => d.name ?? d.title).slice(0, 5),
    }));
  }

  // ---- IF-10: orders with research/IC link
  {
    const admin = await session('sysadmin', 'admin');
    const orders = await api('/api/v1/orders', admin.cookie);
    const items = orders.body?.data ?? [];
    console.log('IF-10 orders:', JSON.stringify({ count: items.length, sample: JSON.stringify(items[0]).slice(0, 350) }));
  }

  // ---- IF-12: filings + receipts
  {
    const admin = await session('sysadmin', 'admin');
    const filings = await api('/api/v1/regulatory/filings', admin.cookie);
    const items = filings.body?.data ?? [];
    console.log('IF-12 filings:', JSON.stringify({ count: items.length, sample: JSON.stringify(items[0]).slice(0, 350) }));
  }

  // ---- IF-01/IF-04: integration call log (genuine external traffic)
  {
    const admin = await session('sysadmin', 'admin');
    const calls = await api('/api/v1/admin-core/integrations/calls', admin.cookie);
    const items = calls.body?.data ?? [];
    console.log('IF-04 call log:', JSON.stringify({ count: items.length, sample: JSON.stringify(items[0]).slice(0, 300) }));
  }
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
