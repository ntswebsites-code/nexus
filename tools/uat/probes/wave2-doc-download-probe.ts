/* DOC-001 step 3: signed-URL download byte comparison for the probe document. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = 'http://localhost:4100';
const users: Array<{ persona: string; email: string; password: string }> = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const sys = users.find((u) => u.persona === 'sysadmin')!;

async function main() {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: sys.email, password: sys.password, portal: 'admin' }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  // find the latest probe document (DOC-3006)
  const list = await fetch(BASE + '/api/v1/documents?limit=5', { headers: { cookie } }).then((r) => r.json());
  const docs: any[] = list.data ?? [];
  const probe = docs.find((d) => /UAT Bank Statement Probe/.test(d.name ?? '')) ?? docs[0];
  console.log('doc:', probe?.ref, probe?.name, 'status:', probe?.status);
  const urlRes = await fetch(BASE + '/api/v1/documents/' + probe.id + '/download-url', { headers: { cookie } });
  const urlBody = await urlRes.json();
  const url = (urlBody.data ?? urlBody).url;
  console.log('signed url issued:', urlRes.status, 'expiresIn:', (urlBody.data ?? urlBody).expiresIn);
  const dl = await fetch(url.startsWith('http') ? url : BASE + url, { headers: { cookie } });
  const buf = Buffer.from(await dl.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  console.log('download:', JSON.stringify({
    status: dl.status, bytes: buf.length, sha256: sha,
    matchesUploadedOriginal: sha === '7914fc0358424aa34314196b24da661c614222223aea483c82b59b53f928d509',
    magic: buf.subarray(0, 5).toString('latin1'),
    hasPageMarker: buf.toString('latin1').includes('UAT-BANK-ORIGINAL-P2-0042'),
  }));
  // unsigned attempt must fail
  const raw = await fetch(BASE + '/api/v1/files/' + (probe.versions?.[0]?.fileId ?? 'x') + '/download', { headers: { cookie } });
  console.log('unsigned direct file fetch:', raw.status, '(expected 403 invalid_signature)');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
