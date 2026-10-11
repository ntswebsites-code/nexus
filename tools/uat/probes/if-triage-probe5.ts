import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = 'http://localhost:4100';
const users: Array<{ persona: string; email: string; password: string }> = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
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

async function main() {
  const a = await session('lp_a_manager', 'investor');
  const list = await fetch(BASE + '/api/v1/lp-portal/documents', { headers: { cookie: a.cookie } });
  const listBody = await list.json();
  const items = listBody?.data?.items ?? [];
  console.log('IF-07 LP docs:', items.length);
  const first = items[0];
  const id = first?.id ?? first?.documentId;
  if (id) {
    const dl = await fetch(BASE + '/api/v1/lp-portal/documents/' + id + '/download', { headers: { cookie: a.cookie } });
    const buf = Buffer.from(await dl.arrayBuffer());
    const computed = createHash('sha256').update(buf).digest('hex');
    console.log('IF-07 LP download:', JSON.stringify({
      status: dl.status, bytes: buf.length, sha256: computed,
      magic: buf.subarray(0, 5).toString('latin1'), docName: first?.name ?? first?.title,
      recordedSha: first?.sha256 ?? null,
      match: first?.sha256 ? computed === first.sha256 : 'no recorded sha in list item',
    }));
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
