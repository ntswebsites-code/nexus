import { vi, expect } from 'vitest';

export interface RecordedRequest {
  method: string;
  path: string; // pathname only
  query: URLSearchParams;
  url: string;
  body: unknown; // parsed JSON, FormData, or raw string
  headers: Record<string, string>; // lower-cased names
  idempotencyKey?: string;
  ifMatch?: string;
}

export interface ApiResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
export type Reply = ApiResult | ((req: RecordedRequest, params: Record<string, string>) => ApiResult | Promise<ApiResult>);

/** Success envelope `{success:true,data}`. */
export const ok = (data: unknown = {}, status = 200): ApiResult => ({ status, body: { success: true, data } });
/** Error envelope `{error:{code,message,details}}`. */
export const fail = (status: number, code: string, message = code, details?: unknown): ApiResult => ({
  status,
  body: { error: { code, message, ...(details === undefined ? {} : { details }) } },
});
/** Body returned verbatim (endpoints without an envelope, e.g. /api/auth/me). */
export const raw = (body: unknown, status = 200): ApiResult => ({ status, body });

/** Key: 'GET /api/v1/ops/funds/:id' (method optional => any method; `*` wildcard allowed). */
export type Routes = Record<string, Reply>;

interface Compiled {
  key: string;
  method: string | null;
  re: RegExp;
  names: string[];
  reply: Reply;
}

function compile(key: string, reply: Reply): Compiled {
  const m = /^(?:([A-Z]+)\s+)?(\S+)$/.exec(key.trim());
  if (!m) throw new Error(`mockApi: bad route key "${key}"`);
  const names: string[] = [];
  const src = m[2]
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_, n: string) => {
      names.push(n);
      return '([^/]+)';
    })
    .replace(/\*/g, '.*');
  return { key, method: m[1] ?? null, re: new RegExp(`^${src}/?$`), names, reply };
}

export interface MockApi {
  /** Every request seen, in order. */
  requests: RecordedRequest[];
  /** Requests matching method + path pattern, e.g. 'POST /api/v1/ops/funds'. */
  calls(key: string): RecordedRequest[];
  /** Add or replace a route mid-test. */
  on(key: string, reply: Reply): void;
  fetch: ReturnType<typeof vi.fn>;
}

const state: { unmocked: string[] } = { unmocked: [] };

/**
 * Installs a fetch mock. Unmatched requests reject (so the app sees a network error) and are
 * recorded; call `expectNoUnmocked()` at the end of a test to fail even if the app swallowed it.
 */
export function mockApi(routes: Routes = {}): MockApi {
  const compiled: Compiled[] = [];
  const requests: RecordedRequest[] = [];
  state.unmocked = [];
  const on = (key: string, reply: Reply) => {
    const i = compiled.findIndex((c) => c.key === key);
    const c = compile(key, reply);
    if (i >= 0) compiled[i] = c;
    else compiled.push(c);
  };
  Object.entries(routes).forEach(([k, v]) => on(k, v));

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), 'http://localhost');
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? req?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    let body: unknown = init?.body ?? undefined;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep raw string */
      }
    }
    const recorded: RecordedRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      url: url.toString(),
      body,
      headers,
      idempotencyKey: headers['idempotency-key'],
      ifMatch: headers['if-match'],
    };
    requests.push(recorded);

    for (const c of compiled) {
      if (c.method && c.method !== method) continue;
      const m = c.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(c.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const out = typeof c.reply === 'function' ? await c.reply(recorded, params) : c.reply;
      return new Response(out.body === undefined ? null : JSON.stringify(out.body), {
        status: out.status,
        headers: { 'content-type': 'application/json', ...(out.headers ?? {}) },
      });
    }
    const msg = `${method} ${url.pathname}${url.search}`;
    state.unmocked.push(msg);
    throw new Error(`mockApi: unmocked request ${msg}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    requests,
    fetch: fetchMock,
    on,
    calls(key) {
      const c = compile(key, ok());
      return requests.filter((r) => (!c.method || c.method === r.method) && c.re.test(r.path));
    },
  };
}

/** Fails the test if anything hit an unmocked route (even if the app swallowed the error). */
export function expectNoUnmocked(): void {
  expect(state.unmocked, 'unmocked API requests').toEqual([]);
}

// ---- request assertions ----

export function expectCalled(api: MockApi, key: string, times = 1): RecordedRequest[] {
  const calls = api.calls(key);
  const seen = api.requests.map((r) => `${r.method} ${r.path}`).join(', ') || 'none';
  expect(calls, `${key} call count (saw: ${seen})`).toHaveLength(times);
  return calls;
}
export function expectNotCalled(api: MockApi, key: string): void {
  expect(api.calls(key), `${key} should not be called`).toHaveLength(0);
}
export function expectBody(req: RecordedRequest, partial: Record<string, unknown>): void {
  expect(req.body).toMatchObject(partial);
}
export function expectIdempotencyKey(req: RecordedRequest): string {
  expect(req.idempotencyKey, 'Idempotency-Key header').toBeTruthy();
  return req.idempotencyKey as string;
}
export function expectIfMatch(req: RecordedRequest, value?: string): void {
  expect(req.ifMatch, 'If-Match header').toBeTruthy();
  if (value !== undefined) expect(req.ifMatch).toBe(value);
}
