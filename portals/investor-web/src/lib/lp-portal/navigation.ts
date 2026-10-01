/** Client-side LP Portal routes from API related-type/id pairs (no dedicated linkedHref yet). */

export function resolveLpLinkedRecordHref(relatedType: string, relatedId: string): string | null {
  const type = relatedType.toUpperCase().replace(/\s+/g, "_")
  const id = encodeURIComponent(relatedId)

  if (type.includes("NOTICE")) return `/lp-portal/notices?id=${id}`
  if (type.includes("CAPITAL") && type.includes("CALL")) return `/lp-portal/capital-activity?call=${id}`
  if (type.includes("DISTRIBUTION")) return `/lp-portal/capital-activity?tab=distributions`
  if (type.includes("DOCUMENT")) return `/lp-portal/documents?document=${id}`
  if (type.includes("REQUEST") || type.startsWith("SR-")) return `/lp-portal/requests?ref=${id}`
  if (type.includes("SUBSCRIPTION") || type.includes("REDEMPTION") || type.includes("DEALING")) {
    return `/lp-portal/subscriptions-redemptions?request=${id}`
  }
  if (type.includes("LEDGER") || type.includes("TRANSACTION") || type.includes("ACTIVITY")) {
    return `/lp-portal/account-activity?entry=${id}`
  }
  return null
}

export function resolveRequestTypeHref(requestType: string): string {
  const type = requestType.toUpperCase().replace(/\s+/g, "_")
  if (type.includes("CAPITAL")) return "/lp-portal/capital-activity"
  if (type.includes("OPEN_ENDED") || type.includes("DEALING")) return "/lp-portal/subscriptions-redemptions"
  if (type.includes("ACCOUNT") || type.includes("STATEMENT")) return "/lp-portal/account-activity"
  if (type.includes("DOCUMENT")) return "/lp-portal/documents"
  if (type.includes("PROFILE") || type.includes("ACCESS")) return "/lp-portal/organisation"
  if (type.includes("NOTICE")) return "/lp-portal/notices"
  return "/lp-portal/requests"
}

export function resolveDocumentHref(documentId: string): string {
  return `/lp-portal/documents?document=${encodeURIComponent(documentId)}`
}
