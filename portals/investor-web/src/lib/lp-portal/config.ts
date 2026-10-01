/**
 * LP Portal data source.
 *
 * This used to be a single boolean that swapped the entire API surface between the mock store
 * and the live client. That made migration all-or-nothing: eleven screens and seventy methods
 * moved together, so a single bad response anywhere meant reverting the whole portal and there
 * was no way to verify one area at a time.
 *
 * It is now resolved per domain. Each domain maps to a group of `lpPortalApi` methods (see
 * `LP_METHOD_DOMAIN` in `lib/api/lp-portal-api.ts`), so a domain can be moved to live only once
 * its endpoints have actually been round-tripped against the running API, and rolled back on its
 * own if something is wrong.
 *
 * `false` here means "keep serving this domain from the mock store".
 */
export type LpDataDomain =
  | "session"
  | "dashboard"
  | "capital"
  | "activity"
  | "dealing"
  | "performance"
  | "documents"
  | "notices"
  | "requests"
  | "organisation"
  | "settings"
  | "reports"

/** Every domain is served from the demo store: this portal has no live API connection. */
export const LP_LIVE_DOMAINS: Record<LpDataDomain, boolean> = {
  session: false,
  dashboard: false,
  capital: false,
  activity: false,
  dealing: false,
  performance: false,
  documents: false,
  notices: false,
  requests: false,
  organisation: false,
  settings: false,
  reports: false,
}

/** True when the given domain should hit the real API. */
export function isLpDomainLive(domain: LpDataDomain): boolean {
  return LP_LIVE_DOMAINS[domain] === true
}

/**
 * Back-compat: some code (notably `realtime.ts`) only needs to know whether the portal is
 * running fully on mock data. True only when every domain is still mocked.
 */
export const LP_PORTAL_USE_MOCK = Object.values(LP_LIVE_DOMAINS).every((v) => v === false)
