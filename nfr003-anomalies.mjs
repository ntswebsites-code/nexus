/* Investigate the LP 404 and investee 501. */
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:4100';
const users = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const by = (p) => users.find((u) => u.persona === p);
const login = async (persona, portal) => {
  const u = by(persona);
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password, portal }) });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
};
const hit = async (path, cookie) => {
  const r = await fetch(BASE + path, { headers: { cookie } });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 160) };
};

// LP_B signatory: which LP path 404s?
const bCookie = await login('lp_b_signatory', 'investor');
for (const p of ['/api/v1/lp-portal/dashboard', '/api/v1/lp-portal/documents', '/api/v1/lp-portal/notices', '/api/v1/lp-portal/capital-activity', '/api/v1/lp-portal/performance']) {
  console.log('LP_B', p, JSON.stringify(await hit(p, bCookie)).slice(0, 150));
}
// investee viewer: which investee path 501s?
const ivCookie = await login('investee_101_viewer');
for (const p of ['/api/v1/investee-portal/dashboard', '/api/v1/investee-portal/reporting/history', '/api/v1/investee-portal/notices']) {
  console.log('INVESTEE_VIEWER', p, JSON.stringify(await hit(p, ivCookie)).slice(0, 150));
}
// compare: contributor (which worked earlier)
const icCookie = await login('investee_101_contributor');
for (const p of ['/api/v1/investee-portal/dashboard', '/api/v1/investee-portal/reporting/history']) {
  console.log('INVESTEE_CONTRIBUTOR', p, JSON.stringify(await hit(p, icCookie)).slice(0, 150));
}
