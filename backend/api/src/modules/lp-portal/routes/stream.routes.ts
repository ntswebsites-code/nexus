import { Router } from 'express';
import { prisma } from '../../../lib/prisma';
import { lp } from '../lp.context';
import { REALTIME_EVENTS, realtimeEventsFor, unreadCounts } from './session.routes';

/**
 * `GET /lp-portal/realtime/stream` - server-sent events (GAP-017, FR-LP-006/055/064/073/082).
 *
 * The caller is authenticated by the normal session cookie (the router is behind `requireAuth` and the LP context).
 * The worker process writes notifications, so each open stream watches this user's `notifications` rows (one cheap
 * indexed query every TICK_MS) and pushes an event per change plus fresh unread counts. A heartbeat comment keeps
 * proxies from closing the connection; the stream ends after MAX_LIFE_MS with `event: reconnect`, so a revoked or
 * expired session cannot hold a stream open for long, and the browser reconnects with `Last-Event-ID`.
 * Connections are capped per user.
 */
export const lpStreamRoutes = Router();

export const STREAM_TICK_MS = 3_000;
export const STREAM_HEARTBEAT_MS = 20_000;
export const STREAM_MAX_LIFE_MS = 10 * 60_000;
export const STREAM_MAX_PER_USER = 4;
const MAX_AGE_MS = 24 * 3_600_000;

const open = new Map<string, number>();

/** Cursor from `Last-Event-ID` (`<notificationId>:<event>@<iso>`) or `?since=`; falls back to now. */
export function streamCursor(lastEventId: unknown, since: unknown, now = new Date()): Date {
  const fromId = typeof lastEventId === 'string' && lastEventId.includes('@') ? lastEventId.slice(lastEventId.lastIndexOf('@') + 1) : null;
  const raw = fromId ?? (typeof since === 'string' ? since : null);
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) && d.getTime() > now.getTime() - MAX_AGE_MS && d.getTime() <= now.getTime() + 60_000 ? d : now;
}

lpStreamRoutes.get('/realtime/stream', (req, res) => {
  const ctx = lp(req);
  const count = open.get(ctx.userId) ?? 0;
  if (count >= STREAM_MAX_PER_USER) {
    res.status(429).json({ success: false, code: 'LP_TOO_MANY_STREAMS', message: 'Too many open live connections', retryable: true });
    return;
  }
  open.set(ctx.userId, count + 1);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let cursor = streamCursor(req.headers['last-event-id'], req.query.since);
  const seen = new Set<string>();
  let closed = false;
  let busy = false;
  const write = (chunk: string) => {
    if (!closed) res.write(chunk);
  };
  const send = (event: string, data: unknown, id?: string) => write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  write('retry: 5000\n\n');
  send('ready', { cursor: cursor.toISOString(), events: REALTIME_EVENTS, heartbeatMs: STREAM_HEARTBEAT_MS });

  const tick = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const rows = await prisma.notification.findMany({ where: { userId: ctx.userId, createdAt: { gte: cursor } }, orderBy: { createdAt: 'asc' }, take: 100 });
      const fresh = rows.filter((n) => !seen.has(n.id));
      for (const n of fresh) {
        seen.add(n.id);
        const at = n.createdAt.toISOString();
        for (const event of realtimeEventsFor(n.type)) {
          send(event, { notificationId: n.id, type: n.type, link: n.link, at }, `${n.id}:${event}@${at}`);
        }
      }
      if (rows.length) cursor = rows[rows.length - 1]!.createdAt;
      if (seen.size > 500) for (const id of [...seen].slice(0, 250)) seen.delete(id);
      if (fresh.length) send('lp_counts', await unreadCounts(ctx));
    } catch {
      // A transient database error must not kill the stream; the next tick retries.
    } finally {
      busy = false;
    }
  };

  const timers = [
    setInterval(() => void tick(), STREAM_TICK_MS),
    setInterval(() => write(`: heartbeat ${Date.now()}\n\n`), STREAM_HEARTBEAT_MS),
  ];
  const life = setTimeout(() => {
    send('reconnect', { reason: 'max_lifetime' });
    res.end();
  }, STREAM_MAX_LIFE_MS);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const t of timers) clearInterval(t);
    clearTimeout(life);
    const n = (open.get(ctx.userId) ?? 1) - 1;
    if (n <= 0) open.delete(ctx.userId);
    else open.set(ctx.userId, n);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});
