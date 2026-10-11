/* G05: provision/verify the 22 test identities via the normal test-access process.
 * Logs in each persona from secrets/uat-users.json against the running API and records the
 * authenticated subject (server-side user ID), granted roles and session cookie behaviour. */
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4100';
const users = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8')) as Array<{
  persona: string; email: string; password: string; name: string; roles?: string[];
}>;

async function login(u: (typeof users)[number]) {
  const portal = u.roles?.[0]?.startsWith('custodian') ? 'custodian'
    : u.roles?.[0]?.startsWith('investor') ? 'investor'
    : u.roles?.[0]?.startsWith('admin') ? 'admin' : undefined; // company/investee users: no portal hint
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.password, ...(portal ? { portal } : {}) }),
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, setCookie: res.headers.get('set-cookie')?.split(';')[0] ?? null, body };
}

const out: any[] = [];
async function main() {
  for (const u of users) {
    try {
      const r = await login(u);
      const ok = r.status === 200 && r.body?.user?.id;
      out.push({
        persona: u.persona, email: u.email, http: r.status, ok: !!ok,
        userId: r.body?.user?.id ?? null,
        name: r.body?.user?.name ?? u.name,
        roles: r.body?.user?.roles ?? [],
        mfa: r.body?.mfa ?? null,
        sessionCookie: r.setCookie ? 'set' : 'none',
      });
      console.log(`${ok ? 'OK ' : 'FAIL'} ${u.persona.padEnd(28)} ${String(r.status)} ${r.body?.user?.id ?? JSON.stringify(r.body).slice(0, 80)}`);
    } catch (e: any) {
      out.push({ persona: u.persona, email: u.email, http: 0, ok: false, error: e.message });
      console.log(`ERR  ${u.persona}: ${e.message}`);
    }
  }
  console.log(`\n${out.filter((o) => o.ok).length}/${users.length} identities authenticated`);
}

main().catch((e) => { console.error(e); process.exit(1); });
