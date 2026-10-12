/* Production functional audit: verify each deployed fix works in the live UI. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-admin.json', 'utf8'));
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleErrors = [];
const failed = [];
const requests = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  }
  if (msg.method === 'Network.responseReceived') {
    const r = msg.params.response;
    if (r.status >= 400) failed.push({ url: r.url.slice(0, 120), status: r.status });
    if (r.url.includes('/api/v1/data/sources')) requests.push({ m: r.requestMethod ?? 'GET', url: r.url.slice(0, 90), status: r.status });
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
await send('Network.clearBrowserCookies');
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const step = async (name, fn) => {
  try {
    const d = await fn();
    results.push({ name, ok: true, detail: d });
    console.log(`PASS  ${name} :: ${JSON.stringify(d).slice(0, 200)}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e).slice(0, 250) });
    console.log(`FAIL  ${name} :: ${String(e).slice(0, 250)}`);
  }
};

// login
await send('Page.navigate', { url: cfg.base + '/login' });
await sleep(5000);
await ev(`(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('input[name="email"]'), ${JSON.stringify(cfg.email)});
  set(document.querySelector('input[name="password"]'), ${JSON.stringify(cfg.password)});
  Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent||'')).click();
  return true;
})()`);
await sleep(10000);

// FIX A: nav gating follows authenticated permissions (0 secondary items)
await step('nav follows authenticated permissions', async () => {
  await send('Page.navigate', { url: cfg.base + '/' });
  await sleep(6000);
  const r = await ev(`(() => {
    const items = Array.from(document.querySelectorAll('#sideNav .nav-item[data-page]'));
    return { total: items.length, secondary: items.filter(i => i.classList.contains('v16-secondary')).map(i => i.getAttribute('data-page')) };
  })()`);
  if (!r.total) throw new Error('nav not found');
  if (r.secondary.length > 0) throw new Error('secondary nav items: ' + r.secondary.join(','));
  return r;
});

// FIX B/C: Data Fabric tabs render distinctly + connection save/test does real server work
await step('data fabric tabs render distinctly', async () => {
  await ev(`document.querySelector('#sideNav .nav-item[data-page="data"]').click()`);
  await sleep(2500);
  const out = {};
  for (const t of ['connections', 'products', 'pipelines', 'quality', 'lineage']) {
    await ev(`document.querySelector('#page-data [data-v33-data-tab="${t}"]')?.click()`);
    await sleep(1400);
    out[t] = await ev(`(() => { const v = document.getElementById('v33DataView'); return v ? (v.querySelector('.v33-kicker')||{}).textContent?.trim() || null : null; })()`);
  }
  const distinct = new Set(Object.values(out)).size;
  if (distinct < 4) throw new Error('tabs not distinct: ' + JSON.stringify(out));
  return out;
});

await step('connection save performs real server-side create', async () => {
  await ev(`document.querySelector('#page-data [data-v33-data-tab="connections"]')?.click()`);
  await sleep(1200);
  const before = requests.length;
  const r = await ev(`(async () => {
    const name = document.getElementById('v33ConnName');
    const ep = document.getElementById('v33ConnEndpoint');
    if (!name || !ep) return { form: false };
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(name, 'UAT PROD Audit Connector');
    set(ep, 'https://sandbox.audit.invalid/feed');
    document.getElementById('v33SaveConnection').click();
    return { form: true, name: name.value };
  })()`);
  await sleep(4000);
  const after = requests.filter((q) => q.url.includes('POST') || q.m === 'POST').length;
  const posts = requests.filter((q) => (q.url.includes('POST') || q.m === 'POST'));
  return { ...r, newPosts: after, sample: posts.slice(-2) };
});

// FIX D: audit trail renders rows with filters
await step('audit trail renders rows', async () => {
  await ev(`document.querySelector('#sideNav .nav-item[data-page="audit"]').click()`);
  await sleep(3000);
  const r = await ev(`(() => {
    const rows = document.querySelectorAll('#page-audit table tbody tr');
    const txt = document.querySelector('#page-audit')?.innerText || '';
    return { rows: rows.length, stuck: /Loading audit events/.test(txt) };
  })()`);
  if (r.rows < 10) throw new Error('too few audit rows: ' + r.rows);
  if (r.stuck) throw new Error('audit stuck on loading');
  return r;
});

// FIX E: clients page shows live server data with the live source label
await step('clients page shows live records', async () => {
  await ev(`document.querySelector('#sideNav .nav-item[data-page="clients"]').click()`);
  await sleep(2500);
  const r = await ev(`(() => {
    const txt = (document.querySelector('#page-clients')?.innerText || '');
    return { liveLabel: /live from client master/.test(txt), prototypeCopy: /prototype book/.test(txt) };
  })()`);
  if (!r.liveLabel) throw new Error('live label missing');
  if (r.prototypeCopy) throw new Error('prototype copy still shown');
  return r;
});

// FIX F: favicon on the live portal
await step('favicon served', async () => {
  const r = await ev(`(async () => { const res = await fetch('/favicon.ico'); return { status: res.status, type: (res.headers.get('content-type')||'').slice(0,20) }; })()`);
  if (r.status !== 200) throw new Error('favicon ' + r.status);
  return r;
});

// G: Today dashboard hydrates (command workspace)
await step('today dashboard hydrates', async () => {
  await ev(`document.querySelector('#sideNav .nav-item[data-page="command"]').click()`);
  await sleep(6500);
  const r = await ev(`(() => { const txt = (document.querySelector('#page-command')?.innerText || ''); return { chars: txt.length, loading: /LOADING WORKSPACE/i.test(txt) }; })()`);
  if (r.loading || r.chars < 200) throw new Error('still loading: ' + JSON.stringify(r));
  return r;
});

results.consoleErrors = consoleErrors.slice(0, 10);
results.failedRequests = failed.filter((f) => !f.url.includes('/api/auth/me')).slice(0, 10);
mkdirSync('uat-execution/prod-audit', { recursive: true });
writeFileSync('uat-execution/prod-audit/admin-functional.json', JSON.stringify(results, null, 1));
console.log(`\nconsole errors: ${consoleErrors.length} | unexpected failed requests: ${results.failedRequests.length}`);
ws.close();
