/* CDP-driven browser audit of live portals. Usage:
 *   node audit-cdp.mjs <config.json>
 * Config: { base, persona, password, portal, workspace (admin), pages: [...], clicks: [...], shots: bool }
 * Drives real Chrome over the DevTools Protocol: fills the login form, clicks Sign in,
 * navigates pages, clicks workspace nav, records console errors + failed requests. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tabsRes = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = tabsRes.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
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
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    consoleErrors.push(text.slice(0, 200));
  }
  if (msg.method === 'Network.responseReceived') {
    const r = msg.params.response;
    if (r.status >= 400) failedRequests.push({ url: r.url.slice(0, 140), status: r.status });
  }
});

await new Promise((r) => ws.addEventListener('open', r));
// Clean slate: drop every cookie and cache entry so each audit starts unauthenticated.
await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
await send('Network.clearBrowserCookies');
await send('Storage.clearDataForOrigin', { origin: cfg.base, storageTypes: 'all' }).catch(() => {});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, tries = 12, gap = 1500) => {
  for (let i = 0; i < tries; i += 1) {
    const v = await evaluate(expr);
    if (v) return v;
    await sleep(gap);
  }
  return null;
};

const results = { base: cfg.base, persona: cfg.persona, steps: [] };
const step = async (name, fn) => {
  try {
    const out = await fn();
    results.steps.push({ name, ok: true, detail: out ?? null });
    console.log(`PASS  ${name}${out ? ' :: ' + JSON.stringify(out).slice(0, 220) : ''}`);
  } catch (e) {
    results.steps.push({ name, ok: false, detail: String(e).slice(0, 300) });
    console.log(`FAIL  ${name} :: ${String(e).slice(0, 220)}`);
  }
};

// 1. open the login page
await step('open login page', async () => {
  await send('Page.navigate', { url: cfg.base + '/login' });
  await sleep(4500);
  return evaluate('document.title');
});

// 2. fill the login form as a human would (React-compatible input events; poll for hydration)
if (!cfg.email) {
  results.steps.push({ name: 'login', ok: true, detail: 'public portal - no credentials needed' });
  console.log('PASS  login :: public portal, no credentials');
} else await step('fill credentials', async () => {
  const ready = await waitFor(`(() => {
    const email = document.querySelector('input[name="email"], input[type="email"], input#email');
    const pass = document.querySelector('input[name="password"], input[type="password"], input#password');
    if (!email || !pass) return null;
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set(email, ${JSON.stringify(cfg.email)});
    set(pass, ${JSON.stringify(cfg.password)});
    return { email: email.value, pass: pass.value.length };
  })()`);
  if (!ready) throw new Error('login inputs not found');
  return ready;
});

// 3. click Sign in
if (cfg.email) await step('submit login', async () => {
  const clicked = await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent || ''));
    if (btn) { btn.click(); return true; } return false;
  })()`);
  if (!clicked) throw new Error('sign-in button not found');
  await sleep(9000);
  return evaluate('location.pathname');
});

// 4. verify authenticated state
if (cfg.email) await step('authenticated home', async () => {
  const state = await evaluate(`(() => ({
    url: location.pathname,
    body: (document.body.innerText || '').slice(0, 300),
  }))()`);
  if (state.url === '/login' || state.url.endsWith('/login')) { await sleep(6000); const re = await evaluate('location.pathname'); if (re === '/login' || re.endsWith('/login')) throw new Error('still on login after retry wait'); }
  return state;
});

// 5. walk the pages listed in the config
for (const p of cfg.pages || []) {
  await step('page ' + p, async () => {
    await send('Page.navigate', { url: cfg.base + p });
    await sleep(cfg.waitMs || 2500);
    const s = await evaluate(`(() => {
      const main = document.querySelector('main') || document.body;
      const txt = (main.innerText || '').replace(/\\s+/g, ' ');
      return { url: location.pathname, chars: txt.length, errorMark: (txt.match(/(Error|failed to load|Unable to load|Something went wrong|500 Internal)/i) || [])[0] || null, sample: txt.slice(0, 160) };
    })()`);
    if (s.errorMark) throw new Error('error marker: ' + s.errorMark + ' :: ' + s.sample);
    if (s.chars < 50) throw new Error('near-empty page: ' + s.url);
    return s;
  });
}

// 6. admin legacy shell: click every workspace nav item
if (cfg.workspace === 'admin') {
  for (const nav of cfg.navs || []) {
    await step('workspace ' + nav, async () => {
      const r = await evaluate(`(async () => {
        const b = document.querySelector('#sideNav .nav-item[data-page="${nav}"]');
        if (!b) return { missing: true };
        b.click();
        await new Promise(r2 => setTimeout(r2, 2200));
        const panel = document.querySelector('#page-${nav}') || document.querySelector('#v33DataView') || document.querySelector('main');
        const txt = (panel && panel.innerText) || '';
        return { active: document.querySelector('#sideNav .nav-item.active')?.getAttribute('data-page'), chars: txt.length, errorMark: (txt.match(/(Loading audit events|Failed to load|Unable to load)/i) || [])[0] || null, sample: txt.replace(/\\s+/g, ' ').slice(0, 140) };
      })()`);
      if (r.missing) throw new Error('nav item missing');
      if (r.errorMark) throw new Error('error: ' + r.errorMark);
      if (r.chars < 100) throw new Error('empty workspace');
      return r;
    });
  }
}

// 7. LP portal: verify data pages show live values
if (cfg.workspace === 'investor') {
  for (const [path, expect] of Object.entries(cfg.expects || {})) {
    await step('lp ' + path, async () => {
      await send('Page.navigate', { url: cfg.base + path });
      await sleep(2600);
      const s = await evaluate(`(() => {
        const txt = (document.querySelector('main')?.innerText || '').replace(/\\s+/g, ' ');
        return { has: txt.includes(${JSON.stringify(expect)}), chars: txt.length, sample: txt.slice(0, 140) };
      })()`);
      if (!s.has) throw new Error('expected "' + expect + '" not found :: ' + s.sample);
      return s;
    });
  }
}

results.consoleErrors = consoleErrors.slice(0, 15);
results.consoleErrorCount = consoleErrors.length;
results.failedRequests = failedRequests.slice(0, 15);
mkdirSync('uat-execution/prod-audit', { recursive: true });
writeFileSync(join('uat-execution/prod-audit', cfg.out), JSON.stringify(results, null, 1));
console.log(`\nconsole errors: ${consoleErrors.length} | failed requests: ${failedRequests.length}`);
console.log('saved uat-execution/prod-audit/' + cfg.out);
ws.close();
