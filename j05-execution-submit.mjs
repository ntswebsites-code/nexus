/* J05 final v2: fill the execution form by field index and submit. */
import { readFileSync } from 'node:fs';
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const apiCalls = [];
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
  if (msg.method === 'Network.responseReceived' && msg.params.response.url.includes('/api/v1/custodian/executions')) {
    apiCalls.push({ m: msg.params.response.requestMethod ?? 'GET', s: msg.params.response.status });
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-custodian.json', 'utf8'));

await send('Page.navigate', { url: cfg.base + '/login' });
await sleep(4500);
await ev(`(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('input[name="email"]'), ${JSON.stringify(cfg.email)});
  set(document.querySelector('input[name="password"]'), ${JSON.stringify(cfg.password)});
  Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent||'')).click();
  return true;
})()`);
await sleep(9000);
await send('Page.navigate', { url: cfg.base + '/executions' });
await sleep(6500);
await ev(`Array.from(document.querySelectorAll('button')).find(x => /new execution/i.test(x.textContent||'')).click()`);
await sleep(2200);

const ref = 'UAT-BROWSER-' + Date.now().toString(36).toUpperCase();
const filled = await ev(`(() => {
  const d = document.querySelector('[role="dialog"], dialog, .modal, [class*="modal"], [class*="drawer"]');
  if (!d) return 'no-dialog';
  const f = Array.from(d.querySelectorAll('input, select'));
  const set = (el, v) => { const dd = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; dd.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set(f[0], ${JSON.stringify(ref)});          // trade reference
  set(f[1], '2026-10-12T09:15');               // executed at (Harare)
  set(f[3], 'ZIM.VX');                         // ticker
  set(f[6], '25');                             // quantity
  set(f[7], '2.29');                           // price
  set(f[9], '2026-10-14');                     // settlement date
  set(f[11], 'UAT browser flow probe');        // note
  return f.slice(0, 10).map((x) => x.value).filter(Boolean);
})()`);
console.log('filled:', JSON.stringify(filled));

// duplicate check disabled: submit once
const submit = await ev(`(() => {
  const d = document.querySelector('[role="dialog"], dialog, .modal, [class*="modal"], [class*="drawer"]');
  const b = Array.from((d || document).querySelectorAll('button')).find(x => /submit execution/i.test(x.textContent||''));
  if (b) { b.click(); return 'clicked'; }
  return 'no-button';
})()`);
await sleep(7000);
console.log('submit:', submit);
console.log('API calls:', JSON.stringify(apiCalls));
const after = await ev(`(() => (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 260))()`);
console.log('page after submit:', after);
ws.close();
