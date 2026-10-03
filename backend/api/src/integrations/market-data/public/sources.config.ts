/**
 * Public market-data sources and their parsing selectors: the ONLY file to touch when a page layout changes.
 *
 * Source vetting (checked 2026-10-03; re-check before enabling in a new environment):
 *  - ZSE_AFX  afx.kwayisi.org/zse/  robots.txt allows crawling with `Crawl-delay: 60`; no terms restricting automated
 *             reading found; static HTML tables. We make at most one list request per 60 s, identify ourselves, cache.
 *  - ER_API   open.er-api.com       documented free endpoint (https://www.exchangerate-api.com/docs/free), updates daily;
 *             terms require attribution ("Rates By Exchange Rate API"), which the ops screen shows. It carries ZWG.
 *  - Rejected: zse.co.zw / vfex.exchange (market data is a JavaScript app behind the login-only Data Direct portal, so
 *             there is no public page to read), rbz.co.zw (HTTP 403 to automated clients; we do not work around it),
 *             africanfinancials.com (HTTP 403 to automated clients), stockanalysis.com / investing.com (commercial aggregators; terms
 *             not cleared for automated use, so not used). Therefore VFEX and OTC securities have NO free public source: they are reported as skipped and
 *             need the `live` paid feed, a file drop or manual prices.
 */

export const USER_AGENT = 'MatanhoNexusBot/1.0 (+mailto:ops@matanho.example; low-rate EOD reader; honours robots.txt)';

export interface TableColumns {
  /** Header aliases (lower case) per logical field; matched exactly, then by substring, so reordering is tolerated. */
  [field: string]: readonly string[];
}

export interface SourceDef {
  code: string;
  label: string;
  /** Hosts the fetcher is allowed to call for this source (guards against a config typo or redirect leaving the site). */
  host: string;
  /** Minimum gap between network requests to the host (robots Crawl-delay). */
  minIntervalMs: number;
  cacheTtlMs: number;
  note: string;
}

export const ZSE_AFX = {
  code: 'ZSE_AFX',
  label: 'AFX Kwayisi: Zimbabwe Stock Exchange live prices',
  host: 'afx.kwayisi.org',
  minIntervalMs: 60_000,
  cacheTtlMs: 5 * 60_000,
  note: 'Free public page; robots.txt Crawl-delay 60 s honoured. Prices in ZWG, last traded price.',
  listUrl: 'https://afx.kwayisi.org/zse/',
  tickerUrl: (symbol: string) => `https://afx.kwayisi.org/zse/${symbol.toLowerCase()}.html`,
  /** Our ticker suffix for this exchange; the page uses the bare symbol. */
  tickerSuffix: '.ZW',
  currency: 'ZWG',
  list: {
    columns: { ticker: ['ticker', 'symbol', 'code'], name: ['name', 'company'], volume: ['volume'], price: ['price', 'last', 'close'], change: ['change'] } as TableColumns,
    /** Page timestamp `<time id=u datetime=...>`; selects the trading day. */
    asOfPattern: /<time\b[^>]*\bdatetime=["']?([0-9T:+\-.Z]+)/i,
  },
  history: {
    tableAttr: 'data-hist',
    columns: { date: ['date'], volume: ['volume'], close: ['close', 'price'] } as TableColumns,
  },
} as const;

export const ER_API = {
  code: 'ER_API',
  label: 'ExchangeRate-API open endpoint (USD base)',
  host: 'open.er-api.com',
  minIntervalMs: 60 * 60_000,
  cacheTtlMs: 60 * 60_000,
  note: 'Rates By Exchange Rate API (https://www.exchangerate-api.com), free open endpoint, refreshed once a day.',
  url: 'https://open.er-api.com/v6/latest/USD',
  baseCurrency: 'USD',
} as const;

export const PUBLIC_SOURCES: (SourceDef & { url: string })[] = [{ ...ZSE_AFX, url: ZSE_AFX.listUrl }, ER_API];

/** Markets for which a public source exists. Anything else is reported NO_SOURCE. */
export const PUBLIC_MARKET_SUFFIXES: Record<string, 'ZSE_AFX'> = { '.ZW': 'ZSE_AFX' };
