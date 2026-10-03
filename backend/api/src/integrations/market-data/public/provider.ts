import type { Batch, FetchContext, FetchIssue, FxPair, FxQuote, HealthReport, HistoryPoint, MarketDataAdapter, Quote, SourceReport } from '../types';
import { FetchError, PoliteFetcher } from './fetcher';
import { LayoutChangedError, parseAfxHistory, parseAfxList, parseErApi } from './parsers';
import { ER_API, PUBLIC_MARKET_SUFFIXES, ZSE_AFX } from './sources.config';

const symbolOf = (ticker: string) => ticker.slice(0, ticker.length - ZSE_AFX.tickerSuffix.length);
const suffixOf = (ticker: string) => Object.keys(PUBLIC_MARKET_SUFFIXES).find((s) => ticker.toUpperCase().endsWith(s));

/**
 * `public` provider: reads free public pages (see sources.config.ts for the vetting notes).
 * Fallback chain for ZSE counters: the live list page first, then the counter's own page (history table) for any
 * counter missing from the list, bounded by `fallbackLimit` because each page costs a polite request.
 */
export class PublicMarketDataProvider implements MarketDataAdapter {
  readonly name = 'public' as const;
  constructor(private readonly fetcher: PoliteFetcher = new PoliteFetcher()) {}

  private report(def: { code: string; label: string; listUrl?: string; url?: string; note: string }, status: string, count: number, fetchedAt: Date, error?: string): SourceReport {
    return { source: def.code, label: def.label, url: def.listUrl ?? def.url ?? '', status, count, fetchedAt, error, note: def.note };
  }

  private errIssue(source: string, url: string, e: unknown, now: Date, ticker?: string): FetchIssue {
    const layout = e instanceof LayoutChangedError;
    return { kind: layout ? 'PARSE' : 'ERROR', source, url, ticker, message: e instanceof Error ? e.message : String(e), fetchedAt: now };
  }

  async fetchQuotes(tickers: string[], ctx: FetchContext = {}): Promise<Batch<Quote>> {
    const now = ctx.now ?? new Date();
    const items: Quote[] = [];
    const issues: FetchIssue[] = [];
    const sources: SourceReport[] = [];
    const zse: string[] = [];
    for (const t of tickers) {
      if (suffixOf(t) === ZSE_AFX.tickerSuffix) zse.push(t.toUpperCase());
      else
        issues.push({
          kind: 'NO_SOURCE',
          source: 'PUBLIC',
          url: '',
          ticker: t,
          message: 'No free public source permits automated reading for this exchange (VFEX/OTC); use the live feed, a file drop or a manual price',
          fetchedAt: now,
        });
    }
    if (!zse.length) return { items, issues, sources };
    if (ctx.skipSources?.has(ZSE_AFX.code)) {
      for (const t of zse) issues.push({ kind: 'BACKOFF', source: ZSE_AFX.code, url: ZSE_AFX.listUrl, ticker: t, message: 'Source in back-off after repeated failures', fetchedAt: now });
      sources.push(this.report(ZSE_AFX, 'BACKOFF', 0, now, 'In back-off'));
      return { items, issues, sources };
    }

    let found = new Map<string, Quote>();
    let listOk = false;
    try {
      const got = await this.fetcher.getText(ZSE_AFX.listUrl, { minIntervalMs: ZSE_AFX.minIntervalMs, cacheTtlMs: ZSE_AFX.cacheTtlMs, force: ctx.force });
      const parsed = parseAfxList(got.body, ZSE_AFX.listUrl, got.fetchedAt);
      found = new Map(parsed.items.map((q) => [q.ticker, q]));
      listOk = true;
      for (const p of parsed.problems) {
        if (p.ticker && zse.includes(p.ticker)) issues.push({ kind: 'PARSE', source: ZSE_AFX.code, url: ZSE_AFX.listUrl, ticker: p.ticker, message: p.message, fetchedAt: got.fetchedAt, rawHash: p.rawHash, rawValue: p.rawValue });
      }
      sources.push(this.report(ZSE_AFX, got.fromCache ? 'CACHED' : 'OK', parsed.items.length, got.fetchedAt));
    } catch (e) {
      issues.push(this.errIssue(ZSE_AFX.code, ZSE_AFX.listUrl, e, now));
      sources.push(this.report(ZSE_AFX, 'ERROR', 0, now, e instanceof Error ? e.message : String(e)));
    }

    const missing: string[] = [];
    for (const t of zse) {
      const q = found.get(t);
      if (q) items.push(q);
      else if (!issues.some((i) => i.ticker === t)) missing.push(t);
    }

    // Fallback: the counter's own page, only when the list page itself parsed (so a layout change on the list does not
    // turn into dozens of requests) and the caller allows it.
    let budget = listOk ? ctx.fallbackLimit ?? 0 : 0;
    for (const t of missing) {
      if (budget <= 0) {
        issues.push({ kind: 'ERROR', source: ZSE_AFX.code, url: ZSE_AFX.listUrl, ticker: t, message: listOk ? 'Not on the ZSE list page (suspended or delisted?)' : 'Source unavailable', fetchedAt: now });
        continue;
      }
      budget--;
      const url = ZSE_AFX.tickerUrl(symbolOf(t));
      try {
        const got = await this.fetcher.getText(url, { minIntervalMs: ZSE_AFX.minIntervalMs, cacheTtlMs: ZSE_AFX.cacheTtlMs, force: ctx.force, maxWaitMs: 70_000 });
        const hist = parseAfxHistory(got.body, url, got.fetchedAt, t);
        const latest = hist.items[0]!;
        items.push({ ticker: t, price: latest.close, priceDate: latest.priceDate, currency: ZSE_AFX.currency, volume: latest.volume, rawValue: latest.close, source: ZSE_AFX.code, url, fetchedAt: got.fetchedAt, rawHash: latest.rawHash });
      } catch (e) {
        issues.push(this.errIssue(ZSE_AFX.code, url, e, now, t));
      }
    }
    return { items, issues, sources };
  }

  async fetchHistory(ticker: string, from: string, to: string, ctx: FetchContext = {}): Promise<Batch<HistoryPoint>> {
    const now = ctx.now ?? new Date();
    if (suffixOf(ticker) !== ZSE_AFX.tickerSuffix) {
      return { items: [], issues: [{ kind: 'NO_SOURCE', source: 'PUBLIC', url: '', ticker, message: 'No free public history source for this exchange', fetchedAt: now }], sources: [] };
    }
    const url = ZSE_AFX.tickerUrl(symbolOf(ticker.toUpperCase()));
    try {
      const got = await this.fetcher.getText(url, { minIntervalMs: ZSE_AFX.minIntervalMs, cacheTtlMs: 60 * 60_000, force: ctx.force, maxWaitMs: 70_000 });
      const parsed = parseAfxHistory(got.body, url, got.fetchedAt, ticker.toUpperCase());
      const items = parsed.items.filter((p) => p.priceDate >= from && p.priceDate <= to);
      return { items, issues: [], sources: [{ ...this.report(ZSE_AFX, got.fromCache ? 'CACHED' : 'OK', items.length, got.fetchedAt), url }] };
    } catch (e) {
      return { items: [], issues: [this.errIssue(ZSE_AFX.code, url, e, now, ticker)], sources: [{ ...this.report(ZSE_AFX, 'ERROR', 0, now, e instanceof Error ? e.message : String(e)), url }] };
    }
  }

  async fetchFx(pairs: FxPair[], ctx: FetchContext = {}): Promise<Batch<FxQuote>> {
    const now = ctx.now ?? new Date();
    if (!pairs.length) return { items: [], issues: [], sources: [] };
    if (ctx.skipSources?.has(ER_API.code)) {
      return { items: [], issues: [{ kind: 'BACKOFF', source: ER_API.code, url: ER_API.url, message: 'Source in back-off after repeated failures', fetchedAt: now }], sources: [this.report(ER_API, 'BACKOFF', 0, now, 'In back-off')] };
    }
    try {
      const got = await this.fetcher.getText(ER_API.url, { minIntervalMs: ER_API.minIntervalMs, cacheTtlMs: ER_API.cacheTtlMs, force: ctx.force });
      const parsed = parseErApi(got.body, ER_API.url, got.fetchedAt, pairs);
      const issues: FetchIssue[] = parsed.problems.map((p) => ({ kind: 'PARSE' as const, source: ER_API.code, url: ER_API.url, ticker: p.ticker, message: p.message, fetchedAt: got.fetchedAt }));
      return { items: parsed.items, issues, sources: [this.report(ER_API, got.fromCache ? 'CACHED' : 'OK', parsed.items.length, got.fetchedAt)] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { items: [], issues: [this.errIssue(ER_API.code, ER_API.url, e, now)], sources: [this.report(ER_API, 'ERROR', 0, now, msg)] };
    }
  }

  async healthCheck(): Promise<HealthReport> {
    const now = new Date();
    const sources: HealthReport['sources'] = [];
    for (const def of [ZSE_AFX, ER_API]) {
      const url = 'listUrl' in def ? def.listUrl : def.url;
      try {
        const got = await this.fetcher.getText(url, { minIntervalMs: def.minIntervalMs, cacheTtlMs: def.cacheTtlMs });
        if (def === ZSE_AFX) parseAfxList(got.body, url, got.fetchedAt);
        else parseErApi(got.body, url, got.fetchedAt, [{ from: 'USD', to: 'ZWG' }]);
        sources.push({ source: def.code, label: def.label, url, ok: true, detail: got.fromCache ? 'cached copy parses' : 'fetched and parsed' });
      } catch (e) {
        const rate = e instanceof FetchError && e.kind === 'RATE_LIMIT';
        sources.push({ source: def.code, label: def.label, url, ok: rate, detail: e instanceof Error ? e.message : String(e) });
      }
    }
    return { ok: sources.every((s) => s.ok), provider: 'public', detail: `Checked ${sources.length} public sources at ${now.toISOString()}`, sources };
  }
}
