import { PUBLIC_SOURCES, USER_AGENT } from './sources.config';

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchImpl = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' | 'follow' }) => Promise<FetchResponseLike>;

export class FetchError extends Error {
  constructor(
    message: string,
    readonly kind: 'HTTP' | 'NETWORK' | 'RATE_LIMIT' | 'FORBIDDEN_HOST' | 'TOO_LARGE',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface GetOptions {
  minIntervalMs: number;
  cacheTtlMs: number;
  /** Skip a fresh cache entry. The per-host minimum interval still applies. */
  force?: boolean;
  /** Longest we will sleep to respect the interval (0 = never sleep; serve cache or fail). */
  maxWaitMs?: number;
}

export interface GotText {
  body: string;
  fetchedAt: Date;
  fromCache: boolean;
}

const MAX_BYTES = 2_000_000;
const ALLOWED_HOSTS = new Set(PUBLIC_SOURCES.map((s) => s.host));

/**
 * Polite HTTP reader: fixed allow-list of hosts, https only, clear User-Agent, one request per host per interval
 * (the robots Crawl-delay), response cache, no redirects off-host, body size cap and timeout.
 * Time and transport are injectable so tests run offline.
 */
export class PoliteFetcher {
  private cache = new Map<string, GotText>();
  private lastRequestAt = new Map<string, number>();

  constructor(
    private readonly opts: { fetchImpl?: FetchImpl; now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; userAgent?: string } = {},
  ) {}

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async getText(url: string, o: GetOptions): Promise<GotText> {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.host)) throw new FetchError(`Host not allowed: ${u.host}`, 'FORBIDDEN_HOST');
    const cached = this.cache.get(url);
    const age = cached ? this.now() - cached.fetchedAt.getTime() : Infinity;
    if (cached && age < o.cacheTtlMs && !o.force) return { ...cached, fromCache: true };

    const last = this.lastRequestAt.get(u.host);
    const wait = last === undefined ? 0 : last + o.minIntervalMs - this.now();
    if (wait > 0) {
      if (cached) return { ...cached, fromCache: true };
      if (wait > (o.maxWaitMs ?? 0)) throw new FetchError(`Rate limit: next request to ${u.host} allowed in ${Math.ceil(wait / 1000)}s`, 'RATE_LIMIT');
      await (this.opts.sleep ? this.opts.sleep(wait) : new Promise((r) => setTimeout(r, wait)));
    }

    this.lastRequestAt.set(u.host, this.now());
    const impl: FetchImpl = this.opts.fetchImpl ?? ((x, init) => fetch(x, init) as unknown as Promise<FetchResponseLike>);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 15_000);
    try {
      const res = await impl(url, {
        headers: { 'User-Agent': this.opts.userAgent ?? USER_AGENT, Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'en' },
        signal: ctl.signal,
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (loc && new URL(loc, url).host === u.host) throw new FetchError(`Redirected to ${loc}; update the source URL`, 'HTTP', res.status);
        throw new FetchError(`Redirected off-host (${res.status})`, 'FORBIDDEN_HOST', res.status);
      }
      if (res.status === 429 || res.status === 503) throw new FetchError(`Source asked us to slow down (HTTP ${res.status})`, 'RATE_LIMIT', res.status);
      if (res.status !== 200) throw new FetchError(`HTTP ${res.status}`, 'HTTP', res.status);
      const body = await res.text();
      if (body.length > MAX_BYTES) throw new FetchError('Response too large', 'TOO_LARGE');
      const got = { body, fetchedAt: new Date(this.now()), fromCache: false };
      this.cache.set(url, got);
      return got;
    } catch (e) {
      if (e instanceof FetchError) throw e;
      throw new FetchError(e instanceof Error ? e.message : String(e), 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }
}
