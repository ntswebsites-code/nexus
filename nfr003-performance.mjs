/* NFR-003: performance against the approved targets (p95 page <= 2s, read <= 500ms, 25 concurrent users).
 * Reads only - no writes to production. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-admin.json', 'utf8'));
const API = 'https://api.nexus.matanho.com';

const login = async () => {
  const res = await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password, portal: 'admin' }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return cookie;
};

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const readEndpoints = [
  '/api/v1/dashboard/today',
  '/api/v1/portfolios?kpis=1',
  '/api/v1/orders?limit=100',
  '/api/v1/clients',
  '/api/v1/securities?limit=200',
  '/api/v1/recon/overview',
  '/api/v1/cash/journals?limit=50',
  '/api/v1/nav/runs?limit=20',
  '/api/v1/documents',
  '/api/v1/reports/catalogue',
];

async function main() {
  const cookie = await login();
  const samples = [];
  const perEndpoint = {};
  for (const ep of readEndpoints) {
    const times = [];
    for (let i = 0; i < 6; i += 1) {
      const t0 = performance.now();
      const res = await fetch(API + ep, { headers: { cookie } });
      await res.arrayBuffer();
      times.push(performance.now() - t0);
    }
    samples.push(...times);
    perEndpoint[ep] = { n: times.length, p95: Math.round(pct(times, 95)), max: Math.round(Math.max(...times)) };
    console.log(`${ep} -> p95 ${Math.round(pct(times, 95))}ms (max ${Math.round(Math.max(...times))}ms)`);
  }
  const readP95 = Math.round(pct(samples, 95));
  console.log(`API read p95: ${readP95}ms over ${samples.length} samples (target <= 500ms)`);

  // 25 concurrent users (read workload)
  const nc = 25;
  const concStart = performance.now();
  const conc = await Promise.all(
    Array.from({ length: nc }, async (_, i) => {
      const c = await login();
      const ep = readEndpoints[i % readEndpoints.length];
      try {
        const res = await fetch(API + ep, { headers: { cookie: c } });
        return { ok: res.status === 200, status: res.status };
      } catch (e) {
        return { ok: false, status: String(e).slice(0, 60) };
      }
    }),
  );
  const concMs = Math.round(performance.now() - concStart);
  const ok = conc.filter((c) => c.ok).length;
  console.log(`25 concurrent sessions: ${ok}/${nc} OK in ${concMs}ms wall`);

  const result = { target: { pageP95Ms: 2000, apiReadP95Ms: 500, concurrentUsers: 25 }, apiReadP95Ms: readP95, samples: samples.length, perEndpoint, concurrency: { ok, of: nc, wallMs: concMs }, pageLoads: 'see nfr-001 browser timing' };
  mkdirSync('uat-execution/nfr', { recursive: true });
  writeFileSync('uat-execution/nfr/nfr-003-performance.json', JSON.stringify(result, null, 1));
  console.log('saved uat-execution/nfr/nfr-003-performance.json');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
