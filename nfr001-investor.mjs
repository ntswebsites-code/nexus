/* NFR-001 investor: login + responsive check with session verification. */
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-investor.json', 'utf8'));
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
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
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
await send('Network.clearBrowserCookies');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.navigate', { url: cfg.base + '/login' });
await sleep(5000);
const filled = await ev(`(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const e = document.querySelector('input[name="email"]'), p = document.querySelector('input[name="password"]');
  if (!e || !p) return 'no-inputs';
  set(e, ${JSON.stringify(cfg.email)});
  set(p, ${JSON.stringify(cfg.password)});
  Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent||'')).click();
  return 'submitted';
})()`);
await sleep(12000);
const after = await ev(`(() => ({ url: location.pathname, txt: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,120) }))()`);
console.log('fill:', filled, '| after:', JSON.stringify(after));
const sizes = [[1920,1080],[1366,768],[1280,800],[768,1024],[390,844]];
for (const [w, h] of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url: cfg.base + '/lp-portal' });
  await sleep(13000);
  const r = await ev(`(() => { const de = document.documentElement; return { overflowX: de.scrollWidth > de.clientWidth + 2, chars: (document.body.innerText||'').length, actions: Array.from(document.querySelectorAll('main button, main a')).filter(b => b.offsetParent !== null).length }; })()`);
  console.log(`investor ${w}x${h}: overflow=${r.overflowX} chars=${r.chars} actions=${r.actions}`);
}
ws.close();
