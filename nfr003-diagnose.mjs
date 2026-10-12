/* Diagnose the concurrency failures: capture status codes and bodies. */
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-admin.json', 'utf8'));
const API = 'https://api.nexus.matanho.com';

const loginOnce = async () => {
  const res = await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password, portal: 'admin' }),
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', body: (await res.text()).slice(0, 120) };
};

// 25 sequential logins first to see the pattern
const seq = [];
for (let i = 0; i < 25; i += 1) {
  const r = await loginOnce();
  seq.push(`${r.status}`);
}
console.log('25 sequential logins:', seq.join(','));

// then 25 truly concurrent
const conc = await Promise.all(Array.from({ length: 25 }, () => loginOnce()));
console.log('25 concurrent logins:', conc.map((c) => c.status).join(','));
const bad = conc.filter((c) => c.status !== 200);
if (bad.length) console.log('failure bodies:', JSON.stringify(bad.slice(0, 3).map((b) => ({ s: b.status, b: b.body }))));
