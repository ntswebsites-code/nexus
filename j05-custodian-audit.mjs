/* J05: custodian portal browser flow on production - login, executions page, submit a batch. */
import { readFileSync } from 'node:fs';
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleErrors = [];
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
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push((msg.params.args || []).map((a) => a.value ?? '').join(' ').slice(0, 140));
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
await send('Network.clearBrowserCookies');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-custodian.json', 'utf8'));
const out = {};

await send('Page.navigate', { url: cfg.base + '/login' });
await sleep(4500);
const filled = await ev(`(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const e = document.querySelector('input[name="email"]'), p = document.querySelector('input[name="password"]');
  if (!e || !p) return 'no-inputs';
  set(e, ${JSON.stringify(cfg.email)});
  set(p, ${JSON.stringify(cfg.password)});
  Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent||'')).click();
  return 'submitted';
})()`);
await sleep(10000);
out.login = await ev(`(() => ({ url: location.pathname, sample: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 140) }))()`);

// executions page renders + has the submission surface
await send('Page.navigate', { url: cfg.base + '/executions' });
await sleep(6000);
out.executions = await ev(`(() => {
  const main = document.querySelector('main') || document.body;
  const txt = (main.innerText || '');
  return {
    chars: txt.length,
    sample: txt.replace(/\\s+/g, ' ').slice(0, 220),
    uploadInput: !!document.querySelector('input[type="file"]'),
    buttons: Array.from(main.querySelectorAll('button')).map(b => (b.textContent||'').trim()).slice(0, 10),
  };
})()`);

// statements page
await send('Page.navigate', { url: cfg.base + '/statements' });
await sleep(6000);
out.statements = await ev(`(() => ({ chars: ((document.querySelector('main')||document.body).innerText||'').length, sample: ((document.querySelector('main')||document.body).innerText||'').replace(/\\s+/g,' ').slice(0, 200) }))()`);

console.log(JSON.stringify(out, null, 1));
console.log('console errors:', consoleErrors.length, consoleErrors.slice(0, 3));
ws.close();
