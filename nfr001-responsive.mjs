/* NFR-001: responsive sweep of the live portals at the five approved sizes. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-admin.json', 'utf8'));
const lpCfg = JSON.parse(readFileSync('tools/uat/probes/prod-audit-investor.json', 'utf8'));
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
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sizes = [
  { w: 1920, h: 1080 },
  { w: 1366, h: 768 },
  { w: 1280, h: 800 },
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
];

async function login(c) {
  await send('Page.navigate', { url: c.base + '/login' });
  await sleep(4500);
  await ev(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[name="email"]'), ${JSON.stringify(c.email)});
    set(document.querySelector('input[name="password"]'), ${JSON.stringify(c.password)});
    Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent||'')).click();
    return true;
  })()`);
  await sleep(10000);
}

const out = {};
for (const [label, c] of [['admin', cfg], ['investor', lpCfg]]) {
  await login(c);
  out[label] = {};
  for (const s of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.w < 500 });
    await send('Page.navigate', { url: c.base + (label === 'admin' ? '/' : '/lp-portal') });
    await sleep(13000);
    const r = await ev(`(() => {
      const de = document.documentElement;
      const txt = (document.body.innerText || '');
      const btns = Array.from(document.querySelectorAll('main button, main a')).filter(b => b.offsetParent !== null).length;
      return {
        overflowX: de.scrollWidth > de.clientWidth + 2,
        chars: txt.length,
        actionsVisible: btns,
        sample: txt.replace(/\\s+/g, ' ').slice(0, 100),
      };
    })()`);
    out[label][`${s.w}x${s.h}`] = r;
    console.log(`${label} ${s.w}x${s.h}: overflow=${r.overflowX} chars=${r.chars} actions=${r.actionsVisible}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
}
mkdirSync('uat-execution/nfr', { recursive: true });
writeFileSync('uat-execution/nfr/nfr-001-responsive.json', JSON.stringify(out, null, 1));
console.log('saved');
ws.close();
