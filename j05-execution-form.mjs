/* J05 final: submit a new execution through the custodian portal UI (production). */
import { readFileSync } from 'node:fs';
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
await sleep(6000);

// click "New execution"
const clicked = await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /new execution/i.test(x.textContent||'')); if (b) { b.click(); return true; } return false; })()`);
await sleep(2000);
// inspect the form
const form = await ev(`(() => {
  const inputs = Array.from(document.querySelectorAll('main input, main select, main textarea')).map(i => ({ tag: i.tagName, name: i.name || i.id, type: i.type || '', ph: i.placeholder || '' }));
  const dialog = document.querySelector('[role="dialog"], dialog, .modal, [class*="modal"], [class*="drawer"]');
  const dtext = dialog ? (dialog.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) : null;
  return { inputs: inputs.slice(0, 14), dialogPresent: !!dialog, dtext };
})()`);
console.log('new execution clicked:', clicked);
console.log('form:', JSON.stringify(form, null, 1));
ws.close();
