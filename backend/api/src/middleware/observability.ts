import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Request logging, metrics and general rate limits (NFR-OPS-007, NFR-SEC-014).
 *
 * Logs are one JSON object per line: timestamp, request id, method, path, status, duration, user id, IP. They never
 * contain the query string, request or response bodies, headers or cookies, so tokens in URLs, session cookies and
 * personal data cannot leak into the log stream.
 */
const SKIP_LOG = new Set(['/api/health']);

/** Path with ids collapsed so metrics labels stay low-cardinality. */
export function routeLabel(path: string): string {
  return path
    .split('?')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:token');
}

const BUCKETS_MS = [25, 100, 250, 500, 1000, 2500, 5000];
const counters = new Map<string, { count: number; totalMs: number; buckets: number[] }>();
const startedAt = Date.now();

function record(method: string, route: string, status: number, ms: number) {
  const key = `${method} ${route} ${Math.floor(status / 100)}xx`;
  let c = counters.get(key);
  if (!c) {
    if (counters.size > 2000) return; // hard cap: metrics must not grow without bound
    c = { count: 0, totalMs: 0, buckets: BUCKETS_MS.map(() => 0) };
    counters.set(key, c);
  }
  c.count += 1;
  c.totalMs += ms;
  BUCKETS_MS.forEach((b, i) => {
    if (ms <= b) c!.buckets[i]! += 1;
  });
}

export const requestLog: RequestHandler = (req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const path = req.originalUrl.split('?')[0]!;
    record(req.method, routeLabel(path), res.statusCode, ms);
    if (SKIP_LOG.has(path)) return;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg: 'request',
        requestId: req.requestId,
        method: req.method,
        path: routeLabel(path),
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
        userId: req.user?.id,
        ip: req.ip,
      }),
    );
  });
  next();
};

const tooMany = { error: { code: 'rate_limited', message: 'Too many requests, slow down and try again shortly' } };
const skipHealth = (req: Request) => req.path === '/health';

/** 600 requests per minute per client (production default) across the whole API. */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.limits.perMinute,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipHealth,
  message: tooMany,
});

/** 30 multipart uploads per minute per client (production default). */
export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.limits.uploadsPerMinute,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => !(req.method === 'POST' || req.method === 'PUT') || !(req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/'),
  message: { error: { code: 'rate_limited', message: 'Too many uploads, wait a minute and try again' } },
});

/** Prometheus text exposition, guarded by METRICS_TOKEN (404 when unset or wrong, so the endpoint is not discoverable). */
export const metricsHandler: RequestHandler = (req, res) => {
  const expected = config.metricsToken;
  const given = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const ok = !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    return;
  }
  const lines = ['# TYPE nexus_uptime_seconds gauge', `nexus_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`, '# TYPE nexus_http_requests_total counter', '# TYPE nexus_http_request_ms histogram'];
  for (const [key, c] of counters) {
    const [method, route, cls] = key.split(' ') as [string, string, string];
    const labels = `method="${method}",route="${route}",class="${cls}"`;
    lines.push(`nexus_http_requests_total{${labels}} ${c.count}`);
    BUCKETS_MS.forEach((b, i) => lines.push(`nexus_http_request_ms_bucket{${labels},le="${b}"} ${c.buckets[i]}`));
    lines.push(`nexus_http_request_ms_bucket{${labels},le="+Inf"} ${c.count}`, `nexus_http_request_ms_sum{${labels}} ${Math.round(c.totalMs)}`, `nexus_http_request_ms_count{${labels}} ${c.count}`);
  }
  res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
};
