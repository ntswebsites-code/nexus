// Tiny static server for the dashboard. Usage: node tools/dashboard/server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.DASHBOARD_PORT || 47931);
const FILES = {
  '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/status.json': 'status.json',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const name = FILES[url.pathname];
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!name || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(name ? 405 : 404, { ...headers, 'Content-Type': 'text/plain' }); return res.end(name ? 'Method not allowed' : 'Not found'); }
  fs.readFile(path.join(HERE, name), (err, buf) => {
    if (err) { res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }); return res.end(name === 'status.json' ? 'status.json not generated yet: run node tools/dashboard/build-status.mjs' : 'Not found'); }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(name)], 'Content-Length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Dashboard on http://127.0.0.1:${PORT}/`));
