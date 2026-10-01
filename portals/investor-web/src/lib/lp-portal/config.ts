/**
 * LP Portal data source, resolved per domain.
 *
 * Each domain maps to a group of `lpPortalApi` methods (see `LP_METHOD_DOMAIN` in
 * `lib/api/lp-portal-api.ts`), so a domain can be moved to live once its endpoints work against
 * the running API, and rolled back on its own if something is wrong.
 *
 * Which domains are live is decided by the API at runtime (`GET /api/v1/platform/flags`, see
 * `lib/lp-portal/flags.ts`); rollback is an env change on the API plus a restart, with no portal
 * rebuild. A domain that is not live is served from the mock store and shows the "Demo data"
 * ribbon.
 */
import type { LpDomain } from "@matanho/shared"

export type LpDataDomain = LpDomain

export const LP_DATA_DOMAINS: readonly LpDataDomain[] = [
  "session",
  "dashboard",
  "capital",
  "activity",
  "dealing",
  "performance",
  "documents",
  "notices",
  "requests",
  "organisation",
  "settings",
  "reports",
]

export const LP_DOMAIN_LABELS: Record<LpDataDomain, string> = {
  session: "Account & session",
  dashboard: "Dashboard",
  capital: "Capital calls & distributions",
  activity: "Account activity",
  dealing: "Subscriptions & redemptions",
  performance: "Performance",
  documents: "Documents",
  notices: "Notices",
  requests: "Requests & messages",
  organisation: "Organisation",
  settings: "Settings",
  reports: "Reports",
}

/** Safe default: nothing live, everything served from the demo store. */
export function allDemoDomains(): Record<LpDataDomain, boolean> {
  return Object.fromEntries(LP_DATA_DOMAINS.map((d) => [d, false])) as Record<LpDataDomain, boolean>
}
