/** Market-data adapter contract (GAP-A04). Providers: `public` (free pages), `fake` (deterministic), `live` (paid feed stub). */

export type MarketDataMode = 'public' | 'fake' | 'live';

/** Where a value came from; recorded per price row in `md_provenance`. */
export interface Provenance {
  source: string;
  url: string;
  fetchedAt: Date;
  /** sha256 of the raw row (HTML row or JSON fragment) the value was parsed from. */
  rawHash: string;
}

export interface Quote extends Provenance {
  ticker: string;
  /** Fixed-point decimal string. */
  price: string;
  /** Trading day, YYYY-MM-DD (Harare). */
  priceDate: string;
  currency?: string;
  volume?: string | null;
  /** The cell text as scraped, for provenance. */
  rawValue: string;
}

export interface HistoryPoint extends Provenance {
  ticker: string;
  priceDate: string;
  close: string;
  volume?: string | null;
}

export interface FxPair {
  from: string;
  to: string;
}

export interface FxQuote extends Provenance {
  from: string;
  to: string;
  rate: string;
  rateDate: string;
  rawValue: string;
}

export type IssueKind = 'ERROR' | 'PARSE' | 'REJECTED' | 'NO_SOURCE' | 'NOT_CONFIGURED' | 'BACKOFF';

/** A value or a source that could not be used. NO_SOURCE and BACKOFF are informational (skipped); the rest are exceptions. */
export interface FetchIssue {
  kind: IssueKind;
  source: string;
  url: string;
  ticker?: string;
  message: string;
  fetchedAt: Date;
  rawHash?: string;
  rawValue?: string;
}

export interface SourceReport {
  source: string;
  label: string;
  url: string;
  /** OK | ERROR | CACHED | NOT_CONFIGURED | BACKOFF */
  status: string;
  count: number;
  fetchedAt: Date;
  error?: string;
  /** Attribution / terms note shown in the ops screen. */
  note?: string;
}

export interface Batch<T> {
  items: T[];
  issues: FetchIssue[];
  sources: SourceReport[];
}

export interface FetchContext {
  /** Bypass the response cache (still bound by the per-host minimum interval). */
  force?: boolean;
  /** Max per-ticker fallback page fetches this call (each costs one polite request). */
  fallbackLimit?: number;
  /** Source codes to skip (in back-off). */
  skipSources?: ReadonlySet<string>;
  now?: Date;
}

export interface HealthReport {
  ok: boolean;
  provider: MarketDataMode;
  detail: string;
  sources: { source: string; label: string; url: string; ok: boolean; detail: string }[];
}

// ---- corporate-action announcements (R4-10) ----

export type CaAnnouncementType = 'CASH_DIVIDEND' | 'STOCK_SPLIT' | 'BONUS_ISSUE' | 'SCRIP_DIVIDEND' | 'RIGHTS_ISSUE' | 'MERGER';

/** An announced corporate action as the feed reports it. Dates are YYYY-MM-DD; amounts are fixed-point decimal strings. */
export interface CorporateActionAnnouncement extends Provenance {
  ticker: string;
  type: CaAnnouncementType;
  /** The provider's own identifier for the announcement, when it has one. */
  sourceRef?: string;
  currency?: string;
  exDate: string;
  recordDate: string;
  payDate: string;
  electionDeadline?: string | null;
  /** Cash per share (dividend), subscription price (rights) or merger cash. */
  rate?: string | null;
  /** New shares per old share is ratioNew : ratioOld. */
  ratioNew?: string | null;
  ratioOld?: string | null;
  targetTicker?: string | null;
  withholdingPct?: string | null;
  description?: string | null;
}

export interface MarketDataAdapter {
  readonly name: MarketDataMode;
  fetchQuotes(tickers: string[], ctx?: FetchContext): Promise<Batch<Quote>>;
  fetchHistory(ticker: string, from: string, to: string, ctx?: FetchContext): Promise<Batch<HistoryPoint>>;
  fetchFx(pairs: FxPair[], ctx?: FetchContext): Promise<Batch<FxQuote>>;
  healthCheck(): Promise<HealthReport>;
  /** Announced corporate actions for the tickers. Optional: providers without a source (public) omit it. */
  fetchCorporateActions?(tickers: string[], ctx?: FetchContext): Promise<Batch<CorporateActionAnnouncement>>;
}
