/* Enumerate the execution form fields (dialog may still be open from a prior step). */
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const d = document.querySelector('[role="dialog"], dialog, .modal, [class*="modal"], [class*="drawer"]');
    if (!d) return 'no-dialog';
    const fields = Array.from(d.querySelectorAll('input, select'));
    return fields.map((f, i) => {
      const lbl = (f.labels && f.labels[0] && f.labels[0].textContent.trim()) || f.placeholder || (f.closest('label') && f.closest('label').textContent.trim()) || '?';
      return i + ' ' + f.tagName + ' type=' + (f.type || '') + ' label=' + lbl.slice(0, 30);
    }).join('\\n');
  })()`,
  returnByValue: true,
});
console.log(r.result?.value ?? 'null');
ws.close();
