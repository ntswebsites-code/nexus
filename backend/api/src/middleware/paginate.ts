import type { Request, RequestHandler } from 'express';

/**
 * List envelope for staff endpoints (NFR-PERF-005). Staff list handlers return `{ data: [...] }` bounded by a `take` cap;
 * this middleware gives every one of them the same contract without touching each handler:
 *
 *   - the response always carries `total` (rows the handler produced), `page` and `pageSize`;
 *   - `?page=2&pageSize=50` returns that window of `data` (pageSize 1..200, default 50 when only `page` is given);
 *   - without paging parameters nothing is cut, so existing screens keep working while new callers page.
 *
 * Handlers that already return their own `total` (or a cursor such as `nextBefore`) are left alone.
 */
export const paginateData: RequestHandler = (req, res, next) => {
  if (req.method !== 'GET') return next();
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    const b = body as { data?: unknown; total?: unknown; nextBefore?: unknown } | null;
    if (!b || typeof b !== 'object' || Array.isArray(b) || !Array.isArray(b.data) || b.total !== undefined || b.nextBefore !== undefined) return json(body);
    const all = b.data as unknown[];
    const wantsPaging = req.query.page !== undefined || req.query.pageSize !== undefined;
    const pageSize = wantsPaging ? Math.min(200, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '50'), 10) || 50)) : Math.max(all.length, 1);
    const page = wantsPaging ? Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1) : 1;
    const data = wantsPaging ? all.slice((page - 1) * pageSize, page * pageSize) : all;
    return json({ ...b, data, page, pageSize, total: all.length });
  }) as typeof res.json;
  next();
};

export interface SqlPage {
  /** True when the caller asked for a page (`?page=` / `?pageSize=`). */
  paged: boolean;
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

/**
 * Real SQL paging (GAP-014). Handlers pass `skip`/`take` to Prisma and count with the same `where`, then return
 * `pageEnvelope(...)`: `paginateData` leaves a body that already carries `total` alone, so nothing is sliced in memory.
 * Without paging parameters the handler's own `limit` applies, as before.
 */
export function sqlPage(req: Request, fallbackLimit: number, maxPageSize = 200): SqlPage {
  const paged = req.query.page !== undefined || req.query.pageSize !== undefined;
  if (!paged) return { paged, skip: 0, take: fallbackLimit, page: 1, pageSize: fallbackLimit };
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '50'), 10) || 50));
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  return { paged, skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export const pageEnvelope = <T>(p: SqlPage, data: T[], total: number) => ({ data, page: p.page, pageSize: p.pageSize, total });

/** Staff API prefixes that get the envelope. Portal-facing routers (lp-portal, investee, custodian) keep their own strict contracts. */
export const STAFF_LIST_PREFIXES = [
  '/ops',
  '/orders',
  '/risk',
  '/nav',
  '/accounting',
  '/corporate-actions',
  '/cash',
  '/recon',
  '/operations',
  '/ibor',
  '/performance',
  '/research',
  '/private-markets',
  '/portfolio-lab',
  '/financing',
  '/client-ops',
  '/reports',
  '/regulatory',
  '/data',
  '/model-governance',
  '/admin-core',
  '/admin',
];
